/**
 * Feature vector construction — mirrors ml/train_valuation_v3.py's RESTRICTED
 * feature pipeline (make_preprocessor()) for the five/six numeric features,
 * three missing indicators and the one-hot categorical groups, for BOTH the
 * Stockholm area model (with omrade + postcode_delta) and the general r(x)
 * model (neither). Pure, no I/O.
 *
 * The names below are hardcoded (rather than driving purely off the manifest
 * lists) for readability; the assertManifestShape() check in data.ts
 * cross-checks them against the loaded manifests at import time and throws
 * if a regenerated manifest ever disagrees, so this file can't silently
 * drift out of sync.
 */
import type { FeatureManifest, Manifest, Tristate, VarderingInput } from "./types";

interface NumericFeatures {
  living_area: number;
  number_of_rooms: number;
  apartment_floor_clean: number;
  build_year_clean: number;
  fee_per_sqm: number;
  postcode_delta: number;
}

/** Inputs that are not part of VarderingInput itself. */
export interface FeatureKontext {
  /** The one-hot omrade category (see omradeCategoryForFeature). Required by
   *  the Stockholm model, ignored by the general model. */
  omradeKategori?: string;
  /** postcode_delta (Stockholm model only); 0 = unseen postnummer. */
  postcodeDelta?: number;
}

function median(manifest: FeatureManifest, feature: keyof NumericFeatures): number {
  const value = manifest.numericMedians[feature];
  if (value === undefined) {
    throw new Error(`Vardering: manifest has no median for numeric feature "${feature}"`);
  }
  return value;
}

/**
 * Builds the raw (pre-imputation) numeric feature values plus the three
 * missing indicators.
 *
 * fee_per_sqm is computed ONCE from the raw manadsavgift/boarea, exactly
 * mirroring `fee_per_sqm = monthly_fee_clean / living_area` in load_data().
 * When manadsavgift is missing, fee_per_sqm is NaN here too and is imputed
 * with its own column median further down (never "imputed fee / boarea").
 * monthly_fee_clean itself is NOT a model feature in valuation-v3.
 */
function raknaRaFeatures(
  input: VarderingInput,
  postcodeDelta: number,
): {
  numeric: NumericFeatures;
  apartmentFloorMissing: 0 | 1;
  buildYearMissing: 0 | 1;
  monthlyFeeMissing: 0 | 1;
} {
  const apartmentFloorMissing: 0 | 1 = input.vaning === undefined ? 1 : 0;
  const buildYearMissing: 0 | 1 = input.byggar === undefined ? 1 : 0;
  const monthlyFeeMissing: 0 | 1 = input.manadsavgift === undefined ? 1 : 0;

  const feePerSqm = input.manadsavgift === undefined ? NaN : input.manadsavgift / input.boarea;

  return {
    numeric: {
      living_area: input.boarea,
      number_of_rooms: input.antalRum,
      apartment_floor_clean: input.vaning ?? NaN,
      build_year_clean: input.byggar ?? NaN,
      fee_per_sqm: feePerSqm,
      postcode_delta: postcodeDelta,
    },
    apartmentFloorMissing,
    buildYearMissing,
    monthlyFeeMissing,
  };
}

function imputeNumeric(manifest: FeatureManifest, numeric: NumericFeatures): NumericFeatures {
  const out = { ...numeric };
  for (const key of Object.keys(out) as (keyof NumericFeatures)[]) {
    // postcode_delta is never missing (unseen -> 0), and the general model
    // has no such column — only impute what is actually NaN.
    if (Number.isNaN(out[key])) {
      out[key] = median(manifest, key);
    }
  }
  return out;
}

function oneHot(
  categories: readonly string[] | undefined,
  value: string,
  featureName: string,
): number[] {
  if (!categories) {
    throw new Error(`Vardering: manifest has no categories for "${featureName}"`);
  }
  return categories.map((c) => (c === value ? 1 : 0));
}

