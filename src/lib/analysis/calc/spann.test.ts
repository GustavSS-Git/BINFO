import { describe, expect, it } from "vitest";
import { beraknaSpann } from "./spann";
import type { FeeInclusion } from "@/types/analysis";

const kant = (overrides: Partial<FeeInclusion> = {}): FeeInclusion => ({
  varme: "nej",
  vatten: "nej",
  el: "nej",
  bredband: "nej",
  tv: "nej",
  ...overrides,
});

describe("beraknaSpann", () => {
  it("kollapsar till en punkt (low === high) när allt är känt", () => {
    const poster = [
      { belopp: 500, avgiftspost: "varme" as const },
      { belopp: 200, avgiftspost: "vatten" as const },
    ];
    const r = beraknaSpann(poster, kant());
    expect(r.low).toBe(700);
    expect(r.high).toBe(700);
    expect(r.arSpann).toBe(false);
  });

  it("exkluderar en post helt när avgiften täcker den ('ja')", () => {
    const poster = [{ belopp: 500, avgiftspost: "varme" as const }];
    const r = beraknaSpann(poster, kant({ varme: "ja" }));
    expect(r.low).toBe(0);
    expect(r.high).toBe(0);
    expect(r.arSpann).toBe(false);
  });

  it("ger spann när en post är 'okant' — low antar att avgiften täcker, high att den inte gör det", () => {
    const poster = [
      { belopp: 500, avgiftspost: "varme" as const },
      { belopp: 200, avgiftspost: "vatten" as const },
    ];
    const r = beraknaSpann(poster, kant({ varme: "okant" }));
    expect(r.low).toBe(200); // varme exkluderad i low-scenariot
    expect(r.high).toBe(700); // varme inkluderad i high-scenariot
    expect(r.arSpann).toBe(true);
  });

  it("flera okända poster breddar spannet ytterligare", () => {
    const poster = [
      { belopp: 500, avgiftspost: "varme" as const },
      { belopp: 200, avgiftspost: "vatten" as const },
      { belopp: 349, avgiftspost: "bredband" as const },
    ];
    const r = beraknaSpann(poster, kant({ varme: "okant", bredband: "okant" }));
    expect(r.low).toBe(200);
    expect(r.high).toBe(1049);
    expect(r.arSpann).toBe(true);
  });

  it("poster utan avgiftspost (t.ex. hemförsäkring) räknas alltid med, oavsett FeeInclusion", () => {
    const poster = [{ belopp: 300 }]; // ingen avgiftspost — aldrig del av avgiften
    const r = beraknaSpann(poster, kant());
    expect(r.low).toBe(300);
    expect(r.high).toBe(300);
    expect(r.arSpann).toBe(false);
  });

  it("tom postlista ger 0/0, ingen spann", () => {
    const r = beraknaSpann([], kant());
    expect(r.low).toBe(0);
    expect(r.high).toBe(0);
    expect(r.arSpann).toBe(false);
  });
});
