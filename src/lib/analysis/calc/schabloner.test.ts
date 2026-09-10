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
  it("schablonEl skalar med boarea och är märkt som schablon", () => {
    const f = schablonEl(58);
    expect(f.value).toBe(714); // 250 + 8*58
    expect(f.unit).toBe("kr/man");
    expect(f.source).toBe("schablon");
    expect(f.schablonBasis).toBeTruthy();
  });

  it("schablonVarme skalar med boarea", () => {
    const f = schablonVarme(58);
    expect(f.value).toBe(992); // 180 + 14*58
    expect(f.source).toBe("schablon");
  });

  it("schablonVatten skalar med antal personer", () => {
    expect(schablonVatten(2).value).toBe(240); // 120*2
    expect(schablonVatten(1).value).toBe(120);
  });

  it("schablonVatten räknar minst en person även vid 0 angivna", () => {
    // Ett hushåll kan inte ha 0 personer — golvet skyddar mot att ett
    // ifyllt 0 tyst nollar ut vattenkostnaden.
    expect(schablonVatten(0).value).toBe(120);
  });

  it("schablonBredband är ett platt belopp oavsett boarea", () => {
    expect(schablonBredband().value).toBe(349);
  });

  it("schablonForsakring skalar med boarea", () => {
    expect(schablonForsakring(58).value).toBe(294); // 120 + 3*58
  });

  it("avrundar till hela kronor när boarea har decimaler", () => {
    // 250 + 8*58.3 = 716.4 → ska avrundas, aldrig lämnas som decimaltal
    const f = schablonEl(58.3);
    expect(Number.isInteger(f.value)).toBe(true);
  });

  it("schabloner() samlar alla poster med korrekt källmärkning", () => {
    const s = schabloner(58, 2);
    expect(s.el.source).toBe("schablon");
    expect(s.varme.source).toBe("schablon");
    expect(s.vatten.source).toBe("schablon");
    expect(s.bredband.source).toBe("schablon");
    expect(s.forsakring.source).toBe("schablon");
    expect(s.vatten.value).toBe(240);
  });
});
