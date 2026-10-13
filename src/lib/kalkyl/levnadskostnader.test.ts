import { describe, expect, it } from "vitest";
import { beraknaLevnadskostnader, kvKolumnForBarn } from "./levnadskostnader";

describe("levnadskostnader (Konsumentverket 2026)", () => {
  it("en vuxen: mat 2 730 + övrigt 2 140 + gemensamma 3 530 = 8 400 kr", () => {
    expect(beraknaLevnadskostnader(1, [])?.summa).toBe(8_400);
  });

  it("två vuxna och två barn (4–6 och 11–14), handräknat: 24 471 kr", () => {
    // Mat: 2 × 2 730 + 1 710 + 2 650 = 9 820
    // Övriga individuella: 2 × 2 140 + 2 000 + 2 070 = 8 350
    // Gemensamma, 4 personer: 6 530 − 229 (barn under 8 år) = 6 301
    const l = beraknaLevnadskostnader(2, ["4-6", "11-14"]);
    expect(l?.summa).toBe(9_820 + 8_350 + 6_301);
    expect(l?.summa).toBe(24_471);
    expect(l?.rader.find((r) => r.id === "mat")?.belopp).toBe(9_820);
    expect(l?.rader.find((r) => r.id === "gemensam_avdrag_barn_under_8")?.belopp).toBe(-229);
  });

  it("avdraget för barn under 8 år görs en gång per hushåll, inte per barn", () => {
    const ett = beraknaLevnadskostnader(2, ["4-6"]);
    const tva = beraknaLevnadskostnader(2, ["4-6", "0-3"]);
    expect(ett?.rader.filter((r) => r.belopp === -229)).toHaveLength(1);
    expect(tva?.rader.filter((r) => r.belopp === -229)).toHaveLength(1);
  });

  it("inget avdrag när alla barn är 7 år eller äldre (7–10 räknas som 8+)", () => {
    const l = beraknaLevnadskostnader(2, ["7-10", "15-17"]);
    expect(l?.rader.some((r) => r.belopp < 0)).toBe(false);
  });

  it("åldersgruppen 0–3 räknas som Konsumentverkets dyrare kolumn (0 år: 3 950 mot 3 830 kr)", () => {
    expect(kvKolumnForBarn("0-3")).toBe("0");
    const med = beraknaLevnadskostnader(1, ["0-3"])!;
    const utan = beraknaLevnadskostnader(1, [])!;
    // Barnets individuella: 1 030 + 2 920 = 3 950. Gemensamma 2 pers 4 390 − 3 530 = 860, avdrag −229.
    expect(med.summa - utan.summa).toBe(3_950 + 860 - 229);
  });

  it("el och vatten som ingår i avgiften tas bort ur gemensamma kostnader", () => {
    const med = beraknaLevnadskostnader(2, []);
    const utan = beraknaLevnadskostnader(2, [], { elIngarIAvgift: true, vattenIngarIAvgift: true });
    expect((med?.summa ?? 0) - (utan?.summa ?? 0)).toBe(530 + 440);
    expect(utan?.rader.find((r) => r.id === "gemensam_hushallsel")?.ingarIAvgift).toBe(true);
  });

  it("större än tabellen (7 personer) eller utan vuxna ger null", () => {
    expect(beraknaLevnadskostnader(7, [])).not.toBeNull();
    expect(beraknaLevnadskostnader(7, ["4-6"])).toBeNull();
    expect(beraknaLevnadskostnader(0, ["4-6"])).toBeNull();
  });

  it("raderna summerar till summan", () => {
    const l = beraknaLevnadskostnader(2, ["0-3", "7-10", "15-17"])!;
    expect(l.rader.reduce((a, r) => a + r.belopp, 0)).toBe(l.summa);
  });
});
