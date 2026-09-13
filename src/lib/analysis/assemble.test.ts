import { describe, expect, it } from "vitest";
import { assembleraAnalys, byggPrisanalys } from "./assemble";
import { extraktion } from "./__fixtures__/extraktion";
import { DemoPrisdatakalla, SchablonPrisdatakalla, TomPrisdatakalla } from "./prisdata";
import { konfidensUtanPrisdata } from "./prisdata";
import { SaknarRantekanslighetError } from "./calc/rantestress";
import { AnalysisResultSchema } from "./schema";
import type { AnalysJudgement } from "./analyze";
import type { ExtractionResult, Forening, PropertyInput } from "@/types/analysis";

const analysJudgement: AnalysJudgement = {
  betyg: "C",
  betygMotivering: "Rimlig finansiell ställning men avgiften är räntekänslig.",
  rodaFlaggor: [
    {
      id: "hog-rantekanslighet",
      titel: "Avgiften är räntekänslig",
      beskrivning: "Räntekänsligheten är 9,2 % enligt årsredovisningen.",
      severity: "medel",
      harledsFran: ["rantekanslighet"],
    },
  ],
  fragor: [
    {
      id: "fraga-stambyte",
      fraga: "Hur ska stambytet 2028 finansieras?",
      ursprung: "analys",
      riktadTill: "styrelsen",
      varfor: "Stort planerat underhåll samtidigt som sparandet är lågt.",
    },
  ],
};

