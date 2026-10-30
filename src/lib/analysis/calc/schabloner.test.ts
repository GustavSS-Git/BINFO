import { describe, expect, it } from "vitest";
import {
  BOAREA_HINT,
  PERSONER_HINT,
  schablonBredband,
  schablonEl,
  schablonForsakring,
  schablonVarme,
  schablonVatten,
  schabloner,
} from "./schabloner";

describe("cost schablons", () => {
  it("schablonEl är Konsumentverkets hushållsel per antal personer, utan del per m²", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((p) => schablonEl(p).value)).toEqual([
      400, 530, 700, 870, 1010, 1150, 1280,
    ]);
    const f = schablonEl(2);
    expect(f.unit).toBe("kr/man");
    expect(f.source).toBe("schablon");
    expect(f.schablonBasis).toMatch(/Konsumentverket 2026/);
  });

  it("schablonEl: 0 personer räknas som 1, fler än tabellen räknas som 7 och märks som antagande", () => {
    expect(schablonEl(0).value).toBe(400);
    expect(schablonEl(9).value).toBe(1280);
    expect(schablonEl(9).schablonBasis).toMatch(/antagande/);
    expect(schablonEl(7).schablonBasis).not.toMatch(/antagande/);
  });

  it("schablonVarme är 21 kr per m² boarea och månad, utan fast del", () => {
    expect(schablonVarme(58).value).toBe(1218);
    expect(schablonVarme(0).value).toBe(0);
    expect(schablonVarme(58).schablonBasis).toMatch(/Nils Holgersson 2026/);
  });

  it("schablonVatten är 135 kr per person och månad (2026-10-28, tidigare 6 kr/m²)", () => {
    expect([1, 2, 3, 4].map((p) => schablonVatten(p).value)).toEqual([135, 270, 405, 540]);
    expect(schablonVatten(0).value).toBe(135); // som schablonEl: 0 personer räknas som 1
    expect(schablonVatten(2).schablonBasis).toMatch(/Konsumentverket 2026/);
    expect(schablonVatten(2).schablonBasis).toMatch(/Nils Holgersson 2026/);
  });

  it("schablonVarme säger att varmvattnet ingår", () => {
    expect(schablonVarme(58).schablonBasis).toMatch(/varmvatten/);
  });

  it("fälthintarna stämmer med vad schablonerna faktiskt beror på", () => {
    expect(BOAREA_HINT).toBe("Styr schablonen för värme");
    expect(PERSONER_HINT).toBe("Styr schablonerna för hushållsel, vatten och hemförsäkring");
    // Boarea ändrar värme men inget annat; personer ändrar el, vatten, försäkring men inte värme.
    const a = schabloner(40, 2);
    const b = schabloner(80, 2);
    const c = schabloner(40, 4);
    expect(b.varme.value).not.toBe(a.varme.value);
    for (const id of ["el", "vatten", "bredband", "forsakring"] as const) {
      expect(b[id].value).toBe(a[id].value);
    }
    expect(c.varme.value).toBe(a.varme.value);
    expect(c.bredband.value).toBe(a.bredband.value);
    for (const id of ["el", "vatten", "forsakring"] as const) {
      expect(c[id].value).not.toBe(a[id].value);
    }
  });

  it("schablonBredband är ett platt belopp, Binfos uppskattning", () => {
    expect(schablonBredband().value).toBe(349);
    expect(schablonBredband().schablonBasis).toMatch(/Binfos uppskattning/);
  });

  it("schablonForsakring är Konsumentverkets hemförsäkring per antal personer", () => {
    expect([1, 2, 3, 4].map((p) => schablonForsakring(p).value)).toEqual([150, 170, 200, 250]);
    expect(schablonForsakring(2).schablonBasis).toMatch(/bostadsrättstillägg ingår inte/);
  });

  it("avrundar till hela kronor när boarea har decimaler", () => {
    expect(Number.isInteger(schablonVarme(58.3).value)).toBe(true);
    expect(schablonVarme(58.3).value).toBe(1224); // 21 × 58,3 = 1224,3
  });

  it("schabloner() samlar alla poster med korrekt källmärkning", () => {
    const s = schabloner(58, 2);
    for (const f of Object.values(s)) expect(f.source).toBe("schablon");
    expect(s.el.value).toBe(530);
    expect(s.forsakring.value).toBe(170);
    expect(s.varme.value).toBe(1218);
    expect(s.vatten.value).toBe(270);
  });
});
