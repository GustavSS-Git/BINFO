/**
 * Local (free, deterministic) identification of WHICH association and WHICH
 * fiscal year an uploaded årsredovisning belongs to, from its text layer.
 * The register (docs/PLAN-v2.md section 3) keys analyses on orgnr + räkenskapsår,
 * so this runs before any model call; scans and ambiguous reports fall back to
 * identitetModell.ts.
 *
 * Principles:
 *  - Never guess. `identitet` is non-null only when BOTH the orgnr and the
 *    fiscal year are confidently supported; otherwise null plus `skal`.
 *  - The orgnr is decided by a vote over pages (it is repeated in the page
 *    footers of most reports), Luhn-checked, and a close race is a null.
 *  - The fiscal year is the END year of the fiscal year (a broken year
 *    2024-09-01 - 2025-08-31 is 2025). An explicit date range after a
 *    räkenskapsår keyword outranks everything else; flerårsöversikt column
 *    headers ("2025 2024 2023") and cover years never decide on their own.
 */

export interface Rapportidentitet {
  /** "XXXXXX-XXXX" */
  orgnr: string;
  /** Fiscal year END year. */
  rakenskapsar: number;
  namn: string | null;
}

export interface LokalIdentifiering {
  /** null unless BOTH orgnr and year are confident. */
  identitet: Rapportidentitet | null;
  orgnrKandidater: Array<{ orgnr: string; antalSidor: number }>;
  arKandidater: number[];
  /** Why null / what was ambiguous (internal, not shown to users). */
  skal: string[];
}

// ---------------------------------------------------------------------------
// Orgnr: format, Luhn, normalisation
// ---------------------------------------------------------------------------

function luhnGiltig(tio: string): boolean {
  let summa = 0;
  for (let i = 0; i < 10; i++) {
    let siffra = Number(tio[i]);
    if (i % 2 === 0) {
      siffra *= 2;
      if (siffra > 9) siffra -= 9;
    }
    summa += siffra;
  }
  return summa % 10 === 0;
}

/** True for "XXXXXX-XXXX" with a valid Luhn check digit (Swedish organisationsnummer). */
export function arGiltigtOrgnr(orgnr: string): boolean {
  if (!/^\d{6}-\d{4}$/.test(orgnr)) return false;
  return luhnGiltig(orgnr.replace("-", ""));
}

/**
 * "7696160253" / "769616-0253" / "769616 – 0253" -> "769616-0253". Format only
 * (exactly ten digits); null otherwise. Does NOT check Luhn: pair with
 * `arGiltigtOrgnr`.
 */
export function normaliseraOrgnr(text: string): string | null {
  const t = text.trim();
  if (!/^\d{6}\s*[-–−—]?\s*\d{4}$/.test(t)) return null;
  const siffror = t.replace(/\D/g, "");
  return `${siffror.slice(0, 6)}-${siffror.slice(6)}`;
}

const ORG_KEYWORD = String.raw`org(?:anisations)?[\s.]?-?(?:nr|nummer)\.?`;
/** Dashed orgnr; the leading group keeps us from matching inside a longer digit run or a date. */
const ORGNR_MED_BINDESTRECK = /(^|[^\d-])(\d{6})\s?[-–−—]\s?(\d{4})(?!\d)/g;
/** Ten digits without a dash count ONLY directly after an org keyword. */
const ORGNR_UTAN_BINDESTRECK = new RegExp(String.raw`${ORG_KEYWORD}[\s:]*(\d{10})(?!\d)`, "gi");
/** Letter-spaced text layers ("7 6 9 6 2 4 - 6 9 5 3"): only a line holding nothing else. */
const ORGNR_SPERRAT = /^\s*(\d) (\d) (\d) (\d) (\d) (\d) - (\d) (\d) (\d) (\d)\s*$/;
const ORG_NARA = new RegExp(ORG_KEYWORD + String.raw`[\s:]*$`, "i");
/**
 * The text right before an orgnr ends in a company form / audit firm word:
 * "Kvadrat Revision AB, org.nr ...". Anchored at the end on purpose: words
 * like "Riksbyggen", "HSB" or "Revisionsberättelse" appear in the BRF's own
 * footers and must NOT make the BRF's orgnr a third party.
 */
