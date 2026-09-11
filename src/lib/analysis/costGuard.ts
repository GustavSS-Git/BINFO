/**
 * Development-only spend cap (MAX_COST_PER_ANALYSIS_SEK). Not a
 * product-facing figure — an internal safety rail so an iterating prompt
 * can't silently rack up API cost.
 */

// TODO: unverified placeholder — approximate USD/SEK rate, ~9.7 as of
// 2026-09-11 (xe.com, ofx.com). Refresh periodically; a few percent of
// drift doesn't matter for a dev safety rail.
const USD_TILL_SEK = 9.7;

export interface ModelPricing {
  /** USD per 1,000,000 input tokens. */
  inputPerMtok: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMtok: number;
}

/** claude-sonnet-5: $2 / $10 per MTok. */
export const SONNET_5_PRISSATTNING: ModelPricing = { inputPerMtok: 2, outputPerMtok: 10 };

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
