/**
 * Client-safe types for the account server functions (v3, docs/PLAN-v3.md §1):
 * what `registreraKontoFn`, `loggaInFn`, `hamtaSessionFn`, `listaSparatFn` and
 * the rest of the account/saved-item functions in `src/server/analysFn.ts`
 * return. Type-only: nothing here may import from `src/server/` (client code
 * imports this file) and nothing here has a runtime value except the small
 * pure constants below.
 *
 * Every account function returns a `KontoSvar`: `{ ok: true, ... }` or
 * `{ ok: false, felKod, meddelande }`. `meddelande` is Swedish and
 * buyer-safe — show it verbatim. `felKod` is for branching (redirect to log
 * in on `ej_inloggad`, "hittades inte" page on `hittades_inte`, …). An
 * unexpected failure is thrown by the server function (generic Swedish
 * message, see `sakertFel` in `src/server/fel.ts`), not returned.
 */

import type { Grade, PrisInput, PrisuppskattningResultat } from "@/types/analysis";
import type { KalkylSammanfattning, KalkylUnderlag } from "@/lib/kalkyl/underlag";

/** Minimum password length (owner/PLAN-v3 §1.2). The server enforces it;
 *  the form may use it for early feedback. */
export const MIN_LOSENORD_TECKEN = 10;

/** Longest label a saved valuation / kalkyl can carry. */
export const MAX_ETIKETT_TECKEN = 120;

export type KontoFelKod =
  /** Not a plausible email address. */
  | "ogiltig_epost"
  /** Too short (< 10), too long (> 72 bytes), or rejected as weak/leaked. */
  | "svagt_losenord"
  /** Wrong email or password (deliberately not telling which). */
  | "ogiltig_inloggning"
  /** Changing the password needs the current one (no fresh recovery link). */
  | "kraver_nuvarande_losenord"
  /** Right password, but the email address is not verified yet. */
  | "epost_ej_bekraftad"
  /** Email link expired, already used or malformed. */
  | "ogiltig_lank"
  /** Rate limit ("För många försök, vänta en stund."). */
  | "kvot"
  /** The call needs a session and there is none. */
  | "ej_inloggad"
  /** No such item for THIS account (also: someone else's, or a bad id). */
  | "hittades_inte"
  /** Input failed validation (malformed saved calculation, bad label, …). */
  | "ogiltig_indata"
  /** The account has reached the per-kind cap of saved items. */
  | "for_manga_sparade"
  /** Accounts are not configured on this deployment. */
  | "konto_ej_konfigurerat"
  | "unknown";

export interface KontoFel {
  ok: false;
  felKod: KontoFelKod;
  /** Swedish, safe to show the user verbatim. */
  meddelande: string;
}

export type KontoSvar<T = unknown> = ({ ok: true } & T) | KontoFel;

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export type SessionSvar =
  { inloggad: false } | { inloggad: true; epost: string; principalId: string };

export type RegistreraKontoSvar = KontoSvar;

export type LoggaInSvar = KontoSvar<{ epost: string; principalId: string }>;

export type LoggaUtSvar = KontoSvar;

/** Always `{ ok: true }` unless rate-limited — never says whether the address
 *  exists. */
export type BegarAterstallningSvar = KontoSvar;

export type EpostLankTyp = "signup" | "recovery" | "email_change";

/** The token link verified and the user is now logged in (cookies set).
 *  `typ === 'recovery'` → send the user to `/konto/nytt-losenord`. */
export type BekraftaEpostSvar = KontoSvar<{
  typ: EpostLankTyp;
  epost: string;
  principalId: string;
}>;

export type SattNyttLosenordSvar = KontoSvar;

/** `nuvarandeLosenord` may be omitted only right after a recovery link
 *  (server-side marker cookie, 15 min); otherwise it is required. */
export interface SattNyttLosenordIndata {
  losenord: string;
  nuvarandeLosenord?: string;
}

/** Deleting the account re-authenticates with the password. */
export interface RaderaKontoIndata {
  losenord: string;
}

// ---------------------------------------------------------------------------
// Saved items and the profile lists
// ---------------------------------------------------------------------------

