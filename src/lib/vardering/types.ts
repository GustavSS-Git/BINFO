/**
 * Shared types + Zod schemas for the offline valuation module (task 4f;
 * extended with the regional / national coverage on top of valuation-v3).
 *
 * Server-only: this module (and everything under src/lib/vardering/) is
 * meant to run in a Cloudflare Worker / Supabase Edge Function, never in the
 * browser. It must not be imported from any client route.
 *
 * Zod validates every generated data file at import time. The data files
 * are produced by scripts/buildVarderingData.ts from ml/artifacts/ and
 * data/derived/, which we trust to be internally consistent, but validating
 * their shape here catches a stale/partial regeneration loudly instead of
 * producing silently wrong predictions — "visible failure is fine".
 */
import { z } from "zod";
import type { Prisniva, Tristate, VarderingsTackning } from "@/types/analysis";

export type { Tristate };

// ---------------------------------------------------------------------------
// Compact LightGBM tree representation
// ---------------------------------------------------------------------------

/**
 * One LightGBM tree flattened into parallel arrays, pre-order indexed
 * (root is always index 0). For node i:
 *   - feature[i] === -1  -> leaf node, value[i] is the leaf's contribution.
 *   - feature[i] >= 0     -> internal node, split on feature index
 *     feature[i] with `x[feature[i]] <= value[i]` (LightGBM's only decision
 *     type in this artefact — see below). left[i]/right[i] are child node
 *     indices into the same arrays.
 *
 * missingType/defaultLeft are carried per-node (not just once for the whole
 * model) so the walker implements LightGBM's general per-split missing-value
 * semantics, even though the shipped model.json happens to have identical
 * values everywhere (verified at build time — see model.data.ts's header
 * comment and tree.ts).
 *   missingType: 0 = "None", 1 = "Zero", 2 = "NaN" (LightGBM's own dump_model
 *   missing_type values, encoded as small ints instead of strings for size).
 *   defaultLeft: 1 = true, 0 = false.
 */
export const TreeArraysSchema = z.object({
  feature: z.array(z.number().int()),
  value: z.array(z.number()),
  left: z.array(z.number().int()),
  right: z.array(z.number().int()),
  missingType: z.array(z.union([z.literal(0), z.literal(1), z.literal(2)])),
  defaultLeft: z.array(z.union([z.literal(0), z.literal(1)])),
});
export type TreeArrays = z.infer<typeof TreeArraysSchema>;

export const ModelDataSchema = z.object({
  /** Matches metadata.json's "version" (e.g. "valuation-v2"). */
  version: z.string(),
  nTrees: z.number().int().positive(),
  trees: z.array(TreeArraysSchema),
});
export type ModelData = z.infer<typeof ModelDataSchema>;

// ---------------------------------------------------------------------------
// Preprocessing manifest
// ---------------------------------------------------------------------------

/** The preprocessing recipe shared by the Stockholm and the general model:
 *  what features.ts needs to build a booster input vector. */
export const FeatureManifestSchema = z.object({
  featureOrder: z.array(z.string()),
  numericFeatures: z.array(z.string()),
  missingIndicatorFeatures: z.array(z.string()),
  categoricalFeatures: z.array(z.string()),
  numericMedians: z.record(z.string(), z.number()),
  categoricalFillValues: z.record(z.string(), z.string()),
  categoricalCategories: z.record(z.string(), z.array(z.string())),
});
export type FeatureManifest = z.infer<typeof FeatureManifestSchema>;

