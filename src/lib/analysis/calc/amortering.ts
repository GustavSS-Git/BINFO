import { tal } from "@/lib/kalkyl/regler";

/**
 * Amorteringstakt enligt reglerna i kraft sedan 1 april 2026
 * (Lag (2026:226) 7 §; trösklar och takter i src/lib/kalkyl/regler.ts).
 * Grundas ENBART på belåningsgrad — det skärpta kravet kopplat till
 * skuldkvot (>4,5x bruttoinkomst) är slopat. Därför tar funktionen inte
 * ens skuldkvot som argument: den kan strukturellt inte returnera 3.
 *
 * Gränserna följer lagens formulering ("överstiger"), inte en
 * naiv <= / >= tolkning: exakt 50 % kräver ingen amortering, exakt 70 % ger
 * fortfarande bara 1 %/år.
 *
 * Detta är den enda platsen med 50/70-gränserna; sidan och exporterna
 * använder returvärdet (och amorteringsniva nedan) i stället för egna jämförelser.
 */
export function amorteringstakt(belaningsgradProcent: number): 0 | 1 | 2 {
  if (belaningsgradProcent > tal("amortering_troskel_hog")) return 2;
  if (belaningsgradProcent > tal("amortering_troskel_lag")) return 1;
  return 0;
}

/** Vilket amorteringsskikt en belåningsgrad hamnar i (samma gränser som ovan). */
export type Amorteringsniva = "over70" | "over50till70" | "hogst50";

export function amorteringsniva(belaningsgradProcent: number): Amorteringsniva {
  const takt = amorteringstakt(belaningsgradProcent);
  return takt === 2 ? "over70" : takt === 1 ? "over50till70" : "hogst50";
}
