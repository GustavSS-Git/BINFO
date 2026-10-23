/**
 * Accounts (v3, docs/PLAN-v3.md §1): sign-up, login, logout, password reset,
 * email-link verification and the session read — the implementations behind
 * `registreraKontoFn`, `loggaInFn`, … in `analysFn.ts` (wired by the
 * supervisor, see docs/v3-wiring/W1.md).
 *
 * Framework-free and port-injected: every function takes `KontoBeroenden`
 * (the request's cookie access, its resolved `Kontext`, the `AuthPort`, the
 * `KontoDatabas`) plus untrusted `data`, and returns a `KontoSvar`
 * (src/lib/kontoTyper.ts): a failure is DATA with a stable `felKod` and a
 * Swedish `meddelande` from fel.ts, never a thrown Supabase message.
 *
 * Security notes:
 * - Passwords are never stored, logged or returned; they only pass through to
 *   Supabase Auth. Minimum 10 characters, at most 72 bytes (bcrypt's limit).
 * - Sign-up and password reset answer the same whether or not the address
 *   exists (enumeration safety). Login says "fel e-postadress eller lösenord"
 *   for an unknown address and a wrong password alike.
 * - Rate limits (kvot.ts): login 10/IP and 5/address per 15 min, sign-up
 *   5/IP per hour, reset 3/address and 10/IP per hour. Addresses are only ever
 *   in keys as an HMAC (`hashaEpost`). The limit is checked BEFORE the work.
 * - The session lives in httpOnly cookies only (./sessionCookies.ts).
 */

import { z } from "zod";
import type {
  BegarAterstallningSvar,
  KontoFel,
  BekraftaEpostSvar,
  LoggaInSvar,
  LoggaUtSvar,
  RaderaKontoSvar,
  RegistreraKontoSvar,
  SattNyttLosenordSvar,
  SessionSvar,
} from "@/lib/kontoTyper";
import type { Env } from "./env";
import { kontoFel, KontoEjKonfigureratError } from "./fel";
import {
  ENHET_COOKIE,
  ENHET_COOKIE_ALTERNATIV,
  hashaEpost,
  skapaEnhetId,
  losKontext,
  tanstackKontextKallor,
  type Kontext,
  type KontextKallor,
  type SessionBeroenden,
} from "./kontext";
import type { AuthPort, KontoDatabas } from "./kontoPortar";
import {
  aterlamnaInloggningskvot,
  kontrolleraAterstallningskvot,
  kontrolleraInloggningskvot,
  kontrolleraRegistreringskvot,
} from "./kvot";
import { sakerstallKontoPrincipal } from "./principal";
import {
  harGiltigtAterstallningsmarke,
  lasSessionCookies,
  rensaAterstallningsmarke,
  rensaSessionCookies,
  rensaSparaMarke,
  sattAterstallningsmarke,
  sattSessionCookies,
} from "./sessionCookies";
import { skapaAuthPort } from "./supabaseAuth";
import { skapaKontoDatabas } from "./supabaseKonto";

