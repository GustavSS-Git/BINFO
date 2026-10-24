/**
 * Booli listing page parser (docs/booli.md). Pure: HTML in, normalised
 * values out. No network, no LLM.
 *
 * Reads embedded structured data only, never the visible HTML text:
 *   1. the Next.js RSC stream (`self.__next_f.push([1,"…"])`), where the
 *      GraphQL-shaped `Listing` object lives;
 *   2. JSON-LD (`Place`, `Product`, `BreadcrumbList`).
 *
 * Results:
 *   - `blockerad`: a Cloudflare challenge page (never solved or bypassed);
 *   - `tolkning_misslyckad`: no Listing object (`delvis` = what JSON-LD gave);
 *   - `ok`: `uppgifter` + `saknas` (the form fields the page doesn't state).
 *
 * Decisions:
 *   - Everything the page doesn't state is ABSENT, never guessed. In particular
 *     hiss/balkong are only ever "ja" (a missing amenity is unknown, not "nej").
 *   - Utgångspris comes from `Listing.listPrice.raw`. The JSON-LD Product price is
 *     used only when the Listing has no `listPrice` key at all (a layout change);
 *     an explicit `listPrice: null` (sale not started) stays missing.
 *   - Avgift `rent.raw` with unit "kr/mån"; "kr/år" is divided by 12 and rounded;
 *     an unknown or missing unit gives no value; 0 means "broker gave none".
 *   - The Listing is validated with a permissive Zod schema: a field whose type
 *     changes upstream becomes missing instead of a crash.
 *   - Never throws (garbage in -> `tolkning_misslyckad`).
 */

import { z } from "zod";

import { ANNONS_FALT } from "@/lib/annons/typer";
import type { AnnonsFalt, AnnonsUppgifter } from "@/lib/annons/typer";

export type BooliTolkning =
  | { typ: "ok"; uppgifter: AnnonsUppgifter; saknas: AnnonsFalt[] }
  | { typ: "blockerad" }
  | { typ: "tolkning_misslyckad"; orsak: string; delvis: AnnonsUppgifter };

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

type Json = unknown;

function arObjekt(v: Json): v is Record<string, Json> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function text(v: Json): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

function andligt(v: Json): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** A JSON-LD price may be a number or a numeric string. */
function pris(v: Json): number | undefined {
  const n = typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : andligt(v);
  if (n === undefined) return undefined;
  const heltal = Math.round(n);
  return heltal > 0 ? heltal : undefined;
}

// ---------------------------------------------------------------------------
// RSC stream
// ---------------------------------------------------------------------------

const RSC_SCRIPT = /<script[^>]*>\s*self\.__next_f\.push\((\[[\s\S]*?\])\)\s*<\/script>/g;
const LISTING_NYCKEL = '"object":{"__typename":"Listing"';
const MAX_LISTING_FORSOK = 20;

/** Concatenates every string payload of `self.__next_f.push([1,"…"])`. */
function rscText(html: string): string {
  let ut = "";
  for (const m of html.matchAll(RSC_SCRIPT)) {
    try {
      const rad: Json = JSON.parse(m[1] as string);
      if (Array.isArray(rad) && rad[0] === 1 && typeof rad[1] === "string") ut += rad[1];
    } catch {
      // A broken chunk is skipped; the Listing parse decides if enough is left.
    }
  }
  return ut;
}

/** End index (exclusive) of the JSON object starting at `start`, or -1. */
function objektSlut(s: string, start: number): number {
  let djup = 0;
  let iStrang = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (iStrang) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') iStrang = false;
      continue;
    }
    if (c === '"') iStrang = true;
    else if (c === "{") djup++;
    else if (c === "}") {
      djup--;
      if (djup === 0) return i + 1;
    }
  }
  return -1;
}

/** Every `Listing` object in the stream, in order (unparsable ones skipped). */
function listningar(rsc: string): Record<string, Json>[] {
  const ut: Record<string, Json>[] = [];
  let fran = 0;
  for (let n = 0; n < MAX_LISTING_FORSOK; n++) {
    const i = rsc.indexOf(LISTING_NYCKEL, fran);
    if (i < 0) break;
    fran = i + LISTING_NYCKEL.length;
    const start = i + '"object":'.length;
    const slut = objektSlut(rsc, start);
    if (slut < 0) continue;
    try {
      const o: Json = JSON.parse(rsc.slice(start, slut));
      if (arObjekt(o)) ut.push(o);
    } catch {
      // not valid JSON: try the next occurrence
    }
  }
  return ut;
}

// ---------------------------------------------------------------------------
// Permissive Listing schema (a wrong type becomes `undefined`, never a throw)
// ---------------------------------------------------------------------------

const varde = z
  .object({
    raw: z.number().finite().nullable().optional().catch(undefined),
    unit: z.string().nullable().optional().catch(undefined),
  })
  .passthrough()
  .nullable()
  .optional()
  .catch(undefined);

