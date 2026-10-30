/**
 * Client-safe types and pure helpers for the public BRF register
 * (docs/PLAN-v3.md §2). The server side (`src/server/registerPublik.ts`)
 * builds these objects, the routes under `src/routes/brf*` render them.
 *
 * Everything here is BRF-level data. No type in this file can carry buyer
 * data (no `PropertyInput`, no `Prisanalys`, no räntestress).
 *
 * Two levels (owner decision 2026-10-23):
 *   - the PUBLIC summary (`RegisterForeningVy`, `/brf/$slug`): name, fiscal
 *     year, betyg, the stored grade motivation of the newest year (owner
 *     2026-10-28) and the statutory nyckeltal with their status. Nothing else
 *     from the analysis leaves the server on that endpoint.
 *   - the stored FULL BRF-level analysis (`RegisterAnalysVy`,
 *     `/brf/$slug/analys/$ar`): motivation, röda flaggor, frågor, all
 *     sections. Behind the `se_registeranalys` entitlement (granted to all
 *     today; src/server/behorighet.ts).
 */
import type {
  Datakvalitet,
  Figure,
  Forening,
  Fraga,
  Grade,
  KeyFigure,
  RedFlag,
} from "@/types/analysis";

export const SITE_URL = "https://binfo.slanesens.com";

/** Rows per page in an area table (PLAN-v3 §2.6). */
export const REGISTER_SIDSTORLEK = 50;

export type RegisterSortering = "skuld_brf" | "avgift" | "sparande" | "betyg" | "analysdatum";
export type RegisterRiktning = "asc" | "desc";

export const REGISTER_SORTERINGAR: readonly RegisterSortering[] = [
  "skuld_brf",
  "avgift",
  "sparande",
  "betyg",
  "analysdatum",
];

/** Area as listed on /brf. `grupp` is null for "Övriga Stockholm". */
export interface RegisterOmradeKort {
  slug: string;
  namn: string;
  grupp: "Innerstaden" | "Söderort" | "Västerort" | null;
  ordning: number;
  antal: number;
  /** ISO timestamp of the newest analysis in the area, null when empty. */
  senastUppdaterad: string | null;
}

export interface RegisterOmradenSvar {
  omraden: RegisterOmradeKort[];
}

/** One row of an area table / search result: the latest report's headline figures. */
export interface RegisterListrad {
  slug: string;
  orgnr: string;
  namn: string;
  omradeSlug: string;
  omradeNamn: string;
  rakenskapsar: number;
  betyg: Grade | null;
  skuldPerM2Brf: number | null;
  avgiftPerM2: number | null;
  sparandePerM2: number | null;
  /** ISO timestamp. */
  analysdatum: string;
}

export interface RegisterListaFraga {
  /** Area slug; omitted = across all listed areas (the /brf search). */
  omrade?: string | undefined;
  sok?: string | undefined;
  sortering?: RegisterSortering | undefined;
  riktning?: RegisterRiktning | undefined;
  /** 1-based. */
  sida?: number | undefined;
}

export interface RegisterListaSvar {
  status: "ok";
  omrade: { slug: string; namn: string } | null;
  rader: RegisterListrad[];
  totalt: number;
  sida: number;
  sidstorlek: number;
  sortering: RegisterSortering;
  riktning: RegisterRiktning;
  sok: string;
}

export type RegisterOmradeSvar = RegisterListaSvar | { status: "saknas" };

/** One financial year of one association: the FULL stored BRF-level analysis
 *  (served only by the entitlement-checked full-analysis endpoint). */
export interface RegisterArsvy {
  rakenskapsar: number;
  /** ISO timestamp the analysis finished. */
  analysdatum: string;
  forening: Forening;
  betyg: Grade;
  betygMotivering: string;
  rodaFlaggor: RedFlag[];
  /** Frågor till styrelsen (ursprung 'analys' only; never the buyer's own gaps). */
  fragor: Fraga[];
  datakvalitet: Pick<
    Datakvalitet,
    "pdfSaknarTextlager" | "extraktionKonfidens" | "saknadeFalt" | "kalla"
  >;
  /** Served from an older pipeline version (shown with a note). */
  aldreVersion: boolean;
}

/** One statutory nyckeltal on the public summary: the cited figure and its
 *  benchmark status. Only figures the report actually has (a value, or a
 *  sign the report prints) are included; a missing one is left out. */
