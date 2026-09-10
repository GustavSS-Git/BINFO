/**
 * Avgiftshöjning vid räntestress. Konsumerar rantekänslighet — det
 * statutory nyckeltalet (räntebärande skuld ÷ avgiftsintäkt) — direkt som
 * "procent avgiftshöjning per procentenhet ränteökning". Bygger ingen egen
 * modell av skuld eller avgiftsintäkt; det är extraktionens jobb.
 */
export interface RantestressResultat {
  nyManadsavgift: number;
  avgiftsokningKrPerManad: number;
}

export function rantestressScenario(
  nuvarandeManadsavgift: number,
  rantekanslighetProcent: number,
  okningProcentenheter: number,
): RantestressResultat {
  const avgiftsokningProcent = rantekanslighetProcent * okningProcentenheter;
  const nyManadsavgift = Math.round(
    nuvarandeManadsavgift * (1 + avgiftsokningProcent / 100),
  );
  return {
    nyManadsavgift,
    avgiftsokningKrPerManad: nyManadsavgift - nuvarandeManadsavgift,
  };
}
