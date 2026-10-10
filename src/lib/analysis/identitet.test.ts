import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { arGiltigtOrgnr, identifieraLokalt, namnLiknar, normaliseraOrgnr } from "./identitet";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(here, "__fixtures__", "identitet");

interface IdentitetFixture {
  kalla: string;
  forvantat: { orgnr: string; rakenskapsar: number; namn: string };
  sidor: string[];
}

const fixtures = readdirSync(fixtureDir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => ({
    id: f.replace(/\.json$/, ""),
    data: JSON.parse(readFileSync(path.join(fixtureDir, f), "utf8")) as IdentitetFixture,
  }));

/** A Luhn-valid orgnr from nine digits (computes the check digit). */
function orgnrFran(niosiffrigt: string): string {
  for (let k = 0; k <= 9; k++) {
    const kandidat = `${niosiffrigt.slice(0, 6)}-${niosiffrigt.slice(6)}${k}`;
    if (arGiltigtOrgnr(kandidat)) return kandidat;
  }
  throw new Error("unreachable");
}

const BRF = orgnrFran("769616025"); // 769616-0253
const ANNAT = orgnrFran("556123456");
const ANNAT_BRF = orgnrFran("716419857"); // 716419-8579

function sidorMed(rader: Array<string | undefined>): string[] {
  return rader.map((r) => r ?? "");
}

describe("arGiltigtOrgnr", () => {
  it("accepts verified real orgnr (answer keys)", () => {
    for (const o of [
      "702002-5446",
      "716419-8579",
      "716421-9722",
      "743000-3215",
      "746000-1865",
      "769603-2254",
      "769616-0253",
      "769616-3273",
      "769624-6953",
      "769631-3761",
    ]) {
      expect(arGiltigtOrgnr(o), o).toBe(true);
    }
  });

  it("rejects a wrong check digit", () => {
    expect(arGiltigtOrgnr("769616-0254")).toBe(false);
    expect(arGiltigtOrgnr("769616-0252")).toBe(false);
  });

  it("rejects wrong formats", () => {
    expect(arGiltigtOrgnr("7696160253")).toBe(false);
    expect(arGiltigtOrgnr("769616-025")).toBe(false);
    expect(arGiltigtOrgnr("76961-60253")).toBe(false);
    expect(arGiltigtOrgnr("abcdef-ghij")).toBe(false);
    expect(arGiltigtOrgnr("")).toBe(false);
  });
});

describe("normaliseraOrgnr", () => {
  it("adds the dash to ten digits", () => {
    expect(normaliseraOrgnr("7696160253")).toBe("769616-0253");
    expect(normaliseraOrgnr(" 7430003215 ")).toBe("743000-3215");
  });
  it("keeps a dashed number and accepts en dash / spaces", () => {
    expect(normaliseraOrgnr("769616-0253")).toBe("769616-0253");
    expect(normaliseraOrgnr("743000–3215")).toBe("743000-3215");
    expect(normaliseraOrgnr("769616 - 0253")).toBe("769616-0253");
  });
  it("returns null for anything else", () => {
    expect(normaliseraOrgnr("76961602")).toBeNull();
    expect(normaliseraOrgnr("Brf Granen")).toBeNull();
    expect(normaliseraOrgnr("769616-0253 och mer")).toBeNull();
    expect(normaliseraOrgnr("")).toBeNull();
  });
});

describe("namnLiknar", () => {
  it("matches across legal-form spelling, case, dash type and punctuation", () => {
    expect(namnLiknar("Brf Granen 10-11", "Bostadsrättsföreningen Granen 10–11")).toBe(true);
    expect(namnLiknar("BRF GRANEN 10-11", "brf granen 10-11")).toBe(true);
    expect(namnLiknar("Brf. Granen   10-11", "Brf Granen 10-11")).toBe(true);
    expect(namnLiknar("Bf Volontären 12 u.p.a", "Bostadsföreningen Volontären 12 UPA")).toBe(true);
    expect(namnLiknar("Bf Volontären 12 U P A", "Bostadsföreningen Volontären 12 UPA")).toBe(true);
    expect(namnLiknar("RBF Helsingborgshus nr 17", "Riksbyggen Brf Helsingborgshus nr 17")).toBe(
      true,
    );
  });

  it("tolerates a trailing place suffix and a leading Riksbyggen/HSB", () => {
    expect(namnLiknar("Brf Näcken 2", "Riksbyggen Brf Näcken 2 i Umeå")).toBe(true);
    expect(namnLiknar("HSB Brf Ekorren", "Brf Ekorren")).toBe(true);
  });

  it("does not match when digits or words differ", () => {
    expect(namnLiknar("Brf Granen", "Brf Granen 2")).toBe(false);
    expect(namnLiknar("Brf Granen 10-11", "Brf Granen 10-12")).toBe(false);
    expect(namnLiknar("Brf Granen", "Brf Granen Norra")).toBe(false);
    expect(namnLiknar("Brf Granen", "Brf Tallen")).toBe(false);
    expect(namnLiknar("Brf Näcken 2", "Brf Näcken 3 i Umeå")).toBe(false);
  });

  it("is false for empty names or a legal form alone", () => {
    expect(namnLiknar("", "Brf Granen")).toBe(false);
    expect(namnLiknar("Brf", "Bostadsrättsföreningen")).toBe(false);
  });
});

