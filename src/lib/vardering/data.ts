/**
 * Loads + Zod-validates the generated data files (src/lib/vardering/data/).
 * Server-only module — never import from a client route (see index.ts).
 */
import modelDataRaw from "./data/model.data";
import manifestRaw from "./data/manifest.data";
import generalModelRaw from "./data/generalModel.data";
import postcodeDeltaRaw from "./data/postcodeDelta.data";
import postnummerOmradeRaw from "./data/postnummerOmrade.data";
import kommunRaw from "./data/kommun.data";
import prisnivaRaw from "./data/prisniva.data";
import budpremieRaw from "./data/budpremie.data";
import effectsRaw from "./data/effects.data";
import { avkodaPostnummerLista } from "./kommunKodning";
import {
  BudpremieDataSchema,
  EffectsDataSchema,
  GeneralModelDataSchema,
  KommunDataSchema,
  ManifestSchema,
  ModelDataSchema,
  PostcodeDeltaSchema,
  PostnummerOmradeSchema,
  PrisnivaDataSchema,
  type FeatureManifest,
} from "./types";

export const modelData = ModelDataSchema.parse(modelDataRaw);
export const manifest = ManifestSchema.parse(manifestRaw);
export const generalModel = GeneralModelDataSchema.parse(generalModelRaw);
export const postcodeDelta = PostcodeDeltaSchema.parse(postcodeDeltaRaw);
export const postnummerOmrade = PostnummerOmradeSchema.parse(postnummerOmradeRaw);
export const prisnivaData = PrisnivaDataSchema.parse(prisnivaRaw);
export const budpremieData = BudpremieDataSchema.parse(budpremieRaw);
export const effectsData = EffectsDataSchema.parse(effectsRaw);

// ---------------------------------------------------------------------------
// postnummer -> kommun, decoded once at import time.
// ---------------------------------------------------------------------------

const kommunCompact = KommunDataSchema.parse(kommunRaw);

/** kommun code (4 digits) -> name. */
export const kommunNamn: Readonly<Record<string, string>> = kommunCompact.kommuner;

/** 5-digit postnummer -> kommun code. */
export const kommunForPostnummer: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [kod, kodad] of Object.entries(kommunCompact.postnummer)) {
    for (const pn of avkodaPostnummerLista(kodad)) {
      if (map.has(pn)) throw new Error(`Vardering: postnummer ${pn} appears under two kommuner`);
      map.set(pn, kod);
    }
  }
  return map;
})();

/** 3-digit postnummer prefix -> the kommun code that most postnummer with
 *  that prefix belong to. Ties go to the lower kommun code, so the result is
 *  deterministic. Used for a postnummer the kommun map does not know. */
export const dominerandeKommunPerPrefix: ReadonlyMap<string, string> = (() => {
  const raknare = new Map<string, Map<string, number>>();
  for (const [pn, kod] of kommunForPostnummer) {
    const prefix = pn.slice(0, 3);
    const perKommun = raknare.get(prefix) ?? new Map<string, number>();
    perKommun.set(kod, (perKommun.get(kod) ?? 0) + 1);
    raknare.set(prefix, perKommun);
  }
  const ut = new Map<string, string>();
  for (const [prefix, perKommun] of raknare) {
    const [basta] = [...perKommun.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    if (basta) ut.set(prefix, basta[0]);
  }
  return ut;
})();

/**
 * features.ts hardcodes the numeric / missing-indicator / categorical feature
 * names for readability instead of driving purely off the manifest lists.
 * This check makes that safe: if a future data regeneration ever changes
 * the underlying model's feature set, this throws loudly at import time
 * instead of silently building a wrong feature vector — "visible failure is
 * fine".
 */
const EXPECTED_MISSING_INDICATOR_FEATURES = [
  "apartment_floor_missing",
  "build_year_missing",
  "monthly_fee_missing",
];
const EXPECTED_BASE_NUMERIC = [
  "living_area",
  "number_of_rooms",
  "apartment_floor_clean",
  "build_year_clean",
  "fee_per_sqm",
];

function assertManifestShape(
  label: string,
  m: FeatureManifest,
  expectedNumeric: string[],
  expectedCategorical: string[],
): void {
  const checks: Array<[string, string[], string[]]> = [
    ["numericFeatures", m.numericFeatures, expectedNumeric],
    ["missingIndicatorFeatures", m.missingIndicatorFeatures, EXPECTED_MISSING_INDICATOR_FEATURES],
    ["categoricalFeatures", m.categoricalFeatures, expectedCategorical],
  ];
  for (const [name, actual, expected] of checks) {
    const same = actual.length === expected.length && actual.every((v, i) => v === expected[i]);
    if (!same) {
      throw new Error(
        `Vardering: ${label}.${name} = ${JSON.stringify(actual)} no longer matches what ` +
          `features.ts expects (${JSON.stringify(expected)}). Update features.ts's ` +
          `handling to match, then update this check.`,
      );
    }
  }
}

assertManifestShape(
  "manifest",
  manifest,
  [...EXPECTED_BASE_NUMERIC, "postcode_delta"],
  ["omrade", "elevator_clean", "balcony_clean"],
);
assertManifestShape("generalModel", generalModel, EXPECTED_BASE_NUMERIC, [
  "elevator_clean",
  "balcony_clean",
]);

if (!manifest.categoricalCategories["omrade"]?.includes(manifest.unmappedOmradeCategory)) {
  throw new Error(
    `Vardering: manifest.unmappedOmradeCategory ("${manifest.unmappedOmradeCategory}") is not one of ` +
      `manifest.categoricalCategories['omrade'] — the unmapped-postnummer fallback category is wrong.`,
  );
}

// Every kommun in Stockholms län except Stockholm itself needs a published
// price level, or the 'lan' tier could not be computed for it.
for (const kod of Object.keys(kommunNamn)) {
  if (kod.startsWith("01") && kod !== "0180" && !(kod in prisnivaData.kommuner)) {
    throw new Error(`Vardering: kommun ${kod} (${kommunNamn[kod]}) has no entry in prisniva data`);
  }
}
