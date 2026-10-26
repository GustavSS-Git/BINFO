import { describe, expect, it } from "vitest";
import { beraknaHushallSkatt } from "@/lib/skatt2026";
import { beraknaKalkyl, RANTEAVDRAG_FORUTSATTER_SKATT_TEXT, sammanfattaKalkyl } from "./berakna";
import { tomSida, underlagFranSida, type KalkylSida } from "./sida";
import type { KalkylUnderlag } from "./underlag";

function kalkyl(delar: Partial<KalkylSida> = {}): KalkylUnderlag {
  return underlagFranSida({ ...tomSida(), ...delar }).underlag;
}

const KOMPLETT: Partial<KalkylSida> = {
  lanebelopp: "3960000",
  kontantinsats: "990000",
  ranta: "3,6",
  manadsavgift: "3240",
  boarea: "58",
  antalLantagare: "2",
  inkomst1: "540000",
  inkomst2: "420000",
  avgiftInkluderar: { varme: "nej", vatten: "nej", el: "nej", bredband: "nej", tv: "nej" },
};

describe("belåningsgrad och amorteringstakt (Lag 2026:226 7 §)", () => {
  const takt = (lan: string, kont: string) =>
    beraknaKalkyl(kalkyl({ ...KOMPLETT, lanebelopp: lan, kontantinsats: kont })).lan;

  it("exakt 50 % ger ingen amortering, strax över ger 1 %", () => {
    expect(takt("5000000", "5000000").amorteringstaktProcent).toBe(0);
    expect(takt("5000000", "5000000").amorteringsniva).toBe("hogst50");
    expect(takt("5001", "4999").amorteringstaktProcent).toBe(1);
    expect(takt("5001", "4999").amorteringsniva).toBe("over50till70");
  });

  it("exakt 70 % ger 1 %, strax över ger 2 %", () => {
    expect(takt("7000000", "3000000").amorteringstaktProcent).toBe(1);
    expect(takt("7001", "2999").amorteringstaktProcent).toBe(2);
    expect(takt("7001", "2999").amorteringsniva).toBe("over70");
  });

  it("skiktet följer takten även när belåningsgraden avrundas till 70,0 (ingen dubbel tröskel)", () => {
    const l = takt("70004", "29996"); // 70,004 %
    expect(l.amorteringstaktProcent).toBe(2);
    expect(l.amorteringsniva).toBe("over70");
  });

  it("skuldkvoten påverkar aldrig takten", () => {
    const r = beraknaKalkyl(
      kalkyl({ ...KOMPLETT, lanebelopp: "4500000", kontantinsats: "500000", inkomst1: "100000" }),
    );
    expect(r.lan.amorteringstaktProcent).toBe(2);
    expect(r.lan.overBankernasTypiskaTak).toBe(true);
  });

  it("amorteringen räknas på hela det nya lånet", () => {
    const r = beraknaKalkyl(kalkyl(KOMPLETT)); // 80 % -> 2 %
    expect(r.nu.amortering).toBe(6600); // 3 960 000 × 2 % / 12
  });
});

describe("bolånetaket 90 %", () => {
  it("exakt 10 % kontantinsats är godkänt, strax under ger fel", () => {
    expect(
      beraknaKalkyl(kalkyl({ lanebelopp: "9000000", kontantinsats: "1000000" })).lan
        .kontantinsatsFel,
    ).toBeNull();
    const fel = beraknaKalkyl(kalkyl({ lanebelopp: "9000100", kontantinsats: "999900" })).lan
      .kontantinsatsFel;
    expect(fel).toMatch(/minst 10 %/);
  });

  it("inget fel när kontantinsatsen inte är ifylld", () => {
    expect(beraknaKalkyl(kalkyl({ lanebelopp: "3000000" })).lan.kontantinsatsFel).toBeNull();
  });
});

