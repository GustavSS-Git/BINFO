/**
 * booliApiTolkning against the recorded API answers in fixtures/booli-api/
 * (scripts/testaBooliApi.ts --spara, 2026-10-31; keys masked, `estimate`
 * removed) and against hand-made edge cases.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ANNONS_FALT, type AnnonsUppgifter } from "@/lib/annons/typer";
import {
  formateraPostnummer,
  forstaObjekt,
  postnummerFranOmraden,
  tolkaBooliApiObjekt,
} from "./booliApiTolkning";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURER = path.join(here, "..", "..", "..", "fixtures", "booli-api");
const las = (namn: string): { status: number; body: unknown } =>
  JSON.parse(readFileSync(path.join(FIXTURER, namn), "utf-8")) as { status: number; body: unknown };

const IAR = 2026;

/** Every active listing: the object's values, then the areas postcode. */
const AKTIVA: Array<{ id: string; uppgifter: AnnonsUppgifter; postnummer: string }> = [
  {
    id: "6332006",
    postnummer: "116 31",
    uppgifter: {
      adress: "Ringvägen 155C",
      ort: "Stockholm",
      stadsdel: "Katarina",
      utgangspris: 6_395_000,
      manadsavgift: 3537,
      boarea: 63,
      antalRum: 2,
      vaning: 2,
      byggar: 1928,
      hiss: "ja",
      balkong: "ja",
    },
  },
  {
    id: "6327126",
    postnummer: "117 50",
    uppgifter: {
      adress: "Vindragarvägen 2",
      ort: "Stockholm",
      stadsdel: "Södermalm",
      utgangspris: 9_250_000,
      manadsavgift: 5191,
      boarea: 82,
      antalRum: 3,
      vaning: 2,
      byggar: 1945,
      hiss: "ja",
      balkong: "ja",
    },
  },
  {
    // hasBalcony 0 with hasPatio 1: balkong unknown (owner D1).
    id: "6323303",
    postnummer: "117 34",
    uppgifter: {
      adress: "Hornsbruksgatan 11",
      ort: "Stockholm",
      stadsdel: "Södermalm",
      utgangspris: 12_000_000,
      manadsavgift: 5520,
      boarea: 127,
      antalRum: 5,
      vaning: 5,
      byggar: 1967,
      hiss: "ja",
    },
  },
  {
    // No floor in the answer; livingArea 28.5.
    id: "6331969",
    postnummer: "112 46",
    uppgifter: {
      adress: "Industrigatan 16",
      ort: "Stockholm",
      stadsdel: "Kungsholmen",
      utgangspris: 2_850_000,
      manadsavgift: 1669,
      boarea: 28.5,
      antalRum: 1,
      byggar: 1934,
      hiss: "ja",
      balkong: "ja",
    },
  },
  {
    // Freshly published, sparse: no rent, price, floor or year; the 0 flags
    // still become "nej" (owner D1).
    id: "6331911",
    postnummer: "112 56",
    uppgifter: {
      adress: "Rålambsvägen 48",
      ort: "Stockholm",
      stadsdel: "Kungsholmen",
      boarea: 27,
      antalRum: 1,
      hiss: "nej",
      balkong: "nej",
    },
  },
];

const SALDA: Array<{ id: string; uppgifter: AnnonsUppgifter }> = [
  {
    id: "6246378",
    uppgifter: {
      adress: "Västmannagatan 55",
      postnummer: "113 25",
      ort: "Stockholm",
      stadsdel: "Vasastan",
      utgangspris: 4_395_000,
      manadsavgift: 1765,
      boarea: 34,
      antalRum: 1,
      vaning: 2,
      byggar: 1885,
      hiss: "nej",
      balkong: "ja",
    },
  },
  {
    id: "6288456",
    uppgifter: {
      adress: "Birkagatan 32",
      postnummer: "113 39",
      ort: "Stockholm",
      stadsdel: "Vasastan",
      utgangspris: 9_950_000,
      manadsavgift: 1313,
      boarea: 64,
      antalRum: 2,
      vaning: 3,
      byggar: 1904,
      hiss: "ja",
      balkong: "ja",
    },
  },
  {
    id: "6309077",
    uppgifter: {
      adress: "Sankt Eriksgatan 65",
      postnummer: "113 32",
      ort: "Stockholm",
      stadsdel: "Vasastan",
      utgangspris: 4_995_000,
      manadsavgift: 3121,
      boarea: 45,
      antalRum: 1.5,
      vaning: 6,
      byggar: 1929,
      hiss: "ja",
      balkong: "nej",
    },
  },
];

function utanKoordinater(u: AnnonsUppgifter): AnnonsUppgifter {
  const { koordinater: _k, ...rest } = u;
  return rest;
}

