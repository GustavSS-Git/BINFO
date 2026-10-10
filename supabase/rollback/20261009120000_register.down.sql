-- Full schema undo of supabase/migrations/20261009120000_register.sql.
--
-- NEVER applied automatically (this directory is not a migrations
-- directory). Run only on the owner's command, by hand, against the target
-- database — and only after the code that uses these objects is reverted.
--
-- Order: run supabase/rollback/20261009120100_konto.down.sql FIRST
-- (behorighet references rapport).
--
-- It DESTROYS data: every forening, rapport, rapport_fil, sidtext and
-- forening_adress row, and the analys.rapport_id links. The PDFs in storage
-- are untouched (and stay: the konto down-script no longer restores the
-- 30-day PDF deletion — see its retention note).
--
-- Register-linked analys rows (rapport_id set) carry no results of their own
-- — those live on the rapport — and their own status/stage were never used
-- (always 'queued'/'uploaded'). Dropping the link would turn every one of
-- them into a legacy row the old worker runs from scratch (real Anthropic
-- spend). So, before dropping anything:
--   1. FINISHED buyers (their rapport, following ersatt_av once, is 'done')
--      keep their analysis: its extraction + judgement are copied into the
--      legacy caches under the analys row's own key (pdf_hash, model,
--      prompt_version — what the legacy read path looks up), and the row is
--      marked done/complete. Never failed.
--   2. Only rows whose rapport is NOT done are failed, with the same
--      buyer-facing "upload again" message as a version conflict. To re-run
--      them instead (at cost), delete that UPDATE before running this script.

begin;

create temporary table rollback_lankade on commit drop as
select a.id          as analys_id,
       a.pdf_hash    as pdf_hash,
       a.model       as model,
       a.prompt_version as prompt_version,
       r.status::text as rapport_status,  -- text: the enum is dropped below
       r.extraction  as extraction,
       r.judgement   as judgement,
       r.orgnr       as orgnr,
       r.rakenskapsar as rakenskapsar
  from analys a
  join rapport r1 on r1.id = a.rapport_id
  join rapport r  on r.id = case when r1.status = 'ersatt' then r1.ersatt_av else r1.id end
 where a.rapport_id is not null;

insert into extraktion_cache (pdf_hash, model, prompt_version, extraction, schema_version, cost_sek, orgnr, rakenskapsar)
select distinct on (pdf_hash, model, prompt_version)
       pdf_hash, model, prompt_version, extraction,
       coalesce(extraction->>'schemaVersion', '1.0.0'), 0, orgnr, rakenskapsar
  from rollback_lankade
 where rapport_status = 'done' and extraction is not null and judgement is not null
on conflict (pdf_hash, model, prompt_version) do nothing;

insert into analys_cache (pdf_hash, model, prompt_version, judgement, cost_sek)
select distinct on (pdf_hash, model, prompt_version)
       pdf_hash, model, prompt_version, judgement, 0
  from rollback_lankade
 where rapport_status = 'done' and extraction is not null and judgement is not null
on conflict (pdf_hash, model, prompt_version) do nothing;

update analys a
   set status = 'done',
       stage = 'complete',
       finished_at = coalesce(a.finished_at, now())
  from rollback_lankade l
 where l.analys_id = a.id
   and l.rapport_status = 'done'
   and l.extraction is not null
   and l.judgement is not null;

update analys a
   set status = 'failed',
       error_code = 'versionskonflikt',
       error_message = 'Binfo uppdaterades medan din analys väntade i kön. Ladda upp årsredovisningen igen om en stund, så körs den med den senaste versionen.',
       finished_at = coalesce(a.finished_at, now())
  from rollback_lankade l
 where l.analys_id = a.id
   and not (l.rapport_status = 'done' and l.extraction is not null and l.judgement is not null)
   and a.status in ('queued', 'running');

drop table rollback_lankade;

-- Restore the three function bodies exactly as 20260913105304_init.sql
-- created them (before the column they would otherwise mention is dropped).

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

-- New functions first: claim_next_rapport_steg's return type is the rapport
-- row type.
drop function if exists claim_next_rapport_steg(int);
drop function if exists slapp_rapport_steg(uuid, boolean);
drop function if exists registrera_forening(text, text);
drop function if exists registrera_forening_adress(text, text, text, text, text, text);

drop index if exists analys_rapport_id_idx;
alter table analys drop column if exists rapport_id;

drop table if exists forening_adress;
drop table if exists sidtext;
drop table if exists rapport_fil;
drop table if exists rapport;
drop table if exists forening;

drop type if exists rapport_stage;
drop type if exists rapport_status;

commit;
