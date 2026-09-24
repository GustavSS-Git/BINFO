import { describe, expect, it } from "vitest";
import { normaliseraPostnummer, omradeForPostnummer } from "./postnummer";
import { postnummerOmrade } from "./data";

describe("normaliseraPostnummer", () => {
  it("strips the conventional space", () => {
    expect(normaliseraPostnummer("115 32")).toBe("11532");
  });

  it("leaves an already-compact postnummer untouched", () => {
    expect(normaliseraPostnummer("11532")).toBe("11532");
  });

  it("strips any whitespace, not just one space", () => {
    expect(normaliseraPostnummer(" 115  32 ")).toBe("11532");
  });
});

describe("omradeForPostnummer", () => {
  it("maps a known postnummer to its omrade", () => {
    // From data/derived/postnummer_omrade.csv.
    expect(omradeForPostnummer("10004", postnummerOmrade)).toBe("Kungsholmen");
  });

  it("normalises a spaced postnummer before lookup", () => {
    expect(omradeForPostnummer("10 004", postnummerOmrade)).toBe("Kungsholmen");
  });

  it("returns null for an unmapped postnummer", () => {
    // 12364 is one of the two documented unmapped postcodes (see
    // ml/artifacts/valuation-v2/MODEL_CARD.md's Limitations section).
    expect(omradeForPostnummer("12364", postnummerOmrade)).toBeNull();
  });

  it("returns null for a postnummer that plainly isn't real", () => {
    expect(omradeForPostnummer("00000", postnummerOmrade)).toBeNull();
  });
});
