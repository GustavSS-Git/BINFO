/**
 * Geometry of the price-span bar in the PDF (Section 2). Pure, so it can be tested
 * without react-pdf. Mirrors SpanBar in src/components/ui/binfo.tsx: the axis runs
 * over the span and every marker with 12 % margin, markers sorted by value
 * alternate above/below the bar, and a label that would overlap its neighbour on
 * the same side moves to an outer row.
 */
export type SpanMarkorTon = "utgangspris" | "bud" | "vardering" | "liknande";

export interface SpanMarkorIn {
  label: string;
  varde: number;
  text: string;
  ton: SpanMarkorTon;
}

export interface SpanMarkorUt extends SpanMarkorIn {
  /** Tick centre in pt from the left edge of the bar. */
  x: number;
  /** Left edge of the label box in pt. */
  labelLeft: number;
  sida: "over" | "under";
  /** 0 = nearest the bar, 1 = outer row. */
  rad: 0 | 1;
}

export interface SpanLayout {
  breddPt: number;
  spannVanster: number;
  spannBredd: number;
  markorer: SpanMarkorUt[];
  /** Number of label rows above/below (1 or 2). */
  radOver: number;
  radUnder: number;
}

export const SPAN_LABEL_BREDD = 112;

export function layoutSpanBar(
  lag: number,
  hog: number,
  markorer: SpanMarkorIn[],
  breddPt: number,
): SpanLayout {
  const alla = [lag, hog, ...markorer.map((m) => m.varde)];
  const min = Math.min(...alla);
  const max = Math.max(...alla);
  const bredd = max - min > 0 ? max - min : Math.max(1, Math.abs(max) * 0.1);
  const marginal = bredd * 0.12;
  const axMin = min - marginal;
  const axBredd = bredd + 2 * marginal;
  const pos = (v: number) => Math.min(0.97, Math.max(0.03, (v - axMin) / axBredd)) * breddPt;

  const sorterade = [...markorer].sort((a, b) => a.varde - b.varde);
  // Right edge of the last label in each (side, row).
  const slut: Record<"over" | "under", [number, number]> = {
    over: [-Infinity, -Infinity],
    under: [-Infinity, -Infinity],
  };
  const ut: SpanMarkorUt[] = sorterade.map((m, i) => {
    const sida = i % 2 === 0 ? ("over" as const) : ("under" as const);
    const x = pos(m.varde);
    const labelLeft = Math.min(Math.max(x - SPAN_LABEL_BREDD / 2, 0), breddPt - SPAN_LABEL_BREDD);
    const ledig = [0, 1].find((r) => labelLeft >= slut[sida][r as 0 | 1] + 4);
    const rad = (ledig ?? 0) as 0 | 1;
    slut[sida][rad] = labelLeft + SPAN_LABEL_BREDD;
    return { ...m, x, labelLeft, sida, rad };
  });
  const vanster = pos(lag);
  return {
    breddPt,
    spannVanster: vanster,
    spannBredd: Math.max(0, pos(hog) - vanster),
    markorer: ut,
    radOver: ut.some((m) => m.sida === "over" && m.rad === 1) ? 2 : 1,
    radUnder: ut.some((m) => m.sida === "under" && m.rad === 1) ? 2 : 1,
  };
}
