/**
 * Listing URL check, shared by the client (instant "Endast Booli-länkar")
 * and the server (the only URLs the server will ever fetch).
 *
 *   - https only; host exactly `booli.se` or `www.booli.se` (case-insensitive);
 *     no userinfo, no explicit port.
 *   - path `/bostad/<digits>` or `/annons/<digits>` (optional trailing slash);
 *     1-12 digits. Query and fragment are dropped.
 *   - canonical form `https://www.booli.se/<typ>/<id>` (the cache key).
 *   - `fel_doman` for anything that isn't booli.se (incl. text that isn't a URL
 *     at all, any other host such as `m.booli.se`, lookalikes and IP addresses);
 *     `ogiltig_url` for booli.se but not a listing, plain http, a port or userinfo.
 *   - Input without a scheme is accepted when it starts with `booli.se/` or
 *     `www.booli.se/` (people copy the address bar without the scheme): `https://`
 *     is prepended. Any other scheme-less text is `fel_doman`.
 *
 * Pure; no Node APIs (only the WHATWG `URL`), so it runs on client and server.
 */

export type AnnonsUrlUtfall =
  | { ok: true; url: string; typ: "bostad" | "annons"; id: string }
  | { ok: false; errorCode: "fel_doman" | "ogiltig_url" };

const BOOLI_VARDAR = new Set(["booli.se", "www.booli.se"]);
const LISTNINGS_SOKVAG = /^\/(bostad|annons)\/(\d{1,12})\/?$/;
const SKEMALOS = /^(?:www\.)?booli\.se\//i;
const MAX_LANGD = 2048;

const FEL_DOMAN = { ok: false, errorCode: "fel_doman" } as const;
const OGILTIG_URL = { ok: false, errorCode: "ogiltig_url" } as const;

export function kontrolleraAnnonsUrl(ratt: string): AnnonsUrlUtfall {
  const text = typeof ratt === "string" ? ratt.trim() : "";
  if (text === "" || text.length > MAX_LANGD) return FEL_DOMAN;
  // `new URL` silently drops tabs/newlines inside the string; text containing
  // whitespace or control characters is not a link anyone copied.
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(text)) return FEL_DOMAN;

  const medSkema = SKEMALOS.test(text) ? `https://${text}` : text;

  let u: URL;
  try {
    u = new URL(medSkema);
  } catch {
    return FEL_DOMAN;
  }

  if (!BOOLI_VARDAR.has(u.hostname)) return FEL_DOMAN;
  if (u.protocol !== "https:") return OGILTIG_URL;
  if (u.username !== "" || u.password !== "" || u.port !== "") return OGILTIG_URL;

  const traff = LISTNINGS_SOKVAG.exec(u.pathname);
  if (!traff) return OGILTIG_URL;
  const typ = traff[1] as "bostad" | "annons";
  const id = traff[2] as string;
  return { ok: true, url: `https://www.booli.se/${typ}/${id}`, typ, id };
}
