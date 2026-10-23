import { describe, expect, it } from "vitest";
import {
  AnalysJudgementSchema,
  AnalysisResultSchema,
  FragaSchema,
  ExtractionResultSchema,
  FigureMedLeverantorSchema,
  FigureSchema,
  ForeningSchema,
  KeyFigureIdSchema,
  LaneUnderlagSchema,
  ManadskostnadSchema,
  PrisanalysSchema,
  PropertyInputSchema,
  TristateSchema,
} from "./schema";
import type {
  AnalysisResult,
  ExtractionResult,
  Figure,
  KeyFigure,
  KeyFigureId,
} from "@/types/analysis";

const ALLA_NYCKELTAL_ID: KeyFigureId[] = [
  "arsavgift_per_m2_brf_yta",
  "arsavgift_andel_av_rorelseintakter",
  "skuldsattning_per_m2_totalyta",
  "skuldsattning_per_m2_brf_yta",
  "sparande_per_m2_totalyta",
  "rantekanslighet",
  "energikostnad_per_m2_totalyta",
];

function nyckeltal(): KeyFigure[] {
  return ALLA_NYCKELTAL_ID.map((id) => ({
    id,
    label: id,
    figure: {
      value: 100,
      unit: "kr/m2",
      source: "arsredovisning",
      ref: { page: 4, excerpt: "Testcitat från rapporten" },
    },
    status: "god",
    forklaring: "Testförklaring.",
  }));
}

const validExtractionResult: ExtractionResult = {
  schemaVersion: "1.0.0",
  forening: {
    namn: "Brf Testgården",
    orgnr: "769612-3456",
    akta: "ja",
    rakenskapsar: 2025,
    keyFigures: nyckeltal(),
  },
  datakvalitet: {
    pdfSaknarTextlager: false,
    extraktionKonfidens: { niva: "hog" },
    saknadeFalt: [],
  },
};

const validAnalysisResult: AnalysisResult = {
  schemaVersion: "1.0.0",
  analysisId: "test-1",
  skapad: "2026-09-10T00:00:00.000Z",
  input: {
    kind: "bostadsratt",
    utgangspris: 4_950_000,
    boarea: 58,
    antalRum: 3,
    manadsavgift: 3_240,
    andelstal: 2.1,
    orgnr: "769612-3456",
    adress: "Kapellgränd 12",
    postnummer: "116 25",
    ort: "Stockholm",
    hiss: "okant",
    balkong: "okant",
    avgiftInkluderar: { varme: "nej", vatten: "nej", el: "nej", bredband: "nej", tv: "nej" },
    antalPersoner: 2,
  },
  forening: validExtractionResult.forening,
  betyg: "B",
  betygMotivering: "Stabil förening.",
  rodaFlaggor: [],
  prisanalys: {
    utgangspris: { value: 4_950_000, unit: "kr", source: "anvandare" },
    prisPerM2: { value: 85_345, unit: "kr/m2", source: "berakning" },
    slutsats: "Rimligt utgångspris.",
    konfidens: { niva: "hog" },
  },
  rantestress: {
    rantekanslighetProcent: 12.7,
    nuvarandeManadsavgift: {
      value: 3_240,
      unit: "kr/man",
      source: "arsredovisning",
      ref: { page: 5, excerpt: "Månadsavgiften uppgår till 3 240 kr" },
    },
    scenarier: [
      {
        okningPe: 0,
        nyManadsavgift: { value: 3_240, unit: "kr/man", source: "berakning" },
        avgiftsokningKrPerManad: { value: 0, unit: "kr/man", source: "berakning" },
      },
    ],
    kommentar: "Avgiften är känslig för ränteuppgångar.",
  },
  fragor: [],
  datakvalitet: {
    ...validExtractionResult.datakvalitet,
    uppgifterKanda: 5,
    uppgifterTotalt: 7,
  },
  gratisSektioner: ["betyg", "datakvalitet"],
};

describe("TristateSchema", () => {
  it("accepterar ja/nej/okant", () => {
    expect(TristateSchema.safeParse("ja").success).toBe(true);
    expect(TristateSchema.safeParse("nej").success).toBe(true);
    expect(TristateSchema.safeParse("okant").success).toBe(true);
  });

  it("avvisar boolean och null — okänt får aldrig se ut som falskt", () => {
    expect(TristateSchema.safeParse(true).success).toBe(false);
    expect(TristateSchema.safeParse(false).success).toBe(false);
    expect(TristateSchema.safeParse(null).success).toBe(false);
    expect(TristateSchema.safeParse("yes").success).toBe(false);
  });
});