export interface RegisterNyckeltal {
  id: KeyFigure["id"];
  label: string;
  figure: Figure;
  status: KeyFigure["status"];
}

/** One financial year on the PUBLIC summary. Deliberately no motivation,
 *  röda flaggor, frågor or sections. */
export interface RegisterArsSammanfattning {
  rakenskapsar: number;
  /** ISO timestamp the analysis finished. */
  analysdatum: string;
  betyg: Grade;
  /** The stored judge's short motivation of the grade (owner Q6, 2026-10-28). Only the newest
   *  year carries it; earlier years are null (they only appear in the year table). */
  betygMotivering: string | null;
  nyckeltal: RegisterNyckeltal[];
  /** The report was a scan (figures read from Binfo's transcription). */
  skannad: boolean;
  /** Analysed with an older pipeline version (shown with a note, never re-run on read). */
  aldreVersion: boolean;
}

/** The area in running text: "på Kungsholmen", "i övriga Stockholm" (see `omradeMedPreposition`). */
export { omradeMedPreposition } from "@/lib/register/omraden";

/** The public association page (`/brf/$slug`): identity + summaries only. */
export interface RegisterForeningVy {
  slug: string;
  orgnr: string;
  namn: string;
  omrade: { slug: string; namn: string } | null;
  /** The association's own addresses, cited in the report (identification). */
  adresser: Array<{ gatuadress: string; postnummer?: string; ort?: string }>;
  /** Newest financial year. */
  senaste: RegisterArsSammanfattning;
  /** Earlier financial years, newest first. */
  tidigare: RegisterArsSammanfattning[];
}

export type RegisterForeningSvar =
  | { status: "ok"; forening: RegisterForeningVy }
  | { status: "omdirigera"; slug: string }
  | { status: "saknas" };

/** The stored full analysis of one fiscal year (`/brf/$slug/analys/$ar`). */
export interface RegisterAnalysVy {
  slug: string;
  orgnr: string;
  namn: string;
  omrade: { slug: string; namn: string } | null;
  analys: RegisterArsvy;
}

export type RegisterAnalysSvar =
  | { status: "ok"; vy: RegisterAnalysVy }
  | { status: "omdirigera"; slug: string }
  | { status: "saknas" }
  /** The entitlement `se_registeranalys` refused (account/payment later). */
  | { status: "nekad"; meddelande: string };

/** One line on how grades are set, the same for every association. */
export const BETYG_FORKLARING =
  "Betyget A–E är Binfos samlade bedömning av föreningens ekonomi. Det bygger på de sju " +
  "nyckeltalen i årsredovisningen, hur många av dem som är svaga eller kritiska, och på vad " +
  "rapporten säger om lån, underhåll och avgifter.";

/** Returned instead of data when the per-IP limit is hit. */
export interface RegisterKvotSvar {
  status: "kvot";
  meddelande: string;
}

export interface RegisterSitemapPost {
  path: string;
  /** ISO timestamp or null. */
  lastmod: string | null;
}

// ---------------------------------------------------------------------------
// Search params (pure, shared by routes and tests)
// ---------------------------------------------------------------------------

export function tolkaSortering(v: unknown): RegisterSortering {
  return REGISTER_SORTERINGAR.includes(v as RegisterSortering)
    ? (v as RegisterSortering)
    : "analysdatum";
}

/** Natural default direction per column: best/highest-interest first. */
export function standardRiktning(s: RegisterSortering): RegisterRiktning {
  return s === "analysdatum" ? "desc" : "asc";
}

export function tolkaRiktning(v: unknown, sortering: RegisterSortering): RegisterRiktning {
  return v === "asc" || v === "desc" ? v : standardRiktning(sortering);
}

export function tolkaSida(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}

export function tolkaSok(v: unknown): string {
  // The router JSON-parses search values, so "7164200599" arrives as a number.
  return typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, 80) : "";
}

/** Search params of a list page (`/brf/omrade/$omrade`, and `sok` on `/brf`). */
export interface RegisterListaSearch {
  sok?: string;
  sortering?: RegisterSortering;
  riktning?: RegisterRiktning;
  sida?: number;
}

/** Router `validateSearch`: unknown/garbage values are dropped, so the URL
 *  stays canonical (defaults are not written back). */
