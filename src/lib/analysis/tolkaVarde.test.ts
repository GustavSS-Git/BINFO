import { describe, expect, it } from "vitest";
import {
  harledSkuldfriaNyckeltal,
  parseTrycktVarde,
  rensaSkuldfriaKonfidensSkal,
  tolkaNyckeltal,
} from "./tolkaVarde";
import type { Figure, KeyFigure, KeyFigureId } from "@/types/analysis";

const NBSP = " ";
const NARROW_NBSP = " ";
const MINUS = "−";

describe("parseTrycktVarde", () => {
  describe("saknas — inget värde alls", () => {
    it.each(["", "-", "–", "—", MINUS, "  -  ", "  "])("%p tolkas som saknas", (raw) => {
      const r = parseTrycktVarde(raw);
      expect(r).toEqual({ saknas: true, tryckt: raw });
    });

    it("en ensam enhet utan siffra ('kr') tolkas som saknas", () => {
      expect(parseTrycktVarde("kr")).toEqual({ saknas: true, tryckt: "kr" });
    });

    it("'- kr' (bindestreck plus enhet) tolkas som saknas", () => {
      expect(parseTrycktVarde("- kr")).toEqual({ saknas: true, tryckt: "- kr" });
    });

    it("obegriplig text tolkas som saknas — gissar aldrig", () => {
      expect(parseTrycktVarde("uppgift saknas")).toEqual({
        saknas: true,
        tryckt: "uppgift saknas",
      });
    });
  });

  describe("tecken utan siffra", () => {
    it.each(["neg", "NEG", "Neg", "negativ", "Negativ", "NEGATIV", "neg."])(
      "%p tolkas som tecken negativ, värde null",
      (raw) => {
        expect(parseTrycktVarde(raw)).toEqual({ value: null, tecken: "negativ", tryckt: raw });
      },
    );

    it.each(["pos", "POS", "positiv", "Positiv"])(
      "%p tolkas som tecken positiv, värde null",
      (raw) => {
        expect(parseTrycktVarde(raw)).toEqual({ value: null, tecken: "positiv", tryckt: raw });
      },
    );
  });

  describe("negativa tal", () => {
    it("'(123)' tolkas som -123", () => {
      expect(parseTrycktVarde("(123)")).toEqual({ value: -123, tryckt: "(123)" });
    });

    it("'(1 234,5)' tolkas som -1234.5", () => {
      expect(parseTrycktVarde("(1 234,5)")).toEqual({ value: -1234.5, tryckt: "(1 234,5)" });
    });

    it("unicode-minus '−123' tolkas som -123", () => {
      const raw = `${MINUS}123`;
      expect(parseTrycktVarde(raw)).toEqual({ value: -123, tryckt: raw });
    });

    it("ASCII-bindestreck '-123' tolkas som -123", () => {
      expect(parseTrycktVarde("-123")).toEqual({ value: -123, tryckt: "-123" });
    });

    it("'-7,36' tolkas som -7.36", () => {
      expect(parseTrycktVarde("-7,36")).toEqual({ value: -7.36, tryckt: "-7,36" });
    });
  });

  describe("mellanslag som tusentalsavgränsare och kommadecimaler", () => {
    it("'1 234,5' (vanligt mellanslag) tolkas som 1234.5", () => {
      expect(parseTrycktVarde("1 234,5")).toEqual({ value: 1234.5, tryckt: "1 234,5" });
    });

    it("NBSP som tusentalsavgränsare tolkas som 1234.5", () => {
      const raw = `1${NBSP}234,5`;
      expect(parseTrycktVarde(raw)).toEqual({ value: 1234.5, tryckt: raw });
    });

    it("smal NBSP som tusentalsavgränsare tolkas som 1234.5", () => {
      const raw = `1${NARROW_NBSP}234,5`;
      expect(parseTrycktVarde(raw)).toEqual({ value: 1234.5, tryckt: raw });
    });

    it("'57 840 000' (flera avgränsare) tolkas som 57840000", () => {
      expect(parseTrycktVarde("57 840 000")).toEqual({ value: 57840000, tryckt: "57 840 000" });
    });

    it("'7,36' tolkas som 7.36", () => {
      expect(parseTrycktVarde("7,36")).toEqual({ value: 7.36, tryckt: "7,36" });
    });

    it("ett rent heltal utan avgränsare tolkas oförändrat", () => {
      expect(parseTrycktVarde("670")).toEqual({ value: 670, tryckt: "670" });
    });

    it("'0' tolkas som talet 0, inte som saknas", () => {
      expect(parseTrycktVarde("0")).toEqual({ value: 0, tryckt: "0" });
    });
  });

  describe("enheter som ska strippas", () => {
    it("'123 kr' tolkas som 123", () => {
      expect(parseTrycktVarde("123 kr")).toEqual({ value: 123, tryckt: "123 kr" });
    });

    it("'670 kr/m²' tolkas som 670", () => {
      expect(parseTrycktVarde("670 kr/m²")).toEqual({ value: 670, tryckt: "670 kr/m²" });
    });

    it("'670 kr/m2' (ASCII-variant) tolkas som 670", () => {
      expect(parseTrycktVarde("670 kr/m2")).toEqual({ value: 670, tryckt: "670 kr/m2" });
    });

    it("'9,2 %' tolkas som 9.2", () => {
      expect(parseTrycktVarde("9,2 %")).toEqual({ value: 9.2, tryckt: "9,2 %" });
    });

    it("'57 tkr' UTAN enhetTkr-flaggan tolkas som 57 — gissar aldrig ×1000 av ett ord i cellen", () => {
      expect(parseTrycktVarde("57 tkr")).toEqual({ value: 57, tryckt: "57 tkr" });
    });

    it("'57 tkr' MED enhetTkr-flaggan (satt av anroparen utifrån kolumnrubriken) tolkas som 57000", () => {
      expect(parseTrycktVarde("57 tkr", { enhetTkr: true })).toEqual({
        value: 57000,
        tryckt: "57 tkr",
      });
    });

    it("enhetTkr multiplicerar även ett tal utan ordet 'tkr' i cellen, när kolumnen är satt till tkr", () => {
      expect(parseTrycktVarde("57 840", { enhetTkr: true })).toEqual({
        value: 57840000,
        tryckt: "57 840",
      });
    });
  });
});

