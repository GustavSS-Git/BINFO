import { readFile, writeFile } from "node:fs/promises";
import type { ExtractionResult } from "@/types/analysis";
import { annotateSpend, errorHasKnownSpend, type ModelCallMetrics } from "./callMetrics";
import { extractPdfText } from "./pdf";
import {
  type AnthropicClientLike,
  runGrounding,
  runGroundingFranTranskription,
  runStructuredExtraction,
  type ModelEffort,
  type PromptCacheMode,
} from "./runExtraction";
import type { Sidreferensfynd } from "./sidreferenser";
import { klassificeraTextlager, type Textlager } from "./textlager";
import { transkribera, type TranskriberadSida } from "./transkribering";

/**
 * The extraction half of the pipeline as the two CLIs (cli.ts,
 * verifyAnswerKey.ts) run it, with the scan branch: a PDF without a text layer
 * goes transkribera -> runGroundingFranTranskription ->
 * runStructuredExtraction({ kalla: 'skannad' }); everything else keeps the
 * native-PDF route. Node-only (file cache), CLI use only.
 *
 * steg.ts will use the same building blocks, one stage per invocation — this is
 * the sequential reference composition.
 */

export interface StegTid {
  stage: "transkribering" | "grundning" | "extraktion";
  wallMs: number;
  spentSek: number;
}

export interface KorExtraktionOptions {
  model: string;
  maxCostSek: number;
  /** Cap used instead of `maxCostSek` when the PDF turns out to need transcription
   *  (the parallel chunks reserve their worst cases jointly, so it needs more
   *  headroom than the final cost suggests). */
  maxCostSekSkannad?: number;
  effortTranskribering: ModelEffort;
  effortGrounding: ModelEffort;
  effortExtraction: ModelEffort;
  promptCache: PromptCacheMode;
  /** Wraps each API-calling stage (e.g. one retry on a connection error). */
  omforsok?: <T>(anrop: () => Promise<T>) => Promise<T>;
  /** JSON file used as a page-level cache of the transcription (dev only): pages
   *  found here are not re-transcribed; each finished chunk is written back. */
  transkriptionsFil?: string | undefined;
  logg?: (rad: string) => void;
  /** Injected for tests; omitted = a real Anthropic client per stage. */
  client?: AnthropicClientLike;
}

export interface KorExtraktionResultat {
  textlager: Textlager;
  /** The cap that applied to this run (callers continue to judging under it). */
  tak: number;
  extraction: ExtractionResult;
  /** The page-reference check's findings (sidreferenser.ts). */
  sidreferenser: Sidreferensfynd[];
  calls: ModelCallMetrics[];
  spentSek: number;
  steg: StegTid[];
}

async function lasTranskriptionsfil(fil: string | undefined): Promise<Map<number, string>> {
  if (!fil) return new Map();
  try {
    const rå = JSON.parse(await readFile(fil, "utf-8")) as Record<string, string>;
    return new Map(Object.entries(rå).map(([sida, text]) => [Number(sida), text]));
  } catch {
    return new Map();
  }
}

