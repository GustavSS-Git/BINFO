-- Binfo: analysis job queue, caches, spend guard, storage, RLS.
-- Design context: SUPABASE.md. Deliberately deviates from that doc's first
-- draft in three ways, each explained inline: no `result` column (the
-- finished AnalysisResult is assembled fresh on every read, so a benchmark
-- threshold change re-grades every past analysis for free); a `grundtext`
-- column instead of a förening-level cache for pass 1's intermediate
-- grounding text (see comment below); and an atomic claim/lease/attempts
-- mechanism instead of a bare status column, because pg_cron ticks every
-- minute but a single step can run well past that.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create type analys_status as enum ('queued', 'running', 'done', 'failed');
create type analys_stage  as enum ('uploaded', 'extracting', 'judging', 'complete');

-- One row per buyer's analysis job.
create table analys (
  id              uuid primary key default gen_random_uuid(),

  status          analys_status not null default 'queued',
  stage           analys_stage  not null default 'uploaded',

  pdf_hash        text not null,   -- sha256 hex; content address + cache key
  pdf_path        text,            -- object path in storage; nulled by retention after 30 days

  property_input  jsonb not null,  -- PropertyInput, validated by PropertyInputSchema before insert
  lan_underlag    jsonb not null,  -- LaneUnderlag — required, assembly needs it on every read

  -- Which model/prompt this job's cache entries are keyed by. Prevents a
  -- mid-flight deploy from mixing cache keys between this job's own steps.
  model           text not null,
  prompt_version  text not null,

  -- Pass 1's intermediate grounding text (see file-level comment on why this
  -- lives on the job row and not a shared cache). Set by step 1, consumed
  -- and nulled by step 2.
  grundtext       text,

  -- Claim/lease/retry. A tick claims a row by setting lease_until and
  -- bumping attempts; a row is claimable again once its lease expires.
  lease_until     timestamptz,
  attempts        int not null default 0,

  error_code      text,   -- 'scanned_pdf' | 'cost_cap' | 'daily_cap' | 'validation' | 'saknar_rantekanslighet' | 'unknown'
  error_message   text,   -- Swedish, safe to show the buyer verbatim

  cost_sek        numeric(10,2) not null default 0,

  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz
);

create index analys_pdf_hash_idx on analys (pdf_hash);
create index analys_created_at_idx on analys (created_at desc);
-- Partial index: the claim query only ever scans claimable rows, and it
-- stays small forever regardless of how large `analys` grows.
create index analys_klaim_idx on analys (created_at)
  where status in ('queued', 'running') and stage <> 'complete';

-- Pass 1 output. Keyed by the document, not by the buyer — every bidder on
-- every apartment in a förening uploads the same årsredovisning, so the
-- second buyer onward costs 0 kr.
create table extraktion_cache (
  pdf_hash        text not null,
  model           text not null,
  prompt_version  text not null,
  extraction      jsonb not null,
  schema_version  text not null,
  cost_sek        numeric(10,2) not null,
  orgnr           text,
  rakenskapsar    int,
  created_at      timestamptz not null default now(),
  primary key (pdf_hash, model, prompt_version)
);

-- Pass 2 output. Also förening-level.
create table analys_cache (
  pdf_hash        text not null,
  model           text not null,
  prompt_version  text not null,
  judgement       jsonb not null,
  cost_sek        numeric(10,2) not null,
  created_at      timestamptz not null default now(),
  primary key (pdf_hash, model, prompt_version)
);

create table spend_day (
  day       date primary key,
  cost_sek  numeric(10,2) not null default 0,
  -- Counts API-calling steps, not finished jobs — one analysis can
  -- contribute up to three.
  runs      int not null default 0
);

alter table analys           enable row level security;
alter table extraktion_cache enable row level security;
alter table analys_cache     enable row level security;
alter table spend_day        enable row level security;
-- Deliberately no policies. RLS on + zero policies = deny everything to
-- anon and authenticated. The server uses the secret key, which bypasses
-- RLS — verified empirically by scripts/verify-rls, not assumed.

