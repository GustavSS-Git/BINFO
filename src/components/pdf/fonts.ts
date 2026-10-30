import { Font } from "@react-pdf/renderer";

/** Registered family names, used by the PDF documents' StyleSheets. */
export const FONT_SANS = "Inter";
export const FONT_SERIF = "Source Serif 4";

/** Weights actually registered: Inter 400 and 600, Source Serif 4 600. */
export const WEIGHT_REGULAR = 400;
export const WEIGHT_SEMIBOLD = 600;

export interface PdfFontSources {
  sans: { regular: string; semibold: string };
  serif: { semibold: string };
}

/**
 * Public paths — served as static files from public/fonts/ (see that
 * directory's OFL-*.txt for licences). Self-hosted deliberately: react-pdf's
 * font loader does a plain `fetch`, and depending on a live Google Fonts URL
 * at runtime would make PDF export fail offline and break å/ä/ö rendering
 * without warning. Inter files are Latin subsets of the official 4.1 release;
 * Source Serif 4 is the unmodified official 4.005 TTF.
 */
export const DEFAULT_FONT_SOURCES: PdfFontSources = {
  sans: {
    regular: "/fonts/Inter-Regular.ttf",
    semibold: "/fonts/Inter-SemiBold.ttf",
  },
  serif: {
    semibold: "/fonts/SourceSerif4-Semibold.ttf",
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
      { src: sources.sans.regular, fontWeight: WEIGHT_REGULAR },
      { src: sources.sans.semibold, fontWeight: WEIGHT_SEMIBOLD },
    ],
  });
  Font.register({
    family: FONT_SERIF,
    fonts: [{ src: sources.serif.semibold, fontWeight: WEIGHT_SEMIBOLD }],
  });
  // react-pdf's default hyphenation engine uses an English dictionary and
  // mangles Swedish words with wrong break points. An unbroken long word
  // wrapping whole to the next line is preferable to a wrongly hyphenated one.
  Font.registerHyphenationCallback((word) => [word]);
}