describe("FigureSchema", () => {
  const beraknad: Figure = { value: 100, unit: "kr", source: "berakning" };

  it("accepterar en beräknad figur utan ref eller schablonBasis", () => {
    expect(FigureSchema.safeParse(beraknad).success).toBe(true);
  });

  it("kräver PageRef när source är 'arsredovisning' — en siffra utan citat kan inte visas", () => {
    const utanRef: Figure = { value: 100, unit: "kr", source: "arsredovisning" };
    const r = FigureSchema.safeParse(utanRef);
    expect(r.success).toBe(false);

    const medRef: Figure = { ...utanRef, ref: { page: 4, excerpt: "Beloppet uppgår till 100 kr" } };
    expect(FigureSchema.safeParse(medRef).success).toBe(true);
  });

  it("kräver excerpt på ref:en när source är 'arsredovisning' — en sidhänvisning utan citat bevisar ingenting", () => {
    const utanExcerpt: Figure = {
      value: 100,
      unit: "kr",
      source: "arsredovisning",
      ref: { page: 4 },
    };
    expect(FigureSchema.safeParse(utanExcerpt).success).toBe(false);

    const tomExcerpt: Figure = {
      value: 100,
      unit: "kr",
      source: "arsredovisning",
      ref: { page: 4, excerpt: "" },
    };
    expect(FigureSchema.safeParse(tomExcerpt).success).toBe(false);

    const medExcerpt: Figure = {
      value: 100,
      unit: "kr",
      source: "arsredovisning",
      ref: { page: 4, excerpt: "Beloppet uppgår till 100 kr" },
    };
    expect(FigureSchema.safeParse(medExcerpt).success).toBe(true);
  });

  it("kräver INTE excerpt för andra källor — endast arsredovisning kräver ett citat", () => {
    const berak: Figure = {
      value: 100,
      unit: "kr",
      source: "berakning",
      ref: { page: 4 },
    };
    expect(FigureSchema.safeParse(berak).success).toBe(true);
  });

  it("kräver schablonBasis när source är 'schablon' — en gissning får aldrig se ut som ett faktum", () => {
    const utanBasis: Figure = { value: 250, unit: "kr/man", source: "schablon" };
    expect(FigureSchema.safeParse(utanBasis).success).toBe(false);

    const medBasis: Figure = { ...utanBasis, schablonBasis: "250 kr + 8 kr/m²" };
    expect(FigureSchema.safeParse(medBasis).success).toBe(true);
  });

  it("avvisar en enhet utanför den tillåtna listan", () => {
    const felaktig = { ...beraknad, unit: "sek" };
    expect(FigureSchema.safeParse(felaktig).success).toBe(false);
  });

  it("avvisar okända extra fält (modellen har hallucinerat en nyckel)", () => {
    const extraFalt = { ...beraknad, konfidensprocent: 99 };
    expect(FigureSchema.safeParse(extraFalt).success).toBe(false);
  });

  describe("tecken och tryckt", () => {
    it("accepterar tecken 'negativ' tillsammans med value null", () => {
      const figur: Figure = { value: null, unit: "kr/m2", source: "berakning", tecken: "negativ" };
      expect(FigureSchema.safeParse(figur).success).toBe(true);
    });

    it("accepterar tryckt utan tecken (en ren transkription, t.ex. '(123)' innan tolkning)", () => {
      const figur: Figure = { value: null, unit: "kr/m2", source: "berakning", tryckt: "neg" };
      expect(FigureSchema.safeParse(figur).success).toBe(true);
    });

    it("accepterar tecken som stämmer med value:s eget tecken", () => {
      const negativ: Figure = { value: -50, unit: "kr/m2", source: "berakning", tecken: "negativ" };
      expect(FigureSchema.safeParse(negativ).success).toBe(true);

      const positiv: Figure = { value: 50, unit: "kr/m2", source: "berakning", tecken: "positiv" };
      expect(FigureSchema.safeParse(positiv).success).toBe(true);
    });

    it("avvisar tecken som motsäger value:s eget tecken", () => {
      const motsagelse: Figure = {
        value: 42,
        unit: "kr/m2",
        source: "berakning",
        tecken: "negativ",
      };
      expect(FigureSchema.safeParse(motsagelse).success).toBe(false);
    });

    it("avvisar tecken satt tillsammans med value 0 — noll har inget tecken", () => {
      const noll: Figure = { value: 0, unit: "kr/m2", source: "berakning", tecken: "positiv" };
      expect(FigureSchema.safeParse(noll).success).toBe(false);
    });

    it("en figur med source 'arsredovisning' kräver fortfarande sin PageRef, oavsett tryckt/tecken", () => {
      const utanRef: Figure = {
        value: null,
        unit: "kr/m2",
        source: "arsredovisning",
        tecken: "negativ",
      };
      expect(FigureSchema.safeParse(utanRef).success).toBe(false);

      const medRef: Figure = {
        ...utanRef,
        ref: { page: 4, excerpt: "Sparande per kvm, kr neg" },
      };
      expect(FigureSchema.safeParse(medRef).success).toBe(true);
    });
  });
});