export const ManifestSchema = FeatureManifestSchema.extend({
  modelVersion: z.string(),
  /** e.g. "2026-01-01 to 2026-08-31 (8 months)" — kept as the human string
   *  metadata.json uses, plus the parsed ISO bounds for Dataperiod. */
  dataPeriodLabel: z.string(),
  dataPeriod: z.object({ fran: z.string(), till: z.string() }),
  /** metadata.json -> n_rows. */
  trainingN: z.number().int().positive(),

  /** The literal omrade category label unmapped/missing postnummer were
   *  filled with during training (ml/train_valuation.py load_data():
   *  `cleaned["omrade"].fillna("Okänt (postnummer ej kartlagt)")`). Used to
   *  encode the omrade feature for a null (unmapped) omrade — see
   *  features.ts's omradeCategoryForFeature(). */
  unmappedOmradeCategory: z.string(),

  /** metadata.json -> production_model.smearing_factor. NOT the same as
   *  conformal_interval_evaluation.smearing_factor (that one belongs to the
   *  Jan-May-only model fit for interval calibration, not the shipped
   *  all-data production model). */
  smearingFactor: z.number().positive(),

  /** metadata.json -> conformal_interval_evaluation.target_coverage * 100. */
  targetCoveragePercent: z.number().positive(),
  /** metadata.json -> conformal_interval_evaluation.q_overall_log. */
  qOverallLog: z.number().nonnegative(),
  /** metadata.json -> conformal_interval_evaluation.q_per_area_log. Includes
   *  an "Okänt (postnummer ej kartlagt)" entry too, which we deliberately do
   *  not look up — unmapped/null omrade goes straight to qOverallLog. */
  qPerAreaLog: z.record(z.string(), z.number().nonnegative()),

  /** metadata.json -> final_model.cv.mape (5-fold CV, the shipped model). */
  mapeOverallPercent: z.number().nonnegative(),
  /** metadata.json -> final_model.cv.per_area[*].mape. */
  mapePerAreaPercent: z.record(z.string(), z.number().nonnegative()),
});
export type Manifest = z.infer<typeof ManifestSchema>;

/** general_model.json: the r(x) model (trees + recipe + constants). */
export const GeneralModelDataSchema = ModelDataSchema.merge(FeatureManifestSchema).extend({
  dataPeriodLabel: z.string(),
  dataPeriod: z.object({ fran: z.string(), till: z.string() }),
  /** Rows the r(x) booster was trained on (general_model.json r_inference). */
  trainingN: z.number().int().positive(),
  smearingFactor: z.number().positive(),
  normaliser: z.number().positive(),
  clipMin: z.number().positive(),
  clipMax: z.number().positive(),
  targetCoveragePercent: z.number().positive(),
  /** metadata.json -> regional_method.q_regional_log. */
  qRegionalLog: z.number().nonnegative(),
  /** metadata.json -> regional_method.simulation_cv_with_fee.mape — a LOWER
   *  BOUND on the error outside the training area. */
  mapeRegionalPercent: z.number().nonnegative(),
});
export type GeneralModelData = z.infer<typeof GeneralModelDataSchema>;

/**
 * postcode_encoding.json (valuation-v3.1): `table` = postnummer with at least
 * one training sale -> postcode_delta; a postnummer not in `table` gets
 * `prefixTable[first prefixLength digits]` if present (the shrunk delta of the
 * neighbouring postnummer), else `fallback`.
 */
export const PostcodeDeltaSchema = z.object({
  fallback: z.literal(0),
  prefixLength: z.number().int().positive(),
  prefixTable: z.record(z.string(), z.number()),
  table: z.record(z.string(), z.number()),
});
export type PostcodeDeltaData = z.infer<typeof PostcodeDeltaSchema>;

/** postnummer_kommun.csv, compact (see kommunKodning.ts). */
export const KommunDataSchema = z.object({
  /** kommun code (4 digits) -> name. */
  kommuner: z.record(z.string().regex(/^\d{4}$/), z.string()),
  /** kommun code -> delta-coded base-36 postnummer list. */
  postnummer: z.record(z.string().regex(/^\d{4}$/), z.string()),
});
export type KommunData = z.infer<typeof KommunDataSchema>;

const PrisnivaPunktSchema = z.object({
  krPerM2: z.number().positive(),
  period: z.object({ fran: z.string(), till: z.string() }),
});

/** regional_prisniva.json, compact: published average kr/m² per kommun + riket. */
export const PrisnivaDataSchema = z.object({
  kalla: z.string(),
  kommuner: z.record(z.string(), PrisnivaPunktSchema.extend({ namn: z.string() })),
  riket: PrisnivaPunktSchema.extend({ namn: z.string() }),
});
export type PrisnivaData = z.infer<typeof PrisnivaDataSchema>;

