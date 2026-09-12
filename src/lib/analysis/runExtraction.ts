import Anthropic from "@anthropic-ai/sdk";
import type { ExtractionResult } from "@/types/analysis";
import { berikaNyckeltal } from "./benchmarks";
import { extractPdfText } from "./pdf";
import { extractWithRetry, type ModelCaller } from "./extract";
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

export class ScannedPdfError extends Error {
  constructor() {
    super(
      "PDF:en saknar textlager (verkar vara en skanning). Kan inte extrahera siffror ur en bild " +
        "— avbryter innan något API-anrop görs.",
    );
    this.name = "ScannedPdfError";
  }
}

export interface RunExtractionOptions {
  apiKey?: string;
  model?: string;
  maxCostSek: number;
  pricing?: ModelPricing;
  /** Worst-case output tokens assumed for the pre-flight cost check, per call. */
  maxOutputTokensGrounding?: number;
  maxOutputTokensExtraction?: number;
}

export interface RunExtractionResult {
  extraction: ExtractionResult;
  spentSek: number;
}

function findTextBlock(content: Array<{ type: string; text?: string }>): string | undefined {
  const block = content.find((b) => b.type === "text" && typeof b.text === "string");
  return block?.text;
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
 */
export async function runExtraction(
  pdfBytes: Uint8Array,
  options: RunExtractionOptions,
): Promise<RunExtractionResult> {
  const {
    apiKey,
    model = "claude-sonnet-5",
    maxCostSek,
    pricing = SONNET_5_PRISSATTNING,
    maxOutputTokensGrounding = 8000,
    maxOutputTokensExtraction = 12000,
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

  const client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  let spentSek = 0;

  const documentBlock = {
    type: "document" as const,
    source: {
      type: "base64" as const,
      media_type: "application/pdf" as const,
      data: Buffer.from(pdfBytes).toString("base64"),
    },
    citations: { enabled: true },
  };

  // --- Call 1: grounding (citations enabled) ---
  const groundingSystem = buildGroundingSystemPrompt();
  const groundingMessages = [
    {
      role: "user" as const,
      content: [
        documentBlock,
        { type: "text" as const, text: buildGroundingUserPrompt() },
      ],
    },
  ];

  const groundingCount = await client.messages.countTokens({
    model,
    system: groundingSystem,
    messages: groundingMessages,
  });
  enforceCostLimit(
    groundingCount.input_tokens,
    maxOutputTokensGrounding,
    maxCostSek - spentSek,
    pricing,
  );

  const groundingResponse = await client.messages.create({
    model,
    max_tokens: maxOutputTokensGrounding,
    system: groundingSystem,
    messages: groundingMessages,
  });
  spentSek += estimateCostSek(
    groundingResponse.usage.input_tokens,
    groundingResponse.usage.output_tokens,
    pricing,
  );

  const findings = extractGroundingFindings(groundingResponse.content as GroundingTextBlock[]);
  const groundingText = formatGroundingForExtraction(findings);

  // --- Call 2: structured JSON, grounded only in call 1's findings.
  // Retried once on validation failure (extractWithRetry), reusing the
  // same grounded context rather than re-running call 1. ---
  const extractionSystem = buildExtractionSystemPrompt();
  const extractionUser = buildExtractionUserPrompt(groundingText);

  const callModel: ModelCaller = async (system, user) => {
    const messages = [{ role: "user" as const, content: user }];
    const count = await client.messages.countTokens({ model, system, messages });
    enforceCostLimit(count.input_tokens, maxOutputTokensExtraction, maxCostSek - spentSek, pricing);

    const response = await client.messages.create({
      model,
      max_tokens: maxOutputTokensExtraction,
      system,
      messages,
    });
    spentSek += estimateCostSek(response.usage.input_tokens, response.usage.output_tokens, pricing);

    const raw = parseModelJson(response.content);
    // pdfSaknarTextlager is already known deterministically from step 0 —
    // never trust the model's own claim about it, override unconditionally.
    if (raw !== null && typeof raw === "object" && "datakvalitet" in raw) {
      const dk = (raw as { datakvalitet: unknown }).datakvalitet;
      if (dk !== null && typeof dk === "object") {
        (dk as { pdfSaknarTextlager?: unknown }).pdfSaknarTextlager = pdfSaknarTextlager;
      }
    }
    return raw;
  };

  const extraction = await extractWithRetry(extractionSystem, extractionUser, callModel);

  // Pass 1's prompt now always emits status: "okant" (see buildExtractionSystemPrompt) —
  // the model isn't asked to judge, only to find and cite. This is where the judgement
  // actually happens: deterministic, benchmark-backed, and consistent across reports.
  const enrichedExtraction: ExtractionResult = {
    ...extraction,
    forening: {
      ...extraction.forening,
      keyFigures: berikaNyckeltal(extraction.forening.keyFigures),
    },
  };

  return { extraction: enrichedExtraction, spentSek };
}
