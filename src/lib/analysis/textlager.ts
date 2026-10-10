import { bedomTextkvalitet } from "./pdf";

/**
 * What the PDF's embedded text layer is worth:
 * - 'saknas': at least half of the pages are empty (a scan / vector-outlined
 *   text, possibly with a text cover page). Takes the transcription path
 *   (transkribering.ts): scanned pages are not citable on the native PDF route,
 *   so a document that is mostly scan must not take it even if a few pages
 *   have a text layer. Rule from docs/PLAN-v2.md §1.2 (a page is empty below
 *   20 characters); the 50 % share is a supervisor decision (2026-10-09).
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

/** A page with fewer characters than this (after trim) is "empty": a page
 *  number or a stamp on an otherwise image-only page. docs/PLAN-v2.md §1.2. */
export const TOM_SIDA_TECKEN = 20;

/** The share of empty pages from which a document is 'saknas'. */
export const SAKNAS_ANDEL_TOMMA_SIDOR = 0.5;

/** Classifies a document from its per-page extracted text (index 0 = page 1). */
export function klassificeraTextlager(pages: readonly string[]): Textlager {
  // No pages at all counts as no text layer (as it always did).
  if (pages.length === 0) return "saknas";
  const tomma = pages.filter((p) => p.trim().length < TOM_SIDA_TECKEN).length;
  if (tomma / pages.length >= SAKNAS_ANDEL_TOMMA_SIDOR) return "saknas";
  if (bedomTextkvalitet(pages) > TRASIGT_TEXTLAGER_GRANS) return "trasigt";
  return "ok";
}
