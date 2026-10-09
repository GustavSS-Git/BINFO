import { describe, expect, it } from "vitest";
import type { ExtractionResult, Figure, KeyFigure, KeyFigureId } from "@/types/analysis";
import { kontrolleraRimlighet, PLAUSIBLA_INTERVALL } from "./rimlighet";

function fig(value: number | null, unit: Figure["unit"] = "kr"): Figure {
  return {
    value,
    unit,
    source: "arsredovisning",
    ref: { page: 4, excerpt: "utdrag" },
  };
}

type Nyckeltal = Partial<Record<KeyFigureId, number | null>>;

const ENHET: Record<KeyFigureId, Figure["unit"]> = {
  arsavgift_per_m2_brf_yta: "kr/m2",
  arsavgift_andel_av_rorelseintakter: "procent",
  skuldsattning_per_m2_totalyta: "kr/m2",
  skuldsattning_per_m2_brf_yta: "kr/m2",
  sparande_per_m2_totalyta: "kr/m2",
  rantekanslighet: "procent",
  energikostnad_per_m2_totalyta: "kr/m2",
};

function extraktion(
  nyckeltal: Nyckeltal,
  extra: {
    totalSkuld?: number;
    kontrollsummor?: ExtractionResult["kontrollsummor"];
    niva?: "hog" | "medel" | "lag";
  } = {},
): ExtractionResult {
  const keyFigures: KeyFigure[] = (Object.keys(ENHET) as KeyFigureId[]).map((id) => ({
    id,
    label: id,
    figure: fig(nyckeltal[id] ?? null, ENHET[id]),
    status: "okant",
    forklaring: "x",
  }));
  return {
    schemaVersion: "1.0.0",
    forening: {
      namn: "Brf Test",
      orgnr: "769600-1234",
      akta: "ja",
      rakenskapsar: 2025,
      keyFigures,
      ...(extra.totalSkuld !== undefined ? { lanebok: { totalSkuld: fig(extra.totalSkuld) } } : {}),
    },
    datakvalitet: {
      pdfSaknarTextlager: false,
      extraktionKonfidens: { niva: extra.niva ?? "hog" },
      saknadeFalt: [],
    },
    ...(extra.kontrollsummor ? { kontrollsummor: extra.kontrollsummor } : {}),
  };
}

const kf = (e: ExtractionResult, id: KeyFigureId) =>
  e.forening.keyFigures.find((k) => k.id === id)!.figure;

// Startfältet (draft key, bild2): alla tal hänger ihop.
const STARTFALTET: Nyckeltal = {
  arsavgift_per_m2_brf_yta: 1262,
  arsavgift_andel_av_rorelseintakter: 97,
  skuldsattning_per_m2_totalyta: 12867,
  skuldsattning_per_m2_brf_yta: 12867,
  sparande_per_m2_totalyta: 377,
  rantekanslighet: 10.19,
  energikostnad_per_m2_totalyta: 230,
};
const STARTFALTET_SUMMOR = {
  summaTillgangar: fig(300622392),
  summaEgetKapitalOchSkulder: fig(300622392),
  arsavgifter: fig(10190650),
  bostadsrattsyta: fig(8075, "m2"),
  rantebarandeSkulder: fig(103897100),
};

describe("kontrolleraRimlighet — konsekvent rapport", () => {
  it("ändrar ingenting och ger inga anmärkningar när allt hänger ihop", () => {
    const indata = extraktion(STARTFALTET, {
      totalSkuld: 103897100,
      kontrollsummor: STARTFALTET_SUMMOR,
    });
    const { extraction, anmarkningar } = kontrolleraRimlighet(indata);
    expect(anmarkningar).toEqual([]);
    expect(extraction).toEqual(indata);
  });

  it("hoppar över varje kontroll vars indata saknas — ingen kontrollsumma alls ger ingen anmärkning", () => {
    const { anmarkningar, extraction } = kontrolleraRimlighet(extraktion(STARTFALTET));
    expect(anmarkningar).toEqual([]);
    expect(extraction.datakvalitet.extraktionKonfidens.niva).toBe("hog");
  });

  it("muterar inte indata", () => {
    const indata = extraktion(
      { ...STARTFALTET, rantekanslighet: 99 },
      { kontrollsummor: STARTFALTET_SUMMOR },
    );
    const kopia = structuredClone(indata);
    kontrolleraRimlighet(indata);
    expect(indata).toEqual(kopia);
  });
});

