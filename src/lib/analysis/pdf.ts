import { extractText, getDocumentProxy } from "unpdf";

export interface PdfTextExtraction {
  totalPages: number;
  /** Text per page, index 0 = page 1. */
  pages: string[];
  /** Mirrors Datakvalitet.pdfSaknarTextlager — true when no page yielded any
   *  extractable text, i.e. the document is (or behaves like) a scan with no
   *  embedded text layer. */
  pdfSaknarTextlager: boolean;
}

/**
 * A page with zero extractable text is indistinguishable, for our purposes,
 * from an image-only scan of that page — pdf.js only returns text items
 * when the page has an actual text layer. The whole document counts as
 * "saknar textlager" only when EVERY page is empty; a report with a few
 * scanned attachment pages among otherwise-real text should still proceed
 * to extraction with whatever text is available.
 */
export function pdfHasNoTextLayer(pages: string[]): boolean {
  return pages.every((page) => page.trim().length === 0);
}

/**
 * Extracts text page-by-page from raw PDF bytes. Deliberately returns the
 * "no text layer" signal as data rather than throwing — the caller (the
 * terminal script) decides how loudly to fail and whether to charge the
 * user, this module's job is only detection.
 */
export async function extractPdfText(data: Uint8Array): Promise<PdfTextExtraction> {
  const pdf = await getDocumentProxy(data);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });

  return {
    totalPages,
    pages: text,
    pdfSaknarTextlager: pdfHasNoTextLayer(text),
  };
}

// ---------------------------------------------------------------------------
// Text-quality heuristic — local, no API call, NOT wired into any decision.
//
// A page with a real text layer still fails `pdfHasNoTextLayer` detection
// when pdf.js hands back text, but garbled: e.g. test_rapport.pdf prints
// "7 , 4 3 8 , 0 0" instead of "7 438,00" — every character (and the comma)
// comes back as its own whitespace-separated token, because the PDF's
// internal text layer places each glyph in its own run. `pdfSaknarTextlager`
// correctly says this document HAS a text layer (it does — it's just
// useless for reading numbers), so a second, independent signal is needed
// to flag it. This is exactly that signal: task 1.3c asks for it exported
// and reported on, explicitly NOT for it to gate extraction — a report with
// some genuinely single-character tokens (e.g. a bulleted list of room
// letters) shouldn't be refused on this alone, and the model may still read
// a garbled layer better than this heuristic expects.
// ---------------------------------------------------------------------------

export interface SidasTextkvalitet {
  /** 1-indexed, matching PdfTextExtraction.pages' index+1. */
  sida: number;
  tokenAntal: number;
  /** Share (0–1) of whitespace-separated tokens on this page that are
   *  exactly one character long. 0 for a page with no tokens at all —
   *  an empty page isn't "garbled", it's just empty (pdfHasNoTextLayer's
   *  job to flag, not this one's). */
  andelEntecknsTokens: number;
}

/** Splits on any whitespace, drops empty tokens from consecutive separators. */
function tokenisera(text: string): string[] {
  return text.split(/\s+/).filter((t) => t.length > 0);
}

/** Per-page score — the share of single-character tokens, the heuristic
 *  task 1.3c asks for by name. Pure and total; never throws. */
export function bedomTextkvalitetPerSida(sidor: readonly string[]): SidasTextkvalitet[] {
  return sidor.map((text, i) => {
    const tokens = tokenisera(text);
    const entecken = tokens.filter((t) => t.length === 1).length;
    return {
      sida: i + 1,
      tokenAntal: tokens.length,
      andelEntecknsTokens: tokens.length === 0 ? 0 : entecken / tokens.length,
    };
  });
}

/**
 * One document-level score: the token-weighted average share of
 * single-character tokens across every page that has any tokens at all
 * (empty pages don't participate — they'd otherwise dilute the score
 * without saying anything about garbling). 0 for a document with no text
 * anywhere.
 *
 * No threshold is defined or enforced here — see the file-level comment.
 * A caller who wants a yes/no signal picks its own cutoff explicitly.
 */
export function bedomTextkvalitet(sidor: readonly string[]): number {
  const perSida = bedomTextkvalitetPerSida(sidor);
  const totaltAntalTokens = perSida.reduce((sum, s) => sum + s.tokenAntal, 0);
  if (totaltAntalTokens === 0) return 0;

  const viktatSumma = perSida.reduce((sum, s) => sum + s.andelEntecknsTokens * s.tokenAntal, 0);
  return viktatSumma / totaltAntalTokens;
}