describe("FigureMedLeverantorSchema", () => {
  // Regression: tidigare byggdes externVardering som
  // FigureSchema.and(z.object({ leverantor: z.string() })). FigureSchema är
  // .strict(), och Zod validerar båda sidor av en intersection mot HELA det
  // sammanslagna objektet — den strikta sidan avvisade då 'leverantor' som
  // ett okänt fält. Resultatet: EVERY Prisanalys med en populerad
  // externVardering (vilket varje riktig eller demo-priskälla producerar)
  // kunde aldrig validera. Fixat genom att bygga en egen bas-shape
  // (FigureObjectSchema) och lägga leverantor på med .extend() istället.
  it("accepterar en figur plus leverantor — den kombination FigureSchema.and() tidigare avvisade", () => {
    const vardering = {
      value: 5_100_000,
      unit: "kr",
      source: "extern",
      leverantor: "Booli",
    };
    expect(FigureMedLeverantorSchema.safeParse(vardering).success).toBe(true);
  });

  it("bär samma invarianter som FigureSchema — kräver schablonBasis för source 'schablon'", () => {
    const utanBasis = { value: 100, unit: "kr", source: "schablon", leverantor: "X" };
    expect(FigureMedLeverantorSchema.safeParse(utanBasis).success).toBe(false);

    const medBasis = { ...utanBasis, schablonBasis: "Platshållare" };
    expect(FigureMedLeverantorSchema.safeParse(medBasis).success).toBe(true);
  });

  it("kräver leverantor — till skillnad från vanlig FigureSchema", () => {
    const utanLeverantor = { value: 100, unit: "kr", source: "berakning" };
    expect(FigureMedLeverantorSchema.safeParse(utanLeverantor).success).toBe(false);
  });
});

describe("PrisanalysSchema", () => {
  const bas = {
    utgangspris: { value: 4_950_000, unit: "kr", source: "anvandare" },
    prisPerM2: { value: 79_839, unit: "kr", source: "berakning" },
    slutsats: "Ingen oberoende priskälla är ansluten.",
    konfidens: { niva: "lag", skal: ["ingen priskälla"] },
  };

  it("accepterar en Prisanalys utan externVardering", () => {
    expect(PrisanalysSchema.safeParse(bas).success).toBe(true);
  });

  it("accepterar en Prisanalys med en populerad externVardering (regression för buggen ovan)", () => {
    const medVardering = {
      ...bas,
      externVardering: {
        value: null,
        unit: "kr",
        source: "schablon",
        schablonBasis: "Platshållare",
        leverantor: "PLATSHÅLLARE — ingen värderingsleverantör ansluten",
      },
    };
    expect(PrisanalysSchema.safeParse(medVardering).success).toBe(true);
  });

  it("accepterar en Prisanalys med varderingsunderlag och budpremie (task 4g) — stripas inte tyst", () => {
    const medModellunderlag = {
      ...bas,
      externVardering: {
        value: 6_597_964,
        unit: "kr",
        source: "schablon",
        schablonBasis: "Binfos värderingsmodell (valuation-v2): ...",
        range: { low: 5_123_045, high: 8_497_510 },
        leverantor: "Binfo värderingsmodell valuation-v2",
      },
      varderingsunderlag: {
        modellVersion: "valuation-v2",
        omrade: "Södermalm",
        intervallTackningProcent: 90,
        dataperiod: { fran: "2026-01-01", till: "2026-08-31" },
        antalForsaljningar: 4_991,
        typisktFelProcent: 10.3,
        drivare: [
          {
            label: "Ett rum till",
            effektProcent: 5.4,
            intervallProcent: { low: 4.0, high: 6.7 },
            niva: "stad",
          },
        ],
      },
      budpremie: {
        omrade: "Södermalm",
        medianProcent: 3.7,
        medelProcent: 5.6,
        n: 448,
        dataperiod: { fran: "2026-01-01", till: "2026-08-31" },
      },
    };
    const parsed = PrisanalysSchema.safeParse(medModellunderlag);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(medModellunderlag);
    }
  });

  it("avvisar ett okänt fält i varderingsunderlag — strict, en modellhallucination ska fela högt", () => {
    const medFelaktigtFalt = {
      ...bas,
      externVardering: {
        value: 6_597_964,
        unit: "kr",
        source: "schablon",
        schablonBasis: "x",
        leverantor: "Binfo värderingsmodell valuation-v2",
      },
      varderingsunderlag: {
        modellVersion: "valuation-v2",
        omrade: null,
        intervallTackningProcent: 90,
        dataperiod: { fran: "2026-01-01", till: "2026-08-31" },
        antalForsaljningar: 4_991,
        typisktFelProcent: 12.2,
        drivare: [],
        pahittatFalt: "borde inte accepteras",
      },
    };
    expect(PrisanalysSchema.safeParse(medFelaktigtFalt).success).toBe(false);
  });
});

