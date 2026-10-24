/**
 * Postcode fallback for "Hämta uppgifter": when a listing page doesn't state
 * its postnummer, ask Nominatim (OpenStreetMap) for it. Used ONLY then.
 *
 *   1. Reverse geocoding from the listing's coordinates (exact point).
 *   2. Otherwise a structured forward search `street=<adress>`, `city=<ort>`.
 *      A street-level hit (no house number in the answer) is rejected: a
 *      street can span several postnummer, and a centre-line hit would give
 *      the wrong one (measured 2026-10-24 on "Sankt Eriksgatan 31A":
 *      `fixtures/booli/nominatim-search.json`, 112 37 against the real 112 39).
 *
 * At most one request each (the search is skipped when the reverse request
 * failed because Nominatim itself was unreachable), 5 s timeout each, identifying User-Agent as the
 * Nominatim usage policy requires (https://operations.osmfoundation.org/policies/nominatim/,
 * read 2026-10-13: max 1 request/s, valid identifying User-Agent, cache results,
 * ODbL attribution). Results are cached by `annons_cache` for the whole
 * answer. The response is untrusted: Zod-validated, and the postcode must be
 * five digits. Any failure leaves the postcode missing; nothing here throws.
 *
 * Note: ml/mapping/geokoda_adress.py says the policy forbids calling Nominatim
 * from a request path at bulk volume. This is a handful of lookups per day
 * (only when a listing lacks its postcode: 0 of the 6 fixtures), but the
 * volume must be watched, and the attribution ("© OpenStreetMap contributors")
 * is still to be shown wherever a geocoded postcode is displayed.
 */

import { z } from "zod";

export const NOMINATIM_BAS = "https://nominatim.openstreetmap.org";
export const NOMINATIM_USER_AGENT = "Binfo/1.0 (+https://binfo.slanesens.com)";
export const GEOKOD_TIDSGRANS_MS = 5_000;
/** A Nominatim answer is a few kB; anything bigger is not what we asked for. */
const MAX_SVAR_TECKEN = 200_000;

export interface GeokodIndata {
  koordinater?: { lat: number; lon: number } | undefined;
  adress?: string | undefined;
  /** Kommun/ort; "Stockholm" when absent. */
  ort?: string | undefined;
}

export interface GeokodOptions {
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Per request. Default 5 s. */
  tidsgransMs?: number;
}

export type GeokodUtfall =
  { postnummer: string; metod: "reverse" | "search" } | { postnummer: null; orsak: string };

const NominatimAdressSchema = z
  .object({
    postcode: z.string().optional(),
    house_number: z.string().optional(),
  })
  .passthrough();

/** `/reverse` answers one object; "nothing here" is `{ error: "Unable to geocode" }`. */
const ReverseSchema = z
  .object({
    address: NominatimAdressSchema.optional(),
    error: z.unknown().optional(),
  })
  .passthrough();

const SearchSchema = z.array(z.object({ address: NominatimAdressSchema.optional() }).passthrough());

/** "112 39" or "11239" → "112 39"; anything else (several codes, text) → null. */
export function normaliseraPostnummerText(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const t = raw.trim();
  if (!/^\d{3} ?\d{2}$/.test(t)) return null;
  const siffror = t.replace(" ", "");
  return `${siffror.slice(0, 3)} ${siffror.slice(3)}`;
}

export function reverseUrl(k: { lat: number; lon: number }): string {
  const u = new URL("/reverse", NOMINATIM_BAS);
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("lat", String(k.lat));
  u.searchParams.set("lon", String(k.lon));
  u.searchParams.set("zoom", "18");
  u.searchParams.set("addressdetails", "1");
  return u.toString();
}

export function searchUrl(adress: string, ort: string): string {
  const u = new URL("/search", NOMINATIM_BAS);
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("street", adress);
  u.searchParams.set("city", ort);
  u.searchParams.set("countrycodes", "se");
  u.searchParams.set("limit", "1");
  u.searchParams.set("addressdetails", "1");
  return u.toString();
}

function felText(fel: unknown): string {
  return fel instanceof Error ? fel.message : String(fel);
}

