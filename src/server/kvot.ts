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

/**
 * The LOOSE upload quota (product limits, supervisor decision 2026-10-09 — not
 * measured facts). It counts every upload that passes the checks, including the
 * ones that turn out to be served from the register for free, and is NEVER
 * refunded. The strict quota above is given back for such uploads
 * (`aterlamnaUppladdningskvot`), so on its own it would let one client re-upload
 * known reports without end; this one bounds that.
 */
export const UPPLADDNINGAR_LOSA_PER_ENHET_OCH_DAG = 30;
export const UPPLADDNINGAR_LOSA_PER_IP_OCH_DAG = 100;

/**
 * Account limits (v3, docs/PLAN-v3.md §1.2). Product limits, not facts.
 * Fixed UTC-aligned windows: 15 minutes (login) and one hour. Email keys hold
 * an HMAC of the address (`hashaEpost` in ./kontext.ts), never the address.
 */
export const KVARTAR_SEK = 15 * 60;
export const INLOGGNINGAR_PER_IP_OCH_KVART = 10;
export const INLOGGNINGAR_PER_EPOST_OCH_KVART = 5;
export const REGISTRERINGAR_PER_IP_OCH_TIMME = 5;
export const ATERSTALLNINGAR_PER_EPOST_OCH_TIMME = 3;
export const ATERSTALLNINGAR_PER_IP_OCH_TIMME = 10;

export type KvotHandling =
  | "uppladdning"
  | "uppladdning_los"
  | "prisuppskattning"
  | "inloggning"
  | "registrering"
  | "aterstallning";

export function kvotNyckel(
  handling: KvotHandling,
  typ: "enhet" | "ip" | "epost",
  id: string,
): string {
  return `${handling}:${typ}:${id}`;
}

export type KvotUtfall = { ok: true } | { ok: false; errorCode: "kvot"; message: string };

