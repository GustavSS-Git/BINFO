import { describe, expect, it } from "vitest";
import { beraknaRantestress, byggPrognosTabell, rantestressScenario } from "./rantestress";
import type { AvgiftsprognosResultat } from "./avgiftsprognos";
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

describe("byggPrognosTabell", () => {
  // fee 4 000; total +100 kr/month; räntekänslighet 5 %/pp.
  // Scenario increments (rantestressScenario): +1 pp → 4 000 × 1,05 = 4 200 → +200,
  // +2 pp → 4 000 × 1,10 = 4 400 → +400. Rows are expected fee + increment:
  // plus1 = 4 000 + 100 + 200 = 4 300 (change 300), plus2 = 4 500 (change 500).
  const prognos = (
    over: Partial<AvgiftsprognosResultat> & { total?: number | null; andel?: number | null } = {},
  ): AvgiftsprognosResultat => {
    const andel = over.andel === undefined ? 0.01 : over.andel;
    return {
      prognos: {
        horisontManader: 24,
        berakningsdatum: "2026-10-24",
        andel: andel === null ? null : { varde: andel, metod: "avgiftsandel" },
        komponenter: [],
        totalKrPerManad: over.total === undefined ? 100 : over.total,
      },
      omsattningsbarSkuld:
        over.omsattningsbarSkuld === undefined ? 5_000_000 : over.omsattningsbarSkuld,
      antalSaknadeUnderlag: 0,
      ...(over.totalSpannVidAntagande
        ? { totalSpannVidAntagande: over.totalSpannVidAntagande }
        : {}),
    };
  };

  it("four rows with hand-computed amounts (expected fee + scenario increment)", () => {
    const t = byggPrognosTabell(4000, prognos(), 5);
    expect(t?.rader).toEqual([
      { id: "idag", label: "Dagens avgift", manadsavgift: 4000, forandringKr: 0 },
      {
        id: "forvantad",
        label: "Förväntad avgift (oförändrad ränta)",
        manadsavgift: 4100,
        forandringKr: 100,
      },
      { id: "plus1", label: "+1 procentenhet", manadsavgift: 4300, forandringKr: 300 },
      { id: "plus2", label: "+2 procentenheter", manadsavgift: 4500, forandringKr: 500 },
    ]);
    expect(t?.kommentar).toContain("läggs ovanpå den förväntade avgiften");
    expect(t?.kommentar).toContain("hela skulden via räntekänsligheten");
    expect(t?.kommentar).not.toContain("bara den del");
  });
  it("uses the same increments as the slider scenarios", () => {
    const t = byggPrognosTabell(4000, prognos(), 12.7);
    // fee 4 000, 12,7 %: +1 pp → 4 000 × 1,127 = 4 508 → +508; +2 pp → 4 000 × 1,254 = 5 016 → +1 016.
    expect(t?.rader[2]?.forandringKr).toBe(100 + 508);
    expect(t?.rader[3]?.forandringKr).toBe(100 + 1_016);
  });
  it("null when the expected rise is unknown", () => {
    expect(byggPrognosTabell(4000, prognos({ total: null, andel: null }), 5)).toBeNull();
  });
  it("omits plus rows when räntekänslighet is missing", () => {
    const t = byggPrognosTabell(4000, prognos(), null);
    expect(t?.rader.map((r) => r.id)).toEqual(["idag", "forvantad"]);
    expect(t?.kommentar).toMatch(/Räntekänslighet saknas/);
  });
  it("negative expected change is kept (refinancing lowers the fee)", () => {
    // total -20; räntekänslighet 5: 3 980 → plus1 = 3 980 + 200 = 4 180 (change +180).
    const t = byggPrognosTabell(4000, prognos({ total: -20 }), 5);
    expect(t?.rader[1]).toMatchObject({ manadsavgift: 3980, forandringKr: -20 });
    expect(t?.rader[2]).toMatchObject({ manadsavgift: 4180, forandringKr: 180 });
  });
  it("debt-free (räntekänslighet 0): plus rows equal the expected row", () => {
    const t = byggPrognosTabell(4000, prognos(), 0);
    expect(t?.rader[2]?.manadsavgift).toBe(4100);
    expect(t?.rader[3]?.manadsavgift).toBe(4100);
    expect(t?.kommentar).toMatch(/inga räntebärande lån/);
  });
  it("flags the assumption when maturities were missing", () => {
    const t = byggPrognosTabell(4000, prognos({ totalSpannVidAntagande: { lag: 0, hog: 10 } }), 5);
    expect(t?.kommentar).toMatch(/antagande/);
  });
});