const TREDJE_PART_FORE = new RegExp(
  String.raw`(?:\b(?:AB|Aktiebolag|HB|KB|Revisionsbyrå|Revisionsbolag|Revision|Förvaltning|Fastighetsförvaltning)\b)[\s,.:(]*(?:${ORG_KEYWORD})?[\s:]*$`,
  "i",
);

interface OrgnrTraff {
  orgnr: string;
  narOrgNyckelord: boolean;
  tredjePart: boolean;
}

function hittaOrgnrPaSida(sida: string): OrgnrTraff[] {
  const traffar: OrgnrTraff[] = [];
  const text = sida.replace(/\s+/g, " ");

  for (const m of text.matchAll(ORGNR_MED_BINDESTRECK)) {
    const orgnr = `${m[2]}-${m[3]}`;
    if (!arGiltigtOrgnr(orgnr)) continue;
    const start = (m.index ?? 0) + (m[1]?.length ?? 0);
    const fore = text.slice(Math.max(0, start - 60), start);
    traffar.push({
      orgnr,
      narOrgNyckelord: ORG_NARA.test(fore),
      tredjePart: TREDJE_PART_FORE.test(fore),
    });
  }

  for (const m of text.matchAll(ORGNR_UTAN_BINDESTRECK)) {
    const tio = m[1] ?? "";
    const orgnr = `${tio.slice(0, 6)}-${tio.slice(6)}`;
    if (!arGiltigtOrgnr(orgnr)) continue;
    const start = m.index ?? 0;
    const fore = text.slice(Math.max(0, start - 60), start);
    traffar.push({
      orgnr,
      narOrgNyckelord: true,
      tredjePart: TREDJE_PART_FORE.test(fore),
    });
  }

  for (const rad of sida.split("\n")) {
    const m = ORGNR_SPERRAT.exec(rad);
    if (!m) continue;
    const orgnr = `${m.slice(1, 7).join("")}-${m.slice(7, 11).join("")}`;
    if (arGiltigtOrgnr(orgnr)) traffar.push({ orgnr, narOrgNyckelord: false, tredjePart: false });
  }

  return traffar;
}

interface OrgnrStod {
  orgnr: string;
  sidor: Set<number>;
  narOrgNyckelord: boolean;
}

/** Page support, weighted: a 7xxxxx number (typical for a BRF) counts 1.5x and
 *  an org keyword next to it adds 1. A preference, never a requirement. */
function orgnrPoang(stod: OrgnrStod): number {
  const vikt = stod.orgnr.startsWith("7") ? 1.5 : 1;
  return stod.sidor.size * vikt + (stod.narOrgNyckelord ? 1 : 0);
}

function valjOrgnr(sidor: readonly string[]): {
  orgnr: string | null;
  kandidater: Array<{ orgnr: string; antalSidor: number }>;
  skal: string[];
} {
  const skal: string[] = [];
  const stod = new Map<string, OrgnrStod>();
  let enbartTredjePart = 0;

  sidor.forEach((sida, index) => {
    const tredjePartHar = new Set<string>();
    for (const traff of hittaOrgnrPaSida(sida)) {
      if (traff.tredjePart) {
        tredjePartHar.add(traff.orgnr);
        continue;
      }
      let post = stod.get(traff.orgnr);
      if (!post) {
        post = { orgnr: traff.orgnr, sidor: new Set(), narOrgNyckelord: false };
        stod.set(traff.orgnr, post);
      }
      post.sidor.add(index);
      if (traff.narOrgNyckelord) post.narOrgNyckelord = true;
    }
    for (const orgnr of tredjePartHar) if (!stod.has(orgnr)) enbartTredjePart += 1;
  });

  const rangordnade = [...stod.values()].sort(
    (a, b) => orgnrPoang(b) - orgnrPoang(a) || b.sidor.size - a.sidor.size,
  );
  const kandidater = rangordnade.map((s) => ({ orgnr: s.orgnr, antalSidor: s.sidor.size }));

  const topp = rangordnade[0];
  if (!topp) {
    skal.push(
      enbartTredjePart > 0
        ? "Inget orgnr hittades som inte stod bredvid ett bolag (revisor/förvaltare)."
        : "Inget giltigt orgnr (NNNNNN-NNNN med korrekt Luhn-kontrollsiffra) hittades i textlagret.",
    );
    return { orgnr: null, kandidater, skal };
  }
  const tvaa = rangordnade[1];
  if (tvaa && orgnrPoang(topp) < 2 * orgnrPoang(tvaa)) {
    skal.push(
      `Orgnr tvetydigt: ${topp.orgnr} (${topp.sidor.size} sidor) mot ${tvaa.orgnr} (${tvaa.sidor.size} sidor) — för jämnt stöd.`,
    );
    return { orgnr: null, kandidater, skal };
  }
  return { orgnr: topp.orgnr, kandidater, skal };
}

