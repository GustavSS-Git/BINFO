import type { KeyFigure, KeyFigureId, Status } from "@/types/analysis";

/**
 * Deterministic status grading for the seven statutory key figures.
 *
 * Before this file existed, pass 1's prompt asked the model to assign
 * `status` itself with no benchmark to judge against — the result was not
 * just unanchored but actively contradictory across reports (a cooperative
 * with 2.7x the debt of another graded "god" instead of worse). This
 * replaces that guess with a fixed, testable table: same input, same
 * output, always.
 *
 * The thresholds are the ones the product owner set in BENCHMARKS.md at the
 * repo root. That document — not this file, and not any statistical source —
 * is where the decision lives; this table only mirrors it. Where BENCHMARKS.md
 * also cites a population reference point (a national or Stockholm average),
 * that figure is carried as `value`/`label` and shown to the buyer next to the
 * cooperative's own number. Where it cites none, no reference point is
 * invented: the figure is graded and shown without one.
 *
 * BENCHMARKS.md's bands overlap at their endpoints ("God < 500" followed by
 * "Acceptabel 500 – 1000"; "Svag 1000 – 1500" followed by "Kritisk > 1500").
 * Bands are therefore evaluated best-to-worst with FIRST MATCH WINS, which
 * resolves every endpoint deterministically and faithfully to the literal
 * comparison written in the document.
 *
 * One of the seven figures (the fee's share of revenue) is deliberately NOT
 * graded: BENCHMARKS.md supplies no thresholds for it, and it is not reliably
 * better in either direction — a low share can mean healthy commercial income
 * or fragile reliance on unstable non-fee income.
 */

export type Riktning = "lagre_battre" | "hogre_battre" | "informativ";

/** The statuses a band can assign. 'okant' is not one of them — it means "no
 *  value" or "not graded", never "graded and landed here". */
export type GraderadStatus = Exclude<Status, "okant">;

export type Jamforelse = "<" | "<=" | ">" | ">=";

/**
 * One band of the grading scale. Bands are listed best-to-worst and the first
 * whose comparison holds wins; the last band carries no comparison and catches
 * everything left over.
 *
 * This replaces the earlier `{ god, acceptabel, svag }` triple, which always
 * produced exactly four bands and so could not express sparande, which
 * BENCHMARKS.md gives only two (God / Svag). It also lets each band state its
 * own operator, so "< 500" and "<= 1000" can sit next to each other exactly as
 * the document writes them.
 */
export type Band =
  { status: GraderadStatus; jamforelse: Jamforelse; grans: number } | { status: GraderadStatus };

export interface Benchmark {
  riktning: Riktning;
  /** Always set — every entry must say where its thresholds come from. */
  source: string;
  /**
   * Whether the figure appears as a headline card in the main "Föreningens
   * ekonomi" view. Presentation policy, owned by BENCHMARKS.md — deliberately
   * NOT part of src/types/analysis.ts, since hiding a card says nothing about
   * the analysis itself. All seven figures are extracted regardless.
   *
   * Independent of `riktning`: showing is about display, grading is about
   * judgement. They happen to coincide for one figure today.
   */
  visasIHuvudanalys: boolean;
  /** Grading scale, best-to-worst. Absent only when riktning is 'informativ'. */
  band?: readonly Band[];
  /** Population reference point. Present only where BENCHMARKS.md cites one. */
  value?: number;
  label?: string;
  /**
   * Qualitative caveat from BENCHMARKS.md, carried as data for the pass-2
   * prompt and the UI. Commentary only — it never changes grading.
   */
  kommentar?: string;
}

const TROSKELKALLA = "Tröskelvärden fastställda i BENCHMARKS.md (produktbeslut).";

