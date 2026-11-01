/**
 * Booli REST API client (docs/plans/booli-api.md §1, §3) and its listing
 * source (`booliApiLeverantor`).
 *
 * Signing (verified 2026-10-31): every call carries `callerId`, `time` (unix
 * SECONDS), `unique` (16 random hex characters) and
 * `hash = sha1(callerId + time + privateKey + unique)`, with the header
 * `Accept: application/vnd.booli-v2+json`. Web Crypto only (`crypto.subtle`,
 * `crypto.getRandomValues`): this runs on Cloudflare Workers, no Node APIs.
 *
 * One fetch of `/annons/<id>` costs 1–3 calls, each with its own 8 s deadline
 * and never retried:
 *   1. `listings/{id}` (an active listing);
 *   2. on 404 / an empty list: `sold/{id}` (a sold one);
 *   3. when the object has no postcode (active listings never do):
 *      `areas?lat&lng`, whose "Postnummer" area is Booli's own postcode.
 *
 * A `/bostad/<id>` (a residence id, another number space: never sent to
 * `listings/{id}`, the numbers collide) is resolved with the `residenceId`
 * filter (verified 2026-11-01 against the four saved residence pages):
 *   1. `listings?residenceId` (an active listing; the latest published wins);
 *   2. `listings?residenceId&upcomingSale=1` ("kommande": hidden by default);
 *   3. `sold?residenceId` (the same flat's sales; the latest sale wins). A sale
 *      older than `BOSTAD_SALD_MAX_DAGAR` fills only the flat's own facts:
 *      its asking price and fee are not today's;
 *   4. `areas?lat&lng` for the postcode, as above.
 * Every answer must echo `searchParams.residenceId` and stay small: a filter
 * Booli ignored would return other flats.
 *
 * Secrets: the request URL holds `callerId` and `hash`, so it is never logged
 * or put in an error text; failure reasons name the endpoint path only, and
 * any exception text is scrubbed of the keys.
 */

import type { AnnonsUppgifter } from "@/lib/annons/typer";
import {
  forstaObjekt,
  postnummerFranOmraden,
  tolkaBooliApiObjekt,
  type BooliApiSamling,
} from "./booliApiTolkning";
import {
  ANNONS_KARNFALT,
  felText,
  harFormfalt,
  logga,
  type AnnonsLeverantor,
  type LeverantorUtfall,
} from "./kallor";

export const BOOLI_API_BAS = "https://api.booli.se";
export const BOOLI_API_ACCEPT = "application/vnd.booli-v2+json";
/** Per call (listings, sold and areas each get their own). */
export const BOOLI_API_TIDSGRANS_MS = 8_000;
/** A sale of the residence older than this (days) gives no utgångspris or
 *  avgift (supervisor 2026-11-01; owner may change it). */
export const BOOLI_BOSTAD_SALD_MAX_DAGAR = 365;
/** More hits than this for one residence = the filter was not applied. */
const BOSTAD_MAX_TRAFFAR = 50;
/** An answer is a few kB; anything far bigger is not what we asked for. */
const MAX_SVAR_TECKEN = 2_000_000;

export interface BooliApiNycklar {
  callerId: string;
  privateKey: string;
}

export interface BooliApiBeroenden {
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Injected in tests: the clock behind `time`. */
  nu?: () => Date;
  /** Injected in tests: the `unique` value (16 hex characters). */
  unik?: () => string;
  /** Per-call deadline; default 8 s (tests shorten it). */
  tidsgransMs?: number;
}

export type BooliApiFelkod = "nyckel" | "hittades_inte" | "natverk" | "tolkning";

export type BooliApiUtfall =
  | {
      typ: "ok";
      uppgifter: AnnonsUppgifter;
      samling: BooliApiSamling;
      /** Calls made (1–3). */
      anrop: number;
      /** Why the postcode is missing, when it is. */
      postnummerOrsak?: string;
    }
  | { typ: "fel"; kod: BooliApiFelkod; orsak: string; anrop: number };

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return hex(new Uint8Array(digest));
}

/** `hash = sha1(callerId + time + privateKey + unique)`. */
export function signera(nycklar: BooliApiNycklar, time: string, unique: string): Promise<string> {
  return sha1Hex(nycklar.callerId + time + nycklar.privateKey + unique);
}

/** 16 random hex characters. */
export function nyUnik(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return hex(b);
}

// ---------------------------------------------------------------------------
// One call
// ---------------------------------------------------------------------------

export type BooliApiAnrop =
  { typ: "ok"; data: unknown } | { typ: "fel"; kod: BooliApiFelkod; orsak: string };

