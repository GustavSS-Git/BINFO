/**
 * Cheap model fallback for identifying a report (orgnr + fiscal year + name)
 * when identitet.ts cannot — scanned PDFs without a text layer, or ambiguous
 * text. Sends only pages 1-3 (split out with pdf-lib) to Haiku 4.5 as a plain
 * document block (no citations: nothing here is shown with a page reference)
 * and asks for a tiny JSON object. Typical cost is a few tenths of an öre per
 * thousand input tokens, i.e. roughly 0.05-0.1 SEK per report.
 *
 * The answer is untrusted: Zod-validated (one retry), the orgnr is normalised
 * and Luhn-checked, the year range-checked. Anything not confident gives
 * `identitet: null` — never a guess.
 */

import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { enforceCostLimit, prissattningForModell } from "./costGuard";
import { annotateSpend, buildCallMetrics, type ModelCallMetrics } from "./callMetrics";
import { ModelValidationError, provaMedOmforsok, type ModelCaller, type Utfall } from "./extract";
import {
  kontrolleraStoppgrund,
  parseModelJson,
  resolveClient,
  tillRakneParams,
  toBase64,
  type AnthropicClientLike,
  type SkapaParams,
  type SvarMeddelande,
} from "./runExtraction";
import { arGiltigtOrgnr, normaliseraOrgnr, type Rapportidentitet } from "./identitet";

/** Bump when the prompt or the answer schema changes. */
export const IDENTITET_PROMPT_VERSION = "1";

const STANDARDMODELL = "claude-haiku-4-5";
const ANTAL_SIDOR = 3;
/** The answer is a ~40-token JSON object; this is generous headroom and the pre-flight worst case. */
const MAX_OUTPUT_TOKENS = 300;
const MIN_AR = 1990;

export interface ModellIdentifiering {
  identitet: Rapportidentitet | null;
  spentSek: number;
  calls: ModelCallMetrics[];
}

export interface IdentifieraMedModellOptions {
  apiKey?: string;
  /** Default "claude-haiku-4-5". Haiku 4.5 does not support output_config.effort, so none is sent. */
  model?: string;
  maxCostSek: number;
  /** Injected for tests. */
  client?: AnthropicClientLike;
}

const SYSTEM_PROMPT = [
  "Du läser de första sidorna av en svensk bostadsrättsförenings årsredovisning (kan vara en skannad bild).",
  'Svara ENDAST med ett JSON-objekt, utan förklaring och utan kodstaket: {"orgnr": string|null, "rakenskapsar": number|null, "namn": string|null}.',
  "- orgnr: FÖRENINGENS organisationsnummer på formen NNNNNN-NNNN. Inte revisorns, förvaltarens eller något annat bolags nummer.",
  "- rakenskapsar: året då räkenskapsåret SLUTAR, som heltal. Räkenskapsåret 2024-09-01 till 2025-08-31 ger 2025. Läs det ur räkenskapsårets uttryckliga datum eller år, inte ur en flerårsöversikt.",
  '- namn: föreningens namn, kopierat tecken för tecken som det står tryckt (inklusive siffror och bindestreck), t.ex. "Brf Granen 10-11".',
  "Använd null för allt som inte står tryckt i dokumentet. Gissa aldrig.",
].join("\n");

const USER_PROMPT =
  "Vilken förening och vilket räkenskapsår gäller denna årsredovisning? Svara med JSON.";

const SvarSchema = z.object({
  orgnr: z.string().nullable(),
  rakenskapsar: z
    .union([
      z.number().int(),
      z
        .string()
        .regex(/^\s*\d{4}\s*$/, "fyra siffror")
        .transform(Number),
    ])
    .nullable(),
  namn: z.string().nullable(),
});

