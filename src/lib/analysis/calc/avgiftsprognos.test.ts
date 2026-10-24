import { describe, expect, it } from "vitest";
import type {
  AvgiftsKomponentId,
  Figure,
  Forening,
  KeyFigure,
  Kontrollsummor,
  Lan,
  Referensranta,
} from "@/types/analysis";
import {
  beraknaAvgiftsprognos,
  laggTillManader,
  tryckFor,
  type AvgiftsprognosInput,
} from "./avgiftsprognos";

// All amounts below are worked out by hand in the comments.
// Default: månadsavgift 4 000 kr, årsavgifter 4 800 000 kr → andel = 48 000 / 4 800 000 = 0,01,
// so a BRF cost of X kr/year is X × 0,01 ÷ 12 = X / 1 200 kr/month for the flat.
// Reference rate 2,068 % + margin 0,58 = new rate 2,648 %.

const REF: Referensranta = {
  namn: "3-månaders statsskuldväxel",
  serie: "SETB3MBENCH",
  datum: "2026-10-23",
  procent: 2.068,
  kalla: "Sveriges riksbank",
  reserv: false,
};
const IDAG = "2026-10-24"; // horizon end 2028-10-24

const fig = (value: number | null, extra: Partial<Figure> = {}): Figure => ({
  value,
  unit: "kr",
  source: "arsredovisning",
  ref: { page: 5, excerpt: "x" },
  ...extra,
});

const sparande = (v: number | null, extra: Partial<Figure> = {}): KeyFigure => ({
  id: "sparande_per_m2_totalyta",
  label: "Sparande",
  figure: fig(v, { unit: "kr/m2", ...extra }),
  status: "okant",
  forklaring: "",
});
const rk = (v: number | null): KeyFigure => ({
  id: "rantekanslighet",
  label: "Räntekänslighet",
  figure: fig(v, { unit: "procent" }),
  status: "okant",
  forklaring: "",
});

function forening(extra: Partial<Forening> = {}): Forening {
  return {
    namn: "Brf Test",
    orgnr: "769600-0000",
    akta: "ja",
    rakenskapsar: 2025,
    keyFigures: [],
    ...extra,
  };
}

const KS: Kontrollsummor = { arsavgifter: fig(4_800_000) };

function kor(f: Forening, extra: Partial<AvgiftsprognosInput> = {}) {
  return beraknaAvgiftsprognos({
    forening: f,
    kontrollsummor: KS,
    manadsavgift: 4000,
    boarea: 50,
    referensranta: REF,
    idag: IDAG,
    ...extra,
  });
}
function komp(r: ReturnType<typeof kor>, id: AvgiftsKomponentId) {
  const k = r.prognos.komponenter.find((c) => c.id === id);
  if (!k) throw new Error("missing component " + id);
  return k;
}
const lan = (
  belopp: number,
  ranta: number | null,
  dag: string | undefined,
  rantetyp: Lan["rantetyp"] = "okant",
): Lan => ({
  belopp: fig(belopp),
  ...(ranta !== null ? { ranta: fig(ranta, { unit: "procent" }) } : {}),
  ...(dag ? { villkorsandringsdag: dag } : {}),
  rantetyp,
  ref: { page: 9, excerpt: "lån" },
});
const lanebok = (totalSkuld: number, lanLista?: Lan[], extra: object = {}) => ({
  lanebok: { totalSkuld: fig(totalSkuld), ...(lanLista ? { lan: lanLista } : {}), ...extra },
});

describe("laggTillManader", () => {
  it("adds months and clamps the day", () => {
    expect(laggTillManader("2026-10-24", 24)).toBe("2028-10-24");
    expect(laggTillManader("2026-01-31", 1)).toBe("2026-02-28");
    expect(laggTillManader("2026-11-30", 3)).toBe("2027-02-28");
  });
});

describe("andel", () => {
  it("avgiftsandel: 4 000 × 12 / 4 800 000 = 0,01", () => {
    const r = kor(forening());
    expect(r.prognos.andel?.metod).toBe("avgiftsandel");
    expect(r.prognos.andel?.varde).toBeCloseTo(0.01, 10);
  });
  it("ytandel: 50 / 5 000 = 0,01 when årsavgifter missing", () => {
    const r = kor(forening({ bostadsrattsyta: fig(5000, { unit: "m2" }) }), { kontrollsummor: {} });
    expect(r.prognos.andel).toEqual({ varde: 0.01, metod: "ytandel" });
  });
  it("ytandel falls back to kontrollsummor.bostadsrattsyta", () => {
    const r = kor(forening(), { kontrollsummor: { bostadsrattsyta: fig(2500, { unit: "m2" }) } });
    expect(r.prognos.andel).toEqual({ varde: 0.02, metod: "ytandel" });
  });
  it("harledd: årsavgifter = 10 000 000 / (200/100) = 5 000 000 → 48 000 / 5 000 000 = 0,0096", () => {
    const r = kor(forening({ ...lanebok(10_000_000), keyFigures: [rk(200)] }), {
      kontrollsummor: {},
    });
    expect(r.prognos.andel?.metod).toBe("harledd_avgiftsandel");
    expect(r.prognos.andel?.varde).toBeCloseTo(0.0096, 10);
  });
  it("unknown: every krPerManad and the total are null", () => {
    const r = kor(
      forening({
        keyFigures: [sparande(-100)],
        totalyta: fig(2000, { unit: "m2" }),
      }),
      {
        kontrollsummor: {},
      },
    );
    expect(r.prognos.andel).toBeNull();
    expect(r.prognos.totalKrPerManad).toBeNull();
    expect(r.prognos.komponenter.every((k) => k.krPerManad === null)).toBe(true);
    // the BRF-level amount is still computed. Schablon target 300, gap 300 + 100 = 400,
    // × 2 000 m² × dampening 0,5 = 400 000 (was 200 000 with the old negative-only logic)
    expect(komp(r, "spargap").foreningKrPerAr).toBe(400_000);
  });
  it("guards a share above 1 (årsavgifter 40 000 → 1,2) and falls through", () => {
    const r = kor(forening(), { kontrollsummor: { arsavgifter: fig(40_000) } });
    expect(r.prognos.andel).toBeNull();
  });
  it("guards zero årsavgifter", () => {
    expect(kor(forening(), { kontrollsummor: { arsavgifter: fig(0) } }).prognos.andel).toBeNull();
  });
});

