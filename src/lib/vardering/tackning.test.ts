import { describe, expect, it } from "vitest";
import { dominerandeKommunPerPrefix, kommunForPostnummer, postnummerOmrade } from "./data";
import { losTackning, type TackningTabeller } from "./tackning";

describe("losTackning — real tables", () => {
  it("(a) a postnummer in the omrade map is 'stockholm' with its omrade", () => {
    expect(losTackning("10004")).toEqual({
      tackning: "stockholm",
      omrade: "Kungsholmen",
      kommunKod: "0180",
      kommun: "Stockholm",
    });
  });

  it("normalises a spaced postnummer", () => {
    expect(losTackning("100 04")?.omrade).toBe("Kungsholmen");
  });

  it("(b) a Stockholm-kommun postnummer missing from the omrade map is Stockholm-wide", () => {
    expect("10500" in postnummerOmrade).toBe(false);
    expect(kommunForPostnummer.get("10500")).toBe("0180");
    expect(losTackning("10500")).toEqual({
      tackning: "stockholm",
      omrade: null,
      kommunKod: "0180",
      kommun: "Stockholm",
    });
  });

  it.each(["12352", "12404", "12755", "12784"])(
    "owner decision 4: %s (listed as a Stockholm omrade, lies in Huddinge) resolves to Huddinge, 'lan'",
    (pn) => {
      expect(pn in postnummerOmrade).toBe(false);
      expect(losTackning(pn)).toEqual({
        tackning: "lan",
        omrade: null,
        kommunKod: "0126",
        kommun: "Huddinge",
      });
    },
  );

  it("(c) Solna and Nacka postnummer are 'lan'", () => {
    expect(losTackning("16900")).toMatchObject({ tackning: "lan", kommun: "Solna", omrade: null });
    expect(losTackning("13100")).toMatchObject({ tackning: "lan", kommun: "Nacka", omrade: null });
  });

  it("(d) a Göteborg postnummer is 'utanfor_lan' with the kommun name", () => {
    expect(losTackning("40010")).toEqual({
      tackning: "utanfor_lan",
      omrade: null,
      kommunKod: "1480",
      kommun: "Göteborg",
    });
  });

  it("(e) an unknown 141xx postnummer follows its Huddinge-dominated prefix, not the omrade prefix", () => {
    expect(kommunForPostnummer.has("14110")).toBe(false);
    expect(losTackning("14110")).toMatchObject({ tackning: "lan", kommun: "Huddinge" });
  });

  it("(e) an unknown postnummer whose prefix is mostly Stockholm is Stockholm-wide", () => {
    expect(kommunForPostnummer.has("12364")).toBe(false);
    expect("12364" in postnummerOmrade).toBe(false);
    expect(losTackning("12364")).toMatchObject({
      tackning: "stockholm",
      omrade: null,
      kommun: "Stockholm",
    });
  });

  it("(e) an unknown postnummer with an unmapped prefix takes the majority kommun of that prefix (Göteborg 411xx)", () => {
    expect(kommunForPostnummer.has("41144")).toBe(false);
    expect(dominerandeKommunPerPrefix.get("411")).toBe("1480");
    expect(losTackning("41144")).toMatchObject({ tackning: "utanfor_lan", kommun: "Göteborg" });
  });

  it("(e) the majority can be a kommun in the län (130xx -> Värmdö)", () => {
    expect(kommunForPostnummer.has("13099")).toBe(false);
    expect(Object.keys(postnummerOmrade).some((k) => k.startsWith("130"))).toBe(false);
    expect(losTackning("13099")).toMatchObject({ tackning: "lan", kommun: "Värmdö" });
  });

  it("(e) a postnummer whose prefix is nowhere is 'utanfor_lan' with kommun null", () => {
    expect(losTackning("99999")).toEqual({
      tackning: "utanfor_lan",
      omrade: null,
      kommunKod: null,
      kommun: null,
    });
  });

  it.each(["", "   ", "115", "1153", "115-32", "115a32", "115322", "abcde"])(
    "malformed / empty postnummer %j gives no valuation",
    (pn) => {
      expect(losTackning(pn)).toBeNull();
    },
  );
});

describe("losTackning — synthetic tables", () => {
  const tabeller: TackningTabeller = {
    omradeMap: { "11111": "Testomrade" },
    kommunPerPostnummer: new Map([
      ["22201", "0182"],
      ["22202", "0126"],
      ["33301", "1480"],
    ]),
    dominerandeKommunPerPrefix: new Map([
      ["222", "0126"],
      ["333", "1480"],
    ]),
    kommunNamn: { "0180": "Stockholm", "0182": "Nacka", "0126": "Huddinge", "1480": "Göteborg" },
  };

  it("the omrade map wins over the kommun map", () => {
    const t = { ...tabeller, kommunPerPostnummer: new Map([["11111", "1480"]]) };
    expect(losTackning("11111", t)).toMatchObject({ tackning: "stockholm", omrade: "Testomrade" });
  });

  it("(e) the kommun-prefix majority wins over the omrade-prefix rule", () => {
    const t = { ...tabeller, dominerandeKommunPerPrefix: new Map([["111", "0126"]]) };
    expect(losTackning("11199", t)).toMatchObject({ tackning: "lan", kommun: "Huddinge" });
  });

  it("(e) the omrade-prefix rule applies when the prefix has no kommun majority", () => {
    expect(losTackning("11199", tabeller)).toMatchObject({ tackning: "stockholm", omrade: null });
  });

  it("an unknown postnummer takes the prefix majority, not its own digits' neighbour", () => {
    expect(losTackning("22299", tabeller)).toMatchObject({ tackning: "lan", kommun: "Huddinge" });
  });

  it("a kommun code without a name still resolves its tier (name null)", () => {
    const t = { ...tabeller, kommunNamn: {} };
    expect(losTackning("33301", t)).toEqual({
      tackning: "utanfor_lan",
      omrade: null,
      kommunKod: "1480",
      kommun: null,
    });
  });
});

describe("generated kommun data", () => {
  it("every postnummer in the omrade map is a Stockholm-kommun postnummer or unknown to the kommun map", () => {
    for (const pn of Object.keys(postnummerOmrade)) {
      const kod = kommunForPostnummer.get(pn);
      expect(kod === undefined || kod === "0180").toBe(true);
    }
  });

  it("ties between kommuner in a prefix go to the lower kommun code (deterministic)", () => {
    for (const [prefix, kod] of dominerandeKommunPerPrefix) {
      const antal = new Map<string, number>();
      for (const [pn, k] of kommunForPostnummer) {
        if (pn.startsWith(prefix)) antal.set(k, (antal.get(k) ?? 0) + 1);
      }
      const max = Math.max(...antal.values());
      const toppar = [...antal.entries()]
        .filter(([, n]) => n === max)
        .map(([k]) => k)
        .sort();
      expect(kod).toBe(toppar[0]);
    }
  });
});
