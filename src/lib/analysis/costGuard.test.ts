import { describe, expect, it } from "vitest";
import {
  HAIKU_4_5_PRISSATTNING,
  HAIKU_5_5_PRISSATTNING,
  estimateCostBothTiersSek,
  KostnadsgransOverskriden,
  OkandModellPrissattningError,
  SONNET_5_5_PRISSATTNING,
  SONNET_5_PRISSATTNING,
  estimateCostFromUsageSek,
  estimateCostSek,
  enforceCostLimit,
  prissattningForModell,
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

describe("estimateCostFromUsageSek (cache-aware)", () => {
  const USD_TILL_SEK_I_TEST = estimateCostSek(1_000_000, 0, SONNET_5_PRISSATTNING) / 2; // $/MTok in -> SEK

  it("utan cachefält är den identisk med estimateCostSek", () => {
    const usage = { input_tokens: 50_000, output_tokens: 4_000 };
    expect(estimateCostFromUsageSek(usage, SONNET_5_PRISSATTNING)).toBeCloseTo(
      estimateCostSek(50_000, 4_000, SONNET_5_PRISSATTNING),
    );
  });

  it("cache-skrivning (5 min TTL) kostar 1,25 x indatapriset", () => {
    const sek = estimateCostFromUsageSek(
      { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 },
      SONNET_5_PRISSATTNING,
    );
    // 1 MTok * $2 * 1.25 = $2.50
    expect(sek).toBeCloseTo(2.5 * USD_TILL_SEK_I_TEST);
  });

  it("cache-läsning kostar 0,1 x indatapriset", () => {
    const sek = estimateCostFromUsageSek(
      { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 },
      SONNET_5_PRISSATTNING,
    );
    // 1 MTok * $2 * 0.1 = $0.20
    expect(sek).toBeCloseTo(0.2 * USD_TILL_SEK_I_TEST);
  });

  it("summerar vanlig indata, cache-skrivning, cache-läsning och utdata", () => {
    const sek = estimateCostFromUsageSek(
      {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        cache_creation_input_tokens: 1_000_000,
        cache_read_input_tokens: 1_000_000,
      },
      SONNET_5_PRISSATTNING,
    );
    // 2 + 2.5 + 0.2 + 10 = $14.70
    expect(sek).toBeCloseTo(14.7 * USD_TILL_SEK_I_TEST);
  });

  it("en cache-träff är billigare än samma tokens utan cache; en miss är dyrare", () => {
    const utanCache = estimateCostFromUsageSek(
      { input_tokens: 2_000, output_tokens: 0 },
      SONNET_5_PRISSATTNING,
    );
    const traff = estimateCostFromUsageSek(
      { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 2_000 },
      SONNET_5_PRISSATTNING,
    );
    const miss = estimateCostFromUsageSek(
      { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 2_000 },
      SONNET_5_PRISSATTNING,
    );
    expect(traff).toBeLessThan(utanCache);
    expect(miss).toBeGreaterThan(utanCache);
  });

  it("följer modellens prissättning (Haiku 4.5 är hälften av Sonnet 5)", () => {
    const usage = { input_tokens: 10_000, output_tokens: 1_000, cache_read_input_tokens: 5_000 };
    expect(estimateCostFromUsageSek(usage, HAIKU_4_5_PRISSATTNING)).toBeCloseTo(
      estimateCostFromUsageSek(usage, SONNET_5_PRISSATTNING) / 2,
    );
  });
});

describe("prissattningForModell", () => {
  it("ger $2/$10 för claude-sonnet-5 och claude-sonnet-5-5", () => {
    expect(prissattningForModell("claude-sonnet-5")).toEqual(SONNET_5_PRISSATTNING);
    expect(prissattningForModell("claude-sonnet-5-5")).toEqual(SONNET_5_5_PRISSATTNING);
    expect(SONNET_5_5_PRISSATTNING).toEqual({ inputPerMtok: 2, outputPerMtok: 10 });
  });

  it("ger $1/$5 för claude-haiku-4-5, även med datumsuffix", () => {
    expect(prissattningForModell("claude-haiku-4-5")).toEqual({
      inputPerMtok: 1,
      outputPerMtok: 5,
    });
    expect(prissattningForModell("claude-haiku-4-5-20251001")).toEqual(HAIKU_4_5_PRISSATTNING);
  });

  it("kastar ett tydligt fel för en okänd modell i stället för att prissätta den till 0", () => {
    expect(() => prissattningForModell("claude-nagot-okant")).toThrow(OkandModellPrissattningError);
    expect(() => prissattningForModell("claude-nagot-okant")).toThrow(/claude-nagot-okant/);
  });
});

describe("claude-haiku-5-5 (tiered price)", () => {
  const sekPerUsd = estimateCostSek(1_000_000, 0, SONNET_5_PRISSATTNING) / 2;

  it("is known, also with a dated snapshot suffix", () => {
    expect(prissattningForModell("claude-haiku-5-5")).toBe(HAIKU_5_5_PRISSATTNING);
    expect(prissattningForModell("claude-haiku-5-5-20260901")).toBe(HAIKU_5_5_PRISSATTNING);
  });

  it("a prompt up to 100K tokens is priced at $0.10/$0.50", () => {
    const sek = estimateCostFromUsageSek(
      { input_tokens: 100_000, output_tokens: 10_000 },
      HAIKU_5_5_PRISSATTNING,
    );
    expect(sek).toBeCloseTo((0.1 * 0.1 + 0.01 * 0.5) * sekPerUsd);
  });

  it("a prompt above 100K tokens is priced at $0.50/$2.50 for the whole call", () => {
    const sek = estimateCostFromUsageSek(
      { input_tokens: 100_001, output_tokens: 10_000 },
      HAIKU_5_5_PRISSATTNING,
    );
    expect(sek).toBeCloseTo((0.100001 * 0.5 + 0.01 * 2.5) * sekPerUsd);
  });

  it("cache tokens count towards the prompt size", () => {
    const sek = estimateCostFromUsageSek(
      { input_tokens: 10_000, output_tokens: 0, cache_read_input_tokens: 95_000 },
      HAIKU_5_5_PRISSATTNING,
    );
    // high tier: 10K * 0.5 + 95K * 0.5 * 0.1
    expect(sek).toBeCloseTo((0.01 * 0.5 + 0.095 * 0.05) * sekPerUsd);
  });

  it("pre-flight reservation uses the high tier", () => {
    expect(estimateCostSek(10_000, 1_000, HAIKU_5_5_PRISSATTNING)).toBeCloseTo(
      (0.01 * 0.5 + 0.001 * 2.5) * sekPerUsd,
    );
  });

  it("estimateCostBothTiersSek gives low and high; equal for an untiered model", () => {
    const usage = { input_tokens: 50_000, output_tokens: 5_000 };
    const b = estimateCostBothTiersSek(usage, HAIKU_5_5_PRISSATTNING);
    expect(b.lag).toBeCloseTo((0.05 * 0.1 + 0.005 * 0.5) * sekPerUsd);
    expect(b.hog).toBeCloseTo((0.05 * 0.5 + 0.005 * 2.5) * sekPerUsd);
    const s = estimateCostBothTiersSek(usage, SONNET_5_PRISSATTNING);
    expect(s.lag).toBeCloseTo(s.hog);
  });
});
