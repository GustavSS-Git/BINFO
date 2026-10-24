/**
 * Avgiftshöjning vid räntestress. Konsumerar rantekänslighet — det
 * statutory nyckeltalet (räntebärande skuld ÷ avgiftsintäkt) — direkt som
 * "procent avgiftshöjning per procentenhet ränteökning". Bygger ingen egen
 * modell av skuld eller avgiftsintäkt; det är extraktionens jobb.
 */
import type { Figure, Forening, Rantestress, RantestressScenario } from "@/types/analysis";
import type { AvgiftsprognosResultat } from "./avgiftsprognos";

export interface RantestressResultat {
  nyManadsavgift: number;
  avgiftsokningKrPerManad: number;
}

/**
 * HISTORISK — kastas INTE längre av `beraknaRantestress` (ägarbeslut,
 * task 7: "en genuint saknad räntekänslighet får aldrig fälla hela
 * analysen"). Klassen, dess mappning i `src/server/fel.ts` och dess textrad
 * i `src/lib/analysStatusCopy.ts` finns kvar av ETT skäl: gamla jobbrader i
 * Supabase som redan misslyckades med `errorCode: "saknar_rantekanslighet"`
 * innan den här ändringen måste fortsätta kunna tolkas och visas korrekt.
 * Ett nytt jobb kan aldrig längre få den koden — se `beraknaRantestress`
 * nedan, som nu returnerar ett `Rantestress`-block med
 * `rantekanslighetProcent: null` och en tom `scenarier`-lista i stället för
 * att kasta.
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
  const nyManadsavgift = Math.round(nuvarandeManadsavgift * (1 + avgiftsokningProcent / 100));
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

/** Shown when the report never states räntekänslighet at all (and the
 *  association is not provably debt-free — see harledSkuldfriaNyckeltal in
 *  tolkaVarde.ts, which would already have turned a genuinely debt-free
 *  association's null into 0 before this function ever sees it). */
const SAKNAS_KOMMENTAR =
  "Räntekänslighet saknas i årsredovisningen, så det går inte att räkna hur avgiften påverkas av högre ränta.";

/** Shown when räntekänslighet is exactly 0 — always the debt-free case in
 *  practice, since a real interest-bearing loan book essentially never
 *  produces an exact zero. The generic per-procentenhet phrasing below would
 *  otherwise read oddly ("0 kr mer i månaden"). */
const SKULDFRI_KOMMENTAR =
  "Föreningen har inga räntebärande lån, så avgiften påverkas inte direkt av högre räntor.";

/**
 * Bygger hela Rantestress-blocket för EN lägenhet, uttryckt i kronor per
 * månad. Räntekänsligheten läses direkt ur föreningens nyckeltal och
 * räknas aldrig om ur skuld ÷ avgiftsintäkt — nyckeltalet ÄR den modellen.
 *
 * BESLUT (task 7, ägarbeslut): en genuint saknad räntekänslighet degraderar
 * INTE längre hela analysen. `rantekanslighetProcent` blir null,
 * `scenarier` en tom lista och `kommentar` säger varför — resten av
 * analysen (betyg, röda flaggor, prisanalys, övriga nyckeltal) fortsätter
 * som vanligt. Anroparen (assemble.ts) lägger till en deterministisk fråga
 * och sänker datakvalitetens konfidens ett steg för just det här fallet.
 *
 * totalManadskostnad utelämnas: den kräver lånedetaljer som inte skickas
 * hit. Nyckeln sätts inte alls (exactOptionalPropertyTypes).
 */
export function beraknaRantestress(forening: Forening, nuvarandeManadsavgift: number): Rantestress {
  const rantekanslighet = forening.keyFigures.find((kf) => kf.id === "rantekanslighet");
  const rantekanslighetProcent = rantekanslighet?.figure.value ?? null;

  const nuvarandeManadsavgiftFigur: Figure = {
    value: nuvarandeManadsavgift,
    unit: "kr",
    source: "anvandare",
  };

  if (rantekanslighetProcent === null) {
    return {
      rantekanslighetProcent: null,
      nuvarandeManadsavgift: nuvarandeManadsavgiftFigur,
      scenarier: [],
      kommentar: SAKNAS_KOMMENTAR,
    };
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

  const kommentar =
    rantekanslighetProcent === 0
      ? SKULDFRI_KOMMENTAR
      : `Varje procentenhet högre ränta för föreningen motsvarar ungefär ` +
        `${kr(perProcentenhet.avgiftsokningKrPerManad)} kr mer i månaden för den här lägenheten. ` +
        `Stiger räntan tre procentenheter blir avgiften ${kr(vidTre.nyManadsavgift)} kr i månaden, ` +
        `${kr(vidTre.avgiftsokningKrPerManad)} kr mer än i dag.`;

  return {
    rantekanslighetProcent,
    nuvarandeManadsavgift: nuvarandeManadsavgiftFigur,
    scenarier,
    kommentar,
  };
}

// ---------------------------------------------------------------------------
// Fee table (round 2026-10-24b): today / expected / +1 pp / +2 pp
// ---------------------------------------------------------------------------

/**
 * Rows: "idag", "forvantad" (= fee + expected rise at unchanged rates), and
 * "plus1"/"plus2" = forvantad + round(repricing debt × pp ÷ 100 × andel ÷ 12).
 * Only the debt that reprices within the horizon feels a higher rate in the
 * period, so +1/+2 are built on that debt alone. Returns null when the
 * expected rise is unknown (share unknown); the plus rows are omitted when the
 * repricing debt or the share is unknown.
 */
export function byggPrognosTabell(
  manadsavgift: number,
  prognos: AvgiftsprognosResultat,
): NonNullable<Rantestress["prognosTabell"]> | null {
  const total = prognos.prognos.totalKrPerManad;
  if (total === null) return null;
  const andel = prognos.prognos.andel?.varde ?? null;
  const skuld = prognos.omsattningsbarSkuld;
  const horisont = prognos.prognos.horisontManader;

  const rad = (
    id: "idag" | "forvantad" | "plus1" | "plus2",
    label: string,
    forandring: number,
  ) => ({ id, label, manadsavgift: manadsavgift + forandring, forandringKr: forandring });
  const rader = [
    rad("idag", "Dagens avgift", 0),
    rad("forvantad", "Förväntad avgift (oförändrad ränta)", total),
  ];

  let kommentar: string;
  if (skuld !== null && andel !== null) {
    for (const [id, label, pp] of [
      ["plus1", "+1 procentenhet", 1],
      ["plus2", "+2 procentenheter", 2],
    ] as const) {
      const tillagg = Math.round((((skuld * pp) / 100) * andel) / 12);
      rader.push(rad(id, label, total + (tillagg === 0 ? 0 : tillagg)));
    }
    const antaget = prognos.totalSpannVidAntagande
      ? " Årsredovisningen anger inte när lånen ska omsättas, så beloppet är ett antagande."
      : "";
    kommentar =
      skuld === 0
        ? `Ingen del av skulden prissätts om inom ${horisont} månader, så högre ränta ändrar inte avgiften under perioden.`
        : `Raderna +1 och +2 procentenheter gäller bara den del av skulden som prissätts om inom ${horisont} månader, ` +
          `${kr(skuld)} kr, och läggs ovanpå den förväntade avgiften.${antaget}`;
  } else {
    kommentar = `Vi vet inte hur stor del av skulden som prissätts om inom ${horisont} månader, så vi visar inga rader för högre ränta.`;
  }
  return { rader, kommentar };
}
