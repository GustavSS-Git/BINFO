import { describe, expect, it } from "vitest";
import { byggFeatures, omradeCategoryForFeature } from "./features";
import { manifest } from "./data";
import type { VarderingInput } from "./types";

function indexOf(col: string): number {
  const i = manifest.featureOrder.indexOf(col);
  if (i === -1) throw new Error(`column "${col}" not found in manifest.featureOrder`);
  return i;
}

const POSTNUMMER = "11532";
const BOAREA = 50;
const ANTAL_RUM = 2;
const MANADSAVGIFT = 3000;
const VANING = 4;
const BYGGAR = 1990;

function fullInput(overrides: Partial<VarderingInput> = {}): VarderingInput {
  return {
    postnummer: POSTNUMMER,
    boarea: BOAREA,
    antalRum: ANTAL_RUM,
    manadsavgift: MANADSAVGIFT,
    vaning: VANING,
    byggar: BYGGAR,
    hiss: "ja",
    balkong: "nej",
    ...overrides,
  };
}

describe("byggFeatures", () => {
  it("produces a vector as long as manifest.featureOrder", () => {
    const x = byggFeatures(fullInput(), "Kungsholmen", manifest);
    expect(x).toHaveLength(manifest.featureOrder.length);
  });

  it("computes fee_per_sqm from the raw monthly fee / boarea when present", () => {
    const x = byggFeatures(fullInput(), "Kungsholmen", manifest);
    expect(x[indexOf("num__fee_per_sqm")]).toBeCloseTo(MANADSAVGIFT / BOAREA, 10);
    expect(x[indexOf("num__monthly_fee_clean")]).toBe(MANADSAVGIFT);
    expect(x[indexOf("ind__monthly_fee_missing")]).toBe(0);
  });

  it("median-imputes vaning/byggar when missing and sets their indicators", () => {
    const input: VarderingInput = {
      postnummer: POSTNUMMER,
      boarea: BOAREA,
      antalRum: ANTAL_RUM,
      manadsavgift: MANADSAVGIFT,
      hiss: "ja",
      balkong: "nej",
    };
    const x = byggFeatures(input, "Kungsholmen", manifest);
    expect(x[indexOf("num__apartment_floor_clean")]).toBe(
      manifest.numericMedians["apartment_floor_clean"],
    );
    expect(x[indexOf("num__build_year_clean")]).toBe(manifest.numericMedians["build_year_clean"]);
    expect(x[indexOf("ind__apartment_floor_missing")]).toBe(1);
    expect(x[indexOf("ind__build_year_missing")]).toBe(1);
  });

  it(
    "independently median-imputes fee_per_sqm when manadsavgift is missing " +
      "(never recomputed from the imputed monthly fee)",
    () => {
      const input: VarderingInput = {
        postnummer: POSTNUMMER,
        boarea: BOAREA,
        antalRum: ANTAL_RUM,
        vaning: VANING,
        byggar: BYGGAR,
        hiss: "ja",
        balkong: "nej",
      };
      const x = byggFeatures(input, "Kungsholmen", manifest);
      const monthlyFeeMedian = manifest.numericMedians["monthly_fee_clean"];
      const feePerSqmMedian = manifest.numericMedians["fee_per_sqm"];
      expect(monthlyFeeMedian).toBeDefined();
      expect(feePerSqmMedian).toBeDefined();
      expect(x[indexOf("num__monthly_fee_clean")]).toBe(monthlyFeeMedian);
      expect(x[indexOf("num__fee_per_sqm")]).toBe(feePerSqmMedian);
      // Not the (wrong) recomputed value:
      expect(x[indexOf("num__fee_per_sqm")]).not.toBeCloseTo(monthlyFeeMedian! / BOAREA, 2);
      expect(x[indexOf("ind__monthly_fee_missing")]).toBe(1);
    },
  );

  it("one-hot encodes hiss/balkong tristate values", () => {
    const x = byggFeatures(fullInput({ hiss: "nej", balkong: "okant" }), "Kungsholmen", manifest);
    expect(x[indexOf("cat__elevator_clean_ja")]).toBe(0);
    expect(x[indexOf("cat__elevator_clean_nej")]).toBe(1);
    expect(x[indexOf("cat__elevator_clean_okant")]).toBe(0);
    expect(x[indexOf("cat__balcony_clean_ja")]).toBe(0);
    expect(x[indexOf("cat__balcony_clean_nej")]).toBe(0);
    expect(x[indexOf("cat__balcony_clean_okant")]).toBe(1);
  });

  it("one-hot encodes a mapped omrade under its own category", () => {
    const x = byggFeatures(fullInput(), "Södermalm", manifest);
    expect(x[indexOf("cat__omrade_Södermalm")]).toBe(1);
    expect(x[indexOf("cat__omrade_Kungsholmen")]).toBe(0);
  });

  it("encodes a null (unmapped) omrade as the training pipeline's fallback category", () => {
    const x = byggFeatures(fullInput(), null, manifest);
    expect(x[indexOf(`cat__omrade_${manifest.unmappedOmradeCategory}`)]).toBe(1);
    expect(x[indexOf("cat__omrade_Kungsholmen")]).toBe(0);
  });

  it("never leaves a NaN in the output vector", () => {
    const input: VarderingInput = {
      postnummer: "11532",
      boarea: 40,
      antalRum: 1,
      hiss: "okant",
      balkong: "okant",
    };
    const x = byggFeatures(input, null, manifest);
    expect(x.some((v) => Number.isNaN(v))).toBe(false);
  });
});

describe("omradeCategoryForFeature", () => {
  it("returns the mapped omrade unchanged", () => {
    expect(omradeCategoryForFeature("Kungsholmen", manifest)).toBe("Kungsholmen");
  });

  it("returns the unmapped fallback category for null", () => {
    expect(omradeCategoryForFeature(null, manifest)).toBe(manifest.unmappedOmradeCategory);
  });
});
