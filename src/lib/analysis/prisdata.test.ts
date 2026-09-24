import { describe, expect, it } from "vitest";
import {
  DemoPrisdatakalla,
  ModellPrisdatakalla,
  TomPrisdatakalla,
  konfidensUtanPrisdata,
  konfidensUtanforStockholm,
  korBinfoVarderingsmodell,
  type Prisdataforfragan,
  type Prisdatakalla,
} from "./prisdata";
import type { Figure } from "@/types/analysis";

/** Bas-förfrågan: 11857 är Södermalm i den riktiga kartläggningstabellen
 *  (src/lib/vardering/data/postnummerOmrade.data.ts), så den här förfrågan
 *  träffar den vanliga, kartlagda vägen genom Binfos värderingsmodell. */
const forfragan: Prisdataforfragan = {
  orgnr: "769612-3456",
  boarea: 62,
  postnummer: "11857",
  ort: "Stockholm",
  antalRum: 3,
  manadsavgift: 4_200,
  vaning: 3,
  byggar: 1962,
  hiss: "ja",
  balkong: "nej",
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

describe("ModellPrisdatakalla", () => {
  const modell = () => new ModellPrisdatakalla();

  describe("kartlagt postnummer (11857 -> Södermalm)", () => {
    it("värderar med ett numeriskt value i kronor", async () => {
      const vardering = await modell().hamtaVardering(forfragan);
      expect(vardering).not.toBeNull();
      expect(vardering?.unit).toBe("kr");
      expect(typeof vardering?.value).toBe("number");
      expect(Number.isInteger(vardering?.value)).toBe(true);
    });

    it("märker värderingen som schablon — aldrig 'extern'", async () => {
      const figurer = await allaFigurer(modell());
      expect(figurer.length).toBeGreaterThan(0);
      for (const figur of figurer) {
        expect(figur.source).toBe("schablon");
        expect(figur.source).not.toBe("extern");
      }
    });

    it("namnger leverantören som Binfos egen modell, inte en tredjepartsleverantör", async () => {
      const vardering = await modell().hamtaVardering(forfragan);
      expect(vardering?.leverantor).toMatch(/^Binfo värderingsmodell /);
    });

    it("ger en icke-tom schablonBasis som nämner modellversionen och att det inte är en besiktning", async () => {
      const vardering = await modell().hamtaVardering(forfragan);
      expect(vardering?.schablonBasis).toBeTruthy();
      expect(vardering?.schablonBasis).toMatch(/statistisk skattning/i);
      expect(vardering?.schablonBasis).toMatch(/inte en besiktning/i);
    });

    it("bär ett prediktionsintervall som spänner runt värdet", async () => {
      const vardering = await modell().hamtaVardering(forfragan);
      expect(vardering?.range).toBeDefined();
      if (!vardering?.range || vardering.value === null) return;
      expect(vardering.range.low).toBeLessThanOrEqual(vardering.value);
      expect(vardering.range.high).toBeGreaterThanOrEqual(vardering.value);
    });

    it("returnerar inga försäljningar i föreningen — modellen ger bara en punktprediktion", async () => {
      expect(await modell().hamtaForsaljningarIForeningen(forfragan)).toEqual([]);
    });

    it("returnerar ingen områdesmedian — modellen mäter inte en riktig medianstatistik", async () => {
      expect(await modell().hamtaOmradeMedian(forfragan)).toBeNull();
    });
  });

  describe("okartlagt postnummer med känt Stockholmsprefix (12364, prefix 123 finns i tabellen)", () => {
    const okartlagt: Prisdataforfragan = { ...forfragan, postnummer: "12364" };

    it("värderar ändå, med hela Stockholm som fallback-område", async () => {
      const vardering = await modell().hamtaVardering(okartlagt);
      expect(vardering).not.toBeNull();
      expect(typeof vardering?.value).toBe("number");
    });

    it("nämner i schablonBasis att området inte kunde kopplas till ett specifikt Stockholmsområde", async () => {
      const vardering = await modell().hamtaVardering(okartlagt);
      expect(vardering?.schablonBasis).toMatch(/inte att koppla till ett specifikt område/i);
    });
  });

  describe("postnummer utanför Stockholm (prefix 999 finns inte i tabellen)", () => {
    const utanforStockholm: Prisdataforfragan = { ...forfragan, postnummer: "99999" };

    it("returnerar ingen värdering", async () => {
      expect(await modell().hamtaVardering(utanforStockholm)).toBeNull();
    });

    it("producerar inga figurer alls för den här förfrågan", async () => {
      const kalla = modell();
      const vardering = await kalla.hamtaVardering(utanforStockholm);
      const forsaljningar = await kalla.hamtaForsaljningarIForeningen(utanforStockholm);
      const median = await kalla.hamtaOmradeMedian(utanforStockholm);
      expect(vardering).toBeNull();
      expect(forsaljningar).toEqual([]);
      expect(median).toBeNull();
    });
  });

  describe("tomt postnummer (anonymiserad rapport)", () => {
    const tomtPostnummer: Prisdataforfragan = { ...forfragan, postnummer: "" };

    it("returnerar ingen värdering", async () => {
      expect(await modell().hamtaVardering(tomtPostnummer)).toBeNull();
    });
  });
});

describe("korBinfoVarderingsmodell", () => {
  it("returnerar null för ett postnummer utanför modellens räckvidd", () => {
    expect(korBinfoVarderingsmodell({ ...forfragan, postnummer: "99999" })).toBeNull();
  });

  it("returnerar null för ett tomt postnummer", () => {
    expect(korBinfoVarderingsmodell({ ...forfragan, postnummer: "" })).toBeNull();
  });

  it("returnerar resultat, budpremie och drivare för ett kartlagt postnummer", () => {
    const underlag = korBinfoVarderingsmodell(forfragan);
    expect(underlag).not.toBeNull();
    expect(underlag?.resultat.omrade).toBe("Södermalm");
    expect(underlag?.budpremie.omrade === "Södermalm" || underlag?.budpremie.omrade === null).toBe(
      true,
    );
    expect(Array.isArray(underlag?.drivare)).toBe(true);
  });

  it("faller tillbaka till omrade: null för ett okartlagt men känt Stockholmsprefix", () => {
    const underlag = korBinfoVarderingsmodell({ ...forfragan, postnummer: "12364" });
    expect(underlag).not.toBeNull();
    expect(underlag?.resultat.omrade).toBeNull();
    expect(underlag?.budpremie.omrade).toBeNull();
  });
});

describe("Prisdatakalla-gränssnittet", () => {
  it("uppfylls av samtliga implementationer, så de är utbytbara för anroparen", async () => {
    const kallor: Prisdatakalla[] = [
      new TomPrisdatakalla(),
      new DemoPrisdatakalla({ utgangspris: UTGANGSPRIS, boarea: forfragan.boarea }),
      new ModellPrisdatakalla(),
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

describe("konfidensUtanforStockholm", () => {
  it("ger låg konfidens", () => {
    expect(konfidensUtanforStockholm().niva).toBe("lag");
  });

  it("anger skälet på svenska och nämner Stockholms kommun ordagrant, för visning direkt för användaren", () => {
    const skal = konfidensUtanforStockholm().skal;
    expect(skal).toBeDefined();
    expect(skal?.length).toBeGreaterThan(0);
    expect(skal?.[0]).toMatch(/Stockholms kommun/);
  });
});
