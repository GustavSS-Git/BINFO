import { describe, expect, it } from "vitest";
import { budpremieForOmrade } from "./budpremie";
import { budpremieData } from "./data";

describe("budpremieForOmrade", () => {
  it("returns the area's own figures when n is at/above the minimum", () => {
    const area = budpremieData.areas["Södermalm"];
    if (!area || area.fallbackToOverall) {
      throw new Error("test fixture assumption broken: Södermalm should not be a fallback area");
    }
    const result = budpremieForOmrade("Södermalm");
    expect(result.omrade).toBe("Södermalm");
    expect(result.medianProcent).toBe(area.medianProcent);
    expect(result.medelProcent).toBe(area.medelProcent);
    expect(result.n).toBe(area.n);
    expect(result.dataperiod).toEqual(budpremieData.period);
  });

  it("falls back to the overall figure (omrade: null) for a null omrade", () => {
    const result = budpremieForOmrade(null);
    expect(result.omrade).toBeNull();
    expect(result.medianProcent).toBe(budpremieData.overall.medianProcent);
    expect(result.medelProcent).toBe(budpremieData.overall.medelProcent);
    expect(result.n).toBe(budpremieData.overall.n);
  });

  it("falls back to the overall figure for a known area with n below the minimum", () => {
    const fallbackArea = Object.entries(budpremieData.areas).find(([, v]) => v.fallbackToOverall);
    if (!fallbackArea) {
      throw new Error("test fixture assumption broken: expected at least one fallback area");
    }
    const [name] = fallbackArea;
    const result = budpremieForOmrade(name);
    expect(result.omrade).toBeNull();
    expect(result.medianProcent).toBe(budpremieData.overall.medianProcent);
    expect(result.n).toBe(budpremieData.overall.n);
  });

  it("falls back to the overall figure for an area name not in the table at all", () => {
    const result = budpremieForOmrade("Not A Real Area");
    expect(result.omrade).toBeNull();
    expect(result.medianProcent).toBe(budpremieData.overall.medianProcent);
  });
});
