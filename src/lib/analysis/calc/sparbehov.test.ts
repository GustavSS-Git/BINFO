import { describe, expect, it } from "vitest";
import type { Byggdel, Figure, Forening, KeyFigure } from "@/types/analysis";
import { beraknaSparbehov, horisontPoster, type SparbehovInput } from "./sparbehov";

// Hand-computed throughout. idag = 2026-10-24 → year 2026, 24-month horizon years 2026–2028.
// Default förening: totalyta 2 000 m², sparande 150 kr/m².

const IDAG = "2026-10-24";

const fig = (value: number | null, extra: Partial<Figure> = {}): Figure => ({
  value,
  unit: "kr",
  source: "arsredovisning",
  ref: { page: 5, excerpt: "x" },
  ...extra,
});

const sparande = (v: number | null): KeyFigure => ({
  id: "sparande_per_m2_totalyta",
  label: "Sparande",
  figure: fig(v, { unit: "kr/m2", ref: { page: 6, excerpt: "sparande" } }),
  status: "okant",
  forklaring: "",
});

function forening(extra: Partial<Forening> = {}): Forening {
  return {
    namn: "Brf Test",
    orgnr: "769600-0000",
    akta: "ja",
    rakenskapsar: 2025,
    keyFigures: [sparande(150)],
    totalyta: fig(2000, { unit: "m2" }),
    ...extra,
  };
}

function kor(f: Forening, extra: Partial<SparbehovInput> = {}) {
  return beraknaSparbehov({ forening: f, idag: IDAG, ...extra });
}

const post = (
  belopp: number,
  finansiering: "lan" | "fond" | "beslutad" | "ofinansierad" | "okant",
  extra: object = {},
) => ({ text: "Åtgärd", belopp: fig(belopp), finansiering, ...extra });

const atgard = (byggdel: Byggdel, ar: number) => ({
  byggdel,
  ar,
  text: `${byggdel} ${ar}`,
  ref: { page: 4, excerpt: `${byggdel} ${ar}` },
});

