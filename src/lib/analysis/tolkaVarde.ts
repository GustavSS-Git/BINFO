import type {
  ExtractionResult,
  Figure,
  KeyFigure,
  KeyFigureId,
  Konfidens,
  Lan,
} from "@/types/analysis";
import { RORLIG_MAX_MANADER_EFTER_BALANSDAG } from "./calc/prognosantaganden";

/**
 * Deterministic parsing of a value exactly as printed in an annual report —
 * `Figure.tryckt` — into a number, a sign, or "missing". Pure and total: no
 * network, no model, same input always gives the same output. This is what
 * makes the parser testable exhaustively and what makes it trustworthy
 * enough to OVERRIDE the model's own `figure.value` when the two disagree
 * (see `tolkaNyckeltal` below) — CLAUDE.md's "never guess a domain number"
 * rule applies to the model just as much as to us, and a deterministic
 * regex is strictly more trustworthy than a model's own arithmetic on a
 * string it was merely asked to transcribe.
 *
 * Formats this must handle, per the answer-key survey across the ten test
 * reports (see the task brief):
 *   - "neg" / "negativ" (any case) — a sign is printed, no magnitude.
 *   - "(123)" and "−123" (U+2212) / "-123" (ASCII hyphen) — negative numbers.
 *   - "1 234,5" and the same with NBSP (U+00A0) or narrow NBSP (U+202F) as
 *     the thousands separator, comma as the decimal separator.
 *   - "kr", "tkr", "%", "kr/m²" / "kr/m2" as noise to strip.
 *   - bare "-", "–" (en dash), "—" (em dash), "" — no value at all.
 */

export interface TolkatTryckVarde {
  value: number | null;
  tecken?: "negativ" | "positiv";
  /** The untouched input this was parsed from — carried through so a
   *  caller never has to thread the original string alongside the result. */
  tryckt: string;
}

export interface SaknatTryckVarde {
  saknas: true;
  tryckt: string;
}

export type TolkningsUtfall = TolkatTryckVarde | SaknatTryckVarde;

export interface ParseTrycktVardeOptions {
  /**
   * Set ONLY when the caller already knows — from the table's own column
   * header, never guessed from the cell text itself — that this column's
   * unit is tusental kronor (tkr). When true, a plain numeric reading is
   * multiplied by 1000. The literal word "tkr" inside a cell is always
   * stripped as noise regardless of this flag; it is deliberately never
   * enough on its own to trigger the ×1000 — CLAUDE.md forbids guessing a
   * domain number, and inferring a unit from a single stray word in one
   * cell (rather than the column it belongs to) would be exactly that.
   */
  enhetTkr?: boolean;
}

/** Tokens that mean "no value printed here at all" — as opposed to "neg",
 *  which prints a sign without a magnitude. Includes the lone minus sign
 *  (U+2212) since a bare minus with nothing after it is bookkeeping
 *  shorthand for "no entry", not "a negative number". */
const SAKNAS_TOKENER = new Set(["-", "–", "—", "−", ""]);

const NEGATIVT_ORD = /^neg(ativ)?\.?$/i;
const POSITIVT_ORD = /^pos(itiv)?\.?$/i;

/** NBSP and narrow NBSP both occur as thousands separators in the corpus
 *  (Swedish typography prefers them over a plain space); normalize both to
 *  a plain space up front so every later step only has to think about one
 *  character. */
function normaliseraMellanslag(text: string): string {
  return text.replace(/[\u00a0\u202f]/g, " ");
}

function stripEnheter(text: string): string {
  return text
    .replace(/kr\s*\/\s*m2/gi, "")
    .replace(/kr\s*\/\s*m²/gi, "")
    .replace(/tkr/gi, "")
    .replace(/kr\b/gi, "")
    .replace(/%/g, "")
    .trim();
}

/**
 * Parses a single printed cell. Never throws and never guesses: anything it
 * cannot confidently place a number on comes back as `{ saknas: true }`
 * rather than an invented reading.
 */
