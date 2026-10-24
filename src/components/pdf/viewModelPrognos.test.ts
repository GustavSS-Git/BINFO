import { describe, expect, it } from "vitest";
import { analysMedPrognos, analysUtanPrognos } from "@/components/prognosTestdata";
import { buildPdfViewModel } from "@/components/pdf/viewModel";
import { sampleAnalysis } from "@/data/sampleAnalysis";

describe("buildPdfViewModel — avgiftsprognos", () => {
  const vm = buildPdfViewModel(analysMedPrognos());

  it("har två prisrader och flyttar jämförelsen till den justerade", () => {
    expect(vm.prisanalys.justeradVardering?.label).toBe("Justerat för väntad avgiftshöjning");
    expect(vm.prisanalys.justeradVardering?.avvikelseText).toContain("den justerade värderingen");
    expect(vm.prisanalys.avvikelseText).toBeUndefined();
  });

  it("bygger 'Så har vi räknat' med utgångsläge, prognos och lån", () => {
    expect(vm.rakning?.utgangslage?.faktorer.length).toBeGreaterThan(3);
    const p = vm.rakning?.prognos;
    expect(p?.rubrik).toContain("höjs med ca 500 kr/mån");
    expect(p?.komponenter.map((k) => k.vardeText)).toContain("Underlag saknas – spannet breddas");
    expect(p?.prisTexter.join(" ")).toContain("≈ 300 kr i pris per krona");
    expect(p?.prisCaveat).toBeDefined();
    expect(p?.refinansiering?.rader).toHaveLength(3);
  });

  it("använder avgiftstabellen i stället för stresstabellen", () => {
    expect(vm.rantestress.prognosTabell?.rader).toHaveLength(4);
    expect(vm.rantestress.prognosTabell?.rader[1]?.forandring).toBe("+500");
  });

  it("tar med jämförelserader och sammanfattning sist", () => {
    expect(vm.jamforelse).toHaveLength(2);
    expect(vm.jamforelse[0]?.statusLabel).toBe("Avviker");
    expect(vm.jamforelse[0]?.pageRef).toBe("s. 3");
    expect(vm.sammanfattning?.stycken).toEqual(["SUMBETYG", "SUMPRIS", "SUMAVGIFT", "SUMSLUTSATS"]);
  });

  it("lämnar allt nytt tomt för gamla resultat", () => {
    const gammal = buildPdfViewModel(analysUtanPrognos());
    expect(gammal.prisanalys.justeradVardering).toBeUndefined();
    expect(gammal.rantestress.prognosTabell).toBeUndefined();
    expect(gammal.jamforelse).toEqual([]);
    expect(gammal.sammanfattning).toBeUndefined();
    expect(gammal.rakning?.prognos).toBeUndefined();
  });
});