describe("inspelade aktiva annonser (listings/{id} + areas)", () => {
  for (const { id, uppgifter, postnummer } of AKTIVA) {
    it(`annons/${id}`, () => {
      const svar = las(`listings-${id}.json`);
      expect(svar.status).toBe(200);
      const t = tolkaBooliApiObjekt(forstaObjekt(svar.body, "listings"), IAR);
      expect(t.booliId).toBe(Number(id));
      // Active listings never carry a postcode: it comes from areas.
      expect(t.uppgifter.postnummer).toBeUndefined();
      expect(utanKoordinater(t.uppgifter)).toEqual(uppgifter);
      expect(t.uppgifter.koordinater).toEqual({
        lat: expect.any(Number) as number,
        lon: expect.any(Number) as number,
      });
      expect(t.saknas).toEqual(ANNONS_FALT.filter((f) => t.uppgifter[f] === undefined));
      expect(postnummerFranOmraden(las(`areas-${id}.json`).body)).toBe(postnummer);
    });
  }
});

describe("inspelade sålda annonser (listings 404 → sold/{id})", () => {
  for (const { id, uppgifter } of SALDA) {
    it(`annons/${id}: listPrice som utgångspris (D3), aldrig slutpriset`, () => {
      const lista = las(`listings-${id}.json`);
      expect(lista.status).toBe(404);
      expect(forstaObjekt(lista.body, "listings")).toBeUndefined();
      const sald = las(`sold-${id}.json`);
      const objekt = forstaObjekt(sald.body, "sold") as Record<string, unknown>;
      expect(objekt["soldPrice"]).toEqual(expect.any(Number));
      const t = tolkaBooliApiObjekt(objekt, IAR);
      expect(t.booliId).toBe(Number(id));
      expect(utanKoordinater(t.uppgifter)).toEqual(uppgifter);
      expect(t.uppgifter.utgangspris).not.toBe(objekt["soldPrice"]);
    });
  }
});

describe("fixturerna innehåller inga hemligheter och ingen Booli-värdering", () => {
  it("varken callerId, hash eller estimate", () => {
    for (const fil of [
      ...AKTIVA.flatMap((a) => [`listings-${a.id}.json`, `areas-${a.id}.json`]),
      ...SALDA.flatMap((s) => [`listings-${s.id}.json`, `sold-${s.id}.json`]),
    ]) {
      const text = readFileSync(path.join(FIXTURER, fil), "utf-8");
      expect(text, fil).not.toMatch(/callerId|"hash"|estimate|\b[0-9a-f]{40}\b/);
    }
  });
});

