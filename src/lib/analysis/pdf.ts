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
