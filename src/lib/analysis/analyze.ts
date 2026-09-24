import type { AnalysisResult, ExtractionResult, Fraga, PageRef } from "@/types/analysis";
import {
  ModelTruncatedError,
  ModelValidationError,
  validateWithRetry,
  type ModelCaller,
} from "./extract";
import { buildAnalysSystemPrompt, buildAnalysUserPrompt } from "./prompts";
import { buildAnalysJudgementSchema } from "./schema";
import {
  parseModelJson,
  resolveClient,
  type AnthropicClientLike,
  type ModelEffort,
} from "./runExtraction";
import {
  enforceCostLimit,
  estimateCostSek,
  SONNET_5_PRISSATTNING,
  type ModelPricing,
} from "./costGuard";
import { annotateSpend, buildCallMetrics, type ModelCallMetrics } from "./callMetrics";
import type { z } from "zod";

/**
 * Pass 2 — the judgement layer. Takes the already-graded ExtractionResult
 * from pass 1 and produces only the parts of AnalysisResult that require a
 * judgement: the grade, the red flags and the analysis-derived questions.
 *
 * Deliberately NOT the whole AnalysisResult. Price reconciliation, the rate
 * stress test and the cost model are pure functions with verifiable right
 * answers (see PIPELINE.md) and must never be produced by a model. The
 * 'saknad_uppgift' half of `fragor` is likewise generated deterministically
 * elsewhere — this pass only ever emits ursprung 'analys'.
 *
 * The seven statutory key figures arrive already graded by benchmarks.ts.
 * The model receives their `status` and `benchmark` as given and reasons
 * about the combination; the system prompt forbids re-grading them, because
 * a model grading them itself produced contradictory results across reports.
 *
 * Input is text (JSON), not a PDF: no document block and no citations
 * feature in this pass. Everything the model may cite is therefore already
 * in its input, which is what makes the page-number check below possible.
 */

/** A question produced by this pass. Always ursprung 'analys'. */
export type AnalysFraga = Omit<Fraga, "ursprung"> & { ursprung: "analys" };

/** The subset of AnalysisResult this pass is responsible for. */
export type AnalysJudgement = Pick<AnalysisResult, "betyg" | "betygMotivering" | "rodaFlaggor"> & {
  fragor: AnalysFraga[];
};

export class AnalysValidationError extends ModelValidationError {
  constructor(zodError: z.ZodError, raw: unknown, attempts: number) {
    super("Analysen", zodError, raw, attempts);
    this.name = "AnalysValidationError";
  }
}

function samlaSidor(varde: unknown, sidor: Set<number>): void {
  if (Array.isArray(varde)) {
    for (const post of varde) samlaSidor(post, sidor);
    return;
  }
  if (varde === null || typeof varde !== "object") return;
  for (const [nyckel, undervarde] of Object.entries(varde)) {
    if (
      nyckel === "ref" &&
      undervarde !== null &&
      typeof undervarde === "object" &&
      typeof (undervarde as PageRef).page === "number"
    ) {
      sidor.add((undervarde as PageRef).page);
    }
    samlaSidor(undervarde, sidor);
  }
}

/**
 * Every page number that actually occurs in the extraction. Walks the whole
 * structure rather than enumerating the known ref sites: missing one would
 * mean rejecting a legitimate citation, and the contract may grow more
 * optional refs (it already has several) without this needing an edit.
 */
export function tillatnaSidor(extraction: ExtractionResult): Set<number> {
  const sidor = new Set<number>();
  samlaSidor(extraction, sidor);
  return sidor;
}

/**
 * The testable half: prompts + validation + the one retry, with the model
 * call injected. Model output is untrusted input — an invented KeyFigureId,
 * an invented page number or a 'saknad_uppgift' question fails validation
 * and gets one retry, then surfaces a clear error. Never a silent empty
 * analysis.
 */