export function parseTrycktVarde(
  raw: string,
  options: ParseTrycktVardeOptions = {},
): TolkningsUtfall {
  const normaliserat = normaliseraMellanslag(raw).trim();

  if (SAKNAS_TOKENER.has(normaliserat)) {
    return { saknas: true, tryckt: raw };
  }
  if (NEGATIVT_ORD.test(normaliserat)) {
    return { value: null, tecken: "negativ", tryckt: raw };
  }
  if (POSITIVT_ORD.test(normaliserat)) {
    return { value: null, tecken: "positiv", tryckt: raw };
  }

  let text = stripEnheter(normaliserat);
  if (text.length === 0 || SAKNAS_TOKENER.has(text)) {
    return { saknas: true, tryckt: raw };
  }

  let negativt = false;

  const parenMatch = /^\((.*)\)$/.exec(text);
  if (parenMatch?.[1] !== undefined) {
    negativt = true;
    text = parenMatch[1].trim();
  }

  if (/^[-−]/.test(text)) {
    negativt = true;
    text = text.slice(1).trim();
  }

  // Thousands-separating spaces (already normalized to plain spaces above),
  // then the Swedish decimal comma.
  const siffror = text.replace(/\s+/g, "").replace(",", ".");

  if (siffror.length === 0 || !/^\d+(\.\d+)?$/.test(siffror)) {
    // Not a recognizable number once the known noise is stripped — never
    // guess at what it might have meant.
    return { saknas: true, tryckt: raw };
  }

  let value = Number(siffror);
  if (options.enhetTkr) value *= 1000;
  if (negativt) value = -value;

  return { value, tryckt: raw };
}

/** Swedish, human-readable description of a parsed outcome — used only to
 *  build the datakvalitet note below, never shown as the value itself. */
function beskrivUtfall(utfall: TolkningsUtfall): string {
  if ("saknas" in utfall) return "ingen uppgift";
  if (utfall.value !== null) return String(utfall.value);
  return utfall.tecken === "negativ" ? "negativt (utan siffra)" : "positivt (utan siffra)";
}

export interface TolkaNyckeltalResultat {
  keyFigures: KeyFigure[];
  /** One Swedish sentence per figure where the model's own `figure.value`
   *  disagreed with what `tryckt` deterministically parses to — for
   *  `datakvalitet.extraktionKonfidens.skal`. The parsed reading wins
   *  except when both are numbers of different magnitude (see the guard in
   *  `tolkaNyckeltal`); this is only the paper trail. */
  avvikelser: string[];
}

/**
 * Applies `parseTrycktVarde` to every key figure that carries a `tryckt`
 * (i.e. the model read a cell that was not a plain number). The parser's
 * result overrides the model's own `value`/`tecken` for that figure (except
 * number-vs-number disagreements in magnitude, which keep the model's cell)
 * — a regex over the verbatim printed text is strictly more trustworthy
 * than a model's arithmetic on the same text, and CLAUDE.md forbids ever
 * letting a guess look like a fact. Figures without `tryckt` pass through
 * unchanged; this is a no-op for every already-numeric figure.
 */
export function tolkaNyckeltal(keyFigures: readonly KeyFigure[]): TolkaNyckeltalResultat {
  const avvikelser: string[] = [];

  const tolkade = keyFigures.map((kf): KeyFigure => {
    const tryckt = kf.figure.tryckt;
    if (tryckt === undefined) return kf;

    const utfall = parseTrycktVarde(tryckt);
    const nyttVarde = "saknas" in utfall ? null : utfall.value;
    const nyttTecken = "saknas" in utfall ? undefined : utfall.tecken;

    // Guard: a number parsed from `tryckt` only overrides a DIFFERENT number
    // from the model when the magnitude is the same (a sign fix, e.g.
    // "(123)"). If the magnitudes differ, `tryckt` most likely holds more
    // than one cell (a whole multi-year row like "283 311 404" parses as one
    // huge number) — keep the model's cell value and leave a paper trail.
    const modellVarde = kf.figure.value;
    if (
      modellVarde !== null &&
      nyttVarde !== null &&
      Math.abs(modellVarde) !== Math.abs(nyttVarde)
    ) {
      avvikelser.push(
        `${kf.label}: det tryckta värdet "${tryckt}" (tolkat som ${nyttVarde}) stämde inte med ` +
          `modellens tal (${modellVarde}) — modellens tal behölls, kontrollera mot sidan.`,
      );
      return kf;
    }

    if (kf.figure.value !== nyttVarde) {
      avvikelser.push(
        `${kf.label}: modellens tal (${kf.figure.value ?? "null"}) stämde inte med det tryckta ` +
          `värdet "${tryckt}" (tolkat som ${beskrivUtfall(utfall)}) — det tryckta värdet användes.`,
      );
    }

    const nyFigure: Figure = { ...kf.figure, value: nyttVarde, tryckt };
    if (nyttTecken !== undefined) {
      nyFigure.tecken = nyttTecken;
    } else {
      delete nyFigure.tecken;
    }

    return { ...kf, figure: nyFigure };
  });

  return { keyFigures: tolkade, avvikelser };
}

