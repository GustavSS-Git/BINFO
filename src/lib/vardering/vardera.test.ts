import { describe, expect, it } from "vitest";
import { generalModel, manifest, postcodeDelta } from "./data";
import { beraknaR, postcodeDeltaFor, rFranLogG, vardera } from "./vardera";
import type { VarderingInput } from "./types";

/** general_parity_fixtures.json row 0 (hand-copied, so this test does not
 *  depend on the code under test): r = 0.9852905511695397, not clipped. */
const R_FIXTURE_0 = 0.9852905511695397;
const A_SOLNA = 64352; // regional_prisniva.json, kommun 0184, 12-month average
const A_HUDDINGE = 38544; // kommun 0126
const A_RIKET = 46317; // regional_prisniva.json riket (aug 2026)
const Q_REGIONAL = 0.27786389769737013; // metadata.json regional_method.q_regional_log
const MAPE_REGIONAL = 14.491262668723278; // simulation_cv_with_fee.mape

function input(postnummer: string, overrides: Partial<VarderingInput> = {}): VarderingInput {
  return {
    postnummer,
    boarea: 43,
    antalRum: 2,
    manadsavgift: 2895,
    vaning: 3,
    byggar: 1939,
    hiss: "nej",
    balkong: "ja",
    ...overrides,
  };
}

describe("rFranLogG — ratio arithmetic and clip", () => {
  const p = { smearingFactor: 1.02, normaliser: 1.0, clipMin: 0.5, clipMax: 1.5 };

  it("r = exp(g) * smearing / normaliser", () => {
    expect(rFranLogG(Math.log(0.5), { ...p, clipMin: 0.1 }).r).toBeCloseTo(0.51, 12);
    expect(rFranLogG(0, p).r).toBeCloseTo(1.02, 12);
    expect(rFranLogG(Math.log(1.2), { ...p, normaliser: 2 }).r).toBeCloseTo(0.612, 12);
  });

  it("clips to [clipMin, clipMax], and reports the unclipped value", () => {
    const lag = rFranLogG(Math.log(0.1), p);
    expect(lag.r).toBe(0.5);
    expect(lag.rOklippt).toBeCloseTo(0.102, 12);
    const hog = rFranLogG(Math.log(9), p);
    expect(hog.r).toBe(1.5);
    expect(hog.rOklippt).toBeCloseTo(9.18, 12);
  });

  it("uses the shipped constants (normaliser 1, smearing 1.013949..., clip 0.5029..1.4440...)", () => {
    expect(generalModel.normaliser).toBe(1);
    expect(generalModel.smearingFactor).toBeCloseTo(1.013949392503442, 12);
    expect(generalModel.clipMin).toBeCloseTo(0.5028831823466812, 12);
    expect(generalModel.clipMax).toBeCloseTo(1.4440045116105358, 12);
  });
});

describe("vardera — tier 'stockholm'", () => {
  it("uses the area model, labels the omrade and carries no price level", () => {
    const r = vardera(input("10004"));
    expect(r).not.toBeNull();
    expect(r).toMatchObject({
      tackning: "stockholm",
      omrade: "Kungsholmen",
      kommun: "Stockholm",
      modellVersion: "valuation-v3.1",
      antalForsaljningar: 4991,
      typisktFelProcent: manifest.mapePerAreaPercent["Kungsholmen"],
    });
    expect(r?.prisniva).toBeUndefined();
    expect(r && "prisniva" in r).toBe(false);
  });

  it("Stockholm-wide fallback (unmapped postnummer in the Stockholm kommun) has omrade null and the overall MAPE", () => {
    const r = vardera(input("10500"));
    expect(r).toMatchObject({ tackning: "stockholm", omrade: null, kommun: "Stockholm" });
    expect(r?.typisktFelProcent).toBe(manifest.mapeOverallPercent);
  });

  it("an unseen postnummer is valued without special treatment (no confidence change)", () => {
    const r = vardera(input("12364"));
    expect(r?.tackning).toBe("stockholm");
    expect(r?.varde).toBeGreaterThan(0);
  });

  it("postcode_delta: own delta if the postnummer has sales, else the 4-digit prefix delta, else 0 (valuation-v3.1)", () => {
    // 11122 has one training sale; 11121 has none but shares prefix 1112; 99999 / malformed have neither.
    expect(postcodeDelta.table["11122"]).toBeDefined();
    expect(postcodeDeltaFor("11122")).toBe(postcodeDelta.table["11122"]);
    expect("11121" in postcodeDelta.table).toBe(false);
    expect(postcodeDeltaFor("11121")).toBe(postcodeDelta.prefixTable["1112"]);
    expect(postcodeDeltaFor("11121")).not.toBe(0);
    expect(postcodeDeltaFor("99999")).toBe(0);
    expect(postcodeDeltaFor("abc")).toBe(0);
    // shrinkage: a single sale no longer moves its postnummer by two thirds of its deviation (v3: -0.288)
    expect(Math.abs(postcodeDeltaFor("11122"))).toBeLessThan(0.15);
  });
});

