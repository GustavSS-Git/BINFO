import { describe, expect, it } from "vitest";
import { analysMedPrognos, analysUtanPrognos } from "@/components/prognosTestdata";
import { harRantestressFlikar, rantestressVy } from "@/lib/analysisView";
import type { AnalysisResult } from "@/types/analysis";

// Sample: fee 3 503 kr, räntekänslighet 4,2 %/pp → +1 pp = 3 650 (+147),
// +2 pp = 3 797 (+294), +3 pp = 3 944 (+441). Expected rise in the test data: +500 kr/mån, 24 months.
const med = (): AnalysisResult => {
  const a = analysMedPrognos();
  return { ...a, avgiftsprognos: { ...a.avgiftsprognos!, tryck: "gul" } };
};
const nbsp = (s: string) => s.replace(/\s/g, " ");

describe("rantestressVy", () => {
  it("flikarna finns bara när en förväntad avgift finns", () => {
    expect(harRantestressFlikar(med())).toBe(true);
    expect(harRantestressFlikar(analysUtanPrognos())).toBe(false);
    const utanTotal = med();
    utanTotal.avgiftsprognos = { ...utanTotal.avgiftsprognos!, totalKrPerManad: null };
    expect(harRantestressFlikar(utanTotal)).toBe(false);
  });

  it("fliken 'Dagens avgift' är det befintliga reglaget", () => {
    const vy = rantestressVy(med(), "idag", 1);
    expect(vy.vanster.etikett).toBe("Dagens avgift");
    expect(nbsp(vy.vanster.varde)).toBe("3 503 kr");
    expect(vy.vanster.under).toBe("per månad");
    expect(vy.vanster.tryck).toBeUndefined();
    expect(vy.hoger).toMatchObject({ etikett: "Stressad avgift" });
    expect("varde" in vy.hoger && nbsp(vy.hoger.varde)).toBe("3 650 kr");
    expect("under" in vy.hoger && nbsp(vy.hoger.under)).toBe("per månad · +147 kr");
    expect(vy.kommentar).toBe(med().rantestress.kommentar);
  });

  it("fliken 'Förväntad avgift': dagens avgift + förväntad höjning, samma ökning per p.e.", () => {
    // 3 503 + 500 = 4 003; +1 pp: 4 003 + 147 = 4 150; +2 pp: 4 003 + 294 = 4 297
    const v1 = rantestressVy(med(), "forvantad", 1);
    expect(v1.vanster.etikett).toBe("Förväntad avgift");
    expect(nbsp(v1.vanster.varde)).toBe("4 003 kr");
    expect(nbsp(v1.vanster.under)).toBe("per månad · +500 kr mot i dag");
    expect(v1.vanster.tryck).toBe("gul");
    expect("varde" in v1.hoger && nbsp(v1.hoger.varde)).toBe("4 150 kr");
    expect("under" in v1.hoger && nbsp(v1.hoger.under)).toBe(
      "per månad · +147 kr mot förväntad avgift",
    );
    const v2 = rantestressVy(med(), "forvantad", 2);
    expect("varde" in v2.hoger && nbsp(v2.hoger.varde)).toBe("4 297 kr");
    const v0 = rantestressVy(med(), "forvantad", 0);
    expect("varde" in v0.hoger && nbsp(v0.hoger.varde)).toBe("4 003 kr");
  });

  it("negativ förväntad höjning visas med minus", () => {
    const a = med();
    a.avgiftsprognos = { ...a.avgiftsprognos!, totalKrPerManad: -120 };
    const vy = rantestressVy(a, "forvantad", 0);
    expect(nbsp(vy.vanster.varde)).toBe("3 383 kr");
    expect(nbsp(vy.vanster.under)).toBe("per månad · −120 kr mot i dag");
  });

  it("kommentaren förklarar förväntad avgift och reglaget, utan orsaksspråk", () => {
    const vy = rantestressVy(med(), "forvantad", 1);
    expect(vy.kommentar).toBe(
      "Förväntad avgift är dagens avgift plus den höjning som väntas inom 24 månader. " +
        "Reglaget lägger en ränteökning på föreningens hela skuld, via räntekänsligheten, ovanpå den förväntade avgiften.",
    );
  });

  it("saknad räntekänslighet: reglaget låst på +0 i båda flikarna, förväntad avgift visas ändå", () => {
    const a = med();
    a.rantestress = {
      ...a.rantestress,
      rantekanslighetProcent: null,
      scenarier: [],
      kommentar: "SAKNAS-KOMMENTAR",
    };
    const idag = rantestressVy(a, "idag", 3);
    expect(idag.ejBeraknbar).toBe(true);
    expect(idag.visadDelta).toBe(0);
    expect("saknas" in idag.hoger).toBe(true);
    const forv = rantestressVy(a, "forvantad", 3);
    expect(forv.visadDelta).toBe(0);
    expect(nbsp(forv.vanster.varde)).toBe("4 003 kr");
    expect("saknas" in forv.hoger).toBe(true);
    expect(forv.kommentar).toContain("SAKNAS-KOMMENTAR");
  });

  it("skuldfri (räntekänslighet 0): +0 kr, stressad = förväntad avgift", () => {
    const a = med();
    a.rantestress = {
      ...a.rantestress,
      rantekanslighetProcent: 0,
      scenarier: [0, 1, 2, 3].map((okningPe) => ({
        okningPe: okningPe as 0 | 1 | 2 | 3,
        nyManadsavgift: { value: 3503, unit: "kr", source: "berakning" },
        avgiftsokningKrPerManad: { value: 0, unit: "kr", source: "berakning" },
      })),
      kommentar: "SKULDFRI-KOMMENTAR",
    };
    const vy = rantestressVy(a, "forvantad", 3);
    expect(vy.ejBeraknbar).toBe(false);
    expect("varde" in vy.hoger && nbsp(vy.hoger.varde)).toBe("4 003 kr");
    expect("under" in vy.hoger && nbsp(vy.hoger.under)).toBe(
      "per månad · +0 kr mot förväntad avgift",
    );
    expect(vy.kommentar).toContain("SKULDFRI-KOMMENTAR");
  });

  it("utan prognos faller en begärd förväntad flik tillbaka på dagens reglage", () => {
    const vy = rantestressVy(analysUtanPrognos(), "forvantad", 1);
    expect(vy.harPrognos).toBe(false);
    expect(vy.flik).toBe("idag");
    expect(vy.vanster.etikett).toBe("Dagens avgift");
  });
});
