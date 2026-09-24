import type { AnalysisResult } from "@/types/analysis";

const SWEDISH_TRANSLITERATION: Record<string, string> = {
  å: "a",
  ä: "a",
  ö: "o",
};

/**
 * Lowercase, ASCII, hyphen-separated slug. Swedish å/ä/ö are transliterated
 * explicitly (å/ä -> a, ö -> o) rather than just stripped by the NFKD
 * diacritic-strip below, since NFKD-stripping å (a + ring) would silently
 * produce the same "a" anyway, but ö is not a combining-diacritic
 * decomposition in all environments — being explicit keeps this correct and
 * self-documenting rather than relying on that coincidence.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .split("")
    .map((ch) => SWEDISH_TRANSLITERATION[ch] ?? ch)
    .join("")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * `binfo-analys-<förening-slug>-<YYYY-MM-DD>.pdf`. Dated by the analysis's
 * own `skapad` timestamp (when the report was produced), not "today" —
 * downloading the same analysis twice on different days should yield the
 * same, stable filename.
 */
export function buildPdfFilename(analys: AnalysisResult): string {
  const slug = slugify(analys.forening.namn) || "analys";
  const datum = analys.skapad.slice(0, 10);
  return `binfo-analys-${slug}-${datum}.pdf`;
}
