/**
 * Avgiftshöjning vid räntestress. Konsumerar rantekänslighet — det
 * statutory nyckeltalet (räntebärande skuld ÷ avgiftsintäkt) — direkt som
 * "procent avgiftshöjning per procentenhet ränteökning". Bygger ingen egen
 * modell av skuld eller avgiftsintäkt; det är extraktionens jobb.
 */
import type { Forening, Rantestress, RantestressScenario } from "@/types/analysis";

export interface RantestressResultat {
  nyManadsavgift: number;
  avgiftsokningKrPerManad: number;
}

/**
 * Kastas när räntekänsligheten saknas i årsredovisningen. Alternativet —
 * att låta stresstestet räkna med noll känslighet — skulle producera fyra
 * scenarier med oförändrad avgift, alltså en självsäker tom analys: precis
 * det värsta felläget PIPELINE.md förbjuder. Synligt fel är rätt här.
 */
export class SaknarRantekanslighetError extends Error {
  constructor() {
    super(
      "Räntekänslighet saknas i årsredovisningen (ett av de sju lagstadgade nyckeltalen). " +
        "Utan den går det inte att säga hur avgiften påverkas av högre ränta — räntestresstestet " +
        "kan inte köras.",
    );
    this.name = "SaknarRantekanslighetError";
  }
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

/** Procentenheter vi stressar med — 0 är med för att ge frontend en baslinje. */
const OKNINGAR: ReadonlyArray<RantestressScenario["okningPe"]> = [0, 1, 2, 3];

function kr(belopp: number): string {
  return belopp.toLocaleString("sv-SE");
}

/**
 * Bygger hela Rantestress-blocket för EN lägenhet, uttryckt i kronor per
 * månad. Räntekänsligheten läses direkt ur föreningens nyckeltal och
 * räknas aldrig om ur skuld ÷ avgiftsintäkt — nyckeltalet ÄR den modellen.
 *
 * totalManadskostnad utelämnas: den kräver lånedetaljer som inte skickas
 * hit. Nyckeln sätts inte alls (exactOptionalPropertyTypes).
 */
export function beraknaRantestress(forening: Forening, nuvarandeManadsavgift: number): Rantestress {
  const rantekanslighet = forening.keyFigures.find((kf) => kf.id === "rantekanslighet");
  const rantekanslighetProcent = rantekanslighet?.figure.value ?? null;
  if (rantekanslighetProcent === null) {
    throw new SaknarRantekanslighetError();
  }

  const scenarier: RantestressScenario[] = OKNINGAR.map((okningPe) => {
    const s = rantestressScenario(nuvarandeManadsavgift, rantekanslighetProcent, okningPe);
    return {
      okningPe,
      nyManadsavgift: { value: s.nyManadsavgift, unit: "kr", source: "berakning" },
      avgiftsokningKrPerManad: {
        value: s.avgiftsokningKrPerManad,
        unit: "kr",
        source: "berakning",
      },
    };
  });

  const perProcentenhet = rantestressScenario(nuvarandeManadsavgift, rantekanslighetProcent, 1);
  const vidTre = rantestressScenario(nuvarandeManadsavgift, rantekanslighetProcent, 3);

  return {
    rantekanslighetProcent,
    nuvarandeManadsavgift: { value: nuvarandeManadsavgift, unit: "kr", source: "anvandare" },
    scenarier,
    kommentar:
      `Varje procentenhet högre ränta för föreningen motsvarar ungefär ` +
      `${kr(perProcentenhet.avgiftsokningKrPerManad)} kr mer i månaden för den här lägenheten. ` +
      `Stiger räntan tre procentenheter blir avgiften ${kr(vidTre.nyManadsavgift)} kr i månaden, ` +
      `${kr(vidTre.avgiftsokningKrPerManad)} kr mer än i dag.`,
  };
}
