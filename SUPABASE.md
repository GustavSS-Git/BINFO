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

```sql
-- 001_init.sql

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

`prompt_version` does not exist yet. Add a `PROMPT_VERSION` constant to
`prompts.ts`, bumped by hand whenever a prompt changes, and include it in the
cache key — otherwise a prompt improvement silently serves stale output forever.

### Spend guard

`MAX_COST_PER_ANALYSIS_SEK` already caps one run. Nothing caps the day.

```sql
create table spend_day (
  day       date primary key,
  cost_sek  numeric(10,2) not null default 0,
  runs      int not null default 0
);
```

Checked before a job starts, incremented after it finishes. With a kill switch
in env, this is what stops a scripted upload loop from turning a bad night into
a bad month.

### Row Level Security

```sql
alter table analys           enable row level security;
alter table extraktion_cache enable row level security;
alter table analys_cache     enable row level security;
alter table spend_day        enable row level security;
-- Deliberately no policies. RLS on + zero policies = deny everything to anon
-- and authenticated. The Worker uses the service-role key, which bypasses RLS.
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

Not blocking the schema, but blocking launch, and cheaper to design in than to
retrofit.

---

## Secrets

Add to `.env.example` (and the Worker's secret store in production):

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=          # server only — never VITE_-prefixed, never in the browser
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

---

## Code layout — the fourth zone

`CLAUDE.md`'s boundary table has no home for server code. Proposed:

| Path | Contains | Rule |
|---|---|---|
| `src/server/` | Server functions, storage, job orchestration | May import `src/lib/analysis/` and the contract. **Nothing may import it back.** UI reaches it only through typed server functions. |

```
src/server/
  env.ts        -- Zod-validated env, throws loudly when a secret is missing
  supabase.ts   -- service-role client factory, server-only
  cache.ts      -- extraction/judgement cache read + write (re-enriches on read)
  spend.ts      -- daily cap + kill switch
  jobb.ts       -- the two pipeline steps, called by whatever runs the job
  analys.ts     -- server functions: skapaAnalys, hamtaStatus, hamtaResultat
```

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

| # | Task | Notes |
|---|---|---|
| 0 | ~~Create the Supabase project~~ | **Done** — live, key verified. Region still to confirm |
| 1 | **Deno spike**: `unpdf` + Anthropic SDK in an Edge Function | Blocking. workerd ≠ Deno; Phase 0 does not transfer |
| 2 | `001_init.sql` — tables, enums, indexes, RLS, bucket | As above; commit the migration |
| 3 | `PROMPT_VERSION` in `prompts.ts` | Needed for the cache key |
| 4 | `src/server/env.ts` + `.env.example` | Zod-validated, fails loudly |
| 5 | `src/server/supabase.ts` | Service-role client, server-only |
| 6 | `src/server/cache.ts` | **Must re-apply `berikaNyckeltal` on read** |
| 7 | `src/server/spend.ts` | Daily cap + kill switch |
| 8 | Code-sharing build step for the Edge Function | One source of truth; no forked pipeline |
| 9 | Edge Function: one pipeline step per invocation | Three steps; `attempts` counter |
| 10 | `pg_cron` schedule + retention job | Queue tick; 30-day PDF deletion |
| 11 | `src/server/analys.ts` | The three server functions |
| 12 | ESLint `no-restricted-imports` guard | Server modules out of client code |

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

### This invalidates part of the Phase 0 spike — honestly

`GOLIVE.md`'s Phase 0 verified the pipeline inside **Cloudflare workerd**, which
is what the *site* runs on. Supabase Edge Functions run **Deno**. That is a
different runtime, so the verification does not transfer. Before building on
this, re-run the equivalent spike under Deno: does `unpdf` parse a real PDF,
does `@anthropic-ai/sdk` work via `npm:` specifiers, does `toBase64` behave.
Both libraries claim edge/Deno support and the removal of `Buffer` and
`node:crypto` helps, but claiming it works without running it would be exactly
what `CLAUDE.md` forbids.

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

## Still open

**1. Which Supabase region is the project in?** Cannot be read from the URL —
check Settings → General. These PDFs name board members, so an EU region
(Stockholm/Frankfurt) matters, and region cannot be changed after creation. If
it landed outside the EU, recreating now is far cheaper than later.

**2. Supabase plan.** Free gives 150 s wall clock, which the three-step split
fits. But free projects pause after inactivity, which is not viable for a live
site — expect the paid plan once real users arrive, which also lifts wall clock
to 400 s and gives more headroom on the largest reports.

**3. Rotate the service key.** It was pasted into a chat transcript. Settings →
API → roll it, then update `.env.local` and the Edge Function secrets.
