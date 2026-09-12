# Supabase — schema, storage, secrets

Scope for step 3 of `GOLIVE.md`: the persistence layer Phase 1 needs before a
buyer's own upload can produce their own analysis. Read `GOLIVE.md` first for
why the job has to be asynchronous and what the caching is worth.

Decided already: **storage is Supabase**, **payment is deferred**, the app runs
on **Cloudflare Workers**.

---

## What the measurements force

Two numbers from the spikes drive every decision below.

**A cold run takes 195,9 s** (122,5 s pass 1 + 73,4 s pass 2). Nothing may hold
an HTTP request open for that. The upload returns immediately; the work happens
out of band; the client polls.

**PDF parsing costs 378 ms CPU** on the largest report. That is fine against
the Workers *paid* CPU budget (30 s) and far outside the free plan's per-request
allowance (10 ms at last check — verify, but 378 ms will not fit). **Budget for
Workers Paid.** It also means the pipeline cannot run on a free-tier Worker even
before the API latency is considered.

### Split pass 1 and pass 2 into separate jobs

Not one 196-second job — two jobs of ~122 s and ~73 s. This falls out of the
measurements and pays for itself three times over:

1. **It fits any runtime's limits.** A single 196 s invocation is at or past the
   ceiling of several serverless platforms (Supabase Edge Functions in
   particular — check the current wall-clock limit before assuming one
   invocation can do the whole run). Two shorter steps fit comfortably.
2. **It isolates the expensive half.** Pass 1 is 3,47 kr of the 4,25 kr. If
   pass 2 fails validation and retries, the current code would re-run pass 1
   too. Separate steps mean a pass-2 failure costs 0,79 kr to retry, not 4,25.
3. **It matches the cache boundary.** Both passes are cached independently
   anyway (below), so the job boundary and the cache boundary are the same
   line.

**Where the job runs** is the one piece still genuinely open — see the end.

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
2. **Set a retention period** for uploaded PDFs and delete on schedule. The
   cached `ExtractionResult` is derived, structured data and can reasonably
   outlive the source file — the PDF itself does not need keeping forever.
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
| 1 | Create the Supabase project, **EU region** | Blocking; region is permanent |
| 2 | `001_init.sql` — tables, enums, indexes, RLS, bucket | As above; commit the migration |
| 3 | `PROMPT_VERSION` in `prompts.ts` | Needed for the cache key |
| 4 | `src/server/env.ts` + `.env.example` | Zod-validated, fails loudly |
| 5 | `src/server/supabase.ts` | Service-role client, server-only |
| 6 | `src/server/cache.ts` | **Must re-apply `berikaNyckeltal` on read** |
| 7 | `src/server/spend.ts` | Daily cap + kill switch |
| 8 | `src/server/jobb.ts` | Pass 1 and pass 2 as separate steps |
| 9 | `src/server/analys.ts` | The three server functions |
| 10 | ESLint `no-restricted-imports` guard | Server modules out of client code |

Tests: the cache round-trip, the re-enrichment on read, the spend cap
refusing a run at the limit, and the dedupe path all have verifiable right
answers and get tests first, per the working agreement. Everything that talks
to Supabase gets the client injected so tests never need a live database.

---

## Still open

**1. Where does the job actually run?** The schema above is identical either
way, so this does not block starting — but it decides task 8.

- *Cloudflare Queues* (needs Workers Paid, which the CPU measurement says you
  need regardless): one platform, one set of secrets, consumers get generous
  wall time. Simplest fit given we already deploy there.
- *Cloudflare Workflows*: same platform, plus durable per-step retries — close
  to purpose-built for "two expensive steps that each might fail". Slightly
  more to learn.
- *Supabase Edge Functions*: keeps the job next to the data, but it is a second
  runtime (Deno), a second place the Anthropic key lives, and the wall-clock
  limit needs checking against our 122 s pass 1.

My lean: **Cloudflare Queues**, with the pass-1/pass-2 split making Workflows
unnecessary for now.

**2. Retention period for uploaded PDFs.** See the personal-data section.

**3. Do you already have a Supabase project?** If one exists and is not in an
EU region, that is worth fixing before anything is built on it.