export const BENCHMARKS: Record<KeyFigureId, Benchmark> = {
  arsavgift_per_m2_brf_yta: {
    riktning: "lagre_battre",
    visasIHuvudanalys: true,
    value: 833,
    label: "Snitt Stockholm, årsavgift per m² bostadsrättsyta",
    source: `${TROSKELKALLA} Referenspunkt: Stockholmssnitt ~833 kr/m²/år (HSB Bostadsrättsbarometer 2025, 762 föreningar, räkenskapsår 2024).`,
    band: [
      { status: "god", jamforelse: "<", grans: 500 },
      { status: "acceptabel", jamforelse: "<=", grans: 1000 },
      { status: "svag", jamforelse: "<=", grans: 1500 },
      { status: "kritisk" },
    ],
  },

  // Deliberately not graded: BENCHMARKS.md gives no thresholds for this one.
  // Hidden from the main view as well, but for a separate reason — see
  // `visasIHuvudanalys` on the Benchmark interface.
  arsavgift_andel_av_rorelseintakter: {
    riktning: "informativ",
    visasIHuvudanalys: false,
    source:
      "Graderas inte: BENCHMARKS.md anger inga tröskelvärden, och riktningen är tvetydig — en låg andel kan betyda betydande hyresintäkter snarare än sämre ekonomi. Visas inte som eget nyckeltal i huvudanalysen.",
  },

  skuldsattning_per_m2_totalyta: {
    riktning: "lagre_battre",
    visasIHuvudanalys: true,
    // No reference point: BENCHMARKS.md cites no population figure for the
    // total-area variant, so none is shown.
    source: `${TROSKELKALLA} Ingen referenspunkt angiven för totalytevarianten.`,
    band: [
      { status: "god", jamforelse: "<", grans: 2000 },
      { status: "acceptabel", jamforelse: "<=", grans: 5000 },
      { status: "svag", jamforelse: "<=", grans: 10000 },
      { status: "kritisk" },
    ],
  },

  // Same thresholds as the total-area variant above. Written as given in
  // BENCHMARKS.md; the product owner has been told the two are identical.
  skuldsattning_per_m2_brf_yta: {
    riktning: "lagre_battre",
    visasIHuvudanalys: true,
    value: 7117,
    label: "Riksgenomsnitt, skuldsättning per m² bostadsrättsyta",
    source: `${TROSKELKALLA} Referenspunkt: riksgenomsnitt ~7 117 kr/m² (2023, Nabo/SCB-härlett).`,
    band: [
      { status: "god", jamforelse: "<", grans: 2000 },
      { status: "acceptabel", jamforelse: "<=", grans: 5000 },
      { status: "svag", jamforelse: "<=", grans: 10000 },
      { status: "kritisk" },
    ],
  },

  sparande_per_m2_totalyta: {
    riktning: "hogre_battre",
    visasIHuvudanalys: true,
    // Two bands only — BENCHMARKS.md gives this figure no acceptabel and no
    // kritisk. Exactly 0 is left unspecified by the document ("God > 0",
    // "Svag < 0"); the decided reading is that no saving is not good saving,
    // so 0 falls through to 'svag'.
    source: `${TROSKELKALLA} Endast två band (god/svag); ingen referenspunkt angiven.`,
    band: [{ status: "god", jamforelse: ">", grans: 0 }, { status: "svag" }],
    kommentar:
      "Ett negativt sparande är vanligt och inte automatiskt kritiskt om det är ett planerat och redovisat uttag ur kassan för renovering. Stäm av mot väsentliga händelser (vasentligaHandelser) och underhållsplanen innan det flaggas rött — tröskeln ensam räcker inte som grund.",
  },

  rantekanslighet: {
    riktning: "lagre_battre",
    visasIHuvudanalys: true,
    value: 10.3,
    label: "Riksgenomsnitt, räntekänslighet",
    source: `${TROSKELKALLA} Referenspunkt: riksgenomsnitt ~10,3 % (2023, Nabo).`,
    band: [
      { status: "god", jamforelse: "<", grans: 2 },
      { status: "acceptabel", jamforelse: "<=", grans: 5 },
      { status: "svag", jamforelse: "<=", grans: 15 },
      { status: "kritisk" },
    ],
  },

  energikostnad_per_m2_totalyta: {
    riktning: "lagre_battre",
    visasIHuvudanalys: true,
    value: 203,
    label: "Riksgenomsnitt, energikostnad per m² totalyta",
    source: `${TROSKELKALLA} Referenspunkt: riksgenomsnitt ~203 kr/m²/år (2023, SCB/Nabo).`,
    band: [
      { status: "god", jamforelse: "<", grans: 100 },
      { status: "acceptabel", jamforelse: "<=", grans: 250 },
      { status: "svag", jamforelse: "<=", grans: 500 },
      { status: "kritisk" },
    ],
    kommentar:
      "Äldre hus, särskilt byggda före 1960-talet, har normalt en materiellt högre energikostnad per m². Väg in byggåret innan en hög siffra beskrivs som ett problem.",
  },
};

/**
 * Whether a key figure is surfaced as a headline card in the main
 * "Föreningens ekonomi" view. Presentation policy for the UI layer; every
 * figure is extracted and graded regardless of what this returns.
 */
export function visasIHuvudanalys(id: KeyFigureId): boolean {
  return BENCHMARKS[id].visasIHuvudanalys;
}

export interface StatusResultat {
  status: Status;
  benchmark?: { value: number; label: string; source: string };
}

function uppfyller(band: Band, varde: number): boolean {
  if (!("jamforelse" in band)) return true; // final catch-all band
  switch (band.jamforelse) {
    case "<":
      return varde < band.grans;
    case "<=":
      return varde <= band.grans;
    case ">":
      return varde > band.grans;
    case ">=":
      return varde >= band.grans;
  }
}

/** A reference point is attached only where BENCHMARKS.md cites one. No
 *  value, no benchmark object — a guessed population figure would look like
 *  a fact. */
function medReferenspunkt(benchmark: Benchmark, status: Status): StatusResultat {
  if (benchmark.value === undefined || benchmark.label === undefined) {
    return { status };
  }
  return {
    status,
    benchmark: { value: benchmark.value, label: benchmark.label, source: benchmark.source },
  };
}

