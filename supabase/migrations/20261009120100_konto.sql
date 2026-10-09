-- Workstream 4: account-ready infrastructure without accounts.
-- See docs/PLAN-v2.md §4 and §8.
--
-- Runs AFTER 20261009120000_register.sql (needs `rapport`). Additive only:
-- new tables, one nullable column on `analys`, new functions, and the
-- replacement of the `binfo-retention` cron command.
--
-- Rollback: supabase/rollback/20261009120100_konto.down.sql (never applied
-- automatically).

-- ---------------------------------------------------------------------------
-- principal: who a per-user request belongs to. Today one row per anonymous
-- device (cookie `binfo_enhet`), created lazily on the first expensive
-- action. Later a Supabase Auth account either sets `auth_user_id` on the
-- device row or the device row is merged into the account row via
-- `sammanslagen_till` (see sla_samman_principal).
-- ---------------------------------------------------------------------------

create table principal (
  id                uuid primary key default gen_random_uuid(),
  typ               text not null check (typ in ('anonym', 'konto')),
  -- The random device id from the httpOnly cookie. Not derived from anything
  -- about the person; null for a pure account principal.
  enhet_id          text unique null,
  auth_user_id      uuid null unique references auth.users (id) on delete set null,
  skapad            timestamptz not null default now(),
  senast_sedd       timestamptz not null default now(),
  -- Kept single-level: sla_samman_principal re-points anything already
  -- merged into `fran` straight at `till`.
  sammanslagen_till uuid null references principal (id)
);

create index principal_sammanslagen_till_idx on principal (sammanslagen_till)
  where sammanslagen_till is not null;

alter table analys add column principal_id uuid null references principal (id) on delete set null;

create index analys_principal_id_idx on analys (principal_id) where principal_id is not null;

-- ---------------------------------------------------------------------------
-- behorighet: entitlements. Created now and deliberately left EMPTY — today
-- every capability is granted to everyone by the policy table in
-- src/server/behorighet.ts. Future per-analysis payment = a row with
-- kalla 'kop' and a rapport_id, plus one policy line in that file.
-- ---------------------------------------------------------------------------

create table behorighet (
  id           uuid primary key default gen_random_uuid(),
  principal_id uuid not null references principal (id) on delete cascade,
  formaga      text not null,
  kalla        text not null check (kalla in ('gratis', 'kop', 'prenumeration')),
  rapport_id   uuid null references rapport (id),
  giltig_till  timestamptz null,
  skapad       timestamptz default now()
);

create index behorighet_principal_id_idx on behorighet (principal_id);

-- ---------------------------------------------------------------------------
-- kvot: fixed-window rate-limit counters. `nyckel` is
-- '<handling>:enhet:<device id>' or '<handling>:ip:<HMAC of the IP>' — the
-- raw IP is never stored. Rows older than 2 days are purged by
-- binfo-retention.
-- ---------------------------------------------------------------------------

create table kvot (
  nyckel        text not null,
  fonster_start timestamptz not null,
  antal         int not null default 0,
  primary key (nyckel, fonster_start)
);

alter table principal  enable row level security;
alter table behorighet enable row level security;
alter table kvot       enable row level security;
-- Deliberately no policies, like the existing tables: RLS on + zero policies
-- = deny anon and authenticated. The server uses the secret key.

-- ---------------------------------------------------------------------------
-- Functions. All `security invoker` (the only caller holds the secret key)
-- with a pinned search_path, and not executable by public/anon/authenticated.
-- ---------------------------------------------------------------------------

-- Window start = floor(epoch / window) * window, i.e. UTC-aligned fixed
-- windows (a day window resets at 00:00 UTC).
create or replace function kvot_fonster_start(p_fonster_sek int)
returns timestamptz
language sql
stable
security invoker
set search_path = public
as $$
  select to_timestamp(floor(extract(epoch from now()) / p_fonster_sek) * p_fonster_sek);
$$;

-- Atomic take: insert the window row if missing, then increment only while
-- the result stays <= p_max. A refused call changes nothing (same pattern as
-- reservera_spend). Under concurrency the conditional UPDATE re-checks the
-- row after acquiring its lock, so two racing calls can't both pass the cap.
create or replace function ta_kvot(p_nyckel text, p_fonster_sek int, p_max int)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_start timestamptz;
  v_ok boolean;
begin
  if p_fonster_sek is null or p_fonster_sek <= 0 then
    raise exception 'ta_kvot: p_fonster_sek must be > 0, got %', p_fonster_sek;
  end if;
  v_start := kvot_fonster_start(p_fonster_sek);

  insert into kvot (nyckel, fonster_start, antal)
  values (p_nyckel, v_start, 0)
  on conflict (nyckel, fonster_start) do nothing;

  update kvot
     set antal = antal + 1
   where nyckel = p_nyckel
     and fonster_start = v_start
     and antal + 1 <= p_max
  returning true into v_ok;

  return coalesce(v_ok, false);
end;
$$;

-- Give back one use in the current window (never below zero). Used when a
-- later limit in the same request refuses after an earlier one was taken.
create or replace function aterlamna_kvot(p_nyckel text, p_fonster_sek int)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_fonster_sek is null or p_fonster_sek <= 0 then
    raise exception 'aterlamna_kvot: p_fonster_sek must be > 0, got %', p_fonster_sek;
  end if;
  update kvot
     set antal = antal - 1
   where nyckel = p_nyckel
     and fonster_start = kvot_fonster_start(p_fonster_sek)
     and antal > 0;
end;
$$;