describe("ränteavdrag: en beräkning överallt", () => {
  it("månadssumman och deklarationen är samma tal för en låginkomsttagare", () => {
    const r = beraknaKalkyl(
      kalkyl({
        ...KOMPLETT,
        antalLantagare: "1",
        inkomst1: "150000",
        lanebelopp: "4455000",
        kontantinsats: "495000",
        ranta: "3",
      }),
    );
    // Fall D i skatt2026.test.ts: skatten räcker bara till 6 990 kr av 40 095 kr.
    expect(r.ranteavdrag.perAr).toBe(6990);
    expect(r.ranteavdrag.forloratPerAr).toBeGreaterThan(30_000);
    expect(r.nu.ranteavdragPerManad).toBe(Math.round(6990 / 12));
    expect(r.ranteavdrag.forutsatterSkatt).toBe(false);
    expect(r.ranteavdrag.not).toBeNull();
  });

  it("100 000 kr per person: en låntagare får 30 % + 21 % över taket", () => {
    // 150 000 kr ränta/år: 3 750 000 × 4 %.
    const r = beraknaKalkyl(
      kalkyl({
        ...KOMPLETT,
        antalLantagare: "1",
        inkomst1: "900000",
        lanebelopp: "3750000",
        kontantinsats: "1250000",
        ranta: "4",
      }),
    );
    expect(r.ranteavdrag.perAr).toBe(40_500);
  });

  it("två låntagare delar räntan lika och får taket två gånger", () => {
    const r = beraknaKalkyl(
      kalkyl({
        ...KOMPLETT,
        inkomst1: "900000",
        inkomst2: "900000",
        lanebelopp: "3750000",
        kontantinsats: "1250000",
        ranta: "4",
      }),
    );
    expect(r.ranteavdrag.perAr).toBe(45_000); // 2 × 75 000 × 30 %
  });

  it("olika inkomster: varje persons avdrag begränsas av just hens skatt", () => {
    const u = kalkyl({ ...KOMPLETT, inkomst1: "900000", inkomst2: "150000" });
    const r = beraknaKalkyl(u);
    const arsranta = 3_960_000 * 0.036;
    const hushall = beraknaHushallSkatt([900_000, 150_000], arsranta);
    const [hog, lag] = hushall.personer;
    expect(hog?.ranteavdragForloratPerAr).toBe(0);
    expect((lag?.ranteavdragForloratPerAr ?? 0) > 0).toBe(true);
    expect(r.ranteavdrag.perAr).toBe(hushall.ranteavdragPerAr);
    expect(r.ranteavdrag.forloratPerAr).toBe(hushall.ranteavdragForloratPerAr);
  });

  it("saknas inkomst räknas full sats och resultatet säger att det förutsätter skatt", () => {
    const r = beraknaKalkyl(kalkyl({ ...KOMPLETT, inkomst1: "", inkomst2: "" }));
    expect(r.ranteavdrag.forutsatterSkatt).toBe(true);
    expect(r.ranteavdrag.not).toBe(RANTEAVDRAG_FORUTSATTER_SKATT_TEXT);
    expect(r.ranteavdrag.not).toContain("förutsätter att ni betalar tillräckligt med skatt");
    // 142 560 kr ränta, delad lika, 30 %: 42 768 kr.
    expect(r.ranteavdrag.perAr).toBeCloseTo(42_768, 5);
    expect(r.ranteavdrag.forloratPerAr).toBe(0);
  });

  it("bara en av två inkomster ifylld räknas som saknad inkomst", () => {
    const r = beraknaKalkyl(kalkyl({ ...KOMPLETT, inkomst2: "" }));
    expect(r.fyllt.inkomst).toBe(false);
    expect(r.ranteavdrag.forutsatterSkatt).toBe(true);
  });
});

describe("tomma och ogiltiga fält", () => {
  it("helt tom kalkyl: inget är ifyllt, inga scenarier, KALP saknar uppgifter", () => {
    const r = beraknaKalkyl(kalkyl());
    expect(Object.values(r.fyllt).some(Boolean)).toBe(false);
    expect(r.scenarier).toEqual([]);
    expect(r.kalp.beraknad).toBe(false);
    expect(r.kalp.kvarAttLevaPa).toBeNull();
    expect(r.kalp.saknas).toEqual([
      "lånebelopp",
      "kontantinsats",
      "månadsavgift",
      "bruttoinkomst",
      "boarea",
    ]);
    expect(sammanfattaKalkyl(kalkyl())).toEqual({
      totalPerManad: null,
      totalPerManadHog: null,
      belaningsgradProcent: null,
      amorteringstaktProcent: null,
      kvarAttLevaPaKalp: null,
    });
  });

  it("ogiltig text ger fel och räknas som tom, aldrig NaN", () => {
    const { underlag, fel } = underlagFranSida({
      ...tomSida(),
      ...KOMPLETT,
      ranta: "abc",
      lanebelopp: "-5",
    });
    expect(fel.ranta).toBeTruthy();
    expect(fel.lanebelopp).toBe("Värdet kan inte vara negativt.");
    expect(underlag.rantaProcent).toBeUndefined();
    const r = beraknaKalkyl(underlag);
    expect(Number.isNaN(r.nu.betalarPerManad)).toBe(false);
    expect(r.fyllt.ranta).toBe(false);
  });

  it("saknad boarea: schabloner som beror på ytan blir null och totalen visas inte", () => {
    const r = beraknaKalkyl(kalkyl({ ...KOMPLETT, boarea: "" }));
    expect(r.fyllt.boarea).toBe(false);
    expect(r.fyllt.total).toBe(false);
    const rad = (id: string) => r.drift.find((d) => d.id === id);
    // Värme och vatten är per m² boarea och saknar värde utan boarea;
    // hushållsel och hemförsäkring följer antal personer (Konsumentverket 2026).
    expect(rad("varme")?.schablon).toBeNull();
    expect(rad("vatten")?.schablon).toBeNull();
    expect(rad("hushallsel")?.schablon).toBe(530); // 2 personer
    expect(rad("hemforsakring")?.schablon).toBe(170); // 2 personer
    expect(rad("bredband")?.schablon).toBe(349);
    expect(r.kalp.saknas).toContain("boarea");
  });
});