/**
 * The three key figures a genuinely debt-free association can derive to 0
 * (CLAUDE.md's domain rule): räntekänslighet and both skuldsättning/m²
 * variants. All three are interest-bearing-debt-driven, so a totalSkuld of
 * exactly 0 (never a rounded-down small number — see the exact-equality
 * check in `harledSkuldfriaNyckeltal` below) settles every one of them.
 */
const SKULDFRIA_NYCKELTAL_ID: readonly KeyFigureId[] = [
  "rantekanslighet",
  "skuldsattning_per_m2_totalyta",
  "skuldsattning_per_m2_brf_yta",
];

/**
 * Deterministically derives 0 for räntekänslighet and both skuldsättning/m²
 * figures when the report itself states the association carries no
 * interest-bearing debt at all — `lanebok.totalSkuld.value === 0`,
 * set by pass 1 per `buildExtractionSystemPrompt`'s "skuldfri" rule, cited
 * back to the same sentence (`totalSkuld.ref`) so the derived 0 is never an
 * uncited guess.
 *
 * Deliberately narrow:
 *   - Fires ONLY on an exact `0`, never a rounding heuristic — a small
 *     nonzero debt is a different, real number, not "basically debt-free".
 *   - Requires a cited totalSkuld, and derives nothing when any of the
 *     three figures is printed and > 0 (the report contradicts itself).
 *   - NEVER overrides a figure that already carries a non-null `value` — a
 *     number the report itself printed always wins, even if it happens to
 *     be 0 already (then this is a no-op, not a double-write) or nonzero
 *     alongside a debt-free totalSkuld (an inconsistency in the report
 *     itself, not this function's to resolve).
 *   - Called from runStructuredExtraction BEFORE `berikaNyckeltal`, so the
 *     derived 0s are graded exactly like any other figure (0 debt / 0
 *     räntekänslighet both land in benchmarks.ts's best "god" band) and pass
 *     2 (analyze.ts) sees them as ordinary, already-graded numbers — not as
 *     a special case it has to reason about.
 */
export function harledSkuldfriaNyckeltal(
  totalSkuld: Figure | undefined,
  keyFigures: readonly KeyFigure[],
): KeyFigure[] {
  if (totalSkuld?.value !== 0) return [...keyFigures];
  // No citation, no derived figure: an uncited "debt-free" claim is a guess.
  const ref = totalSkuld.ref;
  if (!ref) return [...keyFigures];
  // A printed, nonzero debt figure contradicts "debt-free". Derive nothing —
  // a wrong 0 would make an indebted association look risk-free.
  const motsagelse = keyFigures.some(
    (kf) =>
      SKULDFRIA_NYCKELTAL_ID.includes(kf.id) && kf.figure.value !== null && kf.figure.value > 0,
  );
  if (motsagelse) return [...keyFigures];

  return keyFigures.map((kf) => {
    if (!SKULDFRIA_NYCKELTAL_ID.includes(kf.id)) return kf;
    if (kf.figure.value !== null) return kf;

    const harledFigure: Figure = {
      value: 0,
      unit: kf.figure.unit,
      source: "berakning",
      ref,
    };
    return { ...kf, figure: harledFigure };
  });
}

/** Matches a confidence note about the debt figures (as the model tends to
 *  write it when it sees "-" cells), e.g. "skuldsättning, räntekänslighet saknas". */
const SKULDNYCKELTAL_I_TEXT = /räntekänslig|skuldsättning|skuldsattning/i;

/**
 * Once `harledSkuldfriaNyckeltal` has filled in a debt-free association's
 * 0s, a note the extraction model wrote about those same figures being
 * missing ("-") contradicts what the buyer now sees. Drop such notes. If
 * none remain, nothing explains a lowered level, so it goes back to "hog";
 * if other reasons remain, the level the model chose is kept.
 * `harleddes` is false → returned unchanged.
 */
export function rensaSkuldfriaKonfidensSkal(konfidens: Konfidens, harleddes: boolean): Konfidens {
  if (!harleddes || !konfidens.skal) return konfidens;
  const kvar = konfidens.skal.filter((s) => !SKULDNYCKELTAL_I_TEXT.test(s));
  if (kvar.length === konfidens.skal.length) return konfidens;
  return kvar.length === 0 ? { niva: "hog" } : { niva: konfidens.niva, skal: kvar };
}

// ---------------------------------------------------------------------------
// Loans (PROMPT_VERSION 9): rantetyp, forfalloprofil, area, byggår notes
// ---------------------------------------------------------------------------

/** `datum` (YYYY-MM-DD) plus `manader` calendar months, the day clamped to the
 *  month's last day (2025-08-31 + 3 = 2025-11-30). */
