-- v3 workstream W1: accounts (Supabase Auth) + saved valuations / kalkyler.
-- See docs/PLAN-v3.md §1.
--
-- Runs AFTER 20261009120100_konto.sql (needs `principal`, `analys.principal_id`,
-- sla_samman_principal, radera_principal) and 20261009120000_register.sql
-- (needs `rapport`, `forening`, `radera_analys`). Additive except for two
-- `create or replace` of functions defined in the konto migration
-- (sla_samman_principal and radera_principal): applied migrations are never
-- edited.
--
-- Rollback: supabase/rollback/20261013120000_konto_v3.down.sql (never applied
-- automatically).

-- ---------------------------------------------------------------------------
-- sparad_vardering: a valuation the account owner chose to save. `input` is
-- the PrisInput, `resultat` the PrisuppskattningResultat snapshot (recomputed
-- on the server at save time, never taken from the client), `modell_version`
-- the model it was produced with. Personal data the user chose to keep: kept
-- until the user deletes it or the account (exempt from the 12-month
-- anonymisation, like the account itself).
-- ---------------------------------------------------------------------------

create table sparad_vardering (
  id             uuid primary key default gen_random_uuid(),
  principal_id   uuid not null references principal (id) on delete cascade,
  etikett        text null check (etikett is null or char_length(etikett) <= 120),
  input          jsonb not null,
  resultat       jsonb not null,
  modell_version text not null,
  skapad         timestamptz not null default now()
);

create index sparad_vardering_principal_skapad_idx
  on sparad_vardering (principal_id, skapad desc);

-- ---------------------------------------------------------------------------
-- sparad_kalkyl: a saved bolånekalkyl. `input` is a KalkylUnderlag (versioned
-- by its own `version` field), `sammanfattning` the list-view key results,
-- `regelversion` the rules registry version the summary was computed with.
-- ---------------------------------------------------------------------------

create table sparad_kalkyl (
  id             uuid primary key default gen_random_uuid(),
  principal_id   uuid not null references principal (id) on delete cascade,
  etikett        text null check (etikett is null or char_length(etikett) <= 120),
  input          jsonb not null,
  sammanfattning jsonb not null,
  regelversion   text not null,
  skapad         timestamptz not null default now(),
  uppdaterad     timestamptz not null default now()
);

create index sparad_kalkyl_principal_skapad_idx
  on sparad_kalkyl (principal_id, skapad desc);

alter table sparad_vardering enable row level security;
alter table sparad_kalkyl    enable row level security;
-- Deliberately no policies (RLS on + zero policies = deny anon and
-- authenticated); the server uses the secret key and filters on the session's
-- principal. The table privileges are also revoked, as defence in depth.

revoke all on table sparad_vardering from anon, authenticated;
revoke all on table sparad_kalkyl    from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Functions. `security invoker`, pinned search_path, service_role only (same
-- convention as 20261009120100_konto.sql).
-- ---------------------------------------------------------------------------

-- The account's principal for a Supabase Auth user: created on first sign-in
-- (typ 'konto', auth_user_id set), idempotent and race-safe (the unique
-- auth_user_id settles concurrent first requests). When p_enhet_id is given
-- and that device has an anonymous principal that is not merged anywhere yet,
-- it is merged into the account (sla_samman_principal) - once: afterwards the
-- device row has sammanslagen_till set, so it is never moved again, not even
-- to another account that signs in on the same device. Returns
-- {principal_id, sammanslagen}.
create or replace function sakerstall_konto_principal(p_auth_user_id uuid, p_enhet_id text default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_enhet_principal uuid;
  v_enhet_till uuid;
  v_sammanslagen boolean := false;
begin
  if p_auth_user_id is null then
    raise exception 'sakerstall_konto_principal: p_auth_user_id is required';
  end if;

  select id into v_id from principal where auth_user_id = p_auth_user_id;
  if v_id is null then
    insert into principal (typ, auth_user_id)
    values ('konto', p_auth_user_id)
    on conflict (auth_user_id) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from principal where auth_user_id = p_auth_user_id;
    end if;
  end if;

  if p_enhet_id is not null and length(p_enhet_id) > 0 then
    -- `for update` serialises two requests merging the same device.
    select id, sammanslagen_till into v_enhet_principal, v_enhet_till
      from principal
     where enhet_id = p_enhet_id
       and typ = 'anonym'
       for update;
    if found and v_enhet_till is null and v_enhet_principal <> v_id then
      perform sla_samman_principal(v_enhet_principal, v_id);
      v_sammanslagen := true;
    end if;
  end if;

  return jsonb_build_object('principal_id', v_id, 'sammanslagen', v_sammanslagen);
end;
$$;

-- Replaces the konto-migration version: a merge moves the saved items too.
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

  update analys           set principal_id = p_till where principal_id = p_fran;
  update behorighet       set principal_id = p_till where principal_id = p_fran;
  update sparad_vardering set principal_id = p_till where principal_id = p_fran;
  update sparad_kalkyl    set principal_id = p_till where principal_id = p_fran;
end;
$$;

-- GDPR erasure, now also deleting the saved items (the FK cascade would do it
-- too; deleting explicitly gives the counts). Everything else as in the
-- konto migration.
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
  v_varderingar int := 0;
  v_kalkyler int := 0;
begin
  select coalesce(array_agg(id), '{}'),
         coalesce(array_agg(enhet_id) filter (where enhet_id is not null), '{}')
    into v_ids, v_enheter
    from principal
   where id = p_id
      or sammanslagen_till = p_id;

  if cardinality(v_ids) = 0 then
    return jsonb_build_object(
      'principaler', 0, 'analyser', 0, 'behorigheter', 0, 'kvotrader', 0,
      'sparade_varderingar', 0, 'sparade_kalkyler', 0
    );
  end if;

  delete from analys where principal_id = any (v_ids);
  get diagnostics v_analyser = row_count;

  delete from behorighet where principal_id = any (v_ids);
  get diagnostics v_behorigheter = row_count;

  delete from sparad_vardering where principal_id = any (v_ids);
  get diagnostics v_varderingar = row_count;

  delete from sparad_kalkyl where principal_id = any (v_ids);
  get diagnostics v_kalkyler = row_count;

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
    'kvotrader', v_kvot,
    'sparade_varderingar', v_varderingar,
    'sparade_kalkyler', v_kalkyler
  );
