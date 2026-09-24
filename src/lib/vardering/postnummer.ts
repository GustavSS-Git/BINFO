/**
 * Postnummer normalisation and postnummer -> omrade lookup.
 * Pure, no I/O — takes the already-loaded map (see data.ts).
 */
import type { PostnummerOmradeMap } from "./types";

/**
 * "115 32" -> "11532". Strips all whitespace (Swedish postnummer are
 * conventionally written with a space after the 3rd digit) and leaves
 * everything else untouched — callers see the original string echoed back
 * in error messages if it's still not a valid 5-digit code afterwards.
 */
export function normaliseraPostnummer(postnummer: string): string {
  return postnummer.replace(/\s+/g, "");
}

/**
 * Returns the omrade a postnummer maps to, or null when unmapped (unknown
 * postnummer, or not in the training data's coverage). Callers use null to
 * trigger the Stockholm-wide fallback (q_overall, overall MAPE, overall
 * budpremie) — see vardera.ts / budpremie.ts.
 */
export function omradeForPostnummer(postnummer: string, map: PostnummerOmradeMap): string | null {
  const key = normaliseraPostnummer(postnummer);
  return Object.prototype.hasOwnProperty.call(map, key) ? (map[key] ?? null) : null;
}