/** Copies the first `antal` pages into a new, small PDF. The input bytes are not modified. */
export async function forstaSidor(pdfBytes: Uint8Array, antal: number): Promise<Uint8Array> {
  try {
    const kalla = await PDFDocument.load(pdfBytes.slice());
    const sidor = Math.min(antal, kalla.getPageCount());
    if (sidor === 0) throw new Error("PDF:en har inga sidor.");
    const kort = await PDFDocument.create();
    const kopior = await kort.copyPages(
      kalla,
      Array.from({ length: sidor }, (_, i) => i),
    );
    for (const sida of kopior) kort.addPage(sida);
    return await kort.save();
  } catch (error) {
    throw new Error(
      `Kunde inte läsa PDF:en för identifiering: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function tillIdentitet(svar: z.infer<typeof SvarSchema>): Rapportidentitet | null {
  if (svar.orgnr === null || svar.rakenskapsar === null) return null;
  const orgnr = normaliseraOrgnr(svar.orgnr);
  if (orgnr === null || !arGiltigtOrgnr(orgnr)) return null;
  const ar = svar.rakenskapsar;
  if (ar < MIN_AR || ar > new Date().getFullYear() + 1) return null;
  const namn = svar.namn?.trim() ?? "";
  return { orgnr, rakenskapsar: ar, namn: namn === "" || namn.length > 120 ? null : namn };
}

// ---------------------------------------------------------------------------
// Build / parse (docs/PLAN-v3.md §3.2)
// ---------------------------------------------------------------------------

/** The identity request for the report's first pages (`forstaSidor(pdf, 3)`),
 *  as a plain document block without citations. Haiku 4.5 takes no effort setting. */
export function byggIdentitetRequest(
  kortPdf: Uint8Array,
  model: string = STANDARDMODELL,
): SkapaParams {
  return byggIdentitetRequestFranPrompt(kortPdf, SYSTEM_PROMPT, USER_PROMPT, model);
}

function byggIdentitetRequestFranPrompt(
  kortPdf: Uint8Array,
  system: string,
  user: string,
  model: string,
): SkapaParams {
  return {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system,
    messages: [
      {
        role: "user" as const,
        content: [
          {
            type: "document" as const,
            source: {
              type: "base64" as const,
              media_type: "application/pdf" as const,
              data: toBase64(kortPdf),
            },
          },
          { type: "text" as const, text: user },
        ],
      },
    ],
  };
}

/** The model's parsed JSON from one identity answer; throws on a cut-off or refusal. */
export function raIdentitetssvar(svar: SvarMeddelande): unknown {
  kontrolleraStoppgrund(svar, "Identifieringen", MAX_OUTPUT_TOKENS);
  return parseModelJson(svar.content);
}

/** Zod + normalisation of one identity answer. `identitet: null` is a valid
 *  outcome ("not confident"); a malformed answer is a failed validation. */
export function valideraIdentitetssvar(raw: unknown): Utfall<Rapportidentitet | null> {
  const parsed = SvarSchema.safeParse(raw);
  return parsed.success
    ? { ok: true, value: tillIdentitet(parsed.data) }
    : { ok: false, zodError: parsed.error, raw };
}

/** One identity answer, read and validated (a failed validation is returned,
 *  not thrown: the caller owns the retry). */
export function tolkaIdentitetSvar(svar: SvarMeddelande): Utfall<Rapportidentitet | null> {
  return valideraIdentitetssvar(raIdentitetssvar(svar));
}

export async function identifieraMedModell(
  pdfBytes: Uint8Array,
  options: IdentifieraMedModellOptions,
): Promise<ModellIdentifiering> {
  const { model = STANDARDMODELL, maxCostSek } = options;
  const pricing = prissattningForModell(model);

  const kortPdf = await forstaSidor(pdfBytes, ANTAL_SIDOR);
  const client = resolveClient(options);

  const calls: ModelCallMetrics[] = [];
  let spentSek = 0;

  const callModel: ModelCaller = async (system, user) => {
    const begaran = byggIdentitetRequestFranPrompt(kortPdf, system, user, model);
    const count = await client.messages.countTokens(tillRakneParams(begaran));
    enforceCostLimit(count.input_tokens, MAX_OUTPUT_TOKENS, maxCostSek - spentSek, pricing);

    const start = performance.now();
    const response = await client.messages.create(begaran);
    const latencyMs = performance.now() - start;
    const metrics = buildCallMetrics({
      stage: "identifiering",
      model,
      latencyMs,
      usage: response.usage,
      stopReason: response.stop_reason,
      pricing,
    });
    calls.push(metrics);
    spentSek += metrics.costSek;

    return raIdentitetssvar(response);
  };

  try {
    const identitet = await provaMedOmforsok(
      () => callModel(SYSTEM_PROMPT, USER_PROMPT),
      valideraIdentitetssvar,
      (zodError, raw, attempts) =>
        new ModelValidationError("Identifieringen", zodError, raw, attempts),
    );
    return { identitet, spentSek, calls };
  } catch (error) {
    // Every call so far was real and paid for, whichever error ends the run.
    throw error instanceof Error ? annotateSpend(error, spentSek, calls) : error;
  }
}
