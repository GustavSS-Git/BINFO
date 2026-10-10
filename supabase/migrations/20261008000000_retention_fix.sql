-- Hotfix: make the nightly GDPR anonymisation run again.
--
-- The 'binfo-retention' command scheduled by 20260924120000 starts with a
-- direct `delete from storage.objects`. Current Supabase Storage refuses that
-- (the `protect_objects_delete` trigger: "Direct deletion from storage tables
-- is not allowed"). pg_cron runs the whole command as one transaction, so the
-- error also rolls back the property_input anonymisation that follows it —
-- verified on a local stack running the same storage-api version (v1.73.1):
-- cron.job_run_details = failed, property_input unchanged.
--
-- This migration is deliberately standalone and ordered BEFORE the v2
-- migrations (20261009120000_register, 20261009120100_konto), so it can be
-- applied to production on its own, ahead of v2. The konto migration later
-- replaces this command again (it adds the kvot purge).
--
-- PDF deletion is dropped, not fixed: owner decision 2026-10-09 — annual
-- reports are kept for the register. `pdf_path` is left alone.
--
-- Period: the buyer's address/postnummer/orgnr are blanked after 12 MONTHS
-- (owner decision 2026-10-10, was 30 days): the register, the PDFs and the BRF
-- analysis are not personal data about the buyer and are never touched; only
-- the link "this visitor looked at this address" is, and a year lets buyers
-- return to their analysis (including the valuation, which needs postnummer).

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
  $$
);

-- One-off catch-up for rows that crossed the period while the job was failing.
update analys
   set property_input = property_input
       || jsonb_build_object('adress', '', 'postnummer', '', 'orgnr', '')
 where created_at < now() - interval '12 months'
   and (   coalesce(property_input->>'adress', '') <> ''
        or coalesce(property_input->>'postnummer', '') <> ''
        or coalesce(property_input->>'orgnr', '') <> '');
