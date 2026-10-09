import { describe, expect, it } from "vitest";
import { pdfHasNoTextLayer } from "./pdf";
import {
  klassificeraTextlager,
  SAKNAS_ANDEL_TOMMA_SIDOR,
  TOM_SIDA_TECKEN,
  TRASIGT_TEXTLAGER_GRANS,
} from "./textlager";

const NORMAL =
  "Årsavgift per kvm upplåten med bostadsrätt 1 006 kr. Föreningen har 49 bostadsrätter om totalt 2 690 kvm.";
// test_rapport.pdf's garbling: every glyph (and comma) its own token.
const GARBLAT = "Räntekänslighet ( % ) 7 , 3 6 7 , 4 3 8 , 0 0 -";

describe("klassificeraTextlager", () => {
  it("'saknas' när varje sida är tom", () => {
    expect(klassificeraTextlager(["", "", ""])).toBe("saknas");
  });

  it("'saknas' även när sidorna bara innehåller blanksteg", () => {
    expect(klassificeraTextlager(["  \n ", "\t"])).toBe("saknas");
  });

  it("'saknas' för en PDF utan sidor (samma regel som pdfHasNoTextLayer)", () => {
    expect(klassificeraTextlager([])).toBe("saknas");
  });

  it("'ok' när bara några sidor är tomma (en bilaga utan text)", () => {
    expect(klassificeraTextlager([NORMAL, "", NORMAL])).toBe("ok");
  });

  it("'ok' för normal text", () => {
    expect(klassificeraTextlager([NORMAL, NORMAL])).toBe("ok");
  });

  it("'trasigt' när nästan varje token är ett enda tecken", () => {
    expect(klassificeraTextlager([GARBLAT, GARBLAT])).toBe("trasigt");
  });

  it("gränsen är 0.6: strax under är 'ok', strax över är 'trasigt'", () => {
    // 6 av 10 tokens är enstaka tecken = exakt 0.6 -> inte över gränsen.
    const exakt = "a b c d e f ord ord ord ord";
    expect(TRASIGT_TEXTLAGER_GRANS).toBe(0.6);
    expect(klassificeraTextlager([exakt])).toBe("ok");
    const over = "a b c d e f g ord ord ord";
    expect(klassificeraTextlager([over])).toBe("trasigt");
  });

  describe("blandade dokument (>= 50 % tomma sidor = 'saknas')", () => {
    const tomma = (n: number) => Array.from({ length: n }, () => "");
    const text = (n: number) => Array.from({ length: n }, () => NORMAL);

    it("konstanterna: en sida under 20 tecken är tom, gränsen är hälften", () => {
      expect(TOM_SIDA_TECKEN).toBe(20);
      expect(SAKNAS_ANDEL_TOMMA_SIDOR).toBe(0.5);
    });

    it("1 textsida + 9 tomma → 'saknas' (en skanning med textomslag)", () => {
      expect(klassificeraTextlager([...text(1), ...tomma(9)])).toBe("saknas");
    });

    it("9 textsidor + 1 tom → 'ok'", () => {
      expect(klassificeraTextlager([...text(9), ...tomma(1)])).toBe("ok");
    });

    it("exakt hälften tomma → 'saknas'; strax under hälften → 'ok'", () => {
      expect(klassificeraTextlager([...text(5), ...tomma(5)])).toBe("saknas");
      expect(klassificeraTextlager([...text(6), ...tomma(5)])).toBe("ok");
      expect(klassificeraTextlager([...text(1), ...tomma(1)])).toBe("saknas");
    });

    it("en sida med bara ett sidnummer eller en stämpel (< 20 tecken) räknas som tom", () => {
      expect(klassificeraTextlager([NORMAL, "Sida 2 av 10", "3", "  7  \n"])).toBe("saknas");
      expect(klassificeraTextlager(["x".repeat(20), "x".repeat(20), "x".repeat(19)])).toBe("ok");
    });

    it("trasigt gäller bara när dokumentet inte är 'saknas'", () => {
      expect(klassificeraTextlager([GARBLAT, GARBLAT, ...tomma(1)])).toBe("trasigt");
      expect(klassificeraTextlager([GARBLAT, ...tomma(3)])).toBe("saknas");
    });
  });

  it("ett dokument som inte är 'saknas' passerar alltid runGroundings egen skannvakt (pdfHasNoTextLayer): 'saknas' når aldrig runGrounding", () => {
    const sidor = [NORMAL, "", "x", "  ", "Sida 2 av 9"];
    // Every prefix/suffix mix of text and empty pages.
    for (let text = 0; text <= 6; text++) {
      for (let tomt = 0; tomt <= 6; tomt++) {
        const dok = [
          ...Array.from({ length: text }, () => NORMAL),
          ...Array.from({ length: tomt }, () => ""),
        ];
        if (klassificeraTextlager(dok) !== "saknas") expect(pdfHasNoTextLayer(dok)).toBe(false);
      }
    }
    expect(klassificeraTextlager(sidor)).toBe("saknas");
  });
});