const strang = z.string().nullable().optional().catch(undefined);
const tal = z.number().finite().nullable().optional().catch(undefined);

const ListingSchema = z
  .object({
    streetAddress: strang,
    descriptiveAreaName: strang,
    listPrice: varde,
    rent: varde,
    livingArea: varde,
    rooms: varde,
    floor: varde,
    constructionYear: tal,
    latitude: tal,
    longitude: tal,
    listingUrl: strang,
    areas: z.array(z.unknown()).nullable().optional().catch(undefined),
    amenities: z.array(z.unknown()).nullable().optional().catch(undefined),
  })
  .passthrough();

type Listing = z.infer<typeof ListingSchema>;

const OmradeSchema = z.object({ type: z.string(), name: z.string() }).passthrough();
const AmenitySchema = z.object({ key: z.string() }).passthrough();

function omraden(l: Listing): { type: string; name: string }[] {
  const ut: { type: string; name: string }[] = [];
  for (const a of l.areas ?? []) {
    const r = OmradeSchema.safeParse(a);
    if (r.success) ut.push({ type: r.data.type, name: r.data.name });
  }
  return ut;
}

function amenityNycklar(l: Listing): Set<string> {
  const ut = new Set<string>();
  for (const a of l.amenities ?? []) {
    const r = AmenitySchema.safeParse(a);
    if (r.success) ut.add(r.data.key);
  }
  return ut;
}

// ---------------------------------------------------------------------------
// JSON-LD
// ---------------------------------------------------------------------------

const LD_SCRIPT =
  /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

interface JsonLd {
  adress?: string;
  postnummer?: string;
  utgangspris?: number;
  forening?: string;
}

function platta(v: Json, ut: Record<string, Json>[]): void {
  if (Array.isArray(v)) {
    for (const x of v) platta(x, ut);
  } else if (arObjekt(v)) {
    ut.push(v);
    if (Array.isArray(v["@graph"])) platta(v["@graph"], ut);
  }
}

function harTyp(n: Record<string, Json>, typ: string): boolean {
  const t = n["@type"];
  return t === typ || (Array.isArray(t) && t.includes(typ));
}

/** "NNN NN" from 5 digits (with or without a space), else undefined. */
function normaliseraPostnummer(v: Json): string | undefined {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const siffror = String(v).replace(/\s/g, "");
  return /^\d{5}$/.test(siffror) ? `${siffror.slice(0, 3)} ${siffror.slice(3)}` : undefined;
}

