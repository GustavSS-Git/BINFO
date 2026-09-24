/**
 * Feature vector construction — mirrors ml/train_valuation.py's RESTRICTED
 * feature pipeline (load_data() + make_preprocessor()) exactly, for the six
 * numeric features, three missing indicators and three one-hot categorical
 * groups that pipeline uses. Pure, no I/O.
 *
 * The six numeric / three indicator / three categorical names below are
 * hardcoded (rather than driven purely off manifest.numericFeatures etc.)
 * for readability; assertManifestShape() in data.ts cross-checks them
 * against the loaded manifest at import time and throws if a regenerated
 * manifest ever disagrees, so this file can't silently drift out of sync.
 */
import type { Manifest, Tristate, VarderingInput } from "./types";

interface NumericFeatures {
  living_area: number;
  number_of_rooms: number;
  apartment_floor_clean: number;
  build_year_clean: number;
  monthly_fee_clean: number;
  fee_per_sqm: number;
}

function median(manifest: Manifest, feature: keyof NumericFeatures): number {
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
 * fee_per_sqm is the one detail worth calling out: it is computed ONCE from
 * the raw manadsavgift/boarea, exactly mirroring
 * `cleaned["fee_per_sqm"] = cleaned["monthly_fee_clean"] / cleaned["living_area"]`
 * in load_data() — a single column built before any imputation happens. When
 * manadsavgift is missing, fee_per_sqm is NaN here too, and is imputed with
 * its OWN column median further down (see byggFeatures below), completely
 * independently of monthly_fee_clean's median. It is never recomputed as
 * "imputed monthly fee / boarea" — that would not match what the model was
 * trained on (sklearn's ColumnTransformer imputes monthly_fee_clean and
 * fee_per_sqm as two unrelated numeric columns).
 */
function raknaRaFeatures(input: VarderingInput): {
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
      monthly_fee_clean: input.manadsavgift ?? NaN,
      fee_per_sqm: feePerSqm,
    },
    apartmentFloorMissing,
    buildYearMissing,
    monthlyFeeMissing,
  };
}

function imputeNumeric(manifest: Manifest, numeric: NumericFeatures): NumericFeatures {
  const out = { ...numeric };
  for (const key of Object.keys(out) as (keyof NumericFeatures)[]) {
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
  omrade: string | null,
  manifest: Manifest,
): number[] {
  const raw = raknaRaFeatures(input);
  const numeric = imputeNumeric(manifest, raw.numeric);
  const omradeCategory = omradeCategoryForFeature(omrade, manifest);

  const indicatorValues: Record<string, number> = {
    apartment_floor_missing: raw.apartmentFloorMissing,
    build_year_missing: raw.buildYearMissing,
    monthly_fee_missing: raw.monthlyFeeMissing,
  };

  const omradeOneHot = oneHot(manifest.categoricalCategories["omrade"], omradeCategory, "omrade");
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
  // should never see a NaN in practice for this model (see tree.ts's header
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