/**
 * The categorical value the omrade feature is encoded with. An unmapped
 * postnummer (omrade === null) is encoded as the training pipeline's own
 * "Okänt (postnummer ej kartlagt)" fallback category (Python:
 * `cleaned["omrade"] = cleaned["omrade"].fillna("Okänt (postnummer ej kartlagt)")`
 * in load_data()) — NOT left as a genuinely novel/unknown category. This is
 * deliberately a different fallback than the *display* fallback used by
 * budpremie.ts / vardera.ts's typisktFelProcent / interval q, which use the
 * plain Stockholm-wide overall figures instead of this tiny, noisy "Okänt"
 * bucket's own numbers — see manifest.unmappedOmradeCategory's doc comment.
 */
export function omradeCategoryForFeature(omrade: string | null, manifest: Manifest): string {
  return omrade ?? manifest.unmappedOmradeCategory;
}

/** Builds the full, ordered feature vector (manifest.featureOrder length)
 *  ready to feed straight into tree.ts's predictRaw(). */
export function byggFeatures(
  input: VarderingInput,
  manifest: FeatureManifest,
  kontext: FeatureKontext = {},
): number[] {
  const raw = raknaRaFeatures(input, kontext.postcodeDelta ?? 0);
  const numeric = imputeNumeric(manifest, raw.numeric);

  const indicatorValues: Record<string, number> = {
    apartment_floor_missing: raw.apartmentFloorMissing,
    build_year_missing: raw.buildYearMissing,
    monthly_fee_missing: raw.monthlyFeeMissing,
  };

  const omradeCategories = manifest.categoricalCategories["omrade"];
  let omradeOneHot: number[] = [];
  if (omradeCategories !== undefined) {
    if (kontext.omradeKategori === undefined) {
      throw new Error("Vardering: the model needs an omrade category but none was given");
    }
    omradeOneHot = oneHot(omradeCategories, kontext.omradeKategori, "omrade");
  }
  const elevatorOneHot = oneHot(
    manifest.categoricalCategories["elevator_clean"],
    input.hiss,
    "elevator_clean",
  );
  const balconyOneHot = oneHot(
    manifest.categoricalCategories["balcony_clean"],
    input.balkong,
    "balcony_clean",
  );

  const x: number[] = [];
  let omradeCursor = 0;
  let elevatorCursor = 0;
  let balconyCursor = 0;

  for (const col of manifest.featureOrder) {
    if (col.startsWith("num__")) {
      const feat = col.slice("num__".length) as keyof NumericFeatures;
      const v = numeric[feat];
      if (v === undefined) {
        throw new Error(`Vardering: unrecognised numeric feature column "${col}"`);
      }
      x.push(v);
    } else if (col.startsWith("ind__")) {
      const feat = col.slice("ind__".length);
      const v = indicatorValues[feat];
      if (v === undefined) {
        throw new Error(`Vardering: unrecognised missing-indicator column "${col}"`);
      }
      x.push(v);
    } else if (col.startsWith("cat__omrade_")) {
      const v = omradeOneHot[omradeCursor];
      if (v === undefined)
        throw new Error(`Vardering: omrade one-hot ran out of columns at "${col}"`);
      x.push(v);
      omradeCursor += 1;
    } else if (col.startsWith("cat__elevator_clean_")) {
      const v = elevatorOneHot[elevatorCursor];
      if (v === undefined)
        throw new Error(`Vardering: elevator one-hot ran out of columns at "${col}"`);
      x.push(v);
      elevatorCursor += 1;
    } else if (col.startsWith("cat__balcony_clean_")) {
      const v = balconyOneHot[balconyCursor];
      if (v === undefined)
        throw new Error(`Vardering: balcony one-hot ran out of columns at "${col}"`);
      x.push(v);
      balconyCursor += 1;
    } else {
      throw new Error(`Vardering: unrecognised feature column "${col}"`);
    }
  }

  // Every feature value must be a finite number by now: byggFeatures fully
  // imputes and one-hot-encodes before this point, so tree.ts's walker
  // should never see a NaN in practice for these models (see tree.ts's header
  // comment on the missing-value routing it implements defensively anyway).
  const nanIdx = x.findIndex((v) => Number.isNaN(v));
  if (nanIdx !== -1) {
    throw new Error(`Vardering: internal error — feature vector has NaN at index ${nanIdx}`);
  }

  return x;
}

// Re-export for callers that only need the Tristate-typed hiss/balkong
// fields without pulling in the rest of VarderingInput.
export type { Tristate };
