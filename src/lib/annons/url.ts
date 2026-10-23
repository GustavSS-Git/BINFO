/**
 * Listing URL check, shared by the client (instant "Endast Booli-länkar")
 * and the server (the only URLs the server will ever fetch).
 *
 * STUB (T1): implemented in T2a. Contract:
 *   - https only; host exactly `booli.se` or `www.booli.se`; no userinfo, no port.
 *   - path `/bostad/<digits>` or `/annons/<digits>` (optional trailing slash);
 *     query and fragment are dropped.
 *   - canonical form `https://www.booli.se/<typ>/<id>` (the cache key).
 *   - `fel_doman` for anything that isn't booli.se (incl. unparsable input that
 *     isn't a URL at all); `ogiltig_url` for booli.se but not a listing, or http.
 */

export type AnnonsUrlUtfall =
  | { ok: true; url: string; typ: "bostad" | "annons"; id: string }
  | { ok: false; errorCode: "fel_doman" | "ogiltig_url" };

export function kontrolleraAnnonsUrl(_ratt: string): AnnonsUrlUtfall {
  throw new Error("kontrolleraAnnonsUrl: not implemented (T2a)");
}
