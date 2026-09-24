/**
 * Bid-premium (budpremie) lookup: how far above/below utgångspris
 * comparable homes have sold, per data/derived/utgangspris_vs_slutpris.json.
 * Pure, no I/O.
 */
import { budpremieData } from "./data";
import type { Budpremie } from "@/types/analysis";

/**
 * Falls back to the overall Stockholm figure (omrade: null in the result)
 * when `omrade` is null (unmapped postnummer) or when the area's own n is
 * below the source data's minimum (data/derived/utgangspris_vs_slutpris.json
 * -> min_n_per_area = 50, already resolved into each area's
 * `fallbackToOverall` flag by scripts/buildVarderingData.ts). Never returns
 * an area's own (noisy, small-n) figures under the area's name in that case
 * — the contract's `omrade: null` means "this is the Stockholm-wide
 * figure", so a low-n area's numbers are not shown mislabelled as its own.
 */
export function budpremieForOmrade(omrade: string | null): Budpremie {
  if (omrade !== null) {
    const area = budpremieData.areas[omrade];
    if (area && !area.fallbackToOverall) {
      return {
        omrade,
        medianProcent: area.medianProcent,
        medelProcent: area.medelProcent,
        n: area.n,
        dataperiod: budpremieData.period,
      };
    }
  }

  return {
    omrade: null,
    medianProcent: budpremieData.overall.medianProcent,
    medelProcent: budpremieData.overall.medelProcent,
    n: budpremieData.overall.n,
    dataperiod: budpremieData.period,
  };
}