// ---------------------------------------------------------------------------
// Räkenskapsår (fiscal year END year)
// ---------------------------------------------------------------------------

const DATUM = String.raw`(20\d{2})-?(0[1-9]|1[0-2])-?(0[1-9]|[12]\d|3[01])`;
const AVGRANSARE = String.raw`\s*(?:-|–|—|−|till|t\.?o\.?m\.?)\s*`;
const DATUMINTERVALL = new RegExp(`(?<![\\d-])${DATUM}${AVGRANSARE}${DATUM}(?![\\d])`, "gi");
/** The interval must be introduced by one of these directly before it. */
const RAKENSKAPSAR_NYCKELORD =
  /(?:räkenskaps(?:år|året)|verksamhetsår|verksamhetsåret|perioden|för tiden)[\s:]*$/i;
/** "räkenskapsåret 2025", "räkenskapsåret 2024/2025" (but not a date: "2025-01-01"). */
const RAKENSKAPSAR_ENKELT =
  /räkenskaps(?:år|året)\s+(20\d{2})(?:\s*\/\s*(20\d{2}))?(?![\d]|\s*-\s*\d{2})/gi;
const ARSREDOVISNING_FOR_AR = /årsredovisning(?:en)?\s+för\s+(20\d{2})(?![\d-])/gi;
/** Cover/footer years ("Årsredovisning 2025", "2025 ÅRSREDOVISNING"). Weakest evidence. */
const OMSLAGSAR = /(?:årsredovisning\s+(20\d{2})(?![\d-])|(?<![\d-])(20\d{2})\s*årsredovisning)/gi;

