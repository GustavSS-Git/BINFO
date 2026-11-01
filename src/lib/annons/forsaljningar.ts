/**
 * Earlier sales of one flat ("Tidigare försäljningar", docs/plans/salt-i-huset.md).
 * Client-safe types shared by the server (src/server/annons/forsaljningar.ts),
 * /analysera, the report and the PDF. Shown only; never a valuation input.
 *
 * Source: Booli `sold?residenceId=<id>` for a `/bostad/<id>` link (the flat
 * itself, so no matching on address or apartment number). Fetched when a page
 * opens, cached 24 h per residence in `annons_cache` under `forsaljningarCacheNyckel`.
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
  /** SEK per month (`rent`); null when missing or 0 (= not stated). */
  avgift: number | null;
}

export type ForsaljningarSvar =
  | {
      ok: true;
      /** Street address from the newest sale (the heading), null when missing. */
      adress: string | null;
      /** Newest first, at most `MAX_FORSALJNINGAR`. Empty = nothing to show. */
      forsaljningar: TidigareForsaljning[];
    }
  /** Not a `/bostad/` link, API off, quota, or Booli failed: show nothing. */
  | { ok: false };

export const MAX_FORSALJNINGAR = 5;

/** The `annons_cache` key for one residence's sales (never a listing URL). */
export function forsaljningarCacheNyckel(residensId: string): string {
  return `booli-salda:${residensId}`;
}
