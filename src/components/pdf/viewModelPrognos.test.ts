import { describe, expect, it } from "vitest";
import { analysMedPrognos, analysUtanPrognos } from "@/components/prognosTestdata";
import { buildPdfViewModel } from "@/components/pdf/viewModel";

describe("buildPdfViewModel: avgiftsprognos", () => {
  const vm = buildPdfViewModel(analysMedPrognos());

  it("har den justerade värderingen som 'Binfos värdering' och jämförelsen mot den", () => {
    const rad = vm.priset.vardering.find((r) => r.label === "Binfos värdering");
    expect(rad?.note).toBe("Med föreningens ekonomi inräknad");
    expect(vm.priset.vardering.some((r) => r.label === "Föreningens ekonomi")).toBe(true);
  });

  it("har byggårsnotisen vid priset, med sida", () => {
    expect(vm.priset.byggarNotis).toBe(
      "Värderingen räknar med byggår 1958 enligt årsredovisningen, inte 1962 som du angav (s. 3).",
    );
    expect(buildPdfViewModel(analysUtanPrognos()).priset.byggarNotis).toBeUndefined();
  });

  it("använder avgiftstabellen i stället för stresstabellen", () => {
    expect(vm.avgiften.rantestress.prognosTabell?.rader).toHaveLength(4);
    expect(vm.avgiften.rantestress.prognosTabell?.rader[1]?.forandring).toBe("+500");
  });

  it("noterar byggårets avvikelse under metaraden, utan egen jämförelsesektion", () => {
    expect(vm).not.toHaveProperty("jamforelse");
    expect(vm.huvud.byggarRad).toContain("1958");
    expect(vm.huvud.byggarRad).toContain("1962");
    expect(vm.huvud.meta).toContain("byggår 1958");
  });

  it("lämnar allt nytt tomt för gamla resultat", () => {
    const gammal = buildPdfViewModel(analysUtanPrognos());
    expect(gammal.avgiften.rantestress.prognosTabell).toBeUndefined();
    expect(gammal.avgiften.drivare).toBeUndefined();
    expect(gammal.priset.rakning?.ekonomi).toBeUndefined();
    expect(gammal.huvud.byggarRad).toBeUndefined();
    expect(gammal.kort.avgift.stort).toBe("Kan inte uppskattas");
  });
});