/** One GET with its own timeout; the body is size-capped. Returns the parsed
 *  JSON, or a reason. */
async function hamtaJson(
  url: string,
  opts: GeokodOptions,
): Promise<{ json: unknown } | { orsak: string; drift?: true }> {
  const doFetch = opts.fetch ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.tidsgransMs ?? GEOKOD_TIDSGRANS_MS);
  try {
    const res = await doFetch(url, {
      method: "GET",
      headers: { "user-agent": NOMINATIM_USER_AGENT, accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return { orsak: `http ${res.status}`, drift: true };
    }
    const text = await res.text();
    if (text.length > MAX_SVAR_TECKEN) return { orsak: "svaret är för stort" };
    try {
      return { json: JSON.parse(text) as unknown };
    } catch {
      return { orsak: "svaret är inte JSON" };
    }
  } catch (fel) {
    return {
      orsak: ctrl.signal.aborted ? "timeout" : `nätverksfel: ${felText(fel)}`,
      drift: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

function giltigKoordinat(k: { lat: number; lon: number }): boolean {
  return (
    Number.isFinite(k.lat) &&
    Number.isFinite(k.lon) &&
    Math.abs(k.lat) <= 90 &&
    Math.abs(k.lon) <= 180
  );
}

async function reverse(
  k: { lat: number; lon: number },
  opts: GeokodOptions,
): Promise<{ postnummer: string } | { orsak: string; drift?: true }> {
  const svar = await hamtaJson(reverseUrl(k), opts);
  if ("orsak" in svar) {
    return { orsak: `reverse: ${svar.orsak}`, ...(svar.drift ? { drift: true as const } : {}) };
  }
  const parsed = ReverseSchema.safeParse(svar.json);
  if (!parsed.success) return { orsak: "reverse: oväntat svar" };
  const pn = normaliseraPostnummerText(parsed.data.address?.postcode);
  return pn ? { postnummer: pn } : { orsak: "reverse: inget femsiffrigt postnummer" };
}

async function sok(
  adress: string,
  ort: string,
  opts: GeokodOptions,
): Promise<{ postnummer: string } | { orsak: string }> {
  const svar = await hamtaJson(searchUrl(adress, ort), opts);
  if ("orsak" in svar) return { orsak: `search: ${svar.orsak}` };
  const parsed = SearchSchema.safeParse(svar.json);
  if (!parsed.success) return { orsak: "search: oväntat svar" };
  const traff = parsed.data[0];
  if (!traff) return { orsak: "search: ingen träff" };
  // Only a hit on a house (an address with a number) is trusted.
  const hus = traff.address?.house_number;
  if (hus === undefined || hus.trim() === "") return { orsak: "search: träffen är en gata" };
  const pn = normaliseraPostnummerText(traff.address?.postcode);
  return pn ? { postnummer: pn } : { orsak: "search: inget femsiffrigt postnummer" };
}

/** Never throws. */
export async function geokodaPostnummer(
  indata: GeokodIndata,
  opts: GeokodOptions = {},
): Promise<GeokodUtfall> {
  const orsaker: string[] = [];
  try {
    if (indata.koordinater && giltigKoordinat(indata.koordinater)) {
      const r = await reverse(indata.koordinater, opts);
      if ("postnummer" in r) return { postnummer: r.postnummer, metod: "reverse" };
      orsaker.push(r.orsak);
      // Nominatim itself unreachable (timeout, http error): a second request
      // would only wait another timeout, so give up here.
      if (r.drift) return { postnummer: null, orsak: orsaker.join("; ") };
    }
    const adress = indata.adress?.trim();
    const ort = indata.ort?.trim();
    // Never guess the town: a street name alone can match the same name in
    // another kommun and give a confidently wrong postcode.
    if (adress && ort) {
      const r = await sok(adress, ort, opts);
      if ("postnummer" in r) return { postnummer: r.postnummer, metod: "search" };
      orsaker.push(r.orsak);
    }
  } catch (fel) {
    orsaker.push(`oväntat fel: ${felText(fel)}`);
  }
  return {
    postnummer: null,
    orsak: orsaker.length > 0 ? orsaker.join("; ") : "varken koordinater eller adress",
  };
}
