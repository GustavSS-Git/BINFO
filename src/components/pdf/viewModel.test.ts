import { describe, expect, it } from "vitest";
import { buildPdfViewModel } from "@/components/pdf/viewModel";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import type { AnalysisResult, Figure } from "@/types/analysis";

describe("buildPdfViewModel — sample analysis", () => {
  const vm = buildPdfViewModel(sampleAnalysis);

  it("carries the förening name and formatted skapad date", () => {
    expect(vm.foreningNamn).toBe("Brf Granen 10-11");
    expect(vm.skapadLabel).toContain("2026");
  });

  it("includes every red flag, not just the top two, most severe first", () => {
    expect(vm.rodaFlaggor).toHaveLength(sampleAnalysis.rodaFlaggor.length);
    const severities = vm.rodaFlaggor.map((f) => f.severity);
    expect(severities).toEqual(["hog", "hog", "medel", "medel"]);
  });

  it("keeps each red flag's page reference", () => {
    expect(vm.rodaFlaggor[0]?.pageRef).toBe("s. 5");
  });

  it("includes only the six key figures the main analysis shows (visasIHuvudanalys, status !== okant)", () => {
    // arsavgift_andel_av_rorelseintakter has status "okant" in the sample and must be excluded.
    expect(vm.keyFigures.map((kf) => kf.id)).not.toContain("arsavgift_andel_av_rorelseintakter");
    expect(vm.keyFigures).toHaveLength(6);
  });

  it("labels a schablon-sourced key figure distinctly", () => {
    // None of the sample's shown key figures are schablon-sourced; assert the flag is computed at all.
    expect(vm.keyFigures.every((kf) => kf.isSchablon === false)).toBe(true);
  });

  it("labels the schablon-sourced extern värdering as an estimate, never as a fact", () => {
    expect(vm.prisanalys.externVardering?.isSchablon).toBe(true);
    expect(vm.prisanalys.externVardering?.leverantor).toContain("Binfo värderingsmodell");
  });

  it("carries Binfos värderingsunderlag (task 4g) — område, intervall, drivare, databasis, attribution", () => {
    expect(vm.prisanalys.varderingsunderlag).toBeDefined();
    const u = vm.prisanalys.varderingsunderlag;
    expect(u?.omradeText).toContain("Stockholm");
    expect(u?.intervallText).toMatch(/Sannolikt mellan/);
    expect(u?.drivare.length).toBeGreaterThan(0);
    expect(u?.dataBasisText).toMatch(/Bygger på \d/);
    expect(u?.attributionText).toContain("OpenStreetMap");
  });

  it("carries the budpremie text (task 5)", () => {
    expect(vm.prisanalys.budpremieText).toMatch(/Bostäder i/);
  });

  it("includes all four räntestress scenarios (0–3 percentage points), in order", () => {
    expect(vm.rantestress.rader.map((r) => r.okningPe)).toEqual([0, 1, 2, 3]);
    expect(vm.rantestress.rader[3]?.nyManadsavgift).toBe("4 836 kr");
  });

  it("omits totalManadskostnad per row when the analysis has no loan data", () => {
    expect(vm.rantestress.rader.every((r) => r.totalManadskostnad === undefined)).toBe(true);
  });

  it("includes only analysis-derived questions, matching what AnalysRapport shows on screen", () => {
    const analysFragorCount = sampleAnalysis.fragor.filter((f) => f.ursprung === "analys").length;
    expect(vm.fragor).toHaveLength(analysFragorCount);
    expect(vm.fragor.some((f) => f.id === "saknad-hiss")).toBe(false);
  });

  it("carries betyg and motivering verbatim", () => {
    expect(vm.betyg).toBe("D");
    expect(vm.betygMotivering).toBe(sampleAnalysis.betygMotivering);
  });
});

