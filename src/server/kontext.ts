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
 * Identity:
 * - Session (v3): when `deps.session` is given and the httpOnly cookies
 *   `binfo_sa`/`binfo_sr` (./sessionCookies.ts) hold a valid Supabase Auth
 *   session, `principalId` is the account's `typ = 'konto'` principal and
 *   `konto` carries the Auth user. An expired access token is refreshed with
 *   the refresh cookie (both cookies rotated); a token that is rejected
 *   clears the cookies and the request is anonymous. On the first request
 *   from a device the device's anonymous principal is merged into the account
 *   (once). Without `deps.session` nothing of this runs.
 * - `enhetId` — the anonymous device id from the first-party httpOnly cookie
 *   `binfo_enhet` (128 random bits, base64url). Created here when absent or
 *   malformed. It identifies a browser, not a person, and holds nothing else.
 * - `principalId` — null for an anonymous visitor: the device `principal`
 *   row is created lazily on the first expensive action (see
 *   `./principal.ts`, `medPrincipal`), so merely visiting the site never
 *   writes to the database. Set for a logged-in account.
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
import type { AuthAnvandare, AuthPort, KontoDatabas } from "./kontoPortar";
import { lasSessionCookies, rensaSessionCookies, sattSessionCookies } from "./sessionCookies";

/** The logged-in account behind a request. Absent for anonymous visitors. */
export interface KontoIdentitet {
  authUserId: string;
  epost: string;
}

