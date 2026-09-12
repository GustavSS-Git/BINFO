import { describe, expect, it } from "vitest";
import {
  DemoPrisdatakalla,
  TomPrisdatakalla,
  konfidensUtanPrisdata,
  type Prisdataforfragan,
  type Prisdatakalla,
} from "./prisdata";
import type { Figure } from "@/types/analysis";

const forfragan: Prisdataforfragan = {
  orgnr: "769612-3456",
  boarea: 62,
  postnummer: "11857",
  ort: "Stockholm",
};

const UTGANGSPRIS = 4_950_000;

/** Plockar ut varje Figure en källa kan producera, så invarianterna kan
 *  testas över allihop och inte bara över de fält testet råkar nämna. */
async function allaFigurer(kalla: Prisdatakalla): Promise<Figure[]> {
  const figurer: Figure[] = [];
  const vardering = await kalla.hamtaVardering(forfragan);
  if (vardering) figurer.push(vardering);
  for (const forsaljning of await kalla.hamtaForsaljningarIForeningen(forfragan)) {
    figurer.push(forsaljning.pris, forsaljning.prisPerM2);
  }
  const median = await kalla.hamtaOmradeMedian(forfragan);
  if (median) figurer.push(median);
  return figurer;
}

describe("TomPrisdatakalla", () => {
  it("returnerar ingen värdering", async () => {
    expect(await new TomPrisdatakalla().hamtaVardering(forfragan)).toBeNull();
  });

  it("returnerar inga försäljningar i föreningen", async () => {
    expect(await new TomPrisdatakalla().hamtaForsaljningarIForeningen(forfragan)).toEqual([]);
  });

  it("returnerar ingen områdesmedian", async () => {
    expect(await new TomPrisdatakalla().hamtaOmradeMedian(forfragan)).toBeNull();
  });

  it("producerar inga figurer alls", async () => {
    expect(await allaFigurer(new TomPrisdatakalla())).toEqual([]);
  });
});

describe("DemoPrisdatakalla", () => {
  const demo = () => new DemoPrisdatakalla({ utgangspris: UTGANGSPRIS, boarea: forfragan.boarea });

  it("märker varje figur som schablon — aldrig 'extern'", async () => {
    const figurer = await allaFigurer(demo());
    expect(figurer.length).toBeGreaterThan(0);
    for (const figur of figurer) {
      expect(figur.source).toBe("schablon");
    }
  });

  it("ger varje figur en icke-tom schablonBasis som börjar med PLATSHÅLLARE", async () => {
    for (const figur of await allaFigurer(demo())) {
      expect(figur.schablonBasis).toBeTruthy();
      expect(figur.schablonBasis?.startsWith("PLATSHÅLLARE")).toBe(true);
    }
  });

  it("nämner i varje schablonBasis att ingen värderingskälla är ansluten", async () => {
    for (const figur of await allaFigurer(demo())) {
      expect(figur.schablonBasis).toMatch(/ingen .*värderingskälla|ingen .*priskälla/i);
    }
  });

  it("ger aldrig någon figur ett numeriskt value — en platshållare får aldrig bli ett prisomdöme", async () => {
    for (const figur of await allaFigurer(demo())) {
      expect(figur.value).toBeNull();
    }
  });

  it("anger leverantören som en platshållare, inte som ett riktigt varumärke", async () => {
    const vardering = await demo().hamtaVardering(forfragan);
    expect(vardering).not.toBeNull();
    expect(vardering?.leverantor.startsWith("PLATSHÅLLARE")).toBe(true);
  });

  it("ger värderingen ett spann som är för brett för att kunna läsas som ett omdöme", async () => {
    const vardering = await demo().hamtaVardering(forfragan);
    const spann = vardering?.range;
    expect(spann).toBeDefined();
    if (!spann) return;
    expect(spann.low).toBeLessThan(UTGANGSPRIS);
    expect(spann.high).toBeGreaterThan(UTGANGSPRIS);
    // Minst 40 % av utgångspriset brett — ett spann i den storleken kan inte
    // skilja ett rimligt pris från ett orimligt.
    expect(spann.high - spann.low).toBeGreaterThanOrEqual(0.4 * UTGANGSPRIS);
  });

  it("avrundar spannets ändpunkter till hela kronor", async () => {
    const vardering = await demo().hamtaVardering(forfragan);
    expect(Number.isInteger(vardering?.range?.low)).toBe(true);
    expect(Number.isInteger(vardering?.range?.high)).toBe(true);
  });

  it("returnerar försäljningar i föreningen med rätt enheter", async () => {
    const forsaljningar = await demo().hamtaForsaljningarIForeningen(forfragan);
    expect(forsaljningar.length).toBeGreaterThan(0);
    for (const f of forsaljningar) {
      expect(f.pris.unit).toBe("kr");
      expect(f.prisPerM2.unit).toBe("kr/m2");
      expect(f.datum).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(f.boarea).toBeGreaterThan(0);
    }
  });

  it("returnerar en områdesmedian i kr/m2", async () => {
    const median = await demo().hamtaOmradeMedian(forfragan);
    expect(median?.unit).toBe("kr/m2");
  });

  it("klarar boarea 0 utan att dela med noll", async () => {
    const kalla = new DemoPrisdatakalla({ utgangspris: UTGANGSPRIS, boarea: 0 });
    const figurer = await allaFigurer(kalla);
    for (const figur of figurer) {
      expect(figur.range?.low).not.toBeNaN();
      expect(figur.range?.high).not.toBeNaN();
    }
  });
});

describe("Prisdatakalla-gränssnittet", () => {
  it("uppfylls av båda implementationerna, så de är utbytbara för anroparen", async () => {
    const kallor: Prisdatakalla[] = [
      new TomPrisdatakalla(),
      new DemoPrisdatakalla({ utgangspris: UTGANGSPRIS, boarea: forfragan.boarea }),
    ];
    for (const kalla of kallor) {
      await expect(kalla.hamtaVardering(forfragan)).resolves.not.toThrow();
      await expect(kalla.hamtaForsaljningarIForeningen(forfragan)).resolves.toBeInstanceOf(Array);
      await expect(kalla.hamtaOmradeMedian(forfragan)).resolves.not.toThrow();
    }
  });
});

describe("konfidensUtanPrisdata", () => {
  it("ger låg konfidens", () => {
    expect(konfidensUtanPrisdata().niva).toBe("lag");
  });

  it("anger skälet på svenska, för visning ordagrant för användaren", () => {
    const skal = konfidensUtanPrisdata().skal;
    expect(skal).toBeDefined();
    expect(skal?.length).toBeGreaterThan(0);
    expect(skal?.[0]).toMatch(/priskälla|värderingskälla/i);
  });
});
