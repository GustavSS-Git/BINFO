import { describe, expect, it } from "vitest";
import { parseTrycktVarde, tolkaNyckeltal } from "./tolkaVarde";
import type { KeyFigure, KeyFigureId } from "@/types/analysis";

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
