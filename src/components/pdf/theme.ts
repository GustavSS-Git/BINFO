/**
 * PDF export design tokens (redesign v4).
 *
 * react-pdf cannot read CSS custom properties or oklch() colours, so these are
 * the hex values of the site's palette (src/styles.css, "Design system
 * (redesign v4)" in CLAUDE.md). The PDF is white paper: no page tint.
 */
export const PDF_COLORS = {
  page: "#FFFFFF",
  /** Headings, the logo, key figures. */
  navy: "#0A2F5E",
  /** Eyebrows and links. */
  link: "#1C4FA3",
  ink: "#111418",
  text2: "#30363D",
  muted: "#4B535C",
  border: "#DCE1E8",
  divider: "#EEF1F5",
  tint: "#E8EEF8",
  track: "#E9EDF2",
  /** Inactive grade-scale step and its letter. */
  scaleOff: "#E2E7EE",
  scaleOffText: "#8A939D",
  /** Highlighted value span in the price bar. */
  span: "#B7C9E6",
  success: "#1E7A4D",
  successTint: "#E6F4EA",
  successText: "#1E6B3A",
  warningTint: "#FFEDD5",
  warningText: "#9A3412",
  /** Dot/stroke colour for "warning" (same hue as the C grade). */
  warning: "#B45309",
  noticeTint: "#FFF7E6",
  noticeBorder: "#F3D9A4",
  noticeText: "#5C3800",
  danger: "#B42318",
  dangerTint: "#FDECEA",
  dangerText: "#991B1B",
} as const;

/** Grade colours A–E (white letter on top). */
export const PDF_GRADE_COLORS = {
  A: "#14532D",
  B: "#1E7A4D",
  C: "#B45309",
  D: "#B42318",
  E: "#8A1C12",
} as const;

/** Same wording as the site footer (src/components/SiteNav.tsx SiteFooter),
 *  shortened to fit a one-line PDF footer. */
export const PDF_DISCLAIMER =
  "Binfo är ett beslutsstöd, inte finansiell rådgivning. Det slutgiltiga ansvaret ligger hos dig som köpare.";

export const PDF_PAGE_PADDING = 40;
