/**
 * The answer-key comparison logic (PIPELINE.md step 5): "exact match for
 * figures stated verbatim in the report; ±1% for anything derived."
 * A missing figure (null) always fails — it can't be verified, so it
 * can't pass, regardless of tolerance.
 */

import type { Tristate } from "@/types/analysis";

export type Tolerans = "exakt" | "ungefar";

export interface FieldComparisonResult {
  falt: string;
  forvantat: number;
  faktiskt: number | null;
  godkand: boolean;
  /** Only set when faktiskt is non-null and tolerans is 'ungefar'. */
  avvikelseProcent?: number;
}

export function jamforVarde(
  falt: string,
  faktiskt: number | null,
  forvantat: number,
  tolerans: Tolerans,
): FieldComparisonResult {
  if (faktiskt === null) {
    return { falt, forvantat, faktiskt, godkand: false };
  }

  if (tolerans === "exakt") {
    return { falt, forvantat, faktiskt, godkand: faktiskt === forvantat };
  }

  const avvikelseProcent = Math.abs(((faktiskt - forvantat) / forvantat) * 100);
  return { falt, forvantat, faktiskt, godkand: avvikelseProcent <= 1, avvikelseProcent };
}

export interface TristateComparisonResult {
  falt: string;
  forvantat: Tristate;
  faktiskt: Tristate | undefined;
  godkand: boolean;
}

/**
 * Always exact — a tolerance concept doesn't apply to a categorical
 * ja/nej/okant answer. 'okant' is never treated as equal to 'nej': the
 * whole point of Tristate is that unknown and false are different facts,
 * so the comparison must honor that distinction rather than flatten it.
 */
export function jamforTristate(
  falt: string,
  faktiskt: Tristate | undefined,
  forvantat: Tristate,
): TristateComparisonResult {
  return { falt, forvantat, faktiskt, godkand: faktiskt === forvantat };
}