describe("spargap (sparande mot underhållsbehov; no plan → schablon 300, dampening 0,5)", () => {
  const med = (kf: KeyFigure | null, extra: Partial<Forening> = {}) =>
    komp(
      kor(
        forening({
          keyFigures: kf ? [kf] : [],
          totalyta: fig(2000, { unit: "m2" }),
          ...extra,
        }),
      ),
      "spargap",
    );
  it("−100 kr/m²: gap 400 × 2 000 × 0,5 = 400 000 kr/year → × 0,01 / 12 = 333,33 → 333", () => {
    const k = med(sparande(-100));
    expect(k).toMatchObject({ status: "beraknad", foreningKrPerAr: 400_000, krPerManad: 333 });
    expect(k.ref?.page).toBe(5);
    expect(k.label).toBe("Sparande mot underhållsbehov");
  });
  it("positive sparande is no longer ej_aktuell: 50 → gap 250 × 2 000 × 0,5 = 250 000 → 208,33 → 208", () => {
    expect(med(sparande(50))).toMatchObject({
      status: "beraknad",
      foreningKrPerAr: 250_000,
      krPerManad: 208,
    });
  });
  it("a surplus is negative: 500 → gap −200 × 2 000 × 0,5 = −200 000 → −166,67 → −167", () => {
    expect(med(sparande(500))).toMatchObject({ foreningKrPerAr: -200_000, krPerManad: -167 });
  });
  it("planned and financed withdrawal is no exception any more (schablon): calculated, and mentioned", () => {
    const k = med(sparande(-100), { sparandeUttag: { planerat: "ja", finansierat: "ja" } });
    expect(k).toMatchObject({ status: "beraknad", foreningKrPerAr: 400_000 });
    expect(k.forklaring).toMatch(/finansierat uttag/);
  });
  it("plan target, financed withdrawal: gap logic as is (investeringsbehov 400, sparande −100 → 500 × 2 000 = 1 000 000)", () => {
    const k = med(sparande(-100), {
      sparandeUttag: { planerat: "ja", finansierat: "ja" },
      underhallsplan: { finns: "ja", investeringsbehovPerM2: fig(400, { unit: "kr/m2" }) },
    });
    expect(k).toMatchObject({ status: "beraknad", foreningKrPerAr: 1_000_000 });
    expect(k.forklaring).not.toMatch(/uttag/);
  });
  it("forklaring is one Swedish sentence with target, source, sparande and gap", () => {
    const k = med(sparande(150));
    // 300 − 150 = 150 kr/m²
    expect(k.forklaring).toBe(
      "Behovet är cirka 300 kr/m² per år (schablon), föreningen sparar 150 kr/m², ett glapp på 150 kr/m², varav 50 % räknas med.",
    );
  });
  it("value null with tecken negativ: saknar_underlag", () => {
    expect(med(sparande(null, { tecken: "negativ", tryckt: "neg" })).status).toBe(
      "saknar_underlag",
    );
  });
  it("value null without sign, or no key figure: saknar_underlag", () => {
    expect(med(sparande(null)).status).toBe("saknar_underlag");
    expect(med(null).status).toBe("saknar_underlag");
  });
  it("no totalyta: saknar_underlag, but the prognosis still carries the sparbehov", () => {
    const r = kor(forening({ keyFigures: [sparande(-100)] }));
    expect(komp(r, "spargap").status).toBe("saknar_underlag");
    expect(r.prognos.sparbehov).toMatchObject({
      malKrPerM2: 300,
      glappKrPerM2: 400,
      totalyta: null,
    });
  });
  it("byggår and hiss reach the schablon: byggår 1950 + hiss ja → 5/7 eftersatt → 336; gap 336 − 150 = 186 × 2 000 × 0,5 = 186 000", () => {
    const f = forening({
      keyFigures: [sparande(150)],
      totalyta: fig(2000, { unit: "m2" }),
      genomfordaAtgarder: [],
    });
    const r = kor(f, {
      byggar: 1950,
      hiss: "ja",
    });
    expect(r.prognos.sparbehov).toMatchObject({ malKrPerM2: 336, malKalla: "schablon" });
    expect(komp(r, "spargap").foreningKrPerAr).toBe(186_000);
  });
  it("plan target: investeringsbehov 400, sparande 150 → 250 × 2 000 = 500 000 (dampning 1) → 416,67 → 417", () => {
    const k = med(sparande(150), {
      underhallsplan: { finns: "ja", investeringsbehovPerM2: fig(400, { unit: "kr/m2" }) },
    });
    expect(k).toMatchObject({ foreningKrPerAr: 500_000, krPerManad: 417 });
  });
});

