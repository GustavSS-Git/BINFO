/**
 * Area taxonomy of the public BRF register (PLAN-v3 2.2), client-safe and pure.
 *
 * This is a DISPLAY layer, separate from the valuation model's 13 areas
 * (`omrade` in data/derived/postnummer_omrade.csv). It must not import from
 * src/lib/vardering (server-only).
 *
 * 19 areas built from the 117 Stockholms stad stadsdel polygons (CC0) via
 * ml/mapping/stadsdel_registeromrade.csv, each row sourced to Stockholms stad's
 * Basområdeslistan 2026; `grupp` = Stockholms stad's stadsområden (Inre staden,
 * Söderort, Västerort). The constant below is checked against the CSV by
 * dataSync.test.ts.
 *
 * `losRegisteromrade` is the runtime part of the "how a BRF gets its area"
 * ladder (PLAN-v3 2.2): rapport address > bulk-import metadata > buyers'
 * postnummer. The first two are normally resolved OFFLINE by geocoding
 * (ml/mapping/geokoda_adress.py, point-in-polygon) and stored directly; this
 * function covers the postnummer path used for user uploads and as fallback.
 */
import data from "./data/postnummerStadsdel.data";
import { avkodaLopare, avkodaPostnummerLista } from "./kodning";

export type RegisterGrupp = "Innerstaden" | "Söderort" | "Västerort";

export interface Registeromrade {
  slug: string;
  namn: string;
  grupp: RegisterGrupp;
  /** 1-based display order (the Innerstaden areas first, then Söderort, Västerort). */
  ordning: number;
}

export const REGISTEROMRADEN = [
  { slug: "gamla-stan", namn: "Gamla stan", grupp: "Innerstaden", ordning: 1 },
  { slug: "norrmalm", namn: "Norrmalm", grupp: "Innerstaden", ordning: 2 },
  { slug: "vasastan", namn: "Vasastan", grupp: "Innerstaden", ordning: 3 },
  { slug: "ostermalm", namn: "Östermalm", grupp: "Innerstaden", ordning: 4 },
  { slug: "djurgarden-gardet", namn: "Djurgården & Gärdet", grupp: "Innerstaden", ordning: 5 },
  { slug: "kungsholmen", namn: "Kungsholmen", grupp: "Innerstaden", ordning: 6 },
  { slug: "essingeoarna", namn: "Essingeöarna", grupp: "Innerstaden", ordning: 7 },
  { slug: "sodermalm", namn: "Södermalm", grupp: "Innerstaden", ordning: 8 },
  { slug: "hammarby-sjostad", namn: "Hammarby sjöstad", grupp: "Innerstaden", ordning: 9 },
  {
    slug: "liljeholmen-hagersten",
    namn: "Liljeholmen & Hägersten",
    grupp: "Söderort",
    ordning: 10,
  },
  { slug: "alvsjo", namn: "Älvsjö", grupp: "Söderort", ordning: 11 },
  { slug: "arsta-johanneshov", namn: "Årsta & Johanneshov", grupp: "Söderort", ordning: 12 },
  { slug: "enskede", namn: "Enskede", grupp: "Söderort", ordning: 13 },
  { slug: "skarpnack", namn: "Skarpnäck", grupp: "Söderort", ordning: 14 },
  { slug: "farsta", namn: "Farsta", grupp: "Söderort", ordning: 15 },
  { slug: "skarholmen", namn: "Skärholmen", grupp: "Söderort", ordning: 16 },
  { slug: "bromma", namn: "Bromma", grupp: "Västerort", ordning: 17 },
  { slug: "hasselby-vallingby", namn: "Hässelby-Vällingby", grupp: "Västerort", ordning: 18 },
  { slug: "kista-jarva", namn: "Kista & Järva", grupp: "Västerort", ordning: 19 },
] as const satisfies readonly Registeromrade[];

