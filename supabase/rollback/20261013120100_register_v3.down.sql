-- Full schema undo of supabase/migrations/20261013120100_register_v3.sql.
--
-- NEVER applied automatically (this directory is not a migrations
-- directory). Run only on the owner's command, by hand, and only after the
-- code that uses these objects is reverted. It destroys the register's slugs,
-- areas, slug history and summary rows (all derivable again from the rapporter
-- by re-running the worker's register step). pg_trgm is left installed.

begin;

drop function if exists satt_forening_omrade(text, text, text, text);
drop function if exists uppdatera_register_sammanfattning(text, text);
drop function if exists register_nyckeltal(jsonb, text);

drop table if exists register_sammanfattning;
drop table if exists forening_slug;

drop index if exists forening_namn_trgm_idx;
drop index if exists forening_registeromrade_idx;
alter table forening drop constraint if exists forening_slug_uniq;
alter table forening drop column if exists omrade_kalla;
alter table forening drop column if exists registeromrade;
alter table forening drop column if exists slug;

alter table rapport drop column if exists proveniens;

commit;
