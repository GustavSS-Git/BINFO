import { PDFDocument } from "pdf-lib";
import {
  enforceCostLimit,
  estimateCostSek,
  KostnadsgransOverskriden,
  prissattningForModell,
  STANDARD_MODELL,
  type ModelPricing,
} from "./costGuard";
import { annotateSpend, buildCallMetrics, type ModelCallMetrics } from "./callMetrics";
import { buildTranskriberingSystemPrompt, buildTranskriberingUserPrompt } from "./prompts";
import {
  kontrolleraStoppgrund,
  resolveClient,
  tillRakneParams,
  toBase64,
  type AnthropicClientLike,
  type ModelEffort,
  type SkapaParams,
  type SvarMeddelande,
} from "./runExtraction";

/**
 * Stage 'transkribering' (docs/PLAN-v2.md §1.9, decision D8): a PDF with no text
 * layer is split into chunks of a few pages, each chunk is sent as a native
 * `document` block (no citations — a PDF without a text layer is not citable),
 * and the model writes the pages out verbatim with `=== SIDA n ===` markers
 * carrying the ORIGINAL page numbers. Grounding then cites this transcription
 * (runGroundingFranTranskription in runExtraction.ts), so the markers are the
 * only source of page numbers downstream and are validated here.
 */

export const STANDARD_CHUNKSTORLEK = 5;

/**
 * Overall wall-clock limit for one `transkribera` run. The Supabase Edge
 * Function is cut at 150 s (docs/PLAN-v2.md §1.6); measured chunk calls take
 * 10–26 s, so 110 s leaves room to save what finished and write the result.
 * At the deadline in-flight calls are aborted (AbortController) and the next
 * attempt continues with the pages that are already saved.
 */
export const STANDARD_DEADLINE_MS = 110_000;

/**
 * Worst-case output tokens assumed per chunk call. Measured 2026-10-09
 * (docs/PLAN-v2.md §1.9, Sonnet 5.5 effort medium, 5-page chunks): 1 009 to
 * 5 093 output tokens (thinking included). 16 000 leaves >3x headroom; a call
 * that still hits it fails visibly (ModelTruncatedError).
 */
export const STANDARD_MAX_OUTPUT_PER_CHUNK = 16_000;

export interface PdfBit {
  /** Original (1-based) page number of this chunk's first page. */
  forstaSida: number;
  /** Number of pages in the chunk. */
  sidor: number;
  bytes: Uint8Array;
}

/** One chunk of the plan: which original pages it covers. */
export interface PdfDel {
  forstaSida: number;
  sidor: number;
}

/**
 * Splits a PDF into consecutive chunks of at most `chunkStorlek` pages and
 * builds (copies + saves) only the ones `urval` selects, by `forstaSida`. The
 * full plan is returned too, so a caller can tell how many chunks it left out.
 * Building a chunk is the CPU-heavy part, which is why a caller with a CPU
 * budget per invocation (the Edge Function, 2 s hard limit) selects only the
 * chunks it will actually send. Pure JS (pdf-lib), so it runs in Node, Deno and
 * Workers; the input bytes are not modified.
 */