describe("refinansiering", () => {
  const med = (f: Partial<Forening>, extra: Partial<AvgiftsprognosInput> = {}) =>
    kor(forening(f), extra);

  it("rörlig loan 1 000 000 @2,0 %: (2,648 − 2,0)/100 × 1 000 000 = 6 480/year → 5,4 → 5 kr/month", () => {
    const r = med(lanebok(1_000_000, [lan(1_000_000, 2.0, undefined, "rorlig")]));
    const k = komp(r, "refinansiering");
    expect(k).toMatchObject({ status: "beraknad", foreningKrPerAr: 6480, krPerManad: 5 });
    expect(r.omsattningsbarSkuld).toBe(1_000_000);
    expect(r.prognos.refinansiering).toMatchObject({
      forfallandeBelopp: 1_000_000,
      nuvarandeRantaProcent: 2,
      nyRantaProcent: 2.648,
      marginalProcent: 0.58,
      antalLan: 1,
    });
    expect(r.prognos.refinansiering?.antagenAndelProcent).toBeUndefined();
  });
  it("rörlig loan with a far date still counts", () => {
    const k = komp(
      med(lanebok(1_000_000, [lan(1_000_000, 2.0, "2031-01-01", "rorlig")])),
      "refinansiering",
    );
    expect(k.foreningKrPerAr).toBe(6480);
  });
  it("negative: 1 000 000 @4,0 → (2,648 − 4,0) = −1,352 % → −13 520/year → −11,27 → −11", () => {
    const k = komp(med(lanebok(1_000_000, [lan(1_000_000, 4.0, "2027-01-15")])), "refinansiering");
    expect(k).toMatchObject({ foreningKrPerAr: -13_520, krPerManad: -11 });
  });
  it("date already passed after the balance date counts", () => {
    const k = komp(med(lanebok(1_000_000, [lan(1_000_000, 2.0, "2026-05-01")])), "refinansiering");
    expect(k.foreningKrPerAr).toBe(6480);
  });
  it("horizon edge: 2028-10-24 is in, 2028-10-25 is out", () => {
    const i = komp(med(lanebok(1_000_000, [lan(1_000_000, 2.0, "2028-10-24")])), "refinansiering");
    expect(i.foreningKrPerAr).toBe(6480);
    // 2028-10-25 is month 25 = the later phase (see "later phase" below); beyond month 60 nothing counts
    const u = med(lanebok(1_000_000, [lan(1_000_000, 2.0, "2031-10-25")]));
    expect(komp(u, "refinansiering")).toMatchObject({ status: "beraknad", foreningKrPerAr: 0 });
    expect(u.omsattningsbarSkuld).toBe(0);
  });
  it("an undated loan among dated ones gets the 50 % assumption: 1 000 000 × 50 % × (2,648 − 2,0) % = 3 240, plus the dated one in month 25 (6 480 × 0,75 = 4 860) = 8 100", () => {
    const u = med(
      lanebok(2_000_000, [lan(1_000_000, 2.0, "2028-10-25"), lan(1_000_000, 2.0, undefined)], {
        snittranta: fig(2.0, { unit: "procent" }),
      }),
    );
    expect(komp(u, "refinansiering")).toMatchObject({ status: "beraknad", foreningKrPerAr: 8100 });
    expect(u.omsattningsbarSkuld).toBe(500_000);
    expect(u.prognos.refinansiering?.antagenAndelProcent).toBe(50);
    expect(u.totalSpannVidAntagande).toBeDefined();
  });
  it("debt the loan rows don't cover (> 2 %) gets the 50 % assumption too", () => {
    // rows 1 000 000 @2,0 dated 2029-12-01 = month 38 → weight 0,5 → 3 240 (later phase);
    // total 3 000 000 → 2 000 000 uncovered → 1 000 000 × 0,648 % = 6 480; sum 9 720
    const u = med(
      lanebok(3_000_000, [lan(1_000_000, 2.0, "2029-12-01")], {
        snittranta: fig(2.0, { unit: "procent" }),
      }),
    );
    expect(komp(u, "refinansiering").foreningKrPerAr).toBe(9720);
  });
  it("a report older than 18 months (balansdag 2024-12-31, read 2026-10-24) → saknar_underlag", () => {
    const r = med({
      ...lanebok(1_000_000, [lan(1_000_000, 4.85, "2025-01-02")]),
      rakenskapsar: 2024,
      balansdag: "2024-12-31",
    });
    expect(komp(r, "refinansiering").status).toBe("saknar_underlag");
    expect(r.antalSaknadeUnderlag).toBeGreaterThan(0);
  });
  it("debt-free (totalSkuld 0): beraknad 0", () => {
    const r = med(lanebok(0));
    expect(komp(r, "refinansiering")).toMatchObject({ status: "beraknad", foreningKrPerAr: 0 });
    expect(r.omsattningsbarSkuld).toBe(0);
  });
  it("old extraction, forfalloprofil years only: 2027 → 2027-07-01 in, 2029 out", () => {
    // 1 000 000 @3,0 in: (2,648−3,0) = −0,352 % → −3 520 → −2,93 → −3
    const r = med({
      lanebok: {
        totalSkuld: fig(3_000_000),
        forfalloprofil: [
          { ar: 2027, belopp: fig(1_000_000), ranta: fig(3.0, { unit: "procent" }) },
          { ar: 2029, belopp: fig(2_000_000), ranta: fig(3.0, { unit: "procent" }) },
        ],
      },
    });
    expect(komp(r, "refinansiering")).toMatchObject({ foreningKrPerAr: -3520, krPerManad: -3 });
    expect(r.omsattningsbarSkuld).toBe(1_000_000);
  });
  it("missing maturities: 50 % of 2 000 000 @2,0 (snittränta) → 1 000 000 × 0,648 % = 6 480 → 5; spann 0 / 12 960/1200 = 10,8 → 11", () => {
    const r = med(lanebok(2_000_000, undefined, { snittranta: fig(2.0, { unit: "procent" }) }));
    expect(komp(r, "refinansiering")).toMatchObject({ foreningKrPerAr: 6480, krPerManad: 5 });
    expect(r.omsattningsbarSkuld).toBe(1_000_000);
    expect(r.prognos.refinansiering?.antagenAndelProcent).toBe(50);
    expect(r.prognos.refinansiering?.forfallandeBelopp).toBe(1_000_000);
    expect(r.totalSpannVidAntagande).toEqual({ lag: 0, hog: 11 });
  });
  it("missing maturities, loans without dates: assumed share too", () => {
    const r = med(lanebok(2_000_000, [lan(2_000_000, 2.0, undefined)]));
    expect(r.prognos.refinansiering?.antagenAndelProcent).toBe(50);
  });
  it("assumed case uses räntekostnader ÷ skuld when snittränta is missing: 60 000 / 2 000 000 = 3 %", () => {
    // 1 000 000 × (2,648 − 3) = −3 520
    const r = med(lanebok(2_000_000, undefined, { rantekostnader: fig(60_000) }));
    expect(komp(r, "refinansiering").foreningKrPerAr).toBe(-3520);
    // spann: hel = −7 040 /1200 = −5,87 → −6 ; lag −6, hog 0
    expect(r.totalSpannVidAntagande).toEqual({ lag: -6, hog: 0 });
  });
  it("missing current rate: saknar_underlag, amount still reported", () => {
    const r = med(lanebok(2_000_000));
    expect(komp(r, "refinansiering").status).toBe("saknar_underlag");
    expect(r.omsattningsbarSkuld).toBe(1_000_000);
    expect(r.totalSpannVidAntagande).toBeUndefined();
  });
  it("repricing loan without any rate: saknar_underlag", () => {
    const r = med(lanebok(1_000_000, [lan(1_000_000, null, "2027-01-01")]));
    expect(komp(r, "refinansiering").status).toBe("saknar_underlag");
    expect(r.omsattningsbarSkuld).toBe(1_000_000);
  });
  it("loan without own rate takes snittränta", () => {
    const k = komp(
      med(lanebok(1_000_000, [lan(1_000_000, null, "2027-01-01")], { snittranta: fig(2.0) })),
      "refinansiering",
    );
    expect(k.foreningKrPerAr).toBe(6480);
  });
  it("no loans and no totalSkuld: saknar_underlag, omsattningsbarSkuld null", () => {
    const r = med({});
    expect(komp(r, "refinansiering").status).toBe("saknar_underlag");
    expect(r.omsattningsbarSkuld).toBeNull();
  });

  it("Pontonjären-like: 4 of 5 loans reprice (the 2028-10-28 one is out)", () => {
    // new rate 2,648. Per loan (new − current) × belopp / 100:
    //  683 080 @2,51: 0,138 → +942,6504
    //  1 180 000 @4,49: −1,842 → −21 735,60
    //  970 000 @2,43: 0,218 → +2 114,60
    //  2 926 011 @2,53: 0,118 → +3 452,69298
    //  sum = −15 225,65662 → −15 226/year; 2 000 000 @2,98 2028-10-28 is outside 2028-10-24.
    // flat: −15 226 × 0,01 / 12 = −12,69 → −13. Amount repricing 5 759 091.
    // weighted current rate: 16 772 638,63 / 5 759 091 = 2,9124 → 2,91
    const r = med(
      lanebok(7_759_091, [
        lan(683_080, 2.51, "2026-11-28"),
        lan(1_180_000, 4.49, "2026-09-28"),
        lan(970_000, 2.43, "2026-12-28"),
        lan(2_000_000, 2.98, "2028-10-28"),
        lan(2_926_011, 2.53, "2026-03-28"),
      ]),
    );
    const k = komp(r, "refinansiering");
    expect(k).toMatchObject({ status: "beraknad", foreningKrPerAr: -15_226, krPerManad: -13 });
    expect(r.omsattningsbarSkuld).toBe(5_759_091);
    expect(r.prognos.refinansiering).toMatchObject({
      forfallandeBelopp: 5_759_091,
      nuvarandeRantaProcent: 2.91,
      nyRantaProcent: 2.648,
      antalLan: 4,
    });
    expect(r.totalSpannVidAntagande).toBeUndefined();
  });
});

