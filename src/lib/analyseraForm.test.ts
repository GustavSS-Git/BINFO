import { describe, expect, it } from "vitest";
import {
  filfelVidSkick,
  buildPropertyInput,
  formateraFilstorlek,
  harValideringsfel,
  kontrolleraPdfFil,
  mapPropertyKind,
  MAX_PDF_STORLEK_BYTES,
  parsePositivtTal,
  parseValfrittHeltal,
  validateraAnalyseraForm,
  type AnalyseraFormFields,
} from "./analyseraForm";
import type { FeeInclusion } from "@/types/analysis";

function tomtFormulär(overrides: Partial<AnalyseraFormFields> = {}): AnalyseraFormFields {
  return {
    utgangspris: "",
    boarea: "",
    vaning: "",
    manadsavgift: "",
    andelstal: "",
    organisationsnummer: "",
    adress: "",
    postnummer: "",
    ort: "",
    antalRum: "",
    byggar: "",
    ...overrides,
  };
}

function inclusion(overrides: Partial<FeeInclusion> = {}): FeeInclusion {
  return { varme: "nej", vatten: "nej", el: "nej", bredband: "nej", tv: "nej", ...overrides };
}

// ---------------------------------------------------------------------------
// parsePositivtTal
// ---------------------------------------------------------------------------

