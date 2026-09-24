/**
 * Shared types + Zod schemas for the offline valuation module (task 4f).
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
import type { Tristate } from "@/types/analysis";

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

export const ManifestSchema = z.object({
  modelVersion: z.string(),
  /** e.g. "2026-01-01 to 2026-08-31 (8 months)" — kept as the human string
   *  metadata.json uses, plus the parsed ISO bounds for Dataperiod. */
  dataPeriodLabel: z.string(),
  dataPeriod: z.object({ fran: z.string(), till: z.string() }),
  /** metadata.json -> n_rows_used_for_training. */
  trainingN: z.number().int().positive(),

  featureOrder: z.array(z.string()),
  numericFeatures: z.array(z.string()),
  missingIndicatorFeatures: z.array(z.string()),
  categoricalFeatures: z.array(z.string()),
  numericMedians: z.record(z.string(), z.number()),
  categoricalFillValues: z.record(z.string(), z.string()),
  categoricalCategories: z.record(z.string(), z.array(z.string())),
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

  /** metadata.json -> cv_results.lightgbm.overall.mape (RESTRICTED feature
   *  set, the shipped model; see report for exactly which key). */
  mapeOverallPercent: z.number().nonnegative(),
  /** metadata.json -> cv_results.lightgbm.per_area[*].mape. */
  mapePerAreaPercent: z.record(z.string(), z.number().nonnegative()),
});
export type Manifest = z.infer<typeof ManifestSchema>;

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
  /** The area the postnummer maps to; null = unmapped, Stockholm-wide model. */
  omrade: string | null;
  modellVersion: string;
  dataperiod: { fran: string; till: string };
  /** Rows the shipped model was trained on (overall, not per-area). */
  antalForsaljningar: number;
  /** Nominal target coverage of `intervall`, percent (e.g. 90). */
  intervallTackningProcent: number;
  /** Typical error (5-fold CV MAPE, percent) for this area, or overall when
   *  omrade is null / has no per-area figure. */
  typisktFelProcent: number;
}
