-- Workstream 3: the register of analysed reports. See docs/PLAN-v2.md §3 and
-- §8, SUPABASE.md ("Register") and src/server/register.ts.
--
-- One shared `rapport` per årsredovisning, keyed on the BRF's orgnr +
-- räkenskapsår + pipeline version, so a report is analysed (and paid for)
-- once however many buyers upload it, and concurrent uploads of the same
-- report run once. A buyer's `analys` row becomes the per-user request and
-- points at its rapport via the new nullable `analys.rapport_id`; rows
-- without it (everything created before this migration) keep working exactly
-- as before — the legacy queue only ever claims those.
--
-- Additive only: new enums, tables, functions and one nullable column.
-- Replaces three existing function bodies (create or replace):
-- claim_next_steg (adds `rapport_id is null`), binfo_reaper (also reaps
-- rapport rows) and radera_analys (keeps PDFs the register references).
-- Retention (`binfo-retention`) is owned by 20261009120100_konto.sql.
--
-- Rollback: supabase/rollback/20261009120000_register.down.sql (never
-- applied automatically; run 20261009120100_konto.down.sql first).

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type rapport_status as enum ('queued', 'running', 'done', 'failed', 'ersatt');
create type rapport_stage  as enum (
  'identifiering',   -- cheap model call for orgnr/år/namn when the local scan could not
  'transkribering',  -- scanned reports (WS1); a stub until that ships
  'grundning',
  'extraktion',
  'bedomning',
  'klar'
);

-- ---------------------------------------------------------------------------
-- forening: one row per BRF (organisationsnummer).
-- ---------------------------------------------------------------------------