describe("underhall", () => {
  const post = (
    belopp: number,
    finansiering: "lan" | "fond" | "beslutad" | "ofinansierad" | "okant",
    extra: object = {},
  ) => ({
    text: "Åtgärd",
    belopp: fig(belopp),
    finansiering,
    ...extra,
  });
  it("unfinanced minus fund minus savings: (3 000 000 − 1 000 000 − 100 000×10) / 10 = 100 000/year → 83 kr/month", () => {
    // horizon years 2026–2028 (24 months). B (lån) excluded; C (fran 2040) and D (2030–2032) outside.
    const k = komp(
      kor(
        forening({
          underhallsplan: {
            finns: "ja",
            planeradeKostnader: [
              post(3_000_000, "ofinansierad"),
              post(2_000_000, "lan"),
              post(1_000_000, "okant", { fran: 2040 }),
              post(500_000, "okant", { fran: 2030, till: 2032 }),
              post(700_000, "fond"),
              post(800_000, "beslutad"),
            ],
            underhallsfond: fig(1_000_000),
            arligAvsattning: fig(100_000),
          },
        }),
      ),
      "underhall",
    );
    expect(k).toMatchObject({ status: "beraknad", foreningKrPerAr: 100_000, krPerManad: 83 });
  });
  it("a span that overlaps the 24-month horizon counts (2028–2030), one starting 2029 does not", () => {
    const k = komp(
      kor(
        forening({
          underhallsplan: {
            finns: "ja",
            planeradeKostnader: [post(1_000_000, "okant", { fran: 2028, till: 2030 })],
          },
        }),
      ),
      "underhall",
    );
    expect(k.foreningKrPerAr).toBe(100_000);
    const ute = komp(
      kor(
        forening({
          underhallsplan: {
            finns: "ja",
            planeradeKostnader: [post(1_000_000, "okant", { fran: 2029, till: 2030 })],
          },
        }),
      ),
      "underhall",
    );
    expect(ute).toMatchObject({ status: "beraknad", foreningKrPerAr: 0 });
  });
  it("covered by the fund: beraknad 0", () => {
    const k = komp(
      kor(
        forening({
          underhallsplan: {
            finns: "ja",
            planeradeKostnader: [post(500_000, "ofinansierad")],
            underhallsfond: fig(900_000),
          },
        }),
      ),
      "underhall",
    );
    expect(k).toMatchObject({ status: "beraknad", foreningKrPerAr: 0, krPerManad: 0 });
  });
  it("amounts all outside the window: beraknad 0", () => {
    const k = komp(
      kor(
        forening({
          underhallsplan: {
            finns: "ja",
            planeradeKostnader: [post(500_000, "ofinansierad", { fran: 2045 })],
          },
        }),
      ),
      "underhall",
    );
    expect(k).toMatchObject({ status: "beraknad", foreningKrPerAr: 0 });
  });
  it("no amounts: saknar_underlag in all three situations", () => {
    expect(komp(kor(forening()), "underhall").status).toBe("saknar_underlag");
    expect(komp(kor(forening({ underhallsplan: { finns: "nej" } })), "underhall").status).toBe(
      "saknar_underlag",
    );
    const k = komp(
      kor(forening({ underhallsplan: { finns: "ja", kommandeAtgarder: [{ text: "Stambyte" }] } })),
      "underhall",
    );
    expect(k.status).toBe("saknar_underlag");
    expect(k.foreningKrPerAr).toBeNull();
  });
});

