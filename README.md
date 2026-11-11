# Binfo

Binfo is independent decision support for people buying a bostadsrätt (a
cooperative apartment) in Sweden. Live site: https://binfo.slanesens.com

Before bidding, a buyer has to judge two things: whether the asking price is
reasonable, and whether the housing cooperative (the _bostadsrättsförening_,
BRF) is financially sound. Existing services grade the cooperative. Binfo grades
the _transaction_: what this flat is worth, what the förening's economy means for
this buyer's monthly fee in kronor, and what to ask before bidding.

A buyer enters the flat's details (or pastes a Booli listing link) and gets:

- a **price check** from Binfo's own valuation model;
- a **BRF analysis** of the förening's annual report (_årsredovisning_): the
  seven statutory key figures, a grade A–E, red flags and questions for the
  board;
- a **mortgage calculator** (_bolånekalkyl_) and a **buying guide** (_köpguide_).

The site is in Swedish. Code, comments and docs are in English, though some
older pipeline comments are in Swedish.

## Tech stack

| Layer            | Technology                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| Web app          | React 19, TypeScript, TanStack Start/Router (SSR + server functions), TanStack Query, Tailwind CSS 4    |
| Hosting          | Cloudflare Workers (built and published via Lovable)                                                    |
| Backend          | Supabase: Postgres, Storage, Auth, pg_cron, one Edge Function (Deno) as background worker               |
| AI               | Anthropic Claude API (Sonnet for the analysis, Haiku for a cheap identification step)                   |
| PDF              | `unpdf` (pdf.js) for text extraction, `pdf-lib` for splitting scans, `@react-pdf/renderer` for exports  |
| Machine learning | Python (pandas, LightGBM, statsmodels) offline; the trained model is evaluated in TypeScript at runtime |
| Tests            | Vitest (TypeScript), pytest (Python)                                                                    |

## Repository layout

```
src/
  routes/          One file per page (TanStack file routes)
  components/      React components: the report (rapport/), PDF export (pdf/),
                   register, account and calculator UI, the UI kit (ui/binfo.tsx)
  lib/
    analysis/      The annual-report pipeline: PDF text, prompts, extraction,
                   checks, judging and assembly of the final report
    analysis/calc/ Pure calculations: monthly cost, fee prognosis, rate stress,
                   savings need, amortisation, interest deduction
    vardering/     Valuation engine (server-only): evaluates the exported model
    kalkyl/        Mortgage calculator: rules, calculation, Excel export
    register/      Areas used by the public BRF register
    annons/        Booli listing links (URL check, filling the form)
  server/          Server-only code: server functions (analysFn.ts is the only
                   entry the browser may call), job state machine, register,
                   accounts, quotas, Supabase adapters, admin CLIs
  types/           The shared contract between client and server (analysis.ts)
supabase/
  migrations/      Database schema (SQL)
  functions/       The background worker (analys-steg)
ml/                Offline training of the valuation model, postcode → area
                   mapping, model cards and exported artifacts
data/              Transaction data (Svensk Mäklarstatistik) and derived tables
fixtures/          Test fixtures: answer keys for the extraction, recorded
                   Booli responses
scripts/           Build and maintenance scripts (model data, register data, …)
docs/              Design decisions, specs, plans and the log of paid API runs
```

Other documentation: `PIPELINE.md` (why the analysis pipeline looks the way it
does), `SUPABASE.md` (database and job orchestration), `BENCHMARKS.md` (thresholds
for the key figures), `ml/artifacts/valuation-v3.1/MODEL_CARD.md` (the
valuation model), `docs/DECISIONS.md` (product decisions) and `CLAUDE.md` (a
detailed working reference for the codebase).

## How the pages work

### `/analysera`: price check and BRF analysis

One form in two steps.

