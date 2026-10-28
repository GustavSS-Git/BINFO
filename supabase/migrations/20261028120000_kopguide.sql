-- Redesign v4 step 3c: persisted köpguide progress for accounts.
--
-- Runs AFTER 20261013120000_konto_v3.sql (needs `principal`, and re-creates
-- its sla_samman_principal / radera_principal with the new table added; no
-- later migration redefined them). Additive otherwise: applied migrations are
-- never edited.
--
-- One row per principal: the ids of the köpguide steps the user ticked off.
-- The step ids are validated in the application (src/lib/kopguide); the check
-- below only bounds the shape (at most 20 elements, each a-z, 2-20 characters).
-- `klara::text` renders a text[] as {a,b} (these characters never need
-- quoting), so one regex checks every element; a NULL element prints as NULL
-- and fails it.
--
-- Rollback: supabase/rollback/20261028120000_kopguide.down.sql (never applied
-- automatically).

create table kopguide_framsteg (
  principal_id uuid primary key references principal (id) on delete cascade,
  klara        text[] not null default '{}'
    check (
      cardinality(klara) <= 20
      and klara::text ~ '^\{([a-z]{2,20}(,[a-z]{2,20})*)?\}$'
    ),
  uppdaterad   timestamptz not null default now()
);

alter table kopguide_framsteg enable row level security;
-- Deliberately no policies (RLS on + zero policies = deny anon and
-- authenticated); the server uses the secret key and filters on the session's
-- principal. Table privileges are also revoked, as defence in depth.
revoke all on table kopguide_framsteg from anon, authenticated;

-- Replaces the konto_v3 version: a merge also unions the köpguide progress.
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

  -- Köpguidens framsteg: a primary key per principal, so the two rows are
  -- unioned into the survivor's row and the merged principal's row is dropped.
  insert into kopguide_framsteg (principal_id, klara, uppdaterad)
  select p_till, array_agg(distinct e order by e), now()
    from kopguide_framsteg k, unnest(k.klara) as e
   where k.principal_id in (p_fran, p_till)
  having count(*) > 0
  on conflict (principal_id) do update
    set klara = excluded.klara, uppdaterad = excluded.uppdaterad;
  delete from kopguide_framsteg where principal_id = p_fran;
end;
$$;

-- GDPR erasure, now also deleting the köpguide progress. Everything else as in
-- the konto_v3 version.
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

  -- Köpguidens framsteg (the FK cascade would also do it; the return value is
  -- unchanged on purpose).
  delete from kopguide_framsteg where principal_id = any (v_ids);

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

-- Same grants as the originals (create or replace keeps them; restated for
-- clarity and idempotence).
revoke execute on function sla_samman_principal(uuid, uuid) from public, anon, authenticated;
revoke execute on function radera_principal(uuid)           from public, anon, authenticated;
grant execute on function sla_samman_principal(uuid, uuid)  to service_role;
grant execute on function radera_principal(uuid)            to service_role;
