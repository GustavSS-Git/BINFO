import { describe, expect, it } from "vitest";
import { drivareForInput, hamtaVarderingsdrivareCaveat } from "./drivare";
import { effectsData } from "./data";

const CONTINUOUS_LABELS = [
  "Ett rum till",
  "En våning högre",
  "10 år nyare byggnad",
  "10 kvm större boarea",
];

describe("drivareForInput", () => {
  it("shows the area-specific elevator=nej effect when significant for that omrade", () => {
    const result = drivareForInput({ hiss: "nej", balkong: "ja" }, "Hägersten-Liljeholmen");
    expect(result[0]).toEqual({
      label: "Ingen hiss",
      effektProcent: -5.3,
      intervallProcent: { low: -9.8, high: -0.6 },
      niva: "omrade",
    });
  });

  it("falls back to the city-wide elevator=nej effect when the area-specific one is not significant", () => {
    // Vasastan-Norrmalm has an area-specific elevator=nej entry in
    // effects.json, but it is signifikant: false.
    const result = drivareForInput({ hiss: "nej", balkong: "ja" }, "Vasastan-Norrmalm");
    expect(result[0]).toEqual({
      label: "Ingen hiss",
      effektProcent: -2.5,
      intervallProcent: { low: -4.0, high: -1.0 },
      niva: "stad",
    });
  });

  it("falls back to the city-wide elevator=nej effect for an area with no area-specific entry", () => {
    const result = drivareForInput({ hiss: "nej", balkong: "ja" }, "Essingen");
    expect(result[0]?.niva).toBe("stad");
    expect(result[0]?.label).toBe("Ingen hiss");
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

  it("always includes the continuous city-wide effects, in order, excluding fee_per_sqm+100", () => {
    const result = drivareForInput({ hiss: "ja", balkong: "ja" }, null);
    const labels = result.map((d) => d.label);
    expect(labels).toEqual(CONTINUOUS_LABELS);
    expect(labels.some((l) => l.includes("avgift"))).toBe(false);
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

  it("keeps fee_per_sqm+100 in the generated data file, just excluded from drivers", () => {
    expect(effectsData.effects.some((e) => e.id === "fee_per_sqm+100")).toBe(true);
  });
});

describe("hamtaVarderingsdrivareCaveat", () => {
  it("returns effects.json's caveat_sv verbatim", () => {
    expect(hamtaVarderingsdrivareCaveat()).toBe(effectsData.caveatSv);
    expect(hamtaVarderingsdrivareCaveat().length).toBeGreaterThan(0);
  });
});
