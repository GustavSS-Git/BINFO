/**
 * Loads + Zod-validates the generated data files (src/lib/vardering/data/).
 * Server-only module — never import from a client route (see index.ts).
 */
import modelDataRaw from "./data/model.data";
import manifestRaw from "./data/manifest.data";
import postnummerOmradeRaw from "./data/postnummerOmrade.data";
import budpremieRaw from "./data/budpremie.data";
import effectsRaw from "./data/effects.data";
import {
  BudpremieDataSchema,
  EffectsDataSchema,
  ManifestSchema,
  ModelDataSchema,
  PostnummerOmradeSchema,
  type Manifest,
} from "./types";

export const modelData = ModelDataSchema.parse(modelDataRaw);
export const manifest = ManifestSchema.parse(manifestRaw);
export const postnummerOmrade = PostnummerOmradeSchema.parse(postnummerOmradeRaw);
export const budpremieData = BudpremieDataSchema.parse(budpremieRaw);
export const effectsData = EffectsDataSchema.parse(effectsRaw);

/**
 * features.ts hardcodes the six numeric / three missing-indicator / three
 * categorical feature names for readability instead of driving purely off
 * these manifest lists. This check makes that safe: if a future data
 * regeneration ever changes the underlying model's feature set, this throws
 * loudly at import time instead of silently building a wrong feature
 * vector — "visible failure is fine".
 */
const EXPECTED_NUMERIC_FEATURES = [
  "living_area",
  "number_of_rooms",
  "apartment_floor_clean",
  "build_year_clean",
  "monthly_fee_clean",
  "fee_per_sqm",
];
const EXPECTED_MISSING_INDICATOR_FEATURES = [
  "apartment_floor_missing",
  "build_year_missing",
  "monthly_fee_missing",
];
const EXPECTED_CATEGORICAL_FEATURES = ["omrade", "elevator_clean", "balcony_clean"];

function assertManifestShape(m: Manifest): void {
  const checks: Array<[string, string[], string[]]> = [
    ["numericFeatures", m.numericFeatures, EXPECTED_NUMERIC_FEATURES],
    ["missingIndicatorFeatures", m.missingIndicatorFeatures, EXPECTED_MISSING_INDICATOR_FEATURES],
    ["categoricalFeatures", m.categoricalFeatures, EXPECTED_CATEGORICAL_FEATURES],
  ];
  for (const [name, actual, expected] of checks) {
    const same = actual.length === expected.length && actual.every((v, i) => v === expected[i]);
    if (!same) {
      throw new Error(
        `Vardering: manifest.${name} = ${JSON.stringify(actual)} no longer matches what ` +
          `features.ts hardcodes (${JSON.stringify(expected)}). Update features.ts's ` +
          `NumericFeatures/indicatorValues/categorical handling to match, then update this check.`,
      );
    }
  }
  if (!m.categoricalCategories["omrade"]?.includes(m.unmappedOmradeCategory)) {
    throw new Error(
      `Vardering: manifest.unmappedOmradeCategory ("${m.unmappedOmradeCategory}") is not one of ` +
        `manifest.categoricalCategories['omrade'] — the unmapped-postnummer fallback category is wrong.`,
    );
  }
}

assertManifestShape(manifest);
