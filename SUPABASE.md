# Supabase — schema, storage, secrets

Scope for step 3 of `GOLIVE.md`: the persistence layer Phase 1 needs before a
buyer's own upload can produce their own analysis. Read `GOLIVE.md` first for
why the job has to be asynchronous and what the caching is worth.

**Settled:** storage is the project's **own Supabase** (verified live, service
key works, buckets empty). Payment deferred. Hosting is **Lovable's**, on the
custom domain `binfo.slanesens.com`. PDFs retained **30 days**. A hard spend
limit is set in the Anthropic console.

---

## What the constraints force

### Cloudflare Queues is off the table

Lovable owns the deployment. Its build presets (`cloudflare-module` or
`lovable-fetch-bundle`) target a Workers-style runtime, but it is **Lovable's**
Cloudflare account — so we cannot add Queue, D1 or R2 bindings to it, and we
cannot set or raise its CPU limit. Paying for a Workers plan we don't control
buys nothing. The earlier recommendation to use Cloudflare Queues is therefore
withdrawn.

Relevant: Cloudflare's free plan allows **10 ms CPU per request and cannot be
raised**; paid defaults to 30 s. Our PDF parse measures 378 ms. We do not know
which plan Lovable runs, and we cannot change it — which is the second reason
the long job must not live in the web request at all.

Lovable Cloud is itself built on Supabase and offers Edge Functions, scheduled
Jobs and a Secrets manager. Since the project has its **own** Supabase, use that
directly rather than Lovable Cloud's managed one: full control, standard
Supabase pricing, own region, proper migrations.

### Supabase Edge Function limits force the job into small steps

| Limit | Free | Paid |
|---|---|---|
| Wall clock per invocation | **150 s** | 400 s |
| CPU per invocation | **2 s** | 2 s |

Against measurements:

| Step | Measured wall | Fits 150 s? |
|---|---|---|
| Full cold run | 195,9 s | **No** |
| Pass 1 (extraction, 2 API calls) | 122,5 s | Barely — 18 % headroom |
| Pass 2 (judgement, 1 API call) | 73,4 s | Yes |

A single job is impossible on the free plan and tight even on paid. And pass 1's
122,5 s was measured on the **1,2 MB** Nabo report — the 11,4 MB report has more
pages and more tokens to reason over, so assume it is slower. 18 % headroom is
not enough.

**So: one Anthropic call per invocation — three steps, not two.** Pass 1 is
internally two calls (the citation-grounding call, then the structured-JSON
call), so the natural split is:

| Step | What it does | Cached as |
|---|---|---|
| 1 | PDF parse + grounding call (citations) | — |
| 2 | Structured-JSON call → `ExtractionResult` | `extraktion_cache` |
| 3 | Judgement call → `AnalysJudgement` | `analys_cache` |

Assembly is 0,01 s and can happen on read. This also isolates cost precisely: a
step-3 failure costs 0,79 kr to retry, not the full 4,25 kr.

CPU fits with room to spare — the heaviest work (378 ms parse + 240 ms base64)
all lands in step 1, around 30 % of the 2 s budget.

---

## Schema

Three concerns, kept separate: the job, the caches, the spend guard.

Create the migration with the CLI rather than hand-naming a file —
`supabase migration new init` writes
`supabase/migrations/<timestamp>_init.sql`. Supabase tracks applied migrations
by that timestamped filename, so a hand-rolled `001_init.sql` sits outside what
the CLI expects. Apply with `supabase db push` (remote) or `supabase db reset`
(local).

