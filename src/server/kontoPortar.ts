/**
 * Storage port for the account-ready layer (workstream 4): principals,
 * rate-limit counters, and the GDPR delete/export paths; v3 adds the account
 * principal, saved valuations / kalkyler and the account's analysis list.
 *
 * Deliberately separate from `Lager`/`Databas` in `./portar.ts` so this layer
 * can land without touching the job orchestration's port. Production code
 * talks to `./supabaseKonto.ts`; tests talk to `./__fakes__/konto.ts`. Both
 * implement this interface and mirror the SQL in
 * `supabase/migrations/20261009120100_konto.sql` and
 * `supabase/migrations/20261013120000_konto_v3.sql`.
 *
 * Also holds the `AuthPort` (Supabase Auth, server-side only): the interface
 * `./auth.ts` and `./kontext.ts` are written against, implemented by
 * `./supabaseAuth.ts` and `./__fakes__/auth.ts`.
 *
 * Interfaces only — no implementation lives in this file.
 */

import type { PrisInput, PrisuppskattningResultat, PropertyInput } from "@/types/analysis";

export type PrincipalTyp = "anonym" | "konto";

/** One row of the `principal` table — an anonymous device today, an account
 *  later. */
export interface PrincipalRad {
  id: string;
  typ: PrincipalTyp;
  enhetId: string | null;
  authUserId: string | null;
  skapad: string;
  senastSedd: string;
  sammanslagenTill: string | null;
}

/** The subset of an `analys` row a GDPR export hands back to the person. */
export interface ExporteradAnalys {
  id: string;
  createdAt: string;
  propertyInput: PropertyInput;
  rapportId: string | null;
}

/** A saved valuation as exported (GDPR): everything the person stored. */
export interface ExporteradVardering {
  id: string;
  etikett: string | null;
  skapad: string;
  modellVersion: string;
  input: unknown;
  resultat: unknown;
}

/** A saved kalkyl as exported (GDPR). */
export interface ExporteradKalkyl {
  id: string;
  etikett: string | null;
  skapad: string;
  uppdaterad: string;
  regelversion: string;
  input: unknown;
  sammanfattning: unknown;
}

export interface PrincipalExport {
  /** The requested principal plus every principal merged into it. */
  principaler: Array<Pick<PrincipalRad, "id" | "typ" | "skapad" | "senastSedd">>;
  analyser: ExporteradAnalys[];
  sparadeVarderingar: ExporteradVardering[];
  sparadeKalkyler: ExporteradKalkyl[];
}

/** Row counts removed by `raderaPrincipal` — returned so the CLI can print
 *  what actually happened rather than claim success blindly. */
export interface RaderingsResultat {
  principaler: number;
  analyser: number;
  behorigheter: number;
  kvotrader: number;
  sparadeVarderingar: number;
  sparadeKalkyler: number;
}

// ---------------------------------------------------------------------------
// v3: account principal, saved items, the account's analysis list
// ---------------------------------------------------------------------------

/** Result of `sakerstallKontoPrincipal`. */
export interface KontoPrincipalUtfall {
  principalId: string;
  /** True iff this call merged the device's anonymous principal into the
   *  account (happens at most once per device). */
  sammanslagen: boolean;
}

export interface NySparadVardering {
  principalId: string;
  etikett: string | null;
  input: PrisInput;
  resultat: PrisuppskattningResultat;
  modellVersion: string;
}

/** One `sparad_vardering` row. jsonb columns are `unknown` here: the service
 *  layer parses them with the current schemas before serving. */
export interface SparadVarderingRad {
  id: string;
  principalId: string;
  etikett: string | null;
  input: unknown;
  resultat: unknown;
  modellVersion: string;
  skapad: string;
}

/** List view of a saved valuation: no snapshot, only the valuation figure
 *  (`resultat.prisanalys.externVardering`) pulled out of it. */
export interface SparadVarderingListrad {
  id: string;
  principalId: string;
  etikett: string | null;
  input: unknown;
  externVardering: unknown;
  modellVersion: string;
  skapad: string;
}

export interface NySparadKalkyl {
  principalId: string;
  etikett: string | null;
  input: unknown;
  sammanfattning: unknown;
  regelversion: string;
}

