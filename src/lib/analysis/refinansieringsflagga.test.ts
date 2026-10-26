import { describe, expect, it } from "vitest";
import type {
  Avgiftsprognos,
  Figure,
  Forening,
  Lan,
  RedFlag,
  Referensranta,
} from "@/types/analysis";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import { beraknaAvgiftsprognos } from "./calc/avgiftsprognos";
import {
  arRefinansieringsflagga,
  byggRefinansieringsflagga,
  refinansieringsMening,
  REFINANSIERINGSFLAGGA_ID,
} from "./refinansieringsflagga";

const REF: Referensranta = {
  namn: "3-månaders statsskuldväxel",
  serie: "SETB3MBENCH",
  datum: "2026-10-23",
  procent: 2.068,
  kalla: "Sveriges riksbank",
  reserv: false,
};
const fig = (value: number, extra: Partial<Figure> = {}): Figure => ({
  value,
  unit: "kr",
  source: "arsredovisning",
  ref: { page: 18, excerpt: "x" },
  ...extra,
});
const lan = (
  belopp: number,
  ranta: number,
  dag: string,
  rantetyp: Lan["rantetyp"] = "okant",
): Lan => ({
  belopp: fig(belopp),
  ranta: fig(ranta, { unit: "procent" }),
  villkorsandringsdag: dag,
  rantetyp,
  ref: { page: 18, excerpt: "lån" },
});

function prognosFor(
  lanLista: Lan[],
  totalSkuld: number,
  idag = "2026-10-26",
  extraLanebok: object = {},
): Avgiftsprognos {
  const forening: Forening = {
    namn: "Brf Test",
    orgnr: "769600-0000",
    akta: "ja",
    rakenskapsar: 2025,
    balansdag: "2025-12-31",
    keyFigures: [],
    lanebok: { totalSkuld: fig(totalSkuld), lan: lanLista, ...extraLanebok },
  };
  return beraknaAvgiftsprognos({
    forening,
    kontrollsummor: { arsavgifter: fig(4_800_000) },
    manadsavgift: 4000,
    boarea: 50,
    referensranta: REF,
    idag,
  }).prognos;
}

const PONTON = [
  lan(2_926_011, 2.53, "2026-03-28"),
  lan(1_180_000, 4.49, "2026-09-28"),
  lan(683_080, 2.51, "2026-11-28"),
  lan(970_000, 2.43, "2026-12-28"),
];

