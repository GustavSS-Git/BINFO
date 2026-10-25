/**
 * Postnummer help: the area lookup against the REAL valuation tables.
 */
import { describe, expect, it } from "vitest";
import { losTackning } from "@/lib/vardering/tackning";
import { postnummerInfo } from "./postnummer";

describe("postnummerInfo (real tables)", () => {
  it("a mapped Stockholm postnummer gives its area, with or without the space", () => {
    expect(postnummerInfo({ postnummer: "112 42" })).toEqual({
      status: "omrade",
      postnummer: "11242",
      omrade: "Kungsholmen",
    });
    expect(postnummerInfo({ postnummer: "11242" })).toMatchObject({ omrade: "Kungsholmen" });
  });

  it("a known postnummer outside the areas gives its kommun and tier", () => {
    expect(postnummerInfo({ postnummer: "17067" })).toEqual({
      status: "kommun",
      postnummer: "17067",
      kommun: "Solna",
      tackning: "lan",
    });
    expect(postnummerInfo({ postnummer: "90325" })).toMatchObject({
      kommun: "Umeå",
      tackning: "utanfor_lan",
    });
  });

  it("a Stockholm postnummer without an area says so", () => {
    expect(postnummerInfo({ postnummer: "14199" })).toMatchObject({
      status: "kommun",
      tackning: "stockholm",
    });
  });

  it("an unknown postnummer is 'okand', carrying the kommun the valuation would use", () => {
    const info = postnummerInfo({ postnummer: "99999" });
    expect(info).toEqual({ status: "okand", postnummer: "99999", trolig: null });
    // The hint never disagrees with the tier the valuation resolves.
    expect(losTackning("99999")?.kommun ?? null).toBeNull();
  });

  it("anything malformed is 'ogiltig'", () => {
    for (const d of [
      { postnummer: "1234" },
      { postnummer: "abc" },
      {},
      null,
      "11242",
      { postnummer: "11242", x: 1 },
    ]) {
      expect(postnummerInfo(d)).toEqual({ status: "ogiltig" });
    }
  });
});
