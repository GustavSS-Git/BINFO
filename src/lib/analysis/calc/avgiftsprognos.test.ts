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
import { beraknaAvgiftsprognos, laggTillManader, type AvgiftsprognosInput } from "./avgiftsprognos";

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
    // the BRF-level amount is still computed: 100 × 2 000 = 200 000
    expect(komp(r, "spargap").foreningKrPerAr).toBe(200_000);
  });
  it("guards a share above 1 (årsavgifter 40 000 → 1,2) and falls through", () => {
    const r = kor(forening(), { kontrollsummor: { arsavgifter: fig(40_000) } });
    expect(r.prognos.andel).toBeNull();
  });
  it("guards zero årsavgifter", () => {
    expect(kor(forening(), { kontrollsummor: { arsavgifter: fig(0) } }).prognos.andel).toBeNull();
  });
});

describe("spargap", () => {
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
  it("−100 kr/m² × 2 000 m² = 200 000 kr/year → × 0,01 / 12 = 166,67 → 167", () => {
    const k = med(sparande(-100));
    expect(k).toMatchObject({ status: "beraknad", foreningKrPerAr: 200_000, krPerManad: 167 });
    expect(k.ref?.page).toBe(5);
  });
  it("positive sparande: ej_aktuell 0", () => {
    expect(med(sparande(50))).toMatchObject({ status: "ej_aktuell", foreningKrPerAr: 0 });
  });
  it("planned and financed withdrawal: ej_aktuell", () => {
    const k = med(sparande(-100), { sparandeUttag: { planerat: "ja", finansierat: "ja" } });
    expect(k.status).toBe("ej_aktuell");
  });
  it("planned but not financed: still calculated", () => {
    const k = med(sparande(-100), { sparandeUttag: { planerat: "ja", finansierat: "nej" } });
    expect(k.status).toBe("beraknad");
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
  it("negative sparande but no totalyta: saknar_underlag", () => {
    const k = komp(kor(forening({ keyFigures: [sparande(-100)] })), "spargap");
    expect(k.status).toBe("saknar_underlag");
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
  it("horizon edge: 2028-10-24 is in, 2028-10-25 is out (a non-dated loan is ignored too)", () => {
    const i = komp(med(lanebok(1_000_000, [lan(1_000_000, 2.0, "2028-10-24")])), "refinansiering");
    expect(i.foreningKrPerAr).toBe(6480);
    const u = med(
      lanebok(2_000_000, [lan(1_000_000, 2.0, "2028-10-25"), lan(1_000_000, 2.0, undefined)]),
    );
    expect(komp(u, "refinansiering")).toMatchObject({ status: "beraknad", foreningKrPerAr: 0 });
    expect(u.omsattningsbarSkuld).toBe(0);
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
  it("unfinanced minus fund minus savings: (3 000 000 + 500 000 − 1 000 000 − 100 000×10) / 10 = 150 000/year → 125 kr/month", () => {
    // window 2026–2035. B (lån) excluded; C (fran 2040) outside; D (2030–2032) inside.
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
    expect(k).toMatchObject({ status: "beraknad", foreningKrPerAr: 150_000, krPerManad: 125 });
  });
  it("a span that overlaps the window counts (2035–2038)", () => {
    const k = komp(
      kor(
        forening({
          underhallsplan: {
            finns: "ja",
            planeradeKostnader: [post(1_000_000, "okant", { fran: 2035, till: 2038 })],
          },
        }),
      ),
      "underhall",
    );
    expect(k.foreningKrPerAr).toBe(100_000);
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
    // spargap 200 000 → 167 ; refinansiering 6 480 → 5 ; energi 100 000 → 83 ; underhåll saknar ; lokaler ej
    const r = kor(
      forening({
        keyFigures: [sparande(-100)],
        totalyta: fig(2000, { unit: "m2" }),
        ...lanebok(1_000_000, [lan(1_000_000, 2.0, undefined, "rorlig")]),
        energiprojekt: [{ text: "Sol", finansierat: "nej", belopp: fig(1_000_000) }],
      }),
    );
    expect(r.prognos.totalKrPerManad).toBe(167 + 5 + 83);
    expect(r.antalSaknadeUnderlag).toBe(1);
    expect(r.prognos.horisontManader).toBe(24);
    expect(r.prognos.berakningsdatum).toBe(IDAG);
    expect(r.prognos.osaker).toBeUndefined();
  });
  it("30 % guard: sparande −750 × 2 000 = 1 500 000 → 1 250 kr > 0,3 × 4 000 = 1 200 → osäker", () => {
    const r = kor(forening({ keyFigures: [sparande(-750)], totalyta: fig(2000, { unit: "m2" }) }));
    expect(r.prognos.totalKrPerManad).toBe(1250);
    expect(r.prognos.osaker).toMatch(/osäker/);
  });
  it("30 % guard: exactly 1 200 is not flagged (sparande −720 × 2 000 = 1 440 000 → 1 200)", () => {
    const r = kor(forening({ keyFigures: [sparande(-720)], totalyta: fig(2000, { unit: "m2" }) }));
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
