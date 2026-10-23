import { describe, expect, it, vi } from "vitest";
import type { ExtractionResult, Figure } from "@/types/analysis";
import { analysera, runAnalys } from "./analyze";
import { extraktion } from "./__fixtures__/extraktion";
import { estimateCostFromUsageSek, SONNET_5_PRISSATTNING } from "./costGuard";
import { beraknaFastaVarden } from "./fastaVarden";
import {
  byggMotiveringRequest,
  fallbackMotivering,
  MOTIVERING_MAX_TOKENS,
  MotiveringSvarSchema,
  tolkaMotiveringSvar,
} from "./motivering";
import { buildMotiveringSystemPrompt, buildMotiveringUserPrompt } from "./prompts";
import { ModelRefusedError, type AnthropicClientLike } from "./runExtraction";
import { ModelTruncatedError } from "./extract";

const kr = (value: number | null, excerpt?: string): Figure => ({
  value,
  unit: "kr",
  source: "arsredovisning",
  ...(excerpt ? { ref: { page: 12, excerpt } } : {}),
});

/** The real 2026-10-23 report: 7 759 091 kr in loans, 5 759 091 kr (74 %) maturing 2026. */
function verklig(statusar?: Array<"god" | "svag" | "kritisk" | "okant">): ExtractionResult {
  const e = structuredClone(extraktion) as ExtractionResult;
  e.forening.lanebok = {
    totalSkuld: kr(7_759_091, "Summa skulder till kreditinstitut 7 759 091"),
    forfalloprofil: [
      { ar: 2026, belopp: kr(5_759_091, "Förfaller 2026 5 759 091") },
      { ar: 2029, belopp: kr(2_000_000) },
    ],
  };
  if (statusar) {
    e.forening.keyFigures.forEach((kf, i) => {
      kf.status = statusar[i] ?? "okant";
    });
  }
  return e;
}

const flagga = {
  id: "omsattning",
  titel: "Stor del av lånen omsätts 2026",
  beskrivning: "Räntekänsligheten är 9,2 %.",
  severity: "hog",
  harledsFran: ["rantekanslighet"],
};

function bedomning(betyg: string, betygMotivering: string) {
  return { betyg, betygMotivering, rodaFlaggor: [flagga], fragor: [] };
}

const RATT = "5 759 091 kr av 7 759 091 kr, cirka 74 %, förfaller 2026.";
const FEL = "6 759 091 kr av 7 759 091 kr (cirka 87 %) förfaller 2026.";
const NY = "Betyget C beror på att 74 % av lånen förfaller 2026, 5 759 091 kr.";

const tyst = () => {};

