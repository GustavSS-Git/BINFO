import type { Grundfynd } from "./prompts";

/**
 * Grounding over a transcription (docs/PLAN-v2.md §1.9, "V2b"): the transcribed
 * pages become ONE custom-content document whose content blocks are FINE —
 * paragraphs and individual table rows — and every block remembers which
 * original page it came from. Anthropic's `content_block_location` citations
 * name blocks by index only, so this map is the sole source of page numbers
 * for a scanned report. One block per page made citations cite whole pages
 * (extraction input 24–45k tokens); fine blocks cut it to 9–13k at equal
 * accuracy.
 */

export interface Transkriptionssida {
  /** Original 1-based page number in the PDF. */
  sida: number;
  text: string;
}

export interface Transkriptionsblock {
  text: string;
  /** Original page this block came from — the only page number ever reported. */
  sida: number;
}

/**
 * Splits each page into blocks: every line containing " | " (a table row) is
 * its own block; other consecutive lines form one paragraph block, split at
 * blank lines. Pages with no text produce no block (the API rejects empty text
 * blocks). Order is page order, then reading order.
 */
export function byggTranskriptionsblock(
  sidor: readonly Transkriptionssida[],
): Transkriptionsblock[] {
  const block: Transkriptionsblock[] = [];
  const sorterade = [...sidor].sort((a, b) => a.sida - b.sida);
  for (const s of sorterade) {
    let stycke: string[] = [];
    const tomStycket = () => {
      if (stycke.length > 0) block.push({ text: stycke.join("\n"), sida: s.sida });
      stycke = [];
    };
    for (const rad of s.text.split(/\r?\n/)) {
      if (rad.trim() === "") {
        tomStycket();
      } else if (rad.includes(" | ")) {
        tomStycket();
        block.push({ text: rad.trim(), sida: s.sida });
      } else {
        stycke.push(rad.trimEnd());
      }
    }
    tomStycket();
  }
  return block;
}

/** The `document` content block for the grounding call. */
export function byggTranskriptionsdokument(block: readonly Transkriptionsblock[]) {
  return {
    type: "document" as const,
    source: {
      type: "content" as const,
      content: block.map((b) => ({ type: "text" as const, text: b.text })),
    },
    title: "Årsredovisning (transkriberad)",
    citations: { enabled: true },
  };
}

/** Minimal shape of a grounding response block carrying citations. */
export interface InnehallsCitatBlock {
  type: string;
  text: string;
  citations?: Array<{
    type: string;
    cited_text?: string;
    document_index?: number;
    start_block_index?: number;
    end_block_index?: number;
  }> | null;
}

/**
 * Turns `content_block_location` citations into findings with real pages.
 * A citation covers blocks [start_block_index, end_block_index); every cited
 * block is mapped through `block` and a citation spanning several pages yields
 * one finding per distinct page (same quote). A page number is ONLY ever taken
 * from the map: a citation whose index is not an integer inside the map (or
 * that names another document) is dropped and counted in `avvisade` — never
 * guessed. Citation types other than content_block_location are ignored.
 */
export function extraheraTranskriptionsfynd(
  svarsblock: readonly InnehallsCitatBlock[],
  block: readonly Transkriptionsblock[],
): { fynd: Grundfynd[]; avvisade: number } {
  const fynd: Grundfynd[] = [];
  let avvisade = 0;
  for (const b of svarsblock) {
    if (b.type !== "text" || !b.citations) continue;
    for (const c of b.citations) {
      if (c.type !== "content_block_location") continue;
      if (!c.cited_text) continue;
      const start = c.start_block_index;
      if (
        typeof start !== "number" ||
        !Number.isInteger(start) ||
        start < 0 ||
        (c.document_index !== undefined && c.document_index !== 0)
      ) {
        avvisade++;
        continue;
      }
      const slutExkl =
        typeof c.end_block_index === "number" && Number.isInteger(c.end_block_index)
          ? Math.max(c.end_block_index, start + 1)
          : start + 1;
      const sidor: number[] = [];
      let ogiltig = false;
      for (let i = start; i < slutExkl; i++) {
        const sida = block[i]?.sida;
        if (sida === undefined) {
          ogiltig = true;
          break;
        }
        if (!sidor.includes(sida)) sidor.push(sida);
      }
      if (ogiltig) {
        avvisade++;
        continue;
      }
      // A paragraph block is several transcribed lines; its newlines are line wraps, not
      // content. Collapsing them keeps a multi-line quote from leaking a raw newline into
      // the extraction model's JSON string (which would not parse).
      const citat = c.cited_text.replace(/\s*\n\s*/g, " ");
      for (const sida of sidor) fynd.push({ text: b.text, citat, sida });
    }
  }
  return { fynd, avvisade };
}
