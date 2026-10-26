/**
 * The PUBLIC BRF register, read side (docs/PLAN-v3.md §2.5): area list, area
 * tables, one association's page, one stored full analysis, and the sitemap
 * data.
 *
 * Strictly BRF-level. The only tables read are `register_sammanfattning`,
 * `forening`, `forening_slug` and the parse-only columns of `rapport`
 * (`RegisterLasning` in ./portar.ts); `analys`, `property_input`, the
 * principal tables and the PDF bucket are out of reach by construction. Never
 * `input` or `prisanalys` (a test snapshots the payload keys).
 *
 * Two levels (owner decision 2026-10-23, src/lib/registerVy.ts):
 *   - `hamtaForening` (`/brf/$slug`, public, cacheable): identity + per year
 *     the betyg and the statutory nyckeltal with their status ONLY — no
 *     motivation, röda flaggor, frågor or sections;
 *   - `hamtaRegisteranalys` (`/brf/$slug/analys/$ar`): the full stored
 *     BRF-level analysis of one year, behind the `se_registeranalys`
 *     entitlement (checked by the caller in analysFn.ts before any read).
 * Both serve what is stored, exactly (grade included): an older pipeline
 * version is flagged `aldreVersion`, never re-run by a read.
 *
 * Only associations with a `registeromrade` in the 19 areas or
 * `ovriga-stockholm` are listed; anything else answers "saknas" (404), as does
 * an unknown slug. A renamed association's old slug answers `omdirigera`.
 *
 * No framework imports: analysFn.ts binds these to server functions.
 */
import { osakerhetsfragor } from "@/lib/analysis/assemble";
import { omgraderaNyckeltal } from "@/lib/analysis/benchmarks";
import { REGISTEROMRADEN, OVRIGA_STOCKHOLM } from "@/lib/register/omraden";
import {
  REGISTER_SIDSTORLEK,
  tolkaRiktning,
  tolkaSida,
  tolkaSok,
  tolkaSortering,
  type RegisterAnalysSvar,
  type RegisterArsSammanfattning,
  type RegisterArsvy,
  type RegisterForeningSvar,
  type RegisterForeningVy,
  type RegisterKvotSvar,
  type RegisterListaFraga,
  type RegisterListrad,
  type RegisterNyckeltal,
  type RegisterOmradeKort,
  type RegisterOmradenSvar,
  type RegisterOmradeSvar,
  type RegisterSitemapPost,
  type RegisterSortering,
} from "@/lib/registerVy";
import type { KontoDatabas } from "./kontoPortar";
import type { Anropare } from "./portar";
import { TIMME_SEK, taKvot } from "./kvot";
import type { RegisterLasning, RegisterRapportRad, RegisterSorteringsKolumn } from "./portar";
import { PIPELINE_VERSION, tolkaRapportInnehall } from "./register";

/** Public-register reads per IP and hour (PLAN-v3 §2.5). A product limit. */
export const REGISTER_LASNINGAR_PER_IP_OCH_TIMME = 300;

export const REGISTER_KVOT_MEDDELANDE =
  "Du har läst många sidor i registret på kort tid. Vänta en stund och försök igen.";

/** Buyer-safe copy when `se_registeranalys` is refused. */
export const REGISTERANALYS_NEKAD_MEDDELANDE =
  "Du har inte tillgång till den fullständiga analysen just nu.";

/** Fiscal years a register analysis can be asked for; anything else is "saknas". */
export const MIN_REGISTERAR = 1900;
export const MAX_REGISTERAR = 2100;

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
  // Same rule as the lists: a row without a slug is not public, so it is not counted.
  const rader = (await b.lasning.listaOmradeRader(LISTADE_OMRADEN)).filter((r) => r.slug);
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
  // Statuses are stored at extraction; re-grade them with TODAY's bands so old
  // stored years agree with new ones (round 2026-10-26: sparande bands). This
  // is the single place both /brf/$slug (publikaNyckeltal) and the register
  // analysis view read the key figures from. The register list rows carry no
  // statuses (numbers and the stored betyg only), so nothing to re-grade there.
  const forening = {
    ...extraction.forening,
    keyFigures: omgraderaNyckeltal(extraction.forening.keyFigures),
  };
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
    forening,
    betyg: judgement.betyg,
    betygMotivering: judgement.betygMotivering,
    rodaFlaggor: judgement.rodaFlaggor,
    fragor,
    datakvalitet: extraction.datakvalitet,
    aldreVersion: r.pipelineVersion !== PIPELINE_VERSION,
  };
}

/** Latest servable report per fiscal year (current pipeline version first),
 *  newest year first. Input is newest-finished first within a year. The same
 *  rule as SQL `uppdatera_register_sammanfattning`, so once a current-version
 *  run of a year is done it replaces the older one here too. */
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

/** The statutory nyckeltal of a stored year as the public summary shows them,
 *  in the extraction's order. Only figures the report actually has (a value,
 *  or a sign it prints such as "neg"); a missing one — old entries may lack
 *  e.g. årsavgifternas andel — is left out, never re-run. */