create table forening (
  orgnr        text primary key check (orgnr ~ '^\d{6}-\d{4}$'),
  namn         text,
  forst_sedd   timestamptz not null default now(),
  senast_sedd  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- rapport: one analysis of one report, shared by every buyer. Carries the
-- job (claim/lease/attempts, same semantics as analys) and the results.
-- ---------------------------------------------------------------------------

create table rapport (
  id                  uuid primary key default gen_random_uuid(),

  -- Identity: both or neither. Null = neither the local text scan nor the
  -- model could read it; such a rapport is reusable by hash only.
  orgnr               text null references forening (orgnr),
  rakenskapsar        int  null check (rakenskapsar between 1900 and 2200),

  -- `p<PROMPT_VERSION>.i<IDENTITET_PROMPT_VERSION>.s<schema major>` —
  -- PIPELINE_VERSION in src/server/register.ts. The worker refuses a row
  -- whose version is not its own (version guard).
  pipeline_version    text not null,
  model               text not null,
  textlager           text not null check (textlager in ('ok', 'saknas', 'trasigt')),

  status              rapport_status not null default 'queued',
  stage               rapport_stage  not null default 'identifiering',

  -- The exact bytes this rapport runs on (a rapport_fil key). Deliberately
  -- not a foreign key: rapport_fil references rapport, and the rapport is
  -- created first. A lazy re-run reuses another rapport's file this way.
  pdf_hash            text null,

  lease_until         timestamptz,
  attempts            int not null default 0,

  grundtext           text,     -- pass 1 intermediate; nulled once consumed
  extraction          jsonb,    -- ExtractionResult (validated on every read)
  judgement           jsonb,    -- AnalysJudgement  (validated on every read)

  error_code          text,     -- AnalysErrorCode values, plus 'ogiltigforklarad' (admin)
  error_message       text,     -- Swedish, safe to show the buyer verbatim

  cost_sek            numeric(10,2) not null default 0,
  cache_read_tokens   bigint not null default 0,
  cache_write_tokens  bigint not null default 0,

  created_at          timestamptz not null default now(),
  started_at          timestamptz,
  finished_at         timestamptz,

  -- Set with status 'ersatt': the rapport this one turned out to duplicate.
  ersatt_av           uuid null references rapport (id),

  constraint rapport_identitet_hel check ((orgnr is null) = (rakenskapsar is null)),
  constraint rapport_ersatt_har_mal check (status <> 'ersatt' or ersatt_av is not null)
);

-- THE concurrency lock: at most one live rapport per identity and version.
-- Failed and 'ersatt' rows drop out, so invalidating (status 'failed') frees
-- the slot. src/server/supabase.ts recognises a violation by this name.
create unique index rapport_identitet_uniq
  on rapport (orgnr, rakenskapsar, pipeline_version)
  where orgnr is not null
    and rakenskapsar is not null
    and status not in ('failed', 'ersatt');

-- The second lock: at most one live rapport per byte version and pipeline
-- version. Settles concurrent same-bytes uploads and concurrent lazy re-runs
-- of an identity-less rapport (which the identity index cannot see).
-- src/server/supabase.ts recognises a violation by this name too.
create unique index rapport_fil_version_uniq
  on rapport (pdf_hash, pipeline_version)
  where pdf_hash is not null
    and status not in ('failed', 'ersatt');

create index rapport_orgnr_ar_idx on rapport (orgnr, rakenskapsar);
-- Lookups by bytes need every status (re-run bookkeeping), so the partial
-- unique index above cannot serve them.
create index rapport_pdf_hash_idx on rapport (pdf_hash) where pdf_hash is not null;
create index rapport_created_at_idx on rapport (created_at desc);
-- Partial: the claim only ever scans claimable rows (same as analys_klaim_idx).
create index rapport_klaim_idx on rapport (created_at)
  where status in ('queued', 'running') and stage <> 'klar';

-- ---------------------------------------------------------------------------
-- rapport_fil: one row per byte version (sha256) of a report. The primary
-- key settles concurrent uploads of the same bytes (insert on conflict do
-- nothing; the loser reads the winner). PDFs are kept indefinitely.
-- ---------------------------------------------------------------------------

create table rapport_fil (
  pdf_hash   text primary key,
  rapport_id uuid not null references rapport (id),
  pdf_path   text not null,
  sidor      int,
  bytes      int,
  uppladdad  timestamptz not null default now()
);

create index rapport_fil_rapport_id_idx on rapport_fil (rapport_id);

-- ---------------------------------------------------------------------------
-- sidtext: per-page text of a rapport from another source than the PDF's own
-- text layer (WS1 scan transcription). Created now, unused until then.
-- ---------------------------------------------------------------------------

create table sidtext (
  rapport_id uuid not null references rapport (id) on delete cascade,
  sida       int  not null check (sida >= 1),
  text       text not null,
  kalla      text not null,
  primary key (rapport_id, sida)
);

-- ---------------------------------------------------------------------------
-- forening_adress: where a BRF is. kalla 'anvandare' rows come from a buyer's
-- postnummer and hold postnummer + kommun/område ONLY — never the street
-- address, which is per-user data and stays in analys.property_input
-- (anonymised after 30 days). kalla 'rapport' = the report's own address.
-- ---------------------------------------------------------------------------

create table forening_adress (
  id          uuid primary key default gen_random_uuid(),
  orgnr       text not null references forening (orgnr),
  postnummer  text null check (postnummer ~ '^\d{5}$'),
  kommun_kod  text null,
  omrade      text null,
  adress      text null,
  kalla       text not null check (kalla in ('rapport', 'anvandare')),
  forst_sedd  timestamptz not null default now(),
  senast_sedd timestamptz not null default now(),
  constraint forening_adress_uniq unique nulls not distinct (orgnr, postnummer, adress, kalla),
  constraint forening_adress_anvandare_utan_gata
    check (kalla <> 'anvandare' or (adress is null and postnummer is not null))
);

-- ---------------------------------------------------------------------------
-- analys → rapport
-- ---------------------------------------------------------------------------

alter table analys add column rapport_id uuid null references rapport (id);

create index analys_rapport_id_idx on analys (rapport_id) where rapport_id is not null;

-- ---------------------------------------------------------------------------
-- RLS: on, zero policies (deny all to anon/authenticated), as for every
-- other table. The server uses the secret key.
-- ---------------------------------------------------------------------------

alter table forening        enable row level security;
alter table rapport         enable row level security;
alter table rapport_fil     enable row level security;
alter table sidtext         enable row level security;
alter table forening_adress enable row level security;

-- ---------------------------------------------------------------------------
-- Legacy queue: identical to the init migration's claim_next_steg except for
-- `and k.rapport_id is null`, so it never claims a register-linked row
-- (whose job lives on the rapport). Old rows drain unchanged.
-- ---------------------------------------------------------------------------

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
              and k.rapport_id is null
            order by k.created_at
            for update skip locked
            limit 1
         )
  returning a.*;