describe("target source precedence", () => {
  const allt = (): Forening =>
    forening({
      underhallsplan: {
        finns: "ja",
        investeringsbehovPerM2: fig(400, { unit: "kr/m2", ref: { page: 8, excerpt: "inv" } }),
        rekommenderadAvsattning: fig(1_200_000),
        planTotal: { belopp: fig(30_000_000), ar: 30 },
        planeradeKostnader: [post(3_000_000, "lan", { fran: 2030, till: 2039 })],
      },
    });

  it("1. investeringsbehov wins: target 400, gap 400 − 150 = 250, × 2 000 = 500 000, dampening 1", () => {
    const r = kor(allt());
    expect(r.sparbehov).toMatchObject({
      malKrPerM2: 400,
      malKalla: "investeringsbehov",
      sparandeKrPerM2: 150,
      glappKrPerM2: 250,
      totalyta: 2000,
      dampning: 1,
    });
    expect(r.sparbehov.malRef?.page).toBe(8);
    expect(r.sparbehov.sparandeRef?.page).toBe(6);
    expect(r.krPerAr).toBe(500_000);
    expect(r.planBaserad).toBe(true);
    expect(r.sparbehov.byggdelar).toBeUndefined();
  });
  it("an investeringsbehov marked osäker is skipped: rekommenderad 1 200 000 / 2 000 = 600 wins", () => {
    const f = allt();
    const up = f.underhallsplan as NonNullable<Forening["underhallsplan"]>;
    up.investeringsbehovPerM2 = { ...(up.investeringsbehovPerM2 as Figure), osaker: "orimligt" };
    const r = kor(f);
    expect(r.sparbehov.malKalla).toBe("rekommenderad_avsattning");
    expect(r.sparbehov.malKrPerM2).toBe(600);
  });
  it("1 needs no totalyta for the target, but kr/year is then null", () => {
    const f = allt();
    delete (f as { totalyta?: Figure }).totalyta;
    const r = kor(f);
    expect(r.sparbehov).toMatchObject({
      malKrPerM2: 400,
      malKalla: "investeringsbehov",
      totalyta: null,
    });
    expect(r.sparbehov.glappKrPerM2).toBe(250);
    expect(r.krPerAr).toBeNull();
  });
  it("2. rekommenderad avsättning: 1 200 000 ÷ 2 000 = 600", () => {
    const f = allt();
    delete f.underhallsplan!.investeringsbehovPerM2;
    const r = kor(f);
    expect(r.sparbehov).toMatchObject({
      malKrPerM2: 600,
      malKalla: "rekommenderad_avsattning",
      dampning: 1,
    });
    expect(r.krPerAr).toBe((600 - 150) * 2000);
  });
  it("2 falls through without totalyta", () => {
    const f = allt();
    delete f.underhallsplan!.investeringsbehovPerM2;
    delete (f as { totalyta?: Figure }).totalyta;
    expect(kor(f).sparbehov.malKalla).toBe("schablon");
  });
  it("3a. planTotal: 30 000 000 ÷ 30 år ÷ 2 000 = 500 (wins over the item list)", () => {
    const f = allt();
    delete f.underhallsplan!.investeringsbehovPerM2;
    delete f.underhallsplan!.rekommenderadAvsattning;
    const r = kor(f);
    expect(r.sparbehov).toMatchObject({
      malKrPerM2: 500,
      malKalla: "planerade_kostnader",
      dampning: 1,
    });
  });
  it("3b. item list: 3 000 000 over 2030–2039 (10 years inclusive) ÷ 2 000 = 150", () => {
    const f = allt();
    delete f.underhallsplan!.investeringsbehovPerM2;
    delete f.underhallsplan!.rekommenderadAvsattning;
    delete f.underhallsplan!.planTotal;
    const r = kor(f);
    expect(r.sparbehov).toMatchObject({ malKrPerM2: 150, malKalla: "planerade_kostnader" });
    expect(r.sparbehov.glappKrPerM2).toBe(0);
    expect(r.krPerAr).toBe(0);
  });
  it("4. nothing else: schablon", () => {
    const r = kor(forening({ underhallsplan: { finns: "ja" } }));
    expect(r.sparbehov).toMatchObject({ malKrPerM2: 300, malKalla: "schablon", dampning: 1 });
    expect(r.planBaserad).toBe(false);
  });
});

describe("plan-cost span math", () => {
  const med = (poster: ReturnType<typeof post>[]) =>
    kor(forening({ underhallsplan: { finns: "ja", planeradeKostnader: poster } }));

  it("two items 2030–2034 span 5 years, floored to 10: 4 000 000 + 2 000 000 = 6 000 000 ÷ 10 ÷ 2 000 = 300", () => {
    const r = med([
      post(4_000_000, "lan", { fran: 2030, till: 2031 }),
      post(2_000_000, "fond", { fran: 2033, till: 2034 }),
    ]);
    expect(r.sparbehov).toMatchObject({ malKrPerM2: 300, malKalla: "planerade_kostnader" });
  });
  it("an item with only fran: 6 000 000 in 2031 → span floored to 10 → 6 000 000 ÷ 10 ÷ 2 000 = 300", () => {
    expect(med([post(6_000_000, "lan", { fran: 2031 })]).sparbehov.malKrPerM2).toBe(300);
  });
  it("one big project never counts as a yearly need: 30 Mkr in 2030 ÷ 10 ÷ 2 000 = 1 500 > 600 → schablon", () => {
    const r = med([post(30_000_000, "ofinansierad", { fran: 2030 })]);
    expect(r.sparbehov.malKalla).toBe("schablon");
    expect(r.forkastatPlanmal).toEqual({ malKrPerM2: 1500, malKalla: "planerade_kostnader" });
  });
  it("an item without years makes the span PLANKOSTNAD_MAX_AR (30): 12 000 000 ÷ 30 ÷ 2 000 = 200", () => {
    expect(med([post(12_000_000, "lan")]).sparbehov.malKrPerM2).toBe(200);
  });
  it("span is capped at 30: 2000–2100 with 12 000 000 → 200", () => {
    expect(med([post(12_000_000, "lan", { fran: 2000, till: 2100 })]).sparbehov.malKrPerM2).toBe(
      200,
    );
  });
  it("a plan target below 50 % of the schablon (6 000 000 ÷ 30 ÷ 2 000 = 100 < 150) falls back to the schablon", () => {
    const r = med([post(6_000_000, "lan")]);
    expect(r.sparbehov.malKalla).toBe("schablon");
    expect(r.forkastatPlanmal).toEqual({ malKrPerM2: 100, malKalla: "planerade_kostnader" });
    expect(r.planBaserad).toBe(false);
  });
  it("totalyta is derived as debt ÷ skuldsättning per m² totalyta when the report states none", () => {
    const f = forening({
      lanebok: { totalSkuld: fig(10_000_000) },
      keyFigures: [
        ...forening().keyFigures,
        {
          id: "skuldsattning_per_m2_totalyta",
          label: "Skuld",
          figure: fig(4_000, { unit: "kr/m2" }),
          status: "okant",
          forklaring: "",
        },
      ],
    });
    delete (f as { totalyta?: Figure }).totalyta;
    const r = kor(f);
    expect(r.sparbehov.totalyta).toBe(2_500);
    expect(r.totalytaHarledd).toBe(true);
  });
  it("items without amounts are ignored", () => {
    const r = kor(
      forening({
        underhallsplan: {
          finns: "ja",
          planeradeKostnader: [
            post(600_000, "lan", { fran: 2031 }),
            { ...post(0, "lan"), belopp: fig(null) },
          ],
        },
      }),
    );
    expect(r.sparbehov.malKrPerM2).toBe(300);
  });
  it("without totalyta the item list cannot be used → schablon", () => {
    const f = forening({
      underhallsplan: { finns: "ja", planeradeKostnader: [post(600_000, "lan", { fran: 2031 })] },
    });
    delete (f as { totalyta?: Figure }).totalyta;
    expect(kor(f).sparbehov.malKalla).toBe("schablon");
  });
});

