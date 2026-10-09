-- Full schema undo of supabase/migrations/20261009120100_konto.sql.
--
-- NEVER applied automatically (this directory is not a migrations
-- directory). Run only on the owner's command, by hand, against the target
-- database — and only after the code that uses these objects is reverted.
-- It DESTROYS data: every principal, behorighet and kvot row, and the
-- analys.principal_id links.
--
-- If 20261009120000_register.sql is also being rolled back, run THIS script
-- first (behorighet references rapport).

begin;

-- Retention: restore the previous command exactly as
-- 20260924120000_anonymise_property_input.sql scheduled it — including the
-- 30-day PDF deletion. Re-enabling PDF deletion is a product decision: drop
-- the first two statements below if the PDFs should stay.
select cron.unschedule('binfo-retention');

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
  update analys
     set property_input = property_input
         || jsonb_build_object('adress', '', 'postnummer', '', 'orgnr', '')
   where created_at < now() - interval '30 days'
     and (   coalesce(property_input->>'adress', '') <> ''
          or coalesce(property_input->>'postnummer', '') <> ''
          or coalesce(property_input->>'orgnr', '') <> '');
  $$
);

drop function if exists radera_principal(uuid);
drop function if exists sla_samman_principal(uuid, uuid);
drop function if exists sakerstall_principal(text);
drop function if exists aterlamna_kvot(text, int);
drop function if exists ta_kvot(text, int, int);
drop function if exists kvot_fonster_start(int);

drop table if exists kvot;
drop table if exists behorighet;

drop index if exists analys_principal_id_idx;
alter table analys drop column if exists principal_id;

drop table if exists principal;

commit;
