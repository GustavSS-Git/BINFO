import { describe, expect, it } from "vitest";
import { harKantPrefix, normaliseraPostnummer, omradeForPostnummer } from "./postnummer";
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

describe("harKantPrefix", () => {
  it("kräver exakt fem siffror — felformaterade postnummer räknas aldrig som Stockholm", () => {
    for (const fel of ["115-32", "115a32", "115", "11532extra", "1153", "abcde"]) {
      expect(harKantPrefix(fel, postnummerOmrade)).toBe(false);
    }
    expect(harKantPrefix("115 32", postnummerOmrade)).toBe(true);
  });

  it("returns true for a precisely mapped postnummer's own prefix", () => {
    expect(harKantPrefix("10004", postnummerOmrade)).toBe(true);
  });

  it("returns true for an unmapped postnummer whose 3-digit prefix is shared by other mapped codes", () => {
    // 12364 is unmapped (see omradeForPostnummer's test above), but other
    // 123xx codes (e.g. 12322 -> Farsta-Vantör) are mapped.
    expect(omradeForPostnummer("12364", postnummerOmrade)).toBeNull();
    expect(harKantPrefix("12364", postnummerOmrade)).toBe(true);
  });

  it("normalises a spaced postnummer before checking the prefix", () => {
    expect(harKantPrefix("123 64", postnummerOmrade)).toBe(true);
  });

  it("returns false for a prefix that occurs nowhere in the map", () => {
    // Verified programmatically against the actual mapping table, not
    // assumed from postcode geography: no key in postnummerOmrade starts
    // with "999".
    expect(Object.keys(postnummerOmrade).some((k) => k.startsWith("999"))).toBe(false);
    expect(harKantPrefix("99999", postnummerOmrade)).toBe(false);
  });

  it("returns false for an empty postnummer", () => {
    expect(harKantPrefix("", postnummerOmrade)).toBe(false);
  });

  it("returns false for a postnummer shorter than 3 digits", () => {
    expect(harKantPrefix("12", postnummerOmrade)).toBe(false);
  });
});
