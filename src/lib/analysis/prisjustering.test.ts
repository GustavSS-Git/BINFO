import { describe, expect, it } from "vitest";
import type { AvgiftsKomponent } from "@/types/analysis";
import type { AvgiftsprognosResultat } from "./calc/avgiftsprognos";
import { byggPrisjustering } from "./prisjustering";

// Baseline 6 000 000 kr, boarea 50 m² → 120 000 kr/m².
// kr of price per kr/month = 0,0024470683054 × 120 000 = 293,648 (shown 294).
// total +100 kr/month → belopp = −29 364,82 → −29 365 → point 5 970 635.

const komp = (
  status: AvgiftsKomponent["status"],
  id: AvgiftsKomponent["id"] = "underhall",
): AvgiftsKomponent => ({
  id,
  label: "Underhåll utan finansiering",
  status,
  foreningKrPerAr: null,
  krPerManad: null,
  forklaring: "x.",
});

function prognos(
  total: number | null,
  opts: { saknar?: number; spann?: { lag: number; hog: number } } = {},
): AvgiftsprognosResultat {
  const saknar = opts.saknar ?? 0;
  return {
    prognos: {
      horisontManader: 24,
      berakningsdatum: "2026-10-24",
      andel: total === null ? null : { varde: 0.01, metod: "avgiftsandel" },
      komponenter: Array.from({ length: saknar }, () => komp("saknar_underlag")),
      totalKrPerManad: total,
    },
    omsattningsbarSkuld: null,
    antalSaknadeUnderlag: saknar,
    ...(opts.spann ? { totalSpannVidAntagande: opts.spann } : {}),
  };
}

const BASE = { value: 6_000_000, range: { low: 5_400_000, high: 6_600_000 } };

