# Supabase — schema, storage, secrets

> Reference doc, partly a work log from September 2026. When it disagrees with
> the code, the code wins — fix this file. The planning docs it originally
> referred to (`GOLIVE.md`, `PHASE1.md`) have been removed; see git history.

The persistence layer that lets a buyer's own upload produce their own
analysis: why the job is asynchronous, the schema, and what the caching is worth.

**Settled:** storage is the project's **own Supabase** (verified live, service
key works, buckets empty). Payment deferred. Hosting is **Lovable's**, on the
custom domain `binfo.slanesens.com`. PDFs were retained **30 days**; since v2
(owner decision 2026-10-09) they are **kept indefinitely** so the register can
re-run a report on a version change — see "Register (v2)" below. A hard spend
limit is set in the Anthropic console.

> **v2:** the job no longer lives on the buyer's `analys` row. New analyses
> link to a shared, versioned `rapport` in the register; `analys` rows created
> before that keep the original queue and caches described in most of this
> document. Read "Register (v2)" first.

---

## Register (v2)

Migration `supabase/migrations/20261009120000_register.sql`, code
`src/server/register.ts` (lookup, linking, versioning), `steg.ts` (worker),
`analys.ts` (upload + reads), admin CLI `src/server/cli/registerCli.ts`.
Design: docs/PLAN-v2.md §3.

### Why

The caches were keyed on `(pdf_hash, model, prompt_version)`: a re-downloaded
copy of the same report (different bytes) was a full-price miss, and two
simultaneous identical uploads both paid. The register keys the work on the
**report** — BRF orgnr + räkenskapsår + pipeline version — and on each byte
version of it.

### Schema

| Object | What |
|---|---|
| `forening(orgnr pk, namn, forst_sedd, senast_sedd)` | One row per BRF; orgnr CHECK `^\d{6}-\d{4}$`. Upserted via `registrera_forening` (a non-null name wins). |
| `rapport` | One analysis of one report, shared by every buyer: identity (`orgnr`+`rakenskapsar`, both or neither), `pipeline_version`, `model`, `textlager` (`ok`/`saknas`/`trasigt`), job columns (`status rapport_status`, `stage rapport_stage`, `lease_until`, `attempts`), results (`grundtext`, `extraction`, `judgement`), `error_code`/`error_message`, `cost_sek`, `cache_read_tokens`/`cache_write_tokens`, `pdf_hash` (the bytes it runs on), `ersatt_av`. |
| `rapport_identitet_uniq` | Partial unique index on `(orgnr, rakenskapsar, pipeline_version)` over rows with an identity whose status is not `failed`/`ersatt`. **The concurrency lock** for the same report. |
| `rapport_fil_version_uniq` | Partial unique index on `(pdf_hash, pipeline_version)` over live rows. **The second lock**: same bytes (incl. concurrent lazy re-runs of an identity-less rapport, which the identity index cannot see). A conflict on either index links to the slot holder (`skapaRapportMedPlats`). |
| `rapport_fil(pdf_hash pk, rapport_id, pdf_path, sidor, bytes, uppladdad)` | One row per byte version. The primary key settles same-bytes races. |
| `sidtext(rapport_id, sida, text, kalla)` | Scan transcriptions (WS1). Created, unused. |
| `forening_adress` | Where a BRF is. `kalla 'anvandare'` rows hold the buyer's postnummer + kommun code + område (from `losTackning`) and **never** a street address (CHECK); upsert `registrera_forening_adress`, unique NULLS NOT DISTINCT (needs Postgres ≥ 15). |
| `analys.rapport_id` | Nullable FK. Null = legacy row. |
| `claim_next_rapport_steg`, `slapp_rapport_steg` | The rapport queue; same lease/attempts/`SKIP LOCKED` semantics as `claim_next_steg`/`slapp_steg`, except a release never resurrects a done/failed/ersatt row. |
| `claim_next_steg` (replaced) | + `and rapport_id is null`: the legacy queue never claims a linked row. |
| `binfo_reaper` (replaced) | Also fails stuck rapport rows (and sets `finished_at`). |
| `radera_analys` (replaced) | Never reports a PDF the register references as orphaned. |

