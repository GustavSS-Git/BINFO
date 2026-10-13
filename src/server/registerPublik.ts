/**
 * The PUBLIC BRF register, read side (docs/PLAN-v3.md §2.5): area list, area
 * tables, one association's page, and the sitemap data.
 *
 * Strictly BRF-level. The only tables read are `register_sammanfattning`,
 * `forening`, `forening_slug` and the parse-only columns of `rapport`
 * (`RegisterLasning` in ./portar.ts); `analys`, `property_input`, the
 * principal tables and the PDF bucket are out of reach by construction. The
 * views carry nyckeltal with page references, betyg, röda flaggor, frågor till
 * styrelsen and data quality — never `input` or `prisanalys` (a test snapshots
 * the payload keys).
 *
 * Only associations with a `registeromrade` in the 19 areas or
 * `ovriga-stockholm` are listed; anything else answers "saknas" (404), as does
 * an unknown slug. A renamed association's old slug answers `omdirigera`.
 *
 * No framework imports: analysFn.ts binds these to server functions.
 */
import { osakerhetsfragor } from "@/lib/analysis/assemble";
import { REGISTEROMRADEN, OVRIGA_STOCKHOLM } from "@/lib/register/omraden";
import {
  REGISTER_SIDSTORLEK,
  tolkaRiktning,
  tolkaSida,
  tolkaSok,
  tolkaSortering,
  type RegisterArsvy,
  type RegisterForeningSvar,
  type RegisterForeningVy,
  type RegisterKvotSvar,
  type RegisterListaFraga,
  type RegisterListrad,
  type RegisterOmradeKort,
  type RegisterOmradenSvar,
  type RegisterOmradeSvar,
  type RegisterSitemapPost,
  type RegisterSortering,
} from "@/lib/registerVy";
import type { KontoDatabas } from "./kontoPortar";
import { TIMME_SEK, taKvot } from "./kvot";
import type { RegisterLasning, RegisterRapportRad, RegisterSorteringsKolumn } from "./portar";
import { PIPELINE_VERSION, tolkaRapportInnehall } from "./register";

/** Public-register reads per IP and hour (PLAN-v3 §2.5). A product limit. */
export const REGISTER_LASNINGAR_PER_IP_OCH_TIMME = 300;

export const REGISTER_KVOT_MEDDELANDE =
  "Du har läst många sidor i registret på kort tid. Vänta en stund och försök igen.";

/** Area slugs that may be listed publicly: the 19 areas + "Övriga Stockholm". */
export const LISTADE_OMRADEN: readonly string[] = [
  ...REGISTEROMRADEN.map((o) => o.slug),
  OVRIGA_STOCKHOLM.slug,
];

function omradeNamn(slug: string | null): { slug: string; namn: string } | null {
  if (slug === null) return null;
  const o = REGISTEROMRADEN.find((x) => x.slug === slug);
  if (o) return { slug: o.slug, namn: o.namn };
  if (slug === OVRIGA_STOCKHOLM.slug) return { slug, namn: OVRIGA_STOCKHOLM.namn };
  return null;
}

export interface RegisterKvotBeroenden {
  konto: KontoDatabas;
  /** HMAC'd client IP (kontext.ts `hashaIp`); null without `cf-connecting-ip` (local dev). */
  ipHash: string | null;
}

export interface RegisterBeroenden {
  lasning: RegisterLasning;
  /** Omitted = no rate limit (sitemap, tests of the data logic). */
  kvot?: RegisterKvotBeroenden;
}

/** True while the caller is within 300 reads per hour. A refused call does not consume quota. */
export async function kontrolleraRegisterKvot(k: RegisterKvotBeroenden): Promise<boolean> {
  const nyckel = `register:ip:${k.ipHash ?? "okand"}`;
  return taKvot(k.konto, nyckel, TIMME_SEK, REGISTER_LASNINGAR_PER_IP_OCH_TIMME);
}

