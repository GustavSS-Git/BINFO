import type { FeeInclusion } from "@/types/analysis";

/**
 * En kostnadspost inför spannberäkningen. `avgiftspost` kopplar posten till
 * ett fält i FeeInclusion — poster utan avgiftspost (ränta, amortering,
 * hemförsäkring, ...) kan aldrig ingå i månadsavgiften och räknas alltid med.
 */
export interface KostnadspostForSpann {
  belopp: number;
  avgiftspost?: keyof FeeInclusion;
}

export interface SpannResultat {
  low: number;
  high: number;
  /** True när minst en post är 'okant' — UI:t visar ett spann istället för en summa. */
  arSpann: boolean;
}

/**
 * 'ja'  — avgiften täcker posten, den läggs aldrig till kostnaden.
 * 'nej' — avgiften täcker den inte, posten är en känd extra kostnad.
 * 'okant' — low antar att avgiften täcker den (bästa fall), high antar att
 *           den inte gör det (sämsta fall). Aldrig ett tyst antagande åt
 *           något håll.
 */
export function beraknaSpann(
  poster: KostnadspostForSpann[],
  avgiftInkluderar: FeeInclusion,
): SpannResultat {
  let low = 0;
  let high = 0;
  let arSpann = false;

  for (const post of poster) {
    if (!post.avgiftspost) {
      low += post.belopp;
      high += post.belopp;
      continue;
    }

    const status = avgiftInkluderar[post.avgiftspost];
    if (status === "ja") continue;
    if (status === "nej") {
      low += post.belopp;
      high += post.belopp;
      continue;
    }

    // okant
    high += post.belopp;
    arSpann = true;
  }

  return { low, high, arSpann };
}