export function parseListaSearch(raw: Record<string, unknown>): RegisterListaSearch {
  const ut: RegisterListaSearch = {};
  const sok = tolkaSok(raw["sok"]);
  if (sok !== "") ut.sok = sok;
  if (REGISTER_SORTERINGAR.includes(raw["sortering"] as RegisterSortering)) {
    ut.sortering = raw["sortering"] as RegisterSortering;
  }
  if (raw["riktning"] === "asc" || raw["riktning"] === "desc") ut.riktning = raw["riktning"];
  const sida = tolkaSida(raw["sida"]);
  if (sida > 1) ut.sida = sida;
  return ut;
}

/** The next URL state after a sort/page change, normalised like `parseListaSearch`. */
export function nastaListaSearch(
  nu: RegisterListaSearch,
  andring: {
    sok?: string;
    sortering?: RegisterSortering;
    riktning?: RegisterRiktning;
    sida?: number;
  },
): RegisterListaSearch {
  return parseListaSearch({
    sok: andring.sok ?? nu.sok,
    sortering: andring.sortering ?? nu.sortering,
    riktning: andring.riktning ?? nu.riktning,
    sida: andring.sida ?? nu.sida,
  });
}

/** Sort alternatives of the "Sortera efter" select: each maps to the existing server-side key and
 *  direction (no new sorting). The label says which end comes first. */
export const SORT_ALTERNATIV: ReadonlyArray<{
  sortering: RegisterSortering;
  riktning: RegisterRiktning;
  etikett: string;
}> = [
  { sortering: "betyg", riktning: "asc", etikett: "Betyg (bäst först)" },
  { sortering: "skuld_brf", riktning: "asc", etikett: "Skuld per m² (lägst först)" },
  { sortering: "avgift", riktning: "asc", etikett: "Årsavgift per m² (lägst först)" },
  { sortering: "sparande", riktning: "desc", etikett: "Sparande per m² (högst först)" },
  { sortering: "analysdatum", riktning: "desc", etikett: "Senast analyserad (nyast först)" },
];

const SORT_NAMN: Record<RegisterSortering, string> = {
  betyg: "Betyg",
  skuld_brf: "Skuld per m²",
  avgift: "Årsavgift per m²",
  sparande: "Sparande per m²",
  analysdatum: "Senast analyserad",
};

const SORT_ANDE: Record<RegisterSortering, { asc: string; desc: string }> = {
  betyg: { asc: "bäst först", desc: "sämst först" },
  skuld_brf: { asc: "lägst först", desc: "högst först" },
  avgift: { asc: "lägst först", desc: "högst först" },
  sparande: { asc: "lägst först", desc: "högst först" },
  analysdatum: { asc: "äldst först", desc: "nyast först" },
};

/** Select value of a sort state, e.g. "betyg:asc". */
export function sorteringsVarde(s: RegisterSortering, r: RegisterRiktning): string {
  return `${s}:${r}`;
}

/** Select label of any sort state, including those only reachable through a column header. */
export function sorteringsEtikett(s: RegisterSortering, r: RegisterRiktning): string {
  const fast = SORT_ALTERNATIV.find((a) => a.sortering === s && a.riktning === r);
  return fast ? fast.etikett : `${SORT_NAMN[s]} (${SORT_ANDE[s][r]})`;
}

/** Inverse of `sorteringsVarde`; null for anything that is not a known state. */
export function tolkaSorteringsVarde(
  v: string,
): { sortering: RegisterSortering; riktning: RegisterRiktning } | null {
  const [s, r] = v.split(":");
  if (!REGISTER_SORTERINGAR.includes(s as RegisterSortering)) return null;
  if (r !== "asc" && r !== "desc") return null;
  return { sortering: s as RegisterSortering, riktning: r };
}

/** "1 förening" / "13 föreningar". */
export function antalForeningar(n: number): string {
  return `${n} ${n === 1 ? "förening" : "föreningar"}`;
}

/** "24 okt." (no year), for the area cards. */
export function kortDatum(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short" }).format(new Date(iso));
}

export const ALDRE_VERSION_TEXT = "Analysen gjordes med en tidigare version av Binfo.";

// ---------------------------------------------------------------------------
// SEO (title, description, canonical, JSON-LD) — pure so it can be tested
// ---------------------------------------------------------------------------

function kronor(v: number): string {
  // Non-breaking space as the thousands separator, like the rest of the site.
  return Math.round(v).toLocaleString("sv-SE");
}

function varde(ar: RegisterArsSammanfattning, id: string): number | null {
  return ar.nyckeltal.find((k) => k.id === id)?.figure.value ?? null;
}

