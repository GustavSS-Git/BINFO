import { describe, expect, it } from "vitest";
import { beraknaRantestress, rantestressScenario } from "./rantestress";
import type { Forening, KeyFigure } from "@/types/analysis";

describe("rantestressScenario", () => {
  // Rantekänslighet är redan den statutory nyckeltalet "hur många procent
  // avgiften måste höjas per procentenhet högre ränta" — funktionen ska
  // konsumera det talet direkt, inte räkna om skuld/avgiftsintäkt själv.
  // (Ingen räntebärande skuld eller avgiftsintäkt förekommer som argument.)
  const nuvarandeManadsavgift = 3_240;
  const rantekanslighetProcent = 12.7;

  it("ger oförändrad avgift vid 0 procentenheters ökning", () => {
    const s = rantestressScenario(nuvarandeManadsavgift, rantekanslighetProcent, 0);
    expect(s.nyManadsavgift).toBe(3_240);
    expect(s.avgiftsokningKrPerManad).toBe(0);
  });

  it("höjer avgiften med rantekänslighet % vid +1 procentenhet", () => {
    const s = rantestressScenario(nuvarandeManadsavgift, rantekanslighetProcent, 1);
    expect(s.nyManadsavgift).toBe(3_651);
    expect(s.avgiftsokningKrPerManad).toBe(411);
  });

  it("skalar linjärt med antal procentenheter vid +2", () => {
    const s = rantestressScenario(nuvarandeManadsavgift, rantekanslighetProcent, 2);
    expect(s.nyManadsavgift).toBe(4_063);
    expect(s.avgiftsokningKrPerManad).toBe(823);
  });

  it("skalar linjärt med antal procentenheter vid +3", () => {
    const s = rantestressScenario(nuvarandeManadsavgift, rantekanslighetProcent, 3);
    expect(s.nyManadsavgift).toBe(4_474);
    expect(s.avgiftsokningKrPerManad).toBe(1_234);
  });

  it("avrundar till hela kronor (inga decimaler)", () => {
    const s = rantestressScenario(1_000, 5.55, 1);
    expect(Number.isInteger(s.nyManadsavgift)).toBe(true);
    expect(Number.isInteger(s.avgiftsokningKrPerManad)).toBe(true);
  });
});

