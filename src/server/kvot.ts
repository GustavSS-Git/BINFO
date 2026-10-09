/**
 * Rate limiting ("kvot") on top of the atomic `ta_kvot` RPC
 * (supabase/migrations/20261009120100_konto.sql).
 *
 * Fixed, UTC-aligned windows: a "day" resets at 00:00 UTC (01:00/02:00
 * Swedish time), an "hour" on the hour. Fixed windows allow up to twice the
 * limit across a boundary — acceptable for abuse protection, and far simpler
 * than a sliding log.
 *
 * Keys: `<handling>:enhet:<device id>` and `<handling>:ip:<ipHash>`. Only
 * the HMAC of the IP is ever used (see `./kontext.ts`).
 *
 * When `kontext.ipHash` is null (no IP header — local dev/CLI; on Cloudflare
 * `cf-connecting-ip` is always present) only the device limit applies to
 * uploads, and the price-estimate limit falls back to the device key with
 * the same 60/hour.
 */

import type { Kontext } from "./kontext";
import type { KontoDatabas } from "./kontoPortar";

export const DAG_SEK = 24 * 60 * 60;
export const TIMME_SEK = 60 * 60;

// Owner decision 2026-10-09 (docs/PLAN-v2.md §0, "Accounts"). These are
// product limits, not facts — change them here.
export const UPPLADDNINGAR_PER_ENHET_OCH_DAG = 5;
export const UPPLADDNINGAR_PER_IP_OCH_DAG = 10;
export const PRISUPPSKATTNINGAR_PER_IP_OCH_TIMME = 60;

export type KvotHandling = "uppladdning" | "prisuppskattning";

export function kvotNyckel(handling: KvotHandling, typ: "enhet" | "ip", id: string): string {
  return `${handling}:${typ}:${id}`;
}

export type KvotUtfall = { ok: true } | { ok: false; errorCode: "kvot"; message: string };

export const KVOT_MEDDELANDE = {
  uppladdningEnhet: "Du har nått dagens gräns för antal analyser. Försök igen i morgon.",
  uppladdningIp: "Dagens gräns för antal analyser från ditt nätverk är nådd. Försök igen i morgon.",
  prisuppskattning:
    "Du har gjort många prisuppskattningar på kort tid. Vänta en stund och försök igen.",
} as const;

/** One use of `nyckel` in the current window; true iff still within `max`.
 *  A refused call does not consume quota. */
export async function taKvot(
  db: KontoDatabas,
  nyckel: string,
  fonsterSek: number,
  max: number,
): Promise<boolean> {
  return db.taKvot(nyckel, fonsterSek, max);
}

function nekad(message: string): KvotUtfall {
  return { ok: false, errorCode: "kvot", message };
}

/**
 * Upload limits: 5 per device per day, then 10 per IP per day. If the IP
 * limit refuses after the device use was taken, that use is given back, so
 * a refused upload costs the buyer nothing.
 */
export async function kontrolleraUppladdningskvot(
  db: KontoDatabas,
  kontext: Kontext,
): Promise<KvotUtfall> {
  const enhetNyckel = kvotNyckel("uppladdning", "enhet", kontext.enhetId);
  if (!(await taKvot(db, enhetNyckel, DAG_SEK, UPPLADDNINGAR_PER_ENHET_OCH_DAG))) {
    return nekad(KVOT_MEDDELANDE.uppladdningEnhet);
  }
  if (kontext.ipHash !== null) {
    const ipNyckel = kvotNyckel("uppladdning", "ip", kontext.ipHash);
    if (!(await taKvot(db, ipNyckel, DAG_SEK, UPPLADDNINGAR_PER_IP_OCH_DAG))) {
      await db.aterlamnaKvot(enhetNyckel, DAG_SEK);
      return nekad(KVOT_MEDDELANDE.uppladdningIp);
    }
  }
  return { ok: true };
}

/**
 * Gives back the upload quota `kontrolleraUppladdningskvot` took (the device
 * key, and the IP key when there is an IP). Used when the upload turned out to
 * cost nothing: served instantly from the register, or joined to a report that
 * is already being analysed. Best effort — the buyer's analysis already exists,
 * so a failed refund is logged, never thrown.
 */
export async function aterlamnaUppladdningskvot(db: KontoDatabas, kontext: Kontext): Promise<void> {
  try {
    await db.aterlamnaKvot(kvotNyckel("uppladdning", "enhet", kontext.enhetId), DAG_SEK);
    if (kontext.ipHash !== null) {
      await db.aterlamnaKvot(kvotNyckel("uppladdning", "ip", kontext.ipHash), DAG_SEK);
    }
  } catch (fel) {
    console.warn(
      "[kvot] Kunde inte återlämna uppladdningskvot: " +
        (fel instanceof Error ? fel.message : String(fel)),
    );
  }
}

/** Price-estimate limit: 60 per IP per hour (device key when no IP). */
export async function kontrolleraPrisuppskattningskvot(
  db: KontoDatabas,
  kontext: Kontext,
): Promise<KvotUtfall> {
  const nyckel =
    kontext.ipHash !== null
      ? kvotNyckel("prisuppskattning", "ip", kontext.ipHash)
      : kvotNyckel("prisuppskattning", "enhet", kontext.enhetId);
  if (!(await taKvot(db, nyckel, TIMME_SEK, PRISUPPSKATTNINGAR_PER_IP_OCH_TIMME))) {
    return nekad(KVOT_MEDDELANDE.prisuppskattning);
  }
  return { ok: true };
}