describe("analysera: motivation flow with injected callers", () => {
  it("no clamp and clean numbers: exactly one call, motivation untouched", async () => {
    const callModel = vi.fn().mockResolvedValue(bedomning("D", RATT));
    const callMotivering = vi.fn();
    const e = verklig(["kritisk", "svag"]); // C-E
    const r = await analysera(e, callModel, callMotivering, tyst);
    expect(r.betyg).toBe("D");
    expect(r.betygMotivering).toBe(RATT);
    expect(callModel).toHaveBeenCalledTimes(1);
    expect(callMotivering).not.toHaveBeenCalled();
  });

  it("the judging user prompt carries the fixed values and the allowed grades", async () => {
    const callModel = vi.fn().mockResolvedValue(bedomning("D", RATT));
    await analysera(verklig(["kritisk", "svag"]), callModel, vi.fn(), tyst);
    const [system, user] = callModel.mock.calls[0]!;
    expect(user).toContain("Fasta värden");
    expect(user).toContain("Tillåtna betyg: C, D, E");
    expect(user).toContain("2026: 5 759 091 kr (74,2 % av totala skulden)");
    expect(system).toContain("Fasta värden");
    expect(system).not.toContain("Du får räkna ut andelar och summor");
  });

  it("a clamped letter: two calls and the rewritten motivation is used", async () => {
    // No svag/kritisk -> A-C; the model says E and argues for it.
    const callModel = vi.fn().mockResolvedValue(bedomning("E", RATT));
    const callMotivering = vi.fn().mockResolvedValue({ betygMotivering: `  ${NY}  ` });
    const r = await analysera(verklig([]), callModel, callMotivering, tyst);
    expect(r.betyg).toBe("C");
    expect(r.betygMotivering).toBe(NY);
    expect(callModel).toHaveBeenCalledTimes(1);
    expect(callMotivering).toHaveBeenCalledTimes(1);
    const [system, user] = callMotivering.mock.calls[0]!;
    expect(system).toBe(buildMotiveringSystemPrompt());
    expect(user).toContain("Fastställt betyg: C");
    expect(user).toContain("Det första förslaget var betyget E");
    expect(user).toContain("Stor del av lånen omsätts 2026");
    expect(user).toContain(RATT); // previous motivation as material
  });

  it("wrong numbers without a clamp: two calls, the reasons name the numbers", async () => {
    const callModel = vi.fn().mockResolvedValue(bedomning("D", FEL));
    const callMotivering = vi.fn().mockResolvedValue({ betygMotivering: NY });
    const r = await analysera(verklig(["kritisk", "svag"]), callModel, callMotivering, tyst);
    expect(r.betyg).toBe("D");
    expect(r.betygMotivering).toBe(NY);
    expect(callMotivering).toHaveBeenCalledTimes(1);
    const [, user] = callMotivering.mock.calls[0]!;
    expect(user).toContain("6 759 091 kr");
    expect(user).toContain("87 %");
    expect(user).not.toContain("Det första förslaget var betyget");
  });

  it("the rewrite still has a wrong number: deterministic fallback and a warning", async () => {
    const callModel = vi.fn().mockResolvedValue(bedomning("D", FEL));
    const callMotivering = vi.fn().mockResolvedValue({ betygMotivering: FEL });
    const logg = vi.fn();
    const r = await analysera(verklig(["kritisk", "svag"]), callModel, callMotivering, logg);
    expect(callMotivering).toHaveBeenCalledTimes(1);
    const etiketter = verklig(["kritisk", "svag"]).forening.keyFigures.map((k) => k.label);
    expect(r.betygMotivering).toBe(
      `Betyget D bygger på föreningens sju nyckeltal: ett av dem har status kritisk (${etiketter[0]}) och ett har status svag (${etiketter[1]}).`,
    );
    expect(logg.mock.calls.some((c) => String(c[0]).includes("reservmotivering"))).toBe(true);
  });

  it("the rewrite call throws: fallback, the analysis does not fail", async () => {
    const callModel = vi.fn().mockResolvedValue(bedomning("E", RATT));
    const callMotivering = vi.fn().mockRejectedValue(new Error("nätverksfel"));
    const logg = vi.fn();
    const r = await analysera(verklig([]), callModel, callMotivering, logg);
    expect(r.betyg).toBe("C");
    expect(r.betygMotivering).toBe(
      "Betyget C bygger på föreningens sju nyckeltal: inget av dem har status svag eller kritisk.",
    );
    expect(JSON.stringify(logg.mock.calls)).toContain("nätverksfel");
  });

  it("the rewrite returns an invalid shape: fallback", async () => {
    for (const ogiltigt of [{ betygMotivering: "   " }, { annat: "x" }, "text", null]) {
      const callModel = vi.fn().mockResolvedValue(bedomning("E", RATT));
      const callMotivering = vi.fn().mockResolvedValue(ogiltigt);
      const r = await analysera(verklig([]), callModel, callMotivering, tyst);
      expect(r.betygMotivering).toMatch(/^Betyget C bygger på/);
    }
  });

  it("a judging retry that ends in an error still throws (the rewrite is never reached)", async () => {
    const callModel = vi.fn().mockResolvedValue({ helt: "fel" });
    const callMotivering = vi.fn();
    await expect(analysera(verklig([]), callModel, callMotivering, tyst)).rejects.toThrow();
    expect(callMotivering).not.toHaveBeenCalled();
  });
});

describe("fallbackMotivering", () => {
  const med = (statusar: Array<"god" | "svag" | "kritisk" | "okant">) =>
    beraknaFastaVarden(verklig(statusar));
  const label = (i: number) => verklig().forening.keyFigures[i]!.label;

  it("none weak: states that no nyckeltal is svag or kritisk", () => {
    expect(fallbackMotivering("A", med(["god"]))).toBe(
      "Betyget A bygger på föreningens sju nyckeltal: inget av dem har status svag eller kritisk.",
    );
  });

  it("one svag, no kritisk (singular)", () => {
    expect(fallbackMotivering("B", med(["svag"]))).toBe(
      `Betyget B bygger på föreningens sju nyckeltal: ett av dem har status svag (${label(0)}) och inget har status kritisk.`,
    );
  });

  it("two svag, no kritisk (plural)", () => {
    expect(fallbackMotivering("C", med(["svag", "okant", "svag"]))).toBe(
      `Betyget C bygger på föreningens sju nyckeltal: två av dem har status svag (${label(0)}, ${label(2)}) och inget har status kritisk.`,
    );
  });

  it("kritisk only", () => {
    expect(fallbackMotivering("D", med(["okant", "kritisk"]))).toBe(
      `Betyget D bygger på föreningens sju nyckeltal: ett av dem har status kritisk (${label(1)}) och inget har status svag.`,
    );
  });

  it("many of both", () => {
    const text = fallbackMotivering("E", med(["kritisk", "kritisk", "svag", "svag", "svag"]));
    expect(text).toBe(
      `Betyget E bygger på föreningens sju nyckeltal: två av dem har status kritisk (${label(0)}, ${label(1)}) och tre har status svag (${label(2)}, ${label(3)}, ${label(4)}).`,
    );
  });
});