export function canonicalUrl(path: string): string {
  return `${SITE_URL}${path}`;
}

export function foreningPath(slug: string): string {
  return `/brf/${slug}`;
}

/** The stored full analysis of one fiscal year. */
export function registeranalysPath(slug: string, ar: number): string {
  return `/brf/${slug}/analys/${ar}`;
}

export function omradePath(slug: string): string {
  return `/brf/omrade/${slug}`;
}

export function foreningTitel(namn: string, omradeNamn: string | null): string {
  return `${namn}${omradeNamn ? `, ${omradeNamn}` : ""}: nyckeltal och analys | Binfo`;
}

const MAX_BESKRIVNING = 160;

/** Real figures from the latest report, cut at a word boundary to ≤ 160 characters. */
export function foreningBeskrivning(vy: RegisterForeningVy): string {
  const s = vy.senaste;
  const skuld = varde(s, "skuldsattning_per_m2_brf_yta");
  const sparande = varde(s, "sparande_per_m2_totalyta");
  const delar: string[] = [];
  if (skuld !== null) delar.push(`skuld ${kronor(skuld)} kr/kvm`);
  if (sparande !== null) delar.push(`sparande ${kronor(sparande)} kr/kvm`);
  const siffror = delar.length > 0 ? `${delar.join(", ")} ` : "";
  const text =
    `${vy.namn}: ${siffror}enligt årsredovisningen ${s.rakenskapsar}. ` + `Riskbetyg ${s.betyg}.`;
  if (text.length <= MAX_BESKRIVNING) return text;
  const kort = text.slice(0, MAX_BESKRIVNING - 1);
  const sista = kort.lastIndexOf(" ");
  return `${kort.slice(0, sista > 40 ? sista : kort.length).replace(/[ ,.:;]+$/, "")}…`;
}

export interface JsonLdBlock {
  "@context": "https://schema.org";
  "@type": string;
  [nyckel: string]: unknown;
}

function brodsmulor(steg: Array<{ namn: string; path: string }>): JsonLdBlock {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: steg.map((s, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: s.namn,
      item: canonicalUrl(s.path),
    })),
  };
}

export function omradeBrodsmulor(omradeNamn: string, omradeSlug: string): JsonLdBlock {
  return brodsmulor([
    { namn: "BRF-register", path: "/brf" },
    { namn: omradeNamn, path: omradePath(omradeSlug) },
  ]);
}

export function foreningJsonLd(vy: RegisterForeningVy): JsonLdBlock[] {
  const adress = vy.adresser[0];
  const organisation: JsonLdBlock = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: vy.namn,
    taxID: vy.orgnr,
    url: canonicalUrl(foreningPath(vy.slug)),
    ...(adress
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: adress.gatuadress,
            ...(adress.postnummer ? { postalCode: adress.postnummer } : {}),
            ...(adress.ort ? { addressLocality: adress.ort } : {}),
            addressCountry: "SE",
          },
        }
      : {}),
  };
  const steg = [{ namn: "BRF-register", path: "/brf" }];
  if (vy.omrade) steg.push({ namn: vy.omrade.namn, path: omradePath(vy.omrade.slug) });
  steg.push({ namn: vy.namn, path: foreningPath(vy.slug) });
  return [organisation, brodsmulor(steg)];
}

/** TanStack `head()` script entries for JSON-LD. `<` is escaped so a name can never close the tag. */
export function jsonLdScripts(block: JsonLdBlock[]): Array<{ type: string; children: string }> {
  return block.map((b) => ({
    type: "application/ld+json",
    children: JSON.stringify(b).replace(/</g, "\\u003c"),
  }));
}

export interface HeadInput {
  titel: string;
  beskrivning: string;
  path: string;
  noindex?: boolean;
}

/** Common meta for a register page: description, canonical, og:*. */
export function sidHead(h: HeadInput) {
  const url = canonicalUrl(h.path);
  return {
    meta: [
      { title: h.titel },
      { name: "description", content: h.beskrivning },
      ...(h.noindex ? [{ name: "robots", content: "noindex" }] : []),
      { property: "og:type", content: "website" },
      { property: "og:url", content: url },
      { property: "og:title", content: h.titel },
      { property: "og:description", content: h.beskrivning },
      { property: "og:image", content: `${SITE_URL}/og.png` },
      { property: "og:locale", content: "sv_SE" },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}

/** Cache headers for public register pages (PLAN-v3 §2.5). */
export const REGISTER_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
} as const;