describe("KeyFigureIdSchema", () => {
  it("accepterar alla sju lagstadgade nyckeltal", () => {
    for (const id of ALLA_NYCKELTAL_ID) {
      expect(KeyFigureIdSchema.safeParse(id).success).toBe(true);
    }
  });

  it("avvisar ett id som inte finns i BFNAR 2023:1-listan", () => {
    expect(KeyFigureIdSchema.safeParse("nagot_pahittat_nyckeltal").success).toBe(false);
  });
});

describe("LaneUnderlagSchema", () => {
  // Fixturen ligger inline med flit. LaneUnderlag är sedan Fas 1 Steg 0 rent
  // klientsidigt och skickas aldrig till servern, så det hör inte hemma i
  // fixtures/property-input-example.json — den filen är indata till CLI:erna,
  // som bara accepterar "input".
  it("accepterar ett fullständigt låneunderlag", () => {
    const lan = {
      lanebelopp: 2_560_000,
      kontantinsats: 640_000,
      ranta: 3.6,
      bruttoinkomst: 900_000,
      antalLantagare: 2,
    };
    expect(LaneUnderlagSchema.safeParse(lan).success).toBe(true);
  });

  it("avvisar ett okänt extra fält (.strict())", () => {
    const medExtraFalt = {
      lanebelopp: 2_560_000,
      kontantinsats: 640_000,
      ranta: 3.6,
      bruttoinkomst: 900_000,
      antalLantagare: 2,
      extraFalt: "oväntat",
    };
    expect(LaneUnderlagSchema.safeParse(medExtraFalt).success).toBe(false);
  });

  it("avvisar en sträng för ranta (fel typ)", () => {
    const felTyp = {
      lanebelopp: 2_560_000,
      kontantinsats: 640_000,
      ranta: "3.6",
      bruttoinkomst: 900_000,
      antalLantagare: 2,
    };
    expect(LaneUnderlagSchema.safeParse(felTyp).success).toBe(false);
  });

  it("avvisar antalLantagare: 3 — bara 1 eller 2 låntagare är giltigt", () => {
    const felAntal = {
      lanebelopp: 2_560_000,
      kontantinsats: 640_000,
      ranta: 3.6,
      bruttoinkomst: 900_000,
      antalLantagare: 3,
    };
    expect(LaneUnderlagSchema.safeParse(felAntal).success).toBe(false);
  });
});

describe("ManadskostnadSchema", () => {
  // Manadskostnad är sedan kontraktsändringen inte längre del av
  // AnalysisResult (den beräknas klientsidan i bolånekalkylen) men schemat
  // finns kvar och validerar fortfarande sin egen domänregel: det skärpta
  // amorteringskravet (skuldkvot > 4,5x) är slopat sedan 1 april 2026, så
  // tillampadAmorteringstakt får aldrig vara något annat än 0, 1 eller 2.
  const giltig = {
    poster: [],
    totalBrutto: { value: 5_000, unit: "kr/man", source: "berakning" },
    totalNetto: { value: 4_500, unit: "kr/man", source: "berakning" },
    amortering: {
      belaningsgrad: 80,
      skuldkvot: 4.5,
      tillampadAmorteringstakt: 2,
      overBankernasTypiskaTak: false,
    },
    ranteavdragPerAr: { value: 30_000, unit: "kr", source: "berakning" },
  };

  it("accepterar ett giltigt Manadskostnad-objekt", () => {
    expect(ManadskostnadSchema.safeParse(giltig).success).toBe(true);
  });

  it("avvisar tillampadAmorteringstakt: 3 — det skärpta kravet är slopat, får aldrig förekomma", () => {
    const trasig = structuredClone(giltig) as typeof giltig & {
      amortering: { tillampadAmorteringstakt: number };
    };
    trasig.amortering.tillampadAmorteringstakt = 3;
    expect(ManadskostnadSchema.safeParse(trasig).success).toBe(false);
  });
});

