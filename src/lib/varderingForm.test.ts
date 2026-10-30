import { describe, expect, it } from "vitest";
import {
  TOM_VARDERING_FORM,
  buildPrisInput,
  harVarderingsfel,
  parseAnalyseraPrefill,
  tillVarderingForm,
  validateraVarderingForm,
  type VarderingFormFields,
} from "./varderingForm";
import type { AnalyseraFormFields } from "./analyseraForm";

function form(overrides: Partial<VarderingFormFields> = {}): VarderingFormFields {
  return {
    ...TOM_VARDERING_FORM,
    adress: "Kapellgränd 12",
    byggar: "1931",
    boarea: "58",
    antalRum: "3",
    manadsavgift: "3 240",
    postnummer: "116 25",
    vaning: "4",
    ...overrides,
  };
}

const uppgifter = { hiss: "okant", balkong: "ja" } as const;

describe("validateraVarderingForm", () => {
  it("godkänner ett komplett formulär utan utgångspris", () => {
    expect(harVarderingsfel(validateraVarderingForm(form()))).toBe(false);
  });

  it("kräver adress, byggår, boarea, antal rum, månadsavgift, postnummer och våning", () => {
    const fel = validateraVarderingForm(TOM_VARDERING_FORM);
    expect(fel).toEqual({
      adress: "Ange adress.",
      byggar: "Ange byggår, t.ex. 1965.",
      utgangspris: null,
      boarea: "Ange en giltig boarea.",
      antalRum: "Ange antal rum.",
      manadsavgift: "Ange en giltig månadsavgift.",
      postnummer: "Ange postnummer.",
      vaning: "Ange våning.",
    });
    expect(harVarderingsfel(fel)).toBe(true);
  });

  it("tolkar svenska tal: tusentalsmellanrum och decimalkomma", () => {
    const fel = validateraVarderingForm(
      form({ boarea: "58,5", manadsavgift: "3 240", utgangspris: "4 950 000" }),
    );
    expect(harVarderingsfel(fel)).toBe(false);
  });

  it("avvisar noll, negativa och icke-numeriska värden", () => {
    expect(validateraVarderingForm(form({ boarea: "0" })).boarea).not.toBeNull();
    expect(validateraVarderingForm(form({ antalRum: "-2" })).antalRum).not.toBeNull();
    expect(validateraVarderingForm(form({ manadsavgift: "abc" })).manadsavgift).not.toBeNull();
  });

  it("använder samma postnummerregel som /analysera", () => {
    expect(validateraVarderingForm(form({ postnummer: "11625" })).postnummer).toBeNull();
    expect(validateraVarderingForm(form({ postnummer: "116 25" })).postnummer).toBeNull();
    expect(validateraVarderingForm(form({ postnummer: "1162" })).postnummer).toBe(
      "Ange ett postnummer med fem siffror, t.ex. 116 25.",
    );
  });

  it("utgångspris är valfritt men ett skräpvärde blockerar", () => {
    expect(validateraVarderingForm(form({ utgangspris: "" })).utgangspris).toBeNull();
    expect(validateraVarderingForm(form({ utgangspris: "   " })).utgangspris).toBeNull();
    expect(validateraVarderingForm(form({ utgangspris: "hej" })).utgangspris).toBe(
      "Ange ett giltigt utgångspris eller lämna fältet tomt.",
    );
    expect(validateraVarderingForm(form({ utgangspris: "0" })).utgangspris).not.toBeNull();
  });
});