export const KVOT_MEDDELANDE = {
  uppladdningEnhet: "Du har nått dagens gräns för antal analyser. Försök igen i morgon.",
  uppladdningIp: "Dagens gräns för antal analyser från ditt nätverk är nådd. Försök igen i morgon.",
  uppladdningEnhetTotalt:
    "Du har gjort många uppladdningar idag, även av rapporter som redan var analyserade. Försök igen i morgon.",
  uppladdningIpTotalt:
    "Många uppladdningar har gjorts från ditt nätverk idag, även av rapporter som redan var analyserade. Försök igen i morgon.",
  prisuppskattning:
    "Du har gjort många prisuppskattningar på kort tid. Vänta en stund och försök igen.",
  /** Login, sign-up and password reset. One text for every limit so it never
   *  says which key (address, network) ran out. */
  konto: "För många försök, vänta en stund.",
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
 * Upload limits, taken together: strict 5 per device then 10 per IP per day
 * (refunded when the upload costs nothing, see `aterlamnaUppladdningskvot`),
 * then the loose, never-refunded 30 per device and 100 per IP per day. The first
 * refusal gives back every use already taken in this call, so a refused upload
 * costs the buyer nothing.
 */
export async function kontrolleraUppladdningskvot(
  db: KontoDatabas,
  kontext: Kontext,
): Promise<KvotUtfall> {
  const tagna: string[] = [];
  const forsok = async (nyckel: string, max: number, meddelande: string) => {
    if (await taKvot(db, nyckel, DAG_SEK, max)) {
      tagna.push(nyckel);
      return null;
    }
    for (const t of tagna) await db.aterlamnaKvot(t, DAG_SEK);
    return nekad(meddelande);
  };

  const steg: Array<[string, number, string]> = [
    [
      kvotNyckel("uppladdning", "enhet", kontext.enhetId),
      UPPLADDNINGAR_PER_ENHET_OCH_DAG,
      KVOT_MEDDELANDE.uppladdningEnhet,
    ],
  ];
  if (kontext.ipHash !== null) {
    steg.push([
      kvotNyckel("uppladdning", "ip", kontext.ipHash),
      UPPLADDNINGAR_PER_IP_OCH_DAG,
      KVOT_MEDDELANDE.uppladdningIp,
    ]);
  }
  steg.push([
    kvotNyckel("uppladdning_los", "enhet", kontext.enhetId),
    UPPLADDNINGAR_LOSA_PER_ENHET_OCH_DAG,
    KVOT_MEDDELANDE.uppladdningEnhetTotalt,
  ]);
  if (kontext.ipHash !== null) {
    steg.push([
      kvotNyckel("uppladdning_los", "ip", kontext.ipHash),
      UPPLADDNINGAR_LOSA_PER_IP_OCH_DAG,
      KVOT_MEDDELANDE.uppladdningIpTotalt,
    ]);
  }
  for (const [nyckel, max, meddelande] of steg) {
    const nekat = await forsok(nyckel, max, meddelande);
    if (nekat) return nekat;
  }
  return { ok: true };
}

/**
 * Gives back the STRICT upload quota `kontrolleraUppladdningskvot` took (the
 * device key, and the IP key when there is an IP). The loose quota
 * (`UPPLADDNINGAR_LOSA_*`) is deliberately never given back. Used when the upload turned out to
 * cost nothing: served instantly from the register, or joined to a report that
 * is already being analysed. With `aven_losa` (only when the upload failed
 * unexpectedly and created nothing) the loose quota is given back too. Best effort — the buyer's analysis already exists,
 * so a failed refund is logged, never thrown.
 */
export async function aterlamnaUppladdningskvot(
  db: KontoDatabas,
  kontext: Kontext,
  alternativ: { aven_losa?: boolean } = {},
): Promise<void> {
  try {
    const handlingar: KvotHandling[] = alternativ.aven_losa
      ? ["uppladdning", "uppladdning_los"]
      : ["uppladdning"];
    for (const handling of handlingar) {
      await db.aterlamnaKvot(kvotNyckel(handling, "enhet", kontext.enhetId), DAG_SEK);
      if (kontext.ipHash !== null) {
        await db.aterlamnaKvot(kvotNyckel(handling, "ip", kontext.ipHash), DAG_SEK);
      }
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

// ---------------------------------------------------------------------------
// Accounts: login, sign-up, password reset
// ---------------------------------------------------------------------------

interface KontoKvotSteg {
  nyckel: string;
  max: number;
}

/** The per-network key: the IP hash, or the device id when there is no IP
 *  header (local dev/CLI; on Cloudflare `cf-connecting-ip` is always set). */
function natverksNyckel(handling: KvotHandling, kontext: Kontext): string {
  return kontext.ipHash !== null
    ? kvotNyckel(handling, "ip", kontext.ipHash)
    : kvotNyckel(handling, "enhet", kontext.enhetId);
}

/** Takes every step in order; the first refusal gives back the ones already
 *  taken, so a refused request costs nothing on the other keys. */
async function taAlla(
  db: KontoDatabas,
  steg: readonly KontoKvotSteg[],
  fonsterSek: number,
): Promise<KvotUtfall> {
  const tagna: string[] = [];
  for (const s of steg) {
    if (await taKvot(db, s.nyckel, fonsterSek, s.max)) {
      tagna.push(s.nyckel);
      continue;
    }
    for (const t of tagna) await db.aterlamnaKvot(t, fonsterSek);
    return nekad(KVOT_MEDDELANDE.konto);
  }
  return { ok: true };
}

function loginSteg(kontext: Kontext, epostHash: string): KontoKvotSteg[] {
  return [
    {
      nyckel: natverksNyckel("inloggning", kontext),
      max: INLOGGNINGAR_PER_IP_OCH_KVART,
    },
    {
      nyckel: kvotNyckel("inloggning", "epost", epostHash),
      max: INLOGGNINGAR_PER_EPOST_OCH_KVART,
    },
  ];
}

/** Login attempts: 10 per network and 5 per address per 15 minutes. Counts
 *  the attempt (a refusal consumes nothing). */
export async function kontrolleraInloggningskvot(
  db: KontoDatabas,
  kontext: Kontext,
  epostHash: string,
): Promise<KvotUtfall> {
  return taAlla(db, loginSteg(kontext, epostHash), KVARTAR_SEK);
}

/** A successful login gives its own attempt back, so signing in and out a few
 *  times never locks a real user out — while every FAILED attempt keeps
 *  counting, which is what stops guessing. Best effort. */
export async function aterlamnaInloggningskvot(
  db: KontoDatabas,
  kontext: Kontext,
  epostHash: string,
): Promise<void> {
  try {
    for (const s of loginSteg(kontext, epostHash)) await db.aterlamnaKvot(s.nyckel, KVARTAR_SEK);
  } catch (fel) {
    console.warn(
      "[kvot] Kunde inte återlämna inloggningskvot: " +
        (fel instanceof Error ? fel.message : String(fel)),
    );
  }
}

/** Sign-up: 5 per network and hour. */
export async function kontrolleraRegistreringskvot(
  db: KontoDatabas,
  kontext: Kontext,
): Promise<KvotUtfall> {
  return taAlla(
    db,
    [{ nyckel: natverksNyckel("registrering", kontext), max: REGISTRERINGAR_PER_IP_OCH_TIMME }],
    TIMME_SEK,
  );
}

/** Password reset: 3 per address and 10 per network and hour. */
export async function kontrolleraAterstallningskvot(
  db: KontoDatabas,
  kontext: Kontext,
  epostHash: string,
): Promise<KvotUtfall> {
  return taAlla(
    db,
    [
      {
        nyckel: kvotNyckel("aterstallning", "epost", epostHash),
        max: ATERSTALLNINGAR_PER_EPOST_OCH_TIMME,
      },
      { nyckel: natverksNyckel("aterstallning", kontext), max: ATERSTALLNINGAR_PER_IP_OCH_TIMME },
    ],
    TIMME_SEK,
  );
}