RLS is on with zero policies on every new table; the new functions are
`security invoker`, `search_path = public`, execute revoked from
public/anon/authenticated and granted to `service_role`.
Rollback: `supabase/rollback/20261009120000_register.down.sql` (manual; run
the konto down-script first). It keeps finished buyers working (their
rapport's result is copied into the legacy caches under the analys row's key
and the row marked done) and fails only linked rows whose rapport is not done.

### State machine (on `rapport`)

```
identifiering ──(register hit)──► status 'ersatt', ersatt_av = hit
     │                             (analys rows + files re-pointed)
     ├─(textlager 'saknas')─► transkribering (stub until WS1) ─┐
     ▼                                                          ▼
grundning ─► extraktion ─► bedomning ─► klar (status 'done')
```

Each tick claims a rapport first and falls back to the legacy `analys` queue
only when none is claimable. **Every worker write is leased**
(`uppdateraLeasadRapport`: `status = 'running' and lease_until = <the claimed
lease>`), so a step that finishes after an admin invalidate, a reaper sweep or
a re-claim drops its result instead of overwriting the terminal state; spend is
still reconciled. Per stage: reserve spend → one model call →
reconcile → write results **on the rapport row** (not in the caches), reset
`attempts`, reinvoke. Version guard: `rapport.pipeline_version` must equal the
worker's `PIPELINE_VERSION`, else `failed`/`versionskonflikt` (which also
frees the identity slot). The identity call never fails the job: a deterministic outcome (no identity,
invalid/truncated answer, cost cap, refusal) continues without identity at
once; a transient one (Anthropic `APIError`/`APIConnectionError` — 429, 5xx,
529 — network, unknown) is retried like any stage and continues without
identity only after the third attempt. A rapport without identity is reusable
by hash only (it can still pick up its identity from its own extraction later,
Luhn- and name-checked). A dry-assembly `AssemblyValidationError` (one buyer's
input) does **not** fail the shared rapport: it is marked done, the error is
logged and surfaces on that buyer's read.

### Upload (`skapaAnalys`)

Validation order unchanged up to the text extraction. Then: classify
`textlager` (`saknas` = every page empty → still refused while
`SKANNADE_RAPPORTER_AKTIVA` is off; `trasigt` = `bedomTextkvalitet` > 0.6 → runs
the normal path, recorded); upload `<hash>.pdf`; then `kopplaUppladdning`:

1. **hash** → `rapport_fil` → its rapport (following `ersatt_av`): servable →
   link, `ateranvand`; in progress at this version → link, `vantarPaRapport`;
   done but incompatible/stale → join (or queue) its current-version re-run.
   A **current-version** rapport that is done but does not parse would hold
   both slots for ever; it is marked failed/`ogiltigforklarad` automatically
   (`frigorTrasigPlats`) and its re-run queued — skapaAnalys never throws on
   this path.
