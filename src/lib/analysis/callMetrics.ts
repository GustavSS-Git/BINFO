/**
 * Per-API-call instrumentation, shared by all three pipeline stages
 * (runGrounding/runStructuredExtraction in runExtraction.ts, runAnalys in
 * analyze.ts) and the CLIs that print it (cli.ts, verifyAnswerKey.ts).
 *
 * Per this pipeline's speed-work task brief: "report per API call: model,
 * input_tokens, output_tokens, cache_creation_input_tokens,
 * cache_read_input_tokens and latency." This module is the one place that
 * shape is defined, so every caller reports the same fields the same way
 * instead of each stage inventing its own ad-hoc console.log.
 */

import { estimateCostFromUsageSek, prissattningForModell, type ModelPricing } from "./costGuard";

export type PipelineStage =
  | "identifiering"
  | "transkribering"
  | "grundning"
  | "extraktion"
  | "bedomning"
  // The small extra call that rewrites betygMotivering (motivering.ts); part of the judging stage.
  | "motivering";

/** One real (or faked, in tests) `messages.create` call. */
export interface ModelCallMetrics {
  stage: PipelineStage;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  latencyMs: number;
  stopReason: string | null;
  /** Actual cost from this call's real usage — NOT the pre-flight worst-case
   *  estimate enforceCostLimit checks against. */
  costSek: number;
}

/** Minimal shape of a `messages.create` response's `usage` field this module
 *  needs — matches (a strict subset of) AnthropicClientLike's `create()`
 *  return type in runExtraction.ts. */
export interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/** Builds one `ModelCallMetrics` record from a completed call's raw usage,
 *  stop_reason and measured wall-clock latency. */
export function buildCallMetrics(args: {
  stage: PipelineStage;
  model: string;
  latencyMs: number;
  usage: UsageLike;
  stopReason: string | null | undefined;
  /** Defaults to `prissattningForModell(model)` (throws for an unknown model). */
  pricing?: ModelPricing;
}): ModelCallMetrics {
  const pricing = args.pricing ?? prissattningForModell(args.model);
  return {
    stage: args.stage,
    model: args.model,
    inputTokens: args.usage.input_tokens,
    outputTokens: args.usage.output_tokens,
    cacheCreationInputTokens: args.usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: args.usage.cache_read_input_tokens ?? 0,
    latencyMs: args.latencyMs,
    stopReason: args.stopReason ?? null,
    // Real usage incl. cache writes (1.25x) and reads (0.1x).
    costSek: estimateCostFromUsageSek(args.usage, pricing),
  };
}

export function totalCostSek(calls: readonly ModelCallMetrics[]): number {
  return calls.reduce((sum, c) => sum + c.costSek, 0);
}

export function totalLatencyMs(calls: readonly ModelCallMetrics[]): number {
  return calls.reduce((sum, c) => sum + c.latencyMs, 0);
}

/** Share of all input tokens served from the prompt cache:
 *  cache_read / (input + cache_creation + cache_read). 0 when there is no input. */
export function cacheHitRate(calls: readonly ModelCallMetrics[]): number {
  const read = calls.reduce((s, c) => s + c.cacheReadInputTokens, 0);
  const total = calls.reduce(
    (s, c) => s + c.inputTokens + c.cacheCreationInputTokens + c.cacheReadInputTokens,
    0,
  );
  return total === 0 ? 0 : read / total;
}

/** Renders a fixed-width, human-readable table — one row per API call — for
 *  CLI output (cli.ts, verifyAnswerKey.ts). Not JSON: this is for a human
 *  reading stderr/stdout during a manual run, not for machine consumption. */
export function formatCallMetricsTable(calls: readonly ModelCallMetrics[]): string {
  if (calls.length === 0) return "(inga API-anrop)";

  const header = [
    "stage",
    "model",
    "input",
    "output",
    "cache_w",
    "cache_r",
    "latency_ms",
    "stop_reason",
    "cost_sek",
  ];
  const rows = calls.map((c) => [
    c.stage,
    c.model,
    String(c.inputTokens),
    String(c.outputTokens),
    String(c.cacheCreationInputTokens),
    String(c.cacheReadInputTokens),
    c.latencyMs.toFixed(0),
    c.stopReason ?? "-",
    c.costSek.toFixed(3),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cols: string[]) => cols.map((c, i) => c.padEnd(widths[i]!)).join("  ");

  return [line(header), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n");
}

// ---------------------------------------------------------------------------
// Spend-on-error annotation (see steg.ts's avslutaMedFel and the reviewer
// finding it fixes: an error thrown AFTER a real, paid API response — most
// commonly ModelTruncatedError, but any ModelValidationError thrown after
// validateWithRetry's calls also had already paid for its own retries — must
// not be recorded as "0 kr spent" against the daily spend guard. Every
// throwing call site in runExtraction.ts/analyze.ts knows exactly how much it
// has actually spent (and which calls) at the moment it throws; this
// annotates that onto the error object itself rather than widening every
// pipeline error class's constructor, so steg.ts can read it back generically
// regardless of which specific error type propagated.
// ---------------------------------------------------------------------------

export interface SpendKnown {
  /** Real spend already incurred (from actual `usage`, not a pre-flight
   *  estimate) before this error was thrown. 0 for an error that never made
   *  it past enforceCostLimit's pre-flight check — that case already means
   *  "0 kr spent" for real. */
  readonly spentSek: number;
  readonly calls: readonly ModelCallMetrics[];
}

/** Mutates `error` to carry `spentSek`/`calls`, then returns it (for a
 *  `throw annotateSpend(error, ...)` one-liner). Safe to call more than once
 *  on the same error — the last call wins, matching "the most complete
 *  information available at the point closest to the throw". */
export function annotateSpend<E extends Error>(
  error: E,
  spentSek: number,
  calls: readonly ModelCallMetrics[],
): E & SpendKnown {
  return Object.assign(error, { spentSek, calls });
}

export function errorHasKnownSpend(error: unknown): error is Error & SpendKnown {
  return (
    error instanceof Error &&
    typeof (error as Partial<SpendKnown>).spentSek === "number" &&
    Array.isArray((error as Partial<SpendKnown>).calls)
  );
}
