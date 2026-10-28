import { describe, expect, it } from "vitest";
import type { Budpremie } from "@/types/analysis";
import { formatMkr, formatSpannMkr, kvmPris, lageIMotSpann, vanligtBud } from "./prisVy";

const premie = (medianProcent: number): Budpremie => ({
  omrade: "Kungsholmen",
  medianProcent,
  medelProcent: medianProcent,
  n: 600,
  dataperiod: { fran: "2026-01", till: "2026-08" },
});

describe("vanligtBud", () => {
  it("moves the asking price by the median premium, rounded to 10 000 kr", () => {
    expect(vanligtBud(4_995_000, premie(5.4))).toBe(5_260_000);
    expect(vanligtBud(4_995_000, premie(-2))).toBe(4_900_000);
  });

  it("is null without an asking price or a premium", () => {
    expect(vanligtBud(undefined, premie(5))).toBeNull();
    expect(vanligtBud(0, premie(5))).toBeNull();
    expect(vanligtBud(4_995_000, null)).toBeNull();
  });
});

describe("formatters", () => {
  it("formats millions with a comma", () => {
    expect(formatMkr(5_570_000)).toBe("5,6 mkr");
    expect(formatMkr(5_260_000, 2)).toBe("5,26 mkr");
  });

  it("formats the ±10 % span", () => {
    expect(formatSpannMkr(5_570_000)).toBe("5,01–6,13 mkr");
  });

  it("gives kr/m² only with a positive boarea", () => {
    expect(kvmPris(4_995_000, 48)).toBe("ca 104 100 kr/m²");
    expect(kvmPris(4_995_000, 0)).toBeNull();
  });

  it("places a value against the span", () => {
    expect(lageIMotSpann(4_995_000, 5_570_000)).toBe("under");
    expect(lageIMotSpann(5_260_000, 5_570_000)).toBe("inom");
  });
});
