import { describe, expect, it } from "vitest";
import {
  OVRIGA_STOCKHOLM,
  REGISTEROMRADEN,
  arRegisteromradeSlug,
  losRegisteromrade,
  normaliseraPostnummer,
  omradeForPostnummer,
  omradeMedPreposition,
  omradeNamn,
  postnummerArOsaker,
  registeromradeForStadsdel,
} from "./omraden";

describe("REGISTEROMRADEN", () => {
  it("has the 19 areas of PLAN-v3 2.2 with unique slugs, names and consecutive order", () => {
    expect(REGISTEROMRADEN).toHaveLength(19);
    expect(new Set(REGISTEROMRADEN.map((a) => a.slug)).size).toBe(19);
    expect(new Set(REGISTEROMRADEN.map((a) => a.namn)).size).toBe(19);
    expect(REGISTEROMRADEN.map((a) => a.ordning)).toEqual(
      Array.from({ length: 19 }, (_, i) => i + 1),
    );
  });

  it("uses ascii lowercase hyphenated slugs", () => {
    for (const a of REGISTEROMRADEN) expect(a.slug).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it("groups by Stockholms stad's stadsområden: Innerstaden, Söderort, Västerort, in that contiguous order", () => {
    const grupper = REGISTEROMRADEN.map((a) => a.grupp);
    expect(new Set(grupper)).toEqual(new Set(["Innerstaden", "Söderort", "Västerort"]));
    const bytena = grupper.filter((g, i) => i > 0 && g !== grupper[i - 1]);
    expect(bytena).toEqual(["Söderort", "Västerort"]);
  });

  it("keeps Övriga Stockholm outside the 19 areas", () => {
    expect(arRegisteromradeSlug(OVRIGA_STOCKHOLM.slug)).toBe(false);
    expect(omradeNamn(OVRIGA_STOCKHOLM.slug)).toBe("Övriga Stockholm");
    expect(omradeNamn("kungsholmen")).toBe("Kungsholmen");
    expect(omradeNamn("finns-inte")).toBeUndefined();
  });
});

describe("registeromradeForStadsdel", () => {
  it("maps stadsdel names case- and whitespace-insensitively", () => {
    expect(registeromradeForStadsdel("KUNGSHOLMEN")).toBe("kungsholmen");
    expect(registeromradeForStadsdel(" Kungsholmen ")).toBe("kungsholmen");
    expect(registeromradeForStadsdel("SÖDRA HAMMARBYHAMNEN")).toBe("hammarby-sjostad");
    expect(registeromradeForStadsdel("Stora Essingen")).toBe("essingeoarna");
    expect(registeromradeForStadsdel("HANSTA")).toBe("kista-jarva");
    expect(registeromradeForStadsdel("BECKOMBERGA")).toBe("bromma");
  });

  it("returns null for an unknown name", () => {
    expect(registeromradeForStadsdel("Atlantis")).toBeNull();
    expect(registeromradeForStadsdel("")).toBeNull();
  });
});

describe("normaliseraPostnummer", () => {
  it("accepts spaced and prefixed forms", () => {
    expect(normaliseraPostnummer("112 42")).toBe("11242");
    expect(normaliseraPostnummer("11242")).toBe("11242");
    expect(normaliseraPostnummer("SE-112 42")).toBe("11242");
  });
  it("rejects anything that is not five digits starting 1-9", () => {
    expect(normaliseraPostnummer("1124")).toBeNull();
    expect(normaliseraPostnummer("112423")).toBeNull();
    expect(normaliseraPostnummer("01234")).toBeNull();
    expect(normaliseraPostnummer("")).toBeNull();
  });
});

describe("omradeForPostnummer", () => {
  it("resolves known postnummer through the stadsdel table", () => {
    expect(omradeForPostnummer("112 42")).toBe("kungsholmen"); // Baltzar von Platens gata 6
    expect(omradeForPostnummer("11129")).toBe("gamla-stan");
    expect(omradeForPostnummer("11630")).toBe("sodermalm");
    expect(omradeForPostnummer("12062")).toBe("hammarby-sjostad");
    expect(omradeForPostnummer("16440")).toBe("kista-jarva");
  });

  it("returns ovriga-stockholm for a kommun-0180 postnummer without a stadsdel", () => {
    expect(omradeForPostnummer("10500")).toBe("ovriga-stockholm");
  });

  it("drops postnummer that the kommun table places in another kommun (12352 is Huddinge)", () => {
    expect(omradeForPostnummer("12352")).toBeNull();
  });

  it("returns null for postnummer outside Stockholms kommun and for junk", () => {
    expect(omradeForPostnummer("25277")).toBeNull(); // Helsingborg
    expect(omradeForPostnummer("abc")).toBeNull();
  });

  it("marks weak calls", () => {
    expect(postnummerArOsaker("11358")).toBe(true); // 60 % Östermalm / 40 % Vasastan-Norrmalm
    expect(postnummerArOsaker("11242")).toBe(false);
  });
});

describe("losRegisteromrade", () => {
  it("prefers the report address over import over buyers", () => {
    const r = losRegisteromrade([
      { postnummer: ["11630"], kalla: "anvandare" },
      { postnummer: ["11242"], kalla: "rapport_adress" },
      { postnummer: ["16440"], kalla: "import" },
    ]);
    expect(r).toMatchObject({
      omrade: "kungsholmen",
      kalla: "rapport_adress",
      antal: 1,
      andel: 1,
      osakert: false,
    });
  });

  it("falls through to import, then buyers, when a source has no resolvable postnummer", () => {
    expect(
      losRegisteromrade([
        { postnummer: ["25277", "abc"], kalla: "rapport_adress" },
        { postnummer: ["16440"], kalla: "import" },
        { postnummer: ["11630"], kalla: "anvandare" },
      ]),
    ).toMatchObject({ omrade: "kista-jarva", kalla: "import" });
    expect(
      losRegisteromrade([
        { postnummer: [], kalla: "import" },
        { postnummer: ["11630", "11630", "11242"], kalla: "anvandare" },
      ]),
    ).toMatchObject({ omrade: "sodermalm", kalla: "anvandare", antal: 3 });
  });

  it("takes the buyers' majority and reports its share", () => {
    const r = losRegisteromrade([
      { postnummer: ["11242", "11242", "11630"], kalla: "anvandare" },
      { postnummer: ["11242"], kalla: "anvandare" },
    ]);
    expect(r.omrade).toBe("kungsholmen");
    expect(r.antal).toBe(4);
    expect(r.andel).toBeCloseTo(0.75);
    expect(r.osakert).toBe(false);
  });

  it("breaks a tie by display order and flags it as uncertain", () => {
    const r = losRegisteromrade([{ postnummer: ["11630", "11242"], kalla: "rapport_adress" }]);
    expect(r.omrade).toBe("kungsholmen"); // ordning 6 before sodermalm 8
    expect(r.osakert).toBe(true);
    expect(r.andel).toBeCloseTo(0.5);
  });

  it("flags a result that rests only on weak postnummer calls", () => {
    expect(losRegisteromrade([{ postnummer: ["11358"], kalla: "anvandare" }])).toMatchObject({
      omrade: "ostermalm",
      osakert: true,
    });
  });

  it("answers ovriga-stockholm only when nothing in the deciding source maps to one of the 19 areas", () => {
    expect(losRegisteromrade([{ postnummer: ["10500"], kalla: "rapport_adress" }])).toMatchObject({
      omrade: "ovriga-stockholm",
      kalla: "rapport_adress",
    });
    expect(
      losRegisteromrade([{ postnummer: ["10500", "11242"], kalla: "rapport_adress" }]).omrade,
    ).toBe("kungsholmen");
  });

  it("is strict about priority: a kommun-only report address is not overridden by a buyer's postnummer", () => {
    expect(
      losRegisteromrade([
        { postnummer: ["10500"], kalla: "rapport_adress" },
        { postnummer: ["11630"], kalla: "anvandare" },
      ]),
    ).toMatchObject({ omrade: "ovriga-stockholm", kalla: "rapport_adress" });
  });

  it("returns null when nothing can be resolved", () => {
    expect(losRegisteromrade([])).toEqual({
      omrade: null,
      kalla: null,
      antal: 0,
      andel: 0,
      osakert: false,
    });
    expect(
      losRegisteromrade([{ postnummer: ["25277"], kalla: "rapport_adress" }]).omrade,
    ).toBeNull();
  });
});

describe("omradeMedPreposition", () => {
  it("'på' för Kungsholmen, Östermalm, Södermalm, Norrmalm, Essingeöarna, Djurgården & Gärdet", () => {
    for (const [slug, text] of [
      ["kungsholmen", "på Kungsholmen"],
      ["ostermalm", "på Östermalm"],
      ["sodermalm", "på Södermalm"],
      ["norrmalm", "på Norrmalm"],
      ["essingeoarna", "på Essingeöarna"],
      ["djurgarden-gardet", "på Djurgården & Gärdet"],
    ] as const) {
      expect(omradeMedPreposition(slug, omradeNamn(slug)!)).toBe(text);
    }
  });

  it("'i' för alla andra områden", () => {
    const pa = new Set([
      "kungsholmen",
      "ostermalm",
      "sodermalm",
      "norrmalm",
      "essingeoarna",
      "djurgarden-gardet",
    ]);
    for (const a of REGISTEROMRADEN) {
      expect(a.preposition).toBe(pa.has(a.slug) ? "på" : "i");
      if (!pa.has(a.slug)) expect(omradeMedPreposition(a.slug, a.namn)).toBe(`i ${a.namn}`);
    }
  });

  it("'i övriga Stockholm' med gemen mitt i meningen", () => {
    expect(omradeMedPreposition(OVRIGA_STOCKHOLM.slug, OVRIGA_STOCKHOLM.namn)).toBe(
      "i övriga Stockholm",
    );
  });
});