describe("drift och egna värden", () => {
  it("poster som ingår i avgiften räknas inte med", () => {
    const alla = beraknaKalkyl(kalkyl(KOMPLETT)).nu.drift;
    const utanVarme = beraknaKalkyl(
      kalkyl({
        ...KOMPLETT,
        avgiftInkluderar: { varme: "ja", vatten: "nej", el: "nej", bredband: "nej", tv: "nej" },
      }),
    ).nu.drift;
    expect(alla - utanVarme).toBe(1218); // 21 × 58
  });

  it("okänd post ger ett spann; eget värde flyttar bara de scenarier där posten räknas", () => {
    const okant = { varme: "okant", vatten: "nej", el: "nej", bredband: "nej", tv: "nej" } as const;
    const bas = beraknaKalkyl(kalkyl({ ...KOMPLETT, avgiftInkluderar: okant }));
    expect(bas.nu.summor.harSpann).toBe(true);
    expect(bas.nu.summor.nettoHog - bas.nu.summor.nettoLag).toBe(1218);
    const med = beraknaKalkyl(
      kalkyl({
        ...KOMPLETT,
        avgiftInkluderar: okant,
        egnaKostnader: { varme: 1500, hushallsel: 1000 },
      }),
    );
    // El (nej): +470 i båda; värme (okänt): +282 bara i högt scenario.
    const elDiff = 1000 - 530;
    expect(med.nu.summor.nettoLag - bas.nu.summor.nettoLag).toBe(elDiff);
    expect(med.nu.summor.nettoHog - bas.nu.summor.nettoHog).toBe(elDiff + (1500 - 1218));
  });
});

describe("räntescenarier", () => {
  const u = kalkyl({ ...KOMPLETT, kalkylranta: "7" });
  const medKanslighet: KalkylUnderlag = { ...u, rantekanslighetProcent: 10 };

  it("egen ränta, +1, +2, +3 och kalkylräntan i den ordningen", () => {
    const r = beraknaKalkyl(u);
    expect(r.scenarier.map((s) => s.id)).toEqual([
      "egen",
      "plus1",
      "plus2",
      "plus3",
      "kalkylranta",
    ]);
    expect(r.scenarier.map((s) => s.rantaProcent)).toEqual([3.6, 4.6, 5.6, 6.6, 7]);
    expect(r.scenarier[0]?.rantekostnad).toBe(11_880); // 3 960 000 × 3,6 % / 12
    expect(r.scenarier[4]?.rantekostnad).toBe(23_100); // × 7 %
  });

  it("första raden är samma tal som huvudräkningen utan stress", () => {
    const r = beraknaKalkyl(u);
    expect(r.scenarier[0]?.summor.nettoLag).toBe(r.nu.summor.nettoLag);
  });

  it("utan räntekänslighet stressas bara räntan, med känslighet även avgiften", () => {
    const utan = beraknaKalkyl(u);
    expect(utan.scenarier.every((s) => s.manadsavgift === 3240)).toBe(true);
    const med = beraknaKalkyl(medKanslighet);
    // 10 % avgiftshöjning per procentenhet.
    expect(med.scenarier.map((s) => s.manadsavgift)).toEqual([3240, 3564, 3888, 4212, 4342]);
    expect(med.scenarier[4]?.avgiftsokning).toBe(1102);
  });

  it("kalkylränta under din ränta stressar inte avgiften nedåt", () => {
    const r = beraknaKalkyl({ ...medKanslighet, kalkylrantaProcent: 2 });
    expect(r.scenarier[4]?.manadsavgift).toBe(3240);
  });

  it("ränteavdraget följer räntan i varje scenario", () => {
    const r = beraknaKalkyl(u);
    const avdrag = r.scenarier.map((s) => s.ranteavdragPerAr);
    expect(avdrag).toEqual([...avdrag].sort((a, b) => a - b));
    expect(avdrag[0]).toBe(42_768);
  });

  it("räntestressreglaget flyttar huvudräkningen men inte scenariotabellen", () => {
    const a = beraknaKalkyl(u);
    const b = beraknaKalkyl({ ...u, rantestressPp: 2 });
    expect(b.nu.rantaProcent).toBeCloseTo(5.6, 10);
    expect(b.scenarier.map((s) => s.rantaProcent)).toEqual(a.scenarier.map((s) => s.rantaProcent));
  });
});

