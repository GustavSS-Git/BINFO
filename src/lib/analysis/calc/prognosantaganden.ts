/**
 * Every assumption behind the expected fee rise and its price effect, in ONE
 * place (round 2026-10-24b; docs/avgiftsprognos.md). Change a value here and
 * nowhere else. Values marked "TODO: unverified placeholder" are owner-chosen
 * product assumptions (the "moderate set", 2026-10-24), not market facts.
 */
import type { Referensranta } from "@/types/analysis";

/** How far ahead the prognosis looks, months. */
// TODO: unverified placeholder (owner default 2026-10-24)
export const HORISONT_MANADER = 24;

/** Share of total debt assumed to reprice within the horizon when the report
 *  gives no maturities. The price range covers 0–100 % around it. */
// TODO: unverified placeholder (owner default 2026-10-24)
export const REFINANSIERINGSANDEL_UTAN_FORFALL = 0.5;

/** Years an unfinanced maintenance or energy cost is spread over. */
// TODO: unverified placeholder (owner default 2026-10-24)
export const UNDERHALL_FORDELNING_AR = 10;

/** Share of lokal rent treated as at risk when a lease ends within the horizon. */
// TODO: unverified placeholder (owner default 2026-10-24)
export const LOKALHYRA_RISKANDEL = 0.5;

/** Widening of the price range's LOW end per component without data, as a
 *  share of the baseline. Missing data never lowers the point estimate. */
// TODO: unverified placeholder (owner default 2026-10-24)
export const BREDDNING_PER_SAKNAT_UNDERLAG = 0.03;

/** A total rise above this share of today's fee is still applied but marked
 *  osäker and turned into a question (guards against a misread report). */
// TODO: unverified placeholder (product guard, 2026-10-24)
export const MAX_RIMLIG_HOJNING_ANDEL = 0.3;

/** A report whose balance date is older than this, counted from the read, is
 *  too stale to price refinancing from: its loans have most likely been
 *  refinanced already and the fee adjusted. The component then counts as
 *  missing data (wider range, no effect on the price). */
// TODO: unverified placeholder (review 2026-10-24)
export const MAX_RAPPORTALDER_MANADER = 18;

/** A loan whose reset date is at most this many months after the balance
 *  date counts as variable-rate when the report doesn't say (a 3-month
 *  variable loan resets quarterly). Used for the margin in step zero and for
 *  `Lan.rantetyp`. */
export const RORLIG_MAX_MANADER_EFTER_BALANSDAG = 3;

/** A maturity known only by year (extractions before PROMPT_VERSION 9) is
 *  placed on this day of that year. */
export const DAG_FOR_FORFALLOAR = "07-01";

/**
 * The BRF's margin over the reference rate, percentage points. Measured
 * 2026-10-24 on the test reports: per-BRF median of variable loans' rate −
 * SSVX 3M on the balance-sheet date (5 BRFs, 8 loans; per-loan median 0.73).
 * See docs/avgiftsprognos.md for the table. Measured against SSVX, so it must
 * be re-measured if the reference series changes (e.g. to licensed STIBOR).
 */
export const BRF_MARGINAL_PROCENT = 0.58;

/** The reference rate series (Riksbank SWEA). STIBOR is not available: the
 *  Riksbank stopped publishing it in 2020 and SFBF's data needs a licence. */
export const REFERENSRANTA_SERIE = "SETB3MBENCH";
export const REFERENSRANTA_NAMN = "3-månaders statsskuldväxel";
export const REFERENSRANTA_KALLA = "Sveriges riksbank";

/** Used only when no fetched value exists at all; labelled as a fallback.
 *  SSVX 3M on 2026-10-23 per the Riksbank API. */
export const REFERENSRANTA_RESERV = { procent: 2.068, datum: "2026-10-23" } as const;

/**
 * The valuation model's fee coefficient: OLS companion of valuation-v3.1, on
 * log(kr/m²) per kr/m² of monthly fee (ml/artifacts/valuation-v3.1/metadata.json
 * `effects_fee_per_sqm.fee_per_sqm_per_kr_beta_log`, p = 1.9e-42, n = 4 991).
 * Flat-specific use: price change ≈ β × fee change (kr/mån) × price per m².
 * An association, not a causal effect (MODEL_CARD.md). A test keeps it in
 * sync with the artifact.
 */
export const AVGIFT_BETA_LOG_PER_KR_M2 = -0.0024470683054306232;

/** The configured fallback rate as a contract value, labelled `reserv: true`.
 *  Used when no fetched value exists (and by callers without a database). */
export function reservReferensranta(): Referensranta {
  return {
    namn: REFERENSRANTA_NAMN,
    serie: REFERENSRANTA_SERIE,
    datum: REFERENSRANTA_RESERV.datum,
    procent: REFERENSRANTA_RESERV.procent,
    kalla: REFERENSRANTA_KALLA,
    reserv: true,
  };
}