describe("vardera — tier 'lan'", () => {
  it("kr/m2 = kommun average x r(x); interval = price x exp(+-q_regional)", () => {
    const r = vardera(input("16900"));
    expect(r).not.toBeNull();
    const total = A_SOLNA * R_FIXTURE_0 * 43;
    expect(r?.varde).toBe(Math.round(total));
    expect(r?.prisPerM2).toBe(Math.round(A_SOLNA * R_FIXTURE_0));
    expect(r?.intervall).toEqual({
      low: Math.round(total * Math.exp(-Q_REGIONAL)),
      high: Math.round(total * Math.exp(Q_REGIONAL)),
    });
  });

  it("labels the kommun and the price level, and uses the simulated regional MAPE", () => {
    const r = vardera(input("16900"));
    expect(r).toMatchObject({
      tackning: "lan",
      omrade: null,
      kommun: "Solna",
      modellVersion: "valuation-v3.1",
      intervallTackningProcent: 90,
      typisktFelProcent: MAPE_REGIONAL,
      prisniva: {
        region: "Solna",
        krPerM2: A_SOLNA,
        period: { fran: "2025-09", till: "2026-08" },
        kalla: "Svensk Mäklarstatistik",
      },
    });
  });

  it("the four Huddinge postnummer are valued with Huddinge's average, not as Stockholm", () => {
    for (const pn of ["12352", "12404", "12755", "12784"]) {
      const r = vardera(input(pn));
      expect(r).toMatchObject({ tackning: "lan", omrade: null, kommun: "Huddinge" });
      expect(r?.prisniva?.krPerM2).toBe(A_HUDDINGE);
      expect(r?.varde).toBe(Math.round(A_HUDDINGE * R_FIXTURE_0 * 43));
    }
  });

  it("is independent of the postnummer except through the price level (same r(x))", () => {
    const solna = vardera(input("16900"));
    const nacka = vardera(input("13100"));
    expect(solna && nacka).toBeTruthy();
    expect((solna?.prisPerM2 ?? 0) / A_SOLNA).toBeCloseTo((nacka?.prisPerM2 ?? 0) / 59170, 4);
  });

  it("varde and prisPerM2 agree up to the per-m2 rounding", () => {
    const r = vardera(input("16900"));
    expect(Math.abs((r?.varde ?? 0) - (r?.prisPerM2 ?? 0) * 43)).toBeLessThanOrEqual(0.5 * 43);
  });
});

describe("vardera — tier 'utanfor_lan'", () => {
  it("uses the national average and names the kommun when known", () => {
    const r = vardera(input("40010"));
    const total = A_RIKET * R_FIXTURE_0 * 43;
    expect(r).toMatchObject({
      tackning: "utanfor_lan",
      omrade: null,
      kommun: "Göteborg",
      varde: Math.round(total),
      typisktFelProcent: MAPE_REGIONAL,
      prisniva: {
        region: "Riket",
        krPerM2: A_RIKET,
        period: { fran: "2026-08", till: "2026-08" },
        kalla: "Svensk Mäklarstatistik",
      },
    });
    expect(r?.intervall.low).toBe(Math.round(total * Math.exp(-Q_REGIONAL)));
  });

  it("still produces an estimate for a postnummer nothing is known about (kommun null)", () => {
    const r = vardera(input("99999"));
    expect(r).toMatchObject({ tackning: "utanfor_lan", kommun: null });
    expect(r?.varde).toBe(Math.round(A_RIKET * R_FIXTURE_0 * 43));
  });
});

describe("vardera — no valuation", () => {
  it.each(["", "  ", "1153", "115-32", "abcde"])("returns null for postnummer %j", (pn) => {
    expect(vardera(input(pn))).toBeNull();
  });
});

describe("beraknaR", () => {
  it("matches the general-model fixture used above", () => {
    expect(beraknaR(input("")).r).toBeCloseTo(R_FIXTURE_0, 12);
  });

  it("imputes missing optional inputs (r stays finite and inside the clip range)", () => {
    const { r } = beraknaR({
      postnummer: "",
      boarea: 30,
      antalRum: NaN,
      hiss: "okant",
      balkong: "okant",
    });
    expect(r).toBeGreaterThanOrEqual(generalModel.clipMin);
    expect(r).toBeLessThanOrEqual(generalModel.clipMax);
  });
});

describe("regional method — an unknown hiss/balkong stays between the known answers", () => {
  const prisPerM2 = (overrides: Partial<VarderingInput>) =>
    vardera(input("12352", overrides))?.prisPerM2 ?? NaN;

  it("hiss 'okant' never prices outside hiss 'ja'/'nej' (review finding: it priced 1.9 % above 'ja')", () => {
    const kanda = [prisPerM2({ hiss: "ja" }), prisPerM2({ hiss: "nej" })];
    const okant = prisPerM2({ hiss: "okant" });
    expect(okant).toBeGreaterThanOrEqual(Math.min(...kanda));
    expect(okant).toBeLessThanOrEqual(Math.max(...kanda));
  });

  it("balkong 'okant' never prices outside balkong 'ja'/'nej'", () => {
    const kanda = [prisPerM2({ balkong: "ja" }), prisPerM2({ balkong: "nej" })];
    const okant = prisPerM2({ balkong: "okant" });
    expect(okant).toBeGreaterThanOrEqual(Math.min(...kanda));
    expect(okant).toBeLessThanOrEqual(Math.max(...kanda));
  });

  it("both unknown stays within the four known combinations", () => {
    const kanda = (["ja", "nej"] as const).flatMap((hiss) =>
      (["ja", "nej"] as const).map((balkong) => prisPerM2({ hiss, balkong })),
    );
    const okant = prisPerM2({ hiss: "okant", balkong: "okant" });
    expect(okant).toBeGreaterThanOrEqual(Math.min(...kanda));
    expect(okant).toBeLessThanOrEqual(Math.max(...kanda));
  });
});