```sql
-- supabase/migrations/<timestamp>_init.sql

create type analys_status as enum ('queued', 'running', 'done', 'failed');
create type analys_stage  as enum ('uploaded', 'extracting', 'judging', 'assembling');

-- One row per buyer's analysis. This is the job record AND the result.
create table analys (
  id              uuid primary key default gen_random_uuid(),  -- AnalysisResult.analysisId
  status          analys_status not null default 'queued',
  stage           analys_stage  not null default 'uploaded',

  pdf_hash        text not null,   -- sha256 hex; content address + cache key
  pdf_path        text not null,   -- object path in the storage bucket

  property_input  jsonb not null,  -- PropertyInput, validated by PropertyInputSchema
  lan_underlag    jsonb,           -- LaneUnderlag (the calculator's loan assumptions)

  result          jsonb,           -- the finished AnalysisResult
  schema_version  text,            -- AnalysisResult.schemaVersion, for migrations

  error_code      text,            -- 'scanned_pdf' | 'cost_cap' | 'validation' | 'unknown'
  error_message   text,            -- Swedish, safe to show the buyer verbatim

  cost_sek        numeric(10,2) not null default 0,

  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz
);

create index analys_pdf_hash_idx   on analys (pdf_hash);
create index analys_created_at_idx on analys (created_at desc);
```

**As implemented, this draft changed in three ways — the migration file
(`supabase/migrations/<timestamp>_init.sql`) is the source of truth, not the
SQL above:**

- **No `result` column.** Decided: assemble on read, not on write.
  `hamtaResultat` (`src/server/analys.ts`) re-enriches the cached extraction
  and calls `assembleraAnalys` fresh on every call, so a `BENCHMARKS.md`
  threshold change re-grades every past analysis for free, and there is no
  stored JSON blob that can drift out of sync with the current contract.
  `analysisId`/`skapad` are threaded through from the row (`id`/`created_at`)
  rather than generated per-call, so two reads of the same done row return
  byte-identical JSON.
- **`stage` has no `'assembling'` value.** Assembly is not a job step —
  see above.
