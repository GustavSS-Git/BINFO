-- LaneUnderlag is being removed from the analysis pipeline: /bolanekalkyl
-- becomes a purely client-side calculator and no loan data is ever
-- persisted again. The server therefore stops writing analys.lan_underlag,
-- which would violate the not-null constraint from the init migration on
-- every future insert.
--
-- We do not drop the column here. Dropping it would mean editing the
-- already-applied init migration (rewriting history) or a separate destructive
-- migration on a table that is live in production, for a column that costs
-- nothing to leave in place. Instead: relax the constraint and mark the
-- column dead. It stays in the schema, unused, until a later cleanup chooses
-- to drop it.

alter table analys alter column lan_underlag drop not null;

comment on column analys.lan_underlag is
  'Dead. LaneUnderlag is no longer persisted — /bolanekalkyl is a client-side-only calculator. Column retained (nullable) to avoid a destructive migration on a live table; do not write to it.';
