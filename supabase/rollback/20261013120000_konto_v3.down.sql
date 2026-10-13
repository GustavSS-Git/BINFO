-- Full schema undo of supabase/migrations/20261013120000_konto_v3.sql.
--
-- NEVER applied automatically (this directory is not a migrations
-- directory). Run only on the owner's command, by hand, against the target
-- database - and only after the code that uses these objects is reverted.
-- It DESTROYS data: every saved valuation and saved kalkyl.
--
-- It does NOT delete Supabase Auth users or `principal` rows of typ 'konto'
-- (those belong to the konto migration / Auth): accounts keep existing, they
-- just lose their saved items. Run 20261009120100_konto.down.sql afterwards if
-- the whole account layer is being rolled back.

begin;

drop function if exists radera_min_analys(uuid, uuid);
drop function if exists lista_mina_analyser(uuid);
drop function if exists sakerstall_konto_principal(uuid, text);

-- Restore the konto-migration versions of the two replaced functions.
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

drop table if exists sparad_kalkyl;
drop table if exists sparad_vardering;

commit;