describe("balansräkningen", () => {
  it("godkänner skillnad inom 1 % (avrundning)", () => {
    const { anmarkningar } = kontrolleraRimlighet(
      extraktion(
        {},
        {
          kontrollsummor: {
            summaTillgangar: fig(1_000_000),
            summaEgetKapitalOchSkulder: fig(1_009_000),
          },
        },
      ),
    );
    expect(anmarkningar).toEqual([]);
  });

  it("flaggar skillnad över 1 %: båda summorna osäkra, skäl, konfidens ned en nivå", () => {
    const { extraction, anmarkningar } = kontrolleraRimlighet(
      extraktion(
        {},
        {
          kontrollsummor: {
            summaTillgangar: fig(1_000_000),
            summaEgetKapitalOchSkulder: fig(1_020_000),
          },
        },
      ),
    );
    expect(anmarkningar).toHaveLength(1);
    expect(anmarkningar[0]).toMatch(/balansräkning/i);
    expect(extraction.kontrollsummor?.summaTillgangar?.osaker).toBeTruthy();
    expect(extraction.kontrollsummor?.summaEgetKapitalOchSkulder?.osaker).toBeTruthy();
    expect(extraction.datakvalitet.extraktionKonfidens.niva).toBe("medel");
    expect(extraction.datakvalitet.extraktionKonfidens.skal).toEqual(anmarkningar);
  });

  it("hoppar över när en av summorna saknas eller är null", () => {
    expect(
      kontrolleraRimlighet(extraktion({}, { kontrollsummor: { summaTillgangar: fig(5) } }))
        .anmarkningar,
    ).toEqual([]);
    expect(
      kontrolleraRimlighet(
        extraktion(
          {},
          { kontrollsummor: { summaTillgangar: fig(null), summaEgetKapitalOchSkulder: fig(5) } },
        ),
      ).anmarkningar,
    ).toEqual([]);
  });
});

describe("räntekänslighet mot skuld / årsavgifter", () => {
  // 90 000 000 / 13 900 000 = 6.47 — Ängsknarren skriver ut heltalet 6 (−7 %).
  const summor = {
    rantebarandeSkulder: fig(90_000_000),
    arsavgifter: fig(13_900_000),
  };

  it("godkänner en avrundad tryckt siffra inom 15 % relativt", () => {
    const { anmarkningar } = kontrolleraRimlighet(
      extraktion({ rantekanslighet: 6 }, { kontrollsummor: summor }),
    );
    expect(anmarkningar).toEqual([]);
  });

  it("flaggar räntekänsligheten när den avviker mer än 15 %", () => {
    const { extraction, anmarkningar } = kontrolleraRimlighet(
      extraktion({ rantekanslighet: 9 }, { kontrollsummor: summor }),
    );
    expect(anmarkningar).toHaveLength(1);
    expect(anmarkningar[0]).toMatch(/räntekänslighet/i);
    expect(kf(extraction, "rantekanslighet").osaker).toMatch(/räntekänslighet/i);
    expect(extraction.datakvalitet.extraktionKonfidens.niva).toBe("medel");
  });

  it("använder lanebok.totalSkuld när kontrollsumman för räntebärande skulder saknas", () => {
    const { anmarkningar } = kontrolleraRimlighet(
      extraktion(
        { rantekanslighet: 9 },
        { totalSkuld: 90_000_000, kontrollsummor: { arsavgifter: fig(13_900_000) } },
      ),
    );
    expect(anmarkningar).toHaveLength(1);
  });

  it("hoppar över när räntekänsligheten själv är null (saknas ≠ fel)", () => {
    const { anmarkningar } = kontrolleraRimlighet(
      extraktion({ rantekanslighet: null }, { kontrollsummor: summor }),
    );
    expect(anmarkningar).toEqual([]);
  });

  it("hoppar över när årsavgifterna är 0 (ingen division med noll)", () => {
    const { anmarkningar } = kontrolleraRimlighet(
      extraktion(
        { rantekanslighet: 9 },
        { kontrollsummor: { rantebarandeSkulder: fig(90_000_000), arsavgifter: fig(0) } },
      ),
    );
    expect(anmarkningar).toEqual([]);
  });

  it("en skuldfri förening (skuld 0, räntekänslighet 0) är konsekvent", () => {
    const { anmarkningar } = kontrolleraRimlighet(
      extraktion(
        { rantekanslighet: 0 },
        { kontrollsummor: { rantebarandeSkulder: fig(0), arsavgifter: fig(5_000_000) } },
      ),
    );
    expect(anmarkningar).toEqual([]);
  });
});

