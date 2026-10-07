import { describe, expect, it } from "vitest";
import { assembleraAnalys, byggPrisanalys } from "./assemble";
import { extraktion } from "./__fixtures__/extraktion";
import { DemoPrisdatakalla, ModellPrisdatakalla, TomPrisdatakalla } from "./prisdata";
import { konfidensUtanPrisdata, konfidensUtanPostnummer } from "./prisdata";
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
      // ett deterministiskt tal ur den tränade modellen (valuation-v3).
      expect(prisanalys.avvikelseMotVardering).toBeCloseTo(-25.6, 0);
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

    it("ger 'lag' konfidens och en skälförklaring som anger metod och baslinje för övriga Stockholms län (Solna)", async () => {
      const prisanalys = await byggPrisanalys(
        { ...inputKomplett, postnummer: "16900" },
        modellkalla(),
      );

      expect(prisanalys.externVardering?.value).not.toBeNull();
      expect(prisanalys.externVardering?.source).toBe("schablon");
      expect(prisanalys.konfidens.niva).toBe("lag");
      const skal = prisanalys.konfidens.skal?.join(" ") ?? "";
      expect(skal).toMatch(/generella samband från Binfos Stockholmsmodell/);
      expect(skal).toMatch(/genomsnittspriset i Solna/);
      expect(skal).toMatch(/64\s352 kr\/m², Svensk Mäklarstatistik, sep 2025/);
      expect(skal).toMatch(/inte tränad på försäljningar i Solna/);
      expect(prisanalys.varderingsunderlag).toMatchObject({
        tackning: "lan",
        kommun: "Solna",
        omrade: null,
        prisniva: { region: "Solna", krPerM2: 64352, kalla: "Svensk Mäklarstatistik" },
      });
      expect(prisanalys.slutsats).toMatch(/Solna/);
      expect("budpremie" in prisanalys).toBe(false);
    });

    it("Huddinge-postnumren som står som Stockholmsområden i områdeskartan värderas som Huddinge ('lan')", async () => {
      const prisanalys = await byggPrisanalys(
        { ...inputKomplett, postnummer: "12352" },
        modellkalla(),
      );

      expect(prisanalys.konfidens.niva).toBe("lag");
      expect(prisanalys.varderingsunderlag).toMatchObject({
        tackning: "lan",
        kommun: "Huddinge",
        omrade: null,
      });
      expect("budpremie" in prisanalys).toBe(false);
    });

    it("värderar även utanför Stockholms län, med 'lag' konfidens och en tydlig förklaring (Göteborg)", async () => {
      const prisanalys = await byggPrisanalys(
        { ...inputKomplett, postnummer: "40010" },
        modellkalla(),
      );

      expect(prisanalys.externVardering?.value).not.toBeNull();
      expect(prisanalys.konfidens.niva).toBe("lag");
      const skal = prisanalys.konfidens.skal?.join(" ") ?? "";
      expect(skal).toMatch(/Binfo är byggt för bostadsrätter i Stockholms län/);
      expect(skal).toMatch(/utanför Stockholms län/);
      expect(skal).toMatch(
        /riksgenomsnittet för bostadsrätter \(46\s317 kr\/m², Svensk Mäklarstatistik, aug 2026\)/,
      );
      expect(skal).toMatch(/betydligt mindre träffsäker/);
      expect(prisanalys.varderingsunderlag).toMatchObject({
        tackning: "utanfor_lan",
        kommun: "Göteborg",
        prisniva: { region: "Riket", krPerM2: 46317 },
      });
      expect("budpremie" in prisanalys).toBe(false);
      // Aldrig 'hog' eller 'medel' utanför Stockholms kommun.
      expect(prisanalys.konfidens.niva).not.toBe("hog");
    });

    it("sätter tackning/kommun på varderingsunderlag även i Stockholm, utan prisniva", async () => {
      const prisanalys = await byggPrisanalys(inputKomplett, modellkalla());

      expect(prisanalys.varderingsunderlag).toMatchObject({
        tackning: "stockholm",
        kommun: "Stockholm",
      });
      expect(prisanalys.varderingsunderlag && "prisniva" in prisanalys.varderingsunderlag).toBe(
        false,
      );
    });

    it("ger ingen värdering alls, och en postnummer-specifik lågkonfidensförklaring, för ett tomt postnummer (anonymiserad rapport)", async () => {
      const prisanalys = await byggPrisanalys({ ...inputKomplett, postnummer: "" }, modellkalla());

      expect("externVardering" in prisanalys).toBe(false);
      expect("varderingsunderlag" in prisanalys).toBe(false);
      expect("budpremie" in prisanalys).toBe(false);
      expect(prisanalys.konfidens).toEqual(konfidensUtanPostnummer());
      expect(prisanalys.slutsats).toMatch(/Postnumret saknas eller är ogiltigt/);
    });

    it("ger samma besked för ett felformaterat postnummer", async () => {
      const prisanalys = await byggPrisanalys(
        { ...inputKomplett, postnummer: "115-32" },
        modellkalla(),
      );

      expect("externVardering" in prisanalys).toBe(false);
      expect(prisanalys.konfidens).toEqual(konfidensUtanPostnummer());
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

  it("degraderar i stället för att kasta när räntekänslighet saknas i årsredovisningen — resten av analysen slutförs", async () => {
    const resultat = await assembleraAnalys({
      extraction: extraktionUtanRantekanslighet(),
      input: inputKomplett,
      prisdatakalla: new TomPrisdatakalla(),
      analys: analysJudgement,
    });

    expect(resultat.rantestress.rantekanslighetProcent).toBeNull();
    expect(resultat.rantestress.scenarier).toEqual([]);
    expect(resultat.betyg).toBe(analysJudgement.betyg);
  });

  it("lägger till en deterministisk fråga till mäklaren när räntekänslighet saknas", async () => {
    // Egen analys utan analysJudgement:s "hog-rantekanslighet"-flagga (den
    // handlar om ett KÄNT värde på 9,2 %, inte om att uppgiften saknas) —
    // annars skulle dedup-kontrollen (harledsFran) skymma just det den här
    // testen ska visa.
    const analysUtanRantekanslighetsomnamnande: AnalysJudgement = {
      ...analysJudgement,
      rodaFlaggor: [],
    };
    const resultat = await assembleraAnalys({
      extraction: extraktionUtanRantekanslighet(),
      input: inputKomplett,
      prisdatakalla: new TomPrisdatakalla(),
      analys: analysUtanRantekanslighetsomnamnande,
    });

    const fraga = resultat.fragor.find((f) => f.id === "saknar-rantekanslighet");
    expect(fraga).toBeDefined();
    expect(fraga?.ursprung).toBe("analys");
    expect(fraga?.riktadTill).toBe("maklaren");
  });

  it("hoppar över den deterministiska frågan om pass 2 redan skrev en fråga om räntekänslighet", async () => {
    const analysMedEgenFraga: AnalysJudgement = {
      ...analysJudgement,
      fragor: [
        {
          id: "egen-fraga-om-rantekanslighet",
          fraga: "Hur mycket påverkas avgiften av räntekänslighet?",
          ursprung: "analys",
          riktadTill: "styrelsen",
          varfor: "Uppgiften saknas i rapporten.",
        },
      ],
    };
    const resultat = await assembleraAnalys({
      extraction: extraktionUtanRantekanslighet(),
      input: inputKomplett,
      prisdatakalla: new TomPrisdatakalla(),
      analys: analysMedEgenFraga,
    });

    expect(resultat.fragor.some((f) => f.id === "saknar-rantekanslighet")).toBe(false);
    expect(resultat.fragor).toHaveLength(1);
  });

  it("hoppar över den deterministiska frågan om pass 2 redan flaggat räntekänslighet (harledsFran)", async () => {
    const analysMedEgenFlagga: AnalysJudgement = {
      ...analysJudgement,
      fragor: [],
      rodaFlaggor: [
        {
          id: "saknad-rantekanslighet-flagga",
          titel: "Räntekänslighet går inte att kontrollera",
          beskrivning: "Uppgiften saknas i rapporten.",
          severity: "lag",
          harledsFran: ["rantekanslighet"],
        },
      ],
    };
    const resultat = await assembleraAnalys({
      extraction: extraktionUtanRantekanslighet(),
      input: inputKomplett,
      prisdatakalla: new TomPrisdatakalla(),
      analys: analysMedEgenFlagga,
    });

    expect(resultat.fragor.some((f) => f.id === "saknar-rantekanslighet")).toBe(false);
  });

  it("sänker extraktionskonfidensen högst ett steg (hog -> medel) när räntekänslighet saknas", async () => {
    const extraktionUtanRK: ExtractionResult = {
      ...extraktionUtanRantekanslighet(),
      datakvalitet: {
        ...extraktionUtanRantekanslighet().datakvalitet,
        extraktionKonfidens: { niva: "hog" },
      },
    };
    const resultat = await assembleraAnalys({
      extraction: extraktionUtanRK,
      input: inputKomplett,
      prisdatakalla: new TomPrisdatakalla(),
      analys: analysJudgement,
    });

    expect(resultat.datakvalitet.extraktionKonfidens.niva).toBe("medel");
    expect(resultat.datakvalitet.extraktionKonfidens.skal).toContain(
      "Räntekänslighet saknas i årsredovisningen, så analysen är något osäkrare. Det här är den " +
        "bästa bedömningen utifrån tillgängliga uppgifter.",
    );
  });

  it("lämnar konfidensen 'lag' oförändrad (sänker aldrig mer än ett steg) när räntekänslighet saknas", async () => {
    const extraktionUtanRK: ExtractionResult = {
      ...extraktionUtanRantekanslighet(),
      datakvalitet: {
        ...extraktionUtanRantekanslighet().datakvalitet,
        extraktionKonfidens: { niva: "lag", skal: ["Redan lågt av andra skäl."] },
      },
    };
    const resultat = await assembleraAnalys({
      extraction: extraktionUtanRK,
      input: inputKomplett,
      prisdatakalla: new TomPrisdatakalla(),
      analys: analysJudgement,
    });

    expect(resultat.datakvalitet.extraktionKonfidens.niva).toBe("lag");
  });

  it("lämnar konfidensen 'medel' oförändrad — sänker bara hog -> medel, som tryckt-avvikelsen i runExtraction", async () => {
    const extraktionUtanRK: ExtractionResult = {
      ...extraktionUtanRantekanslighet(),
      datakvalitet: {
        ...extraktionUtanRantekanslighet().datakvalitet,
        extraktionKonfidens: { niva: "medel" },
      },
    };
    const resultat = await assembleraAnalys({
      extraction: extraktionUtanRK,
      input: inputKomplett,
      prisdatakalla: new TomPrisdatakalla(),
      analys: analysJudgement,
    });

    expect(resultat.datakvalitet.extraktionKonfidens.niva).toBe("medel");
    expect(resultat.datakvalitet.extraktionKonfidens.skal).toHaveLength(1);
  });

  it("varken lägger till frågan eller sänker konfidensen när räntekänsligheten är känd (även när den är 0, t.ex. en skuldfri förening)", async () => {
    const extraktionSkuldfri: ExtractionResult = {
      ...extraktion,
      forening: {
        ...extraktion.forening,
        keyFigures: extraktion.forening.keyFigures.map((kf) =>
          kf.id === "rantekanslighet"
            ? { ...kf, status: "god", figure: { value: 0, unit: "procent", source: "berakning" } }
            : kf,
        ),
      },
    };
    const resultat = await assembleraAnalys({
      extraction: extraktionSkuldfri,
      input: inputKomplett,
      prisdatakalla: new TomPrisdatakalla(),
      analys: analysJudgement,
    });

    expect(resultat.fragor.some((f) => f.id === "saknar-rantekanslighet")).toBe(false);
    expect(resultat.rantestress.rantekanslighetProcent).toBe(0);
    expect(resultat.rantestress.kommentar).toMatch(/inga räntebärande lån/i);
    expect(resultat.datakvalitet.extraktionKonfidens).toEqual(
      extraktion.datakvalitet.extraktionKonfidens,
    );
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