describe("byggPrisjustering", () => {
  it("null without a baseline", () => {
    expect(byggPrisjustering({ baseline: null, boarea: 50, prognos: prognos(100) })).toBeNull();
  });
  it("null when the share is unknown and nothing is missing", () => {
    expect(byggPrisjustering({ baseline: BASE, boarea: 50, prognos: prognos(null) })).toBeNull();
  });

  it("+100 kr/month: belopp −29 365, point 5 970 635, range shifted by the same amount", () => {
    const r = byggPrisjustering({ baseline: BASE, boarea: 50, prognos: prognos(100) });
    const j = r?.justeringar?.[0];
    expect(j?.id).toBe("forvantad_avgiftshojning");
    expect(j?.belopp).toEqual({ value: -29_365, unit: "kr", source: "berakning" });
    expect(j?.krPerKrManad).toBe(294);
    expect(j?.forklaring).toMatch(/stiga/);
    expect(j?.forklaring).toMatch(/inte ett orsakssamband/);
    expect(r?.justeradVardering).toMatchObject({
      value: 5_970_635,
      unit: "kr",
      source: "schablon",
      range: { low: 5_370_635, high: 6_570_635 },
    });
    expect(r?.justeradVardering?.schablonBasis).toMatch(/justerad/);
    expect(r?.breddningsskal).toEqual([]);
  });

  it("negative total raises the price: −50 kr/month → +14 682 (14 682,41)", () => {
    const r = byggPrisjustering({ baseline: BASE, boarea: 50, prognos: prognos(-50) });
    expect(r?.justeringar?.[0]?.belopp.value).toBe(14_682);
    expect(r?.justeringar?.[0]?.forklaring).toMatch(/sjunka/);
    expect(r?.justeradVardering?.value).toBe(6_014_682);
  });

  it("total 0: belopp 0 (not −0), same value", () => {
    const r = byggPrisjustering({ baseline: BASE, boarea: 50, prognos: prognos(0) });
    expect(Object.is(r?.justeringar?.[0]?.belopp.value, 0)).toBe(true);
    expect(r?.justeradVardering?.value).toBe(6_000_000);
    expect(r?.justeradVardering?.range).toEqual({ low: 5_400_000, high: 6_600_000 });
    expect(r?.justeringar?.[0]?.forklaring).toBe(
      "Årsredovisningen pekar inte på någon förändring av avgiften inom 24 månader, så vi justerar inte värderingen. Dagens avgift ingår redan i värderingen.",
    );
  });

  it("two missing components: point unchanged by them; low −2 × 3 % × 6 000 000 = −360 000", () => {
    const r = byggPrisjustering({
      baseline: BASE,
      boarea: 50,
      prognos: prognos(100, { saknar: 2 }),
    });
    expect(r?.justeradVardering?.value).toBe(5_970_635);
    // low 5 400 000 − 29 365 − 360 000 = 5 010 635; high only shifted
    expect(r?.justeradVardering?.range).toEqual({ low: 5_010_635, high: 6_570_635 });
    expect(r?.breddningsskal).toHaveLength(1);
    expect(r?.breddningsskal?.[0]).toMatch(/6 %/);
    expect(r?.breddningsskal?.[0]).toMatch(/underhåll utan finansiering/);
  });

  it("unknown share but missing data: no adjustment, widened by one extra unit", () => {
    // 1 missing + 1 for the unknown share = 2 × 180 000 = 360 000
    const r = byggPrisjustering({
      baseline: BASE,
      boarea: 50,
      prognos: prognos(null, { saknar: 1 }),
    });
    expect(r?.justeringar).toEqual([]);
    expect(r?.justeradVardering?.value).toBe(6_000_000);
    expect(r?.justeradVardering?.range).toEqual({ low: 5_040_000, high: 6_600_000 });
    expect(r?.breddningsskal?.[0]).toMatch(/andel/);
  });

  it("assumed maturities: range covers 0 % and 100 % (baseline without range)", () => {
    // total 100 at 50 %; lag 60, hog 140. k = 293,648
    // low ≤ 6 000 000 − 140 × 293,648 = 5 958 889,2 ; high ≥ 6 000 000 − 60 × 293,648 = 5 982 381,1
    // point 5 970 635 lies between them
    const r = byggPrisjustering({
      baseline: { value: 6_000_000 },
      boarea: 50,
      prognos: prognos(100, { spann: { lag: 60, hog: 140 } }),
    });
    expect(r?.justeradVardering?.value).toBe(5_970_635);
    expect(r?.justeradVardering?.range).toEqual({ low: 5_958_889, high: 5_982_381 });
    expect(r?.breddningsskal?.[0]).toMatch(/hälften/);
  });

  it("alternative price (uncertain byggår) extends the range both ways", () => {
    const lagre = byggPrisjustering({
      baseline: BASE,
      boarea: 50,
      prognos: prognos(0),
      alternativa: [{ skal: "Byggår är osäkert.", pris: 5_200_000 }],
    });
    expect(lagre?.justeradVardering?.range).toEqual({ low: 5_200_000, high: 6_600_000 });
    const hogre = byggPrisjustering({
      baseline: BASE,
      boarea: 50,
      prognos: prognos(0),
      alternativa: [{ skal: "Byggår är osäkert.", pris: 7_000_000 }],
    });
    expect(hogre?.justeradVardering?.range).toEqual({ low: 5_400_000, high: 7_000_000 });
    expect(hogre?.breddningsskal).toEqual(["Byggår är osäkert."]);
  });

  it("range never below 0", () => {
    const r = byggPrisjustering({
      baseline: { value: 1_000_000, range: { low: 100_000, high: 1_200_000 } },
      boarea: 50,
      prognos: prognos(0, { saknar: 5 }),
    });
    // 100 000 − 5 × 30 000 = −50 000 → 0
    expect(r?.justeradVardering?.range?.low).toBe(0);
  });

  it("avvikelse vs adjusted: (6 200 000 − 5 970 635) / 5 970 635 = 3,84 % → 3,8", () => {
    const r = byggPrisjustering({
      baseline: BASE,
      boarea: 50,
      prognos: prognos(100),
      utgangspris: 6_200_000,
    });
    expect(r?.avvikelseMotJusteradVardering).toBe(3.8);
  });
  it("avvikelse absent without utgångspris; negative below", () => {
    expect(
      byggPrisjustering({ baseline: BASE, boarea: 50, prognos: prognos(0) }),
    ).not.toHaveProperty("avvikelseMotJusteradVardering");
    const r = byggPrisjustering({
      baseline: BASE,
      boarea: 50,
      prognos: prognos(0),
      utgangspris: 5_700_000,
    });
    expect(r?.avvikelseMotJusteradVardering).toBe(-5);
  });
});
