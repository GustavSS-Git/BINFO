import type { AnalysisResult, ExtractionResult, Fraga } from "@/types/analysis";
import { ModelValidationError, provaMedOmforsok, type ModelCaller, type Utfall } from "./extract";
import { buildAnalysSystemPrompt, buildAnalysUserPrompt } from "./prompts";
import {
  type BegarInst,
  type PromptCacheMode,
  type SkapaParams,
  type SvarMeddelande,
  buildSystemParam,
  buildUserContent,
  kontrolleraStoppgrund,
  parseModelJson,
  resolveClient,
  tillRakneParams,
  type AnthropicClientLike,
  type ModelEffort,
} from "./runExtraction";
import { slutforBedomning, tillatnaSidor } from "./slutfor";
import {
  enforceCostLimit,
  prissattningForModell,
  STANDARD_MODELL,
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

// Kept importable from here (callers and tests predate slutfor.ts).
export { tillatnaSidor };

// ---------------------------------------------------------------------------
// Build / parse (docs/PLAN-v3.md §3.2): the request is a pure function of the
// finished extraction, the answer is read against the same extraction.
// ---------------------------------------------------------------------------

export interface BedomningInst extends BegarInst {
  promptCache: PromptCacheMode;
}

/** The judging request from ready-made prompt texts (one attempt). */
export function byggBedomningRequestFranPrompt(
  systemText: string,
  userText: string,
  inst: BedomningInst,
): SkapaParams {
  const { model, maxTokens, effort, promptCache } = inst;
  return {
    model,
    max_tokens: maxTokens,
    system: buildSystemParam(systemText, promptCache),
    messages: [{ role: "user" as const, content: buildUserContent(userText, promptCache) }],
    ...(effort ? { output_config: { effort } } : {}),
  };
}

/** The judging request for a finished (verified) extraction. */
export function byggBedomningRequest(
  extraction: ExtractionResult,
  inst: BedomningInst,
): SkapaParams {
  return byggBedomningRequestFranPrompt(
    buildAnalysSystemPrompt(),
    buildAnalysUserPrompt(extraction, tillatnaSidor(extraction)),
    inst,
  );
}

/** The model's parsed JSON from one judging answer; throws on a refusal or cut-off. */
export function raBedomningssvar(svar: SvarMeddelande, maxTokens: number): unknown {
  kontrolleraStoppgrund(svar, "Bedömningen", maxTokens);
  return parseModelJson(svar.content);
}

/** One judging answer, read and validated against the extraction it was written
 *  for (invented ids, pages and 'saknad_uppgift' questions fail). A failed
 *  validation is returned, not thrown — the caller owns the retry. */
export function tolkaBedomningSvar(
  svar: SvarMeddelande,
  extraction: ExtractionResult,
  maxTokens: number,
): Utfall<AnalysJudgement> {
  return slutforBedomning(extraction, raBedomningssvar(svar, maxTokens));
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
  const systemText = buildAnalysSystemPrompt();
  const userText = buildAnalysUserPrompt(extraction, tillatnaSidor(extraction));
  return provaMedOmforsok(
    () => callModel(systemText, userText),
    (raw) => slutforBedomning(extraction, raw),
    (zodError, raw, attempts) => new AnalysValidationError(zodError, raw, attempts),
  );
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
  /** Explicit prompt-cache breakpoints on the static system block and the
   *  user block (so the validation retry reads it from cache). Default true. */
  promptCache?: PromptCacheMode;
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
    model = STANDARD_MODELL,
    maxCostSek,
    pricing = prissattningForModell(model),
    // 16000, not the earlier 8000: a live run against "Volontären" hit
    // stop_reason "max_tokens" on both attempts (Sonnet 5's adaptive
    // thinking alone used ~7k of the 8000-token cap, leaving no room for the
    // JSON answer) — see ModelTruncatedError below, and the max_tokens
    // finding in the task report.
    maxOutputTokens = 16000,
    effort,
    promptCache = false,
  } = options;

  const client = resolveClient(options);
  let spentSek = 0;
  const calls: ModelCallMetrics[] = [];

  const callModel: ModelCaller = async (systemText, userText) => {
    const begaran = byggBedomningRequestFranPrompt(systemText, userText, {
      model,
      maxTokens: maxOutputTokens,
      effort,
      promptCache,
    });
    // Pre-flight stays worst case: assumes no cache read (full input price).
    const count = await client.messages.countTokens(tillRakneParams(begaran));
    enforceCostLimit(count.input_tokens, maxOutputTokens, maxCostSek - spentSek, pricing);

    const start = performance.now();
    const response = await client.messages.create(begaran);
    const latencyMs = performance.now() - start;
    const metrics = buildCallMetrics({
      stage: "bedomning",
      model,
      latencyMs,
      usage: response.usage,
      stopReason: response.stop_reason,
      pricing,
    });
    calls.push(metrics);
    spentSek += metrics.costSek;

    try {
      // A truncated response is a capacity problem, not a shape problem —
      // diagnosed immediately rather than surfacing later as an opaque
      // JSON-parse/validation failure after a wasted retry.
      return raBedomningssvar(response, maxOutputTokens);
    } catch (error) {
      throw error instanceof Error ? annotateSpend(error, spentSek, calls) : error;
    }
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