describe("horizon items are excluded from the plan-cost target", () => {
  it("horisontPoster: overlap with 2026–2028 and ofinansierad/okant only; undated counts", () => {
    const poster = [
      post(1, "ofinansierad", { fran: 2026, till: 2027 }), // in
      post(2, "okant", { fran: 2028, till: 2030 }), // overlaps 2028: in
      post(3, "ofinansierad", { fran: 2029 }), // out
      post(4, "lan", { fran: 2026 }), // financed: not counted
      post(5, "ofinansierad"), // undated: in
      post(6, "ofinansierad", { fran: 2020, till: 2025 }), // before: out
    ];
    expect(horisontPoster(poster, IDAG).map((p) => p.belopp.value)).toEqual([1, 2, 5]);
  });
  it("target 3 = Σ of the rest: 3 000 000 (fond, 2030–2039) ÷ 10 ÷ 2 000 = 150; the 5 000 000 horizon item is not in it", () => {
    const r = kor(
      forening({
        underhallsplan: {
          finns: "ja",
          planeradeKostnader: [
            post(3_000_000, "fond", { fran: 2030, till: 2039 }),
            post(5_000_000, "ofinansierad", { fran: 2026, till: 2027 }),
            post(1_000_000, "okant"),
          ],
        },
      }),
    );
    expect(r.sparbehov.malKrPerM2).toBe(150);
  });
  it("when every item is a horizon item nothing is left → schablon", () => {
    const r = kor(
      forening({
        underhallsplan: {
          finns: "ja",
          planeradeKostnader: [post(5_000_000, "ofinansierad", { fran: 2026, till: 2027 })],
        },
      }),
    );
    expect(r.sparbehov.malKalla).toBe("schablon");
  });
});

