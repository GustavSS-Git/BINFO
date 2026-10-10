/**
 * Storage port for the account-ready layer (workstream 4): principals,
 * rate-limit counters, and the GDPR delete/export paths.
 *
 * Deliberately separate from `Lager`/`Databas` in `./portar.ts` so this layer
 * can land without touching the job orchestration's port. Production code
 * talks to `./supabaseKonto.ts`; tests talk to `./__fakes__/konto.ts`. Both
 * implement this interface and mirror the SQL in
 * `supabase/migrations/20261009120100_konto.sql`.
 *
 * Interfaces only — no implementation lives in this file.
 */

import type { PropertyInput } from "@/types/analysis";

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

export interface PrincipalExport {
  /** The requested principal plus every principal merged into it. */
  principaler: Array<Pick<PrincipalRad, "id" | "typ" | "skapad" | "senastSedd">>;
  analyser: ExporteradAnalys[];
}

/** Row counts removed by `raderaPrincipal` — returned so the CLI can print
 *  what actually happened rather than claim success blindly. */
export interface RaderingsResultat {
  principaler: number;
  analyser: number;
  behorigheter: number;
  kvotrader: number;
}

export interface KontoDatabas {
  /** Wraps `sakerstall_principal`: insert-or-touch the anonymous principal
   *  for this device id (`senast_sedd = now()`), returning the principal id
   *  to attribute work to. If the device principal has been merged into
   *  another one, that target's id is returned instead. Idempotent. */
  sakerstallPrincipal(enhetId: string): Promise<string>;

  hamtaPrincipal(id: string): Promise<PrincipalRad | null>;

  /** Wraps `sla_samman_principal`: atomically points `fran` (and anything
   *  already merged into `fran`) at `till`, and moves `fran`'s `analys` and
   *  `behorighet` rows to `till`. Throws when either id is unknown, when they
   *  are equal, or when `till` is itself merged into something else. */
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
   *  principal merged into it, their `analys` rows, `behorighet` rows and
   *  device-keyed `kvot` rows. Register data is untouched. Unknown id →
   *  all-zero counts. */
  raderaPrincipal(id: string): Promise<RaderingsResultat>;

  /** GDPR access/portability: the principal (plus merged ones) and its
   *  `analys` rows. Unknown id → null. */
  exporteraPrincipal(id: string): Promise<PrincipalExport | null>;
}