export type RegisteromradeSlug = (typeof REGISTEROMRADEN)[number]["slug"];

/**
 * Pseudo area for a BRF known to be in Stockholms kommun (0180) but whose
 * postnummer has no stadsdel. Not one of the 19 areas and not in
 * REGISTEROMRADEN; shown as "Övriga Stockholm".
 */
export const OVRIGA_STOCKHOLM = { slug: "ovriga-stockholm", namn: "Övriga Stockholm" } as const;
export type OvrigaStockholmSlug = typeof OVRIGA_STOCKHOLM.slug;

export type OmradeKalla = "rapport_adress" | "import" | "anvandare";

/** Priority order, highest first (PLAN-v3 2.2). */
export const OMRADE_KALLOR: readonly OmradeKalla[] = ["rapport_adress", "import", "anvandare"];

export interface OmradeIndata {
  postnummer: string[];
  kalla: OmradeKalla;
}

export interface OmradeResultat {
  /** Area slug, `ovriga-stockholm`, or null when nothing could be resolved (the BRF stays unlisted). */
  omrade: RegisteromradeSlug | OvrigaStockholmSlug | null;
  /** The source that decided it, or null when `omrade` is null. */
  kalla: OmradeKalla | null;
  /** Number of resolved postnummer votes in the deciding source (0 when null). */
  antal: number;
  /** Share of those votes that went to the winner, 0..1 (0 when null). */
  andel: number;
  /** True on a tie between areas, or when every winning vote is a weak postnummer call. */
  osakert: boolean;
}

// ---- lookup tables, built once from the generated data -------------------

const SLUGS = REGISTEROMRADEN.map((a) => a.slug);

function byggTabeller() {
  if (data.omraden.length !== SLUGS.length || data.omraden.some((s, i) => s !== SLUGS[i])) {
    throw new Error(
      "Register: generated data areas do not match REGISTEROMRADEN (run npm run build:register-data)",
    );
  }
  const postnummer = avkodaPostnummerLista(data.postnummer);
  const idx = avkodaLopare(data.omradeIdx);
  if (postnummer.length !== idx.length) throw new Error("Register: generated data is inconsistent");
  const omradeForPostnummer = new Map<string, RegisteromradeSlug>();
  postnummer.forEach((pn, i) =>
    omradeForPostnummer.set(pn, SLUGS[idx[i] as number] as RegisteromradeSlug),
  );
  return {
    omradeForPostnummer,
    osakra: new Set(avkodaPostnummerLista(data.osakra)),
    ovriga: new Set(avkodaPostnummerLista(data.ovriga)),
    stadsdelar: new Map(
      Object.entries(data.stadsdelar).map(([namn, i]) => [namn, SLUGS[i] as RegisteromradeSlug]),
    ),
  };
}

let cache: ReturnType<typeof byggTabeller> | undefined;
function tabeller() {
  cache ??= byggTabeller();
  return cache;
}

// ---- public helpers ------------------------------------------------------

export function registeromradeForSlug(slug: string): Registeromrade | undefined {
  return REGISTEROMRADEN.find((a) => a.slug === slug);
}

export function arRegisteromradeSlug(slug: string): slug is RegisteromradeSlug {
  return SLUGS.includes(slug as RegisteromradeSlug);
}

/** Display name for any slug incl. `ovriga-stockholm`; undefined for an unknown slug. */
export function omradeNamn(slug: string): string | undefined {
  if (slug === OVRIGA_STOCKHOLM.slug) return OVRIGA_STOCKHOLM.namn;
  return registeromradeForSlug(slug)?.namn;
}

/** Normalises "112 42", "11242", "SE-112 42" to "11242"; null when it is not a 5-digit postnummer. */
export function normaliseraPostnummer(raw: string): string | null {
  const siffror = raw.replace(/\D/g, "");
  return /^[1-9]\d{4}$/.test(siffror) ? siffror : null;
}

