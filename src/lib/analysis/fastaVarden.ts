import type { ExtractionResult, Figure, Grade, KeyFigureId, Status } from "@/types/analysis";
import { raknaStatusar, tillatnaBetyg } from "./slutfor";

/**
 * Fixed values for the judging step: everything the model would otherwise
 * compute itself, computed once, deterministically, from the extraction.
 *
 * Why (2026-10-23): a real run wrote "6 759 091 kr av 7 759 091 kr (cirka 87 %)"
 * of loans maturing 2026 where the report says 5 759 091 kr (74 %). The model's own
 * arithmetic was wrong (it has happened before). The judging prompt now hands
 * over these values and forbids any other arithmetic; `siffrorKontroll.ts`
 * verifies the written motivation against them.
 *
 * Pure. Only arithmetic on figures that are in the extraction (shares, sums) —
 * never a new domain number, threshold or benchmark.
 */

export interface FastNyckeltal {
  id: KeyFigureId;
  label: string;
  /** Copied verbatim; null when the report does not state it. */
  value: number | null;
  unit: Figure["unit"];
  status: Status;
}

export interface FastRanta {
  value: number;
  unit: Figure["unit"];
}

/** One row of the maturity ladder with a known amount. */
export interface FastForfallorad {
  ar: number;
  belopp: number;
  /** Share of lanebok.totalSkuld, percent rounded to one decimal. */
  andelProcent: number;
  ranta?: FastRanta;
}

/** All rows of one year added together (a year can have several loans). */
export interface FastForfalloAr {
  ar: number;
  belopp: number;
  andelProcent: number;
}

/** Everything maturing in this year or earlier (counted from the first year in the ladder). */
export interface FastKumulativtForfallo {
  tillOchMedAr: number;
  belopp: number;
  andelProcent: number;
}

export interface FastLan {
  totalSkuld: number;
  forfallo: FastForfallorad[];
  perAr: FastForfalloAr[];
  kumulativt: FastKumulativtForfallo[];
  snittranta?: FastRanta;
}

export interface FastaVarden {
  tillatnaBetyg: Grade[];
  antalSvaga: number;
  antalKritiska: number;
  nyckeltal: FastNyckeltal[];
  /** Absent when lanebok.totalSkuld has no value. Shares exist only with a total above zero. */
  lan?: FastLan;
}

/** Percent of `del` in `helhet`, one decimal. */
function andelProcent(del: number, helhet: number): number {
  return Math.round((del / helhet) * 1000) / 10;
}

function ranta(figure: Figure | undefined): FastRanta | undefined {
  return figure && figure.value !== null ? { value: figure.value, unit: figure.unit } : undefined;
}

function beraknaLan(extraction: ExtractionResult): FastLan | undefined {
  const lanebok = extraction.forening.lanebok;
  const total = lanebok?.totalSkuld.value;
  if (lanebok === undefined || total === null || total === undefined) return undefined;

  const harAndelar = total > 0;
  const forfallo: FastForfallorad[] = [];
  if (harAndelar) {
    for (const rad of lanebok.forfalloprofil ?? []) {
      if (rad.belopp.value === null) continue;
      const r = ranta(rad.ranta);
      forfallo.push({
        ar: rad.ar,
        belopp: rad.belopp.value,
        andelProcent: andelProcent(rad.belopp.value, total),
        ...(r ? { ranta: r } : {}),
      });
    }
  }

  // Sums per year and cumulative sums are computed on the exact amounts and
  // rounded once, never from already rounded shares.
  const summaPerAr = new Map<number, number>();
  for (const rad of forfallo) summaPerAr.set(rad.ar, (summaPerAr.get(rad.ar) ?? 0) + rad.belopp);
  const aren = [...summaPerAr.keys()].sort((a, b) => a - b);
  const perAr: FastForfalloAr[] = aren.map((ar) => ({
    ar,
    belopp: summaPerAr.get(ar)!,
    andelProcent: andelProcent(summaPerAr.get(ar)!, total),
  }));
  let lopande = 0;
  const kumulativt: FastKumulativtForfallo[] = aren.map((ar) => {
    lopande += summaPerAr.get(ar)!;
    return { tillOchMedAr: ar, belopp: lopande, andelProcent: andelProcent(lopande, total) };
  });

  const snitt = ranta(lanebok.snittranta);
  return {
    totalSkuld: total,
    forfallo,
    perAr,
    kumulativt,
    ...(snitt ? { snittranta: snitt } : {}),
  };
}