2. **local identity** (`identifieraLokalt`, free; orgnr Luhn-checked) →
   register hit at the current version, or a done compatible older one, and
   **both** names known (the PDF's and `forening.namn`) and alike
   (`namnLiknar`) → new `rapport_fil` row → link. A name unknown on either
   side, or two different names, means no instant reuse: the new rapport
   starts at `identifiering` without identity, where the model's reading is
   judged by the same rule (missing name → no merge; the identity is set only
   if its slot is free). Two known, different names also never claim the slot.
3. **new rapport** at `grundning` (local identity) or `identifiering` (none),
   created with a 120 s *setup lease* so no worker claims it before its file
   row exists. Same-identity race → the unique index rejects the loser, which
   links to the winner. Same-bytes race → `rapport_fil`'s primary key rejects
   the loser, which deletes its unreferenced rapport and links to the winner.

Then the `analys` row (its own status/stage are set to `queued`/`uploaded`
and never used again) and, best effort, `forening_adress`.

### Reads

`hamtaStatus` derives everything from the rapport: `stage` keeps the UI's
`AnalysStage` union (identifiering/transkribering/grundning → `uploaded`,
extraktion → `extracting`, bedomning → `judging`, klar → `complete`); new
optional fields `textlager`, `ateranvand`, `vantarPaRapport`, `rapportSteg`.
An admin-invalidated rapport shows as `versionskonflikt` with its own
"dragits tillbaka" message (the UI mirror of the error-code union is not
extended).

`hamtaResultat`/`hamtaForhandsvisning`: the newest **done** rapport for the
same report (identity, else bytes) at the **current** pipeline version wins;
else the linked one if its stored extraction **and** judgement parse with the
running code's schemas — served with the note "Analysen gjordes med en
tidigare version av Binfo." and a lazy re-run queued once; else it is
**never served**: a re-run is queued and the buyer waits (or, if the PDF is
gone, sees a visible "upload again" failure). A later fiscal year analysed for
the same BRF adds "Det finns en nyare årsredovisning (ÅÅÅÅ) analyserad för
föreningen." Both notes go into `datakvalitet.extraktionKonfidens.skal`.
Legacy rows read the caches exactly as before.

### Admin CLI

```
npm run register -- list [--orgnr X] [--limit N]
npm run register -- inspect <rapportId> | inspect <orgnr> <år>   # flags missing PDFs
npm run register -- invalidate <rapportId> [--all-versions] [--force]
                                                 # failed + 'ogiltigforklarad', frees the slots;
                                                 # refuses a running rapport without --force
                                                 # (with it, the running step's leased write is dropped);
                                                 # --all-versions: every rapport for the same (orgnr, år)
npm run register -- backfill-legacy [--dry-run]  # caches of the current PROMPT_VERSION → register, idempotent;
                                                 # rows without a valid (Luhn) identity, or failing the name
                                                 # rule, become hash-only rapporter — nothing paid is paid again
npm run register -- rerun --to-current [--limit N] [--dry-run]
```

All LIVE (secret key). None calls Anthropic; `rerun` only queues — the worker
spends, under the daily cap.

### Not in the version key: the model

`PIPELINE_VERSION = p<PROMPT_VERSION>.i<IDENTITET_PROMPT_VERSION>.s<schema major>`.
The model is stored per rapport but is deliberately not part of the key or the
unique indexes (owner decision): a model switch with unchanged prompts keeps
serving the existing results; bump `PROMPT_VERSION` to force re-runs.

### Deploy order

1. Kill switch on; let both queues drain (no `queued`/`running` in `analys`).
2. `db push` (this migration, then `20261009120100_konto.sql`).
3. `npm run deploy:edge` — the worker must know `claim_next_rapport_steg`
   before the site creates rapporter.
4. Lovable publish.
5. **Backfill — required before step 6.** Uploads no longer consult the legacy
   caches, so without it every previously analysed report would be paid for
   again: `npm run register -- backfill-legacy --dry-run`, check the output
   (`medIdentitet`, `pdfFinns`, skipped rows), then
   `npm run register -- backfill-legacy`.
6. Kill switch off.

The version guard catches any skew between the site and the worker.

### Keep in sync

`supabase/functions/analys-steg/index.ts` carries a hand-written copy of
every `Databas`/`Filarkiv` method the worker can reach (see its note (c)); a
column-mapping change in `src/server/supabase.ts` must be made there too.
`npm run build:edge` bundles `pdf-lib` as `npm:pdf-lib@<lockfile version>`
(like `@anthropic-ai/sdk` and `unpdf`).

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
  migration). `lan_underlag` was originally `not null`, not nullable as
  drafted here — assembly needed it on every read. It is nullable now; see
  "`lan_underlag` is dead" below.

**`lan_underlag` is dead.** `/bolanekalkyl` became a purely client-side
calculator and no loan data is persisted anywhere anymore, so the server no
longer writes `lan_underlag` on insert. A later migration
(`supabase/migrations/20260913140646_lan_underlag_nullable.sql`) drops the
`not null` constraint the init migration put on the column, and adds a
`comment on column` marking it dead in the database itself. The column is
kept rather than dropped: dropping it would mean either rewriting the
already-applied init migration or shipping a separate destructive migration
against a table that is live in production, for a column that costs nothing
to leave in place. Nothing should read or write it going forward.