describe("identifieraLokalt on real report snippets", () => {
  it("covers all ten text-layer reports", () => {
    expect(fixtures).toHaveLength(10);
  });

  for (const { id, data } of fixtures) {
    it(`${id}: orgnr, fiscal year (end year) and name`, () => {
      const r = identifieraLokalt(data.sidor);
      expect(r.skal, JSON.stringify(r.skal)).toEqual(expect.any(Array));
      expect(r.identitet, JSON.stringify(r)).not.toBeNull();
      expect(r.identitet?.orgnr).toBe(data.forvantat.orgnr);
      expect(r.identitet?.rakenskapsar).toBe(data.forvantat.rakenskapsar);
      expect(r.identitet?.namn, "namn").not.toBeNull();
      expect(
        namnLiknar(r.identitet?.namn ?? "", data.forvantat.namn),
        r.identitet?.namn ?? "",
      ).toBe(true);
      expect(r.orgnrKandidater[0]?.orgnr).toBe(data.forvantat.orgnr);
    });
  }

  it("the broken fiscal year report resolves to the END year (2024-09-01 - 2025-08-31)", () => {
    const f = fixtures.find((x) => x.id.startsWith("helsingborgshus"));
    expect(f).toBeDefined();
    expect(identifieraLokalt(f!.data.sidor).identitet?.rakenskapsar).toBe(2025);
  });

  it("the letter-spaced text layer is read from the spaced footer lines", () => {
    const f = fixtures.find((x) => x.id.startsWith("barsbro"));
    const r = identifieraLokalt(f!.data.sidor);
    expect(r.orgnrKandidater[0]?.antalSidor).toBeGreaterThan(10);
  });
});

describe("identifieraLokalt: orgnr decisions", () => {
  const aar =
    "Styrelsen upprättar härmed följande årsredovisning för räkenskapsåret 2025-01-01 - 2025-12-31.";

  it("majority across pages beats a stray number on one page", () => {
    const sidor = sidorMed([
      "Brf Granen\n" + aar,
      `${BRF}`,
      `${BRF}`,
      `${BRF}`,
      `Kontakt: ${ANNAT_BRF}`,
    ]);
    const r = identifieraLokalt(sidor);
    expect(r.identitet?.orgnr).toBe(BRF);
    expect(r.orgnrKandidater.map((k) => k.orgnr)).toEqual([BRF, ANNAT_BRF]);
  });

  it("ignores the auditor firm's orgnr when it sits right after 'Revision AB'", () => {
    const sidor = sidorMed([
      aar,
      `Brf Granen ${BRF}`,
      `Kvadrat Revision AB, org.nr ${ANNAT}`,
      `Kvadrat Revision AB ${ANNAT}`,
      `Kvadrat Revision AB ${ANNAT}`,
      `Brf Granen ${BRF}`,
    ]);
    const r = identifieraLokalt(sidor);
    expect(r.identitet?.orgnr).toBe(BRF);
    expect(r.orgnrKandidater.map((k) => k.orgnr)).not.toContain(ANNAT);
  });

  it("does not treat Riksbyggen/HSB/Revisionsberättelse in a footer as a third party", () => {
    const sidor = sidorMed([
      aar,
      `ÅRSREDOVISNING Riksbyggen Brf Näcken 2 i Umeå Org.nr: ${BRF}`,
      `Revisionsberättelse Brf Näcken 2, org.nr ${BRF}`,
      `ÅRSREDOVISNING Riksbyggen Brf Näcken 2 i Umeå Org.nr: ${BRF}`,
    ]);
    expect(identifieraLokalt(sidor).identitet?.orgnr).toBe(BRF);
  });

  it("returns null with a reason when only a third party's orgnr exists", () => {
    const r = identifieraLokalt(
      sidorMed([aar, `Förvaltare: Nabo Förvaltning AB, org.nr ${ANNAT}`]),
    );
    expect(r.identitet).toBeNull();
    expect(r.skal.join(" ")).toMatch(/orgnr/i);
  });

  it("returns null when two candidates are close in support", () => {
    const sidor = sidorMed([aar, BRF, BRF, BRF, ANNAT_BRF, ANNAT_BRF, ANNAT_BRF]);
    const r = identifieraLokalt(sidor);
    expect(r.identitet).toBeNull();
    expect(r.orgnrKandidater).toHaveLength(2);
    expect(r.skal.join(" ")).toMatch(/tvetydigt/i);
  });

  it("ignores numbers failing Luhn", () => {
    const r = identifieraLokalt(sidorMed([aar, "Org.nr 769616-0254", "769616-0254"]));
    expect(r.identitet).toBeNull();
    expect(r.orgnrKandidater).toEqual([]);
  });

  it("accepts a ten-digit orgnr only next to an org keyword", () => {
    const tio = BRF.replace("-", "");
    const utan = identifieraLokalt(sidorMed([aar, `Tel ${tio}`, `Ref ${tio}`]));
    expect(utan.identitet).toBeNull();
    const med = identifieraLokalt(sidorMed([aar, `Org.nr: ${tio}`, `Organisationsnummer ${tio}`]));
    expect(med.identitet?.orgnr).toBe(BRF);
  });

  it("accepts en dash between the orgnr groups", () => {
    const r = identifieraLokalt(sidorMed([aar, `Org nr: ${BRF.replace("-", "–")}`]));
    expect(r.identitet?.orgnr).toBe(BRF);
  });

  it("a number inside a longer digit run is not an orgnr", () => {
    const r = identifieraLokalt(sidorMed([aar, `Bankgiro 1${BRF}9`, `Bankgiro 12${BRF}`]));
    expect(r.orgnrKandidater).toEqual([]);
  });

  it("empty or text-less input gives null with a reason", () => {
    expect(identifieraLokalt([]).identitet).toBeNull();
    const r = identifieraLokalt(["", "  \n "]);
    expect(r.identitet).toBeNull();
    expect(r.skal.length).toBeGreaterThan(0);
  });
});