describe("årsavgift/m² × bostadsrättsyta mot årsavgifter", () => {
  it("flaggar årsavgift per m² när produkten avviker mer än 25 % från årsavgifterna", () => {
    const { extraction, anmarkningar } = kontrolleraRimlighet(
      extraktion(
        { arsavgift_per_m2_brf_yta: 1262 },
        { kontrollsummor: { arsavgifter: fig(8_000_000), bostadsrattsyta: fig(8075, "m2") } },
      ),
    );
    expect(anmarkningar).toHaveLength(1);
    expect(anmarkningar[0]).toMatch(/årsavgift/i);
    expect(kf(extraction, "arsavgift_per_m2_brf_yta").osaker).toBeTruthy();
  });

  it("godkänner en verklig avvikelse på 16,5 % (Albohem, verifierad nyckel)", () => {
    const { anmarkningar } = kontrolleraRimlighet(
      extraktion(
        { arsavgift_per_m2_brf_yta: 834 },
        { kontrollsummor: { arsavgifter: fig(862_812), bostadsrattsyta: fig(1205, "m2") } },
      ),
    );
    expect(anmarkningar).toEqual([]);
  });

  it("godkänner inom 10 %", () => {
    const { anmarkningar } = kontrolleraRimlighet(
      extraktion(
        { arsavgift_per_m2_brf_yta: 1262 },
        { kontrollsummor: { arsavgifter: fig(10_700_000), bostadsrattsyta: fig(8075, "m2") } },
      ),
    );
    expect(anmarkningar).toEqual([]);
  });

  it("hoppar över utan bostadsrättsyta", () => {
    const { anmarkningar } = kontrolleraRimlighet(
      extraktion({ arsavgift_per_m2_brf_yta: 1262 }, { kontrollsummor: { arsavgifter: fig(1) } }),
    );
    expect(anmarkningar).toEqual([]);
  });
});

describe("skuldsättning/m² bostadsrättsyta × yta mot räntebärande skulder", () => {
  it("flaggar skuldsättningen när produkten avviker mer än 10 % från skulden", () => {
    const { extraction, anmarkningar } = kontrolleraRimlighet(
      extraktion(
        { skuldsattning_per_m2_brf_yta: 12867, skuldsattning_per_m2_totalyta: 12867 },
        {
          kontrollsummor: {
            rantebarandeSkulder: fig(35_659_610), // kortfristiga delen glömd (Startfältet)
            bostadsrattsyta: fig(8075, "m2"),
          },
        },
      ),
    );
    expect(anmarkningar).toHaveLength(1);
    expect(anmarkningar[0]).toMatch(/skuldsättning/i);
    expect(kf(extraction, "skuldsattning_per_m2_brf_yta").osaker).toBeTruthy();
  });

  it("hoppar över när bostadsrättsytan saknas", () => {
    const { anmarkningar } = kontrolleraRimlighet(
      extraktion(
        { skuldsattning_per_m2_brf_yta: 12867 },
        { kontrollsummor: { rantebarandeSkulder: fig(1) } },
      ),
    );
    expect(anmarkningar).toEqual([]);
  });

  it("hoppar över när basen är oklar: skuldsättning per m² totalyta är null (Zederslundshus)", () => {
    const { anmarkningar } = kontrolleraRimlighet(
      extraktion(
        { skuldsattning_per_m2_brf_yta: 3089, skuldsattning_per_m2_totalyta: null },
        {
          kontrollsummor: {
            rantebarandeSkulder: fig(7_706_397),
            bostadsrattsyta: fig(2000, "m2"), // bostadsyta utan lokal: annan bas än 2 495
          },
        },
      ),
    );
    expect(anmarkningar).toEqual([]);
  });
});

