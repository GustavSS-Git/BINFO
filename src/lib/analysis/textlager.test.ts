import { describe, expect, it } from "vitest";
import { klassificeraTextlager, TRASIGT_TEXTLAGER_GRANS } from "./textlager";

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
});
