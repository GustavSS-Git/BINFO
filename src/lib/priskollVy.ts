/**
 * Texts and numbers for the Priskoll result block (`PriskollResultat`, redesign v4):
 * the verdict heading, the paragraph, the span bar markers and the "Värdering i siffror"
 * rows. Pure and client-safe. Every sentence is derived from the same values the numbers
 * show (owner rule "text follows calculation"): the verdict compares the asking price with
 * the displayed ±10 % span of the BASELINE value (Priskollen has no fee prognosis).
 */

import type { Budpremie, PrisanalysUtanForening } from "@/types/analysis";
import {
  avrundaVardering,
  formatVarde,
  formatVardespann,
  lageMotVardespann,
  vardespann,
} from "@/lib/analysisView";
import { formatMkr, formatSpannMkr, iEllerPaOmrade, kvmPris, vanligtBud } from "@/lib/prisVy";

export { iEllerPaOmrade };

function procentTal(v: number): string {
  return Math.abs(v).toLocaleString("sv-SE", { maximumFractionDigits: 1 });
}

/** The bid statistic as one sentence; the figure is the MEDIAN, so the wording says "typiskt". */
export function budgivningsMening(b: Budpremie): string {
  const plats = iEllerPaOmrade(b.omrade);
  if (b.medianProcent > 0.5) {
    return `Räkna med budgivning: ${plats} har bostäder typiskt sålts för ${procentTal(b.medianProcent)} % över utgångspriset.`;
  }
  const versal = plats.charAt(0).toUpperCase() + plats.slice(1);
  if (b.medianProcent < -0.5) {
    return `${versal} har bostäder typiskt sålts för ${procentTal(b.medianProcent)} % under utgångspriset.`;
  }
  return `${versal} har bostäder typiskt sålts för ungefär utgångspriset.`;
}

export interface PriskollMarkor {
  label: string;
  varde: number;
  text: string;
  ton: "utgangspris" | "bud" | "vardering";
}

export interface PriskollVy {
  /** Binfo's own valuation exists (otherwise only the "inte tillgänglig" row). */
  harVarde: boolean;
  rubrik: string;
  stycke: string | null;
  spann: { lag: number; hog: number; markorer: PriskollMarkor[]; ariaLabel: string } | null;
  rader: { label: string; varde: string; note: string }[];
}

export function byggPriskollVy(p: PrisanalysUtanForening, boarea: number): PriskollVy {
  const bas = p.externVardering?.value ?? null;
  const utg = p.utgangspris?.value ?? null;
  if (bas === null || !(bas > 0)) {
    return { harVarde: false, rubrik: "Binfos värdering", stycke: null, spann: null, rader: [] };
  }

  const visatBas = avrundaVardering(bas);
  const { low, high } = vardespann(bas);
  const lage = utg !== null ? lageMotVardespann(utg, bas) : null;
  const lageOrd = lage === "under" ? "under" : lage === "over" ? "över" : "inom";

  const rubrik =
    lage !== null
      ? `Utgångspriset ligger ${lageOrd} spannet`
      : `Liknande lägenheter säljs för ca ${formatMkr(visatBas)}`;

  let stycke =
    `Liknande lägenheter i området säljs för omkring ${formatMkr(visatBas)}, ` +
    `och spannet är ${formatSpannMkr(bas)}.`;
  if (utg !== null) {
    stycke += ` Utgångspriset ${formatMkr(avrundaVardering(utg))} ligger ${lageOrd} det.`;
    if (p.budpremie) stycke += ` ${budgivningsMening(p.budpremie)}`;
  }

  const bud = vanligtBud(utg, p.budpremie);
  const markorer: PriskollMarkor[] = [];
  if (utg !== null) {
    markorer.push({
      label: "Utgångspris",
      varde: utg,
      text: formatMkr(avrundaVardering(utg)),
      ton: "utgangspris",
    });
  }
  if (bud !== null) {
    markorer.push({ label: "Vanligt bud", varde: bud, text: formatMkr(bud, 2), ton: "bud" });
  }
  markorer.push({
    label: "Liknande lägenheter",
    varde: visatBas,
    text: formatMkr(visatBas),
    ton: "vardering",
  });

  const ariaLabel =
    `Värdespann ${formatMkr(low, 2).replace(" mkr", "")} till ${formatMkr(high, 2).replace(" mkr", "")} ` +
    `miljoner kronor, liknande lägenheter plus minus 10 procent.` +
    (utg !== null
      ? ` Utgångspriset ${formatMkr(avrundaVardering(utg))} ligger ${lageOrd} spannet.`
      : "");

  const rader: PriskollVy["rader"] = [
    {
      label: "Liknande lägenheter",
      varde: `ca ${formatVarde(visatBas, "kr")}`,
      note: "Vad jämförbara lägenheter i området säljs för",
    },
    {
      label: "Rimligt prisintervall",
      varde: formatVardespann(bas),
      note: "Liknande lägenheter ± 10 %",
    },
  ];
  if (utg !== null) {
    rader.push({
      label: "Utgångspris",
      varde: formatVarde(utg, "kr"),
      note: kvmPris(utg, boarea) ?? "",
    });
  }
  if (bud !== null && p.budpremie) {
    const tecken = p.budpremie.medianProcent < 0 ? "−" : "+";
    rader.push({
      label: "Vanlig budnivå i området",
      varde: `ca ${formatVarde(bud, "kr")}`,
      note: `Utgångspris ${tecken} ${procentTal(p.budpremie.medianProcent)} %, typiskt ${iEllerPaOmrade(p.budpremie.omrade)}`,
    });
  }

  return {
    harVarde: true,
    rubrik,
    stycke,
    spann: { lag: low, hog: high, markorer, ariaLabel },
    rader,
  };
}