// ---------------------------------------------------------------------------
// postnummer -> omrade map
// ---------------------------------------------------------------------------

export const PostnummerOmradeSchema = z.record(z.string(), z.string());
export type PostnummerOmradeMap = z.infer<typeof PostnummerOmradeSchema>;

// ---------------------------------------------------------------------------
// Budpremie table
// ---------------------------------------------------------------------------

export const BudpremieAreaSchema = z.object({
  medianProcent: z.number(),
  medelProcent: z.number(),
  n: z.number().int().nonnegative(),
  fallbackToOverall: z.boolean(),
});

export const BudpremieDataSchema = z.object({
  period: z.object({ fran: z.string(), till: z.string() }),
  overall: z.object({
    medianProcent: z.number(),
    medelProcent: z.number(),
    n: z.number().int().nonnegative(),
  }),
  areas: z.record(z.string(), BudpremieAreaSchema),
});
export type BudpremieData = z.infer<typeof BudpremieDataSchema>;

// ---------------------------------------------------------------------------
// Valuation drivers (effects.json)
// ---------------------------------------------------------------------------

export const EffectSchema = z.object({
  id: z.string(),
  labelSv: z.string(),
  effektProcent: z.number(),
  ciLowProcent: z.number(),
  ciHighProcent: z.number(),
  niva: z.enum(["stad", "omrade"]),
  omrade: z.string().nullable(),
  n: z.number().int().nonnegative(),
  signifikant: z.boolean(),
});
export type Effect = z.infer<typeof EffectSchema>;

export const EffectsDataSchema = z.object({
  modelVersion: z.string(),
  dataPeriod: z.object({ fran: z.string(), till: z.string() }),
  /** ml/artifacts/valuation-v2/effects.json -> caveat_sv, verbatim. Exported
   *  so the UI can show it next to the drivers list. */
  caveatSv: z.string(),
  referenceCategories: z.object({ hiss: z.string(), balkong: z.string() }),
  effects: z.array(EffectSchema),
});
export type EffectsData = z.infer<typeof EffectsDataSchema>;

// ---------------------------------------------------------------------------
// Public input/output types
// ---------------------------------------------------------------------------

/**
 * Deviates from the brief's illustrative signature in one place:
 * `manadsavgift` is optional here, not required. The shipped model was
 * trained with a `monthly_fee_missing` indicator and parity_fixtures.json
 * (fixture index 16) exercises a null manadsavgift — making it required
 * would make that fixture unrepresentable and break the stated correctness
 * criterion (50/50 parity). Flagged in the handback report.
 */
export interface VarderingInput {
  postnummer: string;
  boarea: number;
  antalRum: number;
  manadsavgift?: number;
  vaning?: number;
  byggar?: number;
  hiss: Tristate;
  balkong: Tristate;
}

export interface VarderingResultat {
  /** Integer SEK — total predicted price. */
  varde: number;
  /** Integer SEK bounds — the conformal prediction interval. */
  intervall: { low: number; high: number };
  /** Integer SEK per m² (living area). */
  prisPerM2: number;
  /** Which method produced the estimate (see VarderingsTackning). */
  tackning: VarderingsTackning;
  /** The Stockholm area the postnummer maps to; null = Stockholm-wide model
   *  (unmapped postnummer in Stockholms kommun) or not in Stockholms kommun. */
  omrade: string | null;
  /** The kommun the postnummer resolves to; null = could not be resolved. */
  kommun: string | null;
  /** The published average kr/m² the estimate is scaled to; only for
   *  'lan' (kommun average) and 'utanfor_lan' (national average). */
  prisniva?: Prisniva;
  modellVersion: string;
  dataperiod: { fran: string; till: string };
  /** Rows the model used was trained on (overall, not per-area). */
  antalForsaljningar: number;
  /** Nominal target coverage of `intervall`, percent (e.g. 90). */
  intervallTackningProcent: number;
  /** Typical error (MAPE, percent): 'stockholm' = 5-fold CV for the area (or
   *  overall when omrade is null); 'lan'/'utanfor_lan' = the SIMULATED
   *  regional MAPE, a lower bound on the true error. */
  typisktFelProcent: number;
}