describe("tolkaNyckeltal", () => {
  const ALLA_NYCKELTAL_ID: KeyFigureId[] = [
    "arsavgift_per_m2_brf_yta",
    "arsavgift_andel_av_rorelseintakter",
    "skuldsattning_per_m2_totalyta",
    "skuldsattning_per_m2_brf_yta",
    "sparande_per_m2_totalyta",
    "rantekanslighet",
    "energikostnad_per_m2_totalyta",
  ];

  function nyckeltal(id: KeyFigureId, overrides: Partial<KeyFigure["figure"]> = {}): KeyFigure {
    return {
      id,
      label: id,
      figure: {
        value: 100,
        unit: "kr/m2",
        source: "arsredovisning",
        ref: { page: 4, excerpt: "Test" },
        ...overrides,
      },
      status: "okant",
      forklaring: "Test.",
    };
  }

  it("rör inte figurer utan tryckt", () => {
    const input = [nyckeltal("rantekanslighet")];
    const { keyFigures, avvikelser } = tolkaNyckeltal(input);
    expect(keyFigures).toEqual(input);
    expect(avvikelser).toEqual([]);
  });

  it("Volontären-fallet: 'neg' i tryckt vinner över modellens value, sparande blir null + tecken negativ", () => {
    const input = [
      nyckeltal("sparande_per_m2_totalyta", { value: -50, tryckt: "neg" }), // modellen gissade -50
    ];
    const { keyFigures, avvikelser } = tolkaNyckeltal(input);
    expect(keyFigures[0]!.figure.value).toBeNull();
    expect(keyFigures[0]!.figure.tecken).toBe("negativ");
    expect(keyFigures[0]!.figure.tryckt).toBe("neg");
    expect(avvikelser).toHaveLength(1);
    expect(avvikelser[0]).toContain("neg");
  });

  it("ingen avvikelse loggas när modellens value redan stämmer med det tolkade värdet", () => {
    const input = [nyckeltal("rantekanslighet", { value: -123, tryckt: "(123)" })];
    const { keyFigures, avvikelser } = tolkaNyckeltal(input);
    expect(keyFigures[0]!.figure.value).toBe(-123);
    expect(avvikelser).toEqual([]);
  });

  it("en hel rad i tryckt får inte skriva över modellens tal (storleksordning skiljer)", () => {
    // Volontären p.4: "Årsavgift kvm upplåten bostadsrätt, kr 283 311 404" — tre år på en rad.
    const input = [nyckeltal("arsavgift_per_m2_brf_yta", { value: 404, tryckt: "283 311 404" })];
    const { keyFigures, avvikelser } = tolkaNyckeltal(input);
    expect(keyFigures[0]!.figure.value).toBe(404);
    expect(avvikelser).toHaveLength(1);
    expect(avvikelser[0]).toContain("modellens tal behölls");
  });

  it("parentes-negativ rättar tecknet när beloppet är detsamma", () => {
    const input = [nyckeltal("sparande_per_m2_totalyta", { value: 123, tryckt: "(123)" })];
    const { keyFigures, avvikelser } = tolkaNyckeltal(input);
    expect(keyFigures[0]!.figure.value).toBe(-123);
    expect(avvikelser).toHaveLength(1);
  });

  it("tryckt tal används när modellen inte angav något tal", () => {
    const input = [
      nyckeltal("rantekanslighet", { value: null, source: "berakning", tryckt: "7,36" }),
    ];
    const { keyFigures } = tolkaNyckeltal(input);
    expect(keyFigures[0]!.figure.value).toBe(7.36);
  });

  it("tryckt en saknad-token ger value null utan tecken", () => {
    const input = [nyckeltal("energikostnad_per_m2_totalyta", { value: 999, tryckt: "-" })];
    const { keyFigures, avvikelser } = tolkaNyckeltal(input);
    expect(keyFigures[0]!.figure.value).toBeNull();
    expect(keyFigures[0]!.figure.tecken).toBeUndefined();
    expect(avvikelser).toHaveLength(1);
  });

  it("muterar inte indata", () => {
    const input = [nyckeltal("sparande_per_m2_totalyta", { value: 5, tryckt: "neg" })];
    const kopia = structuredClone(input);
    tolkaNyckeltal(input);
    expect(input).toEqual(kopia);
  });

  it("hanterar alla sju nyckeltal blandat, med och utan tryckt", () => {
    const input = ALLA_NYCKELTAL_ID.map((id, i) =>
      i % 2 === 0 ? nyckeltal(id) : nyckeltal(id, { value: null, tryckt: "neg" }),
    );
    const { keyFigures } = tolkaNyckeltal(input);
    expect(keyFigures).toHaveLength(7);
    keyFigures.forEach((kf, i) => {
      if (i % 2 === 0) {
        expect(kf.figure.tryckt).toBeUndefined();
      } else {
        expect(kf.figure.tecken).toBe("negativ");
      }
    });
  });
});

