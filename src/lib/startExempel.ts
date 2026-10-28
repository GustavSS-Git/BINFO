/**
 * The example block on the landing page (redesign v4). Every figure is derived from
 * `sampleAnalysis` through the same view helpers the report uses, so regenerating `/exempel`
 * updates the start page too. Pure and client-safe.
 */
import {
  avgiftKort,
  avrundaVardering,
  forstaMening,
  horisontText,
  formatFigureVarde,
  lageMotVardespann,
  visatVarde,
} from "@/lib/analysisView";
import { BETYG_TITEL } from "@/lib/betygVy";
import { formatMkr, formatSpannMkr } from "@/lib/prisVy";
import type { AnalysisResult, Grade, KeyFigureId, Status } from "@/types/analysis";

export interface StartExempelRad {
  etikett: string;
  varde: string;
  status: Status;
}

export interface StartExempel {
  rubrik: string;
  undertext: string;
  forening: { betyg: Grade; titel: string; text: string };
  vardering: { varde: string; spann: string | null; text: string | null };
  avgift: { varde: string; rad: string | null; text: string };
  nyckeltal: StartExempelRad[];
}

/** The three figures shown, with the short labels of the artboard. */
const URVAL: Array<{ id: KeyFigureId; etikett: string }> = [
  { id: "sparande_per_m2_totalyta", etikett: "Sparande per m²" },
  { id: "skuldsattning_per_m2_brf_yta", etikett: "Skuld per m² bostadsrättsyta" },
  { id: "rantekanslighet", etikett: "Räntekänslighet" },
];

const LAGE_TEXT = { under: "under spannet", inom: "inom spannet", over: "över spannet" } as const;

export function byggStartExempel(analys: AnalysisResult): StartExempel {
  const p = analys.prisanalys;
  const visat = visatVarde(p);
  const utgangspris = p.utgangspris?.value ?? null;
  const lage = visat && utgangspris !== null ? lageMotVardespann(utgangspris, visat.exakt) : null;
  const omrade = p.varderingsunderlag?.omrade ?? p.varderingsunderlag?.kommun ?? null;
  const undertext = [
    omrade ? `${analys.forening.namn}, ${omrade}` : analys.forening.namn,
    `${analys.input.antalRum} rok`,
    `${analys.input.boarea.toLocaleString("sv-SE")} m²`,
  ].join(" · ");

  const kort = avgiftKort(analys.avgiftsprognos, analys.rantestress.nuvarandeManadsavgift.value);
  const total = analys.avgiftsprognos?.totalKrPerManad ?? null;
  const horisont = analys.avgiftsprognos?.horisontManader ?? 24;
  const avgiftText =
    total === null
      ? kort.text
      : total > 0
        ? `Väntad höjning inom ${horisontText(horisont)}.`
        : total < 0
          ? `Väntad sänkning inom ${horisontText(horisont)}.`
          : kort.text;

  const nyckeltal: StartExempelRad[] = [];
  for (const u of URVAL) {
    const kf = analys.forening.keyFigures.find((k) => k.id === u.id);
    if (!kf || kf.figure.value === null) continue;
    nyckeltal.push({
      etikett: u.etikett,
      varde: formatFigureVarde(kf.figure),
      status: kf.status,
    });
  }

  return {
    rubrik: "Exempel på en analys",
    undertext,
    forening: {
      betyg: analys.betyg,
      titel: BETYG_TITEL[analys.betyg],
      text: forstaMening(analys.betygMotivering, 90),
    },
    vardering: {
      varde: visat ? `ca ${formatMkr(avrundaVardering(visat.exakt))}` : "Ingen värdering",
      spann: visat ? `Spann ${formatSpannMkr(visat.exakt)}` : null,
      text:
        lage !== null && utgangspris !== null
          ? `Utgångspriset ${formatMkr(utgangspris, 2)} ligger ${LAGE_TEXT[lage]}.`
          : null,
    },
    avgift: { varde: kort.varde, rad: kort.rad, text: avgiftText },
    nyckeltal,
  };
}