describe("identifieraLokalt: fiscal year decisions", () => {
  const brf = (ar: string) => `Brf Granen 10-11 ${BRF}\n${ar}`;

  it("uses the end year of an explicit date range", () => {
    const r = identifieraLokalt(sidorMed([brf("för räkenskapsåret 2025-01-01 – 2025-12-31")]));
    expect(r.identitet?.rakenskapsar).toBe(2025);
  });

  it("broken fiscal year: 'för perioden 2024-07-01 - 2025-06-30' is 2025", () => {
    const r = identifieraLokalt(
      sidorMed([brf("Årsredovisning för perioden 2024-07-01 - 2025-06-30")]),
    );
    expect(r.identitet?.rakenskapsar).toBe(2025);
  });

  it("broken fiscal year with 'till' and a line break after the keyword", () => {
    const r = identifieraLokalt(
      sidorMed([brf("årsredovisning för räkenskapsåret\n2024-09-01 till 2025-08-31")]),
    );
    expect(r.identitet?.rakenskapsar).toBe(2025);
  });

  it("'räkenskapsåret 2024/2025' is the end year", () => {
    const r = identifieraLokalt(
      sidorMed([brf("avge årsredovisning för räkenskapsåret 2024/2025")]),
    );
    expect(r.identitet?.rakenskapsar).toBe(2025);
  });

  it("'Årsredovisning för räkenskapsåret 2025' works", () => {
    const r = identifieraLokalt(sidorMed([brf("Årsredovisning för räkenskapsåret 2025")]));
    expect(r.identitet?.rakenskapsar).toBe(2025);
  });

  it("flerårsöversikt headers never win over the explicit statement", () => {
    const sidor = sidorMed([
      brf("räkenskapsåret 2025-01-01 - 2025-12-31"),
      `${BRF}\nFlerårsöversikt\nNyckeltal 2024 2023 2022 2021`,
      `${BRF}\nFlerårsöversikt\n2024 2023 2022`,
      `${BRF}\nFlerårsöversikt\n2024 2023 2022`,
    ]);
    const r = identifieraLokalt(sidor);
    expect(r.identitet?.rakenskapsar).toBe(2025);
  });

  it("flerårsöversikt headers alone give null (no explicit statement)", () => {
    const r = identifieraLokalt(
      sidorMed([`${BRF}\nFlerårsöversikt\nNyckeltal 2025 2024 2023 2022`, `${BRF}`]),
    );
    expect(r.identitet).toBeNull();
    expect(r.skal.join(" ")).toMatch(/räkenskapsår/i);
  });

  it("a cover-only year ('Årsredovisning 2025') is not enough on its own", () => {
    const r = identifieraLokalt(sidorMed([`Årsredovisning 2025\n${BRF}`, BRF]));
    expect(r.identitet).toBeNull();
    expect(r.arKandidater).toContain(2025);
    expect(r.skal.join(" ")).toMatch(/omslag/i);
  });

  it("an explicit date range outranks 'räkenskapsåret YYYY' statements", () => {
    const sidor = sidorMed([
      brf("räkenskapsåret 2025-01-01 - 2025-12-31"),
      "föregående år: under räkenskapsåret 2024 hände",
      "under räkenskapsåret 2024 skedde",
      "under räkenskapsåret 2024 skedde",
    ]);
    expect(identifieraLokalt(sidor).identitet?.rakenskapsar).toBe(2025);
  });

  it("conflicting statements with equal support give null with a reason", () => {
    const sidor = sidorMed([
      brf("för räkenskapsåret 2025"),
      "för räkenskapsåret 2025",
      "för räkenskapsåret 2024",
      "för räkenskapsåret 2024",
    ]);
    const r = identifieraLokalt(sidor);
    expect(r.identitet).toBeNull();
    expect(r.arKandidater).toEqual(expect.arrayContaining([2024, 2025]));
    expect(r.skal.join(" ")).toMatch(/tvetydigt/i);
  });

  it("ignores 'föregående räkenskapsåret YYYY' and a date range without keyword", () => {
    const sidor = sidorMed([
      brf("Resultaträkning 2025-01-01-2025-12-31 2024-01-01-2024-12-31"),
      "föregående räkenskapsåret 2024",
    ]);
    const r = identifieraLokalt(sidor);
    expect(r.identitet).toBeNull();
  });

  it("rejects an impossible date range after the keyword", () => {
    const r = identifieraLokalt(sidorMed([brf("räkenskapsåret 2025-12-31 - 2025-01-01")]));
    expect(r.identitet).toBeNull();
    expect(r.skal.join(" ")).toMatch(/datumintervall/i);
  });

  it("identity requires BOTH orgnr and year", () => {
    expect(
      identifieraLokalt(sidorMed(["räkenskapsåret 2025-01-01 - 2025-12-31"])).identitet,
    ).toBeNull();
    expect(identifieraLokalt(sidorMed([BRF, BRF])).identitet).toBeNull();
  });
});

