import { describe, expect, it } from "vitest";
import { analysUtanPrognos } from "@/components/prognosTestdata";

const sampleAnalysis = analysUtanPrognos();
import { byggSammanfattning } from "./sammanfattning";
import type { AnalysisResult } from "@/types/analysis";

const nbsp = (s: string) => s.replace(/\u00a0/g, " ");

function med(over: Partial<AnalysisResult>): AnalysisResult {
  return { ...sampleAnalysis, ...over };
}

describe("byggSammanfattning", () => {
  it("price vs utgångspris and the area's bid premium (sample: 4 995 000 vs 5 681 607, +5,43 %)", () => {
    const s = byggSammanfattning(sampleAnalysis);
    // Span ±10 % of 5 681 607 = 5 110 000 – 6 250 000: 4 995 000 is under it; the typical
    // final price 4 995 000 × 1,0543 ≈ 5 266 229 is inside it.
    expect(nbsp(s.pris)).toContain("Binfos värdering är ca 5 680 000 kr.");
    expect(nbsp(s.pris)).toContain(
      "Utgångspriset 4 995 000 kr ligger under det ungefärliga spannet 5 110 000 – 6 250 000 kr (±10 %).",
    );
    expect(nbsp(s.pris)).toContain("ca 5 270 000 kr, skulle ligga i linje med modellen");
    expect(s.pris).not.toMatch(/attraktivt|\d,\d % under/);
    expect(s.betyg).toMatch(/^Föreningen får betyget B\./);
  });

  it("uses the adjusted valuation when present and says what it was before", () => {
    const s = byggSammanfattning(
      med({
        prisanalys: {
          ...sampleAnalysis.prisanalys,
          justeradVardering: {
            value: 5_500_000,
            unit: "kr",
            source: "schablon",
            schablonBasis: "x",
          },
        },
      }),
    );
    expect(nbsp(s.pris)).toContain("föreningens ekonomi är ca 5 500 000 kr");
    expect(nbsp(s.pris)).toContain("Jämförbara lägenheter säljs för ca 5 680 000 kr.");
  });

  it("a tiny adjustment is not shown as two identical rounded prices", () => {
    const bas = sampleAnalysis.prisanalys.externVardering!.value!;
    const s = byggSammanfattning(
      med({
        prisanalys: {
          ...sampleAnalysis.prisanalys,
          justeradVardering: {
            value: bas + 1847,
            unit: "kr",
            source: "schablon",
            schablonBasis: "x",
          },
        },
      }),
    );
    expect(nbsp(s.pris)).toContain("i stort sett samma som jämförbara lägenheter säljs för");
    expect(nbsp(s.pris)).not.toContain("1 847");
    expect(s.pris).not.toContain("Jämförbara lägenheter säljs för");
  });

  it("fee rise text with direction, rounded, and the missing-data note", () => {
    const s = byggSammanfattning(
      med({
        avgiftsprognos: {
          horisontManader: 24,
          berakningsdatum: "2026-10-24",
          andel: { varde: 0.01, metod: "avgiftsandel" },
          totalKrPerManad: 347,
          komponenter: [
            {
              id: "refinansiering",
              label: "Lån som ska omsättas",
              status: "beraknad",
              foreningKrPerAr: 41_640,
              krPerManad: 347,
              forklaring: "",
            },
            {
              id: "underhall",
              label: "Underhåll utan finansiering",
              status: "saknar_underlag",
              foreningKrPerAr: null,
              krPerManad: null,
              forklaring: "",
            },
          ],
        },
      }),
    );
    expect(nbsp(s.avgift)).toContain("höjs med ca 350 kr i månaden under de närmaste två åren");
    expect(s.avgift).toContain("Störst påverkan: lån som ska omsättas.");
    expect(s.avgift).toContain("För en del saknas underlag");
  });

  it("never advises buying or not, and labels itself as underlag", () => {
    const s = byggSammanfattning(sampleAnalysis);
    const allt = Object.values(s).join(" ");
    expect(allt).not.toMatch(/\b(köp|köpa|avstå|bör du|rekommenderar)\b/i);
    expect(s.slutsats).toContain("Det här är underlag, inte ett råd");
  });

  it("no valuation possible → says so", () => {
    const { externVardering: _e, ...utan } = sampleAnalysis.prisanalys;
    const s = byggSammanfattning(med({ prisanalys: utan }));
    expect(s.pris).toMatch(/kunde inte räknas fram/);
  });
});

