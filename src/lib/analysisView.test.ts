import { describe, expect, it } from "vitest";
import { costItemOsaker, formatSkapadDatum, toppRodaFlaggor } from "./analysisView";
import type { FeeInclusion, RedFlag } from "@/types/analysis";

function flagga(id: string, severity: RedFlag["severity"]): RedFlag {
  return { id, titel: id, beskrivning: id, severity, harledsFran: [] };
}

describe("toppRodaFlaggor", () => {
  it("plockar ut de mest allvarliga flaggorna först", () => {
    const flaggor = [flagga("a", "lag"), flagga("b", "hog"), flagga("c", "medel")];
    expect(toppRodaFlaggor(flaggor, 2).map((f) => f.id)).toEqual(["b", "c"]);
  });

  it("behåller ursprunglig ordning vid lika allvarlighetsgrad", () => {
    const flaggor = [flagga("a", "hog"), flagga("b", "hog"), flagga("c", "hog")];
    expect(toppRodaFlaggor(flaggor, 2).map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("returnerar färre än N om det inte finns fler flaggor", () => {
    expect(toppRodaFlaggor([flagga("a", "hog")], 2)).toHaveLength(1);
  });

  it("muterar inte den ursprungliga listan", () => {
    const flaggor = [flagga("a", "lag"), flagga("b", "hog")];
    toppRodaFlaggor(flaggor, 1);
    expect(flaggor.map((f) => f.id)).toEqual(["a", "b"]);
  });
});

const avgiftInkluderar = (overrides: Partial<FeeInclusion>): FeeInclusion => ({
  varme: "okant",
  vatten: "okant",
  el: "okant",
  bredband: "okant",
  tv: "okant",
  ...overrides,
});

describe("costItemOsaker", () => {
  it("är osäker när avgiftsfältet står på 'okant'", () => {
    expect(costItemOsaker("hushallsel", avgiftInkluderar({ el: "okant" }))).toBe(true);
  });

  it("är inte osäker när avgiftsfältet är 'ja' eller 'nej'", () => {
    expect(costItemOsaker("varme", avgiftInkluderar({ varme: "ja" }))).toBe(false);
    expect(costItemOsaker("vatten", avgiftInkluderar({ vatten: "nej" }))).toBe(false);
  });

  it("hemförsäkring och lånerelaterade poster är aldrig osäkra — de har ingen avgiftskoppling", () => {
    expect(costItemOsaker("hemforsakring", avgiftInkluderar({}))).toBe(false);
    expect(costItemOsaker("rantekostnad", avgiftInkluderar({}))).toBe(false);
    expect(costItemOsaker("amortering", avgiftInkluderar({}))).toBe(false);
    expect(costItemOsaker("ranteavdrag", avgiftInkluderar({}))).toBe(false);
    expect(costItemOsaker("manadsavgift", avgiftInkluderar({}))).toBe(false);
  });
});

describe("formatSkapadDatum", () => {
  it("formaterar en ISO 8601-tidsstämpel som ett kort svenskt datum", () => {
    expect(formatSkapadDatum("2026-09-12T16:26:31.734Z")).toBe("12 sep. 2026");
  });
});