/** Allt känt — inget Tristate-fält på 'okant', vaning/byggar satta. */
const inputKomplett: PropertyInput = {
  kind: "bostadsratt",
  utgangspris: 4_950_000,
  boarea: 62,
  antalRum: 3,
  manadsavgift: 4200,
  andelstal: 2.1,
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

/** Allt Tristate-fält på 'okant'; vaning/byggar kända, isolerar frågeräkningen. */
const inputAllaOkanda: PropertyInput = {
  ...inputKomplett,
  hiss: "okant",
  balkong: "okant",
  avgiftInkluderar: {
    varme: "okant",
    vatten: "okant",
    el: "okant",
    bredband: "okant",
    tv: "okant",
  },
};

function extraktionUtanRantekanslighet(): ExtractionResult {
  const forening: Forening = {
    ...extraktion.forening,
    keyFigures: extraktion.forening.keyFigures.map((kf) =>
      kf.id === "rantekanslighet"
        ? { ...kf, status: "okant", figure: { value: null, unit: "procent", source: "berakning" } }
        : kf,
    ),
  };
  return { ...extraktion, forening };
}

describe("assembleraAnalys", () => {
  it("producerar noll saknad_uppgift-frågor och full uppgiftskännedom när allt är känt", async () => {
    const resultat = await assembleraAnalys({
      extraction: extraktion,
      input: inputKomplett,
      prisdatakalla: new TomPrisdatakalla(),
      analys: analysJudgement,
    });

    expect(resultat.fragor.filter((f) => f.ursprung === "saknad_uppgift")).toHaveLength(0);
    expect(resultat.datakvalitet.uppgifterKanda).toBe(resultat.datakvalitet.uppgifterTotalt);
    expect(resultat.datakvalitet.saknadeFalt).toHaveLength(0);
    // analys-frågorna följer med oförändrade.
    expect(resultat.fragor.some((f) => f.id === "fraga-stambyte")).toBe(true);
  });

  it("genererar en saknad_uppgift-fråga per okänt Tristate-fält och minskar uppgifterKanda i motsvarande grad", async () => {
    const resultat = await assembleraAnalys({
      extraction: extraktion,
      input: inputAllaOkanda,
      prisdatakalla: new TomPrisdatakalla(),
      analys: analysJudgement,
    });

    const saknadUppgift = resultat.fragor.filter((f) => f.ursprung === "saknad_uppgift");
    // hiss + balkong + 5 avgiftInkluderar-poster = 7 okända Tristate-fält.
    expect(saknadUppgift).toHaveLength(7);
    expect(resultat.datakvalitet.uppgifterTotalt).toBe(9);
    expect(resultat.datakvalitet.uppgifterKanda).toBe(2); // vaning + byggar
    expect(resultat.datakvalitet.saknadeFalt).toHaveLength(7);
    // Varje fråga ska vara en riktig, avslutad svensk fråga, inte en platshållare.
    for (const fraga of saknadUppgift) {
      expect(fraga.fraga.length).toBeGreaterThan(0);
      expect(fraga.riktadTill).toBe("maklaren");
    }
  });

  it("hoppar över en avgiftInkluderar-fråga när föreningen redan gett ett definitivt svar", async () => {
    const foreningMedSvar: Forening = {
      ...extraktion.forening,
      avgiftInkluderarEnligtForening: {
        varme: "ja",
        vatten: "okant",
        el: "nej",
        bredband: "okant",
        tv: "okant",
      },
    };
    const resultat = await assembleraAnalys({
      extraction: { ...extraktion, forening: foreningMedSvar },
      input: inputAllaOkanda,
      prisdatakalla: new TomPrisdatakalla(),
      analys: analysJudgement,
    });

    const saknadUppgift = resultat.fragor.filter((f) => f.ursprung === "saknad_uppgift");
    // varme och el har redan definitiva svar i föreningen -> ingen fråga för dem.
    // hiss, balkong, vatten, bredband, tv kvarstår = 5.
    expect(saknadUppgift).toHaveLength(5);
    expect(saknadUppgift.some((f) => f.id.includes("varme"))).toBe(false);
    expect(saknadUppgift.some((f) => f.id.includes("el"))).toBe(false);
  });

  it("TomPrisdatakalla ger en Prisanalys utan avvikelsefält och med konfidensUtanPrisdata()", async () => {
    const resultat = await assembleraAnalys({
      extraction: extraktion,
      input: inputKomplett,
      prisdatakalla: new TomPrisdatakalla(),
      analys: analysJudgement,
    });

    expect("avvikelseMotVardering" in resultat.prisanalys).toBe(false);
    expect("avvikelseMotForeningen" in resultat.prisanalys).toBe(false);
    expect(resultat.prisanalys.konfidens).toEqual(konfidensUtanPrisdata());
    expect(resultat.prisanalys.slutsats).toMatch(/ingen oberoende/i);
  });

  describe("SchablonPrisdatakalla — en schablon får aldrig höja konfidensen", () => {
    // En platt schablon på 80 000 kr/m² är ingen oberoende prisreferens: den
    // vet ingenting om just den här lägenheten, om läget eller om skicket.
    // Att låta den lyfta konfidensen från 'lag' till 'medel' — och kalla sig
    // "oberoende prisreferens" i skälet — vore precis det som CLAUDE.md
    // förbjuder: en gissning som ser ut som ett faktum.
    const schablonkalla = () => new SchablonPrisdatakalla({ boarea: inputKomplett.boarea });

    it("håller konfidensen kvar på 'lag' trots att värderingen har ett värde", async () => {
      const prisanalys = await byggPrisanalys(inputKomplett, schablonkalla());

      expect(prisanalys.externVardering?.value).not.toBeNull();
      expect(prisanalys.konfidens.niva).toBe("lag");
    });

    it("beskriver aldrig schablonen som en oberoende prisreferens", async () => {
      const prisanalys = await byggPrisanalys(inputKomplett, schablonkalla());

      const skal = (prisanalys.konfidens.skal ?? []).join(" ");
      expect(skal).not.toMatch(/oberoende prisreferens kunde hämtas/i);
      expect(`${skal} ${prisanalys.slutsats}`).toMatch(/schablon/i);
    });

    it("säger i slutsatsen att jämförelsen görs mot en schablon, inte mot en värdering", async () => {
      const prisanalys = await byggPrisanalys(inputKomplett, schablonkalla());

      expect(prisanalys.slutsats).toMatch(/schablon/i);
      // Får inte påstå att priset stämts av mot en riktig värdering.
      expect(prisanalys.slutsats).not.toMatch(/extern värdering/i);
    });

    it("räknar ändå fram avvikelsen mot schablonen — det är det talet som ska visas", async () => {
      const prisanalys = await byggPrisanalys(inputKomplett, schablonkalla());

      // utgangspris 4 950 000 mot schablon 62 m² × 80 000 = 4 960 000
      expect(prisanalys.avvikelseMotVardering).toBeCloseTo(-0.2, 1);
    });

    it("en riktig extern källa höjer däremot konfidensen", async () => {
      // Samma form som schablonen, men source 'extern' — bevisar att det är
      // källans proveniens som styr konfidensen, inte att ett värde finns.
      const riktigKalla = {
        hamtaVardering: async () => ({
          value: 5_000_000,
          unit: "kr" as const,
          source: "extern" as const,
          leverantor: "Testleverantör",
        }),
        hamtaForsaljningarIForeningen: async () => [],
        hamtaOmradeMedian: async () => null,
      };

      const prisanalys = await byggPrisanalys(inputKomplett, riktigKalla);

      expect(prisanalys.konfidens.niva).toBe("medel");
    });
  });

  it("DemoPrisdatakallans null-värden ger utelämnade avvikelsefält, aldrig en påhittad procentsats", async () => {
    // Testar byggPrisanalys direkt (inte assembleraAnalys) — se kommentaren
    // i nästa test om varför hela vägen genom AnalysisResultSchema idag
    // inte går att köra för DemoPrisdatakalla.
    const prisanalys = await byggPrisanalys(
      inputKomplett,
      new DemoPrisdatakalla({
        utgangspris: inputKomplett.utgangspris,
        boarea: inputKomplett.boarea,
      }),
    );

    expect("avvikelseMotVardering" in prisanalys).toBe(false);
    expect("avvikelseMotForeningen" in prisanalys).toBe(false);
    // Externvärderingen finns strukturellt (för UI:t) men bär inget tal.
    expect(prisanalys.externVardering?.value).toBeNull();
    expect(prisanalys.konfidens).toEqual(konfidensUtanPrisdata());
  });

  it("slutförs och validerar när priskällan fyller i externVardering (regression: FigureSchema.and(leverantor) avvisade tidigare varje populerad externVardering)", async () => {
    // schema.ts definierade tidigare externVardering som
    // FigureSchema.and(z.object({ leverantor: z.string() })). FigureSchema
    // är .strict(), och Zod validerar båda sidor av en intersection mot
    // HELA det sammanslagna objektet — den strikta sidan avvisade då
    // 'leverantor' som ett okänt fält, så EVERY Prisanalys med en populerad
    // externVardering (vilket DemoPrisdatakalla alltid producerar, och
    // vilket varje riktig priskälla i produktion också kommer göra) kunde
    // aldrig validera mot AnalysisResultSchema. Fixat i schema.ts genom att
    // bygga externVardering med .extend() på FigureSchemas bas istället för
    // en strikt-mot-strikt intersection. Detta test låser fastet.
    const resultat = await assembleraAnalys({
      extraction: extraktion,
      input: inputKomplett,
      prisdatakalla: new DemoPrisdatakalla({
        utgangspris: inputKomplett.utgangspris,
        boarea: inputKomplett.boarea,
      }),
      analys: analysJudgement,
    });

    expect(resultat.prisanalys.externVardering?.leverantor).toContain("PLATSHÅLLARE");
  });

  it("räknar prisPerM2 korrekt och avrundar till heltal", async () => {
    const resultat = await assembleraAnalys({
      extraction: extraktion,
      input: inputKomplett,
      prisdatakalla: new TomPrisdatakalla(),
      analys: analysJudgement,
    });

    // 4 950 000 / 62 = 79 838,709... -> 79 839
    expect(resultat.prisanalys.prisPerM2.value).toBe(79839);
    expect(resultat.prisanalys.prisPerM2.source).toBe("berakning");
    expect(Number.isInteger(resultat.prisanalys.prisPerM2.value)).toBe(true);
  });

  it("propagerar SaknarRantekanslighetError när nyckeltalet saknas i årsredovisningen", async () => {
    await expect(
      assembleraAnalys({
        extraction: extraktionUtanRantekanslighet(),
        input: inputKomplett,
        prisdatakalla: new TomPrisdatakalla(),
        analys: analysJudgement,
      }),
    ).rejects.toThrow(SaknarRantekanslighetError);
  });

  it("producerar ett resultat som validerar mot AnalysisResultSchema", async () => {
    // TomPrisdatakalla, inte DemoPrisdatakalla: se testet ovan om den
    // separata, oberoende bristen i schema.ts:s externVardering-definition.
    const resultat = await assembleraAnalys({
      extraction: extraktion,
      input: inputKomplett,
      prisdatakalla: new TomPrisdatakalla(),
      analys: analysJudgement,
    });

    const parsed = AnalysisResultSchema.safeParse(resultat);
    expect(parsed.success).toBe(true);
  });

  it("innehåller aldrig manadskostnad — lånedata är inte längre del av det persisterade kontraktet", async () => {
    const resultat = await assembleraAnalys({
      extraction: extraktion,
      input: inputKomplett,
      prisdatakalla: new TomPrisdatakalla(),
      analys: analysJudgement,
    });

    expect(resultat).not.toHaveProperty("manadskostnad");
  });

  it("sätter gratisSektioner till den fasta uppsättningen från kontraktet", async () => {
    const resultat = await assembleraAnalys({
      extraction: extraktion,
      input: inputKomplett,
      prisdatakalla: new TomPrisdatakalla(),
      analys: analysJudgement,
    });

    expect(resultat.gratisSektioner).toEqual(["betyg", "rodaFlaggor_topp2", "datakvalitet"]);
  });

  it("kopierar input och förening rakt igenom, och slår ihop betyg/rodaFlaggor/fragor från pass 2", async () => {
    const resultat = await assembleraAnalys({
      extraction: extraktion,
      input: inputKomplett,
      prisdatakalla: new TomPrisdatakalla(),
      analys: analysJudgement,
    });

    expect(resultat.input).toEqual(inputKomplett);
    expect(resultat.forening).toEqual(extraktion.forening);
    expect(resultat.betyg).toBe("C");
    expect(resultat.rodaFlaggor).toEqual(analysJudgement.rodaFlaggor);
    expect(resultat.analysisId).toBeTruthy();
    expect(() => new Date(resultat.skapad).toISOString()).not.toThrow();
  });

  describe("injicerbara analysisId/skapad — för idempotent omkörning mot en befintlig jobbrad", () => {
    const injiceradId = "some-fixed-id";
    const injiceratDatum = "2026-01-01T00:00:00.000Z";

    it("använder de injicerade värdena exakt, i stället för att generera egna", async () => {
      const resultat = await assembleraAnalys({
        extraction: extraktion,
        input: inputKomplett,
        prisdatakalla: new TomPrisdatakalla(),
        analys: analysJudgement,
        analysisId: injiceradId,
        skapad: injiceratDatum,
      });

      expect(resultat.analysisId).toBe(injiceradId);
      expect(resultat.skapad).toBe(injiceratDatum);
    });

    it("genererar ett UUID-format analysisId och ett parsbart ISO-datum när båda utelämnas", async () => {
      const resultat = await assembleraAnalys({
        extraction: extraktion,
        input: inputKomplett,
        prisdatakalla: new TomPrisdatakalla(),
        analys: analysJudgement,
      });

      expect(resultat.analysisId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(() => new Date(resultat.skapad).toISOString()).not.toThrow();
    });

    it("är idempotent: två anrop med samma injicerade analysisId/skapad ger byte-identiskt JSON", async () => {
      const grundinput = {
        extraction: extraktion,
        input: inputKomplett,
        prisdatakalla: new TomPrisdatakalla(),
        analys: analysJudgement,
        analysisId: injiceradId,
        skapad: injiceratDatum,
      };

      const forstaKorningen = await assembleraAnalys(grundinput);
      const andraKorningen = await assembleraAnalys(grundinput);

      expect(JSON.stringify(andraKorningen)).toBe(JSON.stringify(forstaKorningen));
    });
  });
});