export async function analysera(
  extraction: ExtractionResult,
  callModel: ModelCaller,
): Promise<AnalysJudgement> {
  const sidor = tillatnaSidor(extraction);
  const parsed = await validateWithRetry(
    buildAnalysJudgementSchema(sidor),
    buildAnalysSystemPrompt(),
    buildAnalysUserPrompt(extraction, sidor),
    callModel,
    (zodError, raw, attempts) => new AnalysValidationError(zodError, raw, attempts),
  );
  // Zod's inferred optional-field type allows an explicit `undefined`;
  // exactOptionalPropertyTypes doesn't. Runtime shape is already
  // Zod-verified — this reconciles the two type systems, nothing more.
  return parsed as AnalysJudgement;
}

export interface RunAnalysOptions {
  apiKey?: string;
  model?: string;
  /** Remaining budget for this pass, in SEK. */
  maxCostSek: number;
  pricing?: ModelPricing;
  /** Worst-case output tokens assumed for the pre-flight cost check. */
  maxOutputTokens?: number;
  /** Injected for tests (and, since the orchestration split, steg.ts's
   *  judging step); production omits this and gets a real Anthropic client —
   *  same resolution as runGrounding/runStructuredExtraction (runExtraction.ts). */
  client?: AnthropicClientLike;
  /** Reasoning depth for this call — see `ModelEffort` in runExtraction.ts.
   *  Left unset by default (Sonnet 5's own adaptive-thinking default). */
  effort?: ModelEffort;
}

export interface RunAnalysResult {
  analys: AnalysJudgement;
  spentSek: number;
  /** Always one entry, or two if validateWithRetry's one retry fired. */
  calls: ModelCallMetrics[];
}

/**
 * The wired half: one API call, cost-capped before the request is made
 * (enforceCostLimit against what is left of the budget), retried at most
 * once by analysera above.
 */
export async function runAnalys(
  extraction: ExtractionResult,
  options: RunAnalysOptions,
): Promise<RunAnalysResult> {
  const {
    model = "claude-sonnet-5",
    maxCostSek,
    pricing = SONNET_5_PRISSATTNING,
    // 16000, not the earlier 8000: a live run against "Volontären" hit
    // stop_reason "max_tokens" on both attempts (Sonnet 5's adaptive
    // thinking alone used ~7k of the 8000-token cap, leaving no room for the
    // JSON answer) — see ModelTruncatedError below, and the max_tokens
    // finding in the task report.
    maxOutputTokens = 16000,
    effort,
  } = options;

  const client = resolveClient(options);
  let spentSek = 0;
  const calls: ModelCallMetrics[] = [];

  const callModel: ModelCaller = async (system, user) => {
    const messages = [{ role: "user" as const, content: user }];
    const count = await client.messages.countTokens({ model, system, messages });
    enforceCostLimit(count.input_tokens, maxOutputTokens, maxCostSek - spentSek, pricing);

    const start = performance.now();
    const response = await client.messages.create({
      model,
      max_tokens: maxOutputTokens,
      system,
      messages,
      ...(effort ? { output_config: { effort } } : {}),
    });
    const latencyMs = performance.now() - start;
    spentSek += estimateCostSek(response.usage.input_tokens, response.usage.output_tokens, pricing);
    calls.push(
      buildCallMetrics({
        stage: "bedomning",
        model,
        latencyMs,
        usage: response.usage,
        stopReason: response.stop_reason,
        pricing,
      }),
    );

    // A truncated response is a capacity problem, not a shape problem —
    // diagnose it as one immediately rather than let it surface later as an
    // opaque JSON-parse/validation failure after a wasted retry.
    if (response.stop_reason === "max_tokens") {
      throw annotateSpend(new ModelTruncatedError("Bedömningen", maxOutputTokens), spentSek, calls);
    }

    return parseModelJson(response.content);
  };

  let analys: AnalysJudgement;
  try {
    analys = await analysera(extraction, callModel);
  } catch (error) {
    // Same reasoning as runStructuredExtraction's catch (runExtraction.ts):
    // a validation error thrown after validateWithRetry's own retry already
    // reflects real, paid calls, not 0 kr.
    throw error instanceof Error ? annotateSpend(error, spentSek, calls) : error;
  }
  return { analys, spentSek, calls };
}