describe("lokaler", () => {
  const avtal = (slutdatum: string | undefined, arshyra: number | undefined) => ({
    ...(slutdatum ? { slutdatum } : {}),
    ...(arshyra !== undefined ? { arshyra: fig(arshyra) } : {}),
    ref: { page: 7, excerpt: "lokal" },
  });
  it("no lokaler: ej_aktuell", () => {
    expect(komp(kor(forening()), "lokaler").status).toBe("ej_aktuell");
    expect(komp(kor(forening({ antalLokaler: fig(0, { unit: "antal" }) })), "lokaler").status).toBe(
      "ej_aktuell",
    );
  });
  it("one lease ends inside (200 000 × 0,5 = 100 000 → 83,33 → 83), one outside", () => {
    const k = komp(
      kor(
        forening({
          antalLokaler: fig(2, { unit: "antal" }),
          lokaler: { kontrakt: [avtal("2027-03-31", 200_000), avtal("2030-01-01", 300_000)] },
        }),
      ),
      "lokaler",
    );
    expect(k).toMatchObject({ status: "beraknad", foreningKrPerAr: 100_000, krPerManad: 83 });
  });
  it("lease ended before the balance date is ignored; none in horizon → 0", () => {
    const k = komp(
      kor(
        forening({
          lokaler: { kontrakt: [avtal("2025-06-30", 200_000), avtal("2031-01-01", 100_000)] },
        }),
      ),
      "lokaler",
    );
    expect(k).toMatchObject({ status: "beraknad", foreningKrPerAr: 0 });
  });
  it("ending lease without rent: 600 000 × (1 / 3) × 0,5 = 100 000", () => {
    const k = komp(
      kor(
        forening({
          lokaler: {
            hyresintakter: fig(600_000),
            kontrakt: [
              avtal("2027-01-01", undefined),
              avtal("2031-01-01", 100_000),
              avtal(undefined, 100_000),
            ],
          },
        }),
      ),
      "lokaler",
    );
    expect(k.foreningKrPerAr).toBe(100_000);
  });
  it("ending lease without rent and no hyresintakter: saknar_underlag", () => {
    const k = komp(
      kor(forening({ lokaler: { kontrakt: [avtal("2027-01-01", undefined)] } })),
      "lokaler",
    );
    expect(k.status).toBe("saknar_underlag");
  });
  it("lokaler present but no end dates: saknar_underlag", () => {
    expect(
      komp(kor(forening({ lokaler: { hyresintakter: fig(300_000) } })), "lokaler").status,
    ).toBe("saknar_underlag");
    expect(komp(kor(forening({ antalLokaler: fig(3, { unit: "antal" }) })), "lokaler").status).toBe(
      "saknar_underlag",
    );
  });
});