describe("schablon target moved by building parts", () => {
  // genomfordaAtgarder: [] = a v10 extraction that looked and found none.
  const sch = (extra: Partial<Forening> = {}, input: Partial<SparbehovInput> = {}) =>
    kor(forening({ genomfordaAtgarder: [], ...extra }), input);

  it("a pre-v10 extraction (no genomfordaAtgarder field) never reads byggår as eftersatt: 1950 → all okant → 300", () => {
    const r = kor(forening(), { byggar: 1950 });
    expect(r.sparbehov.malKrPerM2).toBe(300);
    expect(r.sparbehov.byggdelar?.every((b) => b.status === "okant")).toBe(true);
  });
  const del = (r: ReturnType<typeof sch>, d: Byggdel) =>
    r.sparbehov.byggdelar?.find((b) => b.byggdel === d);

  it("unknown byggår and no åtgärder: all okant, score 0 → 300", () => {
    const r = sch();
    expect(r.sparbehov.malKrPerM2).toBe(300);
    expect(r.sparbehov.byggdelar?.map((b) => b.status)).toEqual(Array(6).fill("okant"));
    expect(del(r, "stambyte")).toMatchObject({ senastKalla: "okand", label: "Stambyte" });
    expect(del(r, "stambyte")?.senast).toBeUndefined();
  });
  it("recent åtgärd (stambyte 2020, age 6 < 40/2): nyligen; only part assessed → score −1 → 250", () => {
    const r = sch({ genomfordaAtgarder: [atgard("stambyte", 2020)] });
    expect(del(r, "stambyte")).toMatchObject({
      status: "nyligen",
      senast: 2020,
      senastKalla: "atgard",
    });
    expect(del(r, "stambyte")?.ref?.page).toBe(4);
    expect(r.sparbehov.malKrPerM2).toBe(250);
  });
  it("nyligen boundary: stambyte age 19 → nyligen, age 20 → ok", () => {
    expect(del(sch({ genomfordaAtgarder: [atgard("stambyte", 2007)] }), "stambyte")?.status).toBe(
      "nyligen",
    );
    expect(del(sch({ genomfordaAtgarder: [atgard("stambyte", 2006)] }), "stambyte")?.status).toBe(
      "ok",
    );
  });
  it("eftersatt boundary: stambyte age 60 → ok, 61 → eftersatt (åtgärd)", () => {
    expect(del(sch({ genomfordaAtgarder: [atgard("stambyte", 1966)] }), "stambyte")?.status).toBe(
      "ok",
    );
    expect(del(sch({ genomfordaAtgarder: [atgard("stambyte", 1965)] }), "stambyte")?.status).toBe(
      "eftersatt",
    );
  });
  it("latest åtgärd per part counts (1970 and 2000 → 2000)", () => {
    const r = sch({ genomfordaAtgarder: [atgard("tak", 1970), atgard("tak", 2000)] });
    expect(del(r, "tak")).toMatchObject({ senast: 2000, status: "ok" });
  });
  it("never mentioned + old byggår 1950: stambyte/tak/fönster/el eftersatt, fasad/ventilation ok; 4/6 → 300 + 33,33 → 333", () => {
    // ages 76: stambyte >60, tak >60, fasad ≤100, fönster >60, ventilation ≤100, el >50
    const r = sch({}, { byggar: 1950 });
    const s = Object.fromEntries((r.sparbehov.byggdelar ?? []).map((b) => [b.byggdel, b.status]));
    expect(s).toEqual({
      stambyte: "eftersatt",
      tak: "eftersatt",
      fasad: "ok",
      fonster: "eftersatt",
      ventilation: "ok",
      el: "eftersatt",
    });
    expect(del(r, "stambyte")).toMatchObject({ senast: 1950, senastKalla: "byggar" });
    expect(r.sparbehov.malKrPerM2).toBe(333);
  });
  it("a recent byggår is never 'nyligen' (only åtgärder are): byggår 2024 → all ok → 300", () => {
    const r = sch({}, { byggar: 2024 });
    expect(r.sparbehov.byggdelar?.map((b) => b.status)).toEqual(Array(6).fill("ok"));
    expect(r.sparbehov.malKrPerM2).toBe(300);
  });
  it("mix: byggår 1950, stambyte 2020 (nyligen), tak 1990 (age 36 ok): eftersatt fönster+el = 2, nyligen 1, assessed 6 → 1/6 → 308", () => {
    const r = sch(
      { genomfordaAtgarder: [atgard("stambyte", 2020), atgard("tak", 1990)] },
      { byggar: 1950 },
    );
    expect(r.sparbehov.malKrPerM2).toBe(308);
  });
  it("okänt parts are excluded from the denominator: stambyte 1950 åtgärd (eftersatt) only → score 1 → 350", () => {
    const r = sch({ genomfordaAtgarder: [atgard("stambyte", 1950)] });
    expect(r.sparbehov.malKrPerM2).toBe(350);
  });
  it("hiss is only included with hiss === 'ja' (byggår 1950, hiss age 76 > 40: 5/7 → 335,71 → 336)", () => {
    expect(del(sch({}, { byggar: 1950, hiss: "ja" }), "hiss")?.status).toBe("eftersatt");
    expect(sch({}, { byggar: 1950, hiss: "ja" }).sparbehov.malKrPerM2).toBe(336);
    for (const hiss of ["nej", "okant", undefined] as const) {
      const r = sch({}, { byggar: 1950, ...(hiss ? { hiss } : {}) });
      expect(del(r, "hiss")).toBeUndefined();
      expect(r.sparbehov.byggdelar).toHaveLength(6);
      expect(r.sparbehov.malKrPerM2).toBe(333);
    }
  });
  it("the range ends are the clamp: everything eftersatt → 350, everything nyligen → 250", () => {
    expect(sch({}, { byggar: 1900, hiss: "ja" }).sparbehov.malKrPerM2).toBe(350);
    const alla: Byggdel[] = ["stambyte", "tak", "fasad", "fonster", "ventilation", "el", "hiss"];
    const nyl = sch({ genomfordaAtgarder: alla.map((d) => atgard(d, 2025)) }, { hiss: "ja" });
    expect(nyl.sparbehov.malKrPerM2).toBe(250);
  });
  it("gap > 0 counts in full (unknown debt → nothing borrowed): 150 × 2 000 = 300 000", () => {
    const r = sch();
    expect(r.sparbehov.glappKrPerM2).toBe(150);
    expect(r.sparbehov.dampning).toBe(1);
    expect(r.krPerAr).toBe(300_000);
  });
  it("surplus is negative: sparande 500 → gap −200 × 2 000 × 0,5 = −200 000 (today's rule, no finansiering)", () => {
    const r = sch({ keyFigures: [sparande(500)] });
    expect(r.sparbehov.finansiering).toBeUndefined();
    expect(r.sparbehov.dampning).toBe(0.5);
    expect(r.sparbehov.glappKrPerM2).toBe(-200);
    expect(r.krPerAr).toBe(-200_000);
  });
  it("negative sparande −100: underskott 100 × 2 000 + lånebart 300 × 2 000 = 800 000", () => {
    expect(sch({ keyFigures: [sparande(-100)] }).krPerAr).toBe(800_000);
  });
});

