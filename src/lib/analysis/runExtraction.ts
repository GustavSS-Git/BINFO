import Anthropic from "@anthropic-ai/sdk";
import type { ExtractionResult } from "@/types/analysis";
import { berikaNyckeltal, implausibelNegativAnmarkning } from "./benchmarks";
import { extractPdfText } from "./pdf";
import { ModelTruncatedError, extractWithRetry, type ModelCaller } from "./extract";
import {
  harledSkuldfriaNyckeltal,
  rensaSkuldfriaKonfidensSkal,
  tolkaNyckeltal,
} from "./tolkaVarde";
import {
  buildExtractionSystemPrompt,
  buildExtractionUserPrompt,
  buildGroundingSystemPrompt,
  buildGroundingUserPrompt,
  extractGroundingFindings,
  formatGroundingForExtraction,
  type GroundingTextBlock,
} from "./prompts";
import {
  enforceCostLimit,
  estimateCostSek,
  SONNET_5_PRISSATTNING,
  type ModelPricing,
} from "./costGuard";
import { annotateSpend, buildCallMetrics, type ModelCallMetrics } from "./callMetrics";

/**
 * Sonnet 5's reasoning depth for a call (see `OutputConfig.effort` in the
 * SDK's own types). Left `undefined` by default everywhere in this module —
 * an unset `output_config.effort` is what gives Sonnet 5's default adaptive
 * thinking behaviour (see CLAUDE.md/the task brief); only set it explicitly
 * to deliberately trade quality for latency/cost.
 */
export type ModelEffort = "low" | "medium" | "high" | "xhigh" | "max";

export class ScannedPdfError extends Error {
  constructor() {
    super(
      "PDF:en saknar textlager (verkar vara en skanning). Kan inte extrahera siffror ur en bild " +
        "— avbryter innan något API-anrop görs.",
    );
    this.name = "ScannedPdfError";
  }
}

/**
 * Minimal structural shape of the Anthropic client this module calls —
 * deliberately decoupled from the SDK's own (much larger, stricter)
 * parameter/response types so a test can hand-build a fake
 * `{ messages: { countTokens, create } }` without constructing a real
 * `Anthropic` instance or satisfying its full type. The one real client this
 * module ever constructs is cast to this shape at its construction site;
 * everything it actually returns already has these fields.
 */