/** A BRF analysis in the account's list. */
export interface AnalysPost {
  analysisId: string;
  /** ISO 8601. */
  skapad: string;
  /** pagar = queued/running; klar = done; misslyckad = failed. */
  status: "pagar" | "klar" | "misslyckad";
  foreningNamn: string | null;
  orgnr: string | null;
  rakenskapsar: number | null;
  /** Only for a finished analysis. */
  betyg: Grade | null;
  /** The buyer's own address; null once retention has blanked it (12 mo). */
  adress: string | null;
  utgangspris: number | null;
}

/** A saved valuation in the list (no snapshot). */
export interface SparadVarderingPost {
  id: string;
  etikett: string | null;
  /** ISO 8601. */
  skapad: string;
  modellVersion: string;
  /** Null when the stored input no longer parses with the current schema. */
  input: PrisInput | null;
  /** Binfo's valuation (`prisanalys.externVardering`) at save time, kr. */
  vardering: number | null;
  /** The prediction interval of that valuation, kr. */
  intervall: { low: number; high: number } | null;
}

/** A saved valuation, in full (for "Öppna"). */
export interface SparadVardering {
  id: string;
  etikett: string | null;
  skapad: string;
  modellVersion: string;
  /** Null when the stored input no longer parses with the current schema. */
  input: PrisInput | null;
  /** The snapshot. Null when it no longer parses with the current schema:
   *  `input` (if present) can still be re-valued with "Räkna om". */
  resultat: PrisuppskattningResultat | null;
}

/** A saved kalkyl in the list. */
export interface SparadKalkylPost {
  id: string;
  etikett: string | null;
  skapad: string;
  uppdaterad: string;
  regelversion: string;
  /** Null when the stored summary no longer parses. */
  sammanfattning: KalkylSammanfattning | null;
}

/** A saved kalkyl, in full. */
export interface SparadKalkyl extends SparadKalkylPost {
  /** Null when the stored state is from an unknown/older version: show an
   *  empty calculator plus a notice (see `tolkaKalkylUnderlag`). */
  underlag: KalkylUnderlag | null;
}

export type SparaVarderingSvar = KontoSvar<{ vardering: SparadVardering }>;
export type SparaKalkylSvar = KontoSvar<{ kalkyl: SparadKalkyl }>;
export type HamtaSparadVarderingSvar = KontoSvar<{ vardering: SparadVardering }>;
export type HamtaSparadKalkylSvar = KontoSvar<{ kalkyl: SparadKalkyl }>;
export type RaderaSparatSvar = KontoSvar;

export type ListaSparatSvar = KontoSvar<{
  analyser: AnalysPost[];
  varderingar: SparadVarderingPost[];
  kalkyler: SparadKalkylPost[];
}>;

/** "Ta bort från min lista": the report itself stays in the register. */
export type TaBortAnalysFranListaSvar = KontoSvar;

// ---------------------------------------------------------------------------
// GDPR
// ---------------------------------------------------------------------------

/** The JSON a user downloads ("Ladda ner mina uppgifter"). */
export interface MinaUppgifter {
  exporterad: string;
  konto: { epost: string; principalId: string };
  /** The account's principal plus the device principals merged into it. */
  principaler: Array<{ id: string; typ: "anonym" | "konto"; skapad: string; senastSedd: string }>;
  analyser: Array<{
    id: string;
    createdAt: string;
    rapportId: string | null;
    /** The buyer's own input (address, price, …) as stored. */
    propertyInput: unknown;
  }>;
  sparadeVarderingar: Array<{
    id: string;
    etikett: string | null;
    skapad: string;
    modellVersion: string;
    input: unknown;
    resultat: unknown;
  }>;
  sparadeKalkyler: Array<{
    id: string;
    etikett: string | null;
    skapad: string;
    uppdaterad: string;
    regelversion: string;
    input: unknown;
    sammanfattning: unknown;
  }>;
}

export type HamtaMinaUppgifterSvar = KontoSvar<{ uppgifter: MinaUppgifter }>;

export type RaderaKontoSvar = KontoSvar;