**Step 1, the price check (_Priskoll_).** The buyer enters living area, rooms,
monthly fee, address, postcode, floor, construction year, lift and balcony, and
optionally the asking price. A Booli listing link can fill these fields
automatically (via Booli's API). The listing only fills the form and never
starts anything by itself.

The valuation runs on the server (`src/lib/vardering/`):

- **Training data:** about 5 000 apartment sales in Stockholms kommun,
  January–August 2026, from Svensk Mäklarstatistik.
- **Model:** a gradient-boosted tree model (LightGBM) on price per m², trained
  offline in `ml/`. It uses living area, rooms, fee per m², floor, construction
  year, lift, balcony, an area within Stockholm and a postcode effect.
- **Postcode effect:** the effect of a postcode with few sales is shrunk toward
  its four-digit neighbourhood.
- **Runtime:** the model is exported as JSON and evaluated by a small tree
  evaluator in TypeScript, so there is no Python in production.
- **Coverage:** Stockholms kommun uses the area model. The rest of the län uses
  the general relationships scaled to the kommun's price level. Outside the län
  the result is shown with a clear disclaimer.
- **What the buyer sees:** the value rounded to 10 000 kr, with a ±10 % span.
  When an asking price is given, the page also shows how it compares.

**Step 2, the BRF analysis.** The buyer uploads the förening's årsredovisning
(PDF). If the same report is already in Binfo's register, it is reused at once.
Otherwise a background job runs the pipeline below.

#### The analysis pipeline

The web app stores the PDF and creates a job. A cron job (pg_cron, every minute)
calls the Supabase Edge Function `analys-steg`, which advances one stage per call
and re-invokes itself until the job is done (`src/server/steg.ts`):

1. **Text layer.** `unpdf`/pdf.js extracts the text of each page and classifies
   the PDF: a normal text PDF, a scan (no text layer) or a garbled text layer.
2. **Identification.** The organisation number, fiscal year and name are read
   locally from the text when possible. Otherwise Claude Haiku reads pages 1–3.
   A förening + year that is already analysed is reused with no new API cost.
3. **Transcription (scans only).** The PDF is split into 5-page chunks.
   Claude transcribes them in parallel into a citable text document.
4. **Grounding.** Claude reads the whole report with the Citations feature
   turned on and quotes the passages that hold each figure. Page numbers come
   from the API's citations, never from the model's own claims.
5. **Extraction.** A second call turns the cited findings into structured JSON:
   the key figures, loans, maintenance, building parts and commercial leases.
   Two calls are needed because the API cannot combine citations with
   structured output. Everything is validated with Zod. Deterministic code then
   derives missing figures, runs sanity checks and verifies every cited excerpt
   against the page text.
6. **Judging.** Claude grades the förening and writes red flags and questions
   for the board. It sees only the extraction, never the buyer's data, and it
   gets Binfo's own computed figures so it never has to calculate anything.
   Code then clamps the grade to what the key-figure statuses allow and checks
   every number in the explanation.

Each run has a per-analysis and a daily cost cap. A typical text report costs
about 6 SEK and takes 2–3 minutes.

The result is stored per förening and year, independent of the buyer. On every
read it is combined with the buyer's own flat to produce the final report
(`src/lib/analysis/assemble.ts`). That step adds the flat's share of the fees
and debt, and a prognosis of how the monthly fee is likely to change because of
savings gaps, refinancing, maintenance and commercial leases. The expected fee
rise is the only channel through which the förening's economy changes the
price.

### `/forhandsvisning/<id>` and `/analys/<id>`: the report

The first page polls the job and shows progress, then renders the full report.
The second shows the same report for bookmarks and saved analyses.

The report has four sections: the förening, the price, the fee going forward,
and questions to ask at the viewing. It ends with sources and method. It can be
downloaded as a PDF, generated in the browser, and saved to an account.

### `/bolanekalkyl`: mortgage calculator

The calculator runs entirely in the browser. It is driven by a set of rules and
reference values kept in one file (`src/lib/kalkyl/regler.ts`), each with its
source and date. It computes the monthly cost of a flat (interest, amortisation,
fee, running costs) and an affordability check. It can be prefilled from a
report, and exported as PDF or Excel (with live formulas). The inputs only
reach the server if a logged-in user chooses to save the calculation.

### `/brf`: the public BRF register

Every årsredovisning a user uploads becomes part of a public register of
föreningar, browsable by area of Stockholm (`/brf`, `/brf/omrade/<area>`). A
förening's page (`/brf/<slug>`) summarises each analysed year: grade and key
figures. From there one can open the full stored analysis, or analyse a flat in
that förening without uploading the report again. The register only holds data
about the förening, never about the buyers who uploaded it.

### `/kopguide`: buying guide

A step-by-step checklist for buying a bostadsrätt, from preparing the loan to
moving in. Progress is saved in the browser, or in the account when logged in.

### Other pages

- `/exempel` shows a sample report built from a real analysis.
- `/konto/*` covers account creation, login and saved items (Supabase Auth,
  server-side cookies only).
- `/integritet` is the privacy policy.

## Running locally

Requires Node 22 (`.nvmrc`).

```sh
npm install
cp .env.example .env.local   # fill in your own keys; never commit them
npm run dev                  # http://localhost:8080
npm test                     # Vitest
npm run typecheck
npm run lint
cd ml && python -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/pytest
```

Every server function needs a Supabase project and an Anthropic API key (see
`.env.example`). `./scripts/v2-lokalt.sh` starts the whole stack on a local
Supabase instance (Docker).

## Data

- `data/raw/` holds the Svensk Mäklarstatistik transaction data the valuation
  model is trained on.
- The real annual reports used for testing are third-party documents and are
  not part of the repository. Neither are bulk downloads of Booli data.
- `fixtures/` contains only small recorded responses for tests.