export interface SparadKalkylRad {
  id: string;
  principalId: string;
  etikett: string | null;
  input: unknown;
  sammanfattning: unknown;
  regelversion: string;
  skapad: string;
  uppdaterad: string;
}

/** What `uppdateraSparadKalkyl` may change. */
export interface SparadKalkylDelta {
  etikett: string | null;
  input: unknown;
  sammanfattning: unknown;
  regelversion: string;
}

/** One row of `lista_mina_analyser`: an analys joined to its rapport/forening
 *  for the profile list. No big jsonb — `betyg` is pulled out of the judgement
 *  in SQL. */
export interface AnalysListrad {
  analysId: string;
  skapad: string;
  /** rapport.status for v2 rows, analys.status for legacy rows. */
  status: string;
  stage: string;
  errorCode: string | null;
  orgnr: string | null;
  foreningNamn: string | null;
  rakenskapsar: number | null;
  betyg: string | null;
  /** Null once retention has blanked it. */
  adress: string | null;
  utgangspris: number | null;
}

export interface KontoDatabas {
  /** Wraps `sakerstall_principal`: insert-or-touch the anonymous principal
   *  for this device id (`senast_sedd = now()`), returning the principal id
   *  to attribute work to. If the device principal has been merged into
   *  another one, that target's id is returned instead. Idempotent. */
  sakerstallPrincipal(enhetId: string): Promise<string>;

  hamtaPrincipal(id: string): Promise<PrincipalRad | null>;

  /** Wraps `sla_samman_principal`: atomically points `fran` (and anything
   *  already merged into `fran`) at `till`, and moves `fran`'s `analys`,
   *  `behorighet` and saved-item rows to `till`. Throws when either id is
   *  unknown, when they are equal, or when `till` is itself merged into
   *  something else. */
  slaSammanPrincipal(fran: string, till: string): Promise<void>;

  /** Wraps `ta_kvot`: atomically count one use of `nyckel` in the current
   *  fixed window of `fonsterSek` seconds. True iff the count after the
   *  increment is ≤ `max`; a refused call does NOT consume quota. */
  taKvot(nyckel: string, fonsterSek: number, max: number): Promise<boolean>;

  /** Wraps `aterlamna_kvot`: give back one use taken by `taKvot` in the
   *  current window (never below zero). Used when a later check in the same
   *  request refuses, so the earlier key isn't charged for nothing. */
  aterlamnaKvot(nyckel: string, fonsterSek: number): Promise<void>;

  /** Wraps `radera_principal` (GDPR erasure). Deletes the principal, every
   *  principal merged into it, their `analys` rows, `behorighet` rows, saved
   *  valuations / kalkyler and device-keyed `kvot` rows. Register data is
   *  untouched. Unknown id → all-zero counts. */
  raderaPrincipal(id: string): Promise<RaderingsResultat>;

  /** GDPR access/portability: the principal (plus merged ones), its `analys`
   *  rows and saved items. Unknown id → null. */
  exporteraPrincipal(id: string): Promise<PrincipalExport | null>;

  // -------------------------------------------------------------------------
  // v3 (supabase/migrations/20261013120000_konto_v3.sql)
  // -------------------------------------------------------------------------

  /** Wraps `sakerstall_konto_principal`: the `typ = 'konto'` principal of a
   *  Supabase Auth user (created on first call, race-safe). With `enhetId`,
   *  that device's anonymous principal is merged into the account if it
   *  exists and is not merged anywhere yet — once per device, never moved to
   *  a second account. */
  sakerstallKontoPrincipal(
    authUserId: string,
    enhetId: string | null,
  ): Promise<KontoPrincipalUtfall>;

  // Saved valuations. Every read/update/delete takes the owner's principalId
  // and matches it in the same statement: another principal's id finds nothing.
  skapaSparadVardering(rad: NySparadVardering): Promise<SparadVarderingRad>;
  listaSparadeVarderingar(principalId: string): Promise<SparadVarderingListrad[]>;
  hamtaSparadVardering(id: string, principalId: string): Promise<SparadVarderingRad | null>;
  /** True iff a row of this principal was deleted. */
  raderaSparadVardering(id: string, principalId: string): Promise<boolean>;
  raknaSparadeVarderingar(principalId: string): Promise<number>;

