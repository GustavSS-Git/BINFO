import {
  avrundaVardering,
  formatVardespann,
  lageMotVardespann,
  VARDESPANN_PROCENT,
} from "@/lib/analysisView";
import type { AnalysisResult, Grade, Sammanfattning } from "@/types/analysis";
import { refinansieringsMening } from "./refinansieringsflagga";

/**
 * The closing summary at the end of the report (owner 2026-10-24b): grade +
 * comment, Binfo's (adjusted) price vs utgångspris and the area's typical bid
 * premium, the expected fee rise, and a closing line.
 *
 * Buyer-level, so deterministic: built on every read from the assembled
 * result, never by a model. It informs; it never tells the buyer to buy or not
 * (the buyer decides), and it never states an association as a cause.
 */

const sv0 = (n: number) => n.toLocaleString("sv-SE", { maximumFractionDigits: 0 });
const sv1 = (n: number) => Math.abs(n).toLocaleString("sv-SE", { maximumFractionDigits: 1 });

/** "ca 5 680 000 kr": the shared rounding rule for displayed valuations
 *  (`avrundaVardering`, nearest 10 000 kr). */
function caPris(kr: number): string {
  return `ca ${sv0(avrundaVardering(kr))} kr`;
}

/** Fee amounts rounded to the nearest 10 kr. */
function caAvgift(kr: number): string {
  return `ca ${sv0(Math.round(Math.abs(kr) / 10) * 10)} kr`;
}

const BETYGSKOMMENTAR: Record<Grade, string> = {
  A: "Ekonomin ser stark ut enligt årsredovisningen.",
  B: "Ekonomin ser stabil ut, med några punkter att hålla koll på.",
  C: "Ekonomin har tydliga svagheter som är värda att fråga styrelsen om.",
  D: "Ekonomin har allvarliga svagheter.",
  E: "Ekonomin är mycket ansträngd.",
};

type Underlag = Omit<AnalysisResult, "sammanfattning">;

function betygText(r: Underlag): string {
  const svaga = r.forening.keyFigures.filter((kf) => kf.status === "svag").length;
  const kritiska = r.forening.keyFigures.filter((kf) => kf.status === "kritisk").length;
  const delar = [`Föreningen får betyget ${r.betyg}. ${BETYGSKOMMENTAR[r.betyg]}`];
  if (svaga + kritiska > 0) {
    const antal: string[] = [];
    if (kritiska > 0) antal.push(`${kritiska} med status kritisk`);
    if (svaga > 0) antal.push(`${svaga} med status svag`);
    delar.push(`Av nyckeltalen har ${antal.join(" och ")}.`);
  }
  const viktigast = r.rodaFlaggor.find((f) => f.severity === "hog") ?? r.rodaFlaggor[0];
  if (viktigast) delar.push(`Viktigast att känna till: ${viktigast.titel.replace(/[.!]$/, "")}.`);
  return delar.join(" ");
}

/** Under ±10 kr/månad counts as "no change", the same line avgiftText draws. */
const INGEN_FORANDRING_KR = 10;

/** Betyg whose own comment (BETYGSKOMMENTAR) speaks of weaknesses. */
const SVAGA_BETYG: readonly Grade[] = ["C", "D", "E"];

function listaOch(delar: string[]): string {
  return delar.length > 1
    ? `${delar.slice(0, -1).join(", ")} och ${delar[delar.length - 1]}`
    : (delar[0] ?? "");
}

/**
 * The association looks weak but the price is not adjusted: its economy shows
 * weaknesses, yet the fee prognosis finds no rise beyond today's fee, and
 * today's fee is already part of the valuation. Said outright so a grade D next
 * to an unchanged price does not read as a mistake. Empty when it does not apply.
 */
