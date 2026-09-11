import { describe, expect, it } from "vitest";
import {
  KostnadsgransOverskriden,
  SONNET_5_PRISSATTNING,
  estimateCostSek,
  enforceCostLimit,
} from "./costGuard";

describe("estimateCostSek", () => {
  it("räknar ut kostnaden i kr för givna input/output-tokens", () => {
    // 50 000 input + 4 000 output vid Sonnet 5-priser ($2/$10 per MTok):
    // (0.05*2 + 0.004*10) USD = 0.14 USD → matchar PIPELINE.md:s egen
    // uppskattning på 0.50–1.50 kr per analys.
    const sek = estimateCostSek(50_000, 4_000, SONNET_5_PRISSATTNING);
    expect(sek).toBeGreaterThan(0.5);
    expect(sek).toBeLessThan(2);
  });

  it("är noll när inga tokens förbrukas", () => {
    expect(estimateCostSek(0, 0, SONNET_5_PRISSATTNING)).toBe(0);
  });

  it("skalar linjärt med tokenantal", () => {
    const enkel = estimateCostSek(10_000, 1_000, SONNET_5_PRISSATTNING);
    const dubbel = estimateCostSek(20_000, 2_000, SONNET_5_PRISSATTNING);
    expect(dubbel).toBeCloseTo(enkel * 2);
  });
});

describe("enforceCostLimit", () => {
  it("kastar KostnadsgransOverskriden när uppskattningen överstiger taket", () => {
    expect(() => enforceCostLimit(50_000, 4_000, 1, SONNET_5_PRISSATTNING)).toThrow(
      KostnadsgransOverskriden,
    );
  });

  it("kastar inte när uppskattningen ligger inom taket", () => {
    expect(() => enforceCostLimit(50_000, 4_000, 5, SONNET_5_PRISSATTNING)).not.toThrow();
  });

  it("felmeddelandet innehåller både uppskattning och tak, för synlig felhantering", () => {
    try {
      enforceCostLimit(50_000, 4_000, 1, SONNET_5_PRISSATTNING);
      expect.fail("skulle ha kastat");
    } catch (e) {
      expect(e).toBeInstanceOf(KostnadsgransOverskriden);
      const err = e as KostnadsgransOverskriden;
      expect(err.estimatedCostSek).toBeGreaterThan(1);
      expect(err.limitSek).toBe(1);
    }
  });
});
