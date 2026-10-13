-- Workstream W3 (docs/PLAN-v3.md §2.2, §2.5, §3.2): what the public BRF
-- register needs on top of the v2 register.
--
--   * rapport.proveniens        where a result came from ('api' = the worker).
--   * forening.slug / registeromrade / omrade_kalla, forening_slug (renamed
--     slugs keep redirecting).
--   * pg_trgm + a trigram index on forening.namn (register search).
--   * register_sammanfattning   one row per BRF with the latest servable
--     report's seven nyckeltal as columns, kept by uppdatera_register_sammanfattning
--     (the worker calls it when a rapport completes). A plain table, not a
--     materialised view: one BRF is recomputed at a time, never the whole set.
--
-- Additive only. RLS on with zero policies, functions security invoker and
-- executable by service_role only, as for every other table.
-- Rollback: supabase/rollback/20261013120100_register_v3.down.sql (manual).

-- ---------------------------------------------------------------------------
-- Provenance
-- ---------------------------------------------------------------------------

alter table rapport
  add column proveniens text not null default 'api'
    check (proveniens in ('api', 'batch', 'offline-session'));

-- ---------------------------------------------------------------------------
-- forening: slug and register area
-- ---------------------------------------------------------------------------

alter table forening
  add column slug           text null,
  add column registeromrade text null,
  add column omrade_kalla   text null
    check (omrade_kalla in ('rapport_adress', 'import', 'anvandare'));

alter table forening add constraint forening_slug_uniq unique (slug);

create index forening_registeromrade_idx on forening (registeromrade)
  where registeromrade is not null;

-- A slug a BRF used to have. The register answers it with a 301 to the
-- current slug.
create table forening_slug (
  slug   text primary key,
  orgnr  text not null references forening (orgnr) on delete cascade,
  skapad timestamptz not null default now()
);

create index forening_slug_orgnr_idx on forening_slug (orgnr);

-- ---------------------------------------------------------------------------
-- Search
-- ---------------------------------------------------------------------------

create extension if not exists pg_trgm with schema extensions;

