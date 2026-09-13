import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AnalysJudgementSchema,
  AnalysisResultSchema,
  ExtractionResultSchema,
  FigureMedLeverantorSchema,
  FigureSchema,
  ForeningSchema,
  KeyFigureIdSchema,
  LaneUnderlagSchema,
  PrisanalysSchema,
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
    antalLantagare: 2,
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
  manadskostnad: {
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
  it("accepterar lan-objektet från fixtures/property-input-example.json", async () => {
    const fixturePath = path.join(
      import.meta.dirname,
      "../../../fixtures/property-input-example.json",
    );
    const raw: unknown = JSON.parse(await readFile(fixturePath, "utf-8"));
    const { lan } = raw as { lan: unknown };
    expect(LaneUnderlagSchema.safeParse(lan).success).toBe(true);
  });

  it("avvisar ett okänt extra fält (.strict())", () => {
    const medExtraFalt = {
      lanebelopp: 2_560_000,
      kontantinsats: 640_000,
      ranta: 3.6,
      bruttoinkomst: 900_000,
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
    };
    expect(LaneUnderlagSchema.safeParse(felTyp).success).toBe(false);
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

  it("avvisar när ett obligatoriskt fält saknas (malformad modell-JSON)", () => {
    const trasig = structuredClone(validAnalysisResult) as unknown as Record<string, unknown>;
    delete trasig["betyg"];
    expect(AnalysisResultSchema.safeParse(trasig).success).toBe(false);
  });

  it("avvisar tillampadAmorteringstakt: 3 — det skärpta kravet är slopat, får aldrig förekomma", () => {
    const trasig = structuredClone(validAnalysisResult);
    // @ts-expect-error — testar just att schemat fångar ett otillåtet värde
    trasig.manadskostnad.amortering.tillampadAmorteringstakt = 3;
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
});