describe("life-extending renovations (owner 2026-10-30)", () => {
  const sch = (extra: Partial<Forening> = {}, input: Partial<SparbehovInput> = {}) =>
    kor(forening({ genomfordaAtgarder: [], ...extra }), input);
  const del = (r: ReturnType<typeof sch>, d: Byggdel) =>
    r.sparbehov.byggdelar?.find((b) => b.byggdel === d);
  const forl = (byggdel: Byggdel, ar: number) => ({
    ...atgard(byggdel, ar),
    omfattning: "forlangning" as const,
  });

  it("relining 2016 on stammar from byggår 1950: ok until 2046 (30 years), never nyligen", () => {
    const r = sch({ genomfordaAtgarder: [forl("stambyte", 2016)] }, { byggar: 1950 });
    expect(del(r, "stambyte")).toMatchObject({
      status: "ok",
      senast: 1950,
      senastKalla: "byggar",
      forlangning: { ar: 2016, tillAr: 2046, ref: { page: 4 } },
    });
  });
  it("an expired extension no longer helps: relining 1990 (until 2020) → eftersatt", () => {
    const r = sch({ genomfordaAtgarder: [forl("stambyte", 1990)] }, { byggar: 1950 });
    expect(del(r, "stambyte")?.status).toBe("eftersatt");
  });
  it("a recent extension is never nyligen: tak ommålning 2024 on a 1950 roof → ok", () => {
    const r = sch({ genomfordaAtgarder: [forl("tak", 2024)] }, { byggar: 1950 });
    expect(del(r, "tak")).toMatchObject({ status: "ok", forlangning: { tillAr: 2034 } });
  });
  it("roof, windows, facade and el extend 10 years", () => {
    const r = sch({
      genomfordaAtgarder: [
        forl("tak", 2020),
        forl("fonster", 2020),
        forl("fasad", 2020),
        forl("el", 2020),
      ],
    });
    for (const d of ["tak", "fonster", "fasad", "el"] as const) {
      expect(del(r, d)?.forlangning?.tillAr).toBe(2030);
    }
  });
  it("an extension older than the last replacement is ignored", () => {
    const r = sch({ genomfordaAtgarder: [atgard("stambyte", 2000), forl("stambyte", 1995)] });
    expect(del(r, "stambyte")).toMatchObject({ senast: 2000, senastKalla: "atgard", status: "ok" });
    expect(del(r, "stambyte")?.forlangning).toBeUndefined();
  });
  it("a later replacement after an extension: the replacement sets the age", () => {
    const r = sch({ genomfordaAtgarder: [forl("stambyte", 2000), atgard("stambyte", 2020)] });
    expect(del(r, "stambyte")).toMatchObject({ senast: 2020, status: "nyligen" });
    expect(del(r, "stambyte")?.forlangning).toBeUndefined();
  });
  it("the latest extension counts (2000 and 2016 → until 2046)", () => {
    const r = sch(
      { genomfordaAtgarder: [forl("stambyte", 2000), forl("stambyte", 2016)] },
      { byggar: 1950 },
    );
    expect(del(r, "stambyte")?.forlangning).toMatchObject({ ar: 2016, tillAr: 2046 });
  });
  it("only an extension, unknown byggår: ok while it lasts, okant after", () => {
    expect(del(sch({ genomfordaAtgarder: [forl("fonster", 2020)] }), "fonster")).toMatchObject({
      status: "ok",
      senastKalla: "okand",
    });
    expect(del(sch({ genomfordaAtgarder: [forl("fonster", 2010)] }), "fonster")?.status).toBe(
      "okant",
    );
  });
  it("hiss modernisation and ventilation have no extension figure: counted as a replacement", () => {
    const r = sch(
      { genomfordaAtgarder: [forl("hiss", 2020), forl("ventilation", 2020)] },
      { hiss: "ja" },
    );
    expect(del(r, "hiss")).toMatchObject({
      senast: 2020,
      senastKalla: "atgard",
      status: "nyligen",
    });
    expect(del(r, "ventilation")).toMatchObject({ senast: 2020, status: "nyligen" });
    expect(del(r, "hiss")?.forlangning).toBeUndefined();
  });
  it("an extension changes the target: byggår 1950 + relining 2016 → stambyte ok instead of eftersatt (3/6 → 325)", () => {
    // ages 76: tak, fönster, el eftersatt; stambyte now ok; fasad, ventilation ok → 300 + 50 × 3/6 = 325
    const r = sch({ genomfordaAtgarder: [forl("stambyte", 2016)] }, { byggar: 1950 });
    expect(r.sparbehov.malKrPerM2).toBe(325);
  });
});

