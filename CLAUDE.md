# Binfo

Independent buyer-side decision support for Swedish bostadsrätter
(https://binfo.slanesens.com). A buyer uploads the BRF's årsredovisning and gets
a BRF analysis (the seven statutory nyckeltal, flags, questions for the
styrelse), a price check, a bolånekalkyl and a köpguide. Competitors (Lusa, AI
BRF, Allabrf) already grade the *cooperative*; Binfo's point is grading the
*transaction* — price, per-apartment cost in kronor, what to do before bidding.

## Stack

- Vite + React 19 + TypeScript (strict, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`), TanStack Start/Router (file routes), TanStack
  Query, Tailwind 4. **Not Next.js** — no app router, `/pages`, `server-only`.
- `vite.config.ts` is a thin wrapper around `@lovable.dev/vite-tanstack-config`
  (Lovable-owned). `vitest.config.ts` is deliberately separate from it.
- Node 22 (`.nvmrc`). Dev server is always `localhost:8080` (forced by the wrapper).
- Backend: Supabase (Postgres + pg_cron + one Edge Function) and the Anthropic
  API via `@anthropic-ai/sdk`. Zod v3 (pinned deliberately). PDF text via `unpdf`.

## Directory map

| Path | Contents |
|---|---|
| `src/routes/` | File routes. `routeTree.gen.ts` is generated — never edit it. |
| `src/components/` | `AnalysRapport`, `AnalysStatus` (polling/wait/error states), `PropertySummary`, `SiteNav` |
| `src/components/ui/binfo.tsx` | Binfo UI kit (Card, Button, Field, Badge, TristateChoice, …). Other `ui/*.tsx` are shadcn primitives. |
| `src/lib/` | Client-safe helpers: `uppgifter.ts` (module-level store via `useSyncExternalStore`, shared across routes, in-memory only), `bolanekalkyl.ts`, `skatt2026.ts`, `analysisView.ts`, `analysStatusCopy.ts`, `propertyType.ts` |
| `src/lib/analysis/` | Extraction + analysis pipeline, `calc/` (pure calculators), `benchmarks.ts`, `prisdata.ts` (price source) |
| `src/server/` | Server-only: job state machine (`steg.ts`), caches, spend guard, env, Supabase access. `analysFn.ts` is the only client-importable file. |
| `src/types/analysis.ts` | **The contract** for an analysis result, shared by client and server |
| `src/data/` | `sampleAnalysis.ts` (static demo on `/exempel`), `mockData.ts` (calculator defaults), `schabloner.ts` (cost schablons) |
| `supabase/` | SQL migrations and the Edge Function `analys-steg` |
| `fixtures/answer-key/` | Hand-verified nyckeltal per test report |
| `annual reports examples/` | Real test PDFs — gitignored, never commit |

## Routes

`/` landing · `/analysera` upload form → `skapaAnalysFn` → `/forhandsvisning/$analysisId`
(polls status, free preview) → `/analys/$analysisId` (full report; loader calls
`hamtaResultatFn`, redirects to the preview until the job is done) · `/exempel`
static demo report · `/bolanekalkyl` client-only calculator (optional
`?manadsavgift=`/`?rantekanslighet=` prefill) · `/guide` buying guide.

## Commands

```
npm install
npm run dev                 # localhost:8080
npm run build               # vite build
npm run lint                # eslint .
npm run typecheck           # tsc --noEmit
npm test                    # vitest run
npm run extract -- <pdf> [input.json]      # run the pipeline standalone (real Anthropic spend)
npm run verify-extraction -- <dir>         # score extraction against fixtures/answer-key
npm run analys -- <pdf> <input.json>       # LIVE Supabase job + Anthropic spend
npm run verify-rls                         # LIVE: checks RLS with secret vs publishable key
npm run build:edge / deploy:edge           # bundle / deploy the analys-steg Edge Function
```

## Environment variables (names only — values live in `.env.local` / Lovable Secrets / Supabase secrets)

`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `MAX_COST_PER_ANALYSIS_SEK`, `PROJECT_URL`,
`PROJECT_SECRET_KEY`, `PROJECT_PUBLISHABLE_KEY`, `MAX_DAILY_SPEND_SEK`,
`ANALYSIS_KILL_SWITCH`; Edge Function also reads `SUPABASE_URL`, `AUTOMATIONS_KEY`;
`SUPABASE_ACCESS_TOKEN` is for the Supabase CLI only. Supabase vars are named
`PROJECT_*` because Lovable and Supabase both refuse secret names starting with
`SUPABASE_`. Validated in `src/server/env.ts`. Never `VITE_`-prefix a secret.

## How the backend calls Claude

- A job is three stages, one Anthropic call each, run **sequentially**, one
  stage per pg_cron tick of the Edge Function (`korNastaSteg` in `src/server/steg.ts`):
  1. grounding — PDF as a `document` block with citations (`runExtraction.ts`)
  2. structured extraction — text-only, JSON validated with Zod (`runExtraction.ts`)
  3. judging — flags/questions, text-only, Zod-validated (`analyze.ts`)
- Model from `ANTHROPIC_MODEL` (default `claude-sonnet-5`). `countTokens` + cost guard
  before every call; one retry on validation failure, then a hard, visible error.
  Results cached in Supabase keyed by model + prompt version.

## Domain rules (current as of September 2026 — trust this over training data)

- **Amortisation** (since 1 April 2026): loan-to-value only — >70 % → 2 %/yr,
  50–70 % → 1 %/yr, <50 % → none. The skärpta amorteringskravet is abolished.
  Bolånetak 90 % (min. 10 % deposit). Skuldkvot is shown as information only and
  never drives the amortisation rate.
- **Ränteavdrag**: 30 % on interest up to SEK 100 000 per person per year, 21 %
  above. The cap is per person, so the number of borrowers matters.
- **Seven statutory nyckeltal** (BFNAR 2023:1, from FY2023): årsavgift/m²
  bostadsrättsyta; årsavgifternas andel av rörelseintäkter; skuldsättning/m²
  totalyta; skuldsättning/m² bostadsrättsyta; sparande/m² totalyta;
  räntekänslighet; energikostnad/m² totalyta. Extraction must produce all seven.
- **Räntekänslighet** (interest-bearing debt ÷ annual fee income) states how many
  percent fees rise per percentage point of rate increase. The rate stress uses
  it directly — no separate model.
- Lagfart/pantbrev: houses only. Board approval of membership: bostadsrätter only.
- Nyckeltal thresholds are product decisions in `BENCHMARKS.md`, mirrored in `benchmarks.ts`.
- A debt-per-m² figure with an unclear basis (e.g. "Lån per kvm bostadsyta") is
  reported as skuldsättning per m² bostadsrättsyta — a number beats none here.
- Never present a statistical association as causation: an effect whose sign
  contradicts the obvious direction (e.g. "no lift" raising price) is replaced by
  the broader estimate or omitted.

## Conventions

- All user-facing text in Swedish; code, comments, identifiers, commits in English.
- Unknown ≠ false: use `Tristate = 'ja' | 'nej' | 'okant'`, never `boolean | null`.
- Estimates are labelled: `source: 'schablon'` renders distinct from
  `'arsredovisning'` / `'anvandare'`. A guess must never look like a fact.
- Every extracted figure carries its page reference; no citation, no display.
- SEK as integers; areas in m² with one decimal. Never invent domain numbers
  (thresholds, benchmarks, schablons): cite a source or mark `// TODO: unverified placeholder`.
- Model output is untrusted: Zod-validate everything; handle scanned PDFs,
  missing figures and malformed responses explicitly. Silent empty analysis is
  the worst failure; visible failure is fine.
- Tests first for anything with a correct answer (extraction, calculators,
  valuation). Before claiming done, run `npm run typecheck`, `npm test`,
  `npm run lint` (and `npm run dev` for UI) and report the real output.
- Ask when a spec or domain rule is ambiguous; don't guess.

## Visual boundary

Visual boundary: do NOT change visual design (styling, layout, colours,
typography, spacing, animations, images, or components in @/components/ui/binfo)
unless I explicitly ask. When a feature needs new UI, build it functionally from
existing components and existing patterns with minimal new styling, and add it
to a list "For Lovable to polish" that you report at the end. Exception: the PDF
export layout (task 3) is yours to design, kept simple and consistent with the site.

## Lovable sync workflow

The frontend is also edited in Lovable, which pushes to `main` on GitHub.
`git pull` before starting work; push when done; never edit the same files in
Lovable and Claude Code at the same time. Don't rename, move or restructure
frontend files beyond what a task needs.

## Working model (supervisor + subagents)

- The main session is supervisor: plan, order, decisions, integration, commits,
  checkpoints. Working plan lives in `.claude/working-plan.md` (gitignored) —
  keep it updated so it survives compaction.
- Subagents (definitions in `.claude/agents/`, run on Sonnet) get self-contained
  briefs, never edit overlapping files concurrently, never commit, never change
  shared contracts (report back instead), and stop rather than guess. The
  supervisor reviews every diff and re-runs the checks before accepting it.

## Don't touch

- `AGENTS.md` and `.lovable/` (Lovable-managed); `src/routeTree.gen.ts`.
- Applied migrations in `supabase/migrations/` — add a new migration instead.
- `.env*` files and lockfiles by hand; never commit secrets.
- The server boundary: `src/server/` is client-forbidden via `importProtection`
  in `vite.config.ts` and `no-restricted-imports` in `eslint.config.js`. Both
  carve out `src/server/analysFn.ts` and nothing else — never widen either.
  Nothing outside `src/server/` imports from it except through `analysFn.ts`.
- `src/types/analysis.ts`: changing it breaks both sides at once — stop and flag
  before editing.

## Reference docs

`SUPABASE.md` (schema, job orchestration, live verification), `PIPELINE.md`
(pipeline design rationale), `BENCHMARKS.md` (nyckeltal thresholds). When a
reference doc and the code disagree, the code wins — fix the doc.