describe("energi", () => {
  const p = (finansierat: "ja" | "nej" | "okant", belopp?: number) => ({
    text: "Solceller",
    finansierat,
    ...(belopp !== undefined ? { belopp: fig(belopp) } : {}),
    ref: { page: 3, excerpt: "sol" },
  });
  it("none: ej_aktuell", () => {
    expect(komp(kor(forening()), "energi").status).toBe("ej_aktuell");
  });
  it("unfinanced 1 000 000 / 10 = 100 000 → 83,33 → 83; financed ones add 0", () => {
    const k = komp(
      kor(forening({ energiprojekt: [p("nej", 1_000_000), p("ja", 5_000_000)] })),
      "energi",
    );
    expect(k).toMatchObject({ status: "beraknad", foreningKrPerAr: 100_000, krPerManad: 83 });
  });
  it("only financed: beraknad 0", () => {
    expect(komp(kor(forening({ energiprojekt: [p("ja", 5_000_000)] })), "energi")).toMatchObject({
      status: "beraknad",
      foreningKrPerAr: 0,
    });
  });
  it("unknown financing, or unfinanced without amount: saknar_underlag", () => {
    expect(komp(kor(forening({ energiprojekt: [p("okant", 1_000_000)] })), "energi").status).toBe(
      "saknar_underlag",
    );
    expect(komp(kor(forening({ energiprojekt: [p("nej")] })), "energi").status).toBe(
      "saknar_underlag",
    );
  });
});

describe("total, guard and counts", () => {
  it("total = Σ rounded beraknade components; saknar adds nothing and is counted", () => {
    // spargap (schablon) 400 000 → 333 ; refinansiering 6 480 → 5 ; energi 100 000 → 83 ; underhåll saknar ; lokaler ej
    const r = kor(
      forening({
        keyFigures: [sparande(-100)],
        totalyta: fig(2000, { unit: "m2" }),
        ...lanebok(1_000_000, [lan(1_000_000, 2.0, undefined, "rorlig")]),
        energiprojekt: [{ text: "Sol", finansierat: "nej", belopp: fig(1_000_000) }],
      }),
    );
    expect(r.prognos.totalKrPerManad).toBe(333 + 5 + 83);
    expect(r.antalSaknadeUnderlag).toBe(1);
    expect(r.prognos.horisontManader).toBe(24);
    expect(r.prognos.berakningsdatum).toBe(IDAG);
    expect(r.prognos.osaker).toBeUndefined();
  });
  it("30 % guard: sparande −1 200 → gap 1 500 × 2 000 × 0,5 = 1 500 000 → 1 250 kr > 0,3 × 4 000 = 1 200 → osäker", () => {
    const r = kor(forening({ keyFigures: [sparande(-1200)], totalyta: fig(2000, { unit: "m2" }) }));
    expect(r.prognos.totalKrPerManad).toBe(1250);
    expect(r.prognos.osaker).toMatch(/osäker/);
  });
  it("30 % guard: exactly 1 200 is not flagged (sparande −1 140 → gap 1 440 × 1 000 = 1 440 000 → 1 200)", () => {
    const r = kor(forening({ keyFigures: [sparande(-1140)], totalyta: fig(2000, { unit: "m2" }) }));
    expect(r.prognos.totalKrPerManad).toBe(1200);
    expect(r.prognos.osaker).toBeUndefined();
  });
  it("each component carries a Swedish label and an explanation", () => {
    const r = kor(forening());
    expect(r.prognos.komponenter.map((k) => k.id)).toEqual([
      "spargap",
      "refinansiering",
      "underhall",
      "lokaler",
      "energi",
    ]);
    for (const k of r.prognos.komponenter) {
      expect(k.label.length).toBeGreaterThan(5);
      expect(k.forklaring.endsWith(".")).toBe(true);
    }
  });
});