### The caches — where the money is saved

> **v2:** the caches below serve only legacy `analys` rows (no `rapport_id`).
> New analyses store extraction and judgement on their `rapport` row — see
> "Register (v2)". `npm run register -- backfill-legacy` moves the current
> prompt version's cache rows into the register.

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

   **Superseded in v2:** PDFs are now kept indefinitely (owner decision
   2026-10-09; the retention cron no longer deletes them — see
   `20261009120100_konto.sql`), and `radera_analys` never reports a PDF the
   register references as orphaned. The paragraph below describes the
   pre-v2 state, which still applies to PDFs deleted before then
   (`npm run register -- inspect` flags them).

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

Add to `.env.example` (and to Lovable's Secrets in production — see "Deploying
the web app to Lovable" below):

```
PROJECT_URL=https://<project>.supabase.co
PROJECT_SECRET_KEY=                 # sb_secret_... — server only, never VITE_-prefixed, never in the browser
MAX_DAILY_SPEND_SEK=200             # global cap; the per-run cap already exists
ANALYSIS_KILL_SWITCH=off            # 'on' refuses new jobs without a deploy
```

**Why `PROJECT_*` and not `SUPABASE_*`.** Both secret stores this project
deploys to reserve the `SUPABASE_` prefix: Supabase's own
(`supabase secrets set` refuses it, see below) and Lovable's (the Secrets
manager rejects any name starting with `SUPABASE_`, presumably because Lovable
Cloud injects its own values under those names). The web app originally read
`SUPABASE_URL`/`SUPABASE_SECRET_KEY`, which worked under `npm run dev` from
`.env.local` and nowhere else. Renamed 2026-09-16 so that one naming scheme —
`PROJECT_URL`, `PROJECT_SECRET_KEY`, `PROJECT_PUBLISHABLE_KEY` — is read by
all three runtimes: the Node CLIs, the Lovable Worker, and the Deno Edge
Function. Only `SUPABASE_ACCESS_TOKEN` keeps its prefix: it is the Supabase
CLI's own variable, never read by our code, and never needed at runtime.

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

**The deployed Edge Function reads the same names, for the same reason.**
Supabase reserves the whole `SUPABASE_`-prefixed namespace for its own
auto-injected variables (`supabase secrets set` refuses anything starting with
`SUPABASE_`), and what it actually auto-injects — `SUPABASE_URL`/
`SUPABASE_SERVICE_ROLE_KEY`, the *legacy* pair — can be stale on a project
that has disabled its legacy keys, as this one has (see Resolved, and the
Live verification section above). `supabase/functions/analys-steg/index.ts`
therefore reads:

```
PROJECT_URL=            # same value as in .env.local
PROJECT_SECRET_KEY=     # same value as in .env.local
AUTOMATIONS_KEY=        # separate from any web-app key; matches the Vault
                         # secret `automations_key` the binfo-tick cron job
                         # sends on the `apikey` header — this is the
                         # function's entire auth boundary
```

Set with `supabase secrets set --env-file <file>` (never inline on the
command line, and never with a value visible in shell history). Do not rely
on the platform's own `SUPABASE_*` auto-injection for the deployed function;
it can't be trusted to match.

---

## Deploying the web app to Lovable

The site — including every `createServerFn` in `src/server/analysFn.ts` — is
built by Lovable's wrapper (`@lovable.dev/vite-tanstack-config`, forcing
Nitro's `cloudflare-module` preset) and runs as a Cloudflare Worker on
Lovable's account, served at `binfo.slanesens.com`. Two consequences follow
from that, and both bit us once.

