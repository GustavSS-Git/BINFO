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

/**
 * Whether postnummer's first 3 digits occur as a prefix of at least one key
 * in the map — i.e. "this looks like a postnummer the mapping table knows
 * about", even when the exact 5-digit code isn't itself mapped to a
 * specific area. Used (task 4g's scope rule) to decide the Stockholm-wide
 * model fallback for an unmapped-but-plausible postnummer, as opposed to no
 * valuation at all for a postnummer clearly outside the table's coverage.
 * Only a well-formed postnummer (exactly five digits after normalisation)
 * can match — "", "115", "115-32" or "115a32" never do, so a garbled input
 * is treated as out of scope rather than valued as Stockholm.
 */
export function harKantPrefix(postnummer: string, map: PostnummerOmradeMap): boolean {
  const key = normaliseraPostnummer(postnummer);
  if (!/^\d{5}$/.test(key)) return false;
  const prefix = key.slice(0, 3);
  return Object.keys(map).some((k) => k.startsWith(prefix));
}