describe("rimliga intervall (tkr mot kr)", () => {
  it("exporterar ett intervall per nyckeltal", () => {
    expect(Object.keys(PLAUSIBLA_INTERVALL).sort()).toEqual(Object.keys(ENHET).sort());
  });

  it("fångar ett tkr/kr-fel på årsavgift per m² (1 262 000 i stället för 1 262)", () => {
    const { extraction, anmarkningar } = kontrolleraRimlighet(
      extraktion({ ...STARTFALTET, arsavgift_per_m2_brf_yta: 1_262_000 }),
    );
    expect(anmarkningar).toHaveLength(1);
    expect(kf(extraction, "arsavgift_per_m2_brf_yta").osaker).toMatch(/tkr|enhet/i);
  });

  it("fångar ett tkr/kr-fel åt andra hållet (årsavgift 1,262 i stället för 1 262)", () => {
    const { extraction } = kontrolleraRimlighet(
      extraktion({ ...STARTFALTET, arsavgift_per_m2_brf_yta: 1.262 }),
    );
    expect(kf(extraction, "arsavgift_per_m2_brf_yta").osaker).toBeTruthy();
  });

  it.each([
    ["arsavgift_per_m2_brf_yta", 49, 5001],
    ["arsavgift_andel_av_rorelseintakter", -1, 101],
    ["skuldsattning_per_m2_totalyta", -1, 60001],
    ["skuldsattning_per_m2_brf_yta", -1, 60001],
    ["energikostnad_per_m2_totalyta", -1, 1501],
    ["sparande_per_m2_totalyta", -5001, 5001],
    ["rantekanslighet", -1, 60.5],
  ] as const)("%s: utanför intervallet flaggas, gränsvärdena godkänns", (id, under, over) => {
    const [lo, hi] = PLAUSIBLA_INTERVALL[id];
    for (const v of [under, over]) {
      const r = kontrolleraRimlighet(extraktion({ [id]: v }));
      expect(kf(r.extraction, id).osaker, `${id}=${v}`).toBeTruthy();
    }
    for (const v of [lo, hi]) {
      const r = kontrolleraRimlighet(extraktion({ [id]: v }));
      expect(kf(r.extraction, id).osaker, `${id}=${v}`).toBeUndefined();
    }
  });

  it("ett null-värde (saknas) flaggas inte", () => {
    const r = kontrolleraRimlighet(extraktion({}));
    expect(r.anmarkningar).toEqual([]);
  });
});

describe("konfidens", () => {
  it("sänker en nivå per körning, inte per anmärkning: hog → medel", () => {
    const r = kontrolleraRimlighet(
      extraktion({ arsavgift_per_m2_brf_yta: 99_999, skuldsattning_per_m2_brf_yta: 99_999 }),
    );
    expect(r.anmarkningar).toHaveLength(2);
    expect(r.extraction.datakvalitet.extraktionKonfidens.niva).toBe("medel");
    expect(r.extraction.datakvalitet.extraktionKonfidens.skal).toHaveLength(2);
  });

  it("medel → lag, och lag förblir lag (höjer aldrig)", () => {
    const ned = (niva: "hog" | "medel" | "lag") =>
      kontrolleraRimlighet(extraktion({ arsavgift_per_m2_brf_yta: 99_999 }, { niva })).extraction
        .datakvalitet.extraktionKonfidens.niva;
    expect(ned("medel")).toBe("lag");
    expect(ned("lag")).toBe("lag");
  });

  it("behåller befintliga skäl och lägger nya efter dem", () => {
    const indata = extraktion({ arsavgift_per_m2_brf_yta: 99_999 });
    indata.datakvalitet.extraktionKonfidens = { niva: "hog", skal: ["gammalt skäl"] };
    const r = kontrolleraRimlighet(indata);
    expect(r.extraction.datakvalitet.extraktionKonfidens.skal?.[0]).toBe("gammalt skäl");
    expect(r.extraction.datakvalitet.extraktionKonfidens.skal).toHaveLength(2);
  });

  it("ingen sänkning utan anmärkning", () => {
    const r = kontrolleraRimlighet(extraktion(STARTFALTET));
    expect(r.extraction.datakvalitet.extraktionKonfidens.niva).toBe("hog");
  });
});

describe("osaker bevarar resten av figuren", () => {
  it("ändrar bara osaker — värde, källa och citat står kvar (aldrig dolt)", () => {
    const r = kontrolleraRimlighet(extraktion({ arsavgift_per_m2_brf_yta: 99_999 }));
    expect(kf(r.extraction, "arsavgift_per_m2_brf_yta")).toMatchObject({
      value: 99_999,
      source: "arsredovisning",
      ref: { page: 4, excerpt: "utdrag" },
    });
  });
});
