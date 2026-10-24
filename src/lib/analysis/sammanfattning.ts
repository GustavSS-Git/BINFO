import type { AnalysisResult, Grade, Sammanfattning } from "@/types/analysis";

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

/** "ca 5 680 000 kr": prices rounded to the nearest 10 000 kr. */
function caPris(kr: number): string {
  return `ca ${sv0(Math.round(kr / 10_000) * 10_000)} kr`;
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

/** Within ±3 % counts as "in line with" Binfo's valuation in the text. */
const I_LINJE_PROCENT = 3;

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

function prisText(r: Underlag): string {
  const p = r.prisanalys;
  const bas = p.externVardering?.value ?? null;
  const justerad = p.justeradVardering?.value ?? null;
  const vardering = justerad ?? bas;
  if (vardering === null) {
    return "Binfos värdering kunde inte räknas fram, eftersom postnumret saknas eller är ogiltigt.";
  }

  const delar: string[] = [];
  const avrundat = (kr: number) => Math.round(kr / 10_000) * 10_000;
  if (justerad !== null && bas !== null && avrundat(justerad) === avrundat(bas)) {
    delar.push(
      `Binfos värdering är ${caPris(justerad)}. Den väntade avgiftsförändringen flyttar den bara ` +
        `${sv0(Math.abs(justerad - bas))} kr.`,
    );
  } else if (justerad !== null && bas !== null && justerad !== bas) {
    delar.push(
      `Binfos värdering är ${caPris(justerad)} efter justering för den väntade avgiftshöjningen ` +
        `(${caPris(bas)} före justering).`,
    );
  } else {
    delar.push(`Binfos värdering är ${caPris(vardering)}.`);
  }

  const utgangspris = p.utgangspris?.value ?? null;
  if (utgangspris === null) {
    delar.push("Inget utgångspris har angetts, så priset jämförs inte.");
    return delar.join(" ");
  }

  const avvikelse = ((utgangspris - vardering) / vardering) * 100;
  delar.push(
    Math.abs(avvikelse) < 0.5
      ? `Utgångspriset ${sv0(utgangspris)} kr ligger i nivå med värderingen.`
      : `Utgångspriset ${sv0(utgangspris)} kr ligger ${sv1(avvikelse)} % ` +
          `${avvikelse > 0 ? "över" : "under"} värderingen.`,
  );

  const budpremie = p.budpremie;
  if (budpremie) {
    const plats = budpremie.omrade ?? "Stockholm";
    const slutpris = utgangspris * (1 + budpremie.medianProcent / 100);
    const motVardering = ((slutpris - vardering) / vardering) * 100;
    const riktning = budpremie.medianProcent >= 0 ? "över" : "under";
    delar.push(
      `Bostäder i ${plats} har i mitten sålts för ${sv1(budpremie.medianProcent)} % ${riktning} ` +
        `utgångspriset. Ett slutpris på den nivån, ${caPris(slutpris)}, ` +
        (Math.abs(motVardering) <= I_LINJE_PROCENT
          ? "skulle ligga i linje med Binfos värdering."
          : `skulle ligga ${sv1(motVardering)} % ${motVardering > 0 ? "över" : "under"} Binfos värdering` +
            (motVardering < 0
              ? ", så priset kan vara attraktivt även efter en vanlig budgivning."
              : ", så en vanlig budgivning skulle ta priset över värderingen.")),
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