describe("ForeningSchema", () => {
  const bas = structuredClone(validExtractionResult.forening);

  it("accepterar avgiftInkluderarEnligtForening — vad rapporten själv anger ingår i avgiften", () => {
    const med = {
      ...bas,
      avgiftInkluderarEnligtForening: {
        varme: "ja",
        vatten: "ja",
        el: "nej",
        bredband: "ja",
        tv: "okant",
      },
    };
    expect(ForeningSchema.safeParse(med).success).toBe(true);
  });

  it("avgiftInkluderarEnligtForening är valfritt — rapporten säger ofta inget om detta alls", () => {
    expect(ForeningSchema.safeParse(bas).success).toBe(true);
  });

  it("kommandeAtgarder accepterar ref per post — inte längre en platt sträng-array", () => {
    const med = {
      ...bas,
      underhallsplan: {
        finns: "ja",
        kommandeAtgarder: [
          { text: "Stambyte planerat 2029", ref: { page: 6 } },
          { text: "Fasadrenovering 2031" }, // ingen exakt sida hittad — ska ändå godkännas
        ],
      },
    };
    const r = ForeningSchema.safeParse(med);
    expect(r.success).toBe(true);
  });

  it("avvisar kommandeAtgarder som en platt sträng-array (gamla formen)", () => {
    const gammalForm = {
      ...bas,
      underhallsplan: { finns: "ja", kommandeAtgarder: ["Stambyte planerat 2029"] },
    };
    expect(ForeningSchema.safeParse(gammalForm).success).toBe(false);
  });

  it("vasentligaHandelser accepterar en post utan ref — flaggas genom frånvaron av ref, döljs aldrig", () => {
    const med = {
      ...bas,
      vasentligaHandelser: [{ text: "Styrelsen har beslutat om en avgiftshöjning." }],
    };
    expect(ForeningSchema.safeParse(med).success).toBe(true);
  });

  it("vasentligaHandelser accepterar fortfarande en post med ref", () => {
    const med = {
      ...bas,
      vasentligaHandelser: [{ text: "Avgiftshöjning beslutad.", ref: { page: 7 } }],
    };
    expect(ForeningSchema.safeParse(med).success).toBe(true);
  });

  describe("antalMedlemmar/antalHyresratter/antalLokaler", () => {
    it("accepterar alla tre som vanliga Figure-fält", () => {
      const med = {
        ...bas,
        antalMedlemmar: {
          value: 43,
          unit: "antal",
          source: "arsredovisning",
          ref: { page: 3, excerpt: "Föreningen hade vid årets slut 43 (41) medlemmar" },
        },
        antalHyresratter: {
          value: 2,
          unit: "antal",
          source: "arsredovisning",
          ref: { page: 3, excerpt: "2 lokaler (hyresrätt)" },
        },
        antalLokaler: {
          value: 2,
          unit: "antal",
          source: "arsredovisning",
          ref: { page: 3, excerpt: "2 lokaler (hyresrätt)" },
        },
      };
      expect(ForeningSchema.safeParse(med).success).toBe(true);
    });

    it("kräver PageRef på antalMedlemmar när source är 'arsredovisning', precis som alla andra figurer", () => {
      const utanRef = {
        ...bas,
        antalMedlemmar: { value: 43, unit: "antal", source: "arsredovisning" },
      };
      expect(ForeningSchema.safeParse(utanRef).success).toBe(false);
    });

    it("är valfria — de flesta rapporter nämner inte allt", () => {
      expect(ForeningSchema.safeParse(bas).success).toBe(true);
    });
  });

  describe("avgiftInkluderarKallor", () => {
    it("accepterar en källa per post som avgiftInkluderarEnligtForening faktiskt har ja/nej för", () => {
      const med = {
        ...bas,
        avgiftInkluderarEnligtForening: {
          varme: "ja",
          vatten: "ja",
          el: "okant",
          bredband: "okant",
          tv: "okant",
        },
        avgiftInkluderarKallor: {
          varme: { page: 15, excerpt: "I årsavgiften ingår kostnader för värme" },
          vatten: { page: 15, excerpt: "I årsavgiften ingår kostnader för vatten" },
        },
      };
      expect(ForeningSchema.safeParse(med).success).toBe(true);
    });

    it("kräver excerpt — en sidhänvisning utan citat bevisar ingenting", () => {
      const med = {
        ...bas,
        avgiftInkluderarEnligtForening: {
          varme: "ja",
          vatten: "okant",
          el: "okant",
          bredband: "okant",
          tv: "okant",
        },
        avgiftInkluderarKallor: { varme: { page: 15 } },
      };
      expect(ForeningSchema.safeParse(med).success).toBe(false);
    });

    it("avvisar en källa för en post som är 'okant' i avgiftInkluderarEnligtForening — en källa utan ett entydigt svar bevisar ingenting", () => {
      const med = {
        ...bas,
        avgiftInkluderarEnligtForening: {
          varme: "okant",
          vatten: "okant",
          el: "okant",
          bredband: "okant",
          tv: "okant",
        },
        avgiftInkluderarKallor: { varme: { page: 15, excerpt: "Något ovidkommande citat" } },
      };
      expect(ForeningSchema.safeParse(med).success).toBe(false);
    });

    it("avvisar en källa för en post som inte alls finns i avgiftInkluderarEnligtForening", () => {
      const med = {
        ...bas,
        avgiftInkluderarKallor: { varme: { page: 15, excerpt: "Något citat" } },
      };
      expect(ForeningSchema.safeParse(med).success).toBe(false);
    });

    // Regression för "försäkrings-fällan": en mening om föreningens egen
    // fastighetsförsäkring ("X ingår ej i föreningens fastighetsförsäkring")
    // handlar inte om avgiften. Schemat kan inte läsa textens INNEHÅLL, men
    // det kan (och ska) fortfarande kräva att en källa hör ihop med ett
    // entydigt ja/nej-svar — samma regel som ovan, här med ett citat som
    // faktiskt kommer från en försäkringsmening för att göra avsikten tydlig.
    it("avvisar en källa vars citat kommer från en försäkringsmening när posten ändå är 'okant'", () => {
      const med = {
        ...bas,
        avgiftInkluderarEnligtForening: {
          varme: "okant",
          vatten: "okant",
          el: "okant",
          bredband: "okant",
          tv: "okant",
        },
        avgiftInkluderarKallor: {
          el: { page: 6, excerpt: "Hushållsel ingår ej i föreningens fastighetsförsäkring" },
        },
      };
      expect(ForeningSchema.safeParse(med).success).toBe(false);
    });
  });

  describe("individuellMatning", () => {
    it("accepterar 'ja' och 'nej' per post med citerad ref", () => {
      const med = {
        ...bas,
        individuellMatning: {
          el: {
            matning: "ja",
            ref: {
              page: 15,
              excerpt: "Kostnader för el tas ut via årsavgiften genom individuell mätning",
            },
          },
        },
      };
      expect(ForeningSchema.safeParse(med).success).toBe(true);
    });

    it("avvisar matning: 'okant' — frånvaro av posten UTTRYCKER redan okänt", () => {
      const med = {
        ...bas,
        individuellMatning: {
          vatten: { matning: "okant", ref: { page: 15, excerpt: "Något citat" } },
        },
      };
      expect(ForeningSchema.safeParse(med).success).toBe(false);
    });

    it("kräver excerpt på ref:en, precis som avgiftInkluderarKallor", () => {
      const med = {
        ...bas,
        individuellMatning: { varme: { matning: "nej", ref: { page: 15 } } },
      };
      expect(ForeningSchema.safeParse(med).success).toBe(false);
    });

    it("är valfritt — de flesta rapporter nämner inte individuell mätning alls", () => {
      expect(ForeningSchema.safeParse(bas).success).toBe(true);
    });
  });
});