end;
$$;

-- The account's analyses for the profile list: only the columns the list
-- shows (never the extraction/judgement jsonb as a whole - just the grade out
-- of the judgement). A v2 row reads status/stage/error from its rapport; a
-- legacy row (rapport_id null) from itself. `betyg` only for a finished
-- rapport. `adress` is null once retention has blanked it.
create or replace function lista_mina_analyser(p_principal uuid)
returns table (
  analys_id    uuid,
  skapad       timestamptz,
  status       text,
  stage        text,
  error_code   text,
  orgnr        text,
  namn         text,
  rakenskapsar int,
  betyg        text,
  adress       text,
  utgangspris  numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select a.id,
         a.created_at,
         coalesce(r.status::text, a.status::text),
         coalesce(r.stage::text, a.stage::text),
         coalesce(r.error_code, a.error_code),
         r.orgnr,
         f.namn,
         r.rakenskapsar,
         case when r.status = 'done' then r.judgement ->> 'betyg' end,
         nullif(a.property_input ->> 'adress', ''),
         case when (a.property_input ->> 'utgangspris') ~ '^[0-9]+(\.[0-9]+)?$'
              then (a.property_input ->> 'utgangspris')::numeric end
    from analys a
    left join rapport  r on r.id = a.rapport_id
    left join forening f on f.orgnr = r.orgnr
   where a.principal_id = p_principal
   order by a.created_at desc
   limit 500;
$$;

-- "Ta bort från min lista": deletes ONE of the principal's own analys rows
-- through the existing radera_analys (the register-linked rapport and file
-- are never touched). Ownership is part of the statement, so another
-- principal's id deletes nothing. Returns {borttagen, pdf_blev_forlorad}.
create or replace function radera_min_analys(p_principal uuid, p_analys uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_forlorad boolean;
begin
  if not exists (select 1 from analys where id = p_analys and principal_id = p_principal) then
    return jsonb_build_object('borttagen', false, 'pdf_blev_forlorad', false);
  end if;
  v_forlorad := radera_analys(p_analys);
  return jsonb_build_object('borttagen', true, 'pdf_blev_forlorad', coalesce(v_forlorad, false));
end;
$$;

revoke execute on function sakerstall_konto_principal(uuid, text) from public, anon, authenticated;
revoke execute on function sla_samman_principal(uuid, uuid)       from public, anon, authenticated;
revoke execute on function radera_principal(uuid)                 from public, anon, authenticated;
revoke execute on function lista_mina_analyser(uuid)              from public, anon, authenticated;
revoke execute on function radera_min_analys(uuid, uuid)          from public, anon, authenticated;

grant execute on function sakerstall_konto_principal(uuid, text)  to service_role;
grant execute on function sla_samman_principal(uuid, uuid)        to service_role;
grant execute on function radera_principal(uuid)                  to service_role;
grant execute on function lista_mina_analyser(uuid)               to service_role;
grant execute on function radera_min_analys(uuid, uuid)           to service_role;