export async function delaPdfUrval(
  pdfBytes: Uint8Array,
  chunkStorlek: number,
  urval: (plan: readonly PdfDel[]) => ReadonlySet<number>,
): Promise<{ plan: PdfDel[]; bitar: PdfBit[] }> {
  if (!Number.isInteger(chunkStorlek) || chunkStorlek < 1) {
    throw new Error(`chunkStorlek måste vara ett heltal >= 1, fick ${chunkStorlek}.`);
  }
  let kalla: PDFDocument;
  try {
    kalla = await PDFDocument.load(pdfBytes.slice());
  } catch (error) {
    throw new Error(
      `Kunde inte läsa PDF:en för uppdelning: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const antal = kalla.getPageCount();
  if (antal === 0) throw new Error("PDF:en har inga sidor.");

  const plan: PdfDel[] = [];
  for (let fran = 0; fran < antal; fran += chunkStorlek) {
    plan.push({ forstaSida: fran + 1, sidor: Math.min(antal, fran + chunkStorlek) - fran });
  }
  const valda = urval(plan);
  const bitar: PdfBit[] = [];
  for (const del of plan) {
    if (!valda.has(del.forstaSida)) continue;
    const fran = del.forstaSida - 1;
    const bit = await PDFDocument.create();
    const kopior = await bit.copyPages(
      kalla,
      Array.from({ length: del.sidor }, (_, i) => fran + i),
    );
    for (const sida of kopior) bit.addPage(sida);
    bitar.push({ forstaSida: del.forstaSida, sidor: del.sidor, bytes: await bit.save() });
  }
  return { plan, bitar };
}

/** Splits a PDF into consecutive chunks of at most `chunkStorlek` pages, each a
 *  standalone PDF (all of them; see `delaPdfUrval` to build only some). */
export async function delaPdf(
  pdfBytes: Uint8Array,
  chunkStorlek: number = STANDARD_CHUNKSTORLEK,
): Promise<PdfBit[]> {
  const { bitar } = await delaPdfUrval(
    pdfBytes,
    chunkStorlek,
    (plan) => new Set(plan.map((d) => d.forstaSida)),
  );
  return bitar;
}

// ---------------------------------------------------------------------------
// Marker parsing
// ---------------------------------------------------------------------------

export interface TranskriberadSida {
  /** Original 1-based page number in the whole PDF. */
  sida: number;
  text: string;
}

export type TranskriptionsTolkning =
  { ok: true; sidor: TranskriberadSida[] } | { ok: false; fel: string[] };

const SIDMARKOR = /^[ \t]*=== SIDA (\d+) ===[ \t]*$/m;

/**
 * Splits a chunk's transcription at its `=== SIDA n ===` markers. Valid only if
 * the marker numbers are EXACTLY the chunk's pages (forstaSida .. forstaSida +
 * antalSidor - 1), each once: a missing, duplicate or foreign marker would make
 * a citation point at the wrong page (measured on Haiku 4.5, which produced
 * wrong markers; Sonnet did not, but it is validated regardless). Text before
 * the first marker (a preamble the prompt forbids) is dropped. A page whose
 * body is empty is kept with an empty text (a blank page is a legitimate page).
 */
export function parseTranskription(
  text: string,
  forstaSida: number,
  antalSidor: number,
): TranskriptionsTolkning {
  const delar = text.split(new RegExp(SIDMARKOR.source, "gm"));
  const hittade = new Map<number, string>();
  const fel: string[] = [];
  for (let i = 1; i < delar.length; i += 2) {
    const n = Number(delar[i]);
    const body = (delar[i + 1] ?? "").trim();
    if (hittade.has(n)) fel.push(`sidmarkören ${n} förekommer mer än en gång`);
    else hittade.set(n, body);
  }
  const sidor: TranskriberadSida[] = [];
  for (let n = forstaSida; n < forstaSida + antalSidor; n++) {
    const body = hittade.get(n);
    if (body === undefined) fel.push(`sidmarkören ${n} saknas`);
    else sidor.push({ sida: n, text: body });
  }
  for (const n of hittade.keys()) {
    if (n < forstaSida || n >= forstaSida + antalSidor) {
      fel.push(
        `oväntad sidmarkör ${n} (delen har sidorna ${forstaSida}–${forstaSida + antalSidor - 1})`,
      );
    }
  }
  return fel.length > 0 ? { ok: false, fel } : { ok: true, sidor };
}

// ---------------------------------------------------------------------------
// Build / parse of one chunk (docs/PLAN-v3.md §3.2)
// ---------------------------------------------------------------------------

export interface TranskriptionInst {
  model: string;
  /** Worst-case output tokens for the chunk. */
  maxTokens: number;
  effort: ModelEffort;
}

/** The request for one chunk: its pages as a native `document` block (no
 *  citations), plus the page-numbering instruction. */
export function byggTranskriptionRequest(
  bit: Pick<PdfBit, "forstaSida" | "sidor" | "bytes">,
  inst: TranskriptionInst,
): SkapaParams {
  return {
    model: inst.model,
    max_tokens: inst.maxTokens,
    system: buildTranskriberingSystemPrompt(),
    messages: [
      {
        role: "user" as const,
        content: [
          {
            type: "document" as const,
            source: {
              type: "base64" as const,
              media_type: "application/pdf" as const,
              data: toBase64(bit.bytes),
            },
          },
          {
            type: "text" as const,
            text: buildTranskriberingUserPrompt(bit.forstaSida, bit.sidor),
          },
        ],
      },
    ],
    output_config: { effort: inst.effort },
  };
}

/**
 * Reads one chunk's answer: the page markers validated against the chunk's
 * pages (`parseTranskription`). Wrong markers are RETURNED (`ok: false`), not
 * thrown — the caller owns the one retry. Throws on a refusal or a cut-off.
 */
export function tolkaTranskriptionSvar(
  svar: SvarMeddelande,
  forstaSida: number,
  antalSidor: number,
  maxTokens: number,
): TranskriptionsTolkning {
  kontrolleraStoppgrund(svar, "Transkriberingen", maxTokens);
  const text = svar.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
  return parseTranskription(text, forstaSida, antalSidor);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** A chunk's transcription still had wrong page markers after the one retry. */
export class TranskriberingMarkorFelError extends Error {
  constructor(
    public readonly forstaSida: number,
    public readonly sistaSida: number,
    public readonly fel: readonly string[],
  ) {
    super(
      `Transkriberingen av sidorna ${forstaSida}–${sistaSida} gav felaktiga sidmarkörer även efter ett ` +
        `omförsök (${fel.join("; ")}). Siffror får inte kopplas till fel sida, så analysen avbryts.`,
    );
    this.name = "TranskriberingMarkorFelError";
  }
}

/** The run hit its overall deadline (`deadlineMs`). Transient by definition: the
 *  finished pages are saved, so the next job attempt continues where this one
 *  stopped. */
export class TranskriberingTidsgransError extends Error {
  constructor(public readonly deadlineMs: number) {
    super(
      `Transkriberingen nådde tidsgränsen på ${Math.round(deadlineMs / 1000)} s; sidorna som hann bli ` +
        "klara är sparade och nästa försök fortsätter därifrån.",
    );
    this.name = "TranskriberingTidsgransError";
  }
}

/** Transient API failure worth exactly one retry of the chunk: connection
 *  errors (measured: 2 of 7 chunks once failed with "Connection error"),
 *  429, 5xx and 529 (overloaded). Duck-typed so test doubles need no SDK class. */
export function arOvergaendeApiFel(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error instanceof TranskriberingTidsgransError) return true;
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number") return status === 429 || status >= 500;
  if (error.name === "APIConnectionError" || error.name === "APIConnectionTimeoutError")
    return true;
  return /connection error|ECONNRESET|EPIPE|ETIMEDOUT|socket hang up|fetch failed|overloaded/i.test(
    error.message,
  );
}

// ---------------------------------------------------------------------------
// transkribera
// ---------------------------------------------------------------------------

export interface TranskriberaOptions {
  /** Default STANDARD_MODELL. */
  model?: string;
  /** Total budget for the chunks of THIS run. The sum of their worst cases must
   *  fit (checked before any call is made), see `transkribera`. */
  maxCostSek: number;
  /** Default "medium" (measured configuration). */
  effort?: ModelEffort;
  client?: AnthropicClientLike;
  apiKey?: string;
  pricing?: ModelPricing;
  /** Default STANDARD_CHUNKSTORLEK (5). */
  chunkStorlek?: number;
  /** Worst-case output tokens per chunk, default STANDARD_MAX_OUTPUT_PER_CHUNK. */
  maxOutputTokensPerChunk?: number;
  /** Pages already persisted (1-based page -> text). A chunk whose every page is
   *  here is skipped (no call, no cost). */
  redanKlara?: ReadonlyMap<number, string>;
  /** Called once per finished chunk with that chunk's pages, so a retry after a
   *  failure only redoes the missing chunks. A rejection fails that chunk. */
  sparaSidor?: (sidor: TranskriberadSida[]) => Promise<void>;
  /** Pause before the single retry of a chunk after a transient API error.
   *  Default 1000 ms; tests pass 0. */
  omforsokFordrojningMs?: number;
  /** Overall deadline for the whole run, default STANDARD_DEADLINE_MS. */
  deadlineMs?: number;
  /**
   * At most this many chunks are sent (and built, and pre-flighted) in this run;
   * the rest stay for the next run (`kvarChunkar` in the result). Bounds the CPU
   * an invocation spends on splitting, base64 and parsing — the Edge Function
   * has a 2 s hard CPU limit. Default: no limit.
   */
  maxChunkar?: number;
}

export interface TranskriberaResultat {
  /** Every page of the PDF in page order (redanKlara pages included). */
  sidor: TranskriberadSida[];
  /** Real spend of THIS run (skipped chunks cost nothing). */
  spentSek: number;
  /** Chunks that still lack pages after this run because of `maxChunkar` (0 when
   *  the run finished everything it was asked to). */
  kvarChunkar: number;
  /** Every `messages.create` call this run made (retries included), in the order they finished. */
  calls: ModelCallMetrics[];
}

function inneharAllaSidor(bit: PdfDel, klara: ReadonlyMap<number, string> | undefined): boolean {
  if (!klara) return false;
  for (let n = bit.forstaSida; n < bit.forstaSida + bit.sidor; n++) {
    if (!klara.has(n)) return false;
  }
  return true;
}

function sov(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/**
 * Transcribes a PDF without a text layer. Chunks run in parallel
 * (Promise.allSettled — one failing chunk does not stop the others from
 * finishing and being persisted via `sparaSidor`).
 *
 * Budget: countTokens runs for every chunk first; if the SUM of the chunks'
 * worst cases (full input price + max output) exceeds `maxCostSek`,
 * KostnadsgransOverskriden is thrown before any chunk is sent, so parallel
 * calls can never jointly exceed the cap. A retry of a chunk re-checks against
 * what is spent plus what is still in flight. Failures are annotated with the
 * run's real spend and calls (annotateSpend), like every other stage.
 */
export async function transkribera(
  pdfBytes: Uint8Array,
  options: TranskriberaOptions,
): Promise<TranskriberaResultat> {
  const {
    model = STANDARD_MODELL,
    maxCostSek,
    effort = "medium",
    pricing = prissattningForModell(model),
    chunkStorlek = STANDARD_CHUNKSTORLEK,
    maxOutputTokensPerChunk = STANDARD_MAX_OUTPUT_PER_CHUNK,
    redanKlara,
    sparaSidor,
    omforsokFordrojningMs = 1000,
    deadlineMs = STANDARD_DEADLINE_MS,
    maxChunkar = Number.POSITIVE_INFINITY,
  } = options;

  // Which chunks still need work: those without every page saved. Only the first
  // `maxChunkar` of them are built and sent in this run.
  const saknas = (del: PdfDel) => !inneharAllaSidor(del, redanKlara);
  let behovsAntal = 0;
  const { plan, bitar: attGora } = await delaPdfUrval(pdfBytes, chunkStorlek, (p) => {
    const behov = p.filter(saknas);
    behovsAntal = behov.length;
    return new Set(behov.slice(0, maxChunkar).map((d) => d.forstaSida));
  });
  const kvarChunkar = Math.max(0, behovsAntal - attGora.length);
  const klaraSidor: TranskriberadSida[] = [];
  for (const del of plan) {
    if (saknas(del)) continue;
    for (let n = del.forstaSida; n < del.forstaSida + del.sidor; n++) {
      klaraSidor.push({ sida: n, text: redanKlara!.get(n)! });
    }
  }

  const calls: ModelCallMetrics[] = [];
  let spentSek = 0;
  // Worst case of calls currently in flight (released when a call finishes).
  let reserveratSek = 0;
  const nyaSidor: TranskriberadSida[] = [];
  const avbryt = new AbortController();
  const tidsgrans = setTimeout(() => avbryt.abort(), deadlineMs);

  try {
    if (attGora.length > 0) {
      const client = resolveClient(options);

      const forberedda = attGora.map((bit) => ({
        bit,
        begaran: byggTranskriptionRequest(bit, {
          model,
          maxTokens: maxOutputTokensPerChunk,
          effort,
        }),
      }));

      // Free pre-flight for every chunk before the first paid call.
      const antalTokens = await Promise.all(
        forberedda.map((f) => client.messages.countTokens(tillRakneParams(f.begaran))),
      );
      const varstaFall = antalTokens.map((c) =>
        estimateCostSek(c.input_tokens, maxOutputTokensPerChunk, pricing),
      );
      const summaVarstaFall = varstaFall.reduce((a, b) => a + b, 0);
      if (summaVarstaFall > maxCostSek) {
        throw new KostnadsgransOverskriden(summaVarstaFall, maxCostSek);
      }

      const korChunk = async (index: number): Promise<void> => {
        const { bit, begaran } = forberedda[index]!;
        const sistaSida = bit.forstaSida + bit.sidor - 1;
        const inputTokens = antalTokens[index]!.input_tokens;
        let overgaendeFelAnvant = false;
        let markorOmforsokAnvant = false;

        // At most 3 attempts: the first, one retry after a transient API error,
        // one retry after wrong page markers (each kind of retry at most once).
        for (let forsok = 0; ; forsok++) {
          if (avbryt.signal.aborted) throw new TranskriberingTidsgransError(deadlineMs);
          const varsta = estimateCostSek(inputTokens, maxOutputTokensPerChunk, pricing);
          if (forsok > 0) {
            // A retry: its own worst case must fit next to what is spent and in flight.
            enforceCostLimit(
              inputTokens,
              maxOutputTokensPerChunk,
              maxCostSek - spentSek - reserveratSek,
              pricing,
            );
          }
          reserveratSek += varsta;

          let svar;
          const start = performance.now();
          try {
            svar = await client.messages.create(begaran, { signal: avbryt.signal });
          } catch (error) {
            reserveratSek -= varsta;
            if (avbryt.signal.aborted) throw new TranskriberingTidsgransError(deadlineMs);
            if (arOvergaendeApiFel(error) && !overgaendeFelAnvant) {
              overgaendeFelAnvant = true;
              await sov(omforsokFordrojningMs);
              continue;
            }
            throw error;
          }
          const latencyMs = performance.now() - start;
          reserveratSek -= varsta;

          const metrics = buildCallMetrics({
            stage: "transkribering",
            model,
            latencyMs,
            usage: svar.usage,
            stopReason: svar.stop_reason,
            pricing,
          });
          calls.push(metrics);
          spentSek += metrics.costSek;

          let tolkning;
          try {
            tolkning = tolkaTranskriptionSvar(
              svar,
              bit.forstaSida,
              bit.sidor,
              maxOutputTokensPerChunk,
            );
          } catch (error) {
            // Refusal / cut-off: the call was paid for.
            throw error instanceof Error ? annotateSpend(error, spentSek, calls) : error;
          }
          if (tolkning.ok) {
            nyaSidor.push(...tolkning.sidor);
            if (sparaSidor) await sparaSidor(tolkning.sidor);
            return;
          }
          if (markorOmforsokAnvant) {
            throw new TranskriberingMarkorFelError(bit.forstaSida, sistaSida, tolkning.fel);
          }
          markorOmforsokAnvant = true;
        }
      };

      const utfall = await Promise.allSettled(forberedda.map((_, i) => korChunk(i)));
      // A deterministic failure (wrong markers, truncation, refusal) is reported in
      // preference to the deadline: it will not go away on another attempt.
      const avvisade = utfall.filter((u): u is PromiseRejectedResult => u.status === "rejected");
      const forstaFel =
        avvisade.find((u) => !(u.reason instanceof TranskriberingTidsgransError)) ?? avvisade[0];
      if (forstaFel) {
        const reason: unknown = forstaFel.reason;
        throw reason instanceof Error ? annotateSpend(reason, spentSek, calls) : reason;
      }
    }

    const sidor = [...klaraSidor, ...nyaSidor].sort((a, b) => a.sida - b.sida);
    return { sidor, spentSek, calls, kvarChunkar };
  } finally {
    clearTimeout(tidsgrans);
  }
}
