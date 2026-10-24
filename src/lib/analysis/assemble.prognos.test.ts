import { describe, expect, it } from "vitest";
import { assembleraAnalys, byggPrisanalys } from "./assemble";
import { extraktion } from "./__fixtures__/extraktion";
import { ModellPrisdatakalla } from "./prisdata";
import { AnalysisResultSchema } from "./schema";
import type { AnalysJudgement } from "./analyze";
import type { ExtractionResult, PropertyInput, Referensranta } from "@/types/analysis";

// Round 2026-10-24b: the report reaches the price only through the expected
// fee rise. Fixed rate and day so the numbers are reproducible.
const RANTA: Referensranta = {
  namn: "3-månaders statsskuldväxel",
  serie: "SETB3MBENCH",
  datum: "2026-10-23",
  procent: 2.068,
  kalla: "Sveriges riksbank",
  reserv: false,
};
const IDAG = "2026-10-24";

const bedomning: AnalysJudgement = {
  betyg: "C",
  betygMotivering: "Rimlig ställning men räntekänslig avgift.",
  rodaFlaggor: [],
  fragor: [
    {
      id: "bygg",
      fraga: "Vilket år byggdes huset?",
      ursprung: "analys",
      riktadTill: "styrelsen",
      varfor: "Byggår saknas i underlaget.",
    },
    {
      id: "stam",
      fraga: "När byggdes stammarna om senast?",
      ursprung: "analys",
      riktadTill: "styrelsen",
      varfor: "Stambyte är dyrt.",
    },
  ],
};

const input: PropertyInput = {
  kind: "bostadsratt",
  utgangspris: 4_950_000,
  boarea: 62,
  antalRum: 3,
  manadsavgift: 4200,
  andelstal: 0,
  orgnr: "769612-3456",
  adress: "Kastanjevägen 4",
  postnummer: "11857",
  ort: "Stockholm",
  vaning: 3,
  byggar: 1962,
  hiss: "ja",
  balkong: "nej",
  avgiftInkluderar: { varme: "ja", vatten: "ja", el: "nej", bredband: "ja", tv: "nej" },
  antalPersoner: 2,
};

function montera(
  ex: ExtractionResult = extraktion,
  over: Partial<PropertyInput> = {},
  j = bedomning,
) {
  return assembleraAnalys({
    extraction: ex,
    input: { ...input, ...over },
    prisdatakalla: new ModellPrisdatakalla(),
    analys: j,
    analysisId: "00000000-0000-4000-8000-000000000001",
    skapad: "2026-10-24T10:00:00.000Z",
    referensranta: RANTA,
    idag: IDAG,
  });
}

describe("assembly with the fee prognosis", () => {
  it("adds prognosis, adjusted price, fee table, comparison and summary, and validates", async () => {
    const r = await montera();
    expect(AnalysisResultSchema.safeParse(r).success).toBe(true);
    expect(r.avgiftsprognos?.berakningsdatum).toBe(IDAG);
    // SBAB 31 000 000 kr, rörlig, 1,1 % → 2,068 + 0,58 = 2,648 %:
    // 31 000 000 × 1,548 % = 479 880 kr/år. Swedbank 2029-09-30 is beyond 2028-10-24.
    const refi = r.avgiftsprognos?.komponenter.find((k) => k.id === "refinansiering");
    expect(refi?.foreningKrPerAr).toBe(479_880);
    expect(r.avgiftsprognos?.refinansiering?.forfallandeBelopp).toBe(31_000_000);
    expect(r.prisanalys.justeradVardering?.value).toBeDefined();
    expect(r.prisanalys.justeringar?.[0]?.id).toBe("forvantad_avgiftshojning");
    expect(r.rantestress.prognosTabell?.rader.map((x) => x.id)).toEqual([
      "idag",
      "forvantad",
      "plus1",
      "plus2",
    ]);
    expect(r.sammanfattning?.slutsats).toMatch(/^Sammantaget: betyg C/);
    expect(r.uppgiftsjamforelse?.find((x) => x.falt === "byggar")?.status).toBe("bekraftat");
  });

  it("the grade never moves the price: A and E give identical price blocks", async () => {
    const a = await montera(extraktion, {}, { ...bedomning, betyg: "A" });
    const e = await montera(extraktion, {}, { ...bedomning, betyg: "E" });
    expect(a.prisanalys).toEqual(e.prisanalys);
  });

  it("a component without data widens the range but never moves the point value", async () => {
    const utan = await montera({
      ...extraktion,
      forening: { ...extraktion.forening, energiprojekt: [] },
    });
    const okant = await montera({
      ...extraktion,
      forening: {
        ...extraktion.forening,
        energiprojekt: [{ text: "Solceller", finansierat: "okant" }],
      },
    });
    expect(okant.prisanalys.justeradVardering?.value).toBe(
      utan.prisanalys.justeradVardering?.value,
    );
    expect(okant.prisanalys.justeradVardering?.range?.low).toBeLessThan(
      utan.prisanalys.justeradVardering?.range?.low ?? 0,
    );
  });

  it("an old (PROMPT_VERSION ≤ 8) extraction with year-only maturities still gets a prognosis", async () => {
    const { lan: _lan, ...lanebokUtanLan } = extraktion.forening.lanebok!;
    const gammal: ExtractionResult = {
      ...extraktion,
      forening: { ...extraktion.forening, lanebok: lanebokUtanLan },
    };
    const r = await montera(gammal);
    // 2026 → assumed 2026-07-01 (already passed, inside the horizon); 2029 outside.
    expect(r.avgiftsprognos?.refinansiering?.forfallandeBelopp).toBe(31_000_000);
    expect(AnalysisResultSchema.safeParse(r).success).toBe(true);
  });

  it("the report's byggår wins at high confidence and feeds the valuation", async () => {
    const ex: ExtractionResult = {
      ...extraktion,
      forening: {
        ...extraktion.forening,
        byggar: {
          value: 1931,
          unit: "ar",
          source: "arsredovisning",
          ref: { page: 3, excerpt: "Huset uppfördes 1931" },
        },
      },
    };
    const r = await montera(ex);
    const rad = r.uppgiftsjamforelse?.find((x) => x.falt === "byggar");
    expect(rad?.status).toBe("avviker");
    expect(rad?.anvant).toBe(1931);
    const med1931 = await byggPrisanalys({ ...input, byggar: 1931 }, new ModellPrisdatakalla());
    expect(r.prisanalys.externVardering?.value).toBe(med1931.externVardering?.value);
    // The stored buyer input is untouched.
    expect(r.input.byggar).toBe(1962);
  });

  it("drops model text claiming byggår is missing when it is known, keeps other questions", async () => {
    const ex: ExtractionResult = {
      ...extraktion,
      datakvalitet: {
        ...extraktion.datakvalitet,
        extraktionKonfidens: { niva: "hog", skal: ["Byggår saknas i rapporten.", "Annat skäl."] },
      },
    };
    const r = await montera(ex);
    expect(r.datakvalitet.extraktionKonfidens.skal).toEqual(["Annat skäl."]);
    const ids = r.fragor.map((f) => f.id);
    expect(ids).not.toContain("bygg");
    expect(ids).toContain("stam");
  });
});