describe("KALP: kvar att leva på enligt bankens kalkyl", () => {
  it("stämmer med en handräknad Konsumentverket-kalkyl", () => {
    // 2 vuxna (25–50), alla 'nej' i avgiften.
    // Konsumentverket: mat 2 × 2 730 = 5 460; övriga individuella 2 × 2 140 = 4 280;
    // gemensamma för 2 personer 4 390. Levnadskostnader 14 130 kr.
    // Boende vid 7 %: ränta 3 960 000 × 7 % / 12 = 23 100, amortering 2 % = 6 600,
    // avgift 3 240, värme 21 × 58 = 1 218. Summa 34 158.
    const r = beraknaKalkyl(kalkyl({ ...KOMPLETT, antalVuxna: "2" }));
    expect(r.kalp.beraknad).toBe(true);
    expect(r.kalp.levnadskostnader?.summa).toBe(14_130);
    expect(r.kalp.summaKostnader).toBe(34_158 + 14_130);
    const netto = beraknaHushallSkatt([540_000, 420_000], 0).nettoinkomstPerManad;
    expect(r.kalp.kvarAttLevaPa).toBe(Math.round(netto - 48_288));
    expect(r.kalp.utfall).toBe("plus");
  });

  it("verdiktet är bara tecknet: underskott ger minus, exakt 0 ger plus", () => {
    const litet = beraknaKalkyl(kalkyl({ ...KOMPLETT, inkomst1: "200000", inkomst2: "200000" }));
    expect(litet.kalp.kvarAttLevaPa).toBeLessThan(0);
    expect(litet.kalp.utfall).toBe("minus");
  });

  it("kalkylräntan är redigerbar och går igenom", () => {
    const sju = beraknaKalkyl(kalkyl(KOMPLETT));
    const fem = beraknaKalkyl(kalkyl({ ...KOMPLETT, kalkylranta: "5" }));
    expect(fem.kalp.kalkylrantaProcent).toBe(5);
    expect((fem.kalp.kvarAttLevaPa ?? 0) - (sju.kalp.kvarAttLevaPa ?? 0)).toBe(6_600);
  });

  it("el och vatten som ingår i avgiften räknas inte dubbelt; värme som ingår tas bort", () => {
    const nej = beraknaKalkyl(kalkyl(KOMPLETT)).kalp;
    const ja = beraknaKalkyl(
      kalkyl({
        ...KOMPLETT,
        avgiftInkluderar: { varme: "ja", vatten: "ja", el: "ja", bredband: "nej", tv: "nej" },
      }),
    ).kalp;
    // 2 personer: hushållsel 530 + vatten 440 + värme 1 218.
    expect((ja.kvarAttLevaPa ?? 0) - (nej.kvarAttLevaPa ?? 0)).toBe(530 + 440 + 1218);
  });

  it("hushåll över 7 personer går inte att räkna", () => {
    const r = beraknaKalkyl(
      kalkyl({ ...KOMPLETT, antalVuxna: "4", barn: { ...tomSida().barn, "7-10": "4" } }),
    );
    expect(r.kalp.hushalletForStort).toBe(true);
    expect(r.kalp.kvarAttLevaPa).toBeNull();
  });

  it("sammanfattningen bär nyckeltalen", () => {
    const s = sammanfattaKalkyl(kalkyl(KOMPLETT));
    expect(s.belaningsgradProcent).toBe(80);
    expect(s.amorteringstaktProcent).toBe(2);
    expect(s.totalPerManad).not.toBeNull();
    expect(s.kvarAttLevaPaKalp).not.toBeNull();
  });
});