describe("motivation answer schema", () => {
  it("is strict, non-empty and trimmed", () => {
    expect(MotiveringSvarSchema.parse({ betygMotivering: "  Text.  " })).toEqual({
      betygMotivering: "Text.",
    });
    expect(MotiveringSvarSchema.safeParse({ betygMotivering: "" }).success).toBe(false);
    expect(MotiveringSvarSchema.safeParse({ betygMotivering: " \n " }).success).toBe(false);
    expect(MotiveringSvarSchema.safeParse({ betygMotivering: "x", extra: 1 }).success).toBe(false);
    expect(MotiveringSvarSchema.safeParse({}).success).toBe(false);
  });

  it("tolkaMotiveringSvar reads JSON, returns failures and throws on cut-off or refusal", () => {
    const usage = { input_tokens: 10, output_tokens: 10 };
    const ok = tolkaMotiveringSvar(
      {
        usage,
        content: [{ type: "text", text: '{"betygMotivering":"Kort."}' }],
        stop_reason: "end_turn",
      },
      4000,
    );
    expect(ok).toEqual({ ok: true, value: "Kort." });
    const fel = tolkaMotiveringSvar({ usage, content: [{ type: "text", text: '{"a":1}' }] }, 4000);
    expect(fel.ok).toBe(false);
    expect(() =>
      tolkaMotiveringSvar(
        { usage, content: [{ type: "text", text: "{" }], stop_reason: "max_tokens" },
        4000,
      ),
    ).toThrow(ModelTruncatedError);
    expect(() => tolkaMotiveringSvar({ usage, content: [], stop_reason: "refusal" }, 4000)).toThrow(
      ModelRefusedError,
    );
  });
});

describe("motivation request", () => {
  it("low effort, modest max_tokens, plain system string and a single user message", () => {
    const underlag = {
      betyg: "C" as const,
      klampadFran: "E" as const,
      avvikandeSiffror: ["6 759 091 kr"],
      fasta: beraknaFastaVarden(verklig([])),
      rodaFlaggor: [{ titel: "T", beskrivning: "B", severity: "hog" as const }],
      tidigareMotivering: "Tidigare.",
    };
    const req = byggMotiveringRequest(underlag, {
      model: "claude-sonnet-5-5",
      maxTokens: MOTIVERING_MAX_TOKENS,
      effort: "low",
    });
    expect(req).toEqual({
      model: "claude-sonnet-5-5",
      max_tokens: 4000,
      system: buildMotiveringSystemPrompt(),
      messages: [{ role: "user", content: buildMotiveringUserPrompt(underlag) }],
      output_config: { effort: "low" },
    });
  });
});

type CountTokens = AnthropicClientLike["messages"]["countTokens"];
type Create = AnthropicClientLike["messages"]["create"];

function fakeClient() {
  return {
    messages: { countTokens: vi.fn<CountTokens>(), create: vi.fn<Create>() },
  };
}

const svar = (obj: unknown, usage = { input_tokens: 2000, output_tokens: 500 }) => ({
  usage,
  content: [{ type: "text", text: JSON.stringify(obj) }],
  stop_reason: "end_turn",
});

