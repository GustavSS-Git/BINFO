-- GDPR retention: 30 days after an analysis is created, clear the fields in
-- property_input that identify a specific apartment or cooperative (adress,
-- postnummer, orgnr). Owner decision 2026-09-24. The PDF itself is already
-- deleted after 30 days by 'binfo-retention'; this extends the same job.
--
-- Keys are set to "" rather than removed: PropertyInputSchema requires them
-- as strings, and hamtaResultat re-assembles the result from property_input
-- on every read. An anonymised report therefore still opens; it just loses
-- the address line and falls back to non-local price comparisons.

-- Replace the existing job (created in 20260913105304_init.sql) rather than
-- editing that applied migration.
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

-- One-off backfill for rows already older than 30 days.
update analys
   set property_input = property_input
       || jsonb_build_object('adress', '', 'postnummer', '', 'orgnr', '')
 where created_at < now() - interval '30 days'
   and (   coalesce(property_input->>'adress', '') <> ''
        or coalesce(property_input->>'postnummer', '') <> ''
        or coalesce(property_input->>'orgnr', '') <> '');