export interface Kontext {
  enhetId: string;
  principalId: string | null;
  ipHash: string | null;
  /** Set exactly when the request carries a valid session; then
   *  `principalId` is the account's principal. */
  konto?: KontoIdentitet;
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

/** What reading a session needs: the Auth port and the principal store. */
export interface SessionBeroenden {
  auth: AuthPort;
  db: KontoDatabas;
}

export interface KontextDeps {
  kallor: KontextKallor;
  /** Omit for anonymous-only behaviour (tests, and deployments without
   *  `PROJECT_PUBLISHABLE_KEY`). */
  session?: SessionBeroenden;
  /** PROJECT_SECRET_KEY (`Env.supabaseSecretKey`) — the root of the IP-hash
   *  key. Never used directly as the HMAC key; see `hashaIp`. */
  hemlighet: string;
  /** Injectable for tests; defaults to crypto.getRandomValues. */
  slumpa?: (antalBytes: number) => Uint8Array;
}

/** Production binding to TanStack Start's request-scoped helpers. Only
 *  callable inside a server function / request handler.
 *
 *  Write-through: `getCookie` reads the REQUEST's Cookie header, so a cookie
 *  set earlier in the same request would read back stale. A session refresh in
 *  `losKontext` rotates the tokens, and a later step of the same request (e.g.
 *  `sattNyttLosenord`) must see the new ones, so values written through this
 *  object are remembered and returned by `lasCookie`. One object per request. */
export function tanstackKontextKallor(): KontextKallor {
  const satta = new Map<string, string>();
  return {
    lasCookie: (namn) => (satta.has(namn) ? satta.get(namn) : getCookie(namn)),
    sattCookie: (namn, varde, alternativ) => {
      satta.set(namn, varde);
      setCookie(namn, varde, alternativ);
    },
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

/** Version label of the derived email key. */
export const EPOST_NYCKEL_ETIKETT = "binfo-epost-v1";

/**
 * hex(HMAC) of an email address, for rate-limit keys only — the address
 * itself is never put in a key, log or table by us. Same construction as
 * `hashaIp` with its own domain label; trimmed and lowercased so the spelling
 * of one address can't dodge its limit.
 */
export async function hashaEpost(epost: string, hemlighet: string): Promise<string> {
  const rot = await hmacNyckel(kodare.encode(hemlighet));
  const harledd = await crypto.subtle.sign("HMAC", rot, kodare.encode(EPOST_NYCKEL_ETIKETT));
  const nyckel = await hmacNyckel(harledd);
  const signatur = await crypto.subtle.sign(
    "HMAC",
    nyckel,
    kodare.encode(epost.trim().toLowerCase()),
  );
  return hex(signatur);
}

/** Version label of the derived password-recovery marker key. */
export const ATERST_NYCKEL_ETIKETT = "binfo-aterst-v1";

/** Version label of the derived key for the pending "Spara analysen" marker
 *  (`binfo_spara`, ./sessionCookies.ts). Its own label, so a recovery marker
 *  can never pass as a save marker or the other way round. */
export const SPARA_NYCKEL_ETIKETT = "binfo-spara-analys-v1";

/**
 * hex(HMAC) of `meddelande` under a key derived from `hemlighet` and a domain
 * `etikett` — the same construction as `hashaIp` / `hashaEpost`. Used to sign
 * the short-lived recovery marker (./sessionCookies.ts).
 */
export async function hmacMedEtikett(
  hemlighet: string,
  etikett: string,
  meddelande: string,
): Promise<string> {
  const rot = await hmacNyckel(kodare.encode(hemlighet));
  const harledd = await crypto.subtle.sign("HMAC", rot, kodare.encode(etikett));
  const nyckel = await hmacNyckel(harledd);
  return hex(await crypto.subtle.sign("HMAC", nyckel, kodare.encode(meddelande)));
}

export interface AktivSession {
  anvandare: AuthAnvandare;
  principalId: string;
}

/**
 * Resolves the session cookies to an account, or null (anonymous).
 *
 * - No cookies → null, nothing touched.
 * - Valid access token → that user.
 * - Rejected/expired access token + refresh cookie → `fornyaSession`; on
 *   success BOTH cookies are rotated to the new tokens.
 * - A token the Auth server definitively rejects → cookies cleared, null.
 * - Auth unreachable (5xx/network) or rate-limiting (429) → null for this request but the cookies are
 *   left alone, so a blip doesn't sign anybody out.
 * - A DB failure while mapping to the principal propagates (the request fails
 *   rather than silently running as the wrong identity).
 *
 * The principal is created on the first call for a user; on the first call
 * from a device that has an unmerged anonymous principal, it is merged into
 * the account in the same transaction (`sakerstall_konto_principal`).
 */
export async function losSession(
  session: SessionBeroenden,
  kallor: KontextKallor,
  enhetId: string,
): Promise<AktivSession | null> {
  const { accessToken, refreshToken } = lasSessionCookies(kallor);
  if (accessToken === undefined && refreshToken === undefined) return null;

  let anvandare: AuthAnvandare | null = null;

  if (accessToken !== undefined) {
    const kontroll = await session.auth.valideraAccessToken(accessToken);
    if (kontroll.status === "ok") anvandare = kontroll.anvandare;
    else if (kontroll.status === "fel") return null;
  }

  if (anvandare === null) {
    if (refreshToken === undefined) {
      rensaSessionCookies(kallor);
      return null;
    }
    const ny = await session.auth.fornyaSession(refreshToken);
    if (ny.ok) {
      sattSessionCookies(kallor, ny.session);
      anvandare = ny.anvandare;
    } else if (ny.orsak === "tillfalligt" || ny.orsak === "kvot") {
      // Auth down or rate-limiting us (429): the refresh token may well be
      // fine, so this request runs anonymously and the cookies stay.
      return null;
    } else {
      rensaSessionCookies(kallor);
      return null;
    }
  }

  const { principalId } = await session.db.sakerstallKontoPrincipal(anvandare.id, enhetId);
  return { anvandare, principalId };
}

export async function losKontext(deps: KontextDeps): Promise<Kontext> {
  const enhetId = losEnhetId(deps.kallor, deps.slumpa);
  const ip = losIp(deps.kallor);
  const ipHash = ip === null ? null : await hashaIp(ip, deps.hemlighet);
  const bas: Kontext = { enhetId, principalId: null, ipHash };
  if (!deps.session) return bas;

  const aktiv = await losSession(deps.session, deps.kallor, enhetId);
  if (aktiv === null) return bas;
  return {
    ...bas,
    principalId: aktiv.principalId,
    konto: { authUserId: aktiv.anvandare.id, epost: aktiv.anvandare.epost },
  };
}