describe("byggRefinansieringsflagga (Pontonjären-like, idag 2026-10-26)", () => {
  // matured 4 106 011 (2 926 011 + 1 180 000); resetting 1 653 080 of total 5 759 091 = 28,7 %
  const prognos = prognosFor(PONTON, 5_759_091);
  const f = byggRefinansieringsflagga(prognos, 5_759_091) as RedFlag;

  it("states the fact in the title", () => {
    expect(f.titel).toBe("28,7 % av lånen får ny ränta inom 24 månader");
    expect(f.id).toBe("refinansiering-berakning");
  });
  it("names reset amount, matured amount with dates, and the honest direction/size", () => {
    expect(f.beskrivning.replace(/\s/g, " ")).toBe(
      "1 653 080 kr av föreningens lån (28,7 % av skulden på 5 759 091 kr) får ny ränta inom 24 månader från 26 oktober 2026. " +
        "Räntan går från i snitt 2,46 % till 2,65 %. " +
        "Lån på 4 106 011 kr (villkorsändringsdag 28 mars 2026 och 28 september 2026) har troligen redan fått nya villkor som vi inte känner till; de räknas inte i beräkningen. " +
        "Vid dagens ränta påverkar det avgiften knappt (ca 3 kr/mån) enligt Binfos beräkning.",
    );
  });
  it("is medel (71 % of the debt matured, terms unknown), carries the component's page ref and figure ids", () => {
    expect(f.severity).toBe("medel");
    expect(f.ref?.page).toBe(18);
    expect(f.harledsFran).toEqual(["rantekanslighet", "skuldsattning_per_m2_totalyta"]);
  });
  it("matured share ≥ 50 % raises to medel", () => {
    const p = prognosFor(
      [lan(4_000_000, 2.5, "2026-03-28"), lan(1_000_000, 2.5, "2027-03-28")],
      5_000_000,
    );
    expect(byggRefinansieringsflagga(p, 5_000_000)?.severity).toBe("medel");
  });
  it("a clear rise: 28 % resetting from 1,0 % → fee rise ≥ 10 kr/mån says 'höjer avgiften med ca'", () => {
    // 5 000 000 @1,0 resetting: (2,648 − 1,0) % × 5 000 000 = 82 400 /yr → ÷ 1 200 = 68,67 → 69
    const p = prognosFor([lan(5_000_000, 1.0, "2027-03-28")], 5_000_000);
    const g = byggRefinansieringsflagga(p, 5_000_000) as RedFlag;
    expect(g.titel).toBe("100,0 % av lånen får ny ränta inom 24 månader");
    expect(g.beskrivning).toContain("höjer det avgiften med ca 69 kr/mån");
    expect(g.severity).toBe("medel"); // ≥ 50 % and ≥ 10 kr/mån (also tryck gul: 1,7 % → gron, so via share)
  });
  it("a fall says 'sänker'", () => {
    // 5 000 000 @5,0: (2,648 − 5,0) % → −117 600 /yr → −98
    const p = prognosFor([lan(5_000_000, 5.0, "2027-03-28")], 5_000_000);
    const g = byggRefinansieringsflagga(p, 5_000_000) as RedFlag;
    expect(g.beskrivning).toContain("sänker det avgiften med ca 98 kr/mån");
    expect(g.severity).toBe("lag");
  });
  it("nothing resets and nothing matured → null; a tiny share with a negligible effect → null", () => {
    const inget = prognosFor([lan(1_000_000, 2.0, "2033-01-01")], 1_000_000);
    expect(byggRefinansieringsflagga(inget, 1_000_000)).toBeNull();
    const litet = prognosFor(
      [lan(100_000, 2.5, "2027-03-28"), lan(9_900_000, 2.5, "2033-01-01")],
      10_000_000,
    );
    expect(byggRefinansieringsflagga(litet, 10_000_000)).toBeNull();
  });
  it("only matured loans: a flag about the matured amount, no direction claimed from them", () => {
    const p = prognosFor(
      [lan(1_000_000, 2.0, "2026-05-01"), lan(1_000_000, 2.0, "2033-01-01")],
      2_000_000,
    );
    const g = byggRefinansieringsflagga(p, 2_000_000) as RedFlag;
    expect(g.titel.replace(/\s/g, " ")).toBe(
      "Lån på 1 000 000 kr har troligen redan fått nya villkor",
    );
    expect(g.severity).toBe("medel");
  });
  it("assumed maturities (no per-loan rows) → null", () => {
    const p = prognosFor([], 1_000_000);
    expect(byggRefinansieringsflagga(p, 1_000_000)).toBeNull();
  });
});

