/**
 * Every assumption behind the expected fee rise and its price effect, in ONE
 * place (round 2026-10-24b; docs/avgiftsprognos.md). Change a value here and
 * nowhere else. Values marked "TODO: unverified placeholder" are owner-chosen
 * product assumptions (the "moderate set", 2026-10-24), not market facts.
 */
import type { Byggdel, Referensranta } from "@/types/analysis";

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

/** Probability (as a share of the rent) that the income disappears when a lease
 *  ends within the horizon (from the balance date to the horizon end) and the
 *  report says nothing about renewal or a replacement tenant. Owner decision
 *  2026-10-25 (compromise): a lease end alone is a coin flip, not a certainty. */
// TODO: unverified placeholder (owner default 2026-10-24, meaning changed 2026-10-25)
export const LOKALHYRA_RISKANDEL = 0.5;

/** Share of a lokal rent that is subtracted when the report itself says the
 *  rent WILL fall away (a `forlustsignal`: terminated lease, tenant leaving,
 *  vacant premises, insolvent tenant, rent dispute or reduction). Source:
 *  owner decision 2026-10-25. */
export const LOKALHYRA_ANDEL_VID_FORLUSTSIGNAL = 1;

/** Widening of the price range's LOW end per component without data, as a
 *  share of the baseline. Missing data never lowers the point estimate. */
// TODO: unverified placeholder (owner default 2026-10-24)
export const BREDDNING_PER_SAKNAT_UNDERLAG = 0.03;

/** A total rise above this share of today's fee is still applied but marked
 *  osäker and turned into a question (guards against a misread report). */
// TODO: unverified placeholder (product guard, 2026-10-24)
export const MAX_RIMLIG_HOJNING_ANDEL = 0.3;

/** A report whose balance date is older than this, counted from the read, is
 *  too stale to price refinancing from: loans that reset before today have
 *  most likely been refinanced at an unknown rate and are left out. Loans
 *  whose reset date is still ahead keep the report's rate and are priced
 *  (owner 2026-10-25); with none, the component counts as missing data. */
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

// ---------------------------------------------------------------------------
// Sustainable fee: savings target (round 2026-10-24c, docs/underhall-referens.md)
// ---------------------------------------------------------------------------

/**
 * Savings target when the förening states no plan-based need, kr/m² totalyta
 * per year. HSB, Sveriges Bostadsrättsbarometer 2026: "Saknas en underhålls-
 * och investeringsplan kan styrelsen utgå från ett schabloniserat sparande på
 * 300 kr/kvm/år"; Riksbyggen (April 2025): 305 kr/kvm. Sources in
 * docs/underhall-referens.md §2. Labelled "Schablon" in the UI.
 */
export const SPARMAL_SCHABLON_KR_PER_M2 = 300;

/** The building parts move the schablon within the range the sources span
 *  (Nabo/HSB 250–300, Swedbank 350 per boyta; docs/underhall-referens.md §2d). */
export const SPARMAL_SCHABLON_MIN = 250;
export const SPARMAL_SCHABLON_MAX = 350;

/** Share of a schablon-based gap (or surplus) that counts in the fee prognosis
 *  (owner decision 2026-10-24: cautious when the target is not the förening's
 *  own). A plan-based gap counts in full. */
// TODO: unverified placeholder (owner decision 2026-10-24)
export const SPARMAL_SCHABLON_DAMPNING = 0.5;

/**
 * Typical lifetime per tracked building part, years (lag–hog across the
 * sources' variants). FAR "Komponentindelning i bostadsrättsförening"
 * (2025-06-25) and SIB M84:10 (1984); docs/underhall-referens.md §1a.
 * A part is 'nyligen' when last done less than half of `lag` ago and
 * 'eftersatt' when last done (or built, never mentioned) more than `hog` ago.
 */
export const BYGGDEL_LIVSLANGD: Record<Byggdel, { label: string; lag: number; hog: number }> = {
  // FAR 50, M84:10 50, Lusa 40–60 (cast iron)
  stambyte: { label: "Stambyte", lag: 40, hog: 60 },
  // papp 20–30, tegel 30–40, plåt 35–60
  tak: { label: "Tak", lag: 20, hog: 60 },
  // puts 20–40, trä 40, tegel 100
  fasad: { label: "Fasad", lag: 20, hog: 100 },
  // M84:10 40; FAR 40 (trä/plast), 60 (aluminiumbeklätt)
  fonster: { label: "Fönster", lag: 40, hog: 60 },
  // FAR: FTX/FT 20, självdrag 100
  ventilation: { label: "Ventilation", lag: 20, hog: 100 },
  // FAR 50, M84:10 45
  el: { label: "El", lag: 45, hog: 50 },
  // FAR 20–40, Hissförbundet 20–30
  hiss: { label: "Hiss", lag: 20, hog: 40 },
};

/** A plan-based savings target below this share of the schablon is taken to
 *  cover only part of the plan (e.g. "underhållsbehov" without the large
 *  investments) and is not used; the schablon applies instead. Measured case:
 *  Helsingborgshus 17, 777 tkr/year ≈ 46 kr/m² totalyta (2026-10-24). */
// TODO: unverified placeholder (round 2026-10-24c)
export const PLANMAL_MIN_ANDEL_AV_SCHABLON = 0.5;

/** A plan-based target above this multiple of the schablon is treated as a
 *  misread (e.g. one project counted as a yearly need) and not used. */
// TODO: unverified placeholder (review 2026-10-24c)
export const PLANMAL_MAX_ANDEL_AV_SCHABLON = 2;

/** Planned costs are averaged over at least this many years, so a few items
 *  clustered in time never count as a yearly need. */
// TODO: unverified placeholder (review 2026-10-24c)
export const PLANKOSTNAD_MIN_AR = 10;

/** The plan-cost target averages planned costs over at most this many years
 *  when a plan item has no year span. */
// TODO: unverified placeholder (round 2026-10-24c)
export const PLANKOSTNAD_MAX_AR = 30;

// ---------------------------------------------------------------------------
// Refinancing, later phase (round 2026-10-24c)
// ---------------------------------------------------------------------------

/** End of the later refinancing phase, months. Loans resetting between
 *  HORISONT_MANADER and this count only when cheaper than the new rate. */
// TODO: unverified placeholder (owner decision 2026-10-24)
export const HORISONT_LANG_MANADER = 60;

/** Weight per maturity band of the later phase: [up to month, weight].
 *  Owner decision 2026-10-24. */
// TODO: unverified placeholder (owner decision 2026-10-24)
export const SENARE_FAS_VIKTER: ReadonlyArray<readonly [number, number]> = [
  [36, 0.75],
  [48, 0.5],
  [60, 0.25],
];

// ---------------------------------------------------------------------------
// Fee pressure colour (round 2026-10-24c)
// ---------------------------------------------------------------------------

/** |kr/month| ÷ today's fee: below GUL = green, up to ROD = yellow, above =
 *  red. A decrease is always green. Owner decision 2026-10-24. */
// TODO: unverified placeholder (owner decision 2026-10-24)
export const TRYCK_GRANS_GUL = 0.02;
// TODO: unverified placeholder (owner decision 2026-10-24)
export const TRYCK_GRANS_ROD = 0.1;

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
