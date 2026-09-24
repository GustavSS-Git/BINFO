import { Font } from "@react-pdf/renderer";

/** Registered family names, used by AnalysPdfDocument's StyleSheet. */
export const FONT_SANS = "IBM Plex Sans";
export const FONT_SERIF = "Libre Baskerville";

export interface PdfFontSources {
  sans: { regular: string; bold: string };
  serif: { regular: string; bold: string };
}

/**
 * Public paths — served as static files from public/fonts/ (see that
 * directory's OFL-*.txt for licences). Self-hosted deliberately: react-pdf's
 * font loader does a plain `fetch`, and depending on a live Google Fonts URL
 * at runtime would make PDF export fail offline and break å/ä/ö rendering
 * without warning (see task brief).
 */
export const DEFAULT_FONT_SOURCES: PdfFontSources = {
  sans: {
    regular: "/fonts/IBMPlexSans-Regular.ttf",
    bold: "/fonts/IBMPlexSans-Bold.ttf",
  },
  serif: {
    regular: "/fonts/LibreBaskerville-Regular.ttf",
    bold: "/fonts/LibreBaskerville-Bold.ttf",
  },
};

/**
 * Registers the two Binfo typefaces with react-pdf so Swedish characters
 * (å/ä/ö) render correctly — react-pdf's built-in Helvetica fallback is
 * missing glyphs for them. Safe to call more than once (e.g. once per
 * export): `Font.register` only replaces the family's font list, it does
 * not re-fetch until something actually renders with it.
 *
 * `sources` is overridable so tests can point at data: URLs instead of
 * site-relative paths — Node's fetch (used by react-pdf outside the
 * browser) cannot resolve a relative "/fonts/…" URL or a local file://
 * path, only http(s) and data: URLs.
 */
export function registerPdfFonts(sources: PdfFontSources = DEFAULT_FONT_SOURCES): void {
  Font.register({
    family: FONT_SANS,
    fonts: [
      { src: sources.sans.regular, fontWeight: "normal" },
      { src: sources.sans.bold, fontWeight: "bold" },
    ],
  });
  Font.register({
    family: FONT_SERIF,
    fonts: [
      { src: sources.serif.regular, fontWeight: "normal" },
      { src: sources.serif.bold, fontWeight: "bold" },
    ],
  });
  // react-pdf's default hyphenation engine uses an English dictionary and
  // mangles Swedish words with wrong break points. An unbroken long word
  // wrapping whole to the next line is preferable to a wrongly hyphenated one.
  Font.registerHyphenationCallback((word) => [word]);
}