export async function korExtraktion(
  pdfBytes: Uint8Array,
  options: KorExtraktionOptions,
): Promise<KorExtraktionResultat> {
  const {
    model,
    effortTranskribering,
    effortGrounding,
    effortExtraction,
    promptCache,
    omforsok = <T>(anrop: () => Promise<T>) => anrop(),
    transkriptionsFil,
    logg = () => undefined,
    client,
  } = options;

  // unpdf detaches the buffer it is given — hand it a copy.
  const { pages } = await extractPdfText(pdfBytes.slice());
  const textlager = klassificeraTextlager(pages);
  const maxCostSek =
    textlager === "saknas" ? (options.maxCostSekSkannad ?? options.maxCostSek) : options.maxCostSek;

  const calls: ModelCallMetrics[] = [];
  const steg: StegTid[] = [];
  let spentSek = 0;
  const tid = async <T extends { spentSek: number; calls: ModelCallMetrics[] }>(
    stage: StegTid["stage"],
    anrop: () => Promise<T>,
  ): Promise<T> => {
    const start = performance.now();
    const r = await anrop();
    steg.push({ stage, wallMs: performance.now() - start, spentSek: r.spentSek });
    calls.push(...r.calls);
    spentSek += r.spentSek;
    return r;
  };

  try {
    let groundingText: string;
    let pdfSaknarTextlager: boolean;
    // Page texts the extraction's page references are checked against: the
    // transcription of a scan, pdf.js text of a text PDF. Not for a garbled
    // ('trasigt') layer — what the model read there is the page image, not that text.
    let sidtexter: Map<number, string> | undefined;
    if (textlager === "saknas") {
      logg(`Textlager saknas (${pages.length} sidor) — transkriberar sidbilderna...`);
      const klara = await lasTranskriptionsfil(transkriptionsFil);
      const sparat = new Map(klara);
      const transkription = await tid("transkribering", () =>
        transkribera(pdfBytes, {
          ...(client ? { client } : {}),
          model,
          maxCostSek,
          effort: effortTranskribering,
          redanKlara: klara,
          sparaSidor: async (sidor: TranskriberadSida[]) => {
            if (!transkriptionsFil) return;
            for (const s of sidor) sparat.set(s.sida, s.text);
            await writeFile(transkriptionsFil, JSON.stringify(Object.fromEntries(sparat)));
          },
        }),
      );
      logg(`Transkribering klar (${transkription.spentSek.toFixed(2)} kr). Kör grundning...`);
      const grundning = await tid("grundning", () =>
        omforsok(() =>
          runGroundingFranTranskription(transkription.sidor, {
            ...(client ? { client } : {}),
            model,
            maxCostSek: maxCostSek - spentSek,
            effort: effortGrounding,
          }),
        ),
      );
      groundingText = grundning.groundingText;
      pdfSaknarTextlager = grundning.pdfSaknarTextlager;
      sidtexter = new Map(transkription.sidor.map((s) => [s.sida, s.text]));
    } else {
      if (textlager === "trasigt") {
        logg("Textlagret är trasigt — går den vanliga vägen (uppmätt bättre än skannvägen).");
      }
      const grundning = await tid("grundning", () =>
        omforsok(() =>
          runGrounding(pdfBytes, {
            ...(client ? { client } : {}),
            model,
            maxCostSek,
            effort: effortGrounding,
          }),
        ),
      );
      groundingText = grundning.groundingText;
      pdfSaknarTextlager = grundning.pdfSaknarTextlager;
      if (textlager === "ok") sidtexter = new Map(pages.map((text, i) => [i + 1, text]));
    }

    logg(`Grundning klar (${steg[steg.length - 1]!.spentSek.toFixed(2)} kr). Kör extraktion...`);
    const strukturerad = await tid("extraktion", () =>
      omforsok(() =>
        runStructuredExtraction(groundingText, {
          ...(client ? { client } : {}),
          model,
          maxCostSek: maxCostSek - spentSek,
          effort: effortExtraction,
          pdfSaknarTextlager,
          promptCache,
          kalla: textlager === "saknas" ? "skannad" : "textlager",
          ...(sidtexter ? { sidtexter } : {}),
        }),
      ),
    );

    return {
      textlager,
      tak: maxCostSek,
      extraction: strukturerad.extraction,
      sidreferenser: strukturerad.sidreferenser ?? [],
      calls,
      spentSek,
      steg,
    };
  } catch (error) {
    // A stage failed: report everything spent so far, not only the failing stage's own call(s).
    if (!(error instanceof Error)) throw error;
    const eget = errorHasKnownSpend(error) ? error : undefined;
    throw annotateSpend(error, spentSek + (eget?.spentSek ?? 0), [
      ...calls,
      ...(eget?.calls ?? []),
    ]);
  }
}