export function laggTillManader(datum: string, manader: number): string {
  const [y, m, d] = datum.split("-").map(Number) as [number, number, number];
  const index = y * 12 + (m - 1) + manader;
  const ar = Math.floor(index / 12);
  const man = (index % 12) + 1;
  const sistaDag = new Date(Date.UTC(ar, man, 0)).getUTCDate();
  const dag = Math.min(d, sistaDag);
  return `${ar}-${String(man).padStart(2, "0")}-${String(dag).padStart(2, "0")}`;
}

/**
 * `Lan.rantetyp`: what the report says ('rorlig' / 'bunden') is kept. Otherwise
 * a loan whose villkorsändringsdag is at most RORLIG_MAX_MANADER_EFTER_BALANSDAG
 * months after the balance-sheet date counts as 'rorlig' (a 3-month variable
 * loan resets quarterly); anything else stays 'okant'. A date further away does
 * NOT prove a fixed rate, so it is never turned into 'bunden'.
 */
export function harledRantetyp(lan: Lan, balansdag: string): Lan["rantetyp"] {
  if (lan.rantetyp === "rorlig" || lan.rantetyp === "bunden") return lan.rantetyp;
  const dag = lan.villkorsandringsdag;
  if (dag === undefined) return "okant";
  return dag <= laggTillManader(balansdag, RORLIG_MAX_MANADER_EFTER_BALANSDAG) ? "rorlig" : "okant";
}

/**
 * Runs LAST (after the page-reference check, so corrected pages and `osaker`
 * markers are copied along). When `lanebok.lan` exists:
 *   - every loan gets its `rantetyp` (`harledRantetyp`; balance date from
 *     `forening.balansdag`, else `${rakenskapsar}-12-31`);
 *   - `forfalloprofil` is REPLACED by one row per loan with a date (ar = year of
 *     villkorsändringsdagen, same belopp/ranta Figures), sorted by date. Loans
 *     without a date are left out; if none has a date the field is omitted.
 * Without `lan`, whatever `forfalloprofil` the model gave is kept.
 */
export function harledLanData(extraction: ExtractionResult): ExtractionResult {
  const lanebok = extraction.forening.lanebok;
  if (!lanebok?.lan || lanebok.lan.length === 0) return extraction;
  const balansdag = extraction.forening.balansdag ?? `${extraction.forening.rakenskapsar}-12-31`;

  const lan = lanebok.lan.map((l) => ({ ...l, rantetyp: harledRantetyp(l, balansdag) }));
  const profil = lan
    .filter((l): l is Lan & { villkorsandringsdag: string } => l.villkorsandringsdag !== undefined)
    .sort((a, b) => a.villkorsandringsdag.localeCompare(b.villkorsandringsdag))
    .map((l) => ({
      ar: Number(l.villkorsandringsdag.slice(0, 4)),
      belopp: l.belopp,
      ...(l.ranta ? { ranta: l.ranta } : {}),
    }));

  const { forfalloprofil: _gammal, ...utanProfil } = lanebok;
  return {
    ...extraction,
    forening: {
      ...extraction.forening,
      lanebok: { ...utanProfil, lan, ...(profil.length > 0 ? { forfalloprofil: profil } : {}) },
    },
  };
}

/**
 * `forening.bostadsrattsyta` and `kontrollsummor.bostadsrattsyta` are the same
 * figure: when the model gave only one of them, the other is filled from it.
 */
export function synkaBostadsrattsyta(extraction: ExtractionResult): ExtractionResult {
  const iForening = extraction.forening.bostadsrattsyta;
  const iSummor = extraction.kontrollsummor?.bostadsrattsyta;
  if (iForening && iSummor) return extraction;
  if (iForening) {
    return {
      ...extraction,
      kontrollsummor: { ...extraction.kontrollsummor, bostadsrattsyta: iForening },
    };
  }
  if (iSummor) {
    return { ...extraction, forening: { ...extraction.forening, bostadsrattsyta: iSummor } };
  }
  return extraction;
}

/** A model note that the construction year is missing. It is shown to buyers who
 *  may have typed the year themselves, so it must not reach the confidence
 *  `skal` (saknadeFalt may still list it). */
const BYGGAR_SAKNAS_SKAL =
  /bygg(nads)?\s?år[^.]*\b(saknas|saknad|framgår inte|anges inte|uppges inte|ej angivet)/i;

export function rensaByggarSaknasSkal(konfidens: Konfidens): Konfidens {
  if (!konfidens.skal) return konfidens;
  const kvar = konfidens.skal.filter((s) => !BYGGAR_SAKNAS_SKAL.test(s));
  if (kvar.length === konfidens.skal.length) return konfidens;
  return kvar.length === 0 ? { niva: konfidens.niva } : { niva: konfidens.niva, skal: kvar };
}