function utanJusteringText(r: Underlag): string {
  const prognos = r.avgiftsprognos;
  const total = prognos?.totalKrPerManad ?? null;
  if (!prognos || total === null) return "";
  if (!SVAGA_BETYG.includes(r.betyg) || Math.abs(total) >= INGEN_FORANDRING_KR) return "";

  const delar = [
    `Föreningens ekonomi har brister (betyg ${r.betyg}), men inget i årsredovisningen tyder på att ` +
      `avgiften behöver höjas mer än i dag de närmaste ${prognos.horisontManader} månaderna. ` +
      "Dagens avgift ingår redan i värderingen, så vi justerar inte priset.",
  ];
  // "Hög" only where the key figure itself is graded svag/kritisk (benchmarks.ts).
  const avgiftKf = r.forening.keyFigures.find((kf) => kf.id === "arsavgift_per_m2_brf_yta");
  const perM2 = avgiftKf?.figure.value ?? null;
  if (avgiftKf && (avgiftKf.status === "svag" || avgiftKf.status === "kritisk") && perM2 !== null) {
    delar.push(`Avgiften är redan hög, ${sv0(perM2)} kr/m² per år.`);
  }
  const saknas = prognos.komponenter
    .filter((k) => k.status === "saknar_underlag")
    .map((k) => k.label.toLowerCase());
  if (saknas.length > 0) {
    delar.push(
      `Några uppgifter saknas i årsredovisningen eller är för gamla (${listaOch(saknas)}), ` +
        "så priset kan vara lägre än värderingen.",
    );
  }
  return delar.join(" ");
}

function prisText(r: Underlag): string {
  const p = r.prisanalys;
  const bas = p.externVardering?.value ?? null;
  const justerad = p.justeradVardering?.value ?? null;
  const vardering = justerad ?? bas;
  if (vardering === null) {
    return "Binfos värdering kunde inte räknas fram, eftersom postnumret saknas eller är ogiltigt.";
  }

  const delar: string[] = [];
  if (justerad !== null && bas !== null && avrundaVardering(justerad) === avrundaVardering(bas)) {
    delar.push(
      `Värdet med hänsyn till föreningens ekonomi är ${caPris(justerad)}, i stort sett samma som ` +
        "jämförbara lägenheter säljs för.",
    );
  } else if (justerad !== null && bas !== null) {
    delar.push(
      `Värdet med hänsyn till föreningens ekonomi är ${caPris(justerad)}. Jämförbara lägenheter ` +
        `säljs för ${caPris(bas)}.`,
    );
  } else {
    delar.push(`Binfos värdering är ${caPris(vardering)}.`);
  }
  const utanJustering = utanJusteringText(r);
  if (utanJustering) delar.push(utanJustering);

  const utgangspris = p.utgangspris?.value ?? null;
  if (utgangspris === null) {
    delar.push("Inget utgångspris har angetts, så priset jämförs inte.");
    return delar.join(" ");
  }

  // One comparison, against the shown value's ±10 % span (owner 2026-10-26):
  // inside the span the price is in line with the model, otherwise over/under it.
  const spann = formatVardespann(vardering);
  const spannEtikett = `${spann} (±${VARDESPANN_PROCENT} %)`;
  const lage = lageMotVardespann(utgangspris, vardering);
  delar.push(
    lage === "inom"
      ? `Utgångspriset ${sv0(utgangspris)} kr ligger i linje med modellen, inom det ungefärliga spannet ${spannEtikett}.`
      : `Utgångspriset ${sv0(utgangspris)} kr ligger ${lage === "over" ? "över" : "under"} det ungefärliga spannet ${spannEtikett}.`,
  );

  const budpremie = p.budpremie;
  if (budpremie) {
    const plats = budpremie.omrade ?? "Stockholm";
    const slutpris = utgangspris * (1 + budpremie.medianProcent / 100);
    const slutLage = lageMotVardespann(slutpris, vardering);
    const riktning = budpremie.medianProcent >= 0 ? "över" : "under";
    delar.push(
      `Bostäder i ${plats} har i mitten sålts för ${sv1(budpremie.medianProcent)} % ${riktning} ` +
        `utgångspriset. Ett slutpris på den nivån, ${caPris(slutpris)}, ` +
        (slutLage === "inom"
          ? "skulle ligga i linje med modellen."
          : `skulle ligga ${slutLage === "over" ? "över" : "under"} spannet.`),
    );
  }
  return delar.join(" ");
}

