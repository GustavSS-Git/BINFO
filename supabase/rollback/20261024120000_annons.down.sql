-- Full schema undo of supabase/migrations/20261024120000_annons.sql.
--
-- NEVER applied automatically (this directory is not a migrations
-- directory). Run only on the owner's command, by hand, against the target
-- database. It DESTROYS the annons_cache rows (a cache: nothing is lost that
-- a new fetch can't recreate). `property_input.kalla` on existing analyses is
-- left as it is: the application schema just ignores/strips it.

begin;

-- Retention: restore the definition from 20261009120100_konto.sql (the one in
-- force before this migration): property_input anonymisation after 12 months
-- and the kvot purge, without `kalla` removal or the annons_cache purge.
select cron.unschedule('binfo-retention');

select cron.schedule(
  'binfo-retention',
  '30 4 * * *',
  $$
  update analys
     set property_input = property_input
         || jsonb_build_object('adress', '', 'postnummer', '', 'orgnr', '')
   where created_at < now() - interval '12 months'
     and (   coalesce(property_input->>'adress', '') <> ''
          or coalesce(property_input->>'postnummer', '') <> ''
          or coalesce(property_input->>'orgnr', '') <> '');
  delete from kvot
   where fonster_start < now() - interval '2 days';
  $$
);

drop table if exists annons_cache;

commit;