describe("beraknaRantestress", () => {
  const NUVARANDE_AVGIFT = 3_240;

  const energikostnad: KeyFigure = {
    id: "energikostnad_per_m2_totalyta",
    label: "Energikostnad per m² totalyta",
    figure: { value: 178, unit: "kr/m2/ar", source: "arsredovisning" },
    status: "acceptabel",
    forklaring: "Föreningens energikostnad per kvadratmeter.",
  };

  function rantekanslighetFigur(value: number | null): KeyFigure {
    return {
      id: "rantekanslighet",
      label: "Räntekänslighet",
      figure: { value, unit: "procent", source: "arsredovisning" },
      status: value === null ? "okant" : "svag",
      forklaring: "Hur mycket avgiften måste höjas per procentenhet högre ränta.",
    };
  }

  function forening(keyFigures: KeyFigure[]): Forening {
    return {
      namn: "Brf Testet",
      orgnr: "769600-0000",
      akta: "ja",
      rakenskapsar: 2024,
      keyFigures,
    };
  }

  const medRantekanslighet = forening([energikostnad, rantekanslighetFigur(12.7)]);

  it("ger exakt fyra scenarier i ordningen 0, 1, 2, 3 procentenheter", () => {
    const r = beraknaRantestress(medRantekanslighet, NUVARANDE_AVGIFT);
    expect(r.scenarier.map((s) => s.okningPe)).toEqual([0, 1, 2, 3]);
  });

  it("lämnar avgiften oförändrad i 0-procentenhetsscenariot", () => {
    const r = beraknaRantestress(medRantekanslighet, NUVARANDE_AVGIFT);
    expect(r.scenarier[0]?.nyManadsavgift.value).toBe(NUVARANDE_AVGIFT);
    expect(r.scenarier[0]?.avgiftsokningKrPerManad.value).toBe(0);
  });

  it("använder nyckeltalet rakt av — samma siffror som rantestressScenario", () => {
    const r = beraknaRantestress(medRantekanslighet, NUVARANDE_AVGIFT);
    expect(r.scenarier.map((s) => s.nyManadsavgift.value)).toEqual([3_240, 3_651, 4_063, 4_474]);
    expect(r.scenarier.map((s) => s.avgiftsokningKrPerManad.value)).toEqual([0, 411, 823, 1_234]);
  });

  it("märker scenariobeloppen som beräknade kronor", () => {
    const r = beraknaRantestress(medRantekanslighet, NUVARANDE_AVGIFT);
    for (const s of r.scenarier) {
      expect(s.nyManadsavgift.unit).toBe("kr");
      expect(s.nyManadsavgift.source).toBe("berakning");
      expect(s.avgiftsokningKrPerManad.unit).toBe("kr");
      expect(s.avgiftsokningKrPerManad.source).toBe("berakning");
    }
  });

  it("utelämnar totalManadskostnad helt när lånedetaljer saknas", () => {
    const r = beraknaRantestress(medRantekanslighet, NUVARANDE_AVGIFT);
    for (const s of r.scenarier) {
      expect("totalManadskostnad" in s).toBe(false);
    }
  });

  it("återger nuvarande månadsavgift som användarangiven siffra", () => {
    const r = beraknaRantestress(medRantekanslighet, NUVARANDE_AVGIFT);
    expect(r.nuvarandeManadsavgift).toEqual({
      value: NUVARANDE_AVGIFT,
      unit: "kr",
      source: "anvandare",
    });
  });

  it("återger räntekänsligheten från nyckeltalet", () => {
    const r = beraknaRantestress(medRantekanslighet, NUVARANDE_AVGIFT);
    expect(r.rantekanslighetProcent).toBe(12.7);
  });

  it("uttrycker kommentaren i kronor per månad för den här lägenheten", () => {
    const r = beraknaRantestress(medRantekanslighet, NUVARANDE_AVGIFT);
    // Per procentenhet: 411 kr/mån. Vid +3 procentenheter: 1 234 kr/mån.
    // Tillåter valfri (eller ingen) tusentalsavgränsare.
    expect(r.kommentar).toMatch(/411/);
    expect(r.kommentar).toMatch(/1[\s\u00a0]?234/);
  });

  it("degraderar utan att kasta när nyckeltalet saknas helt — scenarier blir tomma, resten fortsätter", () => {
    const r = beraknaRantestress(forening([energikostnad]), NUVARANDE_AVGIFT);
    expect(r.rantekanslighetProcent).toBeNull();
    expect(r.scenarier).toEqual([]);
    expect(r.kommentar).toMatch(/saknas/i);
    expect(r.nuvarandeManadsavgift).toEqual({
      value: NUVARANDE_AVGIFT,
      unit: "kr",
      source: "anvandare",
    });
  });

  it("degraderar utan att kasta när nyckeltalets värde är null", () => {
    // Okänt får aldrig tyst behandlas som noll känslighet — det vore en
    // självsäker tom analys, precis det PIPELINE.md förbjuder. Men det får
    // heller aldrig fälla hela jobbet (ägarbeslut, task 7) — degradera i
    // stället till rantekanslighetProcent: null, scenarier: [].
    const r = beraknaRantestress(
      forening([energikostnad, rantekanslighetFigur(null)]),
      NUVARANDE_AVGIFT,
    );
    expect(r.rantekanslighetProcent).toBeNull();
    expect(r.scenarier).toEqual([]);
    expect(r.kommentar).toMatch(/saknas/i);
  });

  it("ger fyra oförändrade scenarier och en särskild kommentar när räntekänsligheten är exakt 0 (skuldfri förening)", () => {
    const r = beraknaRantestress(
      forening([energikostnad, rantekanslighetFigur(0)]),
      NUVARANDE_AVGIFT,
    );
    expect(r.rantekanslighetProcent).toBe(0);
    expect(r.scenarier).toHaveLength(4);
    for (const s of r.scenarier) {
      expect(s.nyManadsavgift.value).toBe(NUVARANDE_AVGIFT);
      expect(s.avgiftsokningKrPerManad.value).toBe(0);
    }
    expect(r.kommentar).toMatch(/inga räntebärande lån/i);
  });
});