describe("ExtractionResultSchema", () => {
  it("accepterar en fullständig, giltig extraktion", () => {
    const r = ExtractionResultSchema.safeParse(validExtractionResult);
    expect(r.success).toBe(true);
  });

  it("kräver samtliga sju nyckeltal — extraktionen får inte tyst utelämna ett", () => {
    const ofullstandig = structuredClone(validExtractionResult);
    ofullstandig.forening.keyFigures = ofullstandig.forening.keyFigures.filter(
      (k) => k.id !== "rantekanslighet",
    );
    expect(ExtractionResultSchema.safeParse(ofullstandig).success).toBe(false);
  });

  it("avvisar ett dubblerat nyckeltal-id", () => {
    const dubblett = structuredClone(validExtractionResult);
    dubblett.forening.keyFigures[6] = { ...dubblett.forening.keyFigures[0]! };
    expect(ExtractionResultSchema.safeParse(dubblett).success).toBe(false);
  });

  it("accepterar ett nyckeltal med value: null — figuren finns kvar även om talet saknas i rapporten", () => {
    const saknatVarde = structuredClone(validExtractionResult);
    saknatVarde.forening.keyFigures[0]!.figure.value = null;
    saknatVarde.forening.keyFigures[0]!.figure.source = "berakning"; // null → inget citat att kräva
    saknatVarde.forening.keyFigures[0]!.status = "okant";
    expect(ExtractionResultSchema.safeParse(saknatVarde).success).toBe(true);
  });
});

