import { describe, expect, it } from "vitest";
import {
  buildMinimalPropertyInput,
  parseBolanekalkylSearch,
  veljRantekanslighetForSok,
} from "./bolanekalkyl";
import type { FeeInclusion } from "@/types/analysis";

function inclusion(overrides: Partial<FeeInclusion> = {}): FeeInclusion {
  return { varme: "nej", vatten: "nej", el: "nej", bredband: "nej", tv: "nej", ...overrides };
}

describe("parseBolanekalkylSearch", () => {
  it("tolkar prisUppskattning som routern faktiskt levererar den (JSON-tolkad boolean/tal)", () => {
    // TanStack Routers parseSearch JSON-tolkar värdena: "?prisUppskattning=1"
    // blir talet 1 och "=true" blir true — aldrig strängar. Samma sak när
    // rapporten navigerar med ett search-objekt.
    expect(parseBolanekalkylSearch({ prisUppskattning: true }).prisUppskattning).toBe(true);
    expect(parseBolanekalkylSearch({ prisUppskattning: 1 }).prisUppskattning).toBe(true);
    expect(parseBolanekalkylSearch({ prisUppskattning: false }).prisUppskattning).toBe(false);
    expect(parseBolanekalkylSearch({ prisUppskattning: 0 }).prisUppskattning).toBe(false);
    expect(parseBolanekalkylSearch({ prisUppskattning: 2 }).prisUppskattning).toBeUndefined();
  });

  it("tolkar sparad (uuid) och spara (bara kalkyl) och kastar aldrig på skräp", () => {
    const id = "3f2c1a9e-8b7d-4c6e-9a10-1234567890ab";
    expect(parseBolanekalkylSearch({ sparad: id }).sparad).toBe(id);
    expect(parseBolanekalkylSearch({ sparad: id.toUpperCase() }).sparad).toBe(id.toUpperCase());
    for (const skrap of ["abc", "", `${id}x`, "../../konto", 123, null, [id], { a: 1 }, true]) {
      const r = parseBolanekalkylSearch({ sparad: skrap });
      expect(r.sparad).toBeUndefined();
      expect(Object.keys(r)).toContain("sparad");
    }
    expect(parseBolanekalkylSearch({ spara: "kalkyl" }).spara).toBe("kalkyl");
    for (const skrap of ["vardering", "x", 1, true, null, ["kalkyl"]]) {
      const r = parseBolanekalkylSearch({ spara: skrap });
      expect(r.spara).toBeUndefined();
      expect(Object.keys(r)).toContain("spara");
    }
    expect(() => parseBolanekalkylSearch({ sparad: Symbol("x"), spara: {} })).not.toThrow();
  });

  it("returnerar alla nycklar som undefined när inga sökparametrar finns", () => {
    expect(parseBolanekalkylSearch({})).toEqual({
      manadsavgift: undefined,
      rantekanslighet: undefined,
      pris: undefined,
      boarea: undefined,
      prisUppskattning: undefined,
    });
  });

  // Regressionstest för en verklig bugg: TanStack Routers matchning bygger
  // sökvägens state med Object.assign(accumulated, validateSearch(...)).
  // Object.assign skriver bara över nycklar som FINNS i källobjektet — att
  // utelämna en nyckel (t.ex. returnera `{}` för ett skräpvärde) lämnar det
  // gamla/råa strängvärdet kvar i accumulated, så "?manadsavgift=abc"
  // läckte igenom orört tills detta test fångade det (bekräftat manuellt
  // mot en riktig dev-server). Nyckeln måste alltså finnas med explicit
  // `undefined`, inte utelämnas.
  it("skriver över ett skräpvärde med en egen nyckel satt till undefined, inte genom att utelämna den", () => {
    const result = parseBolanekalkylSearch({ manadsavgift: "abc" });
    expect(Object.keys(result)).toContain("manadsavgift");
    expect(result.manadsavgift).toBeUndefined();
  });

  it("tar med ett giltigt manadsavgift-värde", () => {
    expect(parseBolanekalkylSearch({ manadsavgift: "3240" })).toEqual({
      manadsavgift: 3240,
      rantekanslighet: undefined,
      pris: undefined,
      boarea: undefined,
      prisUppskattning: undefined,
    });
  });

  it("tar med ett giltigt rantekanslighet-värde", () => {
    expect(parseBolanekalkylSearch({ rantekanslighet: "8.3" })).toEqual({
      manadsavgift: undefined,
      rantekanslighet: 8.3,
      pris: undefined,
      boarea: undefined,
      prisUppskattning: undefined,
    });
  });

  it("tar med ett giltigt pris-värde", () => {
    expect(parseBolanekalkylSearch({ pris: "3500000" })).toEqual({
      manadsavgift: undefined,
      rantekanslighet: undefined,
      pris: 3500000,
      boarea: undefined,
      prisUppskattning: undefined,
    });
  });

  it("tar med ett giltigt boarea-värde", () => {
    expect(parseBolanekalkylSearch({ boarea: "55" })).toEqual({
      manadsavgift: undefined,
      rantekanslighet: undefined,
      pris: undefined,
      boarea: 55,
      prisUppskattning: undefined,
    });
  });

  it("ignorerar skräpvärden för pris och boarea utan att kasta", () => {
    expect(() => parseBolanekalkylSearch({ pris: "abc", boarea: "abc" })).not.toThrow();
    const result = parseBolanekalkylSearch({ pris: "abc", boarea: "0" });
    expect(result.pris).toBeUndefined();
    expect(result.boarea).toBeUndefined();
  });

  it("tar med alla fem när alla finns", () => {
    expect(
      parseBolanekalkylSearch({
        manadsavgift: "3240",
        rantekanslighet: "8.3",
        pris: "3500000",
        boarea: "55",
        prisUppskattning: "1",
      }),
    ).toEqual({
      manadsavgift: 3240,
      rantekanslighet: 8.3,
      pris: 3500000,
      boarea: 55,
      prisUppskattning: true,
    });
  });

  it("tolkar prisUppskattning som en boolesk flagga, med fallback till undefined för skräpvärden", () => {
    expect(parseBolanekalkylSearch({ prisUppskattning: "1" }).prisUppskattning).toBe(true);
    expect(parseBolanekalkylSearch({ prisUppskattning: "true" }).prisUppskattning).toBe(true);
    expect(parseBolanekalkylSearch({ prisUppskattning: "0" }).prisUppskattning).toBe(false);
    expect(parseBolanekalkylSearch({ prisUppskattning: "false" }).prisUppskattning).toBe(false);
    expect(parseBolanekalkylSearch({ prisUppskattning: "yes" }).prisUppskattning).toBeUndefined();
    expect(parseBolanekalkylSearch({}).prisUppskattning).toBeUndefined();
  });

  it("ignorerar skräpvärde utan att kasta", () => {
    expect(() => parseBolanekalkylSearch({ manadsavgift: "abc" })).not.toThrow();
    expect(parseBolanekalkylSearch({ manadsavgift: "abc" }).manadsavgift).toBeUndefined();
  });

  it("ignorerar noll och negativa värden", () => {
    expect(parseBolanekalkylSearch({ manadsavgift: "0" }).manadsavgift).toBeUndefined();
    expect(parseBolanekalkylSearch({ manadsavgift: "-100" }).manadsavgift).toBeUndefined();
  });

  it("ignorerar icke-numeriska typer som objekt och listor", () => {
    expect(parseBolanekalkylSearch({ manadsavgift: { foo: "bar" } }).manadsavgift).toBeUndefined();
    expect(parseBolanekalkylSearch({ manadsavgift: ["3240"] }).manadsavgift).toBeUndefined();
  });

  it("ignorerar undefined explicit", () => {
    expect(parseBolanekalkylSearch({ manadsavgift: undefined }).manadsavgift).toBeUndefined();
  });
});

