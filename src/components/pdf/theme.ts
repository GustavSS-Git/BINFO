/**
 * PDF export design tokens.
 *
 * The PDF export is the one exception to Binfo's visual boundary (see
 * CLAUDE.md, "Visual boundary" — the owner explicitly carved out the PDF
 * layout). These are NOT the site's real design tokens — react-pdf cannot
 * read CSS custom properties or oklch() colours — they are hex
 * approximations of src/styles.css's `:root` palette, computed once (see
 * the task notes) so the PDF reads as visually "the same app" without
 * touching src/styles.css or any src/components/ui/binfo.tsx colour.
 */
export const PDF_COLORS = {
  background: "#faf9f6",
  card: "#ffffff",
  foreground: "#191714",
  mutedForeground: "#716d66",
  border: "#dedcd6",
  primary: "#627342",
  primaryTint: "#eef1e6",
  danger: "#c43939",
  dangerTint: "#fbecea",
  warning: "#e49e2d",
  warningForeground: "#884d01",
  warningTint: "#fdf3e4",
  success: "#3a8f63",
  successTint: "#e9f5ee",
  secondary: "#f1f0ea",
} as const;

/** Same wording as the site footer (src/components/SiteNav.tsx SiteFooter),
 *  shortened to fit a one-line PDF footer. */
export const PDF_DISCLAIMER =
  "Binfo är ett beslutsstöd, inte finansiell rådgivning. Det slutgiltiga ansvaret ligger hos dig som köpare.";

export const PDF_PAGE_PADDING = 40;
