/**
 * Development-only spend cap (MAX_COST_PER_ANALYSIS_SEK). Not a
 * product-facing figure — an internal safety rail so an iterating prompt
 * can't silently rack up API cost.
 */

// TODO: unverified placeholder — approximate USD/SEK rate, ~9.7 as of
// 2026-09-11 (xe.com, ofx.com). Refresh periodically; a few percent of
// drift doesn't matter for a dev safety rail.
const USD_TILL_SEK = 9.7;

/**
 * Default model for every pipeline call (and the web app's ANTHROPIC_MODEL
 * fallback). Switched from claude-sonnet-5 on 2026-10-09 after a measured A/B
 * on 3 answer-keyed reports: identical extraction accuracy (64/65 both), ~2x
 * lower latency, ~9 % lower cost (docs/PLAN-v2.md §9 D9, docs/api-test-log.md).
 */
export const STANDARD_MODELL = "claude-sonnet-5-5";

export interface ModelPricing {
  /** USD per 1,000,000 input tokens. */
  inputPerMtok: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMtok: number;
}

/**
 * Per-model list prices, USD per million tokens.
 * Source: Anthropic models table, cached 2026-09-25 (platform docs,
 * "Models overview"): claude-sonnet-5 and claude-sonnet-5-5 $2 in / $10 out;
 * claude-haiku-4-5 $1 in / $5 out.
 */
export const SONNET_5_PRISSATTNING: ModelPricing = { inputPerMtok: 2, outputPerMtok: 10 };
export const SONNET_5_5_PRISSATTNING: ModelPricing = { inputPerMtok: 2, outputPerMtok: 10 };
export const HAIKU_4_5_PRISSATTNING: ModelPricing = { inputPerMtok: 1, outputPerMtok: 5 };

/** Prompt-cache multipliers on the base input price (Anthropic prompt caching
 *  docs): 5-minute TTL cache write = 1.25x, cache read = 0.1x. */
export const CACHE_WRITE_MULTIPLIER = 1.25;
export const CACHE_READ_MULTIPLIER = 0.1;

export class OkandModellPrissattningError extends Error {
  constructor(public readonly model: string) {
    super(
      `Okänd modell "${model}": ingen prissättning finns i costGuard.ts. Lägg till modellen där ` +
        `(eller skicka en explicit pricing) i stället för att riskera att kostnaden räknas som 0 kr.`,
    );
    this.name = "OkandModellPrissattningError";
  }
}

const PRISSATTNING_PER_MODELL: Record<string, ModelPricing> = {
  "claude-sonnet-5": SONNET_5_PRISSATTNING,
  "claude-sonnet-5-5": SONNET_5_5_PRISSATTNING,
  "claude-haiku-4-5": HAIKU_4_5_PRISSATTNING,
};

/** Pricing for a model id. A dated snapshot id (`-YYYYMMDD` suffix) resolves
 *  to its family. Unknown models throw — never silently priced at 0. */
export function prissattningForModell(model: string): ModelPricing {
  const exakt = PRISSATTNING_PER_MODELL[model];
  if (exakt) return exakt;
  const utanDatum = PRISSATTNING_PER_MODELL[model.replace(/-\d{8}$/, "")];
  if (utanDatum) return utanDatum;
  throw new OkandModellPrissattningError(model);
}

/** The `usage` fields cost depends on (subset of a `messages.create` response). */
export interface CostUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/**
 * Actual cost of a completed call, from its real `usage`: uncached input at the
 * input price, cache writes at 1.25x, cache reads at 0.1x, output at the output
 * price. (`input_tokens` excludes cached tokens, so the four buckets don't overlap.)
 * Not for pre-flight checks — see `enforceCostLimit`, which assumes no cache hit.
 */
export function estimateCostFromUsageSek(usage: CostUsage, pricing: ModelPricing): number {
  const usd =
    (usage.input_tokens / 1_000_000) * pricing.inputPerMtok +
    ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) *
      pricing.inputPerMtok *
      CACHE_WRITE_MULTIPLIER +
    ((usage.cache_read_input_tokens ?? 0) / 1_000_000) *
      pricing.inputPerMtok *
      CACHE_READ_MULTIPLIER +
    (usage.output_tokens / 1_000_000) * pricing.outputPerMtok;
  return usd * USD_TILL_SEK;
}

/** Pre-flight worst case: every input token at full price (assumes NO cache
 *  read), `maxOutputTokens` as output. */
export function estimateCostSek(
  inputTokens: number,
  maxOutputTokens: number,
  pricing: ModelPricing,
): number {
  const usd =
    (inputTokens / 1_000_000) * pricing.inputPerMtok +
    (maxOutputTokens / 1_000_000) * pricing.outputPerMtok;
  return usd * USD_TILL_SEK;
}

export class KostnadsgransOverskriden extends Error {
  constructor(
    public readonly estimatedCostSek: number,
    public readonly limitSek: number,
  ) {
    super(
      `Uppskattad kostnad ${estimatedCostSek.toFixed(2)} kr överstiger ` +
        `MAX_COST_PER_ANALYSIS_SEK (${limitSek} kr). Avbryter innan anropet görs.`,
    );
    this.name = "KostnadsgransOverskriden";
  }
}

/**
 * Pre-flight check — call before the actual API request. Estimates worst
 * case (input tokens + full max_tokens as output) and aborts rather than
 * risk exceeding the cap, per PIPELINE.md: "Pipeline should abort rather
 * than exceed this."
 */
export function enforceCostLimit(
  inputTokens: number,
  maxOutputTokens: number,
  limitSek: number,
  pricing: ModelPricing,
): void {
  const estimate = estimateCostSek(inputTokens, maxOutputTokens, pricing);
  if (estimate > limitSek) {
    throw new KostnadsgransOverskriden(estimate, limitSek);
  }
}