- **The row carries more state than this draft shows**: `model` and
  `prompt_version` (so a mid-flight deploy can't mix cache keys across one
  job's own steps), `grundtext` (pass 1's intermediate grounding text — the
  only state that needs to survive between the grounding and structured-
  extraction invocations; job-scoped rather than a shared cache on purpose,
  see the migration's own comment on why; nulled once consumed), and
  `lease_until`/`attempts` for the claim/lease/retry mechanism the job runner
  needs (`claim_next_steg`, `slapp_steg`, `binfo_reaper` — all in the
  migration). `lan_underlag` is `not null`, not nullable as drafted here —
  assembly needs it on every read.

### The caches — where the money is saved

Both API calls are förening-level: `runExtraction` and `runAnalys` never see
`PropertyInput`. Every bidder on every apartment in a förening uploads the same
årsredovisning, so the second buyer onward costs **0 kr**.

```sql
-- Pass 1 output. Keyed by the document, not by the buyer.
create table extraktion_cache (
  pdf_hash        text not null,
  model           text not null,          -- silent model changes change output
  prompt_version  text not null,          -- bump when prompts.ts changes
  extraction      jsonb not null,         -- ExtractionResult
  schema_version  text not null,
  cost_sek        numeric(10,2) not null,
  orgnr           text,                   -- denormalised, for lookup and debugging
  rakenskapsar    int,
  created_at      timestamptz not null default now(),
  primary key (pdf_hash, model, prompt_version)
);

-- Pass 2 output. Also förening-level — it consumes only the extraction.
create table analys_cache (
  pdf_hash        text not null,
  model           text not null,
  prompt_version  text not null,
  judgement       jsonb not null,         -- AnalysJudgement
  cost_sek        numeric(10,2) not null,
  created_at      timestamptz not null default now(),
  primary key (pdf_hash, model, prompt_version)
);
```

**Note what is deliberately *not* in the cache key: the benchmark thresholds.**
`berikaNyckeltal` reads only `figure.value` and fully overwrites `status` and
`benchmark`, dropping any stale one. So re-applying it to a cached extraction
**on read** produces current grading from old cache rows. Changing
`BENCHMARKS.md` thresholds therefore costs nothing and invalidates nothing —
but only if the read path actually re-enriches. That is a required step, not an
optimisation.

**Done**: `PROMPT_VERSION` is now a constant in `prompts.ts` (bumped by hand
whenever a prompt changes, with a drift test — `prompts.test.ts` — that hashes
every prompt-builder's output and fails if the text changes without a matching
bump), included in the cache key exactly as planned.

### Spend guard

`MAX_COST_PER_ANALYSIS_SEK` already caps one run. Nothing caps the day.

```sql
create table spend_day (
  day       date primary key,
  cost_sek  numeric(10,2) not null default 0,
  runs      int not null default 0
);
```

**As implemented**: reserve-then-reconcile, not check-then-increment
(`src/server/spend.ts`) — a step reserves its estimated cost via
`reservera_spend` (SQL) *before* calling the model, then reconciles down (or
up) to the real cost via `avstam_spend` *after*. `reservera_spend`'s first
draft had a real bug (the day's very first reservation bypassed the cap
entirely — see "Live verification" above); fixed to an insert-if-absent
followed by a uniformly-gated update. With a kill switch in env, checked
before the reservation is even attempted, this is what stops a scripted
upload loop from turning a bad night into a bad month.

### Row Level Security

```sql
alter table analys           enable row level security;
alter table extraktion_cache enable row level security;
alter table analys_cache     enable row level security;
alter table spend_day        enable row level security;
-- Deliberately no policies. RLS on + zero policies = deny everything to anon
-- and authenticated. The server uses the secret key, which bypasses RLS.
```

**The browser never gets a Supabase key of any kind in Phase 1.** All access
goes through server functions. This is the single most important security
decision here: it makes the deny-all RLS a real backstop rather than a
formality, and it means there is no anon key to leak.

---

## Storage bucket

```sql
insert into storage.buckets (id, name, public)
values ('arsredovisningar', 'arsredovisningar', false);
```

Private. Objects keyed by content hash — `arsredovisningar/<sha256>.pdf` — so
the same report uploaded by twenty buyers is stored once.

**Upload path for Phase 1:** POST the file through a server function, which
writes it to the bucket. The Phase 0 spike already proved a Worker handles an
11,4 MB PDF comfortably (240 ms to base64-encode it, well inside a 128 MB
isolate). If Cloudflare's request-body limit or memory ever bites, the fallback
is a signed upload URL so the browser writes to Supabase directly and the Worker
only ever sees the hash — more moving parts, so not worth it until needed.

Reject before spending anything: non-PDF content type, size over a cap, and —
per the Phase 0 finding that **12,5 % of real reports are scans** — a missing
text layer. `ScannedPdfError` already fires before any API call; it needs a real
Swedish error screen, not a generic failure.

---

## Personal data — decide this before launch, not after

The repo's own `.gitignore` says it: these documents *"may name individuals"*.
Annual reports list board members by name, sometimes more. That makes every
stored PDF personal data under GDPR, and Binfo the controller.

Three consequences for this layer:

1. **Pick an EU region** for the Supabase project (Stockholm/Frankfurt). Doing
   this at project creation is free; moving later is not.
2. **Retention: uploaded PDFs are deleted after 30 days** (decided). The
   derived `ExtractionResult` and `AnalysJudgement` are structured data and are
   kept — they are what the cache is worth, and they do not contain the
   document itself. A `pg_cron` job deletes storage objects older than 30 days
   and nulls `analys.pdf_path`; the analysis a buyer paid attention to survives,
   the liability does not.

   Consequence worth noting: after 30 days the PDF is gone, so a *re-run* of a
   cached förening is impossible — only the cached output remains. That is
   fine, and it is the right trade, but it means a cache entry that fails
   schema validation after a contract change cannot be regenerated without a
   fresh upload.
3. **Have a deletion path** for a buyer who asks. With content-addressed
   storage shared across buyers, deleting one buyer's `analys` row must not
   necessarily delete the shared PDF — decide the rule now and write it down.

   **Decided and implemented** (`radera_analys`, the migration): a buyer's own
   `analys` row is always deleted; the shared PDF is deleted from storage only
   when no other row still references the same `pdf_hash` — the function
   reports which case it was so the caller knows whether to also delete the
   storage object. The derived `extraktion_cache`/`analys_cache` rows are
   never deleted by this path — they contain no document and name no one, so
   they carry none of the retention risk the PDF itself does.

Not blocking the schema, but blocking launch, and cheaper to design in than to
retrofit.

---

## Secrets

Add to `.env.example` (and the Worker's secret store in production):

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SECRET_KEY=                # sb_secret_... — server only, never VITE_-prefixed, never in the browser
MAX_DAILY_SPEND_SEK=200             # global cap; the per-run cap already exists
ANALYSIS_KILL_SWITCH=off            # 'on' refuses new jobs without a deploy
```

Two hard rules, both already true of `ANTHROPIC_API_KEY` and both easy to break
by accident:

- Nothing server-side may be `VITE_`-prefixed. Vite injects those into the
  client bundle.
- `runExtraction.ts`, `analyze.ts`, `pdf.ts` and anything in `src/server/` must
  never be imported from a client component. Today nothing does — `analys.tsx`
  and `bolanekalkyl.tsx` only import the pure `calc/*` and `benchmarks`
  modules. Enforce it with `createServerOnlyFn` and an ESLint
  `no-restricted-imports` rule rather than trusting discipline.

Access env through one validated module (`src/server/env.ts`, Zod) that throws
loudly at startup on a missing key — not `process.env.X` scattered across files.
A missing key should fail the deploy, not the first buyer's upload.
**Done**: `lasEnv`/`envFromProcess` in `src/server/env.ts`; the
`no-restricted-imports` rule is in `eslint.config.js`, scoped to
`src/routes/**`/`src/components/**`/`src/data/**`/`analysisView.ts`, blocking
`@/server/*` and the heavy pipeline modules while leaving `calc/*` and
`benchmarks` importable, matching what the UI actually uses today.

**The deployed Edge Function does not use these same names.** Supabase
reserves the whole `SUPABASE_`-prefixed namespace for its own auto-injected
variables (`supabase secrets set` refuses anything starting with
`SUPABASE_`), and what it actually auto-injects — `SUPABASE_URL`/
`SUPABASE_SERVICE_ROLE_KEY`, the *legacy* pair — can be stale on a project
that has disabled its legacy keys, as this one has (see Resolved, and the
Live verification section above). `supabase/functions/analys-steg/index.ts`
therefore reads two custom-named secrets instead:

```
PROJECT_URL=            # same value as SUPABASE_URL above
PROJECT_SECRET_KEY=     # same value as SUPABASE_SECRET_KEY above
AUTOMATIONS_KEY=        # separate from any web-app key; matches the Vault
                         # secret `automations_key` the binfo-tick cron job
                         # sends on the `apikey` header — this is the
                         # function's entire auth boundary
```

Set with `supabase secrets set --env-file <file>` (never inline on the
command line, and never with a value visible in shell history) — do not
attempt to reuse `SUPABASE_URL`/`SUPABASE_SECRET_KEY` for the deployed
function; the CLI won't allow it and the platform's own auto-injection can't
be trusted to match.

---

## Code layout — the fourth zone

`CLAUDE.md`'s boundary table has no home for server code. Proposed:

| Path | Contains | Rule |
|---|---|---|
| `src/server/` | Server functions, storage, job orchestration | May import `src/lib/analysis/` and the contract. **Nothing may import it back.** UI reaches it only through typed server functions. |

```
src/server/
  env.ts        -- Zod-validated env, throws loudly when a secret is missing
  portar.ts     -- Lager/Databas/Filarkiv interfaces (no impl) — the only surface
                   the rest of this zone is allowed to depend on
  supabase.ts   -- secret-key client factory, server-only
  __fakes__/    -- in-memory Lager, so nothing here needs a live database to test
  cache.ts      -- extraction/judgement cache read + write (re-enriches on read)
  spend.ts      -- daily cap + kill switch, reserve-then-reconcile
  fel.ts        -- maps a caught error to an AnalysErrorCode + buyer-safe Swedish message
  steg.ts       -- korNastaSteg: claims one job row, advances it one step
  analys.ts     -- skapaAnalys, hamtaStatus, hamtaResultat (framework-free)
  analysFn.ts   -- createServerFn wrappers around analys.ts
  edge/build.ts -- esbuild bundle of steg.ts for the Edge Function
  cli/          -- analysCli.ts (npm run analys), verifyRls.ts (npm run verify-rls)
```

(`jobb.ts` in the original sketch became `steg.ts` — same role, renamed
during implementation.)

The three server functions are the entire public surface:

```
skapaAnalys(pdf, propertyInput)  -> { analysisId }   hash, dedupe, store, enqueue
hamtaStatus(analysisId)          -> { status, stage, error? }
hamtaResultat(analysisId)        -> AnalysisResult
```

`hamtaResultat` stays the single place a full analysis is handed out, so
turning the paywall on later is a change in one function rather than a refactor
of every screen. Keep `gratisSektioner` populated in the stored result now even
though nothing reads it yet.

---

## Work breakdown

All done and verified live (2026-09-13) — see "Live verification" above for
what the live run actually found and fixed.

| # | Task | Notes |
|---|---|---|
| 0 | ~~Create the Supabase project~~ | **Done** — live, EU (Ireland), key verified |
| 1 | ~~Deno spike~~ | **Done** — real edge-runtime, all four report sizes, incl. the scan |
| 2 | ~~`supabase migration new init`~~ | **Done** — applied to the live project via `db push` |
| 3 | ~~`PROMPT_VERSION` in `prompts.ts`~~ | **Done** — with a drift test, not just the constant |
| 4 | ~~`src/server/env.ts` + `.env.example`~~ | **Done** — Zod-validated, fails loudly |
| 5 | ~~`src/server/supabase.ts`~~ | **Done** — plus `portar.ts`'s interfaces and the in-memory fake |
| 6 | ~~`src/server/cache.ts`~~ | **Done** — re-enrichment on read verified by test |
| 7 | ~~`src/server/spend.ts`~~ | **Done** — reserve-then-reconcile; caught and fixed a real cap-bypass bug |
| 8 | ~~Code-sharing build step for the Edge Function~~ | **Done** — esbuild bundle, `npm run build:edge` |
| 9 | ~~Edge Function: one pipeline step per invocation~~ | **Done** — deployed; `attempts` bug found and fixed by the live run |
| 10 | ~~`pg_cron` schedule + retention job~~ | **Done** — tick, keep-alive, retention, reaper all scheduled and confirmed firing |
| 11 | ~~`src/server/analys.ts`~~ | **Done** — the three server functions, plus `analysFn.ts`'s `createServerFn` wrappers |
| 12 | ~~ESLint `no-restricted-imports` guard~~ | **Done** |

Task 1 comes first because a failed Deno spike changes tasks 8–10 entirely (the
fallback being a small Node service we control, where the pipeline runs
unmodified — it already does, via `npm run extract`).

Tests: the cache round-trip, the re-enrichment on read, the spend cap
refusing a run at the limit, and the dedupe path all have verifiable right
answers and get tests first, per the working agreement. Everything that talks
to Supabase gets the client injected so tests never need a live database.

---

## The job runner: Postgres as the queue

Since Lovable's runtime is not ours to configure and Cloudflare bindings are
unavailable, the job lives entirely in Supabase — which the project owns:

```
analys row ('queued')
   → pg_cron tick (every minute)
   → invokes the Edge Function for ONE step
   → step writes its result + advances `stage`, or records an error
   → next tick picks up the next step
```

Postgres is the queue, `pg_cron` is the scheduler, an Edge Function is the
worker. No extra vendor, nothing that needs Lovable's cooperation, and it is
durable in the way `waitUntil` is not: if a step dies, the row stays in its
previous stage and the next tick retries it. Add an `attempts` counter so a
genuinely broken report fails permanently instead of retrying forever and
billing every time.

The web app (on Lovable) then only ever does fast things: write the upload,
read status, read the result. Nothing long-running in the request path.

### Phase 0b — the Deno spike. DONE, and it holds up

`GOLIVE.md`'s Phase 0 verified the pipeline inside Cloudflare workerd, which is
what the *site* runs on. Supabase Edge Functions run **Deno**, a different
runtime, so that verification did not transfer on its own — it needed its own
proof, not an assumption.

Verified against the **real** `supabase-edge-runtime` (Deno 2.1.4, via
`supabase functions serve` — the actual container Supabase deploys, not
vanilla Deno), replicating `pdf.ts` and `toBase64` exactly and importing both
libraries via `npm:` specifiers:

| Report | Size | `extractPdfText` | base64 | Text layer |
|---|---|---|---|---|
| HSB (largest) | 11,4 MB | 418 ms | 433 ms | ok |
| Riksbyggen 2 | 7,3 MB | 492 ms | 259 ms | ok |
| SBC 2 | 5,3 MB | 50 ms | 189 ms | **SAKNAS — scan, correctly detected** |
| Nabo (typical) | 1,2 MB | 319 ms | 46 ms | ok |

Worst case ≈ 850 ms against the 2 s CPU budget — comparable to the workerd
numbers, comfortable margin, no `nodejs_compat`-equivalent flag needed.
`unpdf`, `@anthropic-ai/sdk` (client construction), `crypto.randomUUID()`, and
the scanned-PDF detection all work unmodified. Task 1 is closed; the schema and
server work are unblocked.

### And it raises a real code-sharing problem

The pipeline is TypeScript in `src/lib/analysis/`, imported with the `@/` alias
and bundled by Vite. A Supabase Edge Function is a separate Deno deployment with
its own module resolution. The same code has to run in both places without being
forked — a forked copy of the extraction logic is how the answer key silently
stops matching production.

Options, to decide after the Deno spike: a small build step that bundles
`src/lib/analysis/` into the function directory; an import map plus
relative imports; or publishing the pipeline as an internal package. Least-bad
is probably the bundle step, since it keeps one source of truth and the tests
keep running against that source.

---

## Resolved

- ~~Which Supabase region~~ — **Ireland (EU-West)**, confirmed.
- ~~Disable the legacy JWT API keys~~ — **done and verified**: the leaked
  `service_role` JWT that had been pasted into a chat now returns 401; the
  active `SUPABASE_SECRET_KEY` (`sb_secret_...`) returns 200 on both REST and
  storage.
- ~~Confirm the secret key bypasses RLS empirically~~ — **done, `npm run
  verify-rls`**: against the live `spend_day` table (RLS on, zero policies),
  the secret key writes and reads back its own probe row; the publishable key
  is denied on both a `select` (0 rows, no error — PostgREST's normal shape
  for an RLS-denied read) and an `insert` (`42501`, "new row violates row-level
  security policy"). Verdict: **secret-nyckeln förbigår RLS: JA**,
  **publishable-nyckeln nekas av RLS: JA**. The deny-all backstop is real, not
  assumed.
- ~~Supabase plan~~ — **staying on Free for now**, accepting the pause risk,
  with a dedicated `binfo-keep-alive` `pg_cron` job (see the migration) that
  hits the project's own REST endpoint daily, independent of `binfo-tick`, so
  disabling the tick to debug can never put the project on a path toward being
  paused. Revisit the paid plan once real users arrive — see the wall-clock
  finding below for why headroom matters more than it first seemed.
- ~~Code-sharing for the Deno function~~ — **done, esbuild bundle**: `npm run
  build:edge` bundles `src/server/steg.ts` (platform-neutral, ESM), rewriting
  `@anthropic-ai/sdk` and `unpdf` to the exact `npm:` specifiers pinned in
  `package-lock.json` and leaving everything else — including
  `@supabase/supabase-js` — bundled in. One source of truth; the Edge Function
  (`supabase/functions/analys-steg/index.ts`) imports the bundle and adds
  nothing but the `apikey` auth check and a small inline `Lager`/`Env`
  adapter (see the note below on why that adapter is duplicated rather than
  imported).

## Live verification (2026-09-13, against the real project)

The plan above was carried out against the actual live Supabase project —
migration applied, function deployed, real Anthropic calls made — not just
reviewed on paper. What that run found, in order:

**A genuine bug in `reservera_spend`, caught before it shipped.** The first
draft's `insert ... on conflict do update ... where` only gated the *update*
branch — the day's very first reservation took the plain `insert` path and
would have bypassed the daily cap entirely. Fixed in the migration to an
idempotent insert-if-absent followed by an update gated the same way on every
call. Caught by re-reading the SQL during review, not by the live test, but
worth recording here since it's exactly the kind of one-line trap this
document exists to prevent.

**A real design bug, caught only by the live test.** `attempts` was a single
counter for the whole job's lifetime (incremented on every claim across all
three stages), not "three tries per stage." A cold run against a real annual
report needed one retry at the extraction step — its first invocation ran
long enough that the claim's lease expired before a response ever came back,
so the next tick reclaimed it — and that single retry alone consumed 2 of the
job's 3 total attempts. The judging step was then left with zero, could never
be claimed even once, and `binfo_reaper()` eventually swept the row as
permanently failed. Fixed in `src/server/steg.ts`: a successful stage advance
now resets `attempts` to 0, so each of the three stages gets its own fresh
budget of three claims, counted from when that stage becomes current — not a
budget the whole job shares. Covered by a regression test in
`steg.test.ts` before the fix was redeployed.

**`SUPABASE_URL`/`SUPABASE_SECRET_KEY` are not what's auto-injected into a
deployed Edge Function on this project.** Supabase's documented auto-injection
for Edge Functions is `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` — the
*legacy* pair — and this project has disabled its legacy keys (see Resolved,
above). There is a live upstream report (supabase/supabase#37648) of the
analogous case for `SUPABASE_ANON_KEY` staying stale after a project migrates
off the legacy format; the same risk applies here, and the CLI independently
refuses to let `supabase secrets set` touch anything `SUPABASE_`-prefixed at
all. The fix: `supabase/functions/analys-steg/index.ts` reads two
custom-named secrets instead — `PROJECT_URL` and `PROJECT_SECRET_KEY` — set
by hand via `supabase secrets set` to the exact same values as this repo's own
`SUPABASE_URL`/`SUPABASE_SECRET_KEY`. Anyone redeploying this function to a
new project needs to set those two names, not the `SUPABASE_*` ones.

**Timing, measured for real, not estimated.** Against the live project, one
full cold run of the smallest report (Nabo, after a partial prior run had
already cached its extraction) needed only the judging step: ~88 s, 0,87 kr.
A completely cold run of the **largest** report in the corpus (11,4 MB,
never-before-seen — the free-plan worst case this design has to survive)
completed in one pass per step, no retries: grounding ~98 s, extraction
~120 s, judging ~109 s, all individually under the 150 s Free-plan ceiling;
326 s and 3,58 kr end to end. The dedupe path was also confirmed live: an
identical re-upload of the Nabo report completed in ~2 s at **0,00 kr**. The
scanned-PDF refusal (SBC) was confirmed to leave zero rows in `analys` and
zero objects in storage, refusing in well under a second.

## Still open

Nothing blocking. The remaining "Still open" items from `GOLIVE.md` (does an
analysis expire, who owns deployment long-term) are product questions, not
infrastructure gaps in this layer.
