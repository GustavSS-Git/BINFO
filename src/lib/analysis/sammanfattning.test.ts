import { describe, expect, it } from "vitest";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import { byggSammanfattning } from "./sammanfattning";
import type { AnalysisResult } from "@/types/analysis";

const nbsp = (s: string) => s.replace(/\u00a0/g, " ");

function med(over: Partial<AnalysisResult>): AnalysisResult {
  return { ...sampleAnalysis, ...over };
}

describe("byggSammanfattning", () => {
  it("price vs utgångspris and the area's bid premium (sample: 4 995 000 vs 5 681 607, +5,43 %)", () => {
    const s = byggSammanfattning(sampleAnalysis);
    // 4 995 000 / 5 681 607 − 1 = −12,1 %; 4 995 000 × 1,0543 = 5 266 229 → −7,3 % vs värderingen.
    expect(nbsp(s.pris)).toContain("Utgångspriset 4 995 000 kr ligger 12,1 % under värderingen.");
    expect(nbsp(s.pris)).toContain("ca 5 270 000 kr, skulle ligga 7,3 % under Binfos värdering");
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
    expect(nbsp(s.pris)).toContain("ca 5 500 000 kr efter justering");
    expect(nbsp(s.pris)).toContain("(ca 5 680 000 kr före justering)");
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
    expect(nbsp(s.avgift)).toContain("höjs med ca 350 kr i månaden under de närmaste 2 åren");
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
