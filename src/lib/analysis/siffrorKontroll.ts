import type { ExtractionResult } from "@/types/analysis";
import type { FastaVarden } from "./fastaVarden";

/**
 * Number check on the judging model's free text (betygMotivering): finds the
 * numbers that match nothing in the data the model was given. Pure.
 *
 * Aimed at catching real errors with few false positives. A false positive
 * costs one extra (small) model call, a miss lets a wrong number reach the
 * buyer, so the rules are: parse Swedish number formats and units, scale to
 * base units, take the tolerance from the text's own precision, let
 * approximation words widen the match one-sidedly within a bound, and skip
 * what cannot be a data point (page references, small counts, years that occur
 * in the report).
 *
 * Candidate pools come from the whole extraction (numeric values AND numbers
 * inside strings such as cited excerpts) plus the fixed values the judging
 * prompt handed over. Percentages match only percentage candidates; amounts
 * (kr) match amount candidates; kr/m² match kr/m² candidates. Comparison is on
 * absolute values ("underskott på 12 kr" for -12).
 */

export type SiffraTyp = "procent" | "belopp" | "kr_per_m2" | "yta" | "tal" | "ar";

export interface SiffraAvvikelse {
  /** The number as written in the text, with its unit (e.g. "6 759 091 kr"). */
  text: string;
  /** Absolute value in base units (kr, percent, m², ...). */
  varde: number;
  typ: SiffraTyp;
  /** Plain-Swedish explanation for the regeneration prompt. */
  skal: string;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

type Enhet = "procent" | "procentenhet" | "belopp" | "kr_per_m2" | "yta" | "ingen";

interface Token {
  /** The matched number plus its unit, as written. */
  text: string;
  start: number;
  end: number;
  /** Absolute value, scaled (tkr, miljoner, ...). */
  varde: number;
  enhet: Enhet;
  /** Decimals shown in the number as written. */
  decimaler: number;
  /** Trailing zeros of a whole number as written ("5 760 000" → 4). */
  nollor: number;
  /** Multiplier from the unit word (1000 for tkr, ...). */
  skala: number;
  /** Written with a thousands separator or a decimal: cannot be a year. */
  harSeparator: boolean;
  heltalUtanSkala: boolean;
}

const MELLANRUM = "[ \\u00A0\\u202F\\u2009]";
const TAL_REGEX = new RegExp(
  `(?<![\\d\\p{L}])` + // not glued to a preceding digit/letter (identifiers like "A12")
    `(?:[-\\u2212](?=\\d))?` + // optional minus, validated below
    `(?:\\d{1,3}(?:${MELLANRUM}\\d{3})+|\\d+)` +
    `(?:[,.]\\d+)?` +
    `(?!\\d)`,
  "gu",
);

const ENHET_REGEX = new RegExp(
  `^${MELLANRUM}*(` +
    [
      "kr\\/(?:m²|m2|kvm)",
      `(?:kr|kronor)${MELLANRUM}+per${MELLANRUM}+(?:m²|m2|kvm|kvadratmeter)`,
      "%",
      "procentenheter",
      "procentenhet",
      "procent",
      `tusen${MELLANRUM}+(?:kronor|kr)`,
      "tusen",
      "tkr",
      "mnkr",
      "mkr",
      "mdkr",
      "miljoner",
      "miljon",
      "miljarder",
      "miljard",
      "kronor",
      "kr",
      ":-",
      "sek",
      "m²",
      "m2",
      "kvm",
      "kvadratmeter",
    ].join("|") +
    `)(?![\\p{L}\\d])`,
  "iu",
);

function skalaOchEnhet(enhetText: string): { skala: number; enhet: Enhet } {
  const e = enhetText.toLowerCase().replace(/[\s\u00A0\u202F\u2009]+/g, " ");
  if (/^(kr|kronor)( per |\/)(m²|m2|kvm|kvadratmeter)/.test(e)) {
    return { skala: 1, enhet: "kr_per_m2" };
  }
  if (e === "%" || e === "procent") return { skala: 1, enhet: "procent" };
  if (e.startsWith("procentenhet")) return { skala: 1, enhet: "procentenhet" };
  if (e === "tkr" || e.startsWith("tusen")) return { skala: 1_000, enhet: "belopp" };
  if (e === "mkr" || e === "mnkr" || e.startsWith("miljon")) {
    return { skala: 1_000_000, enhet: "belopp" };
  }
  if (e === "mdkr" || e.startsWith("miljard")) return { skala: 1_000_000_000, enhet: "belopp" };
  if (e === "m²" || e === "m2" || e === "kvm" || e === "kvadratmeter") {
    return { skala: 1, enhet: "yta" };
  }
  return { skala: 1, enhet: "belopp" }; // kr, kronor, :-, sek
}

/** Reads every number in a text, with its unit and precision. */
function lasTal(text: string): Token[] {
  const tokens: Token[] = [];
  for (const m of text.matchAll(TAL_REGEX)) {
    const rå = m[0];
    const start = m.index ?? 0;
    // The sign is irrelevant (comparison is on absolute values); the regex only
    // consumes a "-" or "−" that directly precedes a number and is not glued to
    // a preceding digit/letter, so "2026-03-01" and "A-C" are never read as negatives.
    const numerisk = /^[-\u2212]/.test(rå) ? rå.slice(1) : rå;
    const [heltalsdel = "", decimaldel] = numerisk.replace(",", ".").split(".");
    const heltal = heltalsdel.replace(/[ \u00A0\u202F\u2009]/g, "");
    const decimaler = decimaldel?.length ?? 0;
    const nollor = decimaldel === undefined ? (/0+$/.exec(heltal)?.[0].length ?? 0) : 0;
    const basvarde = Number(`${heltal}${decimaldel !== undefined ? `.${decimaldel}` : ""}`);
    if (!Number.isFinite(basvarde)) continue;

    const efter = text.slice(start + rå.length);
    const enhetMatch = ENHET_REGEX.exec(efter);
    let enhet: Enhet = "ingen";
    let skala = 1;
    let slut = start + rå.length;
    let skrivet = rå;
    if (enhetMatch) {
      const tolkad = skalaOchEnhet(enhetMatch[1]!);
      enhet = tolkad.enhet;
      skala = tolkad.skala;
      slut += enhetMatch[0].length;
      // "5,8 miljoner kr": report the currency word with the number.
      if (skala > 1) {
        const valuta = /^[ \u00A0\u202F]+(?:kronor|kr)(?![\p{L}\d])/iu.exec(text.slice(slut));
        if (valuta) slut += valuta[0].length;
      }
      skrivet = text.slice(start, slut);
    } else if (/(?:\bkr|\bsek)[ \u00A0]*$/i.test(text.slice(0, start))) {
      enhet = "belopp"; // "kr 2 284"
    }

    tokens.push({
      text: skrivet.trim(),
      start,
      end: slut,
      varde: Math.abs(basvarde * skala),
      enhet,
      decimaler,
      nollor: heltal === "0" ? 0 : nollor,
      skala,
      harSeparator: decimaldel !== undefined || /[ \u00A0\u202F\u2009]/.test(numerisk),
      heltalUtanSkala: decimaldel === undefined && skala === 1,
    });
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Candidate pools
// ---------------------------------------------------------------------------

interface Kandidater {
  procent: number[];
  belopp: number[];
  krPerM2: number[];
  yta: number[];
  /** Unitless numbers found in strings (excerpts, labels): may be of any kind except percent. */
  losa: number[];
  /** Every number of every kind, for unitless text numbers and years. */
  alla: number[];
}

function nyaKandidater(): Kandidater {
  return { procent: [], belopp: [], krPerM2: [], yta: [], losa: [], alla: [] };
}

function laggTillVarde(k: Kandidater, varde: number, enhet: string): void {
  const v = Math.abs(varde);
  k.alla.push(v);
  switch (enhet) {
    case "procent":
      k.procent.push(v);
      break;
    case "kr":
    case "kr/man":
      k.belopp.push(v);
      break;
    case "kr/m2":
    case "kr/m2/ar":
      k.krPerM2.push(v);
      break;
    case "m2":
      k.yta.push(v);
      break;
    default:
      break;
  }
}

function laggTillTalIText(k: Kandidater, text: string): void {
  for (const t of lasTal(text)) {
    // Small whole numbers without a unit in prose (date parts like the 03 of
    // 2026-03-01, counts) say nothing and would only make a wrong small number match.
    if (t.enhet === "ingen" && t.heltalUtanSkala && t.varde < 100) continue;
    k.alla.push(t.varde);
    switch (t.enhet) {
      case "procent":
      case "procentenhet":
        k.procent.push(t.varde);
        break;
      case "belopp":
        k.belopp.push(t.varde);
        break;
      case "kr_per_m2":
        k.krPerM2.push(t.varde);
        break;
      case "yta":
        k.yta.push(t.varde);
        break;
      case "ingen":
        k.losa.push(t.varde);
        break;
    }
  }
}

/** Walks the whole object: Figure-like nodes by unit, other numbers anywhere, numbers inside strings. */
function samlaFranObjekt(varde: unknown, k: Kandidater): void {
  if (typeof varde === "string") {
    laggTillTalIText(k, varde);
    return;
  }
  if (typeof varde === "number") {
    if (Number.isFinite(varde)) {
      k.alla.push(Math.abs(varde));
      k.losa.push(Math.abs(varde));
    }
    return;
  }
  if (Array.isArray(varde)) {
    for (const v of varde) samlaFranObjekt(v, k);
    return;
  }
  if (varde === null || typeof varde !== "object") return;
  const objekt = varde as Record<string, unknown>;
  const enhet = objekt["unit"];
  const v = objekt["value"];
  const aktuell = typeof v === "number" && typeof enhet === "string";
  if (aktuell) laggTillVarde(k, v, enhet);
  for (const [nyckel, under] of Object.entries(objekt)) {
    // A Figure's own value is already pooled by unit; its unit string carries no numbers.
    if (aktuell && (nyckel === "value" || nyckel === "unit")) continue;
    // Page numbers are references, not data.
    if (nyckel === "page") continue;
    samlaFranObjekt(under, k);
  }
}

function samlaKandidater(extraction: ExtractionResult, fasta: FastaVarden): Kandidater {
  const k = nyaKandidater();
  samlaFranObjekt(extraction, k);
  // Fixed values: the numbers the judging prompt handed over.
  for (const n of fasta.nyckeltal) {
    if (n.value !== null) laggTillVarde(k, n.value, n.unit);
  }
  if (fasta.lan) {
    const lan = fasta.lan;
    laggTillVarde(k, lan.totalSkuld, "kr");
    for (const f of lan.forfallo) {
      laggTillVarde(k, f.belopp, "kr");
      laggTillVarde(k, f.andelProcent, "procent");
      if (f.ranta) laggTillVarde(k, f.ranta.value, f.ranta.unit);
    }
    for (const b of lan.efterBalansdag?.band ?? []) {
      laggTillVarde(k, b.belopp, "kr");
      laggTillVarde(k, b.andelProcent, "procent");
    }
    for (const a of lan.perAr) {
      laggTillVarde(k, a.belopp, "kr");
      laggTillVarde(k, a.andelProcent, "procent");
    }
    for (const c of lan.kumulativt) {
      laggTillVarde(k, c.belopp, "kr");
      laggTillVarde(k, c.andelProcent, "procent");
    }
    if (lan.snittranta) laggTillVarde(k, lan.snittranta.value, lan.snittranta.unit);
  }
  return k;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

type Narmevard = "over" | "under" | "cirka" | "exakt";

const NARMEVARD_ORD: Array<[RegExp, Narmevard]> = [
  [/(?:^|[\s(,;:])(?:drygt|över|mer än|mera än|fler än|ovan)$/u, "over"],
  [/(?:^|[\s(,;:])(?:knappt|nästan|under|närmare|nära|mindre än|färre än)$/u, "under"],
  [/(?:^|[\s(,;:])(?:cirka|circa|ca\.?|omkring|runt|ungefär|ungef\.)$/u, "cirka"],
];

/** The approximation word directly in front of a number, if any ("på drygt 70 %"). */
function narmevardFore(text: string, start: number): Narmevard {
  let fore = text
    .slice(Math.max(0, start - 30), start)
    .toLowerCase()
    .replace(/[\s\u00A0\u202F]+/g, " ")
    .trimEnd();
  // Filler between the approximation word and the number: "ungefär på 70", "drygt kr 70".
  for (;;) {
    const utanFyllnad = fore.replace(/ (?:på|om|av|kr|sek|ett|en)$/u, "").trimEnd();
    if (utanFyllnad === fore) break;
    fore = utanFyllnad;
  }
  for (const [regex, art] of NARMEVARD_ORD) {
    if (regex.test(fore)) return art;
  }
  return "exakt";
}

const SIDHANVISNING =
  /(?:\b(?:sidan|sidorna|sidor|sida|sid|page|pages|ss?)\.?)[ \u00A0]*(?:\d+[ \u00A0]*(?:,|och|&|samt|–|-)[ \u00A0]*)*$/iu;

const EPS = 1e-9;

/** Does any candidate fall within the tolerance of the written number? */
function matchar(token: Token, kandidater: readonly number[], narme: Narmevard): boolean {
  const x = token.varde;
  // Rounding is fine (owner 2026-10-23): trailing zeros in an amount read as the
  // precision it was rounded to ("5 760 000 kr" ±5 000). Not for percentages,
  // where "70 %" for 74,2 % is a misstatement, not a rounding.
  const steg =
    token.decimaler > 0
      ? Math.pow(10, -token.decimaler)
      : token.enhet === "procent" || token.enhet === "procentenhet"
        ? 1
        : Math.pow(10, token.nollor);
  const precision = 0.5 * steg * token.skala;
  let lo = x - precision;
  let hi = x + precision;
  switch (narme) {
    case "over":
      hi = Math.max(hi, x * 1.15 + precision);
      break;
    case "under":
      lo = Math.min(lo, x * 0.85 - precision);
      break;
    case "cirka": {
      const bred = Math.max(x * 0.05, precision);
      lo = x - bred;
      hi = x + bred;
      break;
    }
    case "exakt":
      break;
  }
  return kandidater.some((c) => c >= lo - EPS && c <= hi + EPS);
}

function arGiltigt(token: Token, extraction: ExtractionResult, alla: readonly number[]): boolean {
  const r = extraction.forening.rakenskapsar;
  if (token.varde >= r && token.varde <= r + 2) return true;
  return alla.some((c) => c === token.varde);
}

function beskriv(token: Token, typ: SiffraTyp): string {
  switch (typ) {
    case "ar":
      return `årtalet ${token.text} finns inte i underlaget`;
    case "procent":
      return `procentsatsen ${token.text} finns inte bland procenttalen i underlaget eller de fasta värdena`;
    case "belopp":
      return `beloppet ${token.text} finns inte bland beloppen i underlaget eller de fasta värdena`;
    case "kr_per_m2":
      return `talet ${token.text} finns inte bland kronor per kvadratmeter i underlaget`;
    case "yta":
      return `ytan ${token.text} finns inte i underlaget`;
    case "tal":
      return `talet ${token.text} finns inte i underlaget eller de fasta värdena`;
  }
}

/**
 * Numbers in `text` that match nothing in the extraction or the fixed values.
 * Empty list = every checkable number is accounted for.
 */
export function kontrolleraSiffror(
  text: string,
  extraction: ExtractionResult,
  fasta: FastaVarden,
): SiffraAvvikelse[] {
  const k = samlaKandidater(extraction, fasta);
  const avvikelser: SiffraAvvikelse[] = [];
  const sedda = new Set<string>();

  const rapportera = (token: Token, typ: SiffraTyp) => {
    const nyckel = `${typ}:${token.text}`;
    if (sedda.has(nyckel)) return;
    sedda.add(nyckel);
    avvikelser.push({ text: token.text, varde: token.varde, typ, skal: beskriv(token, typ) });
  };

  for (const token of lasTal(text)) {
    if (SIDHANVISNING.test(text.slice(0, token.start))) continue;
    const narme = narmevardFore(text, token.start);

    switch (token.enhet) {
      case "procent":
        if (!matchar(token, k.procent, narme)) rapportera(token, "procent");
        break;
      case "procentenhet":
        // "räntan stiger med 2 procentenheter" is a scenario, not a data point.
        if (token.heltalUtanSkala && token.varde <= 10) break;
        if (!matchar(token, k.procent, narme)) rapportera(token, "procent");
        break;
      case "belopp":
        if (!matchar(token, [...k.belopp, ...k.losa], narme)) rapportera(token, "belopp");
        break;
      case "kr_per_m2":
        if (!matchar(token, [...k.krPerM2, ...k.losa], narme)) rapportera(token, "kr_per_m2");
        break;
      case "yta":
        if (!matchar(token, [...k.yta, ...k.losa], narme)) rapportera(token, "yta");
        break;
      case "ingen": {
        const ettAr =
          token.heltalUtanSkala &&
          !token.harSeparator &&
          token.varde >= 1900 &&
          token.varde <= 2100;
        if (ettAr) {
          if (!arGiltigt(token, extraction, k.alla)) rapportera(token, "ar");
          break;
        }
        // Counts like "2 lån" or "7 nyckeltal".
        if (token.heltalUtanSkala && token.varde < 100) break;
        if (!matchar(token, k.alla, narme)) rapportera(token, "tal");
        break;
      }
    }
  }
  return avvikelser;
}
