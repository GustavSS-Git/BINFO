import { describe, expect, it } from "vitest";
import {
  filfelVidSkick,
  parseForeningSlug,
  buildPropertyInput,
  formateraFilstorlek,
  harValideringsfel,
  kontrolleraPdfFil,
  mapPropertyKind,
  MAX_PDF_STORLEK_BYTES,
  parsePositivtTal,
  parseVaning,
  parseValfrittHeltal,
  validateraAnalyseraForm,
  type AnalyseraFormFields,
} from "./analyseraForm";
import type { AnnonsKalla, FeeInclusion } from "@/types/analysis";

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

describe("parseVaning", () => {
  it("godtar bottenvåning (0) och positiva heltal", () => {
    expect(parseVaning("0")).toBe(0);
    expect(parseVaning("4")).toBe(4);
    expect(parseVaning("2,5")).toBe(2);
  });
  it("avvisar tomt, text och negativa tal", () => {
    expect(parseVaning("")).toBeNull();
    expect(parseVaning("abc")).toBeNull();
    expect(parseVaning("-1")).toBeNull();
  });
});

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
    expect(fel.boarea).not.toBeNull();
    expect(fel.vaning).not.toBeNull();
    expect(fel.manadsavgift).not.toBeNull();
    expect(fel.antalRum).not.toBeNull();
    expect(fel.adress).not.toBeNull();
    expect(fel.postnummer).not.toBeNull();
    expect(fel.ort).not.toBeNull();
  });

  it("utgångspris är valfritt: tomt eller blanksteg är giltigt", () => {
    for (const tomt of ["", "   "]) {
      expect(validateraAnalyseraForm(tomtFormulär({ utgangspris: tomt })).utgangspris).toBeNull();
    }
  });

  it("ett angivet utgångspris måste vara ett positivt tal", () => {
    for (const fel of ["0", "abc", "-5"]) {
      expect(validateraAnalyseraForm(tomtFormulär({ utgangspris: fel })).utgangspris).toBe(
        "Ange ett giltigt utgångspris eller lämna fältet tomt.",
      );
    }
    expect(
      validateraAnalyseraForm(tomtFormulär({ utgangspris: "4 950 000" })).utgangspris,
    ).toBeNull();
  });

  it("kräver ett svenskt postnummer (fem siffror, valfritt mellanslag)", () => {
    for (const ok of ["116 25", "11625", " 116 25 "]) {
      expect(validateraAnalyseraForm(tomtFormulär({ postnummer: ok })).postnummer).toBeNull();
    }
    for (const fel of ["abc", "1", "999999999", "116-25", "1162"]) {
      expect(validateraAnalyseraForm(tomtFormulär({ postnummer: fel })).postnummer).toBe(
        "Ange ett postnummer med fem siffror, t.ex. 116 25.",
      );
    }
  });

  it("godkänner ett komplett, giltigt formulär", () => {
    const fel = validateraAnalyseraForm(
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
      }),
    );
    expect(harValideringsfel(fel)).toBe(false);
  });

  it("blockerar inte formuläret på dolda andelstal eller organisationsnummer", () => {
    const fel = validateraAnalyseraForm(
      tomtFormulär({
        utgangspris: "4 950 000",
        boarea: "58",
        vaning: "4",
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

  it("kräver våning som obligatoriskt; 0 (bottenvåning) är ett giltigt svar", () => {
    expect(validateraAnalyseraForm(tomtFormulär()).vaning).toBe("Ange våning.");
    expect(validateraAnalyseraForm(tomtFormulär({ vaning: "0" })).vaning).toBeNull();
    expect(validateraAnalyseraForm(tomtFormulär({ vaning: "-1" })).vaning).toBe("Ange våning.");
    expect(validateraAnalyseraForm(tomtFormulär({ vaning: "bv" })).vaning).toBe("Ange våning.");
    expect(validateraAnalyseraForm(tomtFormulär({ vaning: "4" })).vaning).toBeNull();
  });

  it("lämnar byggår utanför felobjektet — det är fortfarande valfritt, våning inte", () => {
    const fel = validateraAnalyseraForm(tomtFormulär());
    expect("byggar" in fel).toBe(false);
    expect("vaning" in fel).toBe(true);
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

  it("utelämnar utgangspris helt när fältet är tomt, och avrundar annars", () => {
    const bas = {
      boarea: "58",
      manadsavgift: "3240",
      antalRum: "3",
      adress: "Kapellgränd 12",
      postnummer: "116 25",
      ort: "Stockholm",
    };
    const utan = buildPropertyInput("brf", tomtFormulär({ ...bas, utgangspris: "  " }), uppgifter);
    expect("utgangspris" in utan).toBe(false);
    const med = buildPropertyInput(
      "brf",
      tomtFormulär({ ...bas, utgangspris: "4 950 000,4" }),
      uppgifter,
    );
    expect(med.utgangspris).toBe(4_950_000);
  });

  it("tar med kalla när den ges och utelämnar nyckeln helt annars", () => {
    const form = tomtFormulär({
      boarea: "58",
      manadsavgift: "3240",
      antalRum: "3",
      adress: "Kapellgränd 12",
      postnummer: "116 25",
      ort: "Stockholm",
    });
    const kalla: AnnonsKalla = {
      typ: "booli",
      url: "https://www.booli.se/annons/123",
      forening: "Brf Exempel",
      hamtad: "2026-10-24T10:00:00.000Z",
      oandradeFalt: ["boarea", "adress"],
    };
    const med = buildPropertyInput("brf", form, uppgifter, kalla);
    expect(med.kalla).toEqual(kalla);
    const utan = buildPropertyInput("brf", form, uppgifter);
    expect("kalla" in utan).toBe(false);
    // Samma övriga innehåll oavsett kalla.
    const { kalla: _bort, ...resten } = med;
    expect(resten).toEqual(utan);
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

describe("parseForeningSlug", () => {
  it("accepterar en registerslug", () => {
    expect(parseForeningSlug("brf-pontonjaren-3-716420-0599")).toBe(
      "brf-pontonjaren-3-716420-0599",
    );
  });

  it("kastar aldrig: skräp blir undefined", () => {
    for (const v of [
      undefined,
      null,
      42,
      {},
      [],
      "",
      "  ",
      "Brf Åhlén",
      "a/b",
      "../x",
      "x".repeat(300),
    ]) {
      expect(parseForeningSlug(v)).toBeUndefined();
    }
  });
});
