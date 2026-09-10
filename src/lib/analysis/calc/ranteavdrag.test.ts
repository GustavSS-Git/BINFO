import { describe, expect, it } from "vitest";
import { ranteavdrag } from "./ranteavdrag";

describe("ranteavdrag", () => {
  it("ger 0 kr avdrag vid 0 kr ränta", () => {
    expect(ranteavdrag(0, 1)).toBe(0);
  });

  describe("en låntagare (tak 100 000 kr)", () => {
    it("ger 30 % när räntan är under taket", () => {
      expect(ranteavdrag(80_000, 1)).toBe(24_000);
    });

    it("ger 30 % exakt vid taket, ingen högre sats appliceras", () => {
      expect(ranteavdrag(100_000, 1)).toBe(30_000);
    });

    it("ger 30 % upp till taket och 21 % däröver", () => {
      // 100 000 * 0.3 + 50 000 * 0.21 = 30 000 + 10 500
      expect(ranteavdrag(150_000, 1)).toBe(40_500);
    });
  });

  describe("två låntagare (tak 200 000 kr — 100 000 kr per person)", () => {
    it("taket fördubblas, så samma totalränta som skulle passerat taket för en låntagare ligger nu helt i 30 %-skiktet", () => {
      expect(ranteavdrag(150_000, 2)).toBe(45_000);
    });

    it("ger 30 % upp till 200 000 kr och 21 % däröver", () => {
      // 200 000 * 0.3 + 50 000 * 0.21 = 60 000 + 10 500
      expect(ranteavdrag(250_000, 2)).toBe(70_500);
    });

    it("ger 30 % exakt vid det fördubblade taket", () => {
      expect(ranteavdrag(200_000, 2)).toBe(60_000);
    });
  });
});
