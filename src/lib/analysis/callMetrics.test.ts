import { describe, expect, it } from "vitest";
import { SONNET_5_PRISSATTNING, estimateCostFromUsageSek, estimateCostSek } from "./costGuard";
import {
  annotateSpend,
  buildCallMetrics,
  cacheHitRate,
  errorHasKnownSpend,
  formatCallMetricsTable,
  totalCostSek,
  totalLatencyMs,
  type ModelCallMetrics,
} from "./callMetrics";

describe("buildCallMetrics", () => {
  it("läser in alla fält från usage, defaultar saknade cache-fält till 0", () => {
    const metrics = buildCallMetrics({
      stage: "grundning",
      model: "claude-sonnet-5",
      latencyMs: 1234,
      usage: { input_tokens: 1000, output_tokens: 200 },
      stopReason: "end_turn",
      pricing: SONNET_5_PRISSATTNING,
    });

    expect(metrics).toEqual({
      stage: "grundning",
      model: "claude-sonnet-5",
      inputTokens: 1000,
      outputTokens: 200,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      latencyMs: 1234,
      stopReason: "end_turn",
      costSek: estimateCostSek(1000, 200, SONNET_5_PRISSATTNING),
    });
  });

  it("tar med cache_creation/cache_read när svaret bär dem", () => {
    const metrics = buildCallMetrics({
      stage: "extraktion",
      model: "claude-sonnet-5",
      latencyMs: 500,
      usage: {
        input_tokens: 300,
        output_tokens: 100,
        cache_creation_input_tokens: 1700,
        cache_read_input_tokens: 50,
      },
      stopReason: null,
      pricing: SONNET_5_PRISSATTNING,
    });

    expect(metrics.cacheCreationInputTokens).toBe(1700);
    expect(metrics.cacheReadInputTokens).toBe(50);
    expect(metrics.stopReason).toBeNull();
  });

  it("costSek prissätter cache-skrivning (1,25x) och cache-läsning (0,1x), inte bara input/output", () => {
    const usage = {
      input_tokens: 300,
      output_tokens: 100,
      cache_creation_input_tokens: 1700,
      cache_read_input_tokens: 5000,
    };
    const metrics = buildCallMetrics({
      stage: "extraktion",
      model: "claude-sonnet-5",
      latencyMs: 1,
      usage,
      stopReason: "end_turn",
      pricing: SONNET_5_PRISSATTNING,
    });
    expect(metrics.costSek).toBeCloseTo(estimateCostFromUsageSek(usage, SONNET_5_PRISSATTNING));
    expect(metrics.costSek).toBeGreaterThan(estimateCostSek(300, 100, SONNET_5_PRISSATTNING));
  });

  it("utan explicit pricing väljs modellens egen; okänd modell kastar", () => {
    const base = {
      stage: "grundning" as const,
      latencyMs: 1,
      usage: { input_tokens: 1_000_000, output_tokens: 0 },
      stopReason: "end_turn",
    };
    const haiku = buildCallMetrics({ ...base, model: "claude-haiku-4-5" });
    const sonnet = buildCallMetrics({ ...base, model: "claude-sonnet-5-5" });
    expect(haiku.costSek).toBeCloseTo(sonnet.costSek / 2);
    expect(() => buildCallMetrics({ ...base, model: "claude-okand" })).toThrow(/claude-okand/);
  });

  it("stopReason blir null när fältet saknas (undefined) i svaret", () => {
    const metrics = buildCallMetrics({
      stage: "bedomning",
      model: "claude-sonnet-5",
      latencyMs: 10,
      usage: { input_tokens: 1, output_tokens: 1 },
      stopReason: undefined,
      pricing: SONNET_5_PRISSATTNING,
    });
    expect(metrics.stopReason).toBeNull();
  });
});

function call(overrides: Partial<ModelCallMetrics> = {}): ModelCallMetrics {
  return {
    stage: "grundning",
    model: "claude-sonnet-5",
    inputTokens: 1000,
    outputTokens: 200,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    latencyMs: 1000,
    stopReason: "end_turn",
    costSek: 1.5,
    ...overrides,
  };
}

describe("totalCostSek / totalLatencyMs", () => {
  it("summerar över flera anrop", () => {
    const calls = [
      call({ costSek: 1.5, latencyMs: 1000 }),
      call({ costSek: 0.5, latencyMs: 2000 }),
    ];
    expect(totalCostSek(calls)).toBeCloseTo(2.0, 10);
    expect(totalLatencyMs(calls)).toBe(3000);
  });

  it("returnerar 0 för en tom lista", () => {
    expect(totalCostSek([])).toBe(0);
    expect(totalLatencyMs([])).toBe(0);
  });
});

describe("formatCallMetricsTable", () => {
  it("skriver en rad per anrop plus rubrik", () => {
    const table = formatCallMetricsTable([call(), call({ stage: "extraktion" })]);
    const lines = table.split("\n");
    expect(lines.length).toBe(4); // header + separator + 2 rows
    expect(lines[0]).toContain("stage");
    expect(lines[0]).toContain("cost_sek");
    expect(table).toContain("grundning");
    expect(table).toContain("extraktion");
  });

  it("hanterar en tom lista utan att krascha", () => {
    expect(formatCallMetricsTable([])).toBe("(inga API-anrop)");
  });
});

describe("annotateSpend / errorHasKnownSpend", () => {
  it("gör spentSek/calls läsbara på felobjektet efteråt", () => {
    const error = new Error("kaputt");
    const calls = [call()];

    annotateSpend(error, 3.14, calls);

    expect(errorHasKnownSpend(error)).toBe(true);
    if (errorHasKnownSpend(error)) {
      expect(error.spentSek).toBe(3.14);
      expect(error.calls).toEqual(calls);
    }
  });

  it("errorHasKnownSpend är false för ett vanligt, oannoterat fel", () => {
    expect(errorHasKnownSpend(new Error("vanligt fel"))).toBe(false);
  });

  it("errorHasKnownSpend är false för ett icke-Error-värde", () => {
    expect(errorHasKnownSpend("sträng")).toBe(false);
    expect(errorHasKnownSpend(undefined)).toBe(false);
  });
});

describe("cacheHitRate", () => {
  it("är cache_read / (input + cache_creation + cache_read)", () => {
    const rate = cacheHitRate([
      call({ inputTokens: 100, cacheCreationInputTokens: 200, cacheReadInputTokens: 0 }),
      call({ inputTokens: 100, cacheCreationInputTokens: 0, cacheReadInputTokens: 600 }),
    ]);
    expect(rate).toBeCloseTo(600 / 1000);
  });

  it("är 0 utan anrop", () => {
    expect(cacheHitRate([])).toBe(0);
  });
});