describe("AnalysisResultSchema", () => {
  it("accepterar ett fullständigt, giltigt analysresultat", () => {
    const r = AnalysisResultSchema.safeParse(validAnalysisResult);
    expect(r.success).toBe(true);
  });

  it("accepterar ett resultat utan utgångspris (input och prisanalys)", () => {
    const utan = structuredClone(validAnalysisResult) as unknown as {
      input: Record<string, unknown>;
      prisanalys: Record<string, unknown>;
    };
    delete utan.input["utgangspris"];
    delete utan.prisanalys["utgangspris"];
    delete utan.prisanalys["prisPerM2"];
    expect(AnalysisResultSchema.safeParse(utan).success).toBe(true);
    // Med utgångspris parsar det som förut.
    expect(AnalysisResultSchema.safeParse(validAnalysisResult).success).toBe(true);
  });

  it("avvisar när ett obligatoriskt fält saknas (malformad modell-JSON)", () => {
    const trasig = structuredClone(validAnalysisResult) as unknown as Record<string, unknown>;
    delete trasig["betyg"];
    expect(AnalysisResultSchema.safeParse(trasig).success).toBe(false);
  });

  it("avvisar en okänd sektion i gratisSektioner", () => {
    const trasig = structuredClone(validAnalysisResult) as unknown as Record<string, unknown>;
    (trasig["gratisSektioner"] as string[]).push("hela_rapporten");
    expect(AnalysisResultSchema.safeParse(trasig).success).toBe(false);
  });
});

describe("AnalysJudgementSchema", () => {
  const giltigt = {
    betyg: "C",
    betygMotivering: "Svagt sparande i kombination med ett planerat stambyte.",
    rodaFlaggor: [
      {
        id: "lagt-sparande",
        titel: "Lågt sparande",
        beskrivning: "Föreningen sparar 180 kr/m² inför ett stambyte.",
        severity: "medel",
        harledsFran: ["sparande_per_m2_totalyta"],
      },
    ],
    fragor: [
      {
        id: "fraga-1",
        fraga: "Hur ska stambytet finansieras?",
        ursprung: "analys",
        riktadTill: "styrelsen",
        varfor: "Sparandet räcker inte enligt årsredovisningen.",
      },
    ],
  };

  it("accepterar ett giltigt omdöme", () => {
    expect(AnalysJudgementSchema.safeParse(giltigt).success).toBe(true);
  });

  it("avvisar harledsFran med ett id som inte är ett av de sju nyckeltalen", () => {
    const trasigt = structuredClone(giltigt);
    trasigt.rodaFlaggor[0]!.harledsFran = ["soliditet"];
    expect(AnalysJudgementSchema.safeParse(trasigt).success).toBe(false);
  });

  it("avvisar ursprung 'saknad_uppgift' — pass 2 producerar bara analysfrågor", () => {
    const trasigt = structuredClone(giltigt);
    trasigt.fragor[0]!.ursprung = "saknad_uppgift";
    expect(AnalysJudgementSchema.safeParse(trasigt).success).toBe(false);
  });

  it("avvisar okända fält — ett extra fält betyder att modellen hittat på något", () => {
    const trasigt = { ...giltigt, prisanalys: {} };
    expect(AnalysJudgementSchema.safeParse(trasigt).success).toBe(false);
  });

  describe("svarssignal (valfri, PROMPT_VERSION 8)", () => {
    const medSignal = (svarssignal: unknown) => {
      const r = structuredClone(giltigt) as typeof giltigt & {
        fragor: Array<Record<string, unknown>>;
      };
      r.fragor[0]!["svarssignal"] = svarssignal;
      return AnalysJudgementSchema.safeParse(r);
    };

    it("behåller en icke-tom svarssignal, trimmad", () => {
      const r = medSignal("  Bra svar: nej. Varningssignal: ja.  ");
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.fragor[0]).toHaveProperty(
          "svarssignal",
          "Bra svar: nej. Varningssignal: ja.",
        );
      }
    });

    it("accepterar att svarssignal helt saknas, och nyckeln finns då inte i utdata", () => {
      const r = AnalysJudgementSchema.safeParse(giltigt);
      expect(r.success).toBe(true);
      if (r.success) expect("svarssignal" in r.data.fragor[0]!).toBe(false);
    });

    it.each([
      ["tom sträng", ""],
      ["bara blanksteg", "  \n "],
      ["null", null],
      ["undefined", undefined],
    ])("behandlar %s som utelämnad: lyckas utan retry och nyckeln tas bort", (_namn, varde) => {
      const r = medSignal(varde);
      expect(r.success).toBe(true);
      if (r.success) expect("svarssignal" in r.data.fragor[0]!).toBe(false);
    });

    it("avvisar fortfarande en svarssignal som inte är text", () => {
      expect(medSignal(42).success).toBe(false);
    });

    it("avvisar fortfarande okända fält på en fråga", () => {
      const r = structuredClone(giltigt) as typeof giltigt & {
        fragor: Array<Record<string, unknown>>;
      };
      r.fragor[0]!["hittepa"] = "x";
      expect(AnalysJudgementSchema.safeParse(r).success).toBe(false);
    });

    it("kräver fortfarande ett ifyllt varfor", () => {
      const r = structuredClone(giltigt);
      r.fragor[0]!.varfor = "";
      expect(AnalysJudgementSchema.safeParse(r).success).toBe(false);
    });

    it("utdatan klarar den strikta FragaSchema som assemble validerar mot", () => {
      const r = medSignal("");
      expect(r.success).toBe(true);
      if (r.success) expect(FragaSchema.safeParse(r.data.fragor[0]).success).toBe(true);
    });
  });
});

