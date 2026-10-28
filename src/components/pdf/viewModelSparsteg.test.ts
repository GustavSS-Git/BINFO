import { describe, expect, it } from "vitest";
import { analysMedSparbehov } from "@/components/prognosTestdata";
import { buildPdfViewModel } from "@/components/pdf/viewModel";

describe("buildPdfViewModel: sparsteg och lån (2026-10-24c)", () => {
  const vm = buildPdfViewModel(analysMedSparbehov());
  const a = vm.avgiften;

  it("tar med prisets komponentsteg i 'Så har vi räknat'", () => {
    const rader = vm.priset.rakning?.ekonomi?.vattenfall ?? [];
    expect(rader.map((r) => r.beloppText.replace(/\s/g, " "))).toContain("−150 000 kr");
  });

  it("har färgton på drivarna och tryck på avsnittet", () => {
    expect(a.tryck).toEqual({ etikett: "Visst tryck på avgiften", ton: "warning" });
    const lan = a.drivare?.rader.find((r) => r.label === "Lån som omsätts");
    expect(lan?.ton).toBe("danger");
  });

  it("har byggdelar med Läge-texter och källa", () => {
    expect(a.spar?.byggdelar.map((b) => b.lage)).toEqual([
      "Troligen eftersatt",
      "Nyligen",
      "Ok",
      "Okänt",
    ]);
    expect(a.spar?.byggdelKalla).toContain("FAR 2025 och SIB M84:10");
    expect(a.spar?.tryck?.etikett).toBeDefined();
  });

  it("har lånerader med senare fas och fast försiktighetsrad", () => {
    expect(a.lan?.rader).toHaveLength(3);
    expect(a.lan?.rader[2]?.lage).toBe("År 3–5 · väger 50 %");
    expect(a.lan?.fastrad).toContain("medvetet försiktigt val");
    expect(a.lan?.kalla).toContain("Lånen enligt årsredovisningen");
  });
});
