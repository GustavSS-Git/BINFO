# Binfo

Independent buyer-side decision support for Swedish bostadsrätter
(https://binfo.slanesens.com). A buyer uploads the BRF's årsredovisning and gets
a BRF analysis (the seven statutory nyckeltal, grade, red flags, questions for
the styrelse), a price check against Binfo's own valuation model, a
bolånekalkyl and a köpguide. Competitors (Lusa, AI BRF, Allabrf) grade the
_cooperative_; Binfo's point is grading the _transaction_: price,
per-apartment cost in kronor, and what to do before bidding.

**State on 2026-10-23:**

- v2 (scans, register, price check, account-ready infra) deployed 2026-10-10.
- **v3** (accounts, public BRF register `/brf`, calculator rules/KALP/exports,
  pipeline v7 with cited BRF addresses + page-reference verifier) is merged into
  `main` and **deployed to production on 2026-10-14** (both v3 migrations,
  `deploy:edge`, Lovable publish; the two pre-v3 register reports were re-run
  in production the same day, `docs/api-test-log.md` #104). Runbook:
  `docs/DEPLOY-v3.md`. Production `PIPELINE_VERSION` is `p7.i1.s1`; `main` has `p9.i1.s1`
  (p8 2026-10-23 question context, p9 2026-10-24 loans/maintenance/lokaler) —
  not deployed yet, see `PLAN.md`.
- After v3 (on `main`, 2026-10-14): `/integritet` privacy page (controller
  "Binfo (binfo.slanesens.com)", no contact e-mail yet: `src/lib/kontakt.ts`),
  and analysing a flat from a register BRF without uploading
  (`/analysera?forening=<slug>` → `skapaAnalysFranRegisterFn`). Lovable edits
  the landing page directly on `main`.
- **Booli prefill** (2026-10-24, on `main`, NOT deployed; needs the
  `20261024120000_annons.sql` migration first): paste a Booli listing URL on
  `/analysera` → "Hämta uppgifter" fills the form from the page's structured
  data (no LLM). Findings, field map and the Cloudflare blocking:
  `docs/booli.md`. Earlier sales at the same address are NOT fetched (Booli's
  internal GraphQL; round 3).
- **Fee prognosis → price** (2026-10-24b, on `main`, NOT deployed; needs the
  `20261025120000_referensranta.sql` migration + `deploy:edge` together with
  the Lovable publish because of PROMPT_VERSION 9): the report reaches the
  price through ONE channel, the expected rise in månadsavgift (spargap,
  refinansiering, ofinansierat underhåll, lokalhyror, energiprojekt), priced
  with the valuation's OLS fee coefficient. Spec, formulas, margin table and
  the STIBOR finding: `docs/avgiftsprognos.md`. The grade never moves the price.
- Plan/status: `PLAN.md` (current task plan) and `docs/PLAN-v3.md`; decisions:
  `docs/DECISIONS.md`.

## Stack

- Vite + React 19 + TypeScript (strict, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`), TanStack Start/Router (file routes), TanStack
  Query, Tailwind 4. **Not Next.js**: no app router, `/pages` or `server-only`.
- `vite.config.ts` is a thin wrapper around `@lovable.dev/vite-tanstack-config`
  (Lovable-owned). `vitest.config.ts` is deliberately separate from it.
- **Hosting:**
  - The web app (SSR + server functions) is built by Lovable for Cloudflare
    Workers (nitro `cloudflare-module`). Use web APIs only on the server path: no
    `Buffer`, no native modules.
  - The background worker is one Supabase Edge Function (Deno 2), `analys-steg`.
- **Backend:** Supabase (Postgres + pg_cron + pg_net + Storage + Vault), the
  Anthropic API via `@anthropic-ai/sdk` 0.125, Zod v3 (pinned deliberately) and
  `unpdf` (pdf.js) for PDF text.
- **Offline ML:** Python in `ml/` (pandas, LightGBM, pytest; venv at `ml/.venv`).
  The exported model JSON is evaluated in TypeScript at runtime. There is no
  Python in production.
- Node 22 (`.nvmrc`). The shell default may be Node 24, so prefix commands with
  `PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH` or run `nvm use`. The dev
  server always runs on `localhost:8080` (forced by the wrapper).

## Directory map

| Path                                            | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/`                                   | File routes. `routeTree.gen.ts` is generated; never edit it. (`src/routes/README.md` is Lovable's note.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `src/` top level                                | `router.tsx` (fresh `QueryClient` per `getRouter()`), `start.ts` (TanStack Start middleware: error page + CSRF filter on server functions), `server.ts` (SSR entry wrapping swallowed 500s into an HTML error page; set via `tanstackStart.server.entry` in `vite.config.ts`), `styles.css` (Tailwind 4 `@theme` oklch tokens; the `.dark` block is unused shadcn default), `hooks/use-mobile.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/components/`                               | `AnalysRapport` (full report; exports `Prisrimlighet`, also used by the Priskoll on `/analysera`), `AnalysStatus` (polling, waiting, `Misslyckad`, `HittadesInte`), `PropertySummary`, `SiteNav` (+ `SiteFooter`; flat link row, no mobile menu), `pdf/` (PDF export via `@react-pdf/renderer`, lazy-loaded client-only: `download.tsx` → `AnalysPdfDocument.tsx`; `viewModel.ts` is the pure data layer; `fonts.ts`, `theme.ts` (hex palette, disclaimer), `filename.ts` are reusable for other PDFs)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `src/components/ui/binfo.tsx`                   | Binfo UI kit (Card, Button, LinkButton, Field, Badge, Callout, TristateChoice, Tag, Toggle, PageHeader…). Other `ui/*.tsx` files are shadcn primitives.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/lib/kalkyl/`                               | Bolånekalkyl (client-safe, pure): `underlag.ts` (`KalkylUnderlag`, versioned input shared by page, saved kalkyl and exports), `regler.ts` (every rule/constant with source + date, `REGELVERSION`, Konsumentverket 2026 tables), `berakna.ts` (`beraknaKalkyl`, `sammanfattaKalkyl`), `levnadskostnader.ts` (KALP), `indata.ts` (input parsing/limits), `sida.ts` (page state ↔ underlag), `xlsx.ts` (Excel export with live formulas; exceljs)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `src/lib/register/`                             | Public register areas: `omraden.ts` (19 areas + `ovriga-stockholm`, `losRegisteromrade`), generated `data/postnummerStadsdel.data.ts` (`npm run build:register-data`; never hand-edit)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `src/components/konto/`, `register/`, `kalkyl/` | Account UI (`SparaKnapp`, `SparaKalkylKnapp`, `useSparaKalkyl`, `ProfilListor`, `AuthSida`), register UI (`RegisterLista`, `ForeningSida`), `KalkylExport` (PDF/Excel buttons). `pdf/` also has `KalkylPdfDocument` + `kalkylViewModel` + `downloadKalkyl` (lazy).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/lib/`                                      | Client-safe helpers: `session.ts` (session hook over `hamtaSessionFn`), `utkast.ts` (logged-out Spara drafts: sessionStorage + 24 h localStorage mirror), `till.ts` (`saneraTill`: same-origin redirect targets only), `kontoTyper.ts` (account server-function types), `registerVy.ts`, `sitemap.ts`, `uppgifter.ts` (in-memory store shared across routes), `analyseraForm.ts` / `varderingForm.ts` (form parsing/validation), `senasteAnalyser.ts` (localStorage "recent analyses": per browser, not per IP or account; max 5, 12 months), `analysStatusCopy.ts` (error copy; its code union is type-checked against the server's), `analysStatusVy.ts` (status texts/notices), `analysisView.ts`, `bolanekalkyl.ts` (calculator search params), `skatt2026.ts` (2026 income tax, per-person ränteavdrag), `propertyType.ts`, `utils.ts`, `error-capture.ts` / `error-page.ts` (English, `lang="en"`) / `lovable-error-reporting.ts`                                                                                                                                                                                                                                                                                                                                                |
| `src/lib/analysis/`                             | Pipeline: `pdf.ts` + `textlager.ts` (text layer: `ok`/`saknas`/`trasigt`), `identitet.ts` (local orgnr/year/name) + `identitetModell.ts` (Haiku on pages 1–3), `transkribering.ts` + `transkriptionsblock.ts` (scans: parallel page transcription → citable custom-content document), `runExtraction.ts` (grounding on PDF or transcription + structured extraction), `rimlighet.ts` (deterministic sanity checks → `Figure.osaker`), `analyze.ts` (judging), `prompts.ts` (+ `PROMPT_VERSION`), `schema.ts` (Zod mirror of the contract), `tolkaVarde.ts`, `benchmarks.ts`, `assemble.ts` (final `AnalysisResult`; shared price core `byggPrisanalysUtanForening`), `prisdata.ts`, `costGuard.ts` (prices per model, `STANDARD_MODELL`), `callMetrics.ts`, `korExtraktion.ts` (sequential composition for the CLIs), `extract.ts` (`extractWithRetry`: blind re-roll, no error feedback), `answerKey.ts`, `calc/` (`manadskostnad`, `amortering`, `ranteavdrag`, `rantestress`, `schabloner`, `spann`), CLIs `cli.ts` and `verifyAnswerKey.ts`                                                                                                                                                                                                                                        |
| `src/lib/vardering/`                            | **Server-only** valuation engine: TS evaluator of the exported LightGBM trees, tiering (`tackning.ts`), drivers (`drivare.ts`), `budpremie.ts`, postcode/kommun maps (`postnummer.ts`, `kommunKodning.ts`), `vardera.ts` (entry), `features.ts`, `tree.ts`, `data.ts`, `types.ts`. `data/*.data.ts` is generated by `npm run build:vardering-data`; never hand-edit it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/server/`                                   | Server-only. `analysFn.ts` is the only client-importable file (server functions; **no module-scope values** — see Gotchas). `analys.ts` (create/status/result/preview), `register.ts` (register lookup, versioning, re-runs), `steg.ts` (job state machine on `rapport`), `prisuppskattning.ts` (price_estimate service), `kontext.ts` (device cookie + hashed IP + session → principal), `auth.ts` (Supabase Auth flows: register/login/logout/verify/reset/new password/delete account), `sessionCookies.ts` (`binfo_sa`/`binfo_sr`/`binfo_aterst`), `supabaseAuth.ts` (Auth adapter), `sparat.ts` (saved valuations/kalkyler, GDPR export; one ownership helper `kravAgare`), `registerPublik.ts` (public register reads: BRF-level only), `stegLogg.ts` (stage-failure logging), `lagratInput.ts`, `principal.ts`, `behorighet.ts` (entitlement policy), `kvot.ts` (rate limits), `spend.ts`, `cache.ts` (legacy caches), `fel.ts` (error → buyer-safe Swedish), `env.ts`, `portar.ts` (`Lager`/`Databas` port), `kontoPortar.ts`, `supabase.ts` / `supabaseKonto.ts` (adapters), `__fakes__/` (`lager.ts`, `konto.ts`: in-memory fakes mirroring the SQL), `cli/` (`registerCli.ts`, `kontoCli.ts`, `analysCli.ts`, `verifyRls.ts`), `edge/build.ts` (bundles `steg.ts` for Deno) |
| `src/types/analysis.ts`                         | **The contract** for an analysis result and the price check (`PrisInput`, `PrisuppskattningResultat`), shared by client and server                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/data/`                                     | `sampleAnalysis.ts` (static `AnalysisResult` on `/exempel`; see "Example analysis"), `mockData.ts` (calculator defaults + legacy demo `property` "Brf Lindgården", unrelated to `/exempel`). Cost schablons live in `src/lib/analysis/calc/schabloner.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `supabase/`                                     | `migrations/` (10; the first 8 applied in production, incl. v2 `register` + `konto` and v3 `20261013120000_konto_v3.sql` + `20261013120100_register_v3.sql`, 2026-10-14; `20261024120000_annons.sql` not yet), `rollback/` (manual down-scripts, never auto-applied), Edge Function `analys-steg/` (`index.ts` is hand-written Deno glue mirroring `supabase.ts`; it imports the esbuild bundle `_bundle/steg.js`, gitignored; also `reinvoke.ts`, `effort.ts` + their two vitest files, the only tests outside `src/`). `config.toml` references a `seed.sql` that doesn't exist (harmless). No SQL test files are committed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `ml/`                                           | Training (`train_valuation_v31.py` + `valuation_v31_lib.py` on top of `train_valuation_v3.py` / `valuation_v3_lib.py`, `cleaning.py`), postcode/kommun mapping (`mapping/`), artifacts (`artifacts/valuation-v3.1/` = shipped, delta card to `artifacts/valuation-v3/MODEL_CARD.md`; `valuation-v3.2/` exists only on the local branch `valuation-v3.2`, rejected), pytest suite                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `data/raw/`                                     | Svensk Mäklarstatistik transaction xlsx (committed, not confidential); `data/derived/` holds the mapping CSVs and price levels                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `src/lib/annons/`                               | Listing prefill, client-safe: `typer.ts` (`AnnonsSvar`, `AnnonsUppgifter`, `ANNONS_FALT`, `ANNONS_MEDDELANDE`), `url.ts` (`kontrolleraAnnonsUrl`: https + `booli.se`/`www.booli.se` + `/bostad                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | annons/<id>`only, canonicalised; shared by client and server),`formular.ts`(click flow, applying an answer, per-field provenance booli/manuellt/saknas,`tillAnnonsKalla`) |
| `src/server/annons/`                            | `booli.ts` (pure parser: RSC `Listing` object + JSON-LD, never visible HTML), `hamta.ts` (`hamtaAnnons`: kill switch → URL check → 24 h cache → entitlement `hamta_annons` → quota → one fetch → parse → optional LLM fallback → Nominatim postcode fallback → cache), `geokod.ts` (Nominatim, only when the postcode is missing), `llmFallback.ts` (Haiku, off unless `ANNONS_LLM_FALLBACK=on`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Fee prognosis (2026-10-24b)                     | `src/lib/analysis/calc/prognosantaganden.ts` (EVERY assumption: horizon, refinancing share, margin 0.58 pp, maintenance years, lokal risk, 3 % widening, 30 % guard, OLS β synced to `metadata.json` by a test, reference-rate fallback), `calc/avgiftsprognos.ts` (`beraknaAvgiftsprognos`: five components → flat kr/month via andel = fee×12 ÷ årsavgifter), `prisjustering.ts` (`byggPrisjustering`: adjusted price = baseline + β × rise × kr/m²; missing data widens only the low end), `uppgiftsjamforelse.ts` (report vs input statuses; report byggår wins at high confidence and feeds the valuation), `sammanfattning.ts` (deterministic closing summary), `calc/rantestress.ts` `byggPrognosTabell`, `referensrantaHamtning.ts` (Riksbank SWEA fetch) + `src/server/referensranta.ts` (daily cache on `KontoDatabas`, never throws), `scripts/monteraOm.ts` (free re-assembly of a saved run), `fixtures/answer-key-lan/` (loan keys, UTKAST)                                                                                                                                                                                                                                                                                                                              |
| `fixtures/booli/`                               | Raw Booli listing HTML (6 pages + a Cloudflare challenge page, fetched with curl 2026-10-24; prettier-ignored), recorded Nominatim responses, `booli_links.txt`. Parser tests assert every field of every page.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `fixtures/answer-key/`                          | Nyckeltal per test report (`<orgnr>.json`, 13 keys, all owner-verified as of 2026-10-10; "UTKAST" in `kalla.verifieradMot` would mark a draft). Pontonjären 3 has no key. `fixtures/property-input-example.json` is a sample `PropertyInput`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `annual reports examples/`                      | 14 real test PDFs (14 BRFs; only ~4–7 in Stockholms län, the rest Malmö/Helsingborg/Umeå etc.). Gitignored; never commit. `annual reports pdf as image example/` holds the two image-only reports; `SBC 2 årsredovnisng.pdf` is a raster scan; `test_rapport.pdf` has a garbled text layer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `docs/`                                         | `PLAN-v2.md` (v2 plan, archived; current plan is `/PLAN.md`), `HANDOFF-valuation-v3.2.md` (rejected experiment, history), `booli.md` (Booli page structure, blocking, earlier-sales endpoints), `api-test-log.md` (every paid API test run, running total), `api-runs/` (raw per-call records)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `.lovable/`                                     | Lovable-managed (`project.json`, two stale Swedish plans from September in `plan/`). Don't touch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Routes

- `/`: landing page.
- `/analysera` (since 2026-10-23 also the Priskoll; one shared form state):
  - **Steg 1: Priskoll** — the valuation without a PDF
    (`hamtaPrisuppskattningFn`), free, rate-limited. Fields: boarea, rum,
    avgift, postnummer, våning, byggår (opt.), utgångspris (opt.), hiss, balkong.
    "Spara" (account) and re-open via `?sparad=<id>`
    (`src/components/analysera/SparadVardering.tsx`: stored snapshot + "Räkna
    om med dagens modell"); `?spara=vardering` finishes a draft after login.
  - **Booli link** (above steg 1, 2026-10-24): "Klistra in länk från Booli" +
    "Hämta uppgifter" → `hamtaAnnonsFn`. Only fills the form: found fields get
    the hint "Hämtat från Booli" ("Ändrat manuellt" after an edit; a geocoded
    postcode says OpenStreetMap), missing+empty fields get "Fanns inte i
    annonsen, fyll i själv" and `Field framhav` (warning border). hiss/balkong
    only ever become "ja". It NEVER starts the Priskoll or an analysis. The
    source goes into `PropertyInput.kalla` (URL, broker link, förening, fetch
    time, `oandradeFalt`) on both analysis paths.
  - **Steg 2: Granska föreningen (valfritt)** — always visible; the PDF
    dropzone (or, with `?forening=<slug>` from a `/brf/$slug` CTA, "finns
    redan hos Binfo" via `skapaAnalysFranRegisterFn`: no PDF, no API call,
    loose quota only) plus adress and ort; everything else comes from step 1.
  - Required for the analysis: boarea, våning, avgift, rum, adress,
    postnummer, ort. Utgångspris optional (shared `valideraValfrittUtgangspris`:
    empty ok, invalid/0 = error; without it the report shows the "Binfos
    värdering" variant and the summary/PDF price rows are hidden).
  - Submits PDF + `PropertyInput` JSON as FormData to `skapaAnalysFn`.
  - On success it goes to `/forhandsvisning/$analysisId`, which polls
    `hamtaStatusFn` every 5 s (status carries `textlager`, `ateranvand`,
    `vantarPaRapport`, `rapportSteg` for the notices) and then renders the
    **full report** inline (`hamtaResultatFn` + `AnalysRapport`; the free
    preview/paywall was removed 2026-10-23; a future payment belongs on the
    `ladda_upp_analys` entitlement, before the run: `behorighet.ts`).
  - `/analys/$analysisId`: the same full report (bookmarks, /konto links);
    any error, including a refused entitlement, redirects to `/forhandsvisning`.
  - **"Spara analysen"** (2026-10-24, both report pages): `useSparaAnalys` +
    `SparaAnalysVy` (`src/components/konto/`), a small row under the grade card
    (`AnalysRapport`'s `sparaSlot`) and a card at the end. Server:
    `hamtaSparstatusFn` (`sparad` | `kan_sparas` | `ingen`),
    `forberedSparaAnalysFn`, `sparaAnalysFn` (`src/server/sparat.ts`). Same
    `SparaKnapp` flow as the Priskoll (`?spara=analys`, draft type `analys`);
    someone else's analysis shows nothing. No re-run, no API call.
- `/vardering`: 301 to `/analysera` (merged 2026-10-23), carrying `sparad`
  and `spara`.
- `/konto` (profile), `/konto/{logga-in,skapa,glomt-losenord,bekrafta,nytt-losenord}`:
  accounts (all `noindex`). `/konto/bekrafta` verifies only on a button press
  (mail scanners must not burn one-time tokens). `?till=` is sanitised.
- `/brf`, `/brf/omrade/$omrade`, `/brf/$slug`: the public register (BRF-level
  data only; cacheable; must never set cookies). `/brf/$slug` is a SUMMARY
  (owner 2026-10-23): name, fiscal year, grade, the nyckeltal that exist with
  their status, `BETYG_FORKLARING`; the server function returns nothing else
  from the analysis. Its link "Se hela analysen …" goes to
  `/brf/$slug/analys/$ar` (stored full BRF-level analysis, as stored;
  `hamtaRegisterAnalysFn`, resolves kontext, `no-store`, `noindex`), gated by
  the `se_registeranalys` entitlement (`behorighet.ts`; granted to all today —
  one policy line puts it behind an account or payment). `/sitemap.xml` is a server route.
- `/exempel`: static demo report (`AnalysRapport` over `sampleAnalysis`; the
  BRF name in the intro box is hard-coded in `src/routes/exempel.tsx`).
- `/bolanekalkyl`: calculator; all math in `src/lib/kalkyl/berakna.ts` (the
  route only renders). Search params `manadsavgift`, `rantekanslighet`, `pris`,
  `boarea`, `prisUppskattning` (read once at mount), plus `sparad`/`spara` for
  saved kalkyler. Inputs are sent to the server only on an explicit "Spara" by
  a logged-in user (owner decision 2026-10-12). PDF/Excel export buttons
  (`KalkylExport`, lazy, behind an SSR guard). Layout (owner 2026-10-14): the
  main view stays simple (pre-v3 layout + Boarea); rate scenarios, KALP (with
  its household/kalkylränta inputs) and the rules list live in one collapsed
  "Fördjupning" section (`data-slot="kalkyl-fordjupning"`), opened
  automatically when KALP inputs are non-default (`kalpArAndrad`).
  - One ränteavdrag computation (per person, limited by tax) for the total and
    "Tillbaka i deklarationen"; one home for the 50/70 % thresholds
    (`calc/amortering.ts`).
  - Drift schablons (`schabloner.ts`) and the 5× bank skuldkvot are still
    unverified placeholders, labelled "Schablon"/"Antagande" everywhere.
- `/kopguide`: Köpguide, the buying guide (checked steps in `useState` only).
  `/guide` is a 301 redirect to it (renamed 2026-10-23); nav label "Köpguide",
  running text "köpguiden".
- **SEO:** SSR on every route. Register pages have real-figure titles and
  descriptions, canonical, og:*, JSON-LD (Organization + BreadcrumbList);
  `/sitemap.xml`; `robots.txt` has a `Sitemap:` line; `public/og.png`
  (`scripts/genereraOgBild.mjs`). `/analys`, `/forhandsvisning`, `/konto*` are
  `noindex`. 404/error pages are Swedish.

## Where UI copy lives

- **Price section additions (2026-10-24b)**: second price row "Justerat för
  väntad avgiftshöjning", the collapsed "Så har vi räknat" `<details>` (part 1
  generic factor list, also on the Priskoll; the per-flat driver % rows were
  removed there 2026-10-24 (owner: "kaka på kaka"); part 2 fee rise; part 3
  refinancing inputs), the fee table in `Rantestress`, the closing
  "Sammanfattning" — all in `AnalysRapport.tsx`
  with text helpers in `src/lib/analysisView.ts`; component texts come from
  `avgiftsprognos.ts`, summary texts from `sammanfattning.ts`. PDF mirrors it.
- **Waiting screen** (`/forhandsvisning` while running): `Pagar` in
  `src/components/AnalysStatus.tsx` (heading "Din analys pågår", the time
  paragraph with a scan-only insert when `textlager === 'saknas'`, never for
  `'trasigt'`). Step texts and notices: `src/lib/analysStatusVy.ts`
  (`RAPPORTSTEG_TEXT`, `SKANNAD_UPPTACKT_TEXT`, …) and `STEG_TEXT` in
  `src/lib/analysStatusCopy.ts` (also all error copy).
- **Price check section**: `Prisrimlighet` in `src/components/AnalysRapport.tsx`
  is shared by the full report, `/exempel` and the Priskoll on `/analysera`. The source
  paragraph ("Modellen är tränad på … Svensk Mäklarstatistik. Områdesindelningen
  bygger på …") is `varderingsKallaText` (period via `formatDataperiodLang`,
  "januari–augusti 2026"); caveat/tier texts are also in
  `src/lib/analysisView.ts`.
- **Byggår vs the report**: no separate comparison section (removed
  2026-10-24, owner); `PropertySummary` shows a badge next to Byggår
  (Bekräftat / Avviker + "Årsredovisningen: X (du angav Y)" / Osäkert / Från
  årsredovisningen) from the `uppgiftsjamforelse` row `byggar`, logic in
  `byggarMarkor` (`analysisView.ts`), mirrored as a suffix in the PDF.
- **PDF export** builds its own view model in `src/components/pdf/viewModel.ts`
  (`metadataText`: n, typical error, model version; `kallaText` = the same
  source paragraph; no driver rows since 2026-10-24). Change web copy → check the PDF too.
- Priskoll (step 1) copy lives in `src/routes/analysera.tsx`.

## Valuation factor rows ("drivers")

- They are **not** derived from the LightGBM model. One OLS on log(kr/m²) over
  all training sales (`ml/train_valuation.py` `fit_ols` /
  `build_driver_effects`, driver list from `train_valuation_v3.py`) →
  `ml/artifacts/valuation-v3.1/effects.json` → `npm run build:vardering-data` →
  `src/lib/vardering/data/effects.data.ts`.
- `src/lib/vardering/drivare.ts` (`drivareForInput`, called from
  `prisdata.ts`) selects per apartment: only `signifikant`, never `=okant`, never
  `EXCLUDED_EFFECT_IDS` (`build_year+10`, owner 2026-10-08; `boarea+10`,
  owner 2026-10-12 — display only, the model keeps both); hiss/balkong only when the input says `nej` and tackning
  is `stockholm` (area-specific hiss effect when significant and not
  sign-contradicting). Effects are % of kr/m², one decimal.
- `balcony=nej` is not significant (n = 10 "nej" sales in training, 45 %
  `okant`; −2.65 %, 95 % CI −14.4 to +10.7), so no balcony row is shown; the
  selection would show "Ingen balkong" automatically if a future model makes it
  significant.
- The data period is a hard-coded constant `DATA_PERIOD` in
  `ml/train_valuation.py`, parsed by `scripts/buildVarderingData.ts` into the
  manifest/general-model `dataPeriod`; the UI formats it at render time
  (`formatDataperiodLang` on web/PDF, short `formatDataperiod` in server texts).
- Areas (`omrade`) are Binfo's own (`data/derived/postnummer_omrade.csv`);
  Vasastan and Norrmalm are one area, "Vasastan-Norrmalm".

## Example analysis (`/exempel`)

- `src/data/sampleAnalysis.ts` is a pasted snapshot of real CLI output, not
  regenerated automatically. Regenerated 2026-10-24 on PROMPT_VERSION 9 (fee
  prognosis frozen at that day, SSVX 2.068 %). Earlier example (2026-10-12): Brf Pontonjären 3 (716420-0599), årsredovisning 2025 (PDF in
  `annual reports examples/exemple_analysis_report/`, gitignored) + the owner's
  real listing Baltzar von Platens gata 6, 112 42 (Kungsholmen: best training
  coverage, 644 sales, CV MAPE 7.6 %). Valuation v3.1.
- Check the judging text against the PDF before accepting a run: the first
  2026-10-12 run wrote "nästan 90 %" where the report says 74 % and was
  rejected. Tests in `src/components/pdf/*.test.ts*` and
  `Prisrimlighet.test.tsx` assert the sample's content and must follow it.
- To regenerate: write `{ "input": PropertyInput }` (strict, unknown keys
  rejected), then
  `EXTRACT_SPARA_UNDERLAG=underlag.json ANTHROPIC_MODEL=claude-sonnet-5-5 npm run -s extract -- <pdf> input.json > out.json`
  (the saved underlag lets `node --import tsx scripts/monteraOm.ts underlag.json`
  re-assemble for free after any assembly change)
  (`-s` keeps npm's banner out of the JSON; Anthropic key only, no Supabase),
  paste as `export const sampleAnalysis: AnalysisResult = …`, update the BRF
  name in `src/routes/exempel.tsx`, log the spend.
- The price check alone can be recomputed offline and free with
  `byggPrisanalys(input, new ModellPrisdatakalla())`.

## Data flow of a full analysis (v3, deployed; v3 changes marked)

1. **`skapaAnalysFn` → `skapaAnalys`** (`src/server/analys.ts`, Worker). In order:
   1. `losKontext` (device cookie `binfo_enhet`, HMAC'd IP) — the single place
      Supabase Auth will plug in.
   2. Entitlement `ladda_upp_analys` (`behorighet.ts`, everything granted today).
   3. Validation: Zod `PropertyInput`, SHA-256, `%PDF`, ≤ 25 MB, kill switch.
   4. `extractPdfText` → `klassificeraTextlager`: `ok` | `saknas` (≥ 50 % of
      pages without text; scan path, ≤ 60 pages) | `trasigt` (garbled; normal
      path — measured better).
   5. Daily spend cap (read-only), skipped for a free register hash hit.
   6. Upload quotas: strict 5/device and 10/IP per day (refunded on exact hash
      hits) + loose 30/device and 100/IP per day (never refunded); IP only from
      `cf-connecting-ip`; `medPrincipal` → `principal_id`.
   7. Register lookup (`register.ts`): `rapport_fil` hash hit → instant reuse;
      else local identity (Luhn orgnr + fiscal year + matching BRF name) → reuse;
      else a new `rapport` (stage `identifiering`, or `grundning` if identified).
      Quota refunded when nothing new is paid for.
   8. Upload `<hash>.pdf` (private bucket `arsredovisningar`, kept indefinitely)
      and insert the per-user `analys` row linked to the `rapport`.
2. **pg_cron `binfo-tick`** (every minute, 3 POSTs) → `analys-steg` → `korNastaSteg`
   (`steg.ts`): claims a `rapport` (`claim_next_rapport_steg`, lease, ≤ 3
   attempts/stage; falls back to legacy `analys` rows), version guard on
   `pipeline_version`, advances one stage, writes only under its lease
   (`uppdateraLeasadRapport`), and reinvokes itself on success via
   `<PROJECT_URL>/functions/v1/analys-steg`
   (`supabase/functions/analys-steg/reinvoke.ts`; `req.url` is an internal
   address that refuses connections).
3. **Stages on `rapport`** (each reserves/reconciles daily spend):
   1. `identifiering`: Haiku 4.5 reads pages 1–3 → orgnr/year/name; a register
      hit marks this rapport `ersatt` and re-points its buyers (no spend after).
   2. `transkribering` (scans only): pdf-lib 5-page chunks, transcribed in
      parallel (Sonnet 5.5, ≤ 10k output tokens/chunk, 110 s deadline, at most
      3 chunks per invocation because of the 2 s CPU limit — then reinvoke),
      persisted per page in `sidtext` and reused across rapport rows of the
      same PDF while `TRANSKRIPTION_PROMPT_VERSION` is unchanged.
      Deterministic failures are terminal; hard ceiling 15 kr per report.
   3. `grundning`: citations over the PDF (`page_location`) or over the
      transcription (custom-content `content_block_location` → page map).
   4. `extraktion`: text-only call over the grounding findings (citations and
      structured output can't be combined, hence two calls); JSON, Zod, one
      blind retry; deterministic reconciliation
      (`tolkaNyckeltal` → `harledSkuldfriaNyckeltal` → `berikaNyckeltal` →
      `kontrolleraRimlighet`); scans tagged `kalla: 'skannad'`, konfidens ≤ medel.
      **v3:** `sidreferenser.ts` verifies every cited excerpt against the page
      text (pdf.js, or `sidtext` for scans; skipped for `trasigt`): wrong page →
      corrected, not found → `osaker` + question. Unverifiable addresses are
      dropped. `slutfor.ts` is the single post-model validator. v3 also extracts
      `forening.adresser`/`fastighetsbeteckningar` (cited) and, when a rapport
      is done, writes `forening_adress kalla='rapport'`, assigns the register
      area (`losRegisteromrade`) + slug, and refreshes `register_sammanfattning`.
   - **v9 (2026-10-24b):** also per-loan `lanebok.lan` (date, rate, rörlig by
     label or reset ≤ 3 months after `balansdag`; `forfalloprofil` is derived
     from it in code), `rantekostnader`, `bostadsrattsyta`, `balansdag`,
     maintenance amounts/fund/allocation, `sparandeUttag`, `lokaler`,
     `energiprojekt`. The grounding prompt lists the seven nyckeltal FIRST: the
     longer v9 prompt otherwise sometimes skipped the whole flerårsöversikt
     (Granen, Albohem; measured 2026-10-24). The judging input omits the
     per-loan rows.
   5. `bedomning`: judging over the extraction only (never sees buyer data;
      page refs must be a subset of the extraction's pages); result stored on
      the rapport; dry assembly. The prompt gets Binfo's own "Fasta värden"
      (`fastaVarden.ts`: the allowed letters, the seven nyckeltal, loan
      maturities with amounts and shares) and must not compute numbers itself.
      `kontrolleraBedomning` (slutfor.ts) clamps the grade to the band the
      status counts allow (`tillatnaBetyg`, owner 2026-10-23: 0 svag/0 kritisk
      → A–C, 1 svag → B–C, ≥ 2 svag → C, any `kritisk` → C–E), logging every
      clamp; `sakraMotivering` (motivering.ts) checks every number in
      `betygMotivering` against the extraction (`siffrorKontroll.ts`) and, on a
      clamp or a mismatch, makes ONE small rewrite call (letter fixed, effort
      low, stage `motivering`); still wrong or failed → a deterministic
      fallback motivation. Never fails the stage. Each question
      carries `varfor` (finding + number, shown "Varför:") and optional
      `svarssignal` ("Bra svar / varningssignal").
   - BRF-level (shareable) = `rapport.extraction` + `rapport.judgement`.
     Buyer-level (assembled per read) = `input`, `prisanalys`, `rantestress`,
     missing-data questions, the fee-deviation question.
   - `PIPELINE_VERSION` = `p<PROMPT_VERSION>.i<IDENTITET_PROMPT_VERSION>.s<SCHEMA_MAJOR>`
     (production since 2026-10-14: `p7.i1.s1`; `main`: `p8.i1.s1`). v3 adds `rapport.proveniens`
     (`api` default). Each stage has pure `bygg*Request`/`tolka*Svar` (golden
     tests pin the request bodies).
4. **Reads** re-assemble on every read from the rapport's extraction/judgement +
   the buyer's `property_input`; only results that parse with the current
   schemas are served (older compatible versions exactly as stored, grade
   included, with a note). **Reads never re-run anything** (owner 2026-10-23:
   API money only on a user's request). A re-run on the current version is
   queued only by an upload (`skapaAnalys`) or a register request
   (`skapaAnalysFranRegister`) when the report exists only at an older
   version — behind the spend cap and the strict quota; once done, every
   reader of that report (same orgnr + year or same bytes) gets the new one.
   **2026-10-24b:** assembly also computes `avgiftsprognos` with TODAY's
   reference rate (passed from `hamtaResultatFn`; fallback in config), the
   adjusted price (`prisanalys.justeringar/justeradVardering`), the fee table,
   `uppgiftsjamforelse` and `sammanfattning`, and drops model text claiming
   byggår is missing when it is known. Old extractions get a degraded
   prognosis (maturity year only → 1 July).
   The valuation uses only the buyer's input; the full analysis adds the
   apartment's debt share (`skuldsättning/m² bostadsrättsyta × boarea`) as a
   comment, never applied to the valuation.
5. **Retention** (`binfo-retention`, daily; owned by `20261024120000_annons.sql`
   since 2026-10-24, before that by the konto migration): blanks
   `adress`/`postnummer`/`orgnr` and drops `kalla` in `property_input` after 12 months (owner
   decision 2026-10-10; the register, PDFs and BRF analysis are never touched) and purges
   quota rows and `annons_cache` rows after 2 days. PDFs are kept (register). Production already runs
   the 12-month anonymisation via the hotfix `20261008000000` (applied 2026-10-10).

Measured 2026-10-09 (`claude-sonnet-5-5`, effort `medium`, API time; production
adds ~10 s per stage for reinvokes):

| Report                                      | API time                                                              | Cost                                                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Text report                                 | 51–81 s API; 77 s upload→done on a local Supabase stack (cron + Deno) | 1.98–3.82 kr, mean 3.2 (n=8). ~120k in / ~12k out tokens; grounding ≈ 62 % (native PDF ≈ 4k tokens/page) |
| Scanned report (16–34 pages)                | 80–113 s API; 185 s upload→done locally (34 p)                        | 4.1–6.5 kr (transcription ≈ 0.105 kr/page)                                                               |
| Register hit (same file or same BRF + year) | < 1 s                                                                 | 0 kr                                                                                                     |
| Identity call (scans/ambiguous)             | ~2 s                                                                  | ~0.05 kr                                                                                                 |

Prompt caching is implemented but OFF by default (an isolated report costs
slightly more with it; see PLAN-v2 §5); `ANTHROPIC_PROMPT_CACHE=system` for bursts.
`costGuard.ts` prices: Sonnet 5/5.5 $2/$10, Haiku 4.5 $1/$5 per MTok, cache read
0.1× (Anthropic's docs say 0.05× for Sonnet 5.5: conservative), USD→SEK 9.7
(unverified placeholder). The Message Batches API (50 % off, supports PDFs,
citations and effort) is not used anywhere yet.

## Database (Supabase, see `SUPABASE.md`)

- **Base** (init migrations + retention hotfix): `analys` (job rows), `extraktion_cache` /
  `analys_cache` (PK `(pdf_hash, model, prompt_version)`), `spend_day`.
- **v2 migrations (in production):**
  - register: `forening`, `rapport` (shared, versioned job + result; partial
    unique on `(orgnr, rakenskapsar, pipeline_version)` and on
    `(pdf_hash, pipeline_version)` = the concurrency locks), `rapport_fil`,
    `sidtext`, `forening_adress`, `analys.rapport_id`, RPCs
    `claim_next_rapport_steg` etc.
  - konto: `principal`, `behorighet` (empty), `kvot` + `ta_kvot`,
    `analys.principal_id`, `radera_principal`, final `binfo-retention`.
- **v3 migrations (applied in production 2026-10-14; locally `verify-rls` 97/97):**
  - konto_v3: `sparad_vardering`, `sparad_kalkyl`, `sakerstall_konto_principal`,
    `lista_mina_analyser`, `radera_min_analys`; merge + erasure cover saved items.
  - register_v3: `rapport.proveniens`, `forening.slug/registeromrade/omrade_kalla`,
    `forening_slug` (renamed-slug history), `pg_trgm` index on `namn`,
    `register_sammanfattning` (one row per BRF, maintained by
    `uppdatera_register_sammanfattning`), `satt_forening_omrade`.
- **Reference-rate migration (2026-10-24b, NOT applied in production yet):**
  `20261025120000_referensranta.sql`: `referensranta` (serie pk, datum,
  procent, hamtad; RLS on, zero policies), on `KontoDatabas`
  (`lasReferensranta`/`skrivReferensranta`). Rollback in `supabase/rollback/`.
  Without the table the read falls back to the configured rate.
- **Booli migration (2026-10-24, NOT applied in production yet):**
  `20261024120000_annons.sql`: `annons_cache` (url pk, svar jsonb, hamtad; RLS
  on, zero policies) and the redefined `binfo-retention` (see Retention).
  Rollback in `supabase/rollback/`. Applied and checked on the local stack.
- **Access:** RLS on with zero policies; functions `security invoker`. The v2
  functions are execute-only for `service_role`; the init-migration functions
  were never revoked from `anon` (RLS still blocks them). The browser has no
  Supabase client; every read/write goes through server functions with the
  secret key.
- **Identity (v3):** Supabase Auth, server-side only (httpOnly `binfo_sa`/
  `binfo_sr` cookies; `losKontext` validates/refreshes and maps the auth user
  to a `typ='konto'` principal; the device's anonymous principal is merged once
  on first login; logout rotates `binfo_enhet`). Without
  `PROJECT_PUBLISHABLE_KEY`, everything behaves anonymously as before. Password
  change needs a 15-min signed reset marker (`binfo_aterst`) or the current
  password; account deletion needs the password. A logged-out analysis is
  saved to the account either by the password-login merge, or (new account
  confirmed by e-mail link, which does not merge and rotates `binfo_enhet`) by
  a 7-day HMAC-signed marker `binfo_spara` {analysisId, device principal} set
  on "Spara analysen" after a device-ownership check, then a compare-and-set
  move of that one `analys` row (`flyttaAnalys`); cleared on save/logout. Saved items are filtered by
  principal in one helper (`kravAgare`). The UUID `analysisId` is still the
  read capability for analyses. Local Auth config + Swedish templates:
  `supabase/config.toml`, `docs/epostmallar/`; hosted setup: `docs/auth-setup.md`.
- **Register location data (v3):** `forening_adress` has `kalla='rapport'`
  (from the report) and `'anvandare'` (buyer postnummer); the register area is
  decided rapport address > buyer postnummer (`register.ts`).
- **Cron jobs:** `binfo-tick`, `binfo-reaper`, `binfo-retention`,
  `binfo-keep-alive`. Vault holds `project_url` and `automations_key`.
- **Valuation coverage** (`src/lib/vardering/tackning.ts`, model v3.1, card
  `ml/artifacts/valuation-v3.1/` + `valuation-v3/`): Stockholms kommun → area model (CV MAPE
  9.6 %); rest of the län → general relationships × the kommun's 12-month
  average kr/m²; outside the län → × the national average with a disclaimer
  first. Confidence never 'hog'; outside Stockholms kommun always 'lag'.
  Training data has a monthly fee but **no BRF identity and no BRF debt**.
- **Areas** (`data/derived/postnummer_omrade.csv`, built by
  `ml/mapping/build_postnummer_omrade.py` from Stockholms stad's 117 stadsdel
  polygons via `stadsdel_omrade_crosswalk.csv` + OSM/GeoNames points): 13 areas:
  Östermalm, Vasastan-Norrmalm, Södermalm, Hägersten-Liljeholmen,
  Enskede-Skarpnäck, Bromma-Västerled, Kungsholmen, Farsta-Vantör,
  Hässelby-Vällingby, Spånga-Kista, Brännkyrka-Skärholmen, Essingen, Centrala
  Stockholm (= Gamla stan, Riddarholmen, Skeppsholmen only). They are model
  features: renaming them means retraining. 182 Stockholm postnummer have no
  area (e.g. 105xx/106xx box ranges, Kista 164xx, Sjöstad 123xx) and get the
  "Okänt" category. The OSM-derived map's ODbL share-alike status is unresolved.
- **Postcode effect (v3.1, owner decision 2026-10-10):** a postnummer is shrunk
  toward its 4-digit neighbourhood (k=5, k_group=5); a postnummer with no
  training sale takes its neighbourhood's effect (replaces the 2026-10-07
  "unseen postcodes: do nothing special"). A residual-based effect (v3.2) was
  tested and rejected (worse CV, unstable on sparse postnummer).

## Commands

```
npm install
npm run dev                 # localhost:8080
npm run build               # vite build (Cloudflare Worker output in .output/)
npm run lint                # eslint . (baseline: 0 errors, 8 react-refresh warnings)
npm run typecheck           # tsc --noEmit (covers src/ + configs only; not scripts/ or supabase/functions/)
npm test                    # vitest run (2026-10-24b: 136 files, ~2810 tests, all passing)
npm run format              # prettier --write . (printWidth 100)
npm run preview | build:dev # vite preview / development-mode build
npm run extract -- <pdf> [input.json]      # pipeline standalone incl. scans (REAL spend)
npm run verify-extraction -- <dir>         # score against fixtures/answer-key (+ answer-key-lan); spend; VERIFY_FROM_RESULTS=<dir> = free; VERIFY_ONLY=<orgnr,…> limits the reports
npm run analys -- <pdf> <input.json>       # LIVE Supabase job + spend
npm run register -- list|inspect|invalidate|backfill-legacy|rerun   # LIVE register admin
npm run konto -- radera|exportera <principalId>                     # LIVE GDPR erasure/export
npm run verify-rls                         # LIVE: RLS with secret vs publishable key
npm run build:edge / deploy:edge           # bundle / deploy analys-steg (deploy needs owner OK)
npm run build:vardering-data               # regenerate src/lib/vardering/data from ml artifacts
npm run build:register-data                # regenerate src/lib/register/data from data/derived/postnummer_stadsdel.csv
node --import tsx scripts/hamtaBooliFixtures.ts [--spara]   # re-fetch the Booli fixtures with curl (6 live requests), print per-field status; --spara overwrites them
node --import tsx scripts/seedLokaltRegister.ts   # LOCAL stack only: seed /brf with test BRFs (refuses non-local PROJECT_URL)
./scripts/v2-lokalt.sh [--nollstall]      # whole app on a LOCAL Supabase stack (Docker): db, cron, Edge Function, dev server; real Claude cost
cd ml && .venv/bin/pytest                  # ML tests
```

- **Sandbox:** `npx tsx` fails with EPERM on its IPC pipe inside the Claude Code
  sandbox; use `node --import tsx <file.ts>`. `.env.local` is invisible in the
  sandbox. `.env.local` sets `ANTHROPIC_MODEL=claude-sonnet-5`, which overrides
  the code default — set `ANTHROPIC_MODEL=claude-sonnet-5-5` for measurements.
- **Dev check:** after touching `analysFn.ts`, run `npm run dev` and open a page
  in a browser — import-protection errors only show there, not in `npm run build`.
- **Workerd:** `npm run build`, then `npx wrangler dev` (not a dependency;
  fetched ad hoc) with a temporary `.dev.vars` in `.output/server`, to catch
  Worker-only bundling bugs. Run it as `npx wrangler dev --config wrangler.json
--compatibility-date <a date the cached workerd supports>` from
  `.output/server` (the build stamps today's date, which a cached workerd may
  not know, and a stray `.wrangler/deploy/config.json` confuses it otherwise).
  Point `.dev.vars` at the LOCAL stack only, and delete it afterwards.
- **Booli and Node:** Booli's Cloudflare challenges Node's `fetch` (undici TLS
  fingerprint) even with browser headers, so `npm run dev` (Node) can't fetch
  listings. curl (with the header ORDER in `scripts/hamtaBooliFixtures.ts`) and
  workerd (`wrangler dev`) get the real page. Test the prefill end to end on
  the built Worker. Production (Cloudflare egress) is still unverified.
- **Migrations:** no npm script. Local: `supabase db reset --local` (used by
  `v2-lokalt.sh`). Production: `npx supabase@2.117.0 db push` (owner OK only).
- **Lockfiles:** `bun.lock` + `bunfig.toml` belong to Lovable (its bot commits
  them); `package-lock.json` is the local npm lockfile and is load-bearing:
  `edge/build.ts` pins the Deno `npm:` specifiers from it. Keep both in sync
  when adding a dependency (`npm install` locally; Lovable updates `bun.lock`).

## Environment variables (names only; values live in `.env.local`, Lovable Secrets or Supabase secrets)

- **Web app** (every server function, even the Priskoll, needs the full env):
  - `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (code default `claude-sonnet-5-5`),
    `MAX_COST_PER_ANALYSIS_SEK` (default 5; the `extract` CLI uses 25 for scans).
  - `PROJECT_URL`, `PROJECT_SECRET_KEY`, `PROJECT_PUBLISHABLE_KEY`,
    `MAX_DAILY_SPEND_SEK`, `ANALYSIS_KILL_SWITCH` (`on`/off).
  - Optional `ANTHROPIC_EFFORT_GROUNDING|EXTRACTION|JUDGING` (default `medium`;
    transcription uses the grounding effort).
  - `PROJECT_SECRET_KEY` also derives the IP-hash key (`binfo-ip-v1`).
  - Optional `ANNONS_HAMTNING` (`off` = Booli prefill kill switch; default on)
    and `ANNONS_LLM_FALLBACK` (`on` = Haiku fallback when parsing fails; default
    off). Web app only.
- **Edge Function:** the same, minus `ANTHROPIC_MODEL` (the model comes from the
  job row), plus `AUTOMATIONS_KEY`. These live in **Supabase** secrets, separate
  from Lovable's: rotating `ANTHROPIC_API_KEY` means updating `.env.local`,
  Lovable Secrets AND Supabase Edge Function secrets (2026-10-13 incident:
  only two were updated, so every new analysis failed at `grundning`).
- **CLI/dev only:** `SUPABASE_ACCESS_TOKEN` (Supabase CLI only),
  `ANTHROPIC_PROMPT_CACHE` (`off`/`system`/`on`), `ANTHROPIC_EFFORT` (generic
  fallback), `ANTHROPIC_EFFORT_TRANSKRIBERING`, `PRISKALLA`
  (`modell`/`tom`/`demo`), `VERIFY_FROM_RESULTS`, `TRANSKRIPTION_CACHE`.
- `.env.example` is stale: it lacks `AUTOMATIONS_KEY`, the effort vars and
  `ANTHROPIC_PROMPT_CACHE`, and sets `ANTHROPIC_MODEL=claude-sonnet-5`.
- **Naming:** Supabase vars are named `PROJECT_*` because Lovable and Supabase
  both refuse secret names starting with `SUPABASE_`.
- Validated in `src/server/env.ts`, and inline in `analys-steg/index.ts`.
- Never `VITE_`-prefix a secret. `env.ts` throws if one is present.

## Domain rules (current as of October 2026; trust this over training data)

- **Amortisation** (since 1 April 2026): loan-to-value only. Source: Lag
  (2026:226) om begränsning av bostadskrediter §7 (a statute; FI's FFFS 2016:16,
  2016:33 and 2020:3 ceased 2026-03-31). Verified 2026-10-12.
  - LTV > 70 % → 2 %/yr; > 50 % up to and incl. 70 % → 1 %/yr; ≤ 50 % → none.
    The percentage applies to the highest credit amount since the last
    valuation. Nyproduktion: the lender may waive it for up to 5 years for the
    first buyer (§10).
  - The skärpta amorteringskravet is abolished.
  - Bolånetak 90 % (min. 10 % deposit) at purchase (§4); 80 % for an increased
    loan (§5).
  - Skuldkvot is shown as information only and never drives the amortisation
    rate. There is no statutory income cap; banks apply their own (secondary
    sources say ~5–6×).
- **Ränteavdrag** (Skatteverket, inkomstår 2026): 30 % on interest up to SEK
  100 000 per person per year, 21 % above. The cap is per person, so the number
  of borrowers matters. From 2026, unsecured loans get no deduction (mortgages
  unaffected).
- **KALP** (v3, `src/lib/kalkyl/levnadskostnader.ts`): Konsumentverket
  "Hushållskostnader 2026" living costs; kalkylränta 7 % is an editable
  assumption (bank kalkylräntor are neither public nor regulated). No double
  counting: Konsumentverket's household costs already include hushållsel,
  vatten, internet and hemförsäkring, so only värme comes from Binfo's drift
  schablons. Verdict = sign + amount, no threshold words.
- **Rules registry** (`src/lib/kalkyl/regler.ts`) is the single source for every
  calculator rule, shown in the UI, PDF and Excel with source and date. Change a
  rule there, bump `REGELVERSION`, and the Excel parity test must still pass.
- **Seven statutory nyckeltal** (BFNAR 2023:1, from FY2023). Extraction must
  produce all seven:
  - årsavgift/m² bostadsrättsyta
  - årsavgifternas andel av rörelseintäkter
  - skuldsättning/m² totalyta
  - skuldsättning/m² bostadsrättsyta
  - sparande/m² totalyta
  - räntekänslighet
  - energikostnad/m² totalyta

  In the text reports seen so far they sit on 1–2 pages (förvaltningsberättelse
  / flerårsöversikt).

- **Räntekänslighet** (interest-bearing debt ÷ annual fee income) states how
  many percent fees rise per percentage point of rate increase. The rate stress
  uses it directly; there is no separate model.
- Lagfart/pantbrev: houses only. Board approval of membership: bostadsrätter only.
- Nyckeltal thresholds are product decisions in `BENCHMARKS.md`, mirrored in
  `benchmarks.ts`. Negative sparande is graded svag, not kritisk.
- A debt-per-m² figure with an unclear basis (e.g. "Lån per kvm bostadsyta") is
  reported as skuldsättning per m² bostadsrättsyta. A number beats none here.
- **Debt-free association:** if the report shows no interest-bearing debt, cited,
  then räntekänslighet and both skuldsättning/m² = 0 (`source: 'berakning'`),
  not "missing".
- **Apartment's debt share** (full analysis only, owner decision 2026-10-09):
  skuldsättning per m² bostadsrättsyta × boarea, shown as a comment beside the
  valuation, never subtracted from it. No andelstal, no debt in the model.
- **Missing räntekänslighet:** a genuinely missing value never fails the
  analysis. Only the rate stress is disabled (`rantekanslighetProcent: null`),
  and the gap becomes a question for the visning. The `saknar_rantekanslighet`
  error code remains only for old failed jobs.
- Never present a statistical association as causation. An effect whose sign
  contradicts the obvious direction (e.g. "no lift" raising price) is replaced
  by the broader estimate or omitted.

## Conventions

- All user-facing text is in Swedish. Code, comments, identifiers and commits are
  in English. Many older pipeline/server comments are in Swedish; match the
  surrounding file.
- **Unknown ≠ false.** Use `Tristate = 'ja' | 'nej' | 'okant'`, never
  `boolean | null`.
- **Estimates are labelled.** `source: 'schablon'` renders distinct from
  `'arsredovisning'` / `'anvandare'`. A guess must never look like a fact.
- **Every extracted figure carries its page reference.** No citation, no display.
  Page numbers must come from the API (citations), never be self-reported by
  the model. For scans the citation points into Binfo's own transcription
  (block → page map), and those figures are tagged `kalla: 'skannad'`.
- SEK as integers; areas in m² with one decimal.
- **Never invent domain numbers** (thresholds, benchmarks, schablons). Cite a
  source or mark `// TODO: unverified placeholder`.
- **Model output is untrusted.** Zod-validate everything. Handle scanned PDFs,
  missing figures and malformed responses explicitly. A silent empty analysis is
  the worst failure; a visible failure is fine.
- **`PROMPT_VERSION`** (`prompts.ts`) is part of the cache key. Bump it whenever
  any prompt text changes (`prompts.test.ts` enforces this). A bump requires
  deploying the web app and the Edge Function close together, otherwise
  in-flight jobs fail with `versionskonflikt`.
- **Tests first** for anything with a correct answer (extraction, calculators,
  valuation).
- Before claiming done, run `npm run typecheck`, `npm test` and `npm run lint`
  (and `npm run dev` for UI), and report the real output.
- Every paid API run is logged in `docs/api-test-log.md`.
- Ask when a spec or domain rule is ambiguous; don't guess.

## Gotchas

- **`analysFn.ts` must have no module-scope values.** Its handler bodies are
  stripped from the client bundle, its top level is not: a module-level
  `const x = serverThing()` keeps a server-only import in the client graph and
  `npm run dev` shows an import-denied overlay (the build still passes).
- **Edge glue duplication.** `supabase/functions/analys-steg/index.ts` mirrors
  `Env`/`Databas`/row mapping by hand (Deno has no `@/` alias). Every new
  `Databas` method used by `steg.ts` goes into `index.ts`, `supabase.ts` and
  `__fakes__/lager.ts`; a test enforces that the Edge glue has every method.
- **Worker writes are leased.** Stage results go through
  `uppdateraLeasadRapport` (only while `running` under the claimed lease), so a
  slow worker never resurrects an invalidated/reaped rapport.
- **Edge limits.** Free plan: 150 s wall clock, 2 s CPU per invocation → one
  stage per invocation; transcription runs its chunks in parallel inside one
  (measured ≤ 30 s). A cut-off invocation holds its lease for 300 s.
- **pdf.js detaches buffers.** Always pass `bytes.slice()` to `extractPdfText`.
- **`PROMPT_VERSION` is part of `pipeline_version`**; the model is not. A model
  switch keeps serving existing results; a `PROMPT_VERSION` bump marks stored
  results as older (served as stored with a note; re-run only when a user
  uploads or requests that report). Deploy the web app and the Edge Function
  together.
- **Deploy order for v2** (see SUPABASE.md): kill switch on → drain → `db push`
  (register, then konto) → `deploy:edge` → Lovable publish →
  `register -- backfill-legacy` (dry-run, then real) → kill switch off.
- **Lovable publish = production deploy of the web app.** When code on `main`
  needs a new migration or Edge Function version, apply those first (`db push`,
  `deploy:edge`), then publish; a `PROMPT_VERSION` bump needs both sides
  deployed close together.
- **Lovable formats differently.** Its editor reflows code wider than the
  repo's prettier (printWidth 100), so `npm run lint` shows prettier errors
  after a Lovable edit. Fix with `npx eslint --fix <files>` in a separate
  commit, and only when Lovable isn't editing those files.
- **Permissions (`.claude/settings.json`):** deploys (`deploy:edge`, `npx supabase@… db push|functions deploy|link`) and the live CLIs (`analys`, `register`, `konto`) are in the "ask" list (tightened 2026-10-13). The paid but local `extract`/`verify-extraction` stay allowed (budget-governed).
- **Local UI without a backend.** There is no mock mode. Every server function
  needs the server env (`PROJECT_URL` etc.); without it `/forhandsvisning/<id>`
  falls back to "hittades inte". `.env.local` points at **production**, so
  `npm run dev` with it hits the real project: never create analyses that way.
  To see the waiting screens either use `./scripts/v2-lokalt.sh` (Docker, local
  Supabase; overrides every `PROJECT_*` var with local values) or
  render `Pagar` with fake props in a test.
- **Lazy client-only libraries** (`@react-pdf`, `exceljs`): reach them only via
  a dynamic `import()` guarded by `if (import.meta.env.SSR) return;` in the
  click handler. Without the guard they land in the Worker bundle (v3 measured
  2.71 → 1.70 MB gzipped with it; Cloudflare's free-plan limit is 3 MB).
- **Cacheable public pages must not set cookies.** `/brf*` and `/sitemap.xml`
  send `Cache-Control: public, s-maxage=…`; their server functions skip
  `losKontext` on purpose. Never call a session/kontext function from their
  loaders.
- **Dev server ports.** The wrapper defaults to 8080, but `npx vite dev --port
<n>` works; parallel agents should use their own port.
- **Slow checks.** Cold `npm test`, `npm run lint` and `npm run typecheck` each
  take 1–2+ minutes; use a long timeout or run them in the background.
- **Playwright** is not a project dependency; Chromium builds are cached in
  `~/Library/Caches/ms-playwright` (pass `executablePath` to the cached
  `chromium_headless_shell-*/…/chrome-headless-shell` if a newer playwright
  package expects a build that isn't downloaded).

## Known limitations (October 2026)

- **v2 is deployed** (production register live since 2026-10-10; the docs said
  otherwise until 2026-10-13).
- **Production retention was failing** (direct `delete from storage.objects`
  refused by Storage, rolling back the anonymisation). Hotfix
  `20261008000000_retention_fix.sql` (12 months, no PDF deletion) was applied to
  production on 2026-10-10 via `main`.
- Scans over 60 pages are refused (product limit, owner decision 2026-10-10).
- PDFs, the register and BRF analyses are kept (not buyer data). Only the
  buyer's address/postnummer/orgnr are anonymised, after 12 months (owner,
  2026-10-10). The privacy text still needs a stated basis for keeping PDFs
  that name board members (public documents). Delete PDFs via the Storage API, never
  with SQL (Storage refuses direct deletes).
- Accounts are live (v3, 2026-10-14). Entitlements still grant everything.
  No MFA. Pages that need login check it client-side after hydration (SSR shows
  "Laddar…"). The public register is filled only by user uploads (bulk
  pre-population cut, owner 2026-10-13). No contact address exists for "Hittar
  du ett fel?" on BRF pages (owner to supply).
- **Recent-analyses storage is still active (open question, owner 2026-10-23).**
  The "Dina senaste analyser" box on `/analysera` is hidden by
  `VISA_SENASTE_ANALYSER = false` (`src/routes/analysera.tsx`), but `sparaAnalys`
  still writes every created/opened analysis id + BRF name to the browser's
  localStorage (`binfo:senaste-analyser`, `src/lib/senasteAnalyser.ts`). It is
  per browser, not per IP (the server links anonymous analyses to the
  `binfo_enhet` device principal; hashed IPs are only used for quotas, purged
  after 2 days). Whether to keep, replace or remove this storage is undecided.
  Account history (`/konto` → Analyser) is unaffected.
- Volontären `antalLokaler` is still missed (1 vs null), pre-existing.
- Every 5 s status poll reads `rapport` rows with `select *` (large jsonb) and
  Zod-parses the stored result; fine at today's volume.
- Dead code kept for now: `arRetrybar`, `slappRapportSteg`/`slapp_rapport_steg`,
  `raderaAnalys` (no caller), `analys.lan_underlag`/`grundtext`.
- Docs drift: SUPABASE.md still has some pre-v2 facts (30-day retention, 80 %
  scan threshold, 12k transcription tokens); PIPELINE.md's cost paragraph is
  from September. The code wins.
- Accessibility gaps in the kit: `Toggle` has no `aria-pressed`; `Field` has
  no `autocomplete`/`name` (password managers get no hints). `Field` got
  `aria-invalid`/`aria-describedby` in v3.
- Mobile nav: `SiteNav` is a flat wrapping row (three rows at 390 px with the
  account and register links); a mobile menu is on the Lovable list.
- The xlsx export has no cached formula values (`fullCalcOnLoad`): Excel and
  Numbers compute on open (verified in Excel), but Quick Look shows empty cells.

## Workstreams

v3 (accounts, register, calculator, exports, pipeline v7): `docs/PLAN-v3.md`.
v2 (all done, see `docs/PLAN-v2.md`):

1. **Scanned reports — done** (code). Transcription → citable grounding,
   sanity checks, scan notice and "osäker" markers in the UI.
2. **Separate price estimate — done.** `/vardering` + `price_estimate` service;
   full analysis adds the debt-share comment line (owner decision: no debt in
   the model, no andelstal).
3. **Register — done.** orgnr + fiscal year,
   hash pre-check, cheap identity stage, versioned re-runs (on user request only since 2026-10-23), admin CLI.
4. **Account-ready infrastructure — done.** Device principal, entitlement
   layer, quotas, GDPR CLI (Supabase Auth added in v3).
5. **Prompt caching — measured; off by default** (no net saving per isolated
   report; the register removes repeat cost).

## Visual boundary

Do NOT change visual design unless the owner explicitly asks. That covers
styling, layout, colours, typography, spacing, animations, images, and the
components in `@/components/ui/binfo`. When a feature needs new UI, build it
functionally from existing components and patterns with minimal new styling,
and add it to a "For Lovable to polish" list reported at the end. Exception: the
PDF export layout is ours to design, kept simple and consistent with the site.

Owner-hidden elements are kept in the DOM with `hidden`: the valuation
provider line and the valuation range (the drivers caveat went with the driver
rows, 2026-10-24). Do not unhide them.

## Lovable sync workflow

The frontend is also edited in Lovable, which pushes to `main` on GitHub.

- `git pull` before starting work; push when done.
- Never edit the same files in Lovable and Claude Code at the same time.
- Don't rename, move or restructure frontend files beyond what a task needs.
- Never rewrite pushed history (no force push, no amend or rebase of pushed
  commits).
- Publishing in Lovable is a manual UI step by the owner.

## Working model (supervisor + subagents)

- **The main session is supervisor.** It owns plan, order, decisions,
  integration, commits and checkpoints. The working plan lives in
  `PLAN.md` (status) and `.claude/working-plan.md` (gitignored notes).
  Keep both updated so they survive compaction.
- **Subagents** (definitions in `.claude/agents/`: `codebase-explorer`,
  `data-and-model`, `frontend-state`, `pdf-pipeline`, `reviewer`; run on Sonnet) get
  self-contained briefs. They:
  - never edit overlapping files concurrently;
  - never commit;
  - never run `git stash`/`checkout`/`reset` on the shared tree;
  - never change shared contracts (report back instead);
  - stop rather than guess.
- The supervisor reviews every diff and re-runs the checks before accepting it.
- **Deploys** (`supabase db push`, `deploy:edge`) and pushes to `main` need the
  owner's explicit OK.

## Don't touch

- `AGENTS.md` and `.lovable/` (Lovable-managed); `src/routeTree.gen.ts`.
- Applied migrations in `supabase/migrations/`. Add a new migration instead.
- `.env*` files and lockfiles by hand. Never commit secrets.
- **The server boundary.** `src/server/` and `src/lib/vardering` are
  client-forbidden, via `importProtection` in `vite.config.ts` and
  `no-restricted-imports` in `eslint.config.js`. Both carve out
  `src/server/analysFn.ts` and nothing else; never widen either. Nothing outside
  `src/server/` imports from it except through `analysFn.ts`.
- **`src/types/analysis.ts`.** Changing it breaks both sides at once, so stop and
  flag before editing. Never widen `Forhandsvisning`.

## Reference docs

- `SUPABASE.md`: schema, job orchestration, live verification. Partly stale on
  retention and bundling.
- `PIPELINE.md`: pipeline design rationale.
- `BENCHMARKS.md`: nyckeltal thresholds.
- `ml/artifacts/valuation-v3.1/MODEL_CARD.md` (delta) + `ml/artifacts/valuation-v3/MODEL_CARD.md`: valuation model.
- `ml/REGIONAL_DESIGN.md`: regional design.

When a reference doc and the code disagree, the code wins. Fix the doc.