describe("kantfall", () => {
  const bas = {
    booliId: 1,
    location: {
      address: { streetAddress: "Testgatan 1" },
      region: { municipalityName: "Stockholm" },
      position: { latitude: 59.3, longitude: 18.0 },
      namedAreas: ["Vasastan"],
    },
    livingArea: 54.25,
    rooms: 2.5,
    rent: 3200,
    listPrice: 5_000_000,
    floor: 1.5,
    constructionYear: 1932,
  };

  it("halv våning trunkeras (som parseVaning), boarea får en decimal, rum får vara halva", () => {
    const u = tolkaBooliApiObjekt(bas, IAR).uppgifter;
    expect(u.vaning).toBe(1);
    expect(u.boarea).toBe(54.3);
    expect(u.antalRum).toBe(2.5);
  });

  it("våning 0 (bottenplan) behålls, negativ våning saknas", () => {
    expect(tolkaBooliApiObjekt({ ...bas, floor: 0 }, IAR).uppgifter.vaning).toBe(0);
    expect(tolkaBooliApiObjekt({ ...bas, floor: -1 }, IAR).uppgifter.vaning).toBeUndefined();
  });

  it("avgift 0 och pris 0 är 'inte angivet', inte noll", () => {
    const u = tolkaBooliApiObjekt({ ...bas, rent: 0, listPrice: 0 }, IAR).uppgifter;
    expect(u.manadsavgift).toBeUndefined();
    expect(u.utgangspris).toBeUndefined();
  });

  it("orimligt byggår saknas", () => {
    expect(tolkaBooliApiObjekt({ ...bas, constructionYear: 0 }, IAR).uppgifter.byggar).toBe(
      undefined,
    );
    expect(tolkaBooliApiObjekt({ ...bas, constructionYear: 2040 }, IAR).uppgifter.byggar).toBe(
      undefined,
    );
    expect(tolkaBooliApiObjekt({ ...bas, constructionYear: 2030 }, IAR).uppgifter.byggar).toBe(
      2030,
    );
  });

  it("hiss/balkong: 1 → ja, 0 → nej, saknas → okänt; balkong 0 med uteplats → okänt", () => {
    const t = (o: object) => tolkaBooliApiObjekt({ ...bas, ...o }, IAR).uppgifter;
    expect(t({ buildingHasElevator: 1, hasBalcony: 1 })).toMatchObject({
      hiss: "ja",
      balkong: "ja",
    });
    expect(t({ buildingHasElevator: 0, hasBalcony: 0, hasPatio: 0 })).toMatchObject({
      hiss: "nej",
      balkong: "nej",
    });
    const okant = t({});
    expect("hiss" in okant).toBe(false);
    expect("balkong" in okant).toBe(false);
    expect("balkong" in t({ hasBalcony: 0, hasPatio: 1 })).toBe(false);
    expect(t({ hasBalcony: 1, hasPatio: 1 }).balkong).toBe("ja");
    expect("hiss" in t({ buildingHasElevator: 2 })).toBe(false);
  });

  it("sålda objektets postCode formateras (tal eller text)", () => {
    const med = (postCode: unknown) =>
      tolkaBooliApiObjekt({ ...bas, location: { ...bas.location, address: { postCode } } }, IAR)
        .uppgifter.postnummer;
    expect(med(11341)).toBe("113 41");
    expect(med("11341")).toBe("113 41");
    expect(med("113 41")).toBe("113 41");
    expect(med(1134)).toBeUndefined();
    expect(med("abc12")).toBeUndefined();
  });

  it("ett fält som byter typ blir saknat, resten finns kvar", () => {
    const u = tolkaBooliApiObjekt(
      {
        ...bas,
        rent: "3200 kr",
        livingArea: null,
        rooms: { raw: 2 },
        location: { ...bas.location, address: "Testgatan 1", namedAreas: "Vasastan" },
      },
      IAR,
    ).uppgifter;
    expect(u.manadsavgift).toBeUndefined();
    expect(u.boarea).toBeUndefined();
    expect(u.antalRum).toBeUndefined();
    expect(u.adress).toBeUndefined();
    expect(u.stadsdel).toBeUndefined();
    expect(u.ort).toBe("Stockholm");
    expect(u.utgangspris).toBe(5_000_000);
  });

  it("Booli-värderingen (estimate) och slutpriset läses aldrig", () => {
    const u = tolkaBooliApiObjekt(
      { ...bas, estimate: { price: 9_999_999 }, soldPrice: 6_000_000 },
      IAR,
    ).uppgifter;
    expect(JSON.stringify(u)).not.toMatch(/9999999|6000000|estimate/);
    expect(u.utgangspris).toBe(5_000_000);
  });

  it("skräp kastar aldrig och ger inga värden", () => {
    for (const skrap of [null, undefined, 5, "x", [], [bas], { location: 5 }]) {
      const t = tolkaBooliApiObjekt(skrap, IAR);
      expect(Object.keys(t.uppgifter).length).toBe(0);
      expect(t.saknas).toEqual([...ANNONS_FALT]);
    }
  });

  it("forstaObjekt: bara ett objekt i rätt lista", () => {
    expect(forstaObjekt({ listings: [bas] }, "listings")).toBe(bas);
    expect(forstaObjekt({ listings: [bas] }, "sold")).toBeUndefined();
    expect(forstaObjekt({ listings: [] }, "listings")).toBeUndefined();
    expect(forstaObjekt({ listings: ["x"] }, "listings")).toBeUndefined();
    expect(forstaObjekt(null, "listings")).toBeUndefined();
  });

  it("postnummerFranOmraden: bara typen Postnummer, minsta ytan vinner, skräp ger inget", () => {
    expect(
      postnummerFranOmraden({
        areas: [
          { name: "Stockholm", types: ["Kommun"], size: 10 },
          { name: "11339", types: ["Postnummer"], size: 3000 },
          { name: "11340", types: ["Postnummer"], size: 2000 },
        ],
      }),
    ).toBe("113 40");
    expect(postnummerFranOmraden({ areas: [{ name: "11339", types: ["Kommun"] }] })).toBe(
      undefined,
    );
    expect(postnummerFranOmraden({ areas: [{ name: "abc", types: ["Postnummer"] }] })).toBe(
      undefined,
    );
    expect(postnummerFranOmraden({ areas: "x" })).toBeUndefined();
    expect(postnummerFranOmraden(null)).toBeUndefined();
  });

  it("formateraPostnummer", () => {
    expect(formateraPostnummer("11339")).toBe("113 39");
    expect(formateraPostnummer(11339)).toBe("113 39");
    expect(formateraPostnummer("1133")).toBeUndefined();
    expect(formateraPostnummer(undefined)).toBeUndefined();
  });
});