/**
 * Register area of an SBK stadsdel polygon name (as in
 * ml/mapping/sources/stadsdelar_fullsize.geo.json, e.g. "KUNGSHOLMEN"). Case
 * and surrounding whitespace are ignored; null for an unknown name.
 */
export function registeromradeForStadsdel(stadsdel: string): RegisteromradeSlug | null {
  return tabeller().stadsdelar.get(stadsdel.trim().toLocaleUpperCase("sv-SE")) ?? null;
}

/**
 * Area of one postnummer from the precomputed majority table: one of the 19
 * areas, `ovriga-stockholm` (in Stockholms kommun, no stadsdel known), or null
 * (unknown, or not in Stockholms kommun).
 */
export function omradeForPostnummer(
  postnummer: string,
): RegisteromradeSlug | OvrigaStockholmSlug | null {
  const pn = normaliseraPostnummer(postnummer);
  if (!pn) return null;
  const t = tabeller();
  return t.omradeForPostnummer.get(pn) ?? (t.ovriga.has(pn) ? OVRIGA_STOCKHOLM.slug : null);
}

/** True when the table's area for this postnummer is a weak call (straddles areas or neighbour conflict). */
export function postnummerArOsaker(postnummer: string): boolean {
  const pn = normaliseraPostnummer(postnummer);
  return pn !== null && tabeller().osakra.has(pn);
}

/**
 * Resolves a BRF's register area from evidence groups, PLAN-v3 2.2 priority:
 * `rapport_adress` > `import` > `anvandare`.
 *
 * - The highest-priority source that has at least one resolvable postnummer
 *   decides; lower sources are only consulted when it has none (an unknown or
 *   non-Stockholm postnummer is not a vote).
 * - Within a source: majority of postnummer votes among the 19 areas; a tie is
 *   broken by display order and flagged `osakert`. Only if no postnummer maps to
 *   one of the 19 areas does `ovriga-stockholm` win.
 * - Several groups with the same `kalla` are pooled.
 * - Nothing resolvable -> `omrade: null` (the BRF stays unlisted).
 */
export function losRegisteromrade(indata: readonly OmradeIndata[]): OmradeResultat {
  const t = tabeller();
  for (const kalla of OMRADE_KALLOR) {
    const roster = new Map<RegisteromradeSlug, { n: number; osakra: number }>();
    let ovriga = 0;
    for (const grupp of indata) {
      if (grupp.kalla !== kalla) continue;
      for (const raw of grupp.postnummer) {
        const pn = normaliseraPostnummer(raw);
        if (!pn) continue;
        const slug = t.omradeForPostnummer.get(pn);
        if (slug) {
          const post = roster.get(slug) ?? { n: 0, osakra: 0 };
          post.n += 1;
          if (t.osakra.has(pn)) post.osakra += 1;
          roster.set(slug, post);
        } else if (t.ovriga.has(pn)) {
          ovriga += 1;
        }
      }
    }
    if (roster.size > 0) {
      const rader = [...roster.entries()].sort(
        ([a, x], [b, y]) =>
          y.n - x.n ||
          (registeromradeForSlug(a)?.ordning ?? 0) - (registeromradeForSlug(b)?.ordning ?? 0),
      );
      const [vinnare, v] = rader[0] as [RegisteromradeSlug, { n: number; osakra: number }];
      const totalt = rader.reduce((s, [, x]) => s + x.n, 0);
      const delad = rader.length > 1 && (rader[1] as [string, { n: number }])[1].n === v.n;
      return {
        omrade: vinnare,
        kalla,
        antal: totalt,
        andel: v.n / totalt,
        osakert: delad || v.osakra === v.n,
      };
    }
    if (ovriga > 0) {
      return { omrade: OVRIGA_STOCKHOLM.slug, kalla, antal: ovriga, andel: 1, osakert: false };
    }
  }
  return { omrade: null, kalla: null, antal: 0, andel: 0, osakert: false };
}