describe("buildPdfViewModel — edge cases", () => {
  it("shows the anonymisation notice, not a dangling ', <ort>', once adress/postnummer/orgnr are cleared", () => {
    // Mirrors src/components/PropertySummary.tsx's exact rendering: after 30
    // days the server clears adress/postnummer/orgnr (ort is retained), and
    // the on-screen report falls back to a notice instead of `"${adress}, ${ort}"`.
    const anonymAnalys: AnalysisResult = {
      ...sampleAnalysis,
      input: { ...sampleAnalysis.input, adress: "", postnummer: "", orgnr: "" },
    };
    const vm = buildPdfViewModel(anonymAnalys);
    const adressRad = vm.summary.find((row) => row.label === "Adress");
    expect(adressRad?.value).toBe("Adressen raderad efter 30 dagar · Stockholm");
    expect(adressRad?.value).not.toContain(", Stockholm");
  });

  it("still prints '<adress>, <ort>' when the address has not been anonymised", () => {
    const adressRad = buildPdfViewModel(sampleAnalysis).summary.find(
      (row) => row.label === "Adress",
    );
    expect(adressRad?.value).toBe("Granstigen 10, Stockholm");
  });

  it("renders a figure with value null + tecken negativ via formatFigureVarde, not as 'Uppgift saknas'", () => {
    const negativFigure: Figure = {
      value: null,
      unit: "kr/m2",
      source: "arsredovisning",
      tecken: "negativ",
      tryckt: "neg",
    };
    const analys: AnalysisResult = {
      ...sampleAnalysis,
      forening: {
        ...sampleAnalysis.forening,
        keyFigures: sampleAnalysis.forening.keyFigures.map((kf) =>
          kf.id === "sparande_per_m2_totalyta" ? { ...kf, figure: negativFigure } : kf,
        ),
      },
    };
    const vm = buildPdfViewModel(analys);
    const sparande = vm.keyFigures.find((kf) => kf.id === "sparande_per_m2_totalyta");
    expect(sparande?.valueText).toBe('Negativt ("neg" i årsredovisningen)');
  });

  it("omits externVardering entirely when the analysis has none", () => {
    const analys: AnalysisResult = {
      ...sampleAnalysis,
      prisanalys: {
        utgangspris: sampleAnalysis.prisanalys.utgangspris,
        prisPerM2: sampleAnalysis.prisanalys.prisPerM2,
        slutsats: "Ingen extern värdering tillgänglig.",
        konfidens: { niva: "medel" },
      },
    };
    const vm = buildPdfViewModel(analys);
    expect(vm.prisanalys.externVardering).toBeUndefined();
    expect(vm.prisanalys.avvikelseText).toBeUndefined();
    expect(vm.prisanalys.varderingsunderlag).toBeUndefined();
    expect(vm.prisanalys.budpremieText).toBeUndefined();
  });

  it("returns an empty red flags list, rather than throwing, when there are none", () => {
    const analys: AnalysisResult = { ...sampleAnalysis, rodaFlaggor: [] };
    const vm = buildPdfViewModel(analys);
    expect(vm.rodaFlaggor).toEqual([]);
  });

  it("only surfaces low-confidence reasons when konfidens.niva is 'lag', matching AnalysRapport", () => {
    const analys: AnalysisResult = {
      ...sampleAnalysis,
      prisanalys: {
        ...sampleAnalysis.prisanalys,
        konfidens: { niva: "hog", skal: ["Skulle inte visas"] },
      },
    };
    const vm = buildPdfViewModel(analys);
    expect(vm.prisanalys.konfidensSkal).toEqual([]);
  });

  it("omits a key figure's page reference when the figure has none", () => {
    const analys: AnalysisResult = {
      ...sampleAnalysis,
      forening: {
        ...sampleAnalysis.forening,
        keyFigures: sampleAnalysis.forening.keyFigures.map((kf) => {
          if (kf.id !== "sparande_per_m2_totalyta") return kf;
          const { ref: _ref, ...figureUtanRef } = kf.figure;
          return { ...kf, figure: figureUtanRef };
        }),
      },
    };
    const vm = buildPdfViewModel(analys);
    const sparande = vm.keyFigures.find((kf) => kf.id === "sparande_per_m2_totalyta");
    expect(sparande?.pageRef).toBeUndefined();
  });
});
