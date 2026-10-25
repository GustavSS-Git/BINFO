import { describe, expect, it } from "vitest";
import { analysMedPrognos, analysUtanPrognos } from "@/components/prognosTestdata";
import { buildPdfViewModel } from "@/components/pdf/viewModel";
import { sampleAnalysis } from "@/data/sampleAnalysis";

describe("buildPdfViewModel — avgiftsprognos", () => {
  const vm = buildPdfViewModel(analysMedPrognos());

  it("har två prisrader och flyttar jämförelsen till den justerade", () => {
    expect(vm.prisanalys.justeradVardering?.label).toBe(
      "Värde med hänsyn till föreningens ekonomi utöver nuvarande avgift",
    );
    expect(vm.prisanalys.justeradVardering?.avvikelseText).toContain("den justerade värderingen");
    expect(vm.prisanalys.avvikelseText).toBeUndefined();
  });

  it("har byggårsnotisen vid priset, med sida", () => {
    expect(vm.prisanalys.byggarNotis).toBe(
      "Värderingen räknar med byggår 1958 enligt årsredovisningen, inte 1962 som du angav (s. 3).",
    );
    expect(buildPdfViewModel(analysUtanPrognos()).prisanalys.byggarNotis).toBeUndefined();
  });

  it("bygger 'Så har vi räknat' med utgångsläge, prognos och lån", () => {
    expect(vm.rakning?.utgangslage?.faktorer.length).toBeGreaterThan(3);
    const p = vm.rakning?.prognos;
    expect(p?.rubrik).toContain("+500 kr/mån");
    expect(p?.komponenter.map((k) => k.vardeText)).toContain("Underlag saknas");
    expect(p?.prisTexter.join(" ")).toContain("≈ 300 kr i pris per krona");
    expect(p?.prisCaveat).toBeDefined();
    expect(p?.refinansiering?.rader).toHaveLength(3);
  });

  it("använder avgiftstabellen i stället för stresstabellen", () => {
    expect(vm.rantestress.prognosTabell?.rader).toHaveLength(4);
    expect(vm.rantestress.prognosTabell?.rader[1]?.forandring).toBe("+500");
  });

  it("noterar byggårets avvikelse i sammanfattningen, utan egen jämförelsesektion", () => {
    expect(vm).not.toHaveProperty("jamforelse");
    const byggar = vm.summary.find((r) => r.label === "Byggår");
    expect(byggar?.value).toBe("1958 (årsredovisningen: 1958, du angav 1962, s. 3)");
  });

  it("tar med sammanfattningen sist", () => {
    expect(vm.sammanfattning?.stycken).toEqual(["SUMBETYG", "SUMPRIS", "SUMAVGIFT", "SUMSLUTSATS"]);
  });

  it("lämnar allt nytt tomt för gamla resultat", () => {
    const gammal = buildPdfViewModel(analysUtanPrognos());
    expect(gammal.prisanalys.justeradVardering).toBeUndefined();
    expect(gammal.rantestress.prognosTabell).toBeUndefined();
    expect(gammal.summary.find((r) => r.label === "Byggår")?.value).toBe(
      String(sampleAnalysis.input.byggar),
    );
    expect(gammal.sammanfattning).toBeUndefined();
    expect(gammal.rakning?.prognos).toBeUndefined();
  });
});
