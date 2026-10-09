/**
 * Entitlements ("behörighet"): may this requester use this capability?
 *
 * ONE policy table in code (`STANDARD_POLICY`). Today every capability is
 * granted to everyone — Binfo has no accounts and no payment yet. Each server
 * function checks exactly once, at its top, so changing who may do what
 * later is a change to this table only.
 *
 * Future per-analysis payment: a `behorighet` row (table created by
 * supabase/migrations/20261009120100_konto.sql, empty today) with
 * kalla 'kop' and the `rapport_id`, plus one policy line here, e.g.
 *   full_rapport: ({ kontext, rapportId }) => harKoptRapport(kontext, rapportId)
 *
 * A rule that throws is NOT treated as a grant: the error propagates (fail
 * closed).
 */

import type { Kontext } from "./kontext";

export type Formaga = "prisuppskattning" | "ladda_upp_analys" | "full_rapport" | "pdf_export";

export const ALLA_FORMAGOR: readonly Formaga[] = [
  "prisuppskattning",
  "ladda_upp_analys",
  "full_rapport",
  "pdf_export",
];

export interface BehorighetsFraga {
  kontext: Kontext;
  formaga: Formaga;
  rapportId?: string;
}

export type Policyregel = (fraga: BehorighetsFraga) => boolean | Promise<boolean>;
export type Policy = Readonly<Record<Formaga, Policyregel>>;

const allaFar: Policyregel = () => true;

/** Today: everything granted to everyone. */
export const STANDARD_POLICY: Policy = {
  prisuppskattning: allaFar,
  ladda_upp_analys: allaFar,
  full_rapport: allaFar,
  pdf_export: allaFar,
};

/** Buyer-safe Swedish copy for a refused capability. */
export const SAKNAR_BEHORIGHET_MEDDELANDE = "Du har inte tillgång till den här funktionen just nu.";

export class SaknarBehorighetError extends Error {
  constructor(public readonly formaga: Formaga) {
    super(SAKNAR_BEHORIGHET_MEDDELANDE);
    this.name = "SaknarBehorighetError";
  }
}

export interface Behorighet {
  harBehorighet(
    kontext: Kontext,
    formaga: Formaga,
    opts?: { rapportId?: string },
  ): Promise<boolean>;
  /** Throws `SaknarBehorighetError` when not granted. */
  kravBehorighet(kontext: Kontext, formaga: Formaga, opts?: { rapportId?: string }): Promise<void>;
}

/** Binds the checks to a policy. Production uses `STANDARD_POLICY` (the
 *  exports below); tests inject a deny policy to prove a handler checks. */
export function skapaBehorighet(policy: Policy = STANDARD_POLICY): Behorighet {
  async function harBehorighet(
    kontext: Kontext,
    formaga: Formaga,
    opts: { rapportId?: string } = {},
  ): Promise<boolean> {
    const fraga: BehorighetsFraga = { kontext, formaga };
    if (opts.rapportId !== undefined) fraga.rapportId = opts.rapportId;
    return (await policy[formaga](fraga)) === true;
  }

  return {
    harBehorighet,
    async kravBehorighet(kontext, formaga, opts) {
      if (!(await harBehorighet(kontext, formaga, opts))) {
        throw new SaknarBehorighetError(formaga);
      }
    },
  };
}

const standard = skapaBehorighet();

export const harBehorighet = standard.harBehorighet;
export const kravBehorighet = standard.kravBehorighet;