describe("FragaSchema", () => {
  const bas = {
    id: "f1",
    fraga: "Hur ska stambytet finansieras?",
    ursprung: "analys",
    riktadTill: "styrelsen",
    varfor: "Sparandet är 180 kr/m².",
  };

  it("läser en lagrad fråga utan svarssignal (äldre rader)", () => {
    expect(FragaSchema.safeParse(bas).success).toBe(true);
  });

  it("läser en fråga med svarssignal", () => {
    const r = FragaSchema.safeParse({ ...bas, svarssignal: "Bra svar: en plan." });
    expect(r.success).toBe(true);
  });

  it("avvisar okända nycklar", () => {
    expect(FragaSchema.safeParse({ ...bas, hittepa: 1 }).success).toBe(false);
  });
});

describe("PropertyInputSchema.kalla (Booli, 2026-10-24)", () => {
  const bas = {
    kind: "bostadsratt",
    boarea: 54,
    antalRum: 2,
    manadsavgift: 3800,
    andelstal: 0,
    orgnr: "",
    adress: "Sankt Eriksgatan 31A",
    postnummer: "11239",
    ort: "Stockholm",
    hiss: "ja",
    balkong: "okant",
    avgiftInkluderar: {
      varme: "okant",
      vatten: "okant",
      el: "okant",
      bredband: "okant",
      tv: "okant",
    },
    antalPersoner: 2,
  } as const;
  const kalla = {
    typ: "booli",
    url: "https://www.booli.se/bostad/720821",
    maklarUrl:
      "https://connect-resolve.maklare.vitec.net/Description/M22127/OBJ22127_2099178190/Booli",
    forening: "BRF Väktaren 16",
    hamtad: "2026-10-24T08:00:00.000Z",
    oandradeFalt: ["adress", "boarea"],
  } as const;

  it("accepterar input utan kalla (lagrade rader före 2026-10-24)", () => {
    expect(PropertyInputSchema.safeParse(bas).success).toBe(true);
  });

  it("accepterar en giltig kalla", () => {
    const r = PropertyInputSchema.safeParse({ ...bas, kalla });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.kalla).toEqual(kalla);
  });

  it("accepterar kalla utan valfria fält", () => {
    const { maklarUrl: _m, forening: _f, ...minimal } = kalla;
    expect(PropertyInputSchema.safeParse({ ...bas, kalla: minimal }).success).toBe(true);
  });

  it.each([
    ["http-länk", { url: "http://www.booli.se/bostad/720821" }],
    ["annan domän", { url: "https://www.booli.se.evil.com/bostad/1" }],
    ["fel sökväg", { url: "https://www.booli.se/sok/till-salu" }],
    ["frågesträng", { url: "https://www.booli.se/bostad/720821?x=1" }],
    ["okänt fält", { okant: 1 }],
    ["okänt formulärfält", { oandradeFalt: ["orgnr"] }],
    ["fel typ", { typ: "hemnet" }],
    ["ogiltig tid", { hamtad: "igår" }],
    ["mäklarlänk utan protokoll", { maklarUrl: "javascript:alert(1)" }],
  ])("avvisar %s", (_namn, andring) => {
    expect(PropertyInputSchema.safeParse({ ...bas, kalla: { ...kalla, ...andring } }).success).toBe(
      false,
    );
  });
});
