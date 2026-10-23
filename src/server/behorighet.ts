/**
 * Entitlements ("behörighet"): may this requester use this capability?
 *
 * ONE policy table in code (`STANDARD_POLICY`). Today every capability is
 * granted to everyone — Binfo has no accounts and no payment yet. Each server
 * function checks exactly once, at its top, so changing who may do what
 * later is a change to this table only.
 *
 * Future per-analysis payment: put it on `ladda_upp_analys`. `skapaAnalys` and
 * `skapaAnalysFranRegister` (src/server/analys.ts) both check it first, via
 * `provaBehorighet`, before anything is uploaded, quota-charged or paid for,
 * so a buyer pays before the analysis runs (or is re-used from the register).
 * `full_rapport` stays the read-access hook (`hamtaResultat`, keyed on the
 * row's `rapportId`): there is no free preview any more, so do not gate the
 * result behind it as the only paywall. A purchase would be a `behorighet`
 * row (table created by supabase/migrations/20261009120100_konto.sql, empty
 * today) with kalla 'kop' and the `rapport_id`, plus one policy line here, e.g.
 *   ladda_upp_analys: ({ kontext }) => harBetaltForAnalys(kontext)
 *
 * `se_registeranalys` gates the stored FULL BRF-level analysis of one year in
 * the public register (`hamtaRegisterAnalysFn` → `hamtaRegisteranalys`,
 * `/brf/$slug/analys/$ar`; the public summary on `/brf/$slug` is not gated).
 * Putting it behind an account or a payment later is a change of its one
 * policy line below, e.g. `se_registeranalys: ({ kontext }) => kontext.konto !== undefined`
 * for logged-in users (the `behorighet.formaga` column is free text, no
 * check constraint, so a row for it needs no migration either).
 *
 * A rule that throws is NOT treated as a grant: the error propagates (fail
 * closed).
 */

import type { Kontext } from "./kontext";

export type Formaga =
  "prisuppskattning" | "ladda_upp_analys" | "full_rapport" | "pdf_export" | "se_registeranalys";

export const ALLA_FORMAGOR: readonly Formaga[] = [
  "prisuppskattning",
  "ladda_upp_analys",
  "full_rapport",
  "pdf_export",
  "se_registeranalys",
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
  // The stored full register analysis: open to all today. An account or
  // payment requirement is a change of this one line (see the file comment).
  se_registeranalys: allaFar,
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
