/**
 * Levnadskostnader för bankens kalkyl (KALP) enligt Konsumentverkets
 * Hushållskostnader 2026 (tabellerna ligger i regler.ts med sidhänvisning).
 *
 * Antaganden som är uttryckliga poster i regelregistret:
 * - Mat: "all mat lagas hemma" (kalp_mat).
 * - Alla vuxna räknas som 25–50 år (kalp_vuxen_alder).
 * - Barn 0–3 år räknas som Konsumentverkets dyrare kolumn, 0 år (kalp_barn_0_3).
 * - Hushåll med barn under 8 år får avdraget på internet- och mobilabonnemang
 *   en gång (kalp_barn_under_8_avdrag); åldersgruppen 7–10 räknas som 8 år eller äldre.
 * - Tabellen slutar vid 7 personer: större hushåll får inget beräknat värde.
 */
import type { BarnAlder } from "@/lib/kalkyl/underlag";
import {
  KONSUMENTVERKET_2026,
  KV_ALDERSGRUPPER,
  KV_GEMENSAMMA_NAMN,
  KV_OVRIGA_NAMN,
  type KvAlder,
} from "@/lib/kalkyl/regler";

export type LevnadsGrupp = "Mat" | "Individuella kostnader" | "Gemensamma kostnader";

export interface LevnadsRad {
  id: string;
  namn: string;
  grupp: LevnadsGrupp;
  /** kr per månad. Negativ för avdraget. */
  belopp: number;
  /** Sant när posten är 0 kr för att den redan ingår i månadsavgiften. */
  ingarIAvgift?: boolean;
}

export interface Levnadskostnader {
  antalVuxna: number;
  antalBarn: number;
  antalPersoner: number;
  rader: LevnadsRad[];
  /** kr per månad. */
  summa: number;
}

export interface LevnadsAlternativ {
  /** Hushållsel ingår i månadsavgiften (avgiftInkluderar.el = ja): posten tas inte med. */
  elIngarIAvgift?: boolean;
  /** Vatten ingår i månadsavgiften (avgiftInkluderar.vatten = ja): posten tas inte med. */
  vattenIngarIAvgift?: boolean;
}

const VUXEN: KvAlder = "25-50";

function kolumnIndex(alder: KvAlder): number {
  return KV_ALDERSGRUPPER.indexOf(alder);
}

function matOchOvrigaSumma(alder: KvAlder): number {
  const i = kolumnIndex(alder);
  const ovriga = Object.values(KONSUMENTVERKET_2026.ovriga).reduce(
    (a, rad) => a + (rad[i] ?? 0),
    0,
  );
  return (KONSUMENTVERKET_2026.mat[i] ?? 0) + ovriga;
}

/**
 * Konsumentverkets kolumn för kalkylens åldersgrupp. Binfos grupp 0–3 år täcker
 * två av Konsumentverkets kolumner (0 år och 1–3 år); den dyrare väljs.
 */
export function kvKolumnForBarn(alder: BarnAlder): KvAlder {
  switch (alder) {
    case "0-3":
      return matOchOvrigaSumma("0") >= matOchOvrigaSumma("1-3") ? "0" : "1-3";
    case "4-6":
      return "4-6";
    case "7-10":
      return "7-10";
    case "11-14":
      return "11-14";
    case "15-17":
      return "15-17";
  }
}

/** Åldersgrupper där barnet säkert är under 8 år. */
const UNDER_8: ReadonlySet<BarnAlder> = new Set<BarnAlder>(["0-3", "4-6"]);

/**
 * Levnadskostnader per månad, eller null om hushållet är större än tabellen
 * (7 personer) eller saknar vuxna.
 */
export function beraknaLevnadskostnader(
  antalVuxna: number,
  barn: readonly BarnAlder[],
  alternativ: LevnadsAlternativ = {},
): Levnadskostnader | null {
  const antalPersoner = antalVuxna + barn.length;
  if (antalVuxna < 1 || antalPersoner > KONSUMENTVERKET_2026.maxPersoner) return null;

  const kolumner: KvAlder[] = [
    ...Array.from({ length: antalVuxna }, () => VUXEN),
    ...barn.map(kvKolumnForBarn),
  ];

  const rader: LevnadsRad[] = [];

  const mat = kolumner.reduce((a, k) => a + (KONSUMENTVERKET_2026.mat[kolumnIndex(k)] ?? 0), 0);
  rader.push({ id: "mat", namn: "Mat (all mat lagas hemma)", grupp: "Mat", belopp: mat });

  for (const nyckel of Object.keys(KONSUMENTVERKET_2026.ovriga) as Array<
    keyof typeof KONSUMENTVERKET_2026.ovriga
  >) {
    const belopp = kolumner.reduce(
      (a, k) => a + (KONSUMENTVERKET_2026.ovriga[nyckel][kolumnIndex(k)] ?? 0),
      0,
    );
    if (belopp === 0) continue;
    rader.push({
      id: nyckel,
      namn: KV_OVRIGA_NAMN[nyckel],
      grupp: "Individuella kostnader",
      belopp,
    });
  }

  const storlek = antalPersoner - 1;
  for (const nyckel of Object.keys(KONSUMENTVERKET_2026.gemensamma) as Array<
    keyof typeof KONSUMENTVERKET_2026.gemensamma
  >) {
    const tabellvarde = KONSUMENTVERKET_2026.gemensamma[nyckel][storlek] ?? 0;
    const uteslutEl = nyckel === "hushallsel" && alternativ.elIngarIAvgift === true;
    const uteslutVatten = nyckel === "vatten_och_avlopp" && alternativ.vattenIngarIAvgift === true;
    const ingar = uteslutEl || uteslutVatten;
    rader.push({
      id: `gemensam_${nyckel}`,
      namn: KV_GEMENSAMMA_NAMN[nyckel],
      grupp: "Gemensamma kostnader",
      belopp: ingar ? 0 : tabellvarde,
      ...(ingar ? { ingarIAvgift: true } : {}),
    });
  }

  if (barn.some((b) => UNDER_8.has(b))) {
    rader.push({
      id: "gemensam_avdrag_barn_under_8",
      namn: "Avdrag internet- och mobilabonnemang, hushåll med barn under 8 år",
      grupp: "Gemensamma kostnader",
      belopp: -KONSUMENTVERKET_2026.barnUnder8Avdrag,
    });
  }

  return {
    antalVuxna,
    antalBarn: barn.length,
    antalPersoner,
    rader,
    summa: rader.reduce((a, r) => a + r.belopp, 0),
  };
}
