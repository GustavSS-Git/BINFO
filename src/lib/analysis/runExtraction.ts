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
  type Grundfynd,
} from "./prompts";
import {
  enforceCostLimit,
  prissattningForModell,
  STANDARD_MODELL,
  type ModelPricing,
} from "./costGuard";
import { annotateSpend, buildCallMetrics, type ModelCallMetrics } from "./callMetrics";
import { kontrolleraRimlighet } from "./rimlighet";
import {
  byggTranskriptionsblock,
  byggTranskriptionsdokument,
  extraheraTranskriptionsfynd,
  type InnehallsCitatBlock,
  type Transkriptionssida,
} from "./transkriptionsblock";

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
 * Thrown when a call ends with `stop_reason: "refusal"` (Sonnet 5.5 can
 * return it). Not a shape problem and not retryable: asking again with the
 * same prompt would be refused again, so it propagates straight out of the
 * retry loop. The caller annotates real spend on it (annotateSpend), like
 * ModelTruncatedError.
 */
export class ModelRefusedError extends Error {
  constructor(public readonly steg: string) {
    super(
      `${steg}: modellen avböjde att svara (stop_reason: "refusal"). Det är inte ett valideringsfel ` +
        `och en ny körning med samma underlag ger sannolikt samma resultat — kontrollera underlaget.`,
    );
    this.name = "ModelRefusedError";
  }
}

/** Prompt-cache breakpoint marker. Only the 5-minute ephemeral type is used. */
export interface CacheControl {
  type: "ephemeral";
}

/** A text block that may carry a cache breakpoint (system or user content). */
export interface CacheableTextBlock {
  type: "text";
  text: string;
  cache_control?: CacheControl;
}

/**
 * `true`: breakpoints on the static system block AND the user block (so the
 * validation retry reads the whole prompt from cache). `"system"`: only on
 * the static system block. `false`: no breakpoints.
 */
export type PromptCacheMode = boolean | "system";

/** `system` as sent to the API: a plain string, or text blocks so a
 *  breakpoint can sit on the static block. */
export type SystemParam = string | CacheableTextBlock[];

/**
 * System prompt as a single text block with an explicit cache breakpoint on
 * it (the whole system prompt is static, see prompts.ts), or the plain string
 * when caching is off. Never top-level automatic caching: the last block in a
 * request varies, so automatic placement would write a fresh entry every time.
 */
