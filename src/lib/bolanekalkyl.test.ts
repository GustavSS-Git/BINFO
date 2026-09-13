import { describe, expect, it } from "vitest";
import { buildMinimalPropertyInput, parseBolanekalkylSearch } from "./bolanekalkyl";
import type { FeeInclusion } from "@/types/analysis";

function inclusion(overrides: Partial<FeeInclusion> = {}): FeeInclusion {
  return { varme: "nej", vatten: "nej", el: "nej", bredband: "nej", tv: "nej", ...overrides };
}

describe("parseBolanekalkylSearch", () => {
  it("returnerar båda nycklarna som undefined när inga sökparametrar finns", () => {
    expect(parseBolanekalkylSearch({})).toEqual({
      manadsavgift: undefined,
      rantekanslighet: undefined,
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
    });
  });

  it("tar med ett giltigt rantekanslighet-värde", () => {
    expect(parseBolanekalkylSearch({ rantekanslighet: "8.3" })).toEqual({
      manadsavgift: undefined,
      rantekanslighet: 8.3,
    });
  });

  it("tar med båda när båda finns", () => {
    expect(parseBolanekalkylSearch({ manadsavgift: "3240", rantekanslighet: "8.3" })).toEqual({
      manadsavgift: 3240,
      rantekanslighet: 8.3,
    });
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
    expect(input.ort).toBe("");
    expect(input.hiss).toBe("okant");
    expect(input.balkong).toBe("okant");
    expect(input.utgangspris).toBe(0);
    expect(input.antalRum).toBe(0);
    expect(input.andelstal).toBe(0);
  });
});