export function publikaNyckeltal(vy: RegisterArsvy): RegisterNyckeltal[] {
  return vy.forening.keyFigures
    .filter((k) => k.figure.value !== null || k.figure.tecken !== undefined)
    .map((k) => ({ id: k.id, label: k.label, figure: k.figure, status: k.status }));
}

/** The public summary of one year: built field by field (an allow-list), so
 *  nothing else from the analysis can leak onto the public page. */
export function byggArsSammanfattning(vy: RegisterArsvy): RegisterArsSammanfattning {
  return {
    rakenskapsar: vy.rakenskapsar,
    analysdatum: vy.analysdatum,
    betyg: vy.betyg,
    nyckeltal: publikaNyckeltal(vy),
    skannad: vy.datakvalitet.kalla === "skannad" || vy.datakvalitet.pdfSaknarTextlager,
    aldreVersion: vy.aldreVersion,
  };
}

interface UpplostForening {
  slug: string;
  orgnr: string;
  /** The register's name, else the newest report's. */
  namn: string;
  omrade: { slug: string; namn: string };
  /** Newest year first; never empty. */
  ar: RegisterArsvy[];
}

/** Slug → a listed association with at least one servable year; an old slug →
 *  `omdirigera`; anything else → `saknas`. Shared by both association reads. */
async function losForening(
  lasning: RegisterLasning,
  slug: string,
): Promise<
  | { status: "ok"; f: UpplostForening }
  | { status: "omdirigera"; slug: string }
  | { status: "saknas" }
> {
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
  const nyast = ar[0];
  if (!nyast) return { status: "saknas" };
  return {
    status: "ok",
    f: { slug: f.slug, orgnr: f.orgnr, namn: f.namn ?? nyast.forening.namn, omrade, ar },
  };
}

export async function hamtaForening(
  b: RegisterBeroenden,
  slug: string,
): Promise<RegisterForeningSvar | RegisterKvotSvar> {
  const nekad = await nekadAvKvot(b);
  if (nekad) return nekad;

  const upplost = await losForening(b.lasning, slug);
  if (upplost.status !== "ok") return upplost;
  const { f } = upplost;
  const [senaste, ...tidigare] = f.ar;
  if (!senaste) return { status: "saknas" };

  const vy: RegisterForeningVy = {
    slug: f.slug,
    orgnr: f.orgnr,
    namn: f.namn,
    omrade: f.omrade,
    adresser: (senaste.forening.adresser ?? []).map((a) => ({
      gatuadress: a.gatuadress,
      ...(a.postnummer !== undefined ? { postnummer: a.postnummer } : {}),
      ...(a.ort !== undefined ? { ort: a.ort } : {}),
    })),
    senaste: byggArsSammanfattning(senaste),
    tidigare: tidigare.map(byggArsSammanfattning),
  };
  return { status: "ok", forening: vy };
}

/**
 * The stored full BRF-level analysis of one fiscal year (`/brf/$slug/analys/$ar`):
 * the same slug resolution and the same per-year pick (`enPerAr`) as the
 * association page, served exactly as stored (`aldreVersion` flags an older
 * pipeline version; never re-run). Unknown year → `saknas`.
 *
 * Order: the `se_registeranalys` entitlement (with `anropare`, always passed
 * by analysFn.ts; omitted only by tests of the data logic) BEFORE any read
 * work → the per-IP register quota → the year (an integer in
 * [MIN_REGISTERAR, MAX_REGISTERAR], else `saknas`) → the read. A policy rule
 * that throws propagates (fail closed).
 */
export async function hamtaRegisteranalys(
  b: RegisterBeroenden,
  slug: string,
  ar: number,
  anropare?: Pick<Anropare, "kontext" | "behorighet">,
): Promise<RegisterAnalysSvar | RegisterKvotSvar> {
  if (
    anropare &&
    !(await anropare.behorighet.harBehorighet(anropare.kontext, "se_registeranalys"))
  ) {
    return { status: "nekad", meddelande: REGISTERANALYS_NEKAD_MEDDELANDE };
  }
  const nekad = await nekadAvKvot(b);
  if (nekad) return nekad;
  if (!Number.isInteger(ar) || ar < MIN_REGISTERAR || ar > MAX_REGISTERAR) {
    return { status: "saknas" };
  }

  const upplost = await losForening(b.lasning, slug);
  if (upplost.status !== "ok") return upplost;
  const { f } = upplost;
  const analys = f.ar.find((a) => a.rakenskapsar === ar);
  if (!analys) return { status: "saknas" };
  return {
    status: "ok",
    vy: {
      slug: f.slug,
      orgnr: f.orgnr,
      namn: f.namn,
      omrade: f.omrade,
      analys,
    },
  };
}

// ---------------------------------------------------------------------------
// Sitemap
// ---------------------------------------------------------------------------

/** /brf, every area with at least one BRF, and every listed BRF, with lastmod. */
export async function hamtaSitemapPoster(lasning: RegisterLasning): Promise<RegisterSitemapPost[]> {
  const rader = (await lasning.listaOmradeRader(LISTADE_OMRADEN)).filter((r) => r.slug);
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