/** Removes anything secret from a text that may end up in a log. */
function tvatta(text: string, hemligt: readonly string[]): string {
  let ut = text.replace(/https?:\/\/api\.booli\.se[^\s"']*/gi, "api.booli.se/…");
  for (const h of hemligt) if (h !== "") ut = ut.split(h).join("…");
  return ut.slice(0, 300);
}

/** One signed GET (exported for scripts/testaBooliApi.ts). Never throws for
 *  an expected failure; the reason never holds the query string. */
export async function anropaBooliApi(
  sokvag: string,
  parametrar: Record<string, string>,
  nycklar: BooliApiNycklar,
  b: BooliApiBeroenden = {},
): Promise<BooliApiAnrop> {
  const doFetch = b.fetch ?? fetch;
  const tidsgrans = b.tidsgransMs ?? BOOLI_API_TIDSGRANS_MS;
  const time = String(Math.floor((b.nu ?? (() => new Date()))().getTime() / 1000));
  const unique = (b.unik ?? nyUnik)();
  const hash = await signera(nycklar, time, unique);
  const fraga = new URLSearchParams({
    ...parametrar,
    callerId: nycklar.callerId,
    time,
    unique,
    hash,
  });
  const hemligt = [nycklar.callerId, nycklar.privateKey, hash];
  // The reason names the endpoint only: never the query (callerId, hash).
  const namn = sokvag;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), tidsgrans);
  try {
    const res = await doFetch(`${BOOLI_API_BAS}/${sokvag}?${fraga.toString()}`, {
      method: "GET",
      headers: { accept: BOOLI_API_ACCEPT },
      redirect: "manual",
      signal: ctrl.signal,
    });
    const kropp = await res.text();

    if (res.status === 401 || res.status === 403 || (!res.ok && /FAILURE_[A-Z_]+/.test(kropp))) {
      const kod = /FAILURE_[A-Z_]+/.exec(kropp)?.[0];
      return {
        typ: "fel",
        kod: "nyckel",
        orsak: `${namn}: http ${res.status}${kod ? ` ${kod}` : ""}`,
      };
    }
    if (res.status === 404 || res.status === 410) {
      return { typ: "fel", kod: "hittades_inte", orsak: `${namn}: http ${res.status}` };
    }
    if (!res.ok) return { typ: "fel", kod: "natverk", orsak: `${namn}: http ${res.status}` };
    if (kropp.length > MAX_SVAR_TECKEN) {
      return { typ: "fel", kod: "natverk", orsak: `${namn}: svaret är för stort` };
    }
    try {
      return { typ: "ok", data: JSON.parse(kropp) as unknown };
    } catch {
      return { typ: "fel", kod: "tolkning", orsak: `${namn}: svaret är inte JSON` };
    }
  } catch (fel) {
    return {
      typ: "fel",
      kod: "natverk",
      orsak: ctrl.signal.aborted
        ? `${namn}: timeout efter ${tidsgrans} ms`
        : `${namn}: ${tvatta(felText(fel), hemligt)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The first listing/sold object of an answer; `null` = an empty list (not
 *  found); "fel" = not the shape the endpoint documents. */
function objektISvar(data: unknown, samling: BooliApiSamling): unknown {
  const forsta = forstaObjekt(data, samling);
  if (forsta !== undefined) return forsta;
  const lista =
    typeof data === "object" && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>)[samling]
      : undefined;
  return Array.isArray(lista) ? null : "fel";
}

// ---------------------------------------------------------------------------
// One listing
// ---------------------------------------------------------------------------

/**
 * Fetches one `/annons/<id>` (listings → sold → areas). Never throws for an
 * expected failure. `id` must be the listing number from an `/annons/` link.
 */
export async function hamtaFranBooliApi(
  id: string,
  nycklar: BooliApiNycklar,
  b: BooliApiBeroenden = {},
): Promise<BooliApiUtfall> {
  if (!/^\d{1,12}$/.test(id)) {
    return { typ: "fel", kod: "hittades_inte", orsak: "ogiltigt id", anrop: 0 };
  }
  let anrop = 0;
  let samling: BooliApiSamling = "listings";

  anrop += 1;
  const aktiv = await anropaBooliApi(`listings/${id}`, {}, nycklar, b);
  let objekt: unknown = aktiv.typ === "ok" ? objektISvar(aktiv.data, "listings") : null;
  if (aktiv.typ === "fel" && aktiv.kod !== "hittades_inte") return { ...aktiv, anrop };
  if (objekt === "fel") {
    return { typ: "fel", kod: "tolkning", orsak: `listings/${id}: oväntad form`, anrop };
  }

  if (objekt === null) {
    samling = "sold";
    anrop += 1;
    const sald = await anropaBooliApi(`sold/${id}`, {}, nycklar, b);
    if (sald.typ === "fel") return { ...sald, anrop };
    objekt = objektISvar(sald.data, "sold");
    if (objekt === "fel") {
      return { typ: "fel", kod: "tolkning", orsak: `sold/${id}: oväntad form`, anrop };
    }
    if (objekt === null) {
      return { typ: "fel", kod: "hittades_inte", orsak: "varken listings eller sold", anrop };
    }
  }

  const t = tolkaBooliApiObjekt(objekt);
  // Defence against a wrong flat: the object must be the one asked for.
  if (t.booliId !== undefined && String(t.booliId) !== id) {
    return {
      typ: "fel",
      kod: "hittades_inte",
      orsak: `${samling}/${id}: svaret gäller ett annat id`,
      anrop,
    };
  }
  if (!harFormfalt(t.uppgifter)) {
    return { typ: "fel", kod: "tolkning", orsak: `${samling}/${id}: inga formulärfält`, anrop };
  }

  return medPostnummer(t.uppgifter, samling, anrop, nycklar, b);
}

/** Adds Booli's own postcode (`areas?lat&lng`) when the object has none. */
async function medPostnummer(
  uppgifter: AnnonsUppgifter,
  samling: BooliApiSamling,
  anrop: number,
  nycklar: BooliApiNycklar,
  b: BooliApiBeroenden,
): Promise<BooliApiUtfall> {
  let postnummerOrsak: string | undefined;
  if (uppgifter.postnummer === undefined) {
    if (uppgifter.koordinater === undefined) {
      postnummerOrsak = "inga koordinater";
    } else {
      anrop += 1;
      const omraden = await anropaBooliApi(
        "areas",
        { lat: String(uppgifter.koordinater.lat), lng: String(uppgifter.koordinater.lon) },
        nycklar,
        b,
      );
      const postnummer = omraden.typ === "ok" ? postnummerFranOmraden(omraden.data) : undefined;
      if (postnummer !== undefined) uppgifter = { ...uppgifter, postnummer };
      else postnummerOrsak = omraden.typ === "fel" ? omraden.orsak : "inget Postnummer-område";
    }
  }

  return {
    typ: "ok",
    uppgifter,
    samling,
    anrop,
    ...(postnummerOrsak !== undefined ? { postnummerOrsak } : {}),
  };
}

// ---------------------------------------------------------------------------
// One residence (/bostad/<id>)
// ---------------------------------------------------------------------------

type BostadSok =
  | { typ: "ok"; objekt: Record<string, unknown>[] }
  | { typ: "fel"; kod: BooliApiFelkod; orsak: string };

/** One `residenceId` search; refuses an answer that does not prove the filter. */
async function sokBostad(
  samling: BooliApiSamling,
  id: string,
  extra: Record<string, string>,
  nycklar: BooliApiNycklar,
  b: BooliApiBeroenden,
): Promise<BostadSok> {
  const svar = await anropaBooliApi(
    samling,
    { residenceId: id, ...extra, limit: String(BOSTAD_MAX_TRAFFAR) },
    nycklar,
    b,
  );
  if (svar.typ === "fel") return svar;
  const d = svar.data;
  const data =
    typeof d === "object" && d !== null && !Array.isArray(d) ? (d as Record<string, unknown>) : {};
  const lista = data[samling];
  const eko = (data["searchParams"] as Record<string, unknown> | undefined)?.["residenceId"];
  const total = data["totalCount"];
  if (!Array.isArray(lista) || String(eko) !== id) {
    return { typ: "fel", kod: "tolkning", orsak: `${samling}?residenceId: filtret bekräftas inte` };
  }
  if (typeof total === "number" && total > BOSTAD_MAX_TRAFFAR) {
    return { typ: "fel", kod: "tolkning", orsak: `${samling}?residenceId: ${total} träffar` };
  }
  return {
    typ: "ok",
    objekt: lista.filter(
      (o): o is Record<string, unknown> => typeof o === "object" && o !== null && !Array.isArray(o),
    ),
  };
}

/** The object whose `falt` (a "YYYY-MM-DD…" text) is latest. */
function senaste(objekt: Record<string, unknown>[], falt: string): Record<string, unknown> | null {
  let basta: Record<string, unknown> | null = null;
  for (const o of objekt) {
    const v = o[falt];
    const b = basta?.[falt];
    if (basta === null || (typeof v === "string" && (typeof b !== "string" || v > b))) basta = o;
  }
  return basta;
}

/**
 * Fetches one `/bostad/<id>` (residence id): its active or upcoming listing,
 * else its latest sale. Never throws for an expected failure.
 */
export async function hamtaBostadFranBooliApi(
  id: string,
  nycklar: BooliApiNycklar,
  b: BooliApiBeroenden = {},
): Promise<BooliApiUtfall> {
  if (!/^\d{1,12}$/.test(id)) {
    return { typ: "fel", kod: "hittades_inte", orsak: "ogiltigt id", anrop: 0 };
  }
  let anrop = 0;
  for (const extra of [{}, { upcomingSale: "1" }]) {
    anrop += 1;
    const sok = await sokBostad("listings", id, extra, nycklar, b);
    if (sok.typ === "fel") return { ...sok, anrop };
    const objekt = senaste(sok.objekt, "published");
    if (objekt !== null) {
      const t = tolkaBooliApiObjekt(objekt);
      if (!harFormfalt(t.uppgifter)) {
        return {
          typ: "fel",
          kod: "tolkning",
          orsak: "listings?residenceId: inga formulärfält",
          anrop,
        };
      }
      return medPostnummer(t.uppgifter, "listings", anrop, nycklar, b);
    }
  }

  anrop += 1;
  const sok = await sokBostad("sold", id, { sort: "soldDate", direction: "desc" }, nycklar, b);
  if (sok.typ === "fel") return { ...sok, anrop };
  const objekt = senaste(sok.objekt, "soldDate");
  if (objekt === null) {
    return { typ: "fel", kod: "hittades_inte", orsak: "ingen annons eller försäljning", anrop };
  }
  const uppgifter = { ...tolkaBooliApiObjekt(objekt).uppgifter };
  const sald = typeof objekt["soldDate"] === "string" ? Date.parse(objekt["soldDate"]) : NaN;
  const nu = (b.nu ?? (() => new Date()))().getTime();
  if (!Number.isFinite(sald) || nu - sald > BOOLI_BOSTAD_SALD_MAX_DAGAR * 86_400_000) {
    // An old sale: the flat's facts still hold, its price and fee do not.
    delete uppgifter.utgangspris;
    delete uppgifter.manadsavgift;
  }
  if (!harFormfalt(uppgifter)) {
    return { typ: "fel", kod: "tolkning", orsak: "sold?residenceId: inga formulärfält", anrop };
  }
  return medPostnummer(uppgifter, "sold", anrop, nycklar, b);
}

// ---------------------------------------------------------------------------
// The listing source
// ---------------------------------------------------------------------------

/** The keys, when the API is configured and not switched off. */
export function booliApiNycklar(env: {
  booliApiAvstangd?: boolean;
  booliCallerId?: string;
  booliPrivateKey?: string;
}): BooliApiNycklar | null {
  if (env.booliApiAvstangd === true) return null;
  if (!env.booliCallerId || !env.booliPrivateKey) return null;
  return { callerId: env.booliCallerId, privateKey: env.booliPrivateKey };
}

export const booliApiLeverantor: AnnonsLeverantor = {
  namn: "booli_api",
  metod: "api",
  async hamta(lank, b): Promise<LeverantorUtfall> {
    const kalla = "booli_api";
    const nycklar = booliApiNycklar(b.env);
    if (nycklar === null) {
      return { typ: "fel", kod: "ej_tillganglig", orsak: "api avstängt" };
    }
    const beroenden: BooliApiBeroenden = {
      ...(b.fetch ? { fetch: b.fetch } : {}),
      ...(b.nu ? { nu: b.nu } : {}),
      ...(b.unik ? { unik: b.unik } : {}),
      ...(b.apiTidsgransMs !== undefined ? { tidsgransMs: b.apiTidsgransMs } : {}),
    };
    // A /bostad/ id only ever goes to the residenceId filter (another number space).
    const utfall =
      lank.typ === "bostad"
        ? await hamtaBostadFranBooliApi(lank.id, nycklar, beroenden)
        : await hamtaFranBooliApi(lank.id, nycklar, beroenden);

    if (utfall.typ === "fel") {
      const handelse =
        utfall.kod === "nyckel"
          ? "booli-api nyckel avvisad"
          : utfall.kod === "hittades_inte"
            ? "hittades inte"
            : utfall.kod === "tolkning"
              ? "tolkning misslyckades"
              : "nätverk";
      logga(handelse, { url: lank.url, kalla, orsak: utfall.orsak, anrop: utfall.anrop });
      return { typ: "fel", kod: utfall.kod, orsak: utfall.orsak };
    }

    if (utfall.postnummerOrsak !== undefined) {
      logga("inget postnummer från booli-api", {
        url: lank.url,
        kalla,
        orsak: utfall.postnummerOrsak,
      });
    }
    const saknasKarn = ANNONS_KARNFALT.filter((f) => utfall.uppgifter[f] === undefined);
    if (saknasKarn.length > 0) {
      logga("kärnfält saknas i api-svaret", { url: lank.url, kalla, saknas: saknasKarn });
    }
    return {
      typ: "ok",
      uppgifter: utfall.uppgifter,
      tolkning: "struktur",
      // Booli's own data (the object's postCode or its Postnummer area), not geocoding.
      ...(utfall.uppgifter.postnummer !== undefined ? { postnummerKalla: "annons" as const } : {}),
    };
  },
};
