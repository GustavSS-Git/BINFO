import { describe, expect, it } from "vitest";
import { analysMedSparbehov } from "@/components/prognosTestdata";
import { buildPdfViewModel } from "@/components/pdf/viewModel";

describe("buildPdfViewModel — sparsteg och lån (2026-10-24c)", () => {
  const vm = buildPdfViewModel(analysMedSparbehov());
  const p = vm.rakning?.prognos;

  it("märker priserna och tar med vattenfallet", () => {
    expect(vm.prisanalys.justeradVardering?.label).toBe(
      "Värde med hänsyn till föreningens ekonomi",
    );
    expect(
      vm.prisanalys.justeradVardering?.vattenfall.map((r) => r.beloppText.replace(/\s/g, " ")),
    ).toContain("−150 000 kr");
  });

  it("har kedja, byggdelar och färgtoner", () => {
    expect(p?.huvud).toMatchObject({ varde: "+800 kr/mån", ton: "warning" });
    expect(p?.spar?.steg.map((s) => s.rubrik)).toEqual([
      "Behov",
      "Sparar",
      "Glapp",
      "Avgift",
      "Pris",
    ]);
    expect(p?.spar?.dampningTag).toBe("Räknas till 50 % (schablon)");
    expect(p?.spar?.byggdelar.map((b) => b.status)).toEqual([
      "Eftersatt",
      "Nyligen",
      "Ok",
      "Okänt",
    ]);
    expect(p?.komponenter.find((k) => k.label === "Lån som omsätts")?.ton).toBe("danger");
  });

  it("har lånerader med senare fas och fast försiktighetsrad", () => {
    expect(p?.lan?.rader).toHaveLength(3);
    expect(p?.lan?.rader[2]?.fas).toBe("År 3–5 · väger 50 %");
    expect(p?.lan?.fastrad).toContain("medvetet försiktigt val");
    expect(p?.rantekanslighetRad).toContain("påverkar inte priset");
  });

  it("märker avgiftsstycket i sammanfattningen med tryck", () => {
    expect(vm.sammanfattning?.avgiftTryck).toEqual({
      etikett: "Visst tryck på avgiften",
      ton: "warning",
    });
  });
});
