import { describe, expect, it } from "vitest";
import {
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

  it("schablonVatten är 6 kr per m² boarea och månad", () => {
    expect(schablonVatten(58).value).toBe(348);
    expect(schablonVatten(0).value).toBe(0);
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
    expect(s.vatten.value).toBe(348);
  });
});