export interface KontoBeroenden {
  /** The request's cookie access — the SAME object `kontext` was resolved
   *  with, so a token rotated by `losKontext` reads back correctly. */
  kallor: KontextKallor;
  kontext: Kontext;
  auth: AuthPort;
  db: KontoDatabas;
  /** `Env.supabaseSecretKey`: the root of the email-hash key. */
  hemlighet: string;
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

export const MIN_LOSENORD = 10;
/** bcrypt (what Supabase Auth hashes with) only reads the first 72 bytes and
 *  GoTrue rejects longer passwords. */
export const MAX_LOSENORD_BYTES = 72;

const EpostSchema = z.string().trim().toLowerCase().email().max(254);

const NyttLosenordSchema = z
  .string()
  .min(MIN_LOSENORD)
  .refine((l) => new TextEncoder().encode(l).length <= MAX_LOSENORD_BYTES);

const RegistreraSchema = z.object({ epost: EpostSchema, losenord: NyttLosenordSchema });

// Login accepts any non-empty password string: existing passwords were
// validated at creation, and a length rule here would only tell an attacker
// something.
const LoggaInSchema = z.object({
  epost: EpostSchema,
  losenord: z.string().min(1).max(1024),
});

const BegarSchema = z.object({ epost: EpostSchema });

const BekraftaSchema = z.object({
  tokenHash: z.string().regex(/^[A-Za-z0-9_.-]{10,300}$/),
  typ: z.enum(["signup", "recovery", "email_change"]),
});

const NyttLosenordInSchema = z.object({
  losenord: NyttLosenordSchema,
  nuvarandeLosenord: z.string().min(1).max(1024).optional(),
});

const RaderaSchema = z.object({ losenord: z.string().min(1).max(1024) });

function arObjekt(data: unknown): Record<string, unknown> {
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/** The session as the frontend sees it. Pure: `kontext` is already resolved. */
export function hamtaSession(kontext: Kontext): SessionSvar {
  if (kontext.konto === undefined || kontext.principalId === null) return { inloggad: false };
  return { inloggad: true, epost: kontext.konto.epost, principalId: kontext.principalId };
}

export async function registreraKonto(
  b: KontoBeroenden,
  data: unknown,
): Promise<RegistreraKontoSvar> {
  const kvot = await kontrolleraRegistreringskvot(b.db, b.kontext);
  if (!kvot.ok) return kontoFel("kvot");

  const rad = arObjekt(data);
  const epost = EpostSchema.safeParse(rad["epost"]);
  if (!epost.success) return kontoFel("ogiltig_epost");
  const losenord = NyttLosenordSchema.safeParse(rad["losenord"]);
  if (!losenord.success) return kontoFel("svagt_losenord");

  const r = await b.auth.registrera(epost.data, losenord.data);
  if (r.ok) return { ok: true };
  switch (r.orsak) {
    case "svagt_losenord":
      return kontoFel("svagt_losenord");
    case "ogiltig_epost":
      return kontoFel("ogiltig_epost");
    case "kvot":
      // Auth's own per-address resend limit only fires for an address with a
      // pending sign-up; answering "rate limited" would reveal that. The mail
      // was sent a moment ago, so the generic answer is also the true one.
      return { ok: true };
    default:
      console.warn(`[auth] registrera misslyckades (${r.orsak})`);
      return kontoFel("unknown");
  }
}

export async function loggaIn(b: KontoBeroenden, data: unknown): Promise<LoggaInSvar> {
  const parsed = LoggaInSchema.safeParse(data);
  if (!parsed.success) return kontoFel("ogiltig_inloggning");
  const { epost, losenord } = parsed.data;

  const epostHash = await hashaEpost(epost, b.hemlighet);
  const kvot = await kontrolleraInloggningskvot(b.db, b.kontext, epostHash);
  if (!kvot.ok) return kontoFel("kvot");

  const r = await b.auth.loggaIn(epost, losenord);
  if (!r.ok) {
    switch (r.orsak) {
      case "ogiltig_inloggning":
        return kontoFel("ogiltig_inloggning");
      case "ej_bekraftad":
        return kontoFel("epost_ej_bekraftad");
      case "kvot":
        return kontoFel("kvot");
      default:
        console.warn(`[auth] loggaIn misslyckades (${r.orsak})`);
        return kontoFel("unknown");
    }
  }

  // Principal (and the device merge) before the cookies: if the database is
  // down the user is not left with a session that cannot be used.
  const { principalId } = await sakerstallKontoPrincipal(b.db, r.anvandare.id, b.kontext.enhetId);
  sattSessionCookies(b.kallor, r.session);
  await aterlamnaInloggningskvot(b.db, b.kontext, epostHash);
  return { ok: true, epost: r.anvandare.epost, principalId };
}

export async function loggaUt(b: KontoBeroenden): Promise<LoggaUtSvar> {
  const { accessToken } = lasSessionCookies(b.kallor);
  try {
    if (accessToken !== undefined) await b.auth.loggaUt(accessToken);
  } finally {
    rensaSessionCookies(b.kallor);
    // A pending "Spara analysen" marker must not wait for the next person to
    // log in on this (possibly shared) browser.
    rensaSparaMarke(b.kallor);
    // A fresh device id: the old one is merged into the account principal, so
    // keeping it would attribute later anonymous uploads on this (possibly
    // shared) device to the account that just logged out.
    b.kallor.sattCookie(ENHET_COOKIE, skapaEnhetId(), { ...ENHET_COOKIE_ALTERNATIV });
  }
  return { ok: true };
}

export async function begarAterstallning(
  b: KontoBeroenden,
  data: unknown,
): Promise<BegarAterstallningSvar> {
  const epost = EpostSchema.safeParse(arObjekt(data)["epost"]);
  if (!epost.success) return kontoFel("ogiltig_epost");

  const epostHash = await hashaEpost(epost.data, b.hemlighet);
  const kvot = await kontrolleraAterstallningskvot(b.db, b.kontext, epostHash);
  if (!kvot.ok) return kontoFel("kvot");

  const r = await b.auth.begarAterstallning(epost.data);
  if (!r.ok) {
    // Never surfaced: an Auth error here (e.g. its resend limit) can depend on
    // whether the address is registered.
    console.warn(`[auth] begarAterstallning misslyckades (${r.orsak})`);
  }
  return { ok: true };
}

export async function bekraftaEpost(b: KontoBeroenden, data: unknown): Promise<BekraftaEpostSvar> {
  const parsed = BekraftaSchema.safeParse(data);
  if (!parsed.success) return kontoFel("ogiltig_lank");

  const r = await b.auth.bekrafta(parsed.data.tokenHash, parsed.data.typ);
  if (!r.ok) {
    switch (r.orsak) {
      case "kvot":
        return kontoFel("kvot");
      case "tillfalligt":
        return kontoFel("unknown");
      default:
        return kontoFel("ogiltig_lank");
    }
  }

  // Login CSRF: a valid link from the ATTACKER's own account, pressed by a
  // victim, must not replace the victim's session silently. (The token is
  // already consumed here, so the session it just opened is ended again.)
  const aktiv = b.kontext.konto;
  if (aktiv !== undefined && aktiv.authUserId !== r.anvandare.id) {
    await b.auth.loggaUt(r.session.accessToken);
    return kontoFel("annan_session_aktiv");
  }

  // No device merge: a link is not proof that THIS browser's anonymous
  // analyses belong to the account (only a password login, `loggaIn`, is).
  const { principalId } = await sakerstallKontoPrincipal(b.db, r.anvandare.id, null);
  sattSessionCookies(b.kallor, r.session);
  // A fresh device id, so neither this request's later uploads nor the next
  // request's `losSession` can attribute the old device (and its anonymous
  // history) to the account the link logged in.
  b.kallor.sattCookie(ENHET_COOKIE, skapaEnhetId(), { ...ENHET_COOKIE_ALTERNATIV });
  if (parsed.data.typ === "recovery") {
    await sattAterstallningsmarke(b.kallor, b.hemlighet, r.anvandare.id);
  }
  return { ok: true, typ: parsed.data.typ, epost: r.anvandare.epost, principalId };
}

/**
 * Re-authenticates the logged-in account with its password. Counts against the
 * login rate limit (checked first; a failed attempt keeps its count, a correct
 * one gives it back). The verification session is ended again and NO cookies
 * are set from it.
 */
async function verifieraLosenord(
  b: KontoBeroenden,
  epost: string,
  losenord: string,
): Promise<KontoFel | null> {
  const epostHash = await hashaEpost(epost, b.hemlighet);
  const kvot = await kontrolleraInloggningskvot(b.db, b.kontext, epostHash);
  if (!kvot.ok) return kontoFel("kvot");
  const r = await b.auth.loggaIn(epost, losenord);
  if (!r.ok) {
    switch (r.orsak) {
      case "ogiltig_inloggning":
      case "ej_bekraftad":
        return kontoFel("ogiltig_inloggning");
      case "kvot":
        return kontoFel("kvot");
      default:
        console.warn(`[auth] losenordsverifiering misslyckades (${r.orsak})`);
        return kontoFel("unknown");
    }
  }
  await b.auth.loggaUt(r.session.accessToken);
  await aterlamnaInloggningskvot(b.db, b.kontext, epostHash);
  return null;
}

/** Sets a new password for the logged-in user. Allowed with a fresh recovery
 *  marker for THIS user (see bekraftaEpost) or with the current password. */
export async function sattNyttLosenord(
  b: KontoBeroenden,
  data: unknown,
): Promise<SattNyttLosenordSvar> {
  const konto = b.kontext.konto;
  if (konto === undefined) return kontoFel("ej_inloggad");
  const parsed = NyttLosenordInSchema.safeParse(arObjekt(data));
  if (!parsed.success) return kontoFel("svagt_losenord");

  const { accessToken, refreshToken } = lasSessionCookies(b.kallor);
  if (refreshToken === undefined) return kontoFel("ej_inloggad");

  const medMarke = await harGiltigtAterstallningsmarke(b.kallor, b.hemlighet, konto.authUserId);
  if (!medMarke) {
    if (parsed.data.nuvarandeLosenord === undefined) return kontoFel("kraver_nuvarande_losenord");
    const fel = await verifieraLosenord(b, konto.epost, parsed.data.nuvarandeLosenord);
    if (fel !== null) return fel;
  }

  const r = await b.auth.uppdateraLosenord(
    { accessToken: accessToken ?? "", refreshToken },
    parsed.data.losenord,
  );
  if (!r.ok) {
    switch (r.orsak) {
      case "svagt_losenord":
        return kontoFel("svagt_losenord");
      case "ogiltig_token":
        return kontoFel("ej_inloggad");
      case "kvot":
        return kontoFel("kvot");
      default:
        console.warn(`[auth] uppdateraLosenord misslyckades (${r.orsak})`);
        return kontoFel("unknown");
    }
  }
  if (r.session !== null) sattSessionCookies(b.kallor, r.session);
  rensaAterstallningsmarke(b.kallor);
  // A changed password must end every OTHER session (a stolen one included).
  const aktuellToken = r.session?.accessToken ?? accessToken;
  if (aktuellToken !== undefined) await b.auth.loggaUtAndraSessioner(aktuellToken);
  return { ok: true };
}

/**
 * GDPR erasure of the whole account: the principal (and the device principals
 * merged into it) with its analys links, saved items and device quota rows
 * (`radera_principal`), then the Auth user, then the cookies. The register
 * (rapport, forening, PDFs) is never touched. The data goes first on purpose:
 * if deleting the Auth user fails the person can retry, whereas the reverse
 * order could leave personal data behind with no owner to ask for it.
 * Requires the account password (a stolen session cookie must not suffice).
 */
export async function raderaKonto(b: KontoBeroenden, data: unknown): Promise<RaderaKontoSvar> {
  const { konto, principalId } = b.kontext;
  if (konto === undefined || principalId === null) return kontoFel("ej_inloggad");
  const parsed = RaderaSchema.safeParse(arObjekt(data));
  if (!parsed.success) return kontoFel("ogiltig_inloggning");
  const fel = await verifieraLosenord(b, konto.epost, parsed.data.losenord);
  if (fel !== null) return fel;
  try {
    await b.db.raderaPrincipal(principalId);
    await b.auth.raderaAnvandare(konto.authUserId);
  } finally {
    rensaSessionCookies(b.kallor);
    rensaAterstallningsmarke(b.kallor);
    rensaSparaMarke(b.kallor);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Production wiring (called from analysFn.ts handlers, never at module scope)
// ---------------------------------------------------------------------------

/** The session dependencies, or undefined when `PROJECT_PUBLISHABLE_KEY` is
 *  not set — the app then simply has no accounts. */
export function skapaSessionBeroenden(env: Env): SessionBeroenden | undefined {
  if (env.supabasePublishableKey === undefined) return undefined;
  return { auth: skapaAuthPort(env), db: skapaKontoDatabas(env) };
}

/** `losKontext` with the session part wired. Drop-in for `kontextFor` in
 *  analysFn.ts: anonymous behaviour is unchanged when the key is missing. */
export async function kontextMedSession(
  env: Env,
  kallor: KontextKallor = tanstackKontextKallor(),
): Promise<Kontext> {
  const session = skapaSessionBeroenden(env);
  return losKontext({
    kallor,
    hemlighet: env.supabaseSecretKey,
    ...(session ? { session } : {}),
  });
}

/** Everything an account handler needs, with ONE cookie object for the whole
 *  request. Throws `KontoEjKonfigureratError` without the publishable key. */
export async function skapaKontoBeroenden(env: Env): Promise<KontoBeroenden> {
  if (env.supabasePublishableKey === undefined) throw new KontoEjKonfigureratError();
  const kallor = tanstackKontextKallor();
  const auth = skapaAuthPort(env);
  const db = skapaKontoDatabas(env);
  const kontext = await losKontext({
    kallor,
    hemlighet: env.supabaseSecretKey,
    session: { auth, db },
  });
  return { kallor, kontext, auth, db, hemlighet: env.supabaseSecretKey };
}
