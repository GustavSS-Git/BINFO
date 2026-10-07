import { describe, expect, it } from "vitest";
import { byggFeatures, omradeCategoryForFeature } from "./features";
import { generalModel, manifest } from "./data";
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
    const x = byggFeatures(fullInput(), manifest, {
      omradeKategori: omradeCategoryForFeature("Kungsholmen", manifest),
    });
    expect(x).toHaveLength(manifest.featureOrder.length);
  });

  it("computes fee_per_sqm from the raw monthly fee / boarea when present", () => {
    const x = byggFeatures(fullInput(), manifest, {
      omradeKategori: omradeCategoryForFeature("Kungsholmen", manifest),
    });
    expect(x[indexOf("num__fee_per_sqm")]).toBeCloseTo(MANADSAVGIFT / BOAREA, 10);
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
    const x = byggFeatures(input, manifest, {
      omradeKategori: omradeCategoryForFeature("Kungsholmen", manifest),
    });
    expect(x[indexOf("num__apartment_floor_clean")]).toBe(
      manifest.numericMedians["apartment_floor_clean"],
    );
    expect(x[indexOf("num__build_year_clean")]).toBe(manifest.numericMedians["build_year_clean"]);
    expect(x[indexOf("ind__apartment_floor_missing")]).toBe(1);
    expect(x[indexOf("ind__build_year_missing")]).toBe(1);
  });

  it("median-imputes fee_per_sqm when manadsavgift is missing and sets the indicator", () => {
    const input: VarderingInput = {
      postnummer: POSTNUMMER,
      boarea: BOAREA,
      antalRum: ANTAL_RUM,
      vaning: VANING,
      byggar: BYGGAR,
      hiss: "ja",
      balkong: "nej",
    };
    const x = byggFeatures(input, manifest, { omradeKategori: "Kungsholmen" });
    expect(x[indexOf("num__fee_per_sqm")]).toBe(manifest.numericMedians["fee_per_sqm"]);
    expect(x[indexOf("ind__monthly_fee_missing")]).toBe(1);
  });

  it("monthly_fee_clean is no longer a model feature (valuation-v3)", () => {
    expect(manifest.featureOrder.some((c) => c.includes("monthly_fee_clean"))).toBe(false);
  });

  it("passes postcode_delta through, and defaults it to 0 (unseen postnummer)", () => {
    const med = byggFeatures(fullInput(), manifest, {
      omradeKategori: "Kungsholmen",
      postcodeDelta: 0.1234,
    });
    expect(med[indexOf("num__postcode_delta")]).toBe(0.1234);
    const utan = byggFeatures(fullInput(), manifest, { omradeKategori: "Kungsholmen" });
    expect(utan[indexOf("num__postcode_delta")]).toBe(0);
  });

  it("the Stockholm model refuses to build a vector without an omrade category", () => {
    expect(() => byggFeatures(fullInput(), manifest)).toThrow(/omrade/);
  });

  it("one-hot encodes hiss/balkong tristate values", () => {
    const x = byggFeatures(fullInput({ hiss: "nej", balkong: "okant" }), manifest, {
      omradeKategori: omradeCategoryForFeature("Kungsholmen", manifest),
    });
    expect(x[indexOf("cat__elevator_clean_ja")]).toBe(0);
    expect(x[indexOf("cat__elevator_clean_nej")]).toBe(1);
    expect(x[indexOf("cat__elevator_clean_okant")]).toBe(0);
    expect(x[indexOf("cat__balcony_clean_ja")]).toBe(0);
    expect(x[indexOf("cat__balcony_clean_nej")]).toBe(0);
    expect(x[indexOf("cat__balcony_clean_okant")]).toBe(1);
  });

  it("one-hot encodes a mapped omrade under its own category", () => {
    const x = byggFeatures(fullInput(), manifest, {
      omradeKategori: omradeCategoryForFeature("Södermalm", manifest),
    });
    expect(x[indexOf("cat__omrade_Södermalm")]).toBe(1);
    expect(x[indexOf("cat__omrade_Kungsholmen")]).toBe(0);
  });

  it("encodes a null (unmapped) omrade as the training pipeline's fallback category", () => {
    const x = byggFeatures(fullInput(), manifest, {
      omradeKategori: omradeCategoryForFeature(null, manifest),
    });
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
    const x = byggFeatures(input, manifest, {
      omradeKategori: omradeCategoryForFeature(null, manifest),
    });
    expect(x.some((v) => Number.isNaN(v))).toBe(false);
  });
});

describe("byggFeatures — general model (no omrade, no postcode_delta)", () => {
  it("has 14 features, none of them location", () => {
    const x = byggFeatures(fullInput(), generalModel);
    expect(x).toHaveLength(14);
    expect(generalModel.featureOrder.some((c) => /omrade|postcode/.test(c))).toBe(false);
  });

  it("ignores an omrade category / postcode_delta if one is supplied", () => {
    const a = byggFeatures(fullInput(), generalModel);
    const b = byggFeatures(fullInput(), generalModel, {
      omradeKategori: "Södermalm",
      postcodeDelta: 0.5,
    });
    expect(b).toEqual(a);
  });

  it("imputes with the general model's own medians", () => {
    const input: VarderingInput = {
      postnummer: "",
      boarea: 40,
      antalRum: NaN,
      hiss: "ja",
      balkong: "ja",
    };
    const x = byggFeatures(input, generalModel);
    const i = generalModel.featureOrder.indexOf("num__fee_per_sqm");
    expect(x[i]).toBe(generalModel.numericMedians["fee_per_sqm"]);
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