describe("harledSkuldfriaNyckeltal", () => {
  const SKULDFRI_REF = { page: 7, excerpt: "Föreningen är skuldfri och ekonomin är fortsatt god." };
  const TOTAL_SKULD_0: Figure = {
    value: 0,
    unit: "kr",
    source: "arsredovisning",
    ref: SKULDFRI_REF,
  };

  function saknatNyckeltal(id: KeyFigureId, unit: KeyFigure["figure"]["unit"]): KeyFigure {
    return {
      id,
      label: id,
      figure: { value: null, unit, source: "berakning" },
      status: "okant",
      forklaring: "Test.",
    };
  }

  it("härleder 0 med källa 'berakning' och samma ref som totalSkuld, för alla tre skuldrelaterade nyckeltal", () => {
    const input = [
      saknatNyckeltal("rantekanslighet", "procent"),
      saknatNyckeltal("skuldsattning_per_m2_totalyta", "kr/m2"),
      saknatNyckeltal("skuldsattning_per_m2_brf_yta", "kr/m2"),
    ];
    const resultat = harledSkuldfriaNyckeltal(TOTAL_SKULD_0, input);

    for (const kf of resultat) {
      expect(kf.figure.value).toBe(0);
      expect(kf.figure.source).toBe("berakning");
      expect(kf.figure.ref).toEqual(SKULDFRI_REF);
      // Enheten är den ursprungliga för respektive nyckeltal, inte totalSkuld:s ("kr").
      expect(kf.figure.unit).not.toBe("kr");
    }
  });

  it("härleder inget när totalSkuld = 0 saknar citat — ingen källa, ingen härledd siffra", () => {
    const utanRef: Figure = { value: 0, unit: "kr", source: "arsredovisning" };
    const input = [saknatNyckeltal("rantekanslighet", "procent")];
    const resultat = harledSkuldfriaNyckeltal(utanRef, input);
    expect(resultat[0]!.figure.value).toBeNull();
  });

  it("härleder inget när ett annat skuldnyckeltal är tryckt och > 0 — rapporten motsäger 'skuldfri'", () => {
    const tryckt: KeyFigure = {
      ...saknatNyckeltal("skuldsattning_per_m2_brf_yta", "kr/m2"),
      figure: {
        value: 4200,
        unit: "kr/m2",
        source: "arsredovisning",
        ref: { page: 6, excerpt: "4 200" },
      },
    };
    const input = [saknatNyckeltal("rantekanslighet", "procent"), tryckt];
    const resultat = harledSkuldfriaNyckeltal(TOTAL_SKULD_0, input);
    expect(resultat[0]!.figure.value).toBeNull();
    expect(resultat[1]!.figure.value).toBe(4200);
  });

  it("Göken-fallet end-to-end: tryckt '-' tolkas som saknat och blir sedan 0 via en citerad skuldfri totalSkuld", () => {
    const streck: KeyFigure = {
      ...saknatNyckeltal("rantekanslighet", "procent"),
      figure: { value: null, unit: "procent", source: "berakning", tryckt: "-" },
    };
    const { keyFigures: tolkade } = tolkaNyckeltal([streck]);
    expect(tolkade[0]!.figure.value).toBeNull();

    const resultat = harledSkuldfriaNyckeltal(TOTAL_SKULD_0, tolkade);
    expect(resultat[0]!.figure.value).toBe(0);
    expect(resultat[0]!.figure.source).toBe("berakning");
    expect(resultat[0]!.figure.ref).toEqual(SKULDFRI_REF);
  });

  it("rör inte ett nyckeltal utanför den härledda listan (t.ex. sparande)", () => {
    const input = [saknatNyckeltal("sparande_per_m2_totalyta", "kr/m2")];
    const resultat = harledSkuldfriaNyckeltal(TOTAL_SKULD_0, input);
    expect(resultat[0]!.figure.value).toBeNull();
  });

  it("överskriver ALDRIG ett redan tryckt (icke-null) värde", () => {
    const input: KeyFigure[] = [
      {
        id: "rantekanslighet",
        label: "Räntekänslighet",
        figure: {
          value: 3.5,
          unit: "procent",
          source: "arsredovisning",
          ref: { page: 8, excerpt: "Räntekänslighet 3,5 %" },
        },
        status: "okant",
        forklaring: "Test.",
      },
    ];
    const resultat = harledSkuldfriaNyckeltal(TOTAL_SKULD_0, input);
    expect(resultat[0]!.figure.value).toBe(3.5);
    expect(resultat[0]!.figure.source).toBe("arsredovisning");
  });

  it("härleder inget när totalSkuld saknas (undefined)", () => {
    const input = [saknatNyckeltal("rantekanslighet", "procent")];
    const resultat = harledSkuldfriaNyckeltal(undefined, input);
    expect(resultat[0]!.figure.value).toBeNull();
  });

  it("härleder inget när totalSkuld är skild från exakt 0", () => {
    const totalSkuldPositiv: Figure = {
      value: 43_200_000,
      unit: "kr",
      source: "arsredovisning",
      ref: { page: 12, excerpt: "Summa 43 200 000" },
    };
    const input = [saknatNyckeltal("rantekanslighet", "procent")];
    const resultat = harledSkuldfriaNyckeltal(totalSkuldPositiv, input);
    expect(resultat[0]!.figure.value).toBeNull();
  });

  it("härleder inget när totalSkuld:s eget värde är null", () => {
    const totalSkuldOkand: Figure = { value: null, unit: "kr", source: "berakning" };
    const input = [saknatNyckeltal("rantekanslighet", "procent")];
    const resultat = harledSkuldfriaNyckeltal(totalSkuldOkand, input);
    expect(resultat[0]!.figure.value).toBeNull();
  });

  it("muterar inte indata", () => {
    const input = [saknatNyckeltal("rantekanslighet", "procent")];
    const kopia = structuredClone(input);
    harledSkuldfriaNyckeltal(TOTAL_SKULD_0, input);
    expect(input).toEqual(kopia);
  });
});

