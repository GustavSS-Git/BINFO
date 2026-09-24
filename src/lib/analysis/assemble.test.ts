import { describe, expect, it } from "vitest";
import { assembleraAnalys, byggPrisanalys } from "./assemble";
import { extraktion } from "./__fixtures__/extraktion";
import { DemoPrisdatakalla, ModellPrisdatakalla, TomPrisdatakalla } from "./prisdata";
import { konfidensUtanPrisdata, konfidensUtanforStockholm } from "./prisdata";
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

  describe("ModellPrisdatakalla — task 4g/5, Binfos egen värderingsmodell", () => {
    const modellkalla = () => new ModellPrisdatakalla();

    it("ger 'medel' konfidens för ett kartlagt Stockholmsområde, aldrig 'hog'", async () => {
      // inputKomplett.postnummer = "11857" -> Södermalm i den riktiga
      // kartläggningstabellen (src/lib/vardering/data/postnummerOmrade.data.ts).
      const prisanalys = await byggPrisanalys(inputKomplett, modellkalla());

      expect(prisanalys.externVardering?.value).not.toBeNull();
      expect(prisanalys.externVardering?.source).toBe("schablon");
      expect(prisanalys.konfidens.niva).toBe("medel");
      expect(prisanalys.varderingsunderlag?.omrade).toBe("Södermalm");
      expect(prisanalys.budpremie).toBeDefined();
    });

    it("beskriver aldrig modellen som en tredjepartsvärdering", async () => {
      const prisanalys = await byggPrisanalys(inputKomplett, modellkalla());

      expect(prisanalys.externVardering?.leverantor).toMatch(/^Binfo värderingsmodell /);
      expect(prisanalys.slutsats).toMatch(/Binfos värderingsmodell/);
      // Får inte påstå att priset stämts av mot en tredjepartsvärdering.
      expect(prisanalys.slutsats).not.toMatch(/extern värdering/i);
    });

    it("säger i slutsatsen om utgångspriset ligger inom eller utanför modellens intervall", async () => {
      const prisanalys = await byggPrisanalys(inputKomplett, modellkalla());

      expect(prisanalys.slutsats).toMatch(/(inom|utanför) modellens 90-procentiga intervall/);
    });

    it("räknar fram avvikelsen mot modellens punktskattning", async () => {
      const prisanalys = await byggPrisanalys(inputKomplett, modellkalla());

      // utgångspris 4 950 000 mot modellens punktskattning för 11857 (Södermalm),
      // ett deterministiskt tal ur den tränade modellen (~6 597 964 kr).
      expect(prisanalys.avvikelseMotVardering).toBeCloseTo(-25.0, 0);
    });

    it("faller tillbaka till 'lag' konfidens och Stockholmsövergripande område för ett okartlagt men känt Stockholmsprefix", async () => {
      // 12364 delar 3-siffersprefixet 123 med kartlagda koder (t.ex. 12322 ->
      // Farsta-Vantör) men är inte självt kartlagt.
      const prisanalys = await byggPrisanalys(
        { ...inputKomplett, postnummer: "12364" },
        modellkalla(),
      );

      expect(prisanalys.externVardering?.value).not.toBeNull();
      expect(prisanalys.konfidens.niva).toBe("lag");
      expect(prisanalys.varderingsunderlag?.omrade).toBeNull();
      expect(prisanalys.budpremie?.omrade).toBeNull();
      expect(prisanalys.konfidens.skal?.join(" ")).toMatch(/inte kopplas till ett specifikt/i);
    });

    it("ger ingen värdering alls, och en Stockholms-specifik lågkonfidensförklaring, utanför Stockholm", async () => {
      const prisanalys = await byggPrisanalys(
        { ...inputKomplett, postnummer: "99999" },
        modellkalla(),
      );

      expect("externVardering" in prisanalys).toBe(false);
      expect("varderingsunderlag" in prisanalys).toBe(false);
      expect("budpremie" in prisanalys).toBe(false);
      expect(prisanalys.konfidens).toEqual(konfidensUtanforStockholm());
      expect(prisanalys.slutsats).toMatch(/Stockholms kommun/);
    });

    it("ger samma 'utanför Stockholm'-besked för ett tomt postnummer (anonymiserad rapport)", async () => {
      const prisanalys = await byggPrisanalys({ ...inputKomplett, postnummer: "" }, modellkalla());

      expect("externVardering" in prisanalys).toBe(false);
      expect(prisanalys.konfidens).toEqual(konfidensUtanforStockholm());
    });

    it("en riktig extern källa höjer däremot konfidensen (utan att koppla på något varderingsunderlag)", async () => {
      // Samma form som modellen, men source 'extern' — bevisar att det är
      // källans proveniens som styr konfidensen, inte att ett värde finns.
      // Postnumret (11857) ligger inom modellens räckvidd, men eftersom
      // källan inte är en schablon kopplas inget varderingsunderlag på.
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
      expect("varderingsunderlag" in prisanalys).toBe(false);
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