  // Saved kalkyler.
  skapaSparadKalkyl(rad: NySparadKalkyl): Promise<SparadKalkylRad>;
  /** Null when the principal has no such row (nothing changed). */
  uppdateraSparadKalkyl(
    id: string,
    principalId: string,
    delta: SparadKalkylDelta,
  ): Promise<SparadKalkylRad | null>;
  listaSparadeKalkyler(principalId: string): Promise<SparadKalkylRad[]>;
  hamtaSparadKalkyl(id: string, principalId: string): Promise<SparadKalkylRad | null>;
  raderaSparadKalkyl(id: string, principalId: string): Promise<boolean>;
  raknaSparadeKalkyler(principalId: string): Promise<number>;

  /** Wraps `lista_mina_analyser`: the principal's analys rows, newest first. */
  listaAnalyser(principalId: string): Promise<AnalysListrad[]>;
  /** Wraps `radera_min_analys`: deletes the principal's OWN analys row through
   *  `radera_analys` (the rapport and register are untouched). `borttagen` is
   *  false when the principal has no such row. */
  raderaAnalysFranLista(
    principalId: string,
    analysId: string,
  ): Promise<{ borttagen: boolean; pdfBlevForlorad: boolean }>;
}

// ---------------------------------------------------------------------------
// Supabase Auth (server-side only)
// ---------------------------------------------------------------------------

/** The two tokens kept in the httpOnly session cookies. */
export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires, as issued. */
  expiresIn: number;
}

export interface AuthAnvandare {
  id: string;
  epost: string;
}

/** `verifyOtp` types the email links can carry. */
export type AuthOtpTyp = "signup" | "recovery" | "email_change";

/** Why an Auth call failed — already reduced to what we act on. */
export type AuthFelOrsak =
  | "ogiltig_inloggning"
  | "ej_bekraftad"
  | "svagt_losenord"
  | "ogiltig_epost"
  /** Expired, used or unknown token / session / refresh token. */
  | "ogiltig_token"
  | "kvot"
  /** Auth unreachable or 5xx: do not treat the session as invalid. */
  | "tillfalligt"
  | "annat";

export type AuthResultat<T = unknown> = ({ ok: true } & T) | { ok: false; orsak: AuthFelOrsak };

export type TokenKontroll =
  { status: "ok"; anvandare: AuthAnvandare } | { status: "ogiltig" } | { status: "fel" };

export interface AuthPort {
  /** `signUp`. With email confirmations on, GoTrue answers an already
   *  registered address exactly like a new one (no error, no session), which
   *  is what makes the sign-up response enumeration-safe. */
  registrera(epost: string, losenord: string): Promise<AuthResultat>;
  loggaIn(
    epost: string,
    losenord: string,
  ): Promise<AuthResultat<{ session: AuthSession; anvandare: AuthAnvandare }>>;
  /** `verifyOtp({ token_hash, type })` — the email-link flow. */
  bekrafta(
    tokenHash: string,
    typ: AuthOtpTyp,
  ): Promise<AuthResultat<{ session: AuthSession; anvandare: AuthAnvandare }>>;
  /** `resetPasswordForEmail`. */
  begarAterstallning(epost: string): Promise<AuthResultat>;
  /** `getUser(jwt)` with the secret key: validates signature, expiry and
   *  that the session still exists. */
  valideraAccessToken(accessToken: string): Promise<TokenKontroll>;
  /** `refreshSession` — rotates the refresh token. */
  fornyaSession(
    refreshToken: string,
  ): Promise<AuthResultat<{ session: AuthSession; anvandare: AuthAnvandare }>>;
  /** `updateUser({ password })` through the user's own session. `session` is
   *  non-null when the tokens had to be refreshed first and must replace the
   *  cookies. */
  uppdateraLosenord(
    tokens: { accessToken: string; refreshToken: string },
    nyttLosenord: string,
  ): Promise<AuthResultat<{ session: AuthSession | null }>>;
  /** Ends the session of this access token (best effort; never throws). */
  loggaUt(accessToken: string): Promise<void>;
  /** `auth.admin.signOut(jwt, 'others')`: ends every session of this token's
   *  user EXCEPT the one the token belongs to (best effort; never throws).
   *  Called after a password change. */
  loggaUtAndraSessioner(accessToken: string): Promise<void>;
  /** `auth.admin.deleteUser`. Throws on failure. */
  raderaAnvandare(userId: string): Promise<void>;
}
