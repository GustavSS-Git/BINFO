/**
 * Earlier sales at the flat's address ("Sålda lägenheter på <adress>",
 * docs/plans/salt-i-huset.md): every flat sold in the building in the last
 * `FORSALJNINGAR_AR` years, the flat's own sales marked.
 * Client-safe types shared by the server (src/server/annons/forsaljningar.ts),
 * /analysera, the report and the PDF. Shown only; never a valuation input.
 *
 * Source, for a `/bostad/<id>` link: Booli `sold?residenceId` (the flat's own
 * sales) and `sold?center&dim` around its coordinates, filtered on the exact
 * street address (house number and letter). Fetched when a page opens, cached
 * 24 h per residence in `annons_cache` under `forsaljningarCacheNyckel`.
 */

export interface TidigareForsaljning {
  /** "YYYY-MM-DD" (Booli `soldDate`). */
  saldDatum: string;
  /** SEK, integer (Booli `soldPrice`). */
  pris: number;
  /** m², one decimal (`livingArea`); null when missing. */
  boarea: number | null;
  /** `rooms` (2.5 happens); null when missing. */
  antalRum: number | null;
  /** `floor` (≥ 0; half floors happen, kept to one decimal); null when missing. */
  vaning: number | null;
  /** SEK per month (`rent`); null when missing or 0 (= not stated). */
  avgift: number | null;
  /** A sale of the linked flat itself (its `sold?residenceId` list). */
  dennaLagenhet: boolean;
}

export type ForsaljningarSvar =
  | {
      ok: true;
      /** The flat's street address (the heading), null when unknown. */
      adress: string | null;
      /** Newest first, at most `MAX_FORSALJNINGAR`, none older than
       *  `FORSALJNINGAR_AR` years. Empty = nothing to show. */
      forsaljningar: TidigareForsaljning[];
    }
  /** Not a `/bostad/` link, API off, quota, or Booli failed: show nothing. */
  | { ok: false };

/** Rows kept per address (a bound on the cache row, not a display rule). */
export const MAX_FORSALJNINGAR = 100;
/** Rows shown before "Visa alla (n)" (owner 2026-11-01). */
export const VISADE_FORSALJNINGAR = 5;
/** Only sales from the last ten years (owner 2026-11-01). */
export const FORSALJNINGAR_AR = 10;

/** The `annons_cache` key for one residence's sales (never a listing URL). */
export function forsaljningarCacheNyckel(residensId: string): string {
  return `booli-salda:${residensId}`;
}
