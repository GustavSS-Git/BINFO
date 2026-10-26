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
    expect(r.uppgiftsjamforelse?.find((x) => x.falt === "byggar")?.status).toBe("manuellt");
  });

  it("PROMPT_VERSION 11 fields: the fixture's 12 % raise from 2026-01-01 is checked (780 × 62 ÷ 12 = 4 030 vs fee 4 200), stored and validates", async () => {
    const r = await montera();
    expect(AnalysisResultSchema.safeParse(r).success).toBe(true);
    // 4 030 × 1,12 = 4 513,6; |4 200 − 4 030| = 170 < 313,6 → matchar_fore; date passed → i_kraft, konflikt
    expect(r.avgiftsprognos?.avgiftsandringKontroll).toEqual([
      expect.objectContaining({
        procent: 12,
        fran: "2026-01-01",
        datum: "passerat",
        uppskattadAvgiftFore: 4030,
        uppskattadAvgiftEfter: 4514,
        avgift: "matchar_fore",
        slutsats: "i_kraft",
        konflikt: true,
      }),
    ]);
    const k = r.avgiftsprognos?.komponenter.find((c) => c.id === "beslutad_hojning");
    expect(k?.status).toBe("ej_aktuell");
    // the fixture's lokaler signal (120 000 × 100 %) is the only lokal rent at risk;
    // its kontor lease (ends 2026-12-31) is renewed in the report → 0
    expect(r.avgiftsprognos?.komponenter.find((c) => c.id === "lokaler")?.foreningKrPerAr).toBe(
      120_000,
    );
  });

  describe("buyer questions about lokal rent (owner 2026-10-25)", () => {
    const lokalFraga = (r: Awaited<ReturnType<typeof montera>>) =>
      r.fragor.filter((f) => f.id.startsWith("lokal-"));

    it("the fixture's loss signal gives one question for the styrelse with a cited page; the renewed lease gives none", async () => {
      const r = await montera();
      const q = lokalFraga(r);
      expect(q.map((f) => f.id)).toEqual(["lokal-signal-0"]);
      expect(q[0]).toMatchObject({ ursprung: "analys", riktadTill: "styrelsen", ref: { page: 8 } });
      expect(q[0]?.varfor).toMatch(/Hyran är 120.000 kr per år/);
    });

    it("an unrenewed lease ending in the window adds a question and a 50 % component", async () => {
      const ex = structuredClone(extraktion);
      delete ex.forening.lokaler!.kontrakt![0]!.fornyelse;
      const r = await montera(ex);
      // Largest rent first (max three, owner 2026-10-25): the lease's share of
      // hyresintakter is larger than the signal's 120 000.
      expect(lokalFraga(r).map((f) => f.id)).toEqual(["lokal-avtal-0", "lokal-signal-0"]);
      const avtal = lokalFraga(r)[0]!;
      expect(avtal.fraga).toBe(
        "Vad händer med hyresavtalet för kontoret (130,5 kvm) som löper ut 31 december 2026? Har föreningen och hyresgästen kommit överens om att förlänga, eller finns en ny hyresgäst?",
      );
      const k = r.avgiftsprognos?.komponenter.find((c) => c.id === "lokaler");
      // signal 120 000 × 100 % = 120 000. The lease has no arshyra: 360 000 ÷ max(1, 0, 1) = 360 000,
      // capped at the 360 000 − 120 000 = 240 000 the signal left, × 50 % = 120 000. Total 240 000.
      expect(k?.foreningKrPerAr).toBe(240_000);
      expect(k?.forklaring).toContain("kontoret (130,5 kvm) löper ut 31 december 2026");
    });

    it("no lokal question when the model already asks about the lokal", async () => {
      const r = await montera(
        extraktion,
        {},
        {
          ...bedomning,
          fragor: [
            ...bedomning.fragor,
            {
              id: "lokal",
              fraga: "Vad händer med hyresgästen i lokalen?",
              ursprung: "analys",
              riktadTill: "styrelsen",
              varfor: "Lokalhyran är en intäkt.",
            },
          ],
        },
      );
      expect(lokalFraga(r)).toEqual([]);
    });

    it("an old extraction without lokaler gets no lokal question", async () => {
      const gammal = structuredClone(extraktion);
      delete gammal.forening.lokaler;
      expect(lokalFraga(await montera(gammal))).toEqual([]);
    });
  });

  it("an old extraction without avgiftsandringar and forlustsignaler still assembles: no check, both components ej_aktuell", async () => {
    const gammal = structuredClone(extraktion);
    delete gammal.forening.avgiftsandringar;
    delete gammal.forening.lokaler;
    const r = await montera(gammal);
    expect(AnalysisResultSchema.safeParse(r).success).toBe(true);
    expect(r.avgiftsprognos?.avgiftsandringKontroll).toBeUndefined();
    for (const id of ["beslutad_hojning", "lokaler"] as const) {
      expect(r.avgiftsprognos?.komponenter.find((c) => c.id === id)?.status).toBe("ej_aktuell");
    }
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
    // 2026 → placeholder 2026-07-01 (year-only: matured only when the YEAR is over, so still
    // priced in 2026), inside the horizon; 2029 is the later phase.
    expect(r.avgiftsprognos?.refinansiering?.forfallandeBelopp).toBe(31_000_000);
    expect(r.avgiftsprognos?.refinansiering?.lan?.[0]).toMatchObject({ endastAr: true });
    expect(AnalysisResultSchema.safeParse(r).success).toBe(true);
  });

  it("the buyer's byggår is always used; a different report year is only a note", async () => {
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
    expect(rad?.anvant).toBe(1962);
    expect(rad?.rapport).toBe(1931);
    const med1962 = await byggPrisanalys({ ...input, byggar: 1962 }, new ModellPrisdatakalla());
    expect(r.prisanalys.externVardering?.value).toBe(med1962.externVardering?.value);
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