function avgiftText(r: Underlag): string {
  const prognos = r.avgiftsprognos;
  if (!prognos) return "Ingen avgiftsprognos finns för den här analysen.";
  if (prognos.totalKrPerManad === null) {
    return (
      "Det går inte att räkna fram en väntad avgiftshöjning, eftersom lägenhetens andel av " +
      "föreningens avgifter inte kunde bestämmas."
    );
  }
  const total = prognos.totalKrPerManad;
  const ar = Math.round(prognos.horisontManader / 12);
  const ORD = ["", "ett", "två", "tre", "fyra", "fem"];
  const period = ar === 1 ? "det närmaste året" : `de närmaste ${ORD[ar] ?? ar} åren`;
  const idag = r.input.manadsavgift;
  const delar: string[] = [];
  if (Math.abs(total) < 10) {
    delar.push(
      `Årsredovisningen pekar inte på någon tydlig avgiftsförändring under ${period}; ` +
        `dagens avgift är ${sv0(idag)} kr i månaden.`,
    );
  } else {
    delar.push(
      `Utifrån årsredovisningen väntar vi oss att avgiften ${total > 0 ? "höjs" : "sänks"} med ` +
        `${caAvgift(total)} i månaden under ${period}, från ${sv0(idag)} till ungefär ` +
        `${sv0(Math.round((idag + total) / 10) * 10)} kr.`,
    );
    const storst = [...prognos.komponenter]
      .filter((k) => k.status === "beraknad" && k.krPerManad !== null && k.krPerManad !== 0)
      .sort((a, b) => Math.abs(b.krPerManad ?? 0) - Math.abs(a.krPerManad ?? 0))[0];
    if (storst) delar.push(`Störst påverkan: ${storst.label.toLowerCase()}.`);
  }
  // Refinancing in the same numbers as the loan table and the flag (round 2026-10-26).
  const refi = refinansieringsMening(prognos, r.forening.lanebok?.totalSkuld.value ?? null);
  if (refi) delar.push(refi);
  const saknas = prognos.komponenter.filter((k) => k.status === "saknar_underlag").length;
  if (saknas > 0) {
    delar.push(
      `För ${saknas === 1 ? "en del" : `${saknas} delar`} saknas underlag i årsredovisningen, ` +
        (total < 0 ? "så avgiften kan bli högre än så." : "så höjningen kan bli större."),
    );
  }
  if (prognos.osaker) delar.push(prognos.osaker);
  return delar.join(" ");
}

function slutsatsText(r: Underlag): string {
  const vardering = r.prisanalys.justeradVardering?.value ?? r.prisanalys.externVardering?.value;
  const total = r.avgiftsprognos?.totalKrPerManad ?? null;
  const delar = [`betyg ${r.betyg}`];
  if (vardering !== undefined && vardering !== null)
    delar.push(`en värdering på ${caPris(vardering)}`);
  if (total !== null && Math.abs(total) >= 10) {
    delar.push(
      `en väntad avgifts${total > 0 ? "höjning" : "sänkning"} på ${caAvgift(total)} i månaden`,
    );
  }
  const lista =
    delar.length > 1 ? `${delar.slice(0, -1).join(", ")} och ${delar[delar.length - 1]}` : delar[0];
  return (
    `Sammantaget: ${lista}. Det här är underlag, inte ett råd — gå igenom frågorna till ` +
    "styrelsen och mäklaren innan du bestämmer hur mycket du vill bjuda."
  );
}

export function byggSammanfattning(r: Underlag): Sammanfattning {
  return {
    betyg: betygText(r),
    pris: prisText(r),
    avgift: avgiftText(r),
    slutsats: slutsatsText(r),
  };
}
