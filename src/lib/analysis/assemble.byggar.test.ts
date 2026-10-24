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

describe("byggår filter false positives (review 2026-10-24)", () => {
  it.each([
    "Byggår 1965 anges, men energideklaration saknas.",
    "Byggåret är okänt för garaget men framgår för huset 1931.",
  ])("keeps skäl line: %s", (t) => expect(sagerAttByggarSaknas(t)).toBe(false));

  it.each([
    "Uppgift om byggår saknas.",
    "Byggår och energiklass saknas.",
    "Det saknas uppgift om byggår.",
  ])("drops skäl line: %s", (t) => expect(sagerAttByggarSaknas(t)).toBe(true));

  it.each([
    "Vilka större underhåll har gjorts sedan byggåret?",
    "Hur påverkar byggåret kommande avgiftshöjningar?",
    "Varför saknas uppgift om byggår, och vilka stammar har bytts?",
  ])("keeps question: %s", (fraga) => expect(fragarBaraOmByggar({ fraga })).toBe(false));

  it.each([
    "Vilket år byggdes huset?",
    "När uppfördes byggnaden?",
    "Kan styrelsen bekräfta byggåret?",
  ])("drops question: %s", (fraga) => expect(fragarBaraOmByggar({ fraga })).toBe(true));
});
