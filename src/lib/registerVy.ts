/**
 * Client-safe types and pure helpers for the public BRF register
 * (docs/PLAN-v3.md §2). The server side (`src/server/registerPublik.ts`)
 * builds these objects, the routes under `src/routes/brf*` render them.
 *
 * Everything here is BRF-level data: nyckeltal with page references, betyg,
 * röda flaggor, frågor till styrelsen, data quality. No type in this file can
 * carry buyer data (no `PropertyInput`, no `Prisanalys`, no räntestress).
 */
import type { Datakvalitet, Forening, Fraga, Grade, RedFlag } from "@/types/analysis";

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

/** One financial year of one association, BRF-level only. */
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

export interface RegisterForeningVy {
  slug: string;
  orgnr: string;
  namn: string;
  omrade: { slug: string; namn: string } | null;
  /** The association's own addresses, cited in the report. */
  adresser: Array<{ gatuadress: string; postnummer?: string; ort?: string }>;
  /** Newest financial year. */
  senaste: RegisterArsvy;
  /** Earlier financial years, newest first. */
  tidigare: RegisterArsvy[];
}

export type RegisterForeningSvar =
  | { status: "ok"; forening: RegisterForeningVy }
  | { status: "omdirigera"; slug: string }
  | { status: "saknas" };

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

export const ALDRE_VERSION_TEXT = "Analysen gjordes med en tidigare version av Binfo.";

// ---------------------------------------------------------------------------
// SEO (title, description, canonical, JSON-LD) — pure so it can be tested
// ---------------------------------------------------------------------------

function kronor(v: number): string {
  // Non-breaking space as the thousands separator, like the rest of the site.
  return Math.round(v).toLocaleString("sv-SE");
}

function varde(vy: RegisterArsvy, id: string): number | null {
  return vy.forening.keyFigures.find((k) => k.id === id)?.figure.value ?? null;
}

export function canonicalUrl(path: string): string {
  return `${SITE_URL}${path}`;
}

export function foreningPath(slug: string): string {
  return `/brf/${slug}`;
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
    `${vy.namn}: ${siffror}enligt årsredovisningen ${s.rakenskapsar}. ` +
    `Betyg ${s.betyg}, ${s.rodaFlaggor.length > 0 ? "röda flaggor och " : ""}frågor till styrelsen.`;
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