describe("runAnalys: the rewrite call", () => {
  it("one call when nothing needs fixing", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 2000 });
    client.messages.create.mockResolvedValueOnce(svar(bedomning("D", RATT)));
    const r = await runAnalys(verklig(["kritisk"]), { maxCostSek: 5, client });
    expect(client.messages.create).toHaveBeenCalledTimes(1);
    expect(r.calls.map((c) => c.stage)).toEqual(["bedomning"]);
  });

  it("clamped: second call at low effort, tagged 'motivering', cost counted in spentSek and calls", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 2000 });
    const usage1 = { input_tokens: 3000, output_tokens: 4000 };
    const usage2 = { input_tokens: 1500, output_tokens: 300 };
    client.messages.create
      .mockResolvedValueOnce(svar(bedomning("E", RATT), usage1))
      .mockResolvedValueOnce(svar({ betygMotivering: NY }, usage2));

    const r = await runAnalys(verklig([]), {
      maxCostSek: 5,
      client,
      model: "claude-sonnet-5",
      effort: "medium",
    });

    expect(r.analys.betyg).toBe("C");
    expect(r.analys.betygMotivering).toBe(NY);
    expect(r.calls.map((c) => c.stage)).toEqual(["bedomning", "motivering"]);
    expect(r.calls[1]).toMatchObject({
      model: "claude-sonnet-5",
      inputTokens: 1500,
      outputTokens: 300,
    });
    const forvantat =
      estimateCostFromUsageSek(usage1, SONNET_5_PRISSATTNING) +
      estimateCostFromUsageSek(usage2, SONNET_5_PRISSATTNING);
    expect(r.spentSek).toBeCloseTo(forvantat, 10);

    const andra = client.messages.create.mock.calls[1]![0] as {
      model: string;
      max_tokens: number;
      output_config?: unknown;
    };
    expect(andra.model).toBe("claude-sonnet-5");
    expect(andra.max_tokens).toBe(MOTIVERING_MAX_TOKENS);
    expect(andra.output_config).toEqual({ effort: "low" });
    // The pre-flight count was made for the rewrite request too.
    expect(client.messages.countTokens).toHaveBeenCalledTimes(2);
  });

  it("the rewrite is cut off (max_tokens): fallback, the spend is still recorded", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 2000 });
    client.messages.create.mockResolvedValueOnce(svar(bedomning("E", RATT))).mockResolvedValueOnce({
      usage: { input_tokens: 1500, output_tokens: 4000 },
      content: [{ type: "text", text: '{"betygMotivering": "Bety' }],
      stop_reason: "max_tokens",
    });
    const varna = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await runAnalys(verklig([]), { maxCostSek: 5, client });
    varna.mockRestore();
    expect(r.analys.betygMotivering).toMatch(/^Betyget C bygger på/);
    expect(r.calls).toHaveLength(2);
    expect(r.spentSek).toBeGreaterThan(r.calls[0]!.costSek);
  });

  it("the rewrite is refused: fallback", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 2000 });
    client.messages.create.mockResolvedValueOnce(svar(bedomning("E", RATT))).mockResolvedValueOnce({
      usage: { input_tokens: 1500, output_tokens: 20 },
      content: [],
      stop_reason: "refusal",
    });
    const varna = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await runAnalys(verklig([]), { maxCostSek: 5, client });
    varna.mockRestore();
    expect(r.analys.betygMotivering).toMatch(/^Betyget C bygger på/);
  });

  it("an API error on the rewrite: fallback and no extra spend", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 2000 });
    client.messages.create
      .mockResolvedValueOnce(svar(bedomning("E", RATT)))
      .mockRejectedValueOnce(new Error("529 overloaded"));
    const varna = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await runAnalys(verklig([]), { maxCostSek: 5, client });
    varna.mockRestore();
    expect(r.analys.betyg).toBe("C");
    expect(r.calls).toHaveLength(1);
    expect(r.spentSek).toBeCloseTo(r.calls[0]!.costSek, 10);
  });

  it("the rewrite does not fit in what is left of the budget: fallback, no second call", async () => {
    const client = fakeClient();
    client.messages.countTokens
      .mockResolvedValueOnce({ input_tokens: 2000 })
      .mockResolvedValueOnce({ input_tokens: 2000 });
    client.messages.create.mockResolvedValueOnce(svar(bedomning("E", RATT)));
    // Enough for the judging call's worst case, not for a second one on top of what it cost.
    const forbrukat = estimateCostFromUsageSek(
      { input_tokens: 2000, output_tokens: 500 },
      SONNET_5_PRISSATTNING,
    );
    const varna = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await runAnalys(verklig([]), {
      maxCostSek: forbrukat + 0.01,
      maxOutputTokens: 500,
      client,
      model: "claude-sonnet-5",
      pricing: SONNET_5_PRISSATTNING,
    });
    varna.mockRestore();
    expect(client.messages.create).toHaveBeenCalledTimes(1);
    expect(r.analys.betygMotivering).toMatch(/^Betyget C bygger på/);
  });
});