export interface AnthropicClientLike {
  messages: {
    countTokens(params: {
      model: string;
      system: string;
      messages: Array<{ role: "user"; content: unknown }>;
    }): Promise<{ input_tokens: number }>;
    create(params: {
      model: string;
      max_tokens: number;
      system: string;
      messages: Array<{ role: "user"; content: unknown }>;
      /** Reasoning depth — see `ModelEffort`. Omitted entirely (not just
       *  `undefined`) unless a caller opts in, so the default adaptive-thinking
       *  behaviour is unaffected when nobody asks for anything different. */
      output_config?: { effort?: ModelEffort };
    }): Promise<{
      usage: {
        input_tokens: number;
        output_tokens: number;
        /** Present only when prompt caching is actually in play — absent
         *  (not just 0) on a plain, uncached call from the real API. */
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
      content: Array<{ type: string; text?: string; citations?: unknown }>;
      /** "max_tokens" means the response was cut off before it finished —
       *  see ModelTruncatedError. Optional because test doubles built before
       *  this field existed still omit it; treated the same as any other
       *  non-"max_tokens" value (i.e. not truncated). */
      stop_reason?: string | null;
    }>;
  };
}

export interface RunExtractionOptions {
  apiKey?: string;
  model?: string;
  maxCostSek: number;
  pricing?: ModelPricing;
  /** Worst-case output tokens assumed for the pre-flight cost check, per call. */
  maxOutputTokensGrounding?: number;
  maxOutputTokensExtraction?: number;
  /** Injected for tests; production omits this and gets a real Anthropic client. */
  client?: AnthropicClientLike;
  /** Reasoning depth for THIS call only — see `ModelEffort`. Left unset by
   *  default (adaptive thinking, Sonnet 5's own default). */
  effort?: ModelEffort;
}

export interface RunExtractionResult {
  extraction: ExtractionResult;
  spentSek: number;
  /** Every `messages.create` call this run actually made, in order —
   *  grounding's one call followed by extraction's one-or-two (on retry). */
  calls: ModelCallMetrics[];
}

/** Builds the real Anthropic client, cast to the narrow shape this module
 *  depends on — or returns the injected test double unchanged. Exported so
 *  analyze.ts's `runAnalys` can share the exact same client-resolution
 *  behaviour instead of re-implementing it (see that module). */
export function resolveClient(
  options: Pick<RunExtractionOptions, "apiKey" | "client">,
): AnthropicClientLike {
  if (options.client) return options.client;
  const real = options.apiKey ? new Anthropic({ apiKey: options.apiKey }) : new Anthropic();
  return real as unknown as AnthropicClientLike;
}

function findTextBlock(content: Array<{ type: string; text?: string }>): string | undefined {
  const block = content.find((b) => b.type === "text" && typeof b.text === "string");
  return block?.text;
}

/**
 * Uint8Array -> base64, using only web-standard APIs.
 *
 * Node's `Buffer` does not exist in Cloudflare Workers, which is what this
 * app builds for (nitro's cloudflare-module preset). `btoa` exists in both,
 * so the encoding stays identical across runtimes rather than depending on
 * a compatibility shim being switched on.
 *
 * Chunked deliberately: `String.fromCharCode(...bytes)` spreads every byte
 * as an argument and blows the call stack well below the 11,4 MB annual
 * report already in the test corpus.
 */
export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Strips a ```json ... ``` (or bare ```) fence if the model wrapped its
 * answer in one despite being told not to — common enough to normalize
 * rather than just fail on. Strips a leading fence marker even without a
 * matching trailing one: a response truncated by max_tokens before the
 * closing ``` appears would otherwise never match, leaving the fence in
 * place and guaranteeing a JSON.parse failure on top of the truncation.
 */
export function stripMarkdownFence(text: string): string {
  const trimmed = text.trim();
  const withClosing = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/.exec(trimmed);
  if (withClosing?.[1]) return withClosing[1];

  const openingOnly = /^```(?:json)?\s*\n([\s\S]*)$/.exec(trimmed);
  if (openingOnly?.[1]) return openingOnly[1];

  return text;
}

/**
 * Parses the model's JSON reply, but never throws — an unterminated string
 * from a truncated response is just as much "malformed JSON" as a
 * wrong-shaped object, and both must go through extractWithRetry's one
 * retry rather than crash the run outright.
 *
 * On failure, returns the raw text itself rather than null: Zod still
 * rejects it (a string isn't the expected object) so the retry path is
 * unchanged, but ExtractionValidationError.raw then holds the actual text
 * instead of nothing — the difference between "Expected object, received
 * null" and being able to see the response actually started with a
 * Markdown fence or got cut off mid-string.
 */
export function parseModelJson(content: Array<{ type: string; text?: string }>): unknown {
  const text = findTextBlock(content);
  if (!text) return "(inget textblock i svaret)";
  try {
    return JSON.parse(stripMarkdownFence(text));
  } catch {
    return text;
  }
}

/**
 * Two calls, deliberately: Anthropic's citations feature and structured
 * outputs (output_config.format) are mutually exclusive on the same
 * request. Call 1 grounds every fact in a real, API-verified page number
 * (citations) — a model-self-reported page number would just be a guess
 * wearing a citation's clothes, which is exactly what CLAUDE.md forbids.
 * Call 2 turns those grounded findings into schema-shaped JSON.
 *
 * Call 2 does NOT use output_config.format: the SDK's zodOutputFormat
 * helper requires Zod v4 internals, and this project pins Zod v3 (schema.ts,
 * @hookform/resolvers). Upgrading that is a separate, deliberate migration,
 * not a side effect of wiring up one API call. Instead the prompt instructs
 * JSON-only output, and extractWithRetry (schema.ts's full ExtractionResultSchema,
 * including the citation/schablonBasis/seven-key-figures refinements) is the
 * single source of validation truth — malformed JSON retries once, then
 * surfaces a clear error, per PIPELINE.md's failure-mode table.
 *
 * The two calls are split into `runGrounding` and `runStructuredExtraction`
 * below (each independently callable) because each one becomes its own
 * Supabase Edge Function invocation later, capped at one Anthropic API call
 * to fit inside a 150s wall-clock budget per invocation. `runExtraction`
 * itself stays a thin composition of the two, signature unchanged, so
 * existing callers (cli.ts, verifyAnswerKey.ts) keep working untouched.
 */

export interface RunGroundingResult {
  groundingText: string;
  spentSek: number;
  pdfSaknarTextlager: boolean;
  /** Always exactly one entry — grounding never retries (there is nothing to
   *  validate a free-text response against). */
  calls: ModelCallMetrics[];
}

/** Call 1 — grounding (citations enabled). Fails loudly, before any API
 *  spend, on a scanned PDF with no text layer. */
export async function runGrounding(
  pdfBytes: Uint8Array,
  options: RunExtractionOptions,
): Promise<RunGroundingResult> {
  const {
    model = "claude-sonnet-5",
    maxCostSek,
    pricing = SONNET_5_PRISSATTNING,
    // 16000, not the earlier 8000 — a baseline run already saw grounding's
    // output reach 6099 of that 8000-token cap (largely Sonnet 5's adaptive
    // thinking, which counts as output). A truncated grounding response
    // wouldn't even fail loudly on its own — it's free text, not JSON, so a
    // cut-off answer just silently produces a weaker groundingText instead
    // of an error. The explicit stop_reason check below exists for exactly
    // this call.
    maxOutputTokensGrounding = 16000,
    effort,
  } = options;

  // Step 0 — cheap local check, no API spend. A scanned PDF must fail
  // loudly before we spend anything trying to read it.
  //
  // extractPdfText hands the bytes to pdf.js (via unpdf's getDocumentProxy),
  // which detaches/transfers the underlying ArrayBuffer as a performance
  // optimization — pdfBytes would read back as zero-length afterward. Give
  // it a copy so the original stays intact for the base64 document block below.
  const { pdfSaknarTextlager } = await extractPdfText(pdfBytes.slice());
  if (pdfSaknarTextlager) {
    throw new ScannedPdfError();
  }

  const client = resolveClient(options);

  const documentBlock = {
    type: "document" as const,
    source: {
      type: "base64" as const,
      media_type: "application/pdf" as const,
      data: toBase64(pdfBytes),
    },
    citations: { enabled: true },
  };

  const groundingSystem = buildGroundingSystemPrompt();
  const groundingMessages = [
    {
      role: "user" as const,
      content: [documentBlock, { type: "text" as const, text: buildGroundingUserPrompt() }],
    },
  ];

  const groundingCount = await client.messages.countTokens({
    model,
    system: groundingSystem,
    messages: groundingMessages,
  });
  enforceCostLimit(groundingCount.input_tokens, maxOutputTokensGrounding, maxCostSek, pricing);

  const start = performance.now();
  const groundingResponse = await client.messages.create({
    model,
    max_tokens: maxOutputTokensGrounding,
    system: groundingSystem,
    messages: groundingMessages,
    ...(effort ? { output_config: { effort } } : {}),
  });
  const latencyMs = performance.now() - start;
  const spentSek = estimateCostSek(
    groundingResponse.usage.input_tokens,
    groundingResponse.usage.output_tokens,
    pricing,
  );
  const calls = [
    buildCallMetrics({
      stage: "grundning",
      model,
      latencyMs,
      usage: groundingResponse.usage,
      stopReason: groundingResponse.stop_reason,
      pricing,
    }),
  ];

  // Grounding's output is free text, not JSON — a truncated response would
  // otherwise pass through silently as a merely-shorter groundingText
  // instead of an error, and extraction downstream would just see fewer
  // findings than the report actually contains.
  if (groundingResponse.stop_reason === "max_tokens") {
    throw annotateSpend(
      new ModelTruncatedError("Grundningen", maxOutputTokensGrounding),
      spentSek,
      calls,
    );
  }

  const findings = extractGroundingFindings(groundingResponse.content as GroundingTextBlock[]);
  const groundingText = formatGroundingForExtraction(findings);

  return { groundingText, spentSek, pdfSaknarTextlager, calls };
}

export interface RunStructuredExtractionOptions extends Omit<
  RunExtractionOptions,
  "maxOutputTokensGrounding"
> {
  /** From step 0 of `runGrounding` — default false matches the case where
   *  grounding already ran and confirmed a text layer. */
  pdfSaknarTextlager?: boolean;
}

/** Call 2 — structured JSON, grounded only in call 1's findings. Retried
 *  once on validation failure (extractWithRetry). Never sees the PDF: this
 *  call is text-only, no document block, no citations feature. */
export async function runStructuredExtraction(
  groundingText: string,
  options: RunStructuredExtractionOptions,
): Promise<RunExtractionResult> {
  const {
    model = "claude-sonnet-5",
    maxCostSek,
    pricing = SONNET_5_PRISSATTNING,
    // 16000, not the earlier 12000 — a baseline run already saw extraction's
    // output reach 10101 of that 12000-token cap, close enough that a
    // slightly denser report tips it into the same truncation Volontären
    // hit in judging (see analyze.ts).
    maxOutputTokensExtraction = 16000,
    pdfSaknarTextlager = false,
    effort,
  } = options;

  const client = resolveClient(options);
  let spentSek = 0;
  const calls: ModelCallMetrics[] = [];

  const extractionSystem = buildExtractionSystemPrompt();
  const extractionUser = buildExtractionUserPrompt(groundingText);

  const callModel: ModelCaller = async (system, user) => {
    const messages = [{ role: "user" as const, content: user }];
    const count = await client.messages.countTokens({ model, system, messages });
    enforceCostLimit(count.input_tokens, maxOutputTokensExtraction, maxCostSek - spentSek, pricing);

    const start = performance.now();
    const response = await client.messages.create({
      model,
      max_tokens: maxOutputTokensExtraction,
      system,
      messages,
      ...(effort ? { output_config: { effort } } : {}),
    });
    const latencyMs = performance.now() - start;
    spentSek += estimateCostSek(response.usage.input_tokens, response.usage.output_tokens, pricing);
    calls.push(
      buildCallMetrics({
        stage: "extraktion",
        model,
        latencyMs,
        usage: response.usage,
        stopReason: response.stop_reason,
        pricing,
      }),
    );

    // Diagnose a cut-off response immediately (see ModelTruncatedError) —
    // otherwise it's just malformed JSON to parseModelJson below, and the
    // retry would very likely hit the same truncation again for no benefit.
    if (response.stop_reason === "max_tokens") {
      throw annotateSpend(
        new ModelTruncatedError("Extraktionen", maxOutputTokensExtraction),
        spentSek,
        calls,
      );
    }

    const raw = parseModelJson(response.content);
    // pdfSaknarTextlager is already known deterministically from grounding's
    // step 0 — never trust the model's own claim about it, override unconditionally.
    if (raw !== null && typeof raw === "object" && "datakvalitet" in raw) {
      const dk = (raw as { datakvalitet: unknown }).datakvalitet;
      if (dk !== null && typeof dk === "object") {
        (dk as { pdfSaknarTextlager?: unknown }).pdfSaknarTextlager = pdfSaknarTextlager;
      }
    }
    return raw;
  };

  let extraction: ExtractionResult;
  try {
    extraction = await extractWithRetry(extractionSystem, extractionUser, callModel);
  } catch (error) {
    // A validation failure only reaches here after extractWithRetry's own
    // retry already made a second paid call — annotate whatever `calls`
    // already holds (ModelTruncatedError above already carries its own,
    // narrower snapshot from the moment it was thrown; this `catch` only
    // widens it if a later attempt added to `calls` since — extractWithRetry
    // never retries after ModelTruncatedError, so in practice that only
    // matters for ModelValidationError below).
    throw error instanceof Error ? annotateSpend(error, spentSek, calls) : error;
  }

  // Deterministic reconciliation, in order:
  //   1. tolkaNyckeltal — for any figure whose printed cell was not a plain
  //      number (figure.tryckt set), the deterministic parser's reading of
  //      that verbatim text OVERRIDES whatever number the model itself put
  //      in figure.value. A regex over the report's own text is strictly
  //      more trustworthy than the model's own arithmetic on it.
  //   2. harledSkuldfriaNyckeltal — a provably debt-free association
  //      (lanebok.totalSkuld.value === 0, per buildExtractionSystemPrompt's
  //      "skuldfri" rule) derives 0 for räntekänslighet and both
  //      skuldsättning/m² figures wherever they're still null — see
  //      tolkaVarde.ts's doc comment. Runs BEFORE berikaNyckeltal so the
  //      derived 0s are graded exactly like any other figure, not left
  //      "okant" and re-derived downstream.
  //   3. berikaNyckeltal — pass 1's prompt always emits status: "okant" (see
  //      buildExtractionSystemPrompt); the model isn't asked to judge, only
  //      to find and cite. This is where the judgement actually happens:
  //      deterministic, benchmark-backed, and now sign-aware (a figure whose
  //      only known fact is its tecken can still be graded — see
  //      benchmarks.ts's bedomStatus).
  // Any disagreement either step surfaces (the model's number vs. the
  // printed text, or an implausible negative reading on a "lower is
  // better" figure) is recorded in datakvalitet.extraktionKonfidens.skal —
  // there is no dedicated field for it in the contract, and this is an
  // existing one built for exactly "why confidence is reduced".
  const { keyFigures: tolkadeNyckeltal, avvikelser: tolkningsAvvikelser } = tolkaNyckeltal(
    extraction.forening.keyFigures,
  );
  const skuldfriaNyckeltal = harledSkuldfriaNyckeltal(
    extraction.forening.lanebok?.totalSkuld,
    tolkadeNyckeltal,
  );
  const gradeadeNyckeltal = berikaNyckeltal(skuldfriaNyckeltal);
  const implausibelaAnmarkningar = gradeadeNyckeltal
    .map((kf) => implausibelNegativAnmarkning(kf))
    .filter((s): s is string => s !== undefined);
  const anmarkningar = [...tolkningsAvvikelser, ...implausibelaAnmarkningar];

  // The model's own "debt figures missing" note is stale once the debt-free
  // rule has filled them in (see rensaSkuldfriaKonfidensSkal).
  const harleddes = skuldfriaNyckeltal.some((kf, i) => kf !== tolkadeNyckeltal[i]);
  const modellensKonfidens = rensaSkuldfriaKonfidensSkal(
    extraction.datakvalitet.extraktionKonfidens,
    harleddes,
  );

  const extraktionKonfidens =
    anmarkningar.length > 0
      ? {
          // A disagreement between the model and the printed text (or an
          // implausible negative reading) is exactly the kind of thing that
          // should visibly lower confidence — but never RAISE it back to
          // "hog" if something else already lowered it further ("lag").
          niva: modellensKonfidens.niva === "hog" ? ("medel" as const) : modellensKonfidens.niva,
          skal: [...(modellensKonfidens.skal ?? []), ...anmarkningar],
        }
      : modellensKonfidens;

  const enrichedExtraction: ExtractionResult = {
    ...extraction,
    forening: {
      ...extraction.forening,
      keyFigures: gradeadeNyckeltal,
    },
    datakvalitet: {
      ...extraction.datakvalitet,
      extraktionKonfidens,
    },
  };

  return { extraction: enrichedExtraction, spentSek, calls };
}

/**
 * Composition of the two calls above, signature unchanged from before the
 * split — cli.ts and verifyAnswerKey.ts call this and must keep compiling
 * and behaving identically. Budget threading matches the pre-split
 * single-function code exactly: call 2's cost cap is what's left of
 * `maxCostSek` after call 1's actual spend, not a fresh budget per call.
 */
export async function runExtraction(
  pdfBytes: Uint8Array,
  options: RunExtractionOptions,
): Promise<RunExtractionResult> {
  const {
    groundingText,
    spentSek: spentGrounding,
    pdfSaknarTextlager,
    calls: groundingCalls,
  } = await runGrounding(pdfBytes, options);

  // maxOutputTokensGrounding has no meaning for call 2 — drop it explicitly
  // (rather than relying on excess-property leniency from a spread) since
  // RunStructuredExtractionOptions doesn't declare it.
  const { maxOutputTokensGrounding: _maxOutputTokensGrounding, ...restOptions } = options;

  const {
    extraction,
    spentSek: spentStructured,
    calls: extractionCalls,
  } = await runStructuredExtraction(groundingText, {
    ...restOptions,
    maxCostSek: options.maxCostSek - spentGrounding,
    pdfSaknarTextlager,
  });

  return {
    extraction,
    spentSek: spentGrounding + spentStructured,
    calls: [...groundingCalls, ...extractionCalls],
  };
}
