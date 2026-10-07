import { describe, expect, it } from "vitest";
import { drivareForInput, hamtaVarderingsdrivareCaveat } from "./drivare";
import { effectsData } from "./data";

const CONTINUOUS_LABELS = [
  "Ett rum till",
  "En våning högre",
  "10 år nyare byggnad",
  "10 kr/m² högre månadsavgift",
  "10 kvm större boarea (pris per kvm)",
];

describe("drivareForInput", () => {
  it("shows the area-specific elevator=nej effect when significant for that omrade", () => {
    const result = drivareForInput({ hiss: "nej", balkong: "ja" }, "Hägersten-Liljeholmen");
    expect(result[0]).toEqual({
      label: "Ingen hiss",
      effektProcent: -4.9,
      intervallProcent: { low: -9.4, high: -0.1 },
      niva: "omrade",
    });
  });

  it("falls back to the city-wide elevator=nej effect when the area-specific one is not significant", () => {
    // Vasastan-Norrmalm has an area-specific elevator=nej entry in
    // effects.json, but it is signifikant: false.
    const result = drivareForInput({ hiss: "nej", balkong: "ja" }, "Vasastan-Norrmalm");
    expect(result[0]).toEqual({
      label: "Ingen hiss",
      effektProcent: -2.4,
      intervallProcent: { low: -3.9, high: -0.8 },
      niva: "stad",
    });
  });

  it("falls back to the city-wide elevator=nej effect for an area with no area-specific entry", () => {
    const result = drivareForInput({ hiss: "nej", balkong: "ja" }, "Essingen");
    expect(result[0]?.niva).toBe("stad");
    expect(result[0]?.label).toBe("Ingen hiss");
  });

  it("never shows an area effect whose sign contradicts the city-wide one (Södermalm: no lift is not significant in valuation-v3, but the rule is kept)", () => {
    // Owner decision 2026-09-25: a missing lift is obviously a negative; a
    // positive area estimate is correlation (building type), not causation.
    const drivare = drivareForInput({ hiss: "nej", balkong: "ja" }, "Södermalm");
    const hiss = drivare.find((d) => d.label === "Ingen hiss");
    expect(hiss).toBeDefined();
    expect(hiss!.niva).toBe("stad");
    expect(hiss!.effektProcent).toBeLessThan(0);
  });

  it("falls back to the city-wide elevator=nej effect for a null (unmapped) omrade", () => {
    const result = drivareForInput({ hiss: "nej", balkong: "ja" }, null);
    expect(result[0]?.niva).toBe("stad");
  });

  it("shows no hiss driver when hiss is 'ja' (the reference category)", () => {
    const result = drivareForInput({ hiss: "ja", balkong: "ja" }, "Hägersten-Liljeholmen");
    expect(
      result.find((d) => d.label.includes("hiss") || d.label.includes("Hiss")),
    ).toBeUndefined();
  });

  it("shows no hiss driver when hiss is 'okant', even though an 'elevator=okant' effect exists", () => {
    const result = drivareForInput({ hiss: "okant", balkong: "ja" }, "Hägersten-Liljeholmen");
    expect(result.find((d) => d.label.toLowerCase().includes("hiss"))).toBeUndefined();
  });

  it("shows no balkong driver when balkong is 'nej' (the only balcony=nej effect is not significant today)", () => {
    const result = drivareForInput({ hiss: "ja", balkong: "nej" }, "Hägersten-Liljeholmen");
    expect(result.find((d) => d.label.toLowerCase().includes("balkong"))).toBeUndefined();
  });

  it("never shows a balkong=okant driver", () => {
    const result = drivareForInput({ hiss: "ja", balkong: "okant" }, "Hägersten-Liljeholmen");
    expect(result.find((d) => d.label.toLowerCase().includes("balkong"))).toBeUndefined();
  });

  it("always includes the continuous city-wide effects, in order, incl. the monthly-fee effect", () => {
    const result = drivareForInput({ hiss: "ja", balkong: "ja" }, null);
    expect(result.map((d) => d.label)).toEqual(CONTINUOUS_LABELS);
  });

  it("shows fee_per_sqm+10 as a city-wide, negative, significant driver (valuation-v3)", () => {
    const result = drivareForInput({ hiss: "ja", balkong: "ja" }, "Södermalm");
    const avgift = result.find((d) => d.label === "10 kr/m² högre månadsavgift");
    expect(avgift).toEqual({
      label: "10 kr/m² högre månadsavgift",
      effektProcent: -2.4,
      intervallProcent: { low: -2.8, high: -2.1 },
      niva: "stad",
    });
  });

  it("orders categorical drivers before continuous ones", () => {
    const result = drivareForInput({ hiss: "nej", balkong: "ja" }, "Hägersten-Liljeholmen");
    expect(result[0]?.label).toBe("Ingen hiss");
    expect(result.slice(1).map((d) => d.label)).toEqual(CONTINUOUS_LABELS);
  });

  it("rounds effektProcent and the CI to one decimal place", () => {
    const result = drivareForInput({ hiss: "ja", balkong: "ja" }, null);
    for (const d of result) {
      expect(d.effektProcent).toBe(Math.round(d.effektProcent * 10) / 10);
      expect(d.intervallProcent.low).toBe(Math.round(d.intervallProcent.low * 10) / 10);
      expect(d.intervallProcent.high).toBe(Math.round(d.intervallProcent.high * 10) / 10);
    }
  });

  it("shows no hiss/balkong driver outside Stockholms kommun (the general model does not apply them)", () => {
    for (const tackning of ["lan", "utanfor_lan"] as const) {
      const result = drivareForInput({ hiss: "nej", balkong: "nej" }, null, tackning);
      expect(result.map((d) => d.label)).toEqual(CONTINUOUS_LABELS);
    }
    const stockholm = drivareForInput({ hiss: "nej", balkong: "nej" }, null, "stockholm");
    expect(stockholm.map((d) => d.label)).toContain("Ingen hiss");
  });

  it("fee_per_sqm+100 (v2's collinearity artefact) no longer exists in the data", () => {
    expect(effectsData.effects.some((e) => e.id === "fee_per_sqm+100")).toBe(false);
    expect(effectsData.effects.some((e) => e.id === "fee_per_sqm+10")).toBe(true);
  });
});

describe("hamtaVarderingsdrivareCaveat", () => {
  it("returns effects.json's caveat_sv verbatim", () => {
    expect(hamtaVarderingsdrivareCaveat()).toBe(effectsData.caveatSv);
    expect(hamtaVarderingsdrivareCaveat().length).toBeGreaterThan(0);
  });
});
