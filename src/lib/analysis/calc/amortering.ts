/**
 * Amorteringstakt enligt reglerna i kraft sedan 1 april 2026.
 * Grundas ENBART på belåningsgrad — det skärpta kravet kopplat till
 * skuldkvot (>4,5x bruttoinkomst) är slopat. Därför tar funktionen inte
 * ens skuldkvot som argument: den kan strukturellt inte returnera 3.
 *
 * Gränserna följer Finansinspektionens formulering ("överstiger"), inte en
 * naiv <= / >= tolkning: exakt 50 % kräver ingen amortering, exakt 70 % ger
 * fortfarande bara 1 %/år.
 */
export function amorteringstakt(belaningsgradProcent: number): 0 | 1 | 2 {
  if (belaningsgradProcent > 70) return 2;
  if (belaningsgradProcent > 50) return 1;
  return 0;
}