describe("identifieraLokalt: name", () => {
  const aar = `${BRF}\nräkenskapsåret 2025-01-01 - 2025-12-31`;

  it("takes the name from 'Välkommen till årsredovisningen för Brf X'", () => {
    const r = identifieraLokalt(
      sidorMed([`${aar}\nVälkommen till årsredovisningen för Brf Granen 10-11`]),
    );
    expect(r.identitet?.namn).toBe("Brf Granen 10-11");
  });

  it("cuts the name at 'med säte' / org.nr", () => {
    const r = identifieraLokalt(
      sidorMed([
        `${aar}\nStyrelsen för Bostadsrättsföreningen Torsborgen 3 med säte i Lidingö org.nr. ${BRF} får`,
      ]),
    );
    expect(r.identitet?.namn).toBe("Bostadsrättsföreningen Torsborgen 3");
  });

  it("follows a keyword at the start of a line onto the next line", () => {
    const r = identifieraLokalt(sidorMed([`${aar}\nBostadsrättsförening\nHelsingborgshus nr 17`]));
    expect(r.identitet?.namn).toBe("Bostadsrättsförening Helsingborgshus nr 17");
  });

  it("does not turn 'Att bo i BRF / Ordlista' into a name", () => {
    const r = identifieraLokalt(sidorMed([`${aar}\nAtt bo i BRF\nOrdlista`]));
    expect(r.identitet?.namn).toBeNull();
  });

  it("is null when there is no name", () => {
    expect(identifieraLokalt(sidorMed([aar])).identitet?.namn).toBeNull();
  });

  it("is null when two different names have equal support", () => {
    const r = identifieraLokalt(sidorMed([`${aar}\nBrf Granen 10-11`, "Brf Tallen 4"]));
    expect(r.identitet?.namn).toBeNull();
    expect(r.skal.join(" ")).toMatch(/namn/i);
  });

  it("ignores 'Bostadsrättsföreningen registrerades ...' sentences", () => {
    const r = identifieraLokalt(
      sidorMed([`${aar}\nBostadsrättsföreningen registrerades 1968-05-02.`]),
    );
    expect(r.identitet?.namn).toBeNull();
  });
});
