/**
 * "Hämta uppgifter": fetch one listing page and normalise it (docs/booli.md).
 *
 * STUB (T1): implemented in T2b. Order of checks: kill switch
 * (`ANNONS_HAMTNING=off`) → URL check → 24 h cache (free) → entitlement
 * `hamta_annons` → quota → one fetch (10 s, no retry) → parse → postcode
 * fallback (geocoding) → optional LLM fallback (`ANNONS_LLM_FALLBACK=on`) →
 * cache. Every failure is returned as `{ ok: false }`, never thrown.
 */

import type { AnnonsSvar } from "@/lib/annons/typer";
import type { Env } from "../env";
import type { Anropare } from "../portar";

export interface HamtaAnnonsBeroenden {
  anropare: Anropare;
  env: Env;
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Injected in tests. */
  nu?: () => Date;
}

export async function hamtaAnnons(
  _data: unknown,
  _beroenden: HamtaAnnonsBeroenden,
): Promise<AnnonsSvar> {
  throw new Error("hamtaAnnons: not implemented (T2b)");
}