-- Insert-or-touch the anonymous principal for a device. Never changes `typ`
-- of an existing row. Follows a merge one level (merges are kept
-- single-level by sla_samman_principal).
create or replace function sakerstall_principal(p_enhet_id text)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_till uuid;
begin
  if p_enhet_id is null or length(p_enhet_id) = 0 then
    raise exception 'sakerstall_principal: p_enhet_id is required';
  end if;

  insert into principal (typ, enhet_id)
  values ('anonym', p_enhet_id)
  on conflict (enhet_id) do update set senast_sedd = now()
  returning id, sammanslagen_till into v_id, v_till;

  return coalesce(v_till, v_id);
end;
$$;

-- Future account claim: merge principal p_fran into p_till.
create or replace function sla_samman_principal(p_fran uuid, p_till uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_till_sammanslagen uuid;
begin
  if p_fran is null or p_till is null or p_fran = p_till then
    raise exception 'sla_samman_principal: two different principal ids are required';
  end if;
  if not exists (select 1 from principal where id = p_fran) then
    raise exception 'sla_samman_principal: unknown principal %', p_fran;
  end if;
  select sammanslagen_till into v_till_sammanslagen from principal where id = p_till;
  if not found then
    raise exception 'sla_samman_principal: unknown principal %', p_till;
  end if;
  if v_till_sammanslagen is not null then
    raise exception 'sla_samman_principal: target % is itself merged', p_till;
  end if;

  update principal
     set sammanslagen_till = p_till
   where id = p_fran
      or sammanslagen_till = p_fran;

  update analys     set principal_id = p_till where principal_id = p_fran;
  update behorighet set principal_id = p_till where principal_id = p_fran;
end;
$$;

-- GDPR erasure. Deletes the principal, every principal merged into it,
-- their analys rows (property_input is the personal data), behorighet rows,
-- and their device-keyed kvot rows. IP-keyed kvot rows can't be tied to a
-- principal; they hold only an HMAC and are purged after 2 days anyway.
-- Register data (rapport, rapport_fil, forening, ...) and the shared caches
-- are untouched: they are derived from public documents and name no buyer.
-- Returns counts. Unknown id -> all zeros.
create or replace function radera_principal(p_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ids uuid[];
  v_enheter text[];
  v_analyser int := 0;
  v_behorigheter int := 0;
  v_kvot int := 0;
  v_principaler int := 0;
begin
  select coalesce(array_agg(id), '{}'),
         coalesce(array_agg(enhet_id) filter (where enhet_id is not null), '{}')
    into v_ids, v_enheter
    from principal
   where id = p_id
      or sammanslagen_till = p_id;

  if cardinality(v_ids) = 0 then
    return jsonb_build_object('principaler', 0, 'analyser', 0, 'behorigheter', 0, 'kvotrader', 0);
  end if;

  delete from analys where principal_id = any (v_ids);
  get diagnostics v_analyser = row_count;

  delete from behorighet where principal_id = any (v_ids);
  get diagnostics v_behorigheter = row_count;

  -- Exact suffix match, not LIKE: base64url device ids contain '_', which
  -- LIKE would treat as a wildcard.
  delete from kvot k
   where exists (
     select 1 from unnest(v_enheter) as e(enhet_id)
      where right(k.nyckel, length(':enhet:' || e.enhet_id)) = ':enhet:' || e.enhet_id
   );
  get diagnostics v_kvot = row_count;

  update principal set sammanslagen_till = null where id = any (v_ids);
  delete from principal where id = any (v_ids);
  get diagnostics v_principaler = row_count;

  return jsonb_build_object(
    'principaler', v_principaler,
    'analyser', v_analyser,
    'behorigheter', v_behorigheter,
    'kvotrader', v_kvot
  );
end;
$$;

revoke execute on function kvot_fonster_start(int)             from public, anon, authenticated;
revoke execute on function ta_kvot(text, int, int)              from public, anon, authenticated;
revoke execute on function aterlamna_kvot(text, int)            from public, anon, authenticated;
revoke execute on function sakerstall_principal(text)           from public, anon, authenticated;
revoke execute on function sla_samman_principal(uuid, uuid)     from public, anon, authenticated;
revoke execute on function radera_principal(uuid)               from public, anon, authenticated;

grant execute on function kvot_fonster_start(int)               to service_role;
grant execute on function ta_kvot(text, int, int)                to service_role;
grant execute on function aterlamna_kvot(text, int)              to service_role;
grant execute on function sakerstall_principal(text)             to service_role;
grant execute on function sla_samman_principal(uuid, uuid)       to service_role;
grant execute on function radera_principal(uuid)                 to service_role;

-- ---------------------------------------------------------------------------
-- Retention. This migration owns the final `binfo-retention` command
-- (replaces the one from 20260924120000_anonymise_property_input.sql):
--   * KEEP: property_input anonymisation (adress/postnummer/orgnr blanked
--     after 30 days).
--   * REMOVED: storage-object deletion and `pdf_path = null` — owner
--     decision 2026-10-09: PDFs are kept indefinitely (register).
--   * ADDED: purge kvot windows older than 2 days.
-- ---------------------------------------------------------------------------

select cron.unschedule('binfo-retention');

select cron.schedule(
  'binfo-retention',
  '30 4 * * *',
  $$
  update analys
     set property_input = property_input
         || jsonb_build_object('adress', '', 'postnummer', '', 'orgnr', '')
   where created_at < now() - interval '30 days'
     and (   coalesce(property_input->>'adress', '') <> ''
          or coalesce(property_input->>'postnummer', '') <> ''
          or coalesce(property_input->>'orgnr', '') <> '');
  delete from kvot
   where fonster_start < now() - interval '2 days';
  $$
);