describe("buildMinimalPropertyInput", () => {
  it("för in de fyra fält som beraknaManadskostnad faktiskt läser", () => {
    const avgiftInkluderar = inclusion({ varme: "ja" });
    const input = buildMinimalPropertyInput({
      boarea: 58,
      antalPersoner: 2,
      manadsavgift: 3240,
      avgiftInkluderar,
    });
    expect(input.boarea).toBe(58);
    expect(input.antalPersoner).toBe(2);
    expect(input.manadsavgift).toBe(3240);
    expect(input.avgiftInkluderar).toBe(avgiftInkluderar);
  });

  it("fyller oanvända obligatoriska fält med ofarliga platshållare, inte påhittad data", () => {
    const input = buildMinimalPropertyInput({
      boarea: 58,
      antalPersoner: 2,
      manadsavgift: 3240,
      avgiftInkluderar: inclusion(),
    });
    expect(input.kind).toBe("bostadsratt");
    expect(input.orgnr).toBe("");
    expect(input.adress).toBe("");
    expect(input.postnummer).toBe("");
    expect(input.ort).toBeUndefined();
    expect(input.hiss).toBe("okant");
    expect(input.balkong).toBe("okant");
    expect(input.utgangspris).toBeUndefined();
    expect(input.antalRum).toBe(0);
    expect(input.andelstal).toBe(0);
  });
});

describe("veljRantekanslighetForSok", () => {
  it("utelämnar parametern när räntekänslighet saknas i rapporten (null)", () => {
    expect(veljRantekanslighetForSok(null)).toBeUndefined();
  });

  it("utelämnar parametern för en skuldfri förening (0) — samma effekt som null", () => {
    expect(veljRantekanslighetForSok(0)).toBeUndefined();
  });

  it("skickar med ett positivt tal oförändrat", () => {
    expect(veljRantekanslighetForSok(9.09)).toBe(9.09);
  });
});