$$;

-- ---------------------------------------------------------------------------
-- Register queue: same semantics as claim_next_steg / slapp_steg (see the
-- init migration for the lease and attempts rationale).
-- ---------------------------------------------------------------------------

create or replace function claim_next_rapport_steg(p_lease_sekunder int default 300)
returns rapport
language sql
security invoker
set search_path = public
as $$
  update rapport r
     set status = 'running',
         attempts = r.attempts + 1,
         lease_until = now() + make_interval(secs => p_lease_sekunder),
         started_at = coalesce(r.started_at, now())
   where r.id = (
           select k.id from rapport k
            where k.status in ('queued', 'running')
              and k.stage <> 'klar'
              and (k.lease_until is null or k.lease_until < now())
              and k.attempts < 3
            order by k.created_at
            for update skip locked
            limit 1
         )
  returning r.*;
$$;

-- Unlike slapp_steg, only touches a row still in the queue: a release can
-- never resurrect a done, failed or 'ersatt' rapport.
create or replace function slapp_rapport_steg(p_id uuid, p_ateranvand_forsok boolean)
returns void
language sql
security invoker
set search_path = public
as $$
  update rapport
     set status = 'queued',
         lease_until = null,
         attempts = case when p_ateranvand_forsok then greatest(attempts - 1, 0) else attempts end
   where id = p_id
     and status in ('queued', 'running');
$$;

-- Init migration's body, plus the same sweep over rapport.
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

  update rapport
     set status = 'failed',
         lease_until = null,
         error_code = coalesce(error_code, 'unknown'),
         error_message = coalesce(error_message, 'Analysen misslyckades upprepade gånger och avbröts.'),
         finished_at = coalesce(finished_at, now())
   where status in ('queued', 'running')
     and attempts >= 3
     and (lease_until is null or lease_until < now());
$$;

-- ---------------------------------------------------------------------------
-- Upserts that PostgREST cannot express (coalescing a column on conflict).
-- ---------------------------------------------------------------------------

-- Insert, or bump senast_sedd and take a non-null name.
create or replace function registrera_forening(p_orgnr text, p_namn text)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into forening (orgnr, namn)
  values (p_orgnr, p_namn)
  on conflict (orgnr) do update
     set namn = coalesce(excluded.namn, forening.namn),
         senast_sedd = now();
$$;

create or replace function registrera_forening_adress(
  p_orgnr text,
  p_postnummer text,
  p_kommun_kod text,
  p_omrade text,
  p_adress text,
  p_kalla text
)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into forening_adress (orgnr, postnummer, kommun_kod, omrade, adress, kalla)
  values (p_orgnr, p_postnummer, p_kommun_kod, p_omrade, p_adress, p_kalla)
  on conflict on constraint forening_adress_uniq do update
     set kommun_kod = coalesce(excluded.kommun_kod, forening_adress.kommun_kod),
         omrade = coalesce(excluded.omrade, forening_adress.omrade),
         senast_sedd = now();
$$;

-- ---------------------------------------------------------------------------
-- Deletion: the init migration's body, except that a PDF the register still
-- references (rapport_fil) is never reported as orphaned — the register
-- keeps PDFs indefinitely (owner decision 2026-10-09) so reports can be
-- re-run on a version change.
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
  select not exists(select 1 from analys where pdf_hash = v_hash)
     and not exists(select 1 from rapport_fil where pdf_hash = v_hash)
    into v_forlorad;
  return v_forlorad;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: the new functions are for the server (secret key) only.
-- ---------------------------------------------------------------------------

revoke execute on function claim_next_rapport_steg(int)                          from public, anon, authenticated;
revoke execute on function slapp_rapport_steg(uuid, boolean)                     from public, anon, authenticated;
revoke execute on function registrera_forening(text, text)                       from public, anon, authenticated;
revoke execute on function registrera_forening_adress(text, text, text, text, text, text) from public, anon, authenticated;

grant execute on function claim_next_rapport_steg(int)                           to service_role;
grant execute on function slapp_rapport_steg(uuid, boolean)                      to service_role;
grant execute on function registrera_forening(text, text)                        to service_role;
grant execute on function registrera_forening_adress(text, text, text, text, text, text) to service_role;