describe("rensaSkuldfriaKonfidensSkal", () => {
  const GOKEN_SKAL =
    "Flera nyckeltal (skuldsättning, räntekänslighet) saknas i flerårsöversikten och anges som '-' i rapporten.";

  it("tar bort modellens 'saknas'-skäl om skuldnyckeltalen och återställer 'hog' när inget annat skäl finns kvar (Göken)", () => {
    const resultat = rensaSkuldfriaKonfidensSkal({ niva: "medel", skal: [GOKEN_SKAL] }, true);
    expect(resultat).toEqual({ niva: "hog" });
  });

  it("behåller nivån och de andra skälen när något annat också sänkte konfidensen", () => {
    const annat = "Texten på sida 4 var svårläst.";
    const resultat = rensaSkuldfriaKonfidensSkal(
      { niva: "medel", skal: [GOKEN_SKAL, annat] },
      true,
    );
    expect(resultat).toEqual({ niva: "medel", skal: [annat] });
  });

  it("rör ingenting när skuldfri-härledningen inte slog till", () => {
    const konfidens = { niva: "medel" as const, skal: [GOKEN_SKAL] };
    expect(rensaSkuldfriaKonfidensSkal(konfidens, false)).toEqual(konfidens);
  });

  it("rör ingenting när inget skäl handlar om skuldnyckeltalen", () => {
    const konfidens = { niva: "lag" as const, skal: ["Skannade sidor."] };
    expect(rensaSkuldfriaKonfidensSkal(konfidens, true)).toEqual(konfidens);
  });
});
