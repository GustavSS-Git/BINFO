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
 * Two of the seven figures (the fee level and the fee's share of revenue)
 * are deliberately NOT graded — neither is reliably "lower is better" (a
 * low fee can mean underfunded maintenance; a low revenue share pushes
 * toward oäkta förening status) and grading them without a defensible basis
 * would be exactly the kind of guess this file exists to replace.
 */

export type Riktning = "lagre_battre" | "hogre_battre" | "informativ";

export interface Granser {
  /** Value at or better than this -> 'god'. */
  god: number;
  /** Value at or better than this (but worse than god) -> 'acceptabel'. */
  acceptabel: number;
  /** Value at or better than this (but worse than acceptabel) -> 'svag'. Worse than this -> 'kritisk'. */
  svag: number;
}

export interface Benchmark {
  riktning: Riktning;
  /** Always set — every entry must say what it is and, if a placeholder, say so. */
  source: string;
  /** Population reference figure. Present only when riktning isn't 'informativ'. */
  value?: number;
  label?: string;
  granser?: Granser;
}

const PLATSHALLARE = "Overifierad platshållare — ej sourcad mot extern statistik.";

export const BENCHMARKS: Record<KeyFigureId, Benchmark> = {
  // TODO: unverified placeholder — reused from src/data/mockData.ts's existing
  // stated assumption ("riksgenomsnitt kring 5 500 kr/m²", "över 8 000 räknas
  // som högt"), not independently sourced. Replace with SCB/Allabrf data.
  skuldsattning_per_m2_totalyta: {
    riktning: "lagre_battre",
    value: 5500,
    label: "Riktvärde skuldsättning per m² totalyta",
    source: `${PLATSHALLARE} Baserat på tidigare produktantagande (riksgenomsnitt ~5 500 kr/m²). TODO: ersätt med SCB/Allabrf-data.`,
    granser: { god: 5500, acceptabel: 8000, svag: 10500 },
  },

  // TODO: unverified placeholder — inget källbelagt riktvärde finns för
  // brf-yta-varianten specifikt (till skillnad från totalyta-varianten ovan).
  skuldsattning_per_m2_brf_yta: {
    riktning: "lagre_battre",
    value: 6500,
    label: "Riktvärde skuldsättning per m² bostadsrättsyta",
    source: `${PLATSHALLARE} TODO: ersätt med SCB/Allabrf-data.`,
    granser: { god: 6500, acceptabel: 9500, svag: 12000 },
  },

  // TODO: unverified placeholder — reused from mockData.ts's "under 250 kr/m²
  // brukar vara i underkant". Replace with SCB/Energimyndigheten data.
  sparande_per_m2_totalyta: {
    riktning: "hogre_battre",
    value: 300,
    label: "Riktvärde sparande per m² totalyta",
    source: `${PLATSHALLARE} Baserat på tidigare produktantagande (under 250 kr/m² i underkant). TODO: ersätt med sourcad data.`,
    granser: { god: 300, acceptabel: 250, svag: 150 },
  },

  // TODO: unverified placeholder — reused from mockData.ts's "över 8 % räknas
  // som tydligt känsligt". Replace with a sourced figure.
  rantekanslighet: {
    riktning: "lagre_battre",
    value: 4,
    label: "Riktvärde räntekänslighet",
    source: `${PLATSHALLARE} Baserat på tidigare produktantagande (över 8 % tydligt känsligt). TODO: ersätt med sourcad data.`,
    granser: { god: 4, acceptabel: 6, svag: 10 },
  },

  // TODO: unverified placeholder — no existing basis anywhere in the repo
  // beyond an unquantified "ligger under snittet" in mockData.ts.
  energikostnad_per_m2_totalyta: {
    riktning: "lagre_battre",
    value: 200,
    label: "Riktvärde energikostnad per m² totalyta",
    source: `${PLATSHALLARE} TODO: ersätt med SCB/Energimyndigheten-data.`,
    granser: { god: 200, acceptabel: 260, svag: 320 },
  },

  // Deliberately not graded — see file-level comment.
  arsavgift_per_m2_brf_yta: {
    riktning: "informativ",
    source:
      "Graderas inte: en låg avgift kan bero på eftersatt underhåll snarare än god ekonomi, och en hög avgift kan bero på sund fondering. Visas som fakta utan färgsättning.",
  },
  arsavgift_andel_av_rorelseintakter: {
    riktning: "informativ",
    source:
      "Graderas inte: en låg andel kan betyda betydande hyresintäkter, vilket för mot oäkta bostadsrättsförening — inte nödvändigtvis sämre ekonomi. Visas som fakta utan färgsättning.",
  },
};

export interface StatusResultat {
  status: Status;
  benchmark?: { value: number; label: string; source: string };
}

export function bedomStatus(id: KeyFigureId, varde: number | null): StatusResultat {
  const benchmark = BENCHMARKS[id];

  if (varde === null || benchmark.riktning === "informativ") {
    return { status: "okant" };
  }

  const { god, acceptabel, svag } = benchmark.granser!;
  let status: Status;
  if (benchmark.riktning === "lagre_battre") {
    status = varde <= god ? "god" : varde <= acceptabel ? "acceptabel" : varde <= svag ? "svag" : "kritisk";
  } else {
    status = varde >= god ? "god" : varde >= acceptabel ? "acceptabel" : varde >= svag ? "svag" : "kritisk";
  }

  return {
    status,
    benchmark: { value: benchmark.value!, label: benchmark.label!, source: benchmark.source },
  };
}

/** Replaces status/benchmark on every key figure with the deterministic
 *  assessment — overwrites whatever pass 1 supplied, including any leftover
 *  benchmark, rather than merging with it. Does not mutate the input. */
export function berikaNyckeltal(keyFigures: KeyFigure[]): KeyFigure[] {
  return keyFigures.map((kf) => {
    const { status, benchmark } = bedomStatus(kf.id, kf.figure.value);
    const { benchmark: _gammaltBenchmark, ...utanBenchmark } = kf;
    return benchmark ? { ...utanBenchmark, status, benchmark } : { ...utanBenchmark, status };
  });
}