function dagarMellan(
  a: { y: number; m: number; d: number },
  b: { y: number; m: number; d: number },
): number {
  return (Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000;
}

function raknaSidor(map: Map<number, Set<number>>, ar: number, sida: number): void {
  const set = map.get(ar) ?? new Set<number>();
  set.add(sida);
  map.set(ar, set);
}

function valjAr(sidor: readonly string[]): {
  ar: number | null;
  kandidater: number[];
  skal: string[];
} {
  const skal: string[] = [];
  const intervall = new Map<number, Set<number>>(); // end year -> pages (keyworded date range)
  const enkelt = new Map<number, Set<number>>(); // "räkenskapsåret 2025"
  const omslag = new Map<number, Set<number>>(); // cover year

  sidor.forEach((sida, index) => {
    const text = sida.replace(/\s+/g, " ");

    for (const m of text.matchAll(DATUMINTERVALL)) {
      const start = m.index ?? 0;
      if (!RAKENSKAPSAR_NYCKELORD.test(text.slice(Math.max(0, start - 30), start))) continue;
      const fran = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
      const till = { y: Number(m[4]), m: Number(m[5]), d: Number(m[6]) };
      const dagar = dagarMellan(fran, till);
      // A fiscal year is 12 months; the first/last one may be shorter or up to 18 months.
      if (dagar < 0 || dagar > 20 * 31) {
        skal.push(`Ogiltigt datumintervall efter räkenskapsår: ${m[0]}`);
        continue;
      }
      raknaSidor(intervall, till.y, index);
    }

    for (const m of text.matchAll(RAKENSKAPSAR_ENKELT)) {
      const start = m.index ?? 0;
      if (/föregående\s*$/i.test(text.slice(Math.max(0, start - 20), start))) continue;
      const forsta = Number(m[1]);
      const andra = m[2] ? Number(m[2]) : null;
      if (andra === null) raknaSidor(enkelt, forsta, index);
      else if (andra === forsta + 1) raknaSidor(enkelt, andra, index);
      else skal.push(`Oklart räkenskapsår: ${m[0]}`);
    }
    for (const m of text.matchAll(ARSREDOVISNING_FOR_AR)) {
      raknaSidor(enkelt, Number(m[1]), index);
    }

    if (index < 3) {
      for (const m of text.matchAll(OMSLAGSAR)) {
        raknaSidor(omslag, Number(m[1] ?? m[2]), index);
      }
    }
  });

  const alla = new Map<number, number>();
  for (const karta of [intervall, enkelt, omslag]) {
    for (const [ar, sidset] of karta) alla.set(ar, (alla.get(ar) ?? 0) + sidset.size);
  }
  const kandidater = [...alla.entries()]
    .sort((a, b) => b[1] - a[1] || b[0] - a[0])
    .map(([ar]) => ar);

  // An explicit date range decides if it exists; otherwise "räkenskapsåret YYYY";
  // the cover year never decides alone.
  const beslutskalla = intervall.size > 0 ? intervall : enkelt;
  if (beslutskalla.size === 0) {
    skal.push(
      omslag.size > 0
        ? "Räkenskapsåret anges bara som omslagsår (Årsredovisning YYYY) — inte tillräckligt säkert."
        : "Inget räkenskapsår hittades (varken datumintervall eller 'räkenskapsåret YYYY').",
    );
    return { ar: null, kandidater, skal };
  }

  const rangordnade = [...beslutskalla.entries()].sort((a, b) => b[1].size - a[1].size);
  const [toppAr, toppSidor] = rangordnade[0]!;
  const tvaa = rangordnade[1];
  if (tvaa && toppSidor.size < 2 * tvaa[1].size) {
    skal.push(
      `Räkenskapsår tvetydigt: ${toppAr} (${toppSidor.size} sidor) mot ${tvaa[0]} (${tvaa[1].size} sidor).`,
    );
    return { ar: null, kandidater, skal };
  }
  return { ar: toppAr, kandidater, skal };
}

// ---------------------------------------------------------------------------
// Name
// ---------------------------------------------------------------------------

const FORENING_NYCKELORD =
  /(?<![\p{L}\d])(Bostadsrättsföreningen|Bostadsrättsförening|Bostadsföreningen|Brf|BRF|Bf|BF|RBF)(?![\p{L}\d])/u;
const NAMN_SLUT =
  /\s+(?:med säte|org\.?\s?-?\s?nr|organisationsnummer|Org\b|får\b|har\b|upprättar|avger|avge\b|registrerades|\d+\(\d+\))|[,;|]|\.\s|\s[-–]\s/i;
const NAMN_SIDOR = 5;

function namnFranRad(rad: string, nastaRad: string | undefined): string | null {
  const m = FORENING_NYCKELORD.exec(rad);
  if (!m) return null;
  const nyckelord = m[1] ?? "";
  const efter = rad.slice((m.index ?? 0) + nyckelord.length).trim();
  let rest = efter;
  if (rest === "") {
    // The name continues on the next line, but only when the keyword starts the
    // line or follows "Riksbyggen"/"HSB" ("Att bo i BRF / Ordlista" must not count).
    const fore = rad.slice(0, m.index ?? 0).trim();
    if (fore !== "" && !/(?:Riksbyggen|HSB)$/i.test(fore)) return null;
    rest = (nastaRad ?? "").trim();
  }
  const slut = NAMN_SLUT.exec(rest);
  if (slut) rest = rest.slice(0, slut.index);
  rest = rest
    .trim()
    .replace(/[.:]+$/, "")
    .trim();
  if (rest.length < 2 || rest.length > 80) return null;
  if (!/^[\p{Lu}\d]/u.test(rest)) return null;
  return `${nyckelord} ${rest}`;
}

function valjNamn(sidor: readonly string[], skal: string[]): string | null {
  const traffar: Array<{ namn: string; sida: number }> = [];
  sidor.slice(0, NAMN_SIDOR).forEach((sida, index) => {
    const rader = sida.split("\n");
    rader.forEach((rad, i) => {
      const namn = namnFranRad(rad, rader[i + 1]);
      if (namn) traffar.push({ namn, sida: index });
    });
  });

  // Cluster fuzzy-equal spellings; the cluster seen on most pages wins.
  const grupper: Array<{ namn: Map<string, number>; sidor: Set<number> }> = [];
  for (const t of traffar) {
    const grupp = grupper.find((g) => [...g.namn.keys()].some((n) => namnLiknar(n, t.namn)));
    if (grupp) {
      grupp.namn.set(t.namn, (grupp.namn.get(t.namn) ?? 0) + 1);
      grupp.sidor.add(t.sida);
    } else {
      grupper.push({ namn: new Map([[t.namn, 1]]), sidor: new Set([t.sida]) });
    }
  }
  if (grupper.length === 0) return null;
  grupper.sort((a, b) => b.sidor.size - a.sidor.size);
  const topp = grupper[0]!;
  const tvaa = grupper[1];
  if (tvaa && tvaa.sidor.size >= topp.sidor.size) {
    skal.push("Föreningsnamnet är oklart (flera olika namn med lika stöd) — namn utelämnat.");
    return null;
  }
  return [...topp.namn.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]![0];
}

const FORENING_ORD = new Set([
  "bostadsrattsforeningen",
  "bostadsrattsforening",
  "bostadsforeningen",
  "brf",
  "bf",
  "rbf",
]);
const LEDANDE_FORVALTARE = new Set(["riksbyggen", "hsb"]);

function namnTokens(namn: string): string[] {
  const rent = namn
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const tokens = rent === "" ? [] : rent.split(" ");
  const utanForening = tokens.filter((t) => !FORENING_ORD.has(t));
  while (utanForening.length > 0 && LEDANDE_FORVALTARE.has(utanForening[0]!)) utanForening.shift();
  return utanForening;
}

/**
 * Fuzzy BRF-name match. Ignores case, diacritics, punctuation, whitespace,
 * the legal form ("Brf" = "Bostadsrättsföreningen" = "Bf") and a leading
 * Riksbyggen/HSB. Digits matter ("Granen" != "Granen 2"). The only tolerated
 * difference is a trailing place suffix ("Näcken 2" = "Näcken 2 i Umeå").
 */
export function namnLiknar(a: string, b: string): boolean {
  const ta = namnTokens(a);
  const tb = namnTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  if (ta.join("") === tb.join("")) return true;
  const [kort, lang] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return (
    lang.length > kort.length + 1 &&
    kort.every((token, i) => lang[i] === token) &&
    lang[kort.length] === "i"
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** `sidor[0]` is page 1. Pure; never throws. */
export function identifieraLokalt(sidor: readonly string[]): LokalIdentifiering {
  const skal: string[] = [];
  if (sidor.every((s) => s.trim() === "")) {
    return {
      identitet: null,
      orgnrKandidater: [],
      arKandidater: [],
      skal: ["Inget textlager — kan inte identifiera lokalt."],
    };
  }

  const org = valjOrgnr(sidor);
  const ar = valjAr(sidor);
  skal.push(...org.skal, ...ar.skal);

  if (org.orgnr === null || ar.ar === null) {
    return { identitet: null, orgnrKandidater: org.kandidater, arKandidater: ar.kandidater, skal };
  }
  return {
    identitet: { orgnr: org.orgnr, rakenskapsar: ar.ar, namn: valjNamn(sidor, skal) },
    orgnrKandidater: org.kandidater,
    arKandidater: ar.kandidater,
    skal,
  };
}