create index forening_namn_trgm_idx on forening using gin (namn extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- register_sammanfattning
-- ---------------------------------------------------------------------------

create table register_sammanfattning (
  orgnr            text primary key references forening (orgnr) on delete cascade,
  slug             text null,
  namn             text null,
  registeromrade   text null,
  rakenskapsar     int  not null,
  rapport_id       uuid not null references rapport (id),
  pipeline_version text not null,
  arsavgift_per_m2_brf_yta           numeric null,
  arsavgift_andel_av_rorelseintakter numeric null,
  skuldsattning_per_m2_totalyta      numeric null,
  skuldsattning_per_m2_brf_yta       numeric null,
  sparande_per_m2_totalyta           numeric null,
  rantekanslighet                    numeric null,
  energikostnad_per_m2_totalyta      numeric null,
  betyg            text null check (betyg in ('A', 'B', 'C', 'D', 'E')),
  analysdatum      timestamptz not null,
  uppdaterad       timestamptz not null default now()
);

create index register_sammanfattning_omrade_idx
  on register_sammanfattning (registeromrade, analysdatum desc)
  where registeromrade is not null;

-- The value of one key figure in a stored extraction (null when the figure is
-- missing, null or printed as a sign only such as "neg").
create or replace function register_nyckeltal(p_extraction jsonb, p_id text)
returns numeric
language sql
immutable
security invoker
set search_path = public
as $$
  select (kf -> 'figure' ->> 'value')::numeric
    from jsonb_array_elements(coalesce(p_extraction -> 'forening' -> 'keyFigures', '[]'::jsonb)) kf
   where kf ->> 'id' = p_id
   limit 1;
$$;

-- Recomputes the summary row of ONE BRF from its done rapporter: the latest
-- räkenskapsår, preferring a rapport at p_pipeline_version (the running
-- code's) over an older servable one, then the most recently finished. No done
-- rapport left (all invalidated) removes the row. The metadata (name, slug,
-- area) is read from `forening`, so call this after changing those too.
create or replace function uppdatera_register_sammanfattning(
  p_orgnr text,
  p_pipeline_version text default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  r rapport%rowtype;
  f forening%rowtype;
begin
  select * into r
    from rapport
   where orgnr = p_orgnr
     and status = 'done'
     and extraction is not null
     and judgement is not null
   order by rakenskapsar desc,
            (pipeline_version = p_pipeline_version) desc nulls last,
            finished_at desc nulls last
   limit 1;

  if not found then
    delete from register_sammanfattning where orgnr = p_orgnr;
    return;
  end if;

  select * into f from forening where orgnr = p_orgnr;

  insert into register_sammanfattning as s (
    orgnr, slug, namn, registeromrade, rakenskapsar, rapport_id, pipeline_version,
    arsavgift_per_m2_brf_yta, arsavgift_andel_av_rorelseintakter,
    skuldsattning_per_m2_totalyta, skuldsattning_per_m2_brf_yta,
    sparande_per_m2_totalyta, rantekanslighet, energikostnad_per_m2_totalyta,
    betyg, analysdatum, uppdaterad
  ) values (
    p_orgnr, f.slug, f.namn, f.registeromrade, r.rakenskapsar, r.id, r.pipeline_version,
    register_nyckeltal(r.extraction, 'arsavgift_per_m2_brf_yta'),
    register_nyckeltal(r.extraction, 'arsavgift_andel_av_rorelseintakter'),
    register_nyckeltal(r.extraction, 'skuldsattning_per_m2_totalyta'),
    register_nyckeltal(r.extraction, 'skuldsattning_per_m2_brf_yta'),
    register_nyckeltal(r.extraction, 'sparande_per_m2_totalyta'),
    register_nyckeltal(r.extraction, 'rantekanslighet'),
    register_nyckeltal(r.extraction, 'energikostnad_per_m2_totalyta'),
    case when r.judgement ->> 'betyg' in ('A', 'B', 'C', 'D', 'E') then r.judgement ->> 'betyg' end,
    coalesce(r.finished_at, r.created_at),
    now()
  )
  on conflict (orgnr) do update
     set slug = excluded.slug,
         namn = excluded.namn,
         registeromrade = excluded.registeromrade,
         rakenskapsar = excluded.rakenskapsar,
         rapport_id = excluded.rapport_id,
         pipeline_version = excluded.pipeline_version,
         arsavgift_per_m2_brf_yta = excluded.arsavgift_per_m2_brf_yta,
         arsavgift_andel_av_rorelseintakter = excluded.arsavgift_andel_av_rorelseintakter,
         skuldsattning_per_m2_totalyta = excluded.skuldsattning_per_m2_totalyta,
         skuldsattning_per_m2_brf_yta = excluded.skuldsattning_per_m2_brf_yta,
         sparande_per_m2_totalyta = excluded.sparande_per_m2_totalyta,
         rantekanslighet = excluded.rantekanslighet,
         energikostnad_per_m2_totalyta = excluded.energikostnad_per_m2_totalyta,
         betyg = excluded.betyg,
         analysdatum = excluded.analysdatum,
         uppdaterad = now();
end;
$$;

-- Sets slug / area of a BRF. A changed slug keeps the old one in
-- forening_slug. Null arguments leave the column as it is (a failed area
-- lookup must not erase a known area).
create or replace function satt_forening_omrade(
  p_orgnr text,
  p_slug text,
  p_registeromrade text,
  p_omrade_kalla text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_gammal text;
begin
  select slug into v_gammal from forening where orgnr = p_orgnr;
  if v_gammal is not null and p_slug is not null and v_gammal <> p_slug then
    insert into forening_slug (slug, orgnr) values (v_gammal, p_orgnr)
    on conflict (slug) do nothing;
  end if;
  update forening
     set slug = coalesce(p_slug, slug),
         registeromrade = coalesce(p_registeromrade, registeromrade),
         omrade_kalla = case
                          when p_registeromrade is not null then p_omrade_kalla
                          else omrade_kalla
                        end
   where orgnr = p_orgnr;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS and privileges
-- ---------------------------------------------------------------------------

alter table forening_slug          enable row level security;
alter table register_sammanfattning enable row level security;

revoke execute on function register_nyckeltal(jsonb, text)                          from public, anon, authenticated;
revoke execute on function uppdatera_register_sammanfattning(text, text)            from public, anon, authenticated;
revoke execute on function satt_forening_omrade(text, text, text, text)             from public, anon, authenticated;

grant execute on function register_nyckeltal(jsonb, text)                           to service_role;
grant execute on function uppdatera_register_sammanfattning(text, text)             to service_role;
grant execute on function satt_forening_omrade(text, text, text, text)              to service_role;