**1. `.env.local` never reaches production.** It is gitignored (correctly —
it holds real keys), so the deployed Worker starts with none of its values.
`envFromProcess()` in `src/server/env.ts` tries `process.loadEnvFile` (Node
only; silently skipped on workerd) and then validates `process.env`, which in
the Cloudflare build is unenv's proxy over the Worker's **bindings**
(`globalThis.__env__`). With no bindings set, `lasEnv` throws
`OgiltigMiljoError: Miljövariabeln PROJECT_URL är ogiltig: saknas` on the
first request, `src/start.ts`'s error middleware turns it into a 500, and
every upload lands on the generic "okänt fel" screen while every
`/analys/$id` link degrades to "hittades inte". That was the entire reason
the analysis "worked in `npm run dev` but not on the published site".

**2. Lovable injects secrets as Worker bindings at request time**, which is
exactly what `process.env` resolves to there, so no code change is needed
beyond reading env inside `.handler()` — which `analysFn.ts` already does.
Add the following in the Lovable editor under **More → Cloud → Secrets**,
with the same values as `.env.local`, then republish:

| Secret | Note |
|---|---|
| `PROJECT_URL` | `SUPABASE_`-prefixed names are refused by Lovable |
| `PROJECT_SECRET_KEY` | `sb_secret_…` |
| `ANTHROPIC_API_KEY` | required by `lasEnv` even though the web app never calls the model itself — the Edge Function does that |
| `ANTHROPIC_MODEL` | must match what the Edge Function uses; it is part of the cache key |
| `MAX_DAILY_SPEND_SEK` | required — Zod insists on a positive number |
| `ANALYSIS_KILL_SWITCH` | `off`; set to `on` to refuse new jobs without a deploy |
| `MAX_COST_PER_ANALYSIS_SEK` | optional, defaults to 5 |

Not needed on Lovable: `PROJECT_PUBLISHABLE_KEY` (only `npm run verify-rls`
reads it) and `SUPABASE_ACCESS_TOKEN` (Supabase CLI only).

**To confirm it is the env and not something else:** on the published site,
open DevTools → Network, submit `/analysera`, and look at the `POST
/_serverFn/…` response. Missing secrets give a 500 whose server-side log line
is the Swedish `OgiltigMiljoError` above.

**One thing to watch.** `lasEnv` throws `OsakerMiljoNyckelError` if *any*
key in the record it is handed starts with `VITE_`. On the Worker that record
is the full bindings object. Lovable documents `VITE_*` variables as compiled
into the client bundle at build time, not injected as bindings — but if that
ever changes (or Lovable Cloud starts injecting `VITE_SUPABASE_*`), every
server function would refuse to start. The fix in that case is to narrow the
guard to the secret names this module actually consumes rather than the whole
record; it is deliberately not pre-emptively relaxed, because the guard is
what makes "a secret under `VITE_` leaks" a loud failure.

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
  register.ts   -- the v2 register: lookup, upload linking, versioning, lazy re-runs
  steg.ts       -- korNastaSteg: claims one job row (rapport first, then legacy), advances it one step
  analys.ts     -- skapaAnalys, hamtaStatus, hamtaResultat (framework-free)
  analysFn.ts   -- createServerFn wrappers around analys.ts
  edge/build.ts -- esbuild bundle of steg.ts for the Edge Function
  cli/          -- analysCli.ts (npm run analys), verifyRls.ts (npm run verify-rls),
                   registerCli.ts (npm run register)
```

(`jobb.ts` in the original sketch became `steg.ts` — same role, renamed
during implementation.)

The server functions are the entire public surface:

```
skapaAnalys(pdf, propertyInput)  -> { analysisId }   hash, dedupe, store, enqueue
hamtaStatus(analysisId)          -> { status, stage, error? }
hamtaResultat(analysisId)        -> AnalysisResult
hamtaForhandsvisning(analysisId) -> Forhandsvisning   narrow free-preview projection
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
  active secret key (`sb_secret_...`, then `SUPABASE_SECRET_KEY` in `.env.local`,
  now `PROJECT_SECRET_KEY`) returns 200 on both REST and
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
`.env.local` (which at the time still called them `SUPABASE_URL`/
`SUPABASE_SECRET_KEY`; the web app has since adopted the same `PROJECT_*`
names, because Lovable's secret store refuses the prefix too — see "Secrets").
Anyone redeploying this function to a new project needs to set those two
names, not the `SUPABASE_*` ones.

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
