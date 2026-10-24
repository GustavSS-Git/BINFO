-- Fee prognosis round (2026-10-24b, PLAN.md): a one-row-per-series cache of the
-- reference rate used for "new rate = reference rate + BRF margin"
-- (src/server/referensranta.ts; docs/avgiftsprognos.md). Today the series is
-- the Riksbank's 3-month T-bill (SETB3MBENCH): STIBOR is not available.
--
-- Additive only: one new table. Not buyer data, so no retention rule.
-- Rollback: supabase/rollback/20261025120000_referensranta.down.sql (never
-- applied automatically).

create table referensranta (
  serie   text primary key,
  -- Observation date of the value (the Riksbank's own date).
  datum   date not null,
  procent numeric not null,
  -- When Binfo fetched it; the service refetches once per Stockholm day.
  hamtad  timestamptz not null default now()
);

alter table referensranta enable row level security;
-- Deliberately no policies, like the other server-only tables: RLS on + zero
-- policies = deny anon and authenticated. The server uses the secret key.
revoke all on table referensranta from anon, authenticated;
