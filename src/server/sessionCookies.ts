/**
 * The Supabase Auth session as two first-party cookies (docs/PLAN-v3.md §1.2).
 * The browser never holds a Supabase client or any token JavaScript can read:
 *
 * - `binfo_sa`  — the access token (a JWT, ~1 h). Cookie lifetime = the
 *   token's `expires_in`, so an expired access token simply disappears.
 * - `binfo_sr`  — the refresh token. 30 days, rotated on every refresh
 *   (sliding): an account that is used at least monthly stays signed in.
 *
 * Both are httpOnly, Secure, SameSite=Lax, Path=/ — the same attributes as the
 * device cookie `binfo_enhet` (see ./kontext.ts), set through the same
 * request-bound `KontextKallor`. Clearing = the same cookie with an empty
 * value and Max-Age=0.
 *
 * A browser silently drops a cookie larger than ~4 kB, which would look like
 * "logged out for no reason"; `sattSessionCookies` refuses to emit one.
 */

import type { AuthSession } from "./kontoPortar";
import { ATERST_NYCKEL_ETIKETT, hmacMedEtikett } from "./kontext";
import type { CookieAlternativ, KontextKallor } from "./kontext";

export const ACCESS_COOKIE = "binfo_sa";
export const REFRESH_COOKIE = "binfo_sr";

/** 30 days, in seconds. */
export const REFRESH_COOKIE_MAX_AGE_SEK = 30 * 24 * 60 * 60;

/** Browsers store at most ~4096 bytes per cookie (name + value + attributes).
 *  Leave room for the attributes. */
export const MAX_COOKIE_BYTES = 3800;

export class CookieForStorError extends Error {
  constructor(namn: string, bytes: number) {
    super(`Session-cookien ${namn} blev ${bytes} byte — över gränsen ${MAX_COOKIE_BYTES}.`);
    this.name = "CookieForStorError";
  }
}

function alternativ(maxAge: number): CookieAlternativ {
  return { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge };
}

/** Shapes we could have issued: a JWT, and an opaque refresh token. Anything
 *  else in the cookie is ignored (never forwarded to the Auth server). */
const ACCESS_MONSTER = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
const REFRESH_MONSTER = /^[A-Za-z0-9_.-]{6,512}$/;

export interface SessionCookies {
  accessToken: string | undefined;
  refreshToken: string | undefined;
}

export function lasSessionCookies(kallor: KontextKallor): SessionCookies {
  const a = kallor.lasCookie(ACCESS_COOKIE);
  const r = kallor.lasCookie(REFRESH_COOKIE);
  return {
    accessToken:
      a !== undefined && a.length <= MAX_COOKIE_BYTES && ACCESS_MONSTER.test(a) ? a : undefined,
    refreshToken: r !== undefined && REFRESH_MONSTER.test(r) ? r : undefined,
  };
}

function kravStorlek(namn: string, varde: string): void {
  const bytes = new TextEncoder().encode(namn + "=" + varde).length;
  if (bytes > MAX_COOKIE_BYTES) throw new CookieForStorError(namn, bytes);
}

/** Sets both cookies (also used to ROTATE them after a refresh). */
export function sattSessionCookies(kallor: KontextKallor, session: AuthSession): void {
  kravStorlek(ACCESS_COOKIE, session.accessToken);
  kravStorlek(REFRESH_COOKIE, session.refreshToken);
  // An access token with no usable lifetime would be a session cookie that
  // outlives the token; clamp to at least one minute.
  const accessLevnad = Math.max(60, Math.floor(session.expiresIn));
  kallor.sattCookie(ACCESS_COOKIE, session.accessToken, alternativ(accessLevnad));
  kallor.sattCookie(REFRESH_COOKIE, session.refreshToken, alternativ(REFRESH_COOKIE_MAX_AGE_SEK));
}

export function rensaSessionCookies(kallor: KontextKallor): void {
  kallor.sattCookie(ACCESS_COOKIE, "", alternativ(0));
  kallor.sattCookie(REFRESH_COOKIE, "", alternativ(0));
}

// ---------------------------------------------------------------------------
// Recovery marker
// ---------------------------------------------------------------------------

/** Proof that THIS browser just followed a password-recovery email link. */
export const ATERST_COOKIE = "binfo_aterst";
export const ATERST_MAX_AGE_SEK = 15 * 60;

const ATERST_MONSTER = /^(\d{10,16})\.([0-9a-f]{64})$/;

async function signeraAterst(
  hemlighet: string,
  authUserId: string,
  utgarMs: number,
): Promise<string> {
  return hmacMedEtikett(hemlighet, ATERST_NYCKEL_ETIKETT, `${authUserId}.${utgarMs}`);
}

/** Value: `<expiresAtMs>.<hex HMAC of "<authUserId>.<expiresAtMs>">`. */
export async function sattAterstallningsmarke(
  kallor: KontextKallor,
  hemlighet: string,
  authUserId: string,
  nuMs: number = Date.now(),
): Promise<void> {
  const utgarMs = nuMs + ATERST_MAX_AGE_SEK * 1000;
  const varde = `${utgarMs}.${await signeraAterst(hemlighet, authUserId, utgarMs)}`;
  kravStorlek(ATERST_COOKIE, varde);
  kallor.sattCookie(ATERST_COOKIE, varde, alternativ(ATERST_MAX_AGE_SEK));
}

function likaKonstantTid(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True only for an unexpired, untampered marker issued for `authUserId`. */
export async function harGiltigtAterstallningsmarke(
  kallor: KontextKallor,
  hemlighet: string,
  authUserId: string,
  nuMs: number = Date.now(),
): Promise<boolean> {
  const ra = kallor.lasCookie(ATERST_COOKIE);
  const m = ra === undefined ? null : ATERST_MONSTER.exec(ra);
  if (m === null) return false;
  const utgarMs = Number(m[1]);
  if (!Number.isSafeInteger(utgarMs) || utgarMs <= nuMs) return false;
  // Never accept a marker living longer than we issue them.
  if (utgarMs > nuMs + ATERST_MAX_AGE_SEK * 1000) return false;
  return likaKonstantTid(m[2]!, await signeraAterst(hemlighet, authUserId, utgarMs));
}

export function rensaAterstallningsmarke(kallor: KontextKallor): void {
  kallor.sattCookie(ATERST_COOKIE, "", alternativ(0));
}