describe("parsePositivtTal", () => {
  it("tolkar ett enkelt heltal", () => {
    expect(parsePositivtTal("3240")).toBe(3240);
  });

  it("tar bort mellanslag som tusentalsavgränsare", () => {
    expect(parsePositivtTal("4 950 000")).toBe(4_950_000);
  });

  it("tar bort icke-brytande mellanslag (t.ex. inklistrat från ett annat verktyg)", () => {
    expect(parsePositivtTal("4 950 000")).toBe(4_950_000);
  });

  it("tolkar komma som decimaltecken", () => {
    expect(parsePositivtTal("2,1")).toBe(2.1);
  });

  it("tolkar punkt som decimaltecken", () => {
    expect(parsePositivtTal("58.5")).toBe(58.5);
  });

  it("returnerar null för en tom sträng", () => {
    expect(parsePositivtTal("")).toBeNull();
  });

  it("returnerar null för enbart mellanslag", () => {
    expect(parsePositivtTal("   ")).toBeNull();
  });

  it("returnerar null för icke-numerisk text", () => {
    expect(parsePositivtTal("abc")).toBeNull();
  });

  it("returnerar null för noll", () => {
    expect(parsePositivtTal("0")).toBeNull();
  });

  it("returnerar null för ett negativt tal", () => {
    expect(parsePositivtTal("-5")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseValfrittHeltal
// ---------------------------------------------------------------------------

describe("parseValfrittHeltal", () => {
  it("returnerar undefined för en tom sträng", () => {
    expect(parseValfrittHeltal("")).toBeUndefined();
  });

  it("returnerar undefined för enbart mellanslag", () => {
    expect(parseValfrittHeltal("   ")).toBeUndefined();
  });

  it("tolkar ett giltigt heltal", () => {
    expect(parseValfrittHeltal("4")).toBe(4);
  });

  it("trunkerar ett decimaltal", () => {
    expect(parseValfrittHeltal("4.7")).toBe(4);
  });

  it("returnerar undefined för ogiltig text i stället för att blockera formuläret", () => {
    expect(parseValfrittHeltal("okänt")).toBeUndefined();
  });

  it("tolkar ett byggår", () => {
    expect(parseValfrittHeltal("1931")).toBe(1931);
  });
});

// ---------------------------------------------------------------------------
// mapPropertyKind
// ---------------------------------------------------------------------------

describe("mapPropertyKind", () => {
  it("mappar brf till bostadsratt", () => {
    expect(mapPropertyKind("brf")).toBe("bostadsratt");
  });

  it("mappar hus till hus", () => {
    expect(mapPropertyKind("hus")).toBe("hus");
  });
});

// ---------------------------------------------------------------------------
// validateraAnalyseraForm / harValideringsfel
// ---------------------------------------------------------------------------

describe("validateraAnalyseraForm", () => {
  it("flaggar alla obligatoriska fält som fel på ett tomt formulär", () => {
    const fel = validateraAnalyseraForm(tomtFormulär());
    expect(harValideringsfel(fel)).toBe(true);
    expect(fel.utgangspris).not.toBeNull();
    expect(fel.boarea).not.toBeNull();
    expect(fel.manadsavgift).not.toBeNull();
    expect(fel.antalRum).not.toBeNull();
    expect(fel.adress).not.toBeNull();
    expect(fel.postnummer).not.toBeNull();
    expect(fel.ort).not.toBeNull();
  });

  it("kräver att utgångspris är ett positivt tal, inte bara icke-tomt", () => {
    const fel = validateraAnalyseraForm(tomtFormulär({ utgangspris: "0" }));
    expect(fel.utgangspris).not.toBeNull();
  });

  it("godkänner ett komplett, giltigt formulär", () => {
    const fel = validateraAnalyseraForm(
      tomtFormulär({
        utgangspris: "4 950 000",
        boarea: "58",
        manadsavgift: "3 240",
        andelstal: "2,1",
        antalRum: "3",
        organisationsnummer: "769612-3456",
        adress: "Kapellgränd 12",
        postnummer: "116 25",
        ort: "Stockholm",
      }),
    );
    expect(harValideringsfel(fel)).toBe(false);
  });

  it("blockerar inte formuläret på dolda andelstal eller organisationsnummer", () => {
    const fel = validateraAnalyseraForm(
      tomtFormulär({
        utgangspris: "4 950 000",
        boarea: "58",
        manadsavgift: "3 240",
        antalRum: "3",
        adress: "Kapellgränd 12",
        postnummer: "116 25",
        ort: "Stockholm",
      }),
    );
    expect(harValideringsfel(fel)).toBe(false);
    expect("andelstal" in fel).toBe(false);
    expect("organisationsnummer" in fel).toBe(false);
  });

  it("lämnar vaning/byggar utanför felobjektet — de är valfria", () => {
    const fel = validateraAnalyseraForm(tomtFormulär());
    expect("vaning" in fel).toBe(false);
    expect("byggar" in fel).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildPropertyInput
// ---------------------------------------------------------------------------

describe("buildPropertyInput", () => {
  const uppgifter = {
    hiss: "okant" as const,
    balkong: "ja" as const,
    avgiftInkluderar: inclusion({ varme: "ja" }),
    antalPersoner: 2,
  };

  it("mappar ett komplett formulär till PropertyInput, inklusive vaning/byggar", () => {
    const input = buildPropertyInput(
      "brf",
      tomtFormulär({
        utgangspris: "4 950 000",
        boarea: "58",
        vaning: "4",
        manadsavgift: "3 240",
        andelstal: "2,1",
        antalRum: "3",
        organisationsnummer: "769612-3456",
        adress: "Kapellgränd 12",
        postnummer: "116 25",
        ort: "Stockholm",
        byggar: "1931",
      }),
      uppgifter,
    );

    expect(input).toEqual({
      kind: "bostadsratt",
      utgangspris: 4_950_000,
      boarea: 58,
      antalRum: 3,
      manadsavgift: 3_240,
      andelstal: 0,
      orgnr: "",
      adress: "Kapellgränd 12",
      postnummer: "116 25",
      ort: "Stockholm",
      vaning: 4,
      byggar: 1931,
      hiss: "okant",
      balkong: "ja",
      avgiftInkluderar: inclusion({ varme: "ja" }),
      antalPersoner: 2,
    });
  });

  it("mappar hus till PropertyKind hus", () => {
    const input = buildPropertyInput(
      "hus",
      tomtFormulär({
        utgangspris: "1",
        boarea: "1",
        manadsavgift: "1",
        andelstal: "1",
        antalRum: "1",
        organisationsnummer: "769612-3456",
        adress: "a",
        postnummer: "a",
        ort: "a",
      }),
      uppgifter,
    );
    expect(input.kind).toBe("hus");
  });

  it("utelämnar vaning och byggar helt när de inte fylls i — inte som undefined-nycklar", () => {
    const input = buildPropertyInput(
      "brf",
      tomtFormulär({
        utgangspris: "4950000",
        boarea: "58",
        manadsavgift: "3240",
        andelstal: "2.1",
        antalRum: "3",
        organisationsnummer: "769612-3456",
        adress: "Kapellgränd 12",
        postnummer: "116 25",
        ort: "Stockholm",
      }),
      uppgifter,
    );

    expect("vaning" in input).toBe(false);
    expect("byggar" in input).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// kontrolleraPdfFil
// ---------------------------------------------------------------------------

function fakeFile(opts: { name: string; type: string; size: number }): File {
  return new File([new Uint8Array(opts.size)], opts.name, { type: opts.type });
}

describe("kontrolleraPdfFil", () => {
  it("kräver att en fil är vald", () => {
    expect(kontrolleraPdfFil(null)).not.toBeNull();
  });

  it("godkänner en PDF med korrekt MIME-typ", () => {
    const file = fakeFile({ name: "arsredovisning.pdf", type: "application/pdf", size: 1000 });
    expect(kontrolleraPdfFil(file)).toBeNull();
  });

  it("godkänner en PDF identifierad enbart via filändelsen (tom MIME-typ)", () => {
    const file = fakeFile({ name: "arsredovisning.pdf", type: "", size: 1000 });
    expect(kontrolleraPdfFil(file)).toBeNull();
  });

  it("avvisar en fil som varken har PDF-typ eller PDF-ändelse", () => {
    const file = fakeFile({ name: "bild.png", type: "image/png", size: 1000 });
    expect(kontrolleraPdfFil(file)).not.toBeNull();
  });

  it("avvisar en fil som är större än 25 MB", () => {
    const file = fakeFile({
      name: "stor.pdf",
      type: "application/pdf",
      size: MAX_PDF_STORLEK_BYTES + 1,
    });
    expect(kontrolleraPdfFil(file)).not.toBeNull();
  });

  it("godkänner en fil på exakt gränsen", () => {
    const file = fakeFile({
      name: "grans.pdf",
      type: "application/pdf",
      size: MAX_PDF_STORLEK_BYTES,
    });
    expect(kontrolleraPdfFil(file)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// formateraFilstorlek
// ---------------------------------------------------------------------------

describe("filfelVidSkick", () => {
  it("behåller det specifika skälet när en vald fil avvisades (fil är då null)", () => {
    expect(filfelVidSkick(null, "Filen måste vara en PDF.")).toBe("Filen måste vara en PDF.");
    expect(filfelVidSkick(null, "Filen är för stor. Max 25 MB.")).toBe(
      "Filen är för stor. Max 25 MB.",
    );
  });

  it("säger 'välj en fil' när ingen fil alls har valts", () => {
    expect(filfelVidSkick(null, null)).toBe("Välj en fil att ladda upp.");
  });

  it("kontrollerar en vald fil på nytt", () => {
    const pdf = new File(["%PDF"], "a.pdf", { type: "application/pdf" });
    expect(filfelVidSkick(pdf, null)).toBeNull();
  });
});

describe("formateraFilstorlek", () => {
  it("formaterar megabyte med kommatecken som decimaltecken", () => {
    expect(formateraFilstorlek(1_258_291)).toBe("1,2 MB");
  });

  it("formaterar en hel megabyte", () => {
    expect(formateraFilstorlek(1024 * 1024)).toBe("1,0 MB");
  });
});
