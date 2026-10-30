-- Rollback of 20261028120000_kopguide.sql. Never applied automatically; run
-- only on the owner's command and only after the code using the table is
-- reverted. DESTROYS every account's saved köpguide progress.

begin;

-- Restore the konto_v3 versions of the two functions.
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

drop table if exists kopguide_framsteg;

commit;