/**
 * Grades a key figure. `varde` is the number itself when known; `tecken` is
 * the sign the report printed even when the magnitude wasn't (e.g. "neg" for
 * sparande) — see `Figure.tecken` in src/types/analysis.ts. Both can be
 * passed together for a numeric figure (tecken must then already agree with
 * `varde`'s own sign, enforced by schema.ts) or `tecken` alone with
 * `varde: null`.
 *
 * Two rules beyond the ordinary band lookup, both product decisions:
 *
 *   1. A "lower is better" figure (riktning 'lagre_battre') can never be
 *      graded "god" from a negative reading — numeric or sign-only. Every
 *      band's threshold for those figures is a positive number (e.g.
 *      "< 500 kr/m²"), so a raw comparison would happily call a negative
 *      value "god" (a negative number satisfies "< 500" too), which is
 *      backwards: you cannot have a negative debt, fee or energy cost, so a
 *      negative reading means something is wrong with the underlying data,
 *      not that it is excellent. Graded "okant" instead, and the caller
 *      (runExtraction.ts) records why in datakvalitet.
 *
 *   2. A sign-only reading (varde null, tecken set) on a "higher is better"
 *      figure (today: only sparande) CAN be graded, because that figure's
 *      best band's own threshold sits exactly at zero ("> 0" is "god") — a
 *      bare sign is then enough to know which side of that one threshold
 *      the true number falls on, without claiming to know its magnitude.
 *      This does not generalize to the "lower is better" figures: their
 *      bands have several positive thresholds, so a sign alone can't say
 *      which band a POSITIVE reading of unknown magnitude would land in —
 *      those stay "okant" (rule 1 above already covers the negative case).
 */
export function bedomStatus(
  id: KeyFigureId,
  varde: number | null,
  tecken?: "negativ" | "positiv",
): StatusResultat {
  const benchmark = BENCHMARKS[id];

  if (benchmark.riktning === "informativ" || !benchmark.band) {
    return { status: "okant" };
  }

  const negativLasning = tecken === "negativ" || (varde !== null && varde < 0);
  if (benchmark.riktning === "lagre_battre" && negativLasning) {
    return { status: "okant" };
  }

  if (varde === null) {
    if (tecken === undefined) return { status: "okant" };

    if (benchmark.riktning === "hogre_battre") {
      const bastaBandet = benchmark.band[0];
      const bastaBandetHarNolltroskel =
        bastaBandet !== undefined &&
        "jamforelse" in bastaBandet &&
        (bastaBandet.jamforelse === ">" || bastaBandet.jamforelse === ">=") &&
        bastaBandet.grans === 0;
      if (bastaBandetHarNolltroskel) {
        const sistaBandet = benchmark.band[benchmark.band.length - 1]!;
        return medReferenspunkt(
          benchmark,
          tecken === "positiv" ? bastaBandet.status : sistaBandet.status,
        );
      }
    }
    return { status: "okant" };
  }

  // Best-to-worst, first match wins — see the file-level comment on why the
  // overlapping endpoints in BENCHMARKS.md make the order load-bearing.
  const traff = benchmark.band.find((band) => uppfyller(band, varde));
  const status: Status = traff ? traff.status : "okant";
  return medReferenspunkt(benchmark, status);
}

/**
 * Swedish note for `datakvalitet.extraktionKonfidens.skal` when a figure hit
 * the "implausible negative" rule inside `bedomStatus` above — so the
 * downgrade to "okant" isn't silent. `undefined` when the rule didn't fire.
 */
export function implausibelNegativAnmarkning(kf: {
  id: KeyFigureId;
  label: string;
  figure: { value: number | null; tecken?: "negativ" | "positiv" };
}): string | undefined {
  const benchmark = BENCHMARKS[kf.id];
  const negativLasning =
    kf.figure.tecken === "negativ" || (kf.figure.value !== null && kf.figure.value < 0);
  if (benchmark.riktning !== "lagre_battre" || !negativLasning) return undefined;

  return (
    `${kf.label}: värdet är negativt, vilket är orimligt för ett nyckeltal där lägre är bättre ` +
    `(det går inte att ha en negativ skuld, avgift eller energikostnad) — graderat "okant" i ` +
    `stället för att felaktigt räknas som "god".`
  );
}

/** Replaces status/benchmark on every key figure with the deterministic
 *  assessment — overwrites whatever pass 1 supplied, including any leftover
 *  benchmark, rather than merging with it. Does not mutate the input. */
export function berikaNyckeltal(keyFigures: KeyFigure[]): KeyFigure[] {
  return keyFigures.map((kf) => {
    const { status, benchmark } = bedomStatus(kf.id, kf.figure.value, kf.figure.tecken);
    const { benchmark: _gammaltBenchmark, ...utanBenchmark } = kf;
    return benchmark ? { ...utanBenchmark, status, benchmark } : { ...utanBenchmark, status };
  });
}