export function beraknaFastaVarden(extraction: ExtractionResult): FastaVarden {
  const antal = raknaStatusar(extraction);
  const lan = beraknaLan(extraction);
  return {
    tillatnaBetyg: [...tillatnaBetyg(antal)],
    antalSvaga: antal.svag,
    antalKritiska: antal.kritisk,
    nyckeltal: extraction.forening.keyFigures.map((kf) => ({
      id: kf.id,
      label: kf.label,
      value: kf.figure.value,
      unit: kf.figure.unit,
      status: kf.status,
    })),
    ...(lan ? { lan } : {}),
  };
}

// ---------------------------------------------------------------------------
// Swedish rendering (the prompt text)
// ---------------------------------------------------------------------------

/** 5759091 -> "5 759 091" (plain spaces, so the model copies it as written). */
function grupperaHeltal(n: number): string {
  const tecken = n < 0 ? "-" : "";
  return tecken + String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** A number with Swedish decimal comma and thousands spaces; no trailing zeros are invented. */
export function formateraTal(n: number): string {
  if (Number.isInteger(n)) return grupperaHeltal(n);
  const [heltal, decimaler] = String(Math.abs(n)).split(".");
  return `${n < 0 ? "-" : ""}${grupperaHeltal(Number(heltal))},${decimaler ?? ""}`;
}

const ENHET_TEXT: Record<Figure["unit"], string> = {
  kr: " kr",
  "kr/man": " kr/mån",
  "kr/m2": " kr/m²",
  "kr/m2/ar": " kr/m²/år",
  procent: " %",
  m2: " m²",
  ar: "",
  antal: "",
  gånger: " gånger",
};

function medEnhet(value: number | null, unit: Figure["unit"]): string {
  return value === null ? "saknas i rapporten" : `${formateraTal(value)}${ENHET_TEXT[unit]}`;
}

function procent(n: number): string {
  return `${formateraTal(n)} %`;
}

function kronor(n: number): string {
  return `${formateraTal(n)} kr`;
}

function rantaText(r: FastRanta | undefined): string {
  return r ? `, ränta ${medEnhet(r.value, r.unit)}` : "";
}

/**
 * The Swedish block for the judging user prompt. Lists the allowed letters,
 * the seven key figures as the extraction states them and, when the loan
 * book has a total, the maturity ladder with shares of the total debt.
 */
export function formateraFastaVarden(fasta: FastaVarden): string {
  const rader: string[] = [];
  rader.push(
    `Tillåtna betyg: ${fasta.tillatnaBetyg.join(", ")} (${fasta.antalSvaga} nyckeltal med status "svag", ${fasta.antalKritiska} med status "kritisk"). Välj betyg bland de tillåtna.`,
  );
  rader.push("");
  rader.push("Nyckeltalen (värde och status är fasta):");
  for (const n of fasta.nyckeltal) {
    rader.push(`- ${n.label} ("${n.id}"): ${medEnhet(n.value, n.unit)}, status "${n.status}"`);
  }

  if (fasta.lan) {
    const lan = fasta.lan;
    rader.push("");
    rader.push(
      `Lånen (andelar är procent av total räntebärande skuld, avrundade till en decimal):`,
    );
    rader.push(`- Total räntebärande skuld: ${kronor(lan.totalSkuld)}`);
    if (lan.snittranta) {
      rader.push(`- Genomsnittlig ränta: ${medEnhet(lan.snittranta.value, lan.snittranta.unit)}`);
    }
    if (lan.forfallo.length > 0) {
      rader.push("- Förfalloprofil, rad för rad:");
      for (const f of lan.forfallo) {
        rader.push(
          `  - ${f.ar}: ${kronor(f.belopp)} (${procent(f.andelProcent)} av totala skulden)${rantaText(f.ranta)}`,
        );
      }
    }
    if (lan.perAr.length > 0 && lan.perAr.length < lan.forfallo.length) {
      rader.push("- Summa per år (flera lån samma år):");
      for (const a of lan.perAr) {
        rader.push(`  - ${a.ar}: ${kronor(a.belopp)} (${procent(a.andelProcent)})`);
      }
    }
    if (lan.kumulativt.length > 1) {
      rader.push("- Ackumulerat, allt som förfaller till och med respektive år:");
      for (const k of lan.kumulativt) {
        rader.push(
          `  - till och med ${k.tillOchMedAr}: ${kronor(k.belopp)} (${procent(k.andelProcent)})`,
        );
      }
    }
  }
  return rader.join("\n");
}
