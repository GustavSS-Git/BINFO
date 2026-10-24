import { describe, expect, it } from "vitest";
import { fragarBaraOmByggar, sagerAttByggarSaknas } from "./assemble";

describe("byggår-missing text filter", () => {
  it.each([
    "Byggår saknas i årsredovisningen.",
    "Uppgifter om byggnadsår framgår inte av rapporten.",
    "Räntekänslighet anges. Byggåret anges inte i förvaltningsberättelsen.",
  ])("matches %s", (t) => expect(sagerAttByggarSaknas(t)).toBe(true));

  it.each([
    "Räntekänslighet saknas i årsredovisningen.",
    "Huset uppfördes 1931. Energikostnad saknas.",
    "Byggåret 1931 gör att energikostnaden är högre.",
  ])("does not match %s", (t) => expect(sagerAttByggarSaknas(t)).toBe(false));

  it("a question only about the construction year is recognised; other building questions are not", () => {
    expect(fragarBaraOmByggar({ fraga: "Vilket år byggdes huset?" })).toBe(true);
    expect(fragarBaraOmByggar({ fraga: "Kan styrelsen bekräfta byggåret?" })).toBe(true);
    expect(fragarBaraOmByggar({ fraga: "När byggdes stammarna om senast?" })).toBe(false);
    expect(fragarBaraOmByggar({ fraga: "När planeras takrenoveringen?" })).toBe(false);
  });
});