async function nekadAvKvot(b: RegisterBeroenden): Promise<RegisterKvotSvar | null> {
  if (b.kvot && !(await kontrolleraRegisterKvot(b.kvot))) {
    return { status: "kvot", meddelande: REGISTER_KVOT_MEDDELANDE };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------

/** Pure: counts and newest date per area from the light summary rows. */
export function raknaOmraden(
  rader: ReadonlyArray<{ registeromrade: string; analysdatum: string }>,
): RegisterOmradeKort[] {
  const perOmrade = new Map<string, { antal: number; senast: string }>();
  for (const r of rader) {
    const nu = perOmrade.get(r.registeromrade);
    if (!nu) perOmrade.set(r.registeromrade, { antal: 1, senast: r.analysdatum });
    else {
      nu.antal += 1;
      if (r.analysdatum > nu.senast) nu.senast = r.analysdatum;
    }
  }
  const kort: RegisterOmradeKort[] = REGISTEROMRADEN.map((o) => ({
    slug: o.slug,
    namn: o.namn,
    grupp: o.grupp,
    ordning: o.ordning,
    antal: perOmrade.get(o.slug)?.antal ?? 0,
    senastUppdaterad: perOmrade.get(o.slug)?.senast ?? null,
  }));
  const ovriga = perOmrade.get(OVRIGA_STOCKHOLM.slug);
  if (ovriga) {
    kort.push({
      slug: OVRIGA_STOCKHOLM.slug,
      namn: OVRIGA_STOCKHOLM.namn,
      grupp: null,
      ordning: REGISTEROMRADEN.length + 1,
      antal: ovriga.antal,
      senastUppdaterad: ovriga.senast,
    });
  }
  return kort;
}

export async function listaOmraden(
  b: RegisterBeroenden,
): Promise<RegisterOmradenSvar | RegisterKvotSvar> {
  const nekad = await nekadAvKvot(b);
  if (nekad) return nekad;
  const rader = await b.lasning.listaOmradeRader(LISTADE_OMRADEN);
  return { omraden: raknaOmraden(rader) };
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

const SORTERINGSKOLUMN: Record<RegisterSortering, RegisterSorteringsKolumn> = {
  skuld_brf: "skuldsattning_per_m2_brf_yta",
  avgift: "arsavgift_per_m2_brf_yta",
  sparande: "sparande_per_m2_totalyta",
  betyg: "betyg",
  analysdatum: "analysdatum",
};

/**
 * One page of associations: in one area (`fraga.omrade`) or across all listed
 * areas (the /brf search). Unknown area slugs answer "saknas".
 */
export async function listaForeningar(
  b: RegisterBeroenden,
  fraga: RegisterListaFraga,
): Promise<RegisterOmradeSvar | RegisterKvotSvar> {
  const nekad = await nekadAvKvot(b);
  if (nekad) return nekad;

  let omrade: { slug: string; namn: string } | null = null;
  if (fraga.omrade !== undefined) {
    omrade = omradeNamn(fraga.omrade);
    if (!omrade) return { status: "saknas" };
  }
  const sortering = tolkaSortering(fraga.sortering);
  const riktning = tolkaRiktning(fraga.riktning, sortering);
  const sida = tolkaSida(fraga.sida);
  const sok = tolkaSok(fraga.sok);

  const { rader, totalt } = await b.lasning.listaSammanfattningar({
    omraden: omrade ? [omrade.slug] : LISTADE_OMRADEN,
    sok,
    sortering: SORTERINGSKOLUMN[sortering],
    stigande: riktning === "asc",
    fran: (sida - 1) * REGISTER_SIDSTORLEK,
    antal: REGISTER_SIDSTORLEK,
  });

  const listrader: RegisterListrad[] = rader.map((r) => ({
    slug: r.slug,
    orgnr: r.orgnr,
    namn: r.namn,
    omradeSlug: r.registeromrade,
    omradeNamn: omradeNamn(r.registeromrade)?.namn ?? r.registeromrade,
    rakenskapsar: r.rakenskapsar,
    betyg: r.betyg,
    skuldPerM2Brf: r.skuldsattningPerM2BrfYta,
    avgiftPerM2: r.arsavgiftPerM2BrfYta,
    sparandePerM2: r.sparandePerM2Totalyta,
    analysdatum: r.analysdatum,
  }));

  return {
    status: "ok",
    omrade,
    rader: listrader,
    totalt,
    sida,
    sidstorlek: REGISTER_SIDSTORLEK,
    sortering,
    riktning,
    sok,
  };
}

// ---------------------------------------------------------------------------
// One association
// ---------------------------------------------------------------------------

/** One stored rapport as a BRF-level year view, or null when it does not parse
 *  with the running code's schemas. */
export function byggArsvy(r: RegisterRapportRad): RegisterArsvy | null {
  const innehall = tolkaRapportInnehall(r);
  if (!innehall) return null;
  const { extraction, judgement } = innehall;
  // BRF-level questions only: the judge's own plus the deterministic
  // "osäker" confirmations. The buyer-specific gaps (missing hiss, fee
  // deviation, ...) are assembled per buyer and never appear here.
  const fragor = [
    ...judgement.fragor,
    ...osakerhetsfragor(extraction.forening, judgement.fragor),
  ].filter((f) => f.ursprung === "analys");
  return {
    rakenskapsar: r.rakenskapsar,
    analysdatum: r.analysdatum,
    forening: extraction.forening,
    betyg: judgement.betyg,
    betygMotivering: judgement.betygMotivering,
    rodaFlaggor: judgement.rodaFlaggor,
    fragor,
    datakvalitet: extraction.datakvalitet,
    aldreVersion: r.pipelineVersion !== PIPELINE_VERSION,
  };
}

/** Latest servable report per fiscal year (current pipeline version first),
 *  newest year first. Input is newest-finished first within a year. */
export function enPerAr(rapporter: readonly RegisterRapportRad[]): RegisterArsvy[] {
  const perAr = new Map<number, RegisterArsvy>();
  const ordnade = [
    ...rapporter.filter((r) => r.pipelineVersion === PIPELINE_VERSION),
    ...rapporter.filter((r) => r.pipelineVersion !== PIPELINE_VERSION),
  ];
  for (const r of ordnade) {
    if (perAr.has(r.rakenskapsar)) continue;
    const vy = byggArsvy(r);
    if (vy) perAr.set(r.rakenskapsar, vy);
  }
  return [...perAr.values()].sort((a, b) => b.rakenskapsar - a.rakenskapsar);
}

export async function hamtaForening(
  b: RegisterBeroenden,
  slug: string,
): Promise<RegisterForeningSvar | RegisterKvotSvar> {
  const nekad = await nekadAvKvot(b);
  if (nekad) return nekad;

  const lasning = b.lasning;
  const f = await lasning.hamtaForeningViaSlug(slug);
  if (!f) {
    const orgnr = await lasning.hamtaOrgnrViaGammalSlug(slug);
    const nuvarande = orgnr ? await lasning.hamtaForeningViaOrgnr(orgnr) : null;
    if (nuvarande?.slug && nuvarande.slug !== slug && omradeNamn(nuvarande.registeromrade)) {
      return { status: "omdirigera", slug: nuvarande.slug };
    }
    return { status: "saknas" };
  }

  const omrade = omradeNamn(f.registeromrade);
  if (!omrade || f.slug === null) return { status: "saknas" }; // not listed

  const ar = enPerAr(await lasning.listaKlaraRapporter(f.orgnr));
  const senaste = ar[0];
  if (!senaste) return { status: "saknas" };

  const vy: RegisterForeningVy = {
    slug: f.slug,
    orgnr: f.orgnr,
    namn: f.namn ?? senaste.forening.namn,
    omrade,
    adresser: (senaste.forening.adresser ?? []).map((a) => ({
      gatuadress: a.gatuadress,
      ...(a.postnummer !== undefined ? { postnummer: a.postnummer } : {}),
      ...(a.ort !== undefined ? { ort: a.ort } : {}),
    })),
    senaste,
    tidigare: ar.slice(1),
  };
  return { status: "ok", forening: vy };
}

// ---------------------------------------------------------------------------
// Sitemap
// ---------------------------------------------------------------------------

/** /brf, every area with at least one BRF, and every listed BRF, with lastmod. */
export async function hamtaSitemapPoster(lasning: RegisterLasning): Promise<RegisterSitemapPost[]> {
  const rader = await lasning.listaOmradeRader(LISTADE_OMRADEN);
  const poster: RegisterSitemapPost[] = [];
  const nyast = rader.reduce<string | null>(
    (m, r) => (m === null || r.analysdatum > m ? r.analysdatum : m),
    null,
  );
  poster.push({ path: "/brf", lastmod: nyast });
  for (const o of raknaOmraden(rader)) {
    if (o.antal > 0) poster.push({ path: `/brf/omrade/${o.slug}`, lastmod: o.senastUppdaterad });
  }
  for (const r of rader) {
    if (r.slug) poster.push({ path: `/brf/${r.slug}`, lastmod: r.analysdatum });
  }
  return poster;
}
