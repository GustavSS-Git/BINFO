/**
 * Request context ("kontext") for every server function: WHO is asking.
 *
 * `losKontext` is meant to be the first call in each server-function
 * handler (`analysFn.ts`, the price-estimate function, …) and the result is
 * passed down to the implementations. It is the single insertion point where
 * Supabase Auth plugs in later: once accounts exist, this function also reads
 * the session and sets `principalId` from the account's principal. Handlers
 * and implementations stay unchanged — they only ever see a `Kontext`.
 *
 * Today:
 * - `enhetId` — the anonymous device id from the first-party httpOnly cookie
 *   `binfo_enhet` (128 random bits, base64url). Created here when absent or
 *   malformed. It identifies a browser, not a person, and holds nothing else.
 * - `principalId` — always null from here. The `principal` row is created
 *   lazily on the first expensive action (see `./principal.ts`,
 *   `medPrincipal`), so merely visiting the site never writes to the
 *   database.
 * - `ipHash` — hex HMAC-SHA256 of the client IP, keyed by a key derived from
 *   PROJECT_SECRET_KEY. The raw IP is never returned, stored or logged. Used
 *   only as a rate-limit key (`./kvot.ts`). Null when there is no
 *   `cf-connecting-ip` header (local CLI/dev).
 *
 * Web APIs only (Cloudflare Workers): crypto.getRandomValues, crypto.subtle,
 * btoa, TextEncoder — no Buffer, no node:crypto.
 *
 * The request-bound TanStack Start helpers sit behind the small
 * `KontextKallor` interface so tests need no live request;
 * `tanstackKontextKallor()` is the production binding.
 */

import { getCookie, getRequestHeader, setCookie } from "@tanstack/react-start/server";

export interface Kontext {
  enhetId: string;
  principalId: string | null;
  ipHash: string | null;
}

export const ENHET_COOKIE = "binfo_enhet";

/** One year, in seconds. */
export const ENHET_COOKIE_MAX_AGE_SEK = 365 * 24 * 60 * 60;

export interface CookieAlternativ {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
}

export const ENHET_COOKIE_ALTERNATIV: Readonly<CookieAlternativ> = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: ENHET_COOKIE_MAX_AGE_SEK,
};

/** The request-bound reads/writes `losKontext` needs, injectable for tests. */
export interface KontextKallor {
  lasCookie(namn: string): string | undefined;
  sattCookie(namn: string, varde: string, alternativ: CookieAlternativ): void;
  lasHeader(namn: string): string | undefined;
}

export interface KontextDeps {
  kallor: KontextKallor;
  /** PROJECT_SECRET_KEY (`Env.supabaseSecretKey`) — the root of the IP-hash
   *  key. Never used directly as the HMAC key; see `hashaIp`. */
  hemlighet: string;
  /** Injectable for tests; defaults to crypto.getRandomValues. */
  slumpa?: (antalBytes: number) => Uint8Array;
}

/** Production binding to TanStack Start's request-scoped helpers. Only
 *  callable inside a server function / request handler. */
export function tanstackKontextKallor(): KontextKallor {
  return {
    lasCookie: (namn) => getCookie(namn),
    sattCookie: (namn, varde, alternativ) => setCookie(namn, varde, alternativ),
    lasHeader: (namn) => getRequestHeader(namn),
  };
}

/** 16 random bytes → 22 base64url chars, no padding. */
const ENHET_ID_MONSTER = /^[A-Za-z0-9_-]{22}$/;

export function arGiltigtEnhetId(varde: string | undefined): varde is string {
  return varde !== undefined && ENHET_ID_MONSTER.test(varde);
}

function base64url(bytes: Uint8Array): string {
  let binar = "";
  for (const b of bytes) binar += String.fromCharCode(b);
  return btoa(binar).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function standardSlump(antalBytes: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(antalBytes));
}

export function skapaEnhetId(slumpa: (antalBytes: number) => Uint8Array = standardSlump): string {
  return base64url(slumpa(16));
}

/**
 * Reads the device cookie; if absent (or not a value we could have issued),
 * creates a new id and sets the cookie. A malformed value is replaced rather
 * than trusted, so the device id — which ends up in rate-limit keys and the
 * `principal` table — is always our own 128-bit random string.
 */
export function losEnhetId(
  kallor: KontextKallor,
  slumpa?: (antalBytes: number) => Uint8Array,
): string {
  const befintlig = kallor.lasCookie(ENHET_COOKIE);
  if (arGiltigtEnhetId(befintlig)) return befintlig;
  const ny = skapaEnhetId(slumpa);
  kallor.sattCookie(ENHET_COOKIE, ny, { ...ENHET_COOKIE_ALTERNATIV });
  return ny;
}

/**
 * Client IP: Cloudflare's `cf-connecting-ip` only — set by Cloudflare's edge,
 * never by the client. `x-forwarded-for` is deliberately NOT read: outside
 * Cloudflare any client can send it, which would let one forge a fresh IP per
 * request and slip past the per-IP limits. No `cf-connecting-ip` (local
 * dev/CLI) → null, and only the per-device limits apply.
 */
export function losIp(kallor: KontextKallor): string | null {
  const cf = kallor.lasHeader("cf-connecting-ip")?.trim();
  if (cf) return cf;
  return null;
}

const kodare = new TextEncoder();

function hex(buffer: ArrayBuffer): string {
  let ut = "";
  for (const b of new Uint8Array(buffer)) ut += b.toString(16).padStart(2, "0");
  return ut;
}

async function hmacNyckel(ramaterial: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", ramaterial, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
}

/** Version label of the derived key. Bump it to rotate every IP hash. */
export const IP_NYCKEL_ETIKETT = "binfo-ip-v1";

/**
 * hex(HMAC-SHA256(key = HMAC-SHA256(hemlighet, "binfo-ip-v1"), ip)).
 * A derived key (not the secret itself) so the hash is domain-separated from
 * any other use of PROJECT_SECRET_KEY. The IP is trimmed and lowercased so
 * IPv6 spelling doesn't split one client into two keys.
 */
export async function hashaIp(ip: string, hemlighet: string): Promise<string> {
  const rot = await hmacNyckel(kodare.encode(hemlighet));
  const harledd = await crypto.subtle.sign("HMAC", rot, kodare.encode(IP_NYCKEL_ETIKETT));
  const nyckel = await hmacNyckel(harledd);
  const signatur = await crypto.subtle.sign("HMAC", nyckel, kodare.encode(ip.trim().toLowerCase()));
  return hex(signatur);
}

export async function losKontext(deps: KontextDeps): Promise<Kontext> {
  const enhetId = losEnhetId(deps.kallor, deps.slumpa);
  const ip = losIp(deps.kallor);
  const ipHash = ip === null ? null : await hashaIp(ip, deps.hemlighet);
  // Accounts later: read the Supabase Auth session here and set
  // principalId to the account's principal (merging this device's
  // principal into it on first sign-in via `slaSammanPrincipal`).
  return { enhetId, principalId: null, ipHash };
}