export function buildSystemParam(text: string, promptCache: PromptCacheMode): SystemParam {
  if (promptCache === false) return text;
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

/**
 * User message content. With caching on, a breakpoint sits on the user block
 * so the one validation retry (identical system + user) reads it from cache.
 * The first call pays the 1.25x write premium on these tokens for that.
 */
export function buildUserContent(
  text: string,
  promptCache: PromptCacheMode,
): string | CacheableTextBlock[] {
  // "system": the user block is left uncached (plain string).
  if (promptCache !== true) return text;
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
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
      system: SystemParam;
      messages: Array<{ role: "user"; content: unknown }>;
    }): Promise<{ input_tokens: number }>;
    create(
      params: {
        model: string;
        max_tokens: number;
        system: SystemParam;
        messages: Array<{ role: "user"; content: unknown }>;
        /** Reasoning depth — see `ModelEffort`. Omitted entirely (not just
         *  `undefined`) unless a caller opts in, so the default adaptive-thinking
         *  behaviour is unaffected when nobody asks for anything different. */
        output_config?: { effort?: ModelEffort };
      },
      options?: {
        /** Aborts the request (the real SDK accepts request options as the second
         *  argument). Used by `transkribera`'s overall deadline. */
        signal?: AbortSignal;
      },
    ): Promise<{
      usage: {
        input_tokens: number;
        output_tokens: number;
        /** Present only when prompt caching is actually in play — absent
         *  (not just 0) on a plain, uncached call from the real API. */
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
      content: Array<{ type: string; text?: string; citations?: unknown }>;
      /** "refusal" means the model declined — see ModelRefusedError.
       *  "max_tokens" means the response was cut off before it finished —
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
  /** Explicit prompt-cache breakpoints on the static system block and the
   *  user block of extraction (and judging). Default true. Grounding is never
   *  cached: its system prompt (~420 tokens) is below the model minimum, so a
   *  breakpoint there would silently do nothing. The CLIs read
   *  ANTHROPIC_PROMPT_CACHE=off to switch it off for A/B measurement. */
  promptCache?: PromptCacheMode;
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
  const json = stripMarkdownFence(text);
  try {
    return JSON.parse(json);
  } catch {
    // Two lossless repairs, tried in turn (the result is still Zod-validated like any
    // other model output): a model that copies a multi-line quote into an "excerpt" writes
    // a raw newline inside a JSON string, and a deeply nested object sometimes ends with
    // one closing brace too many (measured: 3 of 4 scanned-report extractions, 2026-10-09).
    const reparerad = escapeControlCharsInStrings(json);
    for (const kandidat of [reparerad, utanSurplusavslut(reparerad)]) {
      try {
        return JSON.parse(kandidat);
      } catch {
        // try the next repair
      }
    }
    return text;
  }
}

/**
 * Cuts off trailing closing brackets after the first complete top-level JSON value
 * ("...}}}}}" where one `}` too many was written). Only whitespace, `}`, `]` and
 * backticks may follow the value — anything else is real trailing text and is left
 * alone, so a genuinely malformed answer still fails validation.
 */
export function utanSurplusavslut(json: string): string {
  let djup = 0;
  let iStrang = false;
  let escaped = false;
  for (let i = 0; i < json.length; i++) {
    const tecken = json[i]!;
    if (iStrang) {
      if (escaped) escaped = false;
      else if (tecken === "\\") escaped = true;
      else if (tecken === '"') iStrang = false;
      continue;
    }
    if (tecken === '"') iStrang = true;
    else if (tecken === "{" || tecken === "[") djup++;
    else if (tecken === "}" || tecken === "]") {
      djup--;
      if (djup === 0) {
        const rest = json.slice(i + 1);
        return /^[\s}\]`]*$/.test(rest) ? json.slice(0, i + 1) : json;
      }
    }
  }
  return json;
}

/** Escapes raw control characters (newline, tab, …) that occur inside JSON string
 *  literals; everything outside strings is left untouched. */
export function escapeControlCharsInStrings(json: string): string {
  let ut = "";
  let iStrang = false;
  let escaped = false;
  for (const tecken of json) {
    if (!iStrang) {
      if (tecken === '"') iStrang = true;
      ut += tecken;
      continue;
    }
    if (escaped) {
      escaped = false;
      ut += tecken;
    } else if (tecken === "\\") {
      escaped = true;
      ut += tecken;
    } else if (tecken === '"') {
      iStrang = false;
      ut += tecken;
    } else if (tecken < " ") {
      ut +=
        tecken === "\n"
          ? "\\n"
          : tecken === "\r"
            ? "\\r"
            : tecken === "\t"
              ? "\\t"
              : `\\u${tecken.charCodeAt(0).toString(16).padStart(4, "0")}`;
    } else {
      ut += tecken;
    }
  }
  return ut;
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
    model = STANDARD_MODELL,
    maxCostSek,
    pricing = prissattningForModell(model),
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

  const documentBlock = {
    type: "document" as const,
    source: {
      type: "base64" as const,
      media_type: "application/pdf" as const,
      data: toBase64(pdfBytes),
    },
    citations: { enabled: true },
  };

  return korGrundningsanrop(
    documentBlock,
    (content) => extractGroundingFindings(content as GroundingTextBlock[]),
    pdfSaknarTextlager,
    { model, maxCostSek, pricing, maxOutputTokensGrounding, effort },
    options,
  );
}

/**
 * The one grounding API call, shared by the native-PDF route (`runGrounding`)
 * and the scanned route (`runGroundingFranTranskription`): countTokens + cost
 * guard, the call itself, refusal/truncation as visible errors, then the
 * route's own way of reading citations into findings.
 */
async function korGrundningsanrop(
  documentBlock: object,
  taFynd: (content: AnthropicResponseContent) => Grundfynd[],
  pdfSaknarTextlager: boolean,
  inst: {
    model: string;
    maxCostSek: number;
    pricing: ModelPricing;
    maxOutputTokensGrounding: number;
    effort: ModelEffort | undefined;
  },
  klientVal: Pick<RunExtractionOptions, "apiKey" | "client">,
): Promise<RunGroundingResult> {
  const { model, maxCostSek, pricing, maxOutputTokensGrounding, effort } = inst;
  const client = resolveClient(klientVal);

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
  const spentSek = calls[0]!.costSek;

  if (groundingResponse.stop_reason === "refusal") {
    throw annotateSpend(new ModelRefusedError("Grundningen"), spentSek, calls);
  }

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

  const groundingText = formatGroundingForExtraction(taFynd(groundingResponse.content));

  return { groundingText, spentSek, pdfSaknarTextlager, calls };
}

type AnthropicResponseContent = Array<{ type: string; text?: string; citations?: unknown }>;

/** Thrown before any API call when a transcription holds no text at all. */
export class TomTranskriptionError extends Error {
  constructor() {
    super(
      "Transkriptionen innehåller ingen text. Det finns inget att grunda analysen på — " +
        "avbryter innan något API-anrop görs.",
    );
    this.name = "TomTranskriptionError";
  }
}

/**
 * Call 1 for a SCANNED report — grounding over the transcription made by
 * `transkribera` (transkribering.ts). Same prompts, same one API call and the
 * same result shape as `runGrounding`, so `runStructuredExtraction` is reused
 * unchanged. The transcription becomes one custom-content document of fine
 * blocks (paragraphs and table rows, transkriptionsblock.ts); citations are
 * `content_block_location` and each cited block is mapped back to its ORIGINAL
 * page — a page number the map does not give is never accepted. The result is
 * formatted exactly like the native route ("Sida N: …").
 *
 * `pdfSaknarTextlager` is true in the result: the PDF has no usable text layer.
 */
export async function runGroundingFranTranskription(
  sidor: readonly Transkriptionssida[],
  options: RunExtractionOptions,
): Promise<RunGroundingResult> {
  const {
    model = STANDARD_MODELL,
    maxCostSek,
    pricing = prissattningForModell(model),
    maxOutputTokensGrounding = 16000,
    effort,
  } = options;

  const block = byggTranskriptionsblock(sidor);
  if (block.length === 0) throw new TomTranskriptionError();

  return korGrundningsanrop(
    byggTranskriptionsdokument(block),
    (content) =>
      extraheraTranskriptionsfynd(
        content.filter((b): b is InnehallsCitatBlock => typeof b.text === "string"),
        block,
      ).fynd,
    true,
    { model, maxCostSek, pricing, maxOutputTokensGrounding, effort },
    options,
  );
}

export interface RunStructuredExtractionOptions extends Omit<
  RunExtractionOptions,
  "maxOutputTokensGrounding"
> {
  /** From step 0 of `runGrounding` — default false matches the case where
   *  grounding already ran and confirmed a text layer. */
  pdfSaknarTextlager?: boolean;
  /**
   * Where the grounding text came from. Sets `datakvalitet.kalla`
   * deterministically (whatever the model wrote is overridden). 'skannad' (a
   * transcription of page images, runGroundingFranTranskription) also caps the
   * confidence at 'medel' with a skäl line. Default 'textlager'.
   */
  kalla?: "textlager" | "skannad";
}

/**
 * The model sometimes lists only SOME of the five fee-inclusion posts in
 * `avgiftInkluderarEnligtForening` although the schema requires all five (measured
 * 2026-10-09: it dropped "varme" and "vatten" on a scanned report and burned a retry).
 * A post the model gave no answer for is unknown by definition, so it becomes "okant" —
 * never "nej" (unknown is not false).
 */
export function fyllIOkandaAvgiftsposter(raw: unknown): void {
  if (raw === null || typeof raw !== "object") return;
  const forening = (raw as { forening?: unknown }).forening;
  if (forening === null || typeof forening !== "object") return;
  const poster = (forening as { avgiftInkluderarEnligtForening?: unknown })
    .avgiftInkluderarEnligtForening;
  if (poster === null || typeof poster !== "object" || Array.isArray(poster)) return;
  const objekt = poster as Record<string, unknown>;
  for (const post of ["varme", "vatten", "el", "bredband", "tv"]) {
    if (objekt[post] === undefined) objekt[post] = "okant";
  }
}

/** The skäl line added to the confidence of a scanned report. */
export const SKANNAD_KONFIDENS_SKAL =
  "Årsredovisningen saknade textlager; siffrorna är avlästa från sidbilder.";

/** Removes every `osaker` key anywhere in the model's raw JSON: only the
 *  deterministic check (rimlighet.ts) may mark a figure as uncertain. */
function stripOsaker(varde: unknown): void {
  if (Array.isArray(varde)) {
    for (const v of varde) stripOsaker(v);
  } else if (varde !== null && typeof varde === "object") {
    const objekt = varde as Record<string, unknown>;
    delete objekt["osaker"];
    for (const v of Object.values(objekt)) stripOsaker(v);
  }
}

/** Call 2 — structured JSON, grounded only in call 1's findings. Retried
 *  once on validation failure (extractWithRetry). Never sees the PDF: this
 *  call is text-only, no document block, no citations feature. */
export async function runStructuredExtraction(
  groundingText: string,
  options: RunStructuredExtractionOptions,
): Promise<RunExtractionResult> {
  const {
    model = STANDARD_MODELL,
    maxCostSek,
    pricing = prissattningForModell(model),
    // 16000, not the earlier 12000 — a baseline run already saw extraction's
    // output reach 10101 of that 12000-token cap, close enough that a
    // slightly denser report tips it into the same truncation Volontären
    // hit in judging (see analyze.ts).
    maxOutputTokensExtraction = 16000,
    pdfSaknarTextlager = false,
    kalla = "textlager",
    effort,
    promptCache = false,
  } = options;

  const client = resolveClient(options);
  let spentSek = 0;
  const calls: ModelCallMetrics[] = [];

  const extractionSystem = buildExtractionSystemPrompt();
  const extractionUser = buildExtractionUserPrompt(groundingText);

  const callModel: ModelCaller = async (systemText, userText) => {
    // The system prompt is fully static (breakpoint 1); the user block is the
    // same on the validation retry (breakpoint 2) — see buildUserContent.
    const system = buildSystemParam(systemText, promptCache);
    const messages = [{ role: "user" as const, content: buildUserContent(userText, promptCache) }];
    // Pre-flight stays worst case: assumes no cache read (full input price).
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
    const metrics = buildCallMetrics({
      stage: "extraktion",
      model,
      latencyMs,
      usage: response.usage,
      stopReason: response.stop_reason,
      pricing,
    });
    calls.push(metrics);
    spentSek += metrics.costSek;

    if (response.stop_reason === "refusal") {
      throw annotateSpend(new ModelRefusedError("Extraktionen"), spentSek, calls);
    }

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
    // pdfSaknarTextlager and kalla are already known deterministically (grounding's
    // step 0 / which route produced the grounding text) — never trust the model's
    // own claim about them, override unconditionally. An `osaker` marker is only
    // ever set by the deterministic sanity check, so any the model emitted goes.
    if (raw !== null && typeof raw === "object") {
      stripOsaker(raw);
      fyllIOkandaAvgiftsposter(raw);
      if ("datakvalitet" in raw) {
        const dk = (raw as { datakvalitet: unknown }).datakvalitet;
        if (dk !== null && typeof dk === "object") {
          (dk as { pdfSaknarTextlager?: unknown }).pdfSaknarTextlager = pdfSaknarTextlager;
          (dk as { kalla?: unknown }).kalla = kalla;
        }
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

  //   4. kontrolleraRimlighet (rimlighet.ts) — cross-checks the figures against each
  //      other and against the raw totals (balance sheet, fees, area, debt) and against
  //      plausible ranges. A failure marks the figure `osaker`, adds a skäl and lowers
  //      the confidence one level; it never hides or changes a value.
  const { extraction: kontrollerad } = kontrolleraRimlighet(enrichedExtraction);

  //   5. A scanned report's figures were read off page images by the model, not out of
  //      a text layer: confidence is capped at 'medel' and says so.
  const slutlig = kalla === "skannad" ? kapKonfidensForSkannad(kontrollerad) : kontrollerad;

  return { extraction: slutlig, spentSek, calls };
}

function kapKonfidensForSkannad(extraction: ExtractionResult): ExtractionResult {
  const konfidens = extraction.datakvalitet.extraktionKonfidens;
  const skal = konfidens.skal ?? [];
  return {
    ...extraction,
    datakvalitet: {
      ...extraction.datakvalitet,
      extraktionKonfidens: {
        niva: konfidens.niva === "hog" ? "medel" : konfidens.niva,
        skal: skal.includes(SKANNAD_KONFIDENS_SKAL) ? skal : [...skal, SKANNAD_KONFIDENS_SKAL],
      },
    },
  };
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