describe("missing data", () => {
  it("no sparande key figure: target kept, sparande/gap/kr null", () => {
    const r = kor(forening({ keyFigures: [] }));
    expect(r.sparbehov).toMatchObject({
      malKrPerM2: 300,
      sparandeKrPerM2: null,
      glappKrPerM2: null,
    });
    expect(r.krPerAr).toBeNull();
  });
  it("sparande value null (only a sign): same", () => {
    const r = kor(forening({ keyFigures: [sparande(null)] }));
    expect(r.sparbehov.sparandeKrPerM2).toBeNull();
    expect(r.krPerAr).toBeNull();
  });
  it("no totalyta: gap per m² exists, kr/year null, totalyta null", () => {
    const f = forening();
    delete (f as { totalyta?: Figure }).totalyta;
    const r = kor(f);
    expect(r.sparbehov).toMatchObject({ totalyta: null, glappKrPerM2: 150 });
    expect(r.krPerAr).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Owner 2026-10-29: 4-year average and the financing split.
// ---------------------------------------------------------------------------
const hist = (ar: number, v: number | null, extra: Partial<Figure> = {}) => ({
  ar,
  figure: fig(v, { unit: "kr/m2", ref: { page: 6, excerpt: `sparande ${ar}` }, ...extra }),
});
const skuld = (id: KeyFigure["id"], v: number, extra: Partial<Figure> = {}): KeyFigure => ({
  id,
  label: "Skuld",
  figure: fig(v, { unit: "kr/m2", ...extra }),
  status: "okant",
  forklaring: "",
});
// Brf Ingemar 8 (2025): totalyta 2 485, schablon 300, rate 2,068 + 0,58 = 2,648 %.
const ingemar = (extra: Partial<Forening> = {}) =>
  forening({
    keyFigures: [sparande(-3), skuld("skuldsattning_per_m2_totalyta", 3411)],
    totalyta: fig(2485, { unit: "m2" }),
    sparandeHistorik: [hist(2024, -138), hist(2023, 125), hist(2022, 119)],
    ...extra,
  });
const RANTA = 2.068 + 0.58;

describe("sparande average (owner 2026-10-29)", () => {
  it("Ingemar 8: (−3 − 138 + 125 + 119) / 4 = 25,75 → 26, years latest first with refs", () => {
    const r = kor(ingemar(), { rantaProcent: RANTA });
    expect(r.sparbehov.sparandeKrPerM2).toBe(26);
    expect(r.sparbehov.sparandeAr?.map((a) => [a.ar, a.krPerM2])).toEqual([
      [2025, -3],
      [2024, -138],
      [2023, 125],
      [2022, 119],
    ]);
    expect(r.sparbehov.sparandeAr?.[1]?.ref?.excerpt).toBe("sparande 2024");
    expect(r.sparbehov.glappKrPerM2).toBe(274);
  });
  it("old extraction without history: the current year alone, no sparandeAr", () => {
    const r = kor(ingemar({ sparandeHistorik: [] }));
    expect(r.sparbehov.sparandeKrPerM2).toBe(-3);
    expect(r.sparbehov.sparandeAr).toBeUndefined();
  });
  it("unusable years (null, osäker) are skipped", () => {
    const r = kor(
      ingemar({
        sparandeHistorik: [hist(2024, null), hist(2023, 125, { osaker: "x" }), hist(2022, 119)],
      }),
    );
    expect(r.sparbehov.sparandeAr?.map((a) => a.ar)).toEqual([2025, 2022]);
    expect(r.sparbehov.sparandeKrPerM2).toBe(58); // (−3 + 119) / 2
  });
  it("only the first three history years count", () => {
    const r = kor(
      ingemar({ sparandeHistorik: [...ingemar().sparandeHistorik!, hist(2021, 9999)] }),
    );
    expect(r.sparbehov.sparandeAr).toHaveLength(4);
  });
  it("no current year but history: saknar underlag, history alone is never used", () => {
    const r = kor(ingemar({ keyFigures: [sparande(null)] }));
    expect(r.sparbehov.sparandeKrPerM2).toBeNull();
    expect(r.sparbehov.sparandeAr).toBeUndefined();
    expect(r.krPerAr).toBeNull();
  });
});

describe("financing split of a positive gap (owner 2026-10-29)", () => {
  it("Ingemar 8: lånebart 274 × 2 485 = 680 890, headroom covers 2G, only interest reaches the fee", () => {
    const r = kor(ingemar(), { rantaProcent: RANTA });
    const f = r.sparbehov.finansiering!;
    expect(r.sparbehov.dampning).toBe(1);
    expect(f).toMatchObject({
      underskottKrPerM2: 0,
      lanebartKrPerM2: 274,
      skuldKrPerM2: 3411,
      skuldBas: "totalyta",
      takKrPerM2: 5000,
      lanatKr: 1_361_780,
      krPerArUnderskott: 0,
      krPerArOlanat: 0,
    });
    expect(f.krPerArRanta).toBe(Math.round((1_361_780 * RANTA) / 100)); // 36 060
    expect(f.krPerArRanta).toBeGreaterThan(36_000);
    expect(f.krPerArRanta).toBeLessThan(36_100);
    expect(r.krPerAr).toBe(f.krPerArRanta);
  });
  it("negative average: the deficit part is paid in full, the rest is borrowed", () => {
    // −100 alone: underskott 100 × 2 000 = 200 000; lånebart 300 × 2 000 = 600 000; G×2 = 1 200 000
    // headroom (5 000 − 1 000) × 2 000 = 8 000 000 → lånat 1 200 000, ränta 2 % = 24 000.
    const r = kor(
      forening({ keyFigures: [sparande(-100), skuld("skuldsattning_per_m2_totalyta", 1000)] }),
      { rantaProcent: 2 },
    );
    expect(r.sparbehov.finansiering).toMatchObject({
      underskottKrPerM2: 100,
      lanebartKrPerM2: 300,
      lanatKr: 1_200_000,
      krPerArUnderskott: 200_000,
      krPerArOlanat: 0,
      krPerArRanta: 24_000,
    });
    expect(r.krPerAr).toBe(224_000);
  });
  it("debt above the ceiling: nothing borrowed, the whole gap via the fee", () => {
    const r = kor(
      forening({ keyFigures: [sparande(100), skuld("skuldsattning_per_m2_totalyta", 6000)] }),
      { rantaProcent: 2 },
    );
    expect(r.sparbehov.finansiering).toMatchObject({ lanatKr: 0, krPerArOlanat: 400_000 });
    expect(r.krPerAr).toBe(400_000);
  });
  it("headroom smaller than 2G: partial", () => {
    // gap 200 → G 400 000; headroom (5 000 − 4 800) × 2 000 = 400 000 < 800 000
    // lånat 400 000 → olånat 400 000 − 200 000 = 200 000; ränta 2 % = 8 000.
    const r = kor(
      forening({ keyFigures: [sparande(100), skuld("skuldsattning_per_m2_totalyta", 4800)] }),
      { rantaProcent: 2 },
    );
    expect(r.sparbehov.finansiering).toMatchObject({
      lanatKr: 400_000,
      krPerArOlanat: 200_000,
      krPerArRanta: 8_000,
    });
    expect(r.krPerAr).toBe(208_000);
  });
  it("unknown debt (or an osäker figure): nothing borrowed", () => {
    for (const kf of [
      [sparande(100)],
      [sparande(100), skuld("skuldsattning_per_m2_totalyta", 100, { osaker: "x" })],
    ]) {
      const r = kor(forening({ keyFigures: kf }), { rantaProcent: 2 });
      expect(r.sparbehov.finansiering).toMatchObject({
        skuldKrPerM2: null,
        skuldBas: null,
        lanatKr: 0,
        krPerArOlanat: 400_000,
      });
    }
  });
  it("debt-free (0 kr/m²): full headroom", () => {
    const r = kor(
      forening({ keyFigures: [sparande(100), skuld("skuldsattning_per_m2_totalyta", 0)] }),
      { rantaProcent: 2 },
    );
    expect(r.sparbehov.finansiering).toMatchObject({ skuldKrPerM2: 0, lanatKr: 800_000 });
    expect(r.krPerAr).toBe(16_000);
  });
  it("bostadsrättsyta basis uses the förening's bostadsrättsyta; without it the debt is unknown", () => {
    const kf = [sparande(100), skuld("skuldsattning_per_m2_brf_yta", 4000)];
    const med = kor(forening({ keyFigures: kf, bostadsrattsyta: fig(1500, { unit: "m2" }) }), {
      rantaProcent: 2,
    });
    // headroom 1 000 × 1 500 = 1 500 000 ≥ 2G = 800 000
    expect(med.sparbehov.finansiering).toMatchObject({
      skuldBas: "bostadsrattsyta",
      lanatKr: 800_000,
    });
    const utan = kor(forening({ keyFigures: kf }), { rantaProcent: 2 });
    expect(utan.sparbehov.finansiering).toMatchObject({ skuldKrPerM2: null, lanatKr: 0 });
  });
  it("exactly on target (gap 0) and surplus keep today's rule", () => {
    const r = kor(forening({ keyFigures: [sparande(300)] }));
    expect(r.sparbehov.finansiering).toBeUndefined();
    expect(r.krPerAr).toBe(0);
  });
});