describe("the flag and the sentence use the amount the component prices (rörlig + dated)", () => {
  // idag 2026-10-26: rörlig 2 926 011 (2026-03-28) is priced at once, 1 180 000 matured,
  // 683 080 + 970 000 dated within the horizon. 2 000 000 @2,98 in month 25 (dearer → not priced).
  const prognos = prognosFor(
    [
      lan(2_926_011, 2.53, "2026-03-28", "rorlig"),
      lan(1_180_000, 4.49, "2026-09-28"),
      lan(683_080, 2.51, "2026-11-28"),
      lan(970_000, 2.43, "2026-12-28"),
      lan(2_000_000, 2.98, "2028-10-28"),
    ],
    7_759_091,
  );
  it("component amount = 4 579 091 kr = 59,0 % of 7 759 091", () => {
    expect(prognos.refinansiering?.forfallandeBelopp).toBe(4_579_091);
    const f = byggRefinansieringsflagga(prognos, 7_759_091) as RedFlag;
    expect(f.titel).toBe("59,0 % av lånen får ny ränta inom 24 månader");
    const t = f.beskrivning.replace(/\s/g, " ");
    expect(t).toContain(
      "4 579 091 kr av föreningens lån (59,0 % av skulden på 7 759 091 kr) får ny ränta inom 24 månader från 26 oktober 2026: rörliga lån på 2 926 011 kr, som följer marknaden löpande, och lån på 1 653 080 kr med villkorsändringsdag inom perioden.",
    );
    expect(t).toContain(
      "Lån på 1 180 000 kr (villkorsändringsdag 28 september 2026) har troligen redan fått nya villkor",
    );
    const komp = prognos.komponenter.find((k) => k.id === "refinansiering");
    expect(t).toContain(`ca ${komp?.krPerManad} kr/mån`.replace("ca ", "(ca ").replace(/^\(/, ""));
  });
  it("the summary sentence says the same", () => {
    const m = (refinansieringsMening(prognos, 7_759_091) ?? "").replace(/\s/g, " ");
    expect(m).toMatch(/^59,0 % av lånen \(4 579 091 kr\) får ny ränta inom 24 månader/);
    expect(m).toContain("lån på 1 180 000 kr har troligen redan fått nya villkor");
  });
});

describe("refinansieringsMening", () => {
  it("one sentence from the same numbers", () => {
    const p = prognosFor(PONTON, 5_759_091);
    expect(refinansieringsMening(p, 5_759_091)?.replace(/\s/g, " ")).toBe(
      "28,7 % av lånen (1 653 080 kr) får ny ränta inom 24 månader, vilket vid dagens ränta påverkar avgiften knappt (ca 3 kr/mån); lån på 4 106 011 kr har troligen redan fått nya villkor som vi inte känner till.",
    );
  });
  it("null when there is nothing factual", () => {
    expect(refinansieringsMening(prognosFor([], 1_000_000))).toBeNull();
  });
});

describe("arRefinansieringsflagga", () => {
  // The model's flag from the pre-2026-10-26 /exempel (PROMPT_VERSION 10), the
  // case that started this round: it said the fee may rise; the table showed a fall.
  const GAMMAL_MODELLFLAGGA: RedFlag = {
    id: "lan-forfaller-2026",
    titel: "Tre fjärdedelar av lånen ska omsättas 2026",
    beskrivning:
      "5 759 091 kr, 74 % av föreningens lån, förfaller 2026. Ett av lånen på 1 180 000 kr har redan 4,49 % ränta, medan övriga ligger på 2,43–2,53 %. Genomsnittsräntan är 3,12 %. Om lånen med lägre ränta omsätts till dyrare villkor ökar räntekostnaden (235 636 kr senaste året) och avgiften kan behöva höjas. Räntekänsligheten på 4,2 % visar att varje procentenhets ränteökning motsvarar cirka 4,2 % högre avgift.",
    severity: "medel",
    ref: { page: 18, excerpt: "SEB 2026-03-28 2,53 % 2 926 011" },
    harledsFran: ["rantekanslighet", "skuldsattning_per_m2_totalyta"],
  };
  it("recognises the old sample's model flag about the loans being reset in 2026", () => {
    expect(arRefinansieringsflagga(GAMMAL_MODELLFLAGGA)).toBe(true);
  });
  it("is false for every model flag in the current sample", () => {
    const andra = sampleAnalysis.rodaFlaggor.filter((x) => x.id !== REFINANSIERINGSFLAGGA_ID);
    expect(andra.length).toBeGreaterThan(0);
    for (const f of andra) expect(arRefinansieringsflagga(f), f.id).toBe(false);
  });
  const flagga = (
    titel: string,
    beskrivning: string,
    harledsFran: RedFlag["harledsFran"],
  ): RedFlag => ({
    id: "x",
    titel,
    beskrivning,
    severity: "medel",
    harledsFran,
  });
  it("true for loan-specific titles", () => {
    expect(arRefinansieringsflagga(flagga("Refinansieringsrisk", "x", ["rantekanslighet"]))).toBe(
      true,
    );
    expect(
      arRefinansieringsflagga(flagga("Kort bindningstid på lånen", "x", ["rantekanslighet"])),
    ).toBe(true);
    expect(
      arRefinansieringsflagga(
        flagga("Lånen förfaller 2027", "x", ["skuldsattning_per_m2_totalyta"]),
      ),
    ).toBe(true);
  });
  it("false positives from the review stay false: nettoomsättning, decay 'förfall', and a debt flag that only mentions bindningstid/förfall", () => {
    expect(
      arRefinansieringsflagga(
        flagga("Nettoomsättningen sjunker", "Intäkterna har minskat och lånen finns kvar.", [
          "rantekanslighet",
        ]),
      ),
    ).toBe(false);
    expect(
      arRefinansieringsflagga(
        flagga(
          "Eftersatt underhåll ger risk för förfall",
          "Byggnaden riskerar förfall; lån kan behövas.",
          ["skuldsattning_per_m2_totalyta"],
        ),
      ),
    ).toBe(false);
    expect(
      arRefinansieringsflagga(
        flagga(
          "Hög skuldsättning",
          "Skulden är hög. Lånen har kort bindningstid och flera förfaller 2027 och ska omsättas.",
          ["skuldsattning_per_m2_totalyta"],
        ),
      ),
    ).toBe(false);
  });
  it("an ambiguous term needs a loan word in the title and a debt/rate figure", () => {
    expect(arRefinansieringsflagga(flagga("Stor del ska omsättas", "x", ["rantekanslighet"]))).toBe(
      false,
    );
    expect(
      arRefinansieringsflagga(flagga("Lånen ska omsättas", "x", ["energikostnad_per_m2_totalyta"])),
    ).toBe(false);
    expect(arRefinansieringsflagga(flagga("Lånen ska omsättas", "x", ["rantekanslighet"]))).toBe(
      true,
    );
  });
  it("never matches Binfo's own deterministic flag", () => {
    const p = prognosFor(PONTON, 5_759_091);
    const f = byggRefinansieringsflagga(p, 5_759_091) as RedFlag;
    expect(arRefinansieringsflagga(f)).toBe(false);
  });
});

describe("amounts the component prices beyond the inom-horisont amount", () => {
  it("a later-phase loan: the effect is named 'totalt, inklusive' (never attributed to the inom amount alone)", () => {
    // inom: 1 000 000 @2,0 (rörlig-free, 2027-03-28); senare: 1 000 000 @2,0 on 2029-03-28 (month 29, weight 0,75)
    const p = prognosFor(
      [lan(1_000_000, 2.0, "2027-03-28"), lan(1_000_000, 2.0, "2029-03-28")],
      2_000_000,
    );
    const f = byggRefinansieringsflagga(p, 2_000_000) as RedFlag;
    const t = f.beskrivning.replace(/\s/g, " ");
    expect(t).toContain(
      "totalt inklusive lån på 1 000 000 kr som omsätts senare (månad 25–60, med minskad vikt)",
    );
    expect(refinansieringsMening(p, 2_000_000)?.replace(/\s/g, " ")).toContain(
      "totalt, inklusive lån på 1 000 000 kr som omsätts senare",
    );
  });
  it("undated debt: the assumed share is named", () => {
    const p = prognosFor(
      [
        lan(1_000_000, 2.0, "2027-03-28"),
        (({ villkorsandringsdag: _d, ...utanDag }) => utanDag)(lan(1_000_000, 2.0, "2027-03-28")),
      ],
      2_000_000,
      "2026-10-26",
      { snittranta: fig(2.0, { unit: "procent" }) },
    );
    const f = byggRefinansieringsflagga(p, 2_000_000) as RedFlag;
    expect(f.beskrivning).toContain("en antagen andel av skuld utan angivet datum");
  });
  it("no later phase, no undated debt: no 'inklusive' text", () => {
    const p = prognosFor([lan(5_000_000, 1.0, "2027-03-28")], 5_000_000);
    expect(byggRefinansieringsflagga(p, 5_000_000)?.beskrivning).not.toContain("inklusive");
  });
});

describe("only matured loans: nothing priced, so no direction and no 'räntan saknas'", () => {
  it("all matured, component beraknad 0: says plainly the terms are unknown", () => {
    const p = prognosFor([lan(2_000_000, 2.0, "2026-05-01")], 2_000_000);
    const f = byggRefinansieringsflagga(p, 2_000_000) as RedFlag;
    expect(f.titel.replace(/\s/g, " ")).toBe(
      "Lån på 2 000 000 kr har troligen redan fått nya villkor",
    );
    expect(f.beskrivning).not.toMatch(/knappt|kr\/mån|räntan på lånen saknas/);
    expect(f.beskrivning).toContain(
      "Vi kan därför inte räkna ut hur de nya villkoren påverkar avgiften.",
    );
    expect(refinansieringsMening(p, 2_000_000)?.replace(/\s/g, " ")).toBe(
      "Lån på 2 000 000 kr har troligen redan fått nya villkor som vi inte känner till.",
    );
  });
  it("stale report with nothing left to price (component saknar_underlag): same", () => {
    const forening: Forening = {
      namn: "Brf Test",
      orgnr: "769600-0000",
      akta: "ja",
      rakenskapsar: 2024,
      balansdag: "2024-12-31",
      keyFigures: [],
      lanebok: { totalSkuld: fig(1_000_000), lan: [lan(1_000_000, 4.85, "2025-01-02")] },
    };
    const p = beraknaAvgiftsprognos({
      forening,
      kontrollsummor: { arsavgifter: fig(4_800_000) },
      manadsavgift: 4000,
      boarea: 50,
      referensranta: REF,
      idag: "2026-10-26",
    }).prognos;
    expect(p.komponenter.find((k) => k.id === "refinansiering")?.status).toBe("saknar_underlag");
    const f = byggRefinansieringsflagga(p, 1_000_000) as RedFlag;
    expect(f.beskrivning).not.toMatch(/saknas/);
    expect(f.beskrivning).toContain("Vi kan därför inte räkna ut");
  });
});

describe("year-only maturities (old extractions)", () => {
  const gammal = (ar: number, idag: string) => {
    const forening: Forening = {
      namn: "Brf Test",
      orgnr: "769600-0000",
      akta: "ja",
      rakenskapsar: 2025,
      balansdag: "2025-12-31",
      keyFigures: [],
      lanebok: {
        totalSkuld: fig(2_000_000),
        forfalloprofil: [{ ar, belopp: fig(2_000_000), ranta: fig(2.0, { unit: "procent" }) }],
      },
    };
    return beraknaAvgiftsprognos({
      forening,
      kontrollsummor: { arsavgifter: fig(4_800_000) },
      manadsavgift: 4000,
      boarea: 50,
      referensranta: REF,
      idag,
    }).prognos;
  };
  it("a past YEAR is matured; the text says 'under 2025', never '1 juli'", () => {
    const p = gammal(2025, "2026-10-26");
    expect(p.refinansiering?.lan?.[0]).toMatchObject({ fas: "forfallit", endastAr: true });
    const f = byggRefinansieringsflagga(p, 2_000_000) as RedFlag;
    expect(f.beskrivning).toContain("villkorsändringsdag under 2025");
    expect(f.beskrivning).not.toMatch(/juli/);
  });
  it("the current year is not matured: priced even though 1 juli has passed", () => {
    const p = gammal(2026, "2026-10-26");
    expect(p.refinansiering?.lan?.[0]).toMatchObject({ fas: "inom_horisont", endastAr: true });
    expect(p.refinansiering?.forfallandeBelopp).toBe(2_000_000);
  });
});