describe("lokaler with cited zero rent (Pontonjären 3: 'Hyresintäkter, lokaler 0 289 180')", () => {
  it("is ej_aktuell, not saknar_underlag", async () => {
    const { beraknaAvgiftsprognos } = await import("./avgiftsprognos");
    const { extraktion } = await import("../__fixtures__/extraktion");
    const r = beraknaAvgiftsprognos({
      forening: {
        ...extraktion.forening,
        antalLokaler: {
          value: 2,
          unit: "antal",
          source: "arsredovisning",
          ref: { page: 4, excerpt: "2 lokaler" },
        },
        lokaler: {
          hyresintakter: {
            value: 0,
            unit: "kr",
            source: "arsredovisning",
            ref: { page: 15, excerpt: "Hyresintäkter, lokaler 0 289 180" },
          },
        },
      },
      manadsavgift: 3503,
      boarea: 48,
      referensranta: {
        namn: "x",
        serie: "x",
        datum: "2026-10-23",
        procent: 2.068,
        kalla: "x",
        reserv: false,
      },
      idag: "2026-10-24",
    });
    expect(r.prognos.komponenter.find((k) => k.id === "lokaler")?.status).toBe("ej_aktuell");
  });
});

describe("refinansiering, later phase (months 25–60 from idag 2026-10-24; weights 0,75 / 0,5 / 0,25)", () => {
  // One loan 1 000 000 @2,0: (2,648 − 2,0) % = 6 480/year × weight; ÷ 1 200 → kr/month.
  const ett = (dag: string, ranta = 2.0) =>
    kor(forening(lanebok(1_000_000, [lan(1_000_000, ranta, dag)])));
  const k = (r: ReturnType<typeof kor>) => komp(r, "refinansiering");

  it.each([
    ["2028-10-25", 25, 0.75, 4860, 4], // 4,05
    ["2029-10-24", 36, 0.75, 4860, 4], // upper edge of the first band
    ["2029-10-25", 37, 0.5, 3240, 3], // 2,7
    ["2030-10-24", 48, 0.5, 3240, 3],
    ["2030-10-25", 49, 0.25, 1620, 1], // 1,35
    ["2031-10-24", 60, 0.25, 1620, 1],
  ])("%s = month %i → weight %f → %i kr/year → %i kr/month", (dag, _m, vikt, perAr, perManad) => {
    const r = ett(dag);
    expect(k(r)).toMatchObject({
      status: "beraknad",
      foreningKrPerAr: perAr,
      krPerManad: perManad,
    });
    expect(r.prognos.refinansiering?.lan).toEqual([
      expect.objectContaining({
        fas: "senare",
        vikt,
        foreningKrPerAr: perAr,
        belopp: 1_000_000,
        dag,
      }),
    ]);
    expect(r.prognos.refinansiering?.senareHorisontManader).toBe(60);
    // the ≤ 24-month figures describe that phase only
    expect(r.prognos.refinansiering).toMatchObject({ forfallandeBelopp: 0, antalLan: 0 });
    expect(r.omsattningsbarSkuld).toBe(0);
    expect(k(r).forklaring).toMatch(/månad 25–60/);
  });
  it("month 61 (2031-10-25) is ignored", () => {
    expect(k(ett("2031-10-25"))).toMatchObject({ status: "beraknad", foreningKrPerAr: 0 });
  });
  it("cheaper-only: a dearer loan at month 40 (@4,0) is ignored, a cheaper one (@2,0) counted at 0,5", () => {
    const r = kor(
      forening(
        lanebok(2_000_000, [lan(1_000_000, 4.0, "2030-01-15"), lan(1_000_000, 2.0, "2030-01-15")]),
      ),
    );
    expect(k(r).foreningKrPerAr).toBe(3240);
    expect(r.prognos.refinansiering?.lan).toHaveLength(1);
  });
  it("a loan with exactly the new rate (2,648) adds nothing and is omitted", () => {
    const r = ett("2030-01-15", 2.648);
    expect(k(r).foreningKrPerAr).toBe(0);
  });
  it("both directions within 24 months, weight 1 (rows listed): +6 480 (rörlig @2,0) and −13 520 (@4,0 on 2027-01-15) = −7 040 → −5,87 → −6", () => {
    const r = kor(
      forening(
        lanebok(2_000_000, [
          lan(1_000_000, 2.0, undefined, "rorlig"),
          lan(1_000_000, 4.0, "2027-01-15"),
        ]),
      ),
    );
    expect(k(r)).toMatchObject({ foreningKrPerAr: -7040, krPerManad: -6 });
    expect(r.prognos.refinansiering?.lan?.map((x) => [x.fas, x.vikt, x.foreningKrPerAr])).toEqual([
      ["inom_horisont", 1, 6480],
      ["inom_horisont", 1, -13_520],
    ]);
  });
  it("both phases add: 24-month loan @2,0 (6 480) + month-37 loan @2,0 (3 240) = 9 720; amount/rate describe the first phase", () => {
    const r = kor(
      forening(
        lanebok(2_000_000, [lan(1_000_000, 2.0, "2027-01-15"), lan(1_000_000, 2.0, "2029-10-25")]),
      ),
    );
    expect(k(r).foreningKrPerAr).toBe(9720);
    expect(r.prognos.refinansiering).toMatchObject({
      forfallandeBelopp: 1_000_000,
      nuvarandeRantaProcent: 2,
      antalLan: 1,
    });
    expect(r.prognos.refinansiering?.lan).toHaveLength(2);
    expect(r.omsattningsbarSkuld).toBe(1_000_000);
  });
  it("old p8 extraction (forfalloprofil years only): 2027 @3,0 (−3 520) + 2029 → 2029-07-01 = month 33 @2,0 (6 480 × 0,75 = 4 860) = 1 340; 2032 ignored", () => {
    const r = kor(
      forening({
        lanebok: {
          totalSkuld: fig(3_000_000),
          forfalloprofil: [
            { ar: 2027, belopp: fig(1_000_000), ranta: fig(3.0, { unit: "procent" }) },
            { ar: 2029, belopp: fig(1_000_000), ranta: fig(2.0, { unit: "procent" }) },
            { ar: 2032, belopp: fig(1_000_000), ranta: fig(1.0, { unit: "procent" }) },
          ],
        },
      }),
    );
    expect(k(r).foreningKrPerAr).toBe(1340);
  });
  it("a later-phase loan without own rate takes snittränta", () => {
    const r = kor(
      forening(lanebok(1_000_000, [lan(1_000_000, null, "2029-10-25")], { snittranta: fig(2.0) })),
    );
    expect(k(r).foreningKrPerAr).toBe(3240);
  });
  it("a later-phase loan without any rate is skipped without failing the component", () => {
    expect(k(ett("2029-10-25", null as unknown as number)).status).toBe("beraknad");
  });
  it("the stale-report rule covers both phases (balansdag 2024-12-31)", () => {
    const r = kor(
      forening({
        ...lanebok(1_000_000, [lan(1_000_000, 2.0, "2029-10-25")]),
        rakenskapsar: 2024,
        balansdag: "2024-12-31",
      }),
    );
    expect(k(r).status).toBe("saknar_underlag");
  });
  it("no later phase for the undated/no-maturities assumption", () => {
    const r = kor(forening(lanebok(2_000_000, undefined, { snittranta: fig(2.0) })));
    expect(r.prognos.refinansiering?.senareHorisontManader).toBeUndefined();
    expect(k(r).foreningKrPerAr).toBe(6480);
  });
});