describe("byggSammanfattning — svag förening utan prisjustering", () => {
  const komp = (
    id: "spargap" | "refinansiering" | "underhall",
    label: string,
    status: "beraknad" | "saknar_underlag",
  ) => ({
    id,
    label,
    status,
    foreningKrPerAr: status === "beraknad" ? 0 : null,
    krPerManad: status === "beraknad" ? 0 : null,
    forklaring: "",
  });
  const prognos = (
    total: number,
    komponenter = [komp("spargap", "Sparande mot underhållsbehov", "beraknad")],
  ): NonNullable<AnalysisResult["avgiftsprognos"]> => ({
    horisontManader: 24,
    berakningsdatum: "2026-10-25",
    andel: { varde: 0.01, metod: "avgiftsandel" },
    totalKrPerManad: total,
    komponenter,
  });
  const medAvgiftsStatus = (status: "god" | "acceptabel" | "svag" | "kritisk") =>
    sampleAnalysis.forening.keyFigures.map((kf) =>
      kf.id === "arsavgift_per_m2_brf_yta"
        ? { ...kf, status, figure: { ...kf.figure, value: 1234 } }
        : kf,
    );
  const D = (over: Partial<AnalysisResult> = {}) =>
    med({ betyg: "D", avgiftsprognos: prognos(0), ...over });
  const MENING = "Föreningens ekonomi har brister (betyg D), men inget i årsredovisningen tyder på";

  it("betyg D och ingen väntad höjning: förklarar att priset inte justeras", () => {
    const s = byggSammanfattning(D());
    expect(s.pris).toContain(
      `${MENING} att avgiften behöver höjas mer än i dag de närmaste 24 månaderna. ` +
        "Dagens avgift ingår redan i värderingen, så vi justerar inte priset.",
    );
  });

  it("gäller också E och C, men inte A eller B", () => {
    for (const b of ["C", "E"] as const)
      expect(byggSammanfattning(D({ betyg: b })).pris).toContain(`(betyg ${b})`);
    for (const b of ["A", "B"] as const)
      expect(byggSammanfattning(D({ betyg: b })).pris).not.toContain("så vi justerar inte priset");
  });

  it("betyg B och ingen höjning: ingen mening", () => {
    expect(byggSammanfattning(D({ betyg: "B" })).pris).not.toContain("har brister");
  });

  it("betyg D men en väntad höjning: ingen mening (priset justeras)", () => {
    expect(byggSammanfattning(D({ avgiftsprognos: prognos(400) })).pris).not.toContain(
      "så vi justerar inte priset",
    );
    expect(byggSammanfattning(D({ avgiftsprognos: prognos(-400) })).pris).not.toContain(
      "så vi justerar inte priset",
    );
  });

  it("ingen prognos eller ingen andel: ingen mening", () => {
    const { avgiftsprognos: _a, ...utan } = D();
    expect(byggSammanfattning(utan).pris).not.toContain("har brister");
    expect(byggSammanfattning(D({ avgiftsprognos: prognos(0) })).pris).toContain("har brister");
    const utanAndel = { ...prognos(0), totalKrPerManad: null };
    expect(byggSammanfattning(D({ avgiftsprognos: utanAndel })).pris).not.toContain("har brister");
  });

  it("'Avgiften är redan hög' bara när nyckeltalet är svag eller kritisk", () => {
    for (const status of ["svag", "kritisk"] as const) {
      const s = byggSammanfattning(
        D({ forening: { ...sampleAnalysis.forening, keyFigures: medAvgiftsStatus(status) } }),
      );
      expect(nbsp(s.pris)).toContain("Avgiften är redan hög, 1 234 kr/m² per år.");
    }
    for (const status of ["god", "acceptabel"] as const) {
      const s = byggSammanfattning(
        D({ forening: { ...sampleAnalysis.forening, keyFigures: medAvgiftsStatus(status) } }),
      );
      expect(s.pris).not.toContain("redan hög");
    }
  });

  it("namnger komponenter som saknar underlag", () => {
    const s = byggSammanfattning(
      D({
        avgiftsprognos: prognos(0, [
          komp("spargap", "Sparande mot underhållsbehov", "beraknad"),
          komp("refinansiering", "Lån som ska omsättas", "saknar_underlag"),
          komp("underhall", "Underhåll utan finansiering", "saknar_underlag"),
        ]),
      }),
    );
    expect(s.pris).toContain(
      "Några uppgifter saknas i årsredovisningen eller är för gamla " +
        "(lån som ska omsättas och underhåll utan finansiering), så priset kan vara lägre än värderingen.",
    );
  });

  it("ingen saknad-mening när inget underlag saknas", () => {
    expect(byggSammanfattning(D()).pris).not.toContain("Några uppgifter saknas");
  });

  it("ger inga råd", () => {
    const s = byggSammanfattning(D());
    expect(Object.values(s).join(" ")).not.toMatch(/\b(köp|köpa|avstå|bör du|rekommenderar)\b/i);
  });

  it("asking price inside the ±10 % span is in line with the model, never 'attraktivt'", () => {
    const s = byggSammanfattning(
      med({
        prisanalys: {
          ...sampleAnalysis.prisanalys,
          utgangspris: { value: 5_500_000, unit: "kr", source: "anvandare" },
        },
      }),
    );
    expect(nbsp(s.pris)).toContain("ligger i linje med modellen, inom det ungefärliga spannet");
    expect(s.pris).not.toMatch(/attraktivt|över det ungefärliga|under det ungefärliga/);
  });
});
