/**
 * Small price-display helpers shared by the report (K1), the Priskoll result
 * on /analysera, the waiting screen and the landing example (redesign v4).
 * Client-safe and pure. The rounding rules stay in `analysisView.ts`.
 */
import type { Budpremie } from "@/types/analysis";
import { avrundaVardering, vardespann } from "@/lib/analysisView";

/**
 * "Vanligt bud i området": the asking price moved by the area's MEDIAN bid
 * premium (the same statistic `formatBudpremieText` states). Only meaningful
 * with an asking price and a premium (Stockholms kommun); otherwise null.
 * Rounded to 10 000 kr like every shown valuation.
 */
export function vanligtBud(
  utgangspris: number | null | undefined,
  budpremie: Budpremie | null | undefined,
): number | null {
  if (utgangspris === null || utgangspris === undefined || !(utgangspris > 0)) return null;
  if (!budpremie) return null;
  return avrundaVardering(utgangspris * (1 + budpremie.medianProcent / 100));
}

export { iEllerPaOmrade } from "@/lib/omradeText";

/** "5,6 mkr" (decimaler = 1) or "5,02 mkr" (decimaler = 2). Trailing zeros are
 *  kept so a span reads evenly ("5,10–6,25 mkr"). */
export function formatMkr(kr: number, decimaler: 1 | 2 = 1): string {
  return `${formatMkrTal(kr, decimaler)} mkr`;
}

/** The number part only: "5,02". */
export function formatMkrTal(kr: number, decimaler: 1 | 2 = 1): string {
  return (kr / 1_000_000).toLocaleString("sv-SE", {
    minimumFractionDigits: decimaler,
    maximumFractionDigits: decimaler,
  });
}

/** "5,02–6,13 mkr" for the ±10 % span around an exact value. */
export function formatSpannMkr(exakt: number): string {
  const { low, high } = vardespann(exakt);
  return `${formatMkrTal(low, 2)}–${formatMkrTal(high, 2)} mkr`;
}

/** "ca 104 600 kr/m²" for any (already rounded or exact) amount; null without
 *  a positive boarea. Rounded to 100 kr/m² like `kvmPrisForVardering`. */
export function kvmPris(belopp: number, boarea: number | null | undefined): string | null {
  if (boarea === null || boarea === undefined || !(boarea > 0)) return null;
  const perM2 = Math.round(belopp / boarea / 100) * 100;
  return `ca ${perM2.toLocaleString("sv-SE")} kr/m²`;
}

/** Where a value lies against the span around `exakt`. */
export function lageIMotSpann(varde: number, exakt: number): "under" | "inom" | "over" {
  const { low, high } = vardespann(exakt);
  return varde > high ? "over" : varde < low ? "under" : "inom";
}