insert into storage.buckets (id, name, public)
values ('arsredovisningar', 'arsredovisningar', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Job control functions
-- ---------------------------------------------------------------------------

-- Atomically claims exactly one claimable row: not currently leased, under
-- its attempt limit, oldest first. `security invoker`, not `definer` — the
-- only caller already holds the secret key (which bypasses RLS on its own),
-- so `definer` would add an escalation path for zero benefit.
--
-- Lease is 300s, deliberately longer than the 150s Free-plan hard ceiling
-- on one invocation: a lease shorter than the longest possible run would let
-- a second tick claim a row that is still mid-API-call, and pay for the
-- same tokens twice.
create or replace function claim_next_steg(p_lease_sekunder int default 300)
returns analys
language sql
security invoker
as $$
  update analys a
     set status = 'running',
         attempts = a.attempts + 1,
         lease_until = now() + make_interval(secs => p_lease_sekunder),
         started_at = coalesce(a.started_at, now())
   where a.id = (
           select k.id from analys k
            where k.status in ('queued', 'running')
              and k.stage <> 'complete'
              and (k.lease_until is null or k.lease_until < now())
              and k.attempts < 3
            order by k.created_at
            for update skip locked
            limit 1
         )
  returning a.*;
$$;

-- Returns a claimed row to the queue. When p_ateranvand_forsok is true, the
-- attempt just consumed by claim_next_steg is refunded — used for the daily
-- spend cap refusal, which is not the job's fault and must not cost it one
-- of its three lives.
create or replace function slapp_steg(p_id uuid, p_ateranvand_forsok boolean)
returns void
language sql
security invoker
as $$
  update analys
     set status = 'queued',
         lease_until = null,
         attempts = case when p_ateranvand_forsok then greatest(attempts - 1, 0) else attempts end
   where id = p_id;
$$;

-- Marks jobs stuck at their attempt limit with an expired (or absent) lease
-- as permanently failed. Kept separate from claim_next_steg so the claim
-- itself stays a single, simple statement.
create or replace function binfo_reaper()
returns void
language sql
security invoker
as $$
  update analys
     set status = 'failed',
         error_code = coalesce(error_code, 'unknown'),
         error_message = coalesce(error_message, 'Analysen misslyckades upprepade gånger och avbröts.')
   where status in ('queued', 'running')
     and attempts >= 3
     and (lease_until is null or lease_until < now());
$$;

-- ---------------------------------------------------------------------------
-- Spend guard: atomic reserve-then-reconcile, not check-then-increment.
-- Two concurrent reservations that would together cross the cap must not
-- both succeed — the daily cap is what stands between a scripted upload
-- loop and a bad month, so it has to be an atomic check, not a race.
-- ---------------------------------------------------------------------------

-- plpgsql, not sql: the cap must be checked identically whether or not
-- today's row already exists. An `insert ... on conflict do update ... where`
-- in one statement only gates the UPDATE branch — the day's very FIRST
-- reservation takes the plain INSERT branch instead and would bypass the cap
-- entirely, which defeats the one guard standing between a scripted upload
-- loop and a bad month. So the row is guaranteed to exist first (an
-- idempotent no-op insert), then a single UPDATE — gated the same way on
-- every call, first reservation of the day or the hundredth — applies the
-- actual reservation.
create or replace function reservera_spend(p_dag date, p_belopp numeric, p_tak numeric)
returns boolean
language plpgsql
security invoker
as $$
declare
  v_ok boolean;
begin
  insert into spend_day (day, cost_sek, runs)
  values (p_dag, 0, 0)
  on conflict (day) do nothing;

  update spend_day
     set cost_sek = cost_sek + p_belopp,
         runs = runs + 1
   where day = p_dag
     and cost_sek + p_belopp <= p_tak
  returning true into v_ok;

  return coalesce(v_ok, false);
end;
$$;

create or replace function avstam_spend(p_dag date, p_reserverat numeric, p_faktiskt numeric)
returns void
language sql
security invoker
as $$
  update spend_day
     set cost_sek = cost_sek - p_reserverat + p_faktiskt
   where day = p_dag;
$$;

-- ---------------------------------------------------------------------------
-- Deletion: a buyer's own row always goes; the shared PDF only when no
-- other analysis still references it (content-addressed storage is shared
-- across buyers). The derived cache rows are never deleted — they contain
-- no document and name no one, so they carry none of the retention risk.
-- Returns true when the caller should also delete the storage object.
-- ---------------------------------------------------------------------------

create or replace function radera_analys(p_id uuid)
returns boolean
language plpgsql
security invoker
as $$
declare
  v_hash text;
  v_forlorad boolean;
begin
  select pdf_hash into v_hash from analys where id = p_id;
  delete from analys where id = p_id;
  if v_hash is null then
    return false;
  end if;
  select not exists(select 1 from analys where pdf_hash = v_hash) into v_forlorad;
  return v_forlorad;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cron: the tick, a keep-alive independent of it, retention, and the reaper.
-- ---------------------------------------------------------------------------

-- Three claims per tick so throughput isn't capped at one job-step per
-- minute; claim_next_steg's `for update skip locked` makes concurrent
-- claims safe.
select cron.schedule(
  'binfo-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/analys-steg',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'automations_key')
    )
  )
  from generate_series(1, 3);
  $$
);

-- Deliberately independent of binfo-tick and pointed at the project's own
-- REST gateway, not the Edge Function: Supabase's Free-plan pause rule
-- counts user API/database requests over a 7-day window, so this traffic
-- must cross the API gateway — and disabling binfo-tick while debugging
-- must never put the project on a path toward being paused.
select cron.schedule(
  'binfo-keep-alive',
  '17 4 * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/rest/v1/spend_day?select=day&limit=1',
    headers := jsonb_build_object(
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'automations_key')
    )
  );
  $$
);

select cron.schedule(
  'binfo-retention',
  '30 4 * * *',
  $$
  delete from storage.objects
   where bucket_id = 'arsredovisningar'
     and created_at < now() - interval '30 days';
  update analys
     set pdf_path = null
   where pdf_path is not null
     and created_at < now() - interval '30 days';
  $$
);

select cron.schedule(
  'binfo-reaper',
  '*/5 * * * *',
  $$ select binfo_reaper(); $$
);