describe("narrowed underhåll next to a plan-based sparandegap", () => {
  it("horizon item 5 000 000 (ofinansierad, 2026–2027) is only in underhåll; the fond item 3 000 000 (2030–2039) sets the target 150 → gap 0", () => {
    const r = kor(
      forening({
        keyFigures: [sparande(150)],
        totalyta: fig(2000, { unit: "m2" }),
        underhallsplan: {
          finns: "ja",
          planeradeKostnader: [
            {
              text: "Stambyte",
              belopp: fig(5_000_000),
              finansiering: "ofinansierad",
              fran: 2026,
              till: 2027,
            },
            { text: "Tak", belopp: fig(3_000_000), finansiering: "fond", fran: 2030, till: 2039 },
          ],
        },
      }),
    );
    expect(r.prognos.sparbehov).toMatchObject({ malKrPerM2: 150, malKalla: "planerade_kostnader" });
    expect(komp(r, "spargap")).toMatchObject({ foreningKrPerAr: 0, krPerManad: 0 });
    // 5 000 000 / 10 = 500 000/year → 416,67 → 417
    expect(komp(r, "underhall")).toMatchObject({ foreningKrPerAr: 500_000, krPerManad: 417 });
  });
});

describe("tryckFor (fee 4 000: 2 % = 80 kr, 10 % = 400 kr)", () => {
  it("null → undefined; zero and decreases → gron", () => {
    expect(tryckFor(null, 4000)).toBeUndefined();
    expect(tryckFor(0, 4000)).toBe("gron");
    expect(tryckFor(-500, 4000)).toBe("gron");
  });
  it("below 2 % gron, exactly 2 % gul", () => {
    expect(tryckFor(79, 4000)).toBe("gron");
    expect(tryckFor(80, 4000)).toBe("gul");
  });
  it("up to and including 10 % gul, above rod", () => {
    expect(tryckFor(400, 4000)).toBe("gul");
    expect(tryckFor(401, 4000)).toBe("rod");
  });
  it("a rise without a usable fee is undefined", () => {
    expect(tryckFor(100, 0)).toBeUndefined();
  });
  it("is set on beraknade components and on the total: energi 1 000 000 → 83 kr = 2,075 % → gul", () => {
    const r = kor(
      forening({ energiprojekt: [{ text: "Sol", finansierat: "nej", belopp: fig(1_000_000) }] }),
    );
    expect(komp(r, "energi").tryck).toBe("gul");
    expect(r.prognos.tryck).toBe("gul");
    // not set on ej_aktuell / saknar_underlag
    expect(komp(r, "lokaler").tryck).toBeUndefined();
    expect(komp(r, "underhall").tryck).toBeUndefined();
  });
  it("unknown share: no tryck anywhere", () => {
    const r = kor(forening(), { kontrollsummor: {} });
    expect(r.prognos.tryck).toBeUndefined();
    expect(r.prognos.komponenter.every((c) => c.tryck === undefined)).toBe(true);
  });
});
