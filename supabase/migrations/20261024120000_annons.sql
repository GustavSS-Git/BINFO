-- Booli prefill round (2026-10-24, PLAN.md): the listing-fetch cache and the
-- retention for the listing URL stored on an analysis.
--
-- Additive only: one new table, and the replacement of the `binfo-retention`
-- cron command. Runs after 20261013120100_register_v3.sql.
--
-- Ownership: THIS migration now owns the final `binfo-retention` command
-- (replaces the one from 20261009120100_konto.sql). Every statement of that
-- definition is kept verbatim; the two additions are marked below.
--
-- Rollback: supabase/rollback/20261024120000_annons.down.sql (never applied
-- automatically).

-- ---------------------------------------------------------------------------
-- annons_cache: one row per canonical listing URL
-- (`https://www.booli.se/<bostad|annons>/<id>`), holding the normalised answer
-- of "Hämta uppgifter" (src/server/annons/hamta.ts). Only successful answers
-- are written. The service treats a row older than 24 h as stale; rows older
-- than 2 days are purged by binfo-retention. The URL identifies a flat's
-- address, hence the short life.
-- ---------------------------------------------------------------------------

create table annons_cache (
  url    text primary key,
  svar   jsonb not null,
  hamtad timestamptz not null default now()
);

alter table annons_cache enable row level security;
-- Deliberately no policies, like the other server-only tables: RLS on + zero
-- policies = deny anon and authenticated. The server uses the secret key.
-- The table privileges are also revoked, as defence in depth.
revoke all on table annons_cache from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Retention (this migration owns the final command).
--   * KEPT (verbatim from 20261009120100_konto.sql): property_input
--     anonymisation after 12 months (adress/postnummer/orgnr blanked), and the
--     purge of kvot windows older than 2 days.
--   * ADDED (a): in the same 12-month anonymisation, `kalla` (the listing URL
--     + broker link of the Booli prefill, which identify the address) is
--     removed from property_input. The row filter also matches rows where only
--     `kalla` is left to remove.
--   * ADDED (b): annons_cache rows older than 2 days are deleted.
-- ---------------------------------------------------------------------------

select cron.unschedule('binfo-retention');

select cron.schedule(
  'binfo-retention',
  '30 4 * * *',
  $$
  update analys
     set property_input = (property_input
         || jsonb_build_object('adress', '', 'postnummer', '', 'orgnr', '')) - 'kalla'
   where created_at < now() - interval '12 months'
     and (   coalesce(property_input->>'adress', '') <> ''
          or coalesce(property_input->>'postnummer', '') <> ''
          or coalesce(property_input->>'orgnr', '') <> ''
          or property_input ? 'kalla');
  delete from kvot
   where fonster_start < now() - interval '2 days';
  delete from annons_cache
   where hamtad < now() - interval '2 days';
  $$
);