describe("adress och byggår är obligatoriska i formuläret men inte i PrisInput", () => {
  it("byggår utanför 1600 till innevarande år och icke-fyrsiffriga avvisas", () => {
    for (const fel of ["", "65", "1599", "3000", "abc"]) {
      expect(validateraVarderingForm(form({ byggar: fel })).byggar).toBe(
        "Ange byggår, t.ex. 1965.",
      );
    }
  });
  it("tom adress avvisas, men inte för ett återställt utkast (utanAdress)", () => {
    expect(validateraVarderingForm(form({ adress: " " })).adress).toBe("Ange adress.");
    expect(validateraVarderingForm(form({ adress: "" }), { utanAdress: true }).adress).toBeNull();
  });
  it("buildPrisInput klarar fortfarande en gammal värdering utan byggår (omräkning)", () => {
    const input = buildPrisInput(form({ byggar: "" }), uppgifter);
    expect("byggar" in input).toBe(false);
    expect("adress" in input).toBe(false);
  });
});

describe("buildPrisInput", () => {
  it("bygger ett PrisInput utan utgångspris när det är tomt", () => {
    const input = buildPrisInput(form(), uppgifter);
    expect(input).toEqual({
      boarea: 58,
      antalRum: 3,
      manadsavgift: 3240,
      postnummer: "116 25",
      vaning: 4,
      byggar: 1931,
      hiss: "okant",
      balkong: "ja",
    });
    expect("utgangspris" in input).toBe(false);
  });

  it("tar med utgångspris (avrundat) och byggår när de är ifyllda", () => {
    const input = buildPrisInput(form({ utgangspris: "4 950 000", byggar: "1931" }), uppgifter);
    expect(input.utgangspris).toBe(4_950_000);
    expect(input.byggar).toBe(1931);
  });

  it("behåller okänt som okänt — aldrig nej", () => {
    const input = buildPrisInput(form(), { hiss: "okant", balkong: "okant" });
    expect(input.hiss).toBe("okant");
    expect(input.balkong).toBe("okant");
  });

  it("tolkar decimalkomma i boarea", () => {
    expect(buildPrisInput(form({ boarea: "58,5" }), uppgifter).boarea).toBe(58.5);
  });
});

describe("tillVarderingForm (steg 1 ur det gemensamma analysformuläret)", () => {
  const analysForm: AnalyseraFormFields = {
    utgangspris: "4 950 000",
    boarea: "58",
    vaning: "4",
    manadsavgift: "3 240",
    andelstal: "",
    organisationsnummer: "",
    adress: "Kapellgränd 12",
    postnummer: "116 25",
    antalRum: "3",
    byggar: "1931",
  };

  it("plockar ut exakt priskollens fält (adress ingår, ort finns inte)", () => {
    expect(tillVarderingForm(analysForm)).toEqual({
      adress: "Kapellgränd 12",
      utgangspris: "4 950 000",
      boarea: "58",
      antalRum: "3",
      manadsavgift: "3 240",
      postnummer: "116 25",
      vaning: "4",
      byggar: "1931",
    });
  });

  it("ger samma PrisInput som ett /vardering-formulär med samma text", () => {
    expect(buildPrisInput(tillVarderingForm(analysForm), uppgifter)).toEqual(
      buildPrisInput(form({ utgangspris: "4 950 000", byggar: "1931" }), uppgifter),
    );
  });

  it("steg 1 kräver adress (men ingen ort)", () => {
    const tomma = { ...analysForm, adress: "" };
    expect(validateraVarderingForm(tillVarderingForm(tomma)).adress).toBe("Ange adress.");
    expect(harVarderingsfel(validateraVarderingForm(tillVarderingForm(analysForm)))).toBe(false);
  });
});

describe("förifyllning av /analysera", () => {
  it("parseAnalyseraPrefill klarar både text och JSON-tolkade tal, och ignorerar skräp", () => {
    expect(
      parseAnalyseraPrefill({
        boarea: 58,
        manadsavgift: "3 240",
        postnummer: 11625,
        vaning: { x: 1 },
        byggar: "",
        okand: "x",
      }),
    ).toEqual({
      utgangspris: undefined,
      boarea: "58",
      antalRum: undefined,
      manadsavgift: "3 240",
      postnummer: "11625",
      vaning: undefined,
      byggar: undefined,
    });
  });
});