function lasJsonLd(html: string): JsonLd {
  const noder: Record<string, Json>[] = [];
  for (const m of html.matchAll(LD_SCRIPT)) {
    try {
      platta(JSON.parse(m[1] as string) as Json, noder);
    } catch {
      // skip unparsable JSON-LD
    }
  }
  const ut: JsonLd = {};
  for (const n of noder) {
    if (harTyp(n, "Place") && arObjekt(n["address"])) {
      const a = n["address"];
      const gata = text(a["streetAddress"]);
      if (gata !== undefined && ut.adress === undefined) ut.adress = gata;
      const pnr = normaliseraPostnummer(a["postalCode"]);
      if (pnr !== undefined && ut.postnummer === undefined) ut.postnummer = pnr;
    } else if (harTyp(n, "Product") && ut.utgangspris === undefined) {
      const o = n["offers"];
      const erbjudanden = Array.isArray(o) ? o : [o];
      for (const e of erbjudanden) {
        if (arObjekt(e)) {
          const p = pris(e["price"]);
          if (p !== undefined) {
            ut.utgangspris = p;
            break;
          }
        }
      }
    } else if (harTyp(n, "BreadcrumbList") && Array.isArray(n["itemListElement"])) {
      for (const el of n["itemListElement"] as Json[]) {
        if (!arObjekt(el)) continue;
        const lank = text(el["item"]);
        const namn = text(el["name"]);
        if (
          lank !== undefined &&
          namn !== undefined &&
          namn.length <= 200 && // AnnonsKallaSchema.forening limit
          lank.includes("/bostadsrattsforening/")
        ) {
          ut.forening = namn; // the last one wins
        }
      }
    }
  }
  return ut;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function hogstEnDecimal(n: number): number {
  return Math.round(n * 10) / 10;
}

function positivt(n: number | null | undefined): number | undefined {
  return n !== null && n !== undefined && n > 0 ? n : undefined;
}

function avgiftPerManad(
  v: { raw?: number | null | undefined; unit?: string | null | undefined } | null | undefined,
): number | undefined {
  const raw = positivt(v?.raw);
  if (raw === undefined) return undefined;
  const enhet = (v?.unit ?? "").toLowerCase().replace(/\s/g, "");
  if (enhet === "kr/mån" || enhet === "kr/man" || enhet === "kr/månad") return Math.round(raw);
  if (enhet === "kr/år" || enhet === "kr/ar") return Math.round(raw / 12);
  return undefined;
}

function giltigtMaklarUrl(v: string | null | undefined): string | undefined {
  const t = text(v);
  // Same rule as AnnonsKallaSchema.maklarUrl: the value is stored with the analysis.
  if (t === undefined || t.length > 2000 || !/^https?:\/\/[^\s]+$/.test(t)) return undefined;
  try {
    const u = new URL(t);
    return u.protocol === "https:" || u.protocol === "http:" ? t : undefined;
  } catch {
    return undefined;
  }
}

function listningTillUppgifter(l: Listing, ld: JsonLd, harListPrice: boolean): AnnonsUppgifter {
  const u: AnnonsUppgifter = {};
  const omradenLista = omraden(l);

  const adress = text(l.streetAddress) ?? ld.adress;
  if (adress !== undefined) u.adress = adress;

  const postnummer =
    ld.postnummer ?? normaliseraPostnummer(omradenLista.find((o) => o.type === "postcode")?.name);
  if (postnummer !== undefined) u.postnummer = postnummer;

  const ort = text(omradenLista.find((o) => o.type === "municipality")?.name);
  if (ort !== undefined) u.ort = ort;

  const stadsdel = text(l.descriptiveAreaName);
  if (stadsdel !== undefined) u.stadsdel = stadsdel;

  const listpris = pris(l.listPrice?.raw);
  const utgangspris = listpris ?? (harListPrice ? undefined : ld.utgangspris);
  if (utgangspris !== undefined) u.utgangspris = utgangspris;

  const avgift = avgiftPerManad(l.rent);
  if (avgift !== undefined) u.manadsavgift = avgift;

  const boarea = positivt(l.livingArea?.raw);
  if (boarea !== undefined && hogstEnDecimal(boarea) > 0) u.boarea = hogstEnDecimal(boarea);

  const rum = positivt(l.rooms?.raw);
  if (rum !== undefined && hogstEnDecimal(rum) > 0) u.antalRum = hogstEnDecimal(rum);

  const vaning = l.floor?.raw;
  if (typeof vaning === "number" && Number.isInteger(vaning) && vaning >= 0) u.vaning = vaning;

  const ar = l.constructionYear;
  if (
    typeof ar === "number" &&
    Number.isInteger(ar) &&
    ar >= 1600 &&
    ar <= new Date().getFullYear() + 5
  ) {
    u.byggar = ar;
  }

  const nycklar = amenityNycklar(l);
  if (nycklar.has("elevator")) u.hiss = "ja";
  if (nycklar.has("balcony")) u.balkong = "ja";

  if (ld.forening !== undefined) u.forening = ld.forening;

  const maklarUrl = giltigtMaklarUrl(l.listingUrl);
  if (maklarUrl !== undefined) u.maklarUrl = maklarUrl;

  const lat = l.latitude;
  const lon = l.longitude;
  if (
    typeof lat === "number" &&
    typeof lon === "number" &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  ) {
    u.koordinater = { lat, lon };
  }
  return u;
}

function arUtmaning(html: string): boolean {
  // Not `cdn-cgi/challenge-platform`: Cloudflare injects that script into
  // normal pages too.
  return /<title>\s*Just a moment/i.test(html) || html.includes("_cf_chl_opt");
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export function tolkaBooli(html: string, _url: string): BooliTolkning {
  try {
    if (typeof html !== "string" || html === "") {
      return { typ: "tolkning_misslyckad", orsak: "Tomt svar.", delvis: {} };
    }
    const ld = lasJsonLd(html);
    const kandidater = listningar(rscText(html));
    // The first Listing with a street address; others (e.g. teasers) are ignored.
    const funnen = kandidater
      .map((k) => ({ ratt: k, tolkad: ListingSchema.safeParse(k) }))
      .find((k) => k.tolkad.success && text(k.tolkad.data.streetAddress) !== undefined);

    if (funnen === undefined || !funnen.tolkad.success) {
      if (arUtmaning(html)) return { typ: "blockerad" };
      const delvis: AnnonsUppgifter = {};
      if (ld.adress !== undefined) delvis.adress = ld.adress;
      if (ld.postnummer !== undefined) delvis.postnummer = ld.postnummer;
      if (ld.utgangspris !== undefined) delvis.utgangspris = ld.utgangspris;
      if (ld.forening !== undefined) delvis.forening = ld.forening;
      return {
        typ: "tolkning_misslyckad",
        orsak: "Hittade inget Listing-objekt i sidans data.",
        delvis,
      };
    }

    const harListPrice = Object.prototype.hasOwnProperty.call(funnen.ratt, "listPrice");
    const uppgifter = listningTillUppgifter(funnen.tolkad.data, ld, harListPrice);
    const saknas = ANNONS_FALT.filter((f) => uppgifter[f] === undefined);
    return { typ: "ok", uppgifter, saknas };
  } catch {
    return { typ: "tolkning_misslyckad", orsak: "Oväntat fel vid tolkning.", delvis: {} };
  }
}
