import { describe, expect, it } from "vitest";
import { beraknaHushallSkatt, beraknaPersonSkatt, grundavdrag } from "./skatt2026";

const ARSRANTA = 4_455_000 * 0.03; // 133 650 kr

describe("grundavdrag 2026", () => {
  it("120 000 kr ger 37 400 kr", () => {
    expect(grundavdrag(120_000)).toBe(37_400);
  });
  it("324 000 kr ger 31 600 kr", () => {
    expect(grundavdrag(324_000)).toBe(31_600);
  });
  it("700 000 kr ger 17 400 kr", () => {
    expect(grundavdrag(700_000)).toBe(17_400);
  });
});

describe("kontrollvärden per låntagare", () => {
  it("fall A: 540 000 kr brutto", () => {
    const p = beraknaPersonSkatt(540_000, ARSRANTA);
    expect(p.slutligSkattUtanRanteavdrag).toBeCloseTo(110_274, -0.5);
    expect(Math.abs(p.slutligSkattUtanRanteavdrag - 110_274)).toBeLessThanOrEqual(2);
    expect(Math.abs(p.nettoinkomstPerManad - 35_811)).toBeLessThanOrEqual(2);
    expect(Math.abs(p.faktisktRanteavdragPerAr - 37_067)).toBeLessThanOrEqual(2);
  });

  it("fall C: 900 000 kr brutto", () => {
    const p = beraknaPersonSkatt(900_000, ARSRANTA);
    expect(Math.abs(p.slutligSkattUtanRanteavdrag - 268_426)).toBeLessThanOrEqual(2);
    expect(Math.abs(p.nettoinkomstPerManad - 52_631)).toBeLessThanOrEqual(2);
    expect(Math.abs(p.faktisktRanteavdragPerAr - 37_067)).toBeLessThanOrEqual(2);
  });

  it("fall D: 150 000 kr brutto — ränteavdraget begränsas av skatten", () => {
    const p = beraknaPersonSkatt(150_000, ARSRANTA);
    expect(Math.abs(p.slutligSkattUtanRanteavdrag - 18_631)).toBeLessThanOrEqual(2);
    expect(Math.abs(p.nettoinkomstPerManad - 10_947)).toBeLessThanOrEqual(2);
    expect(Math.abs(p.faktisktRanteavdragPerAr - 6_991)).toBeLessThanOrEqual(2);
    expect(Math.abs(p.ranteavdragForloratPerAr - 30_076)).toBeLessThanOrEqual(2);
  });
});

describe("hushåll", () => {
  it("fall B: 540 000 + 420 000 kr, räntan delas lika", () => {
    const h = beraknaHushallSkatt([540_000, 420_000], ARSRANTA);
    expect(Math.abs(h.slutligSkattUtanRanteavdragPerAr - (110_274 + 77_985))).toBeLessThanOrEqual(2);
    expect(Math.abs(h.nettoinkomstPerManad - 64_312)).toBeLessThanOrEqual(2);
    expect(Math.abs(h.ranteavdragPerAr - 40_096)).toBeLessThanOrEqual(2);
    expect(h.ranteavdragForloratPerAr).toBe(0);
  });

  it("en låntagare använder bara sin egen inkomst", () => {
    const h = beraknaHushallSkatt([540_000], ARSRANTA);
    const p = beraknaPersonSkatt(540_000, ARSRANTA);
    expect(h.nettoinkomstPerManad).toBe(p.nettoinkomstPerManad);
  });

  it("nettoinkomsten påverkas inte av ränteavdraget", () => {
    const utan = beraknaHushallSkatt([540_000], 0);
    const med = beraknaHushallSkatt([540_000], ARSRANTA);
    expect(med.nettoinkomstPerManad).toBe(utan.nettoinkomstPerManad);
  });
});
