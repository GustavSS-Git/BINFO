import { bedomTextkvalitet, pdfHasNoTextLayer } from "./pdf";

/**
 * What the PDF's embedded text layer is worth:
 * - 'saknas': every page is empty (a scan / vector-outlined text). Takes the
 *   transcription path (transkribering.ts).
 * - 'trasigt': a layer exists but reads as glyph soup (one token per glyph).
 *   Recorded only — measured 2026-10-09 (docs/PLAN-v2.md §1.9): the normal text
 *   path still scores better on such a report than the scan path does, so it
 *   does NOT take the transcription path.
 * - 'ok': normal.
 */
export type Textlager = "ok" | "saknas" | "trasigt";

/**
 * `bedomTextkvalitet` above this → 'trasigt'. Measured 2026-10-09:
 * test_rapport.pdf scores 0.785, every other report in the corpus <= 0.35.
 * Same value as src/server/register.ts's TRASIGT_TEXTLAGER_GRANS (kept in sync
 * by hand; this module is client-safe, the server one is not importable here).
 */
export const TRASIGT_TEXTLAGER_GRANS = 0.6;

/** Classifies a document from its per-page extracted text (index 0 = page 1). */
export function klassificeraTextlager(pages: readonly string[]): Textlager {
  // Today's rule exactly: every page empty (after trim) = no text layer.
  if (pdfHasNoTextLayer([...pages])) return "saknas";
  if (bedomTextkvalitet(pages) > TRASIGT_TEXTLAGER_GRANS) return "trasigt";
  return "ok";
}
