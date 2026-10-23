import { z } from "zod";
import { parseSparaTyp } from "@/lib/till";
import type { FeeInclusion, PropertyInput } from "@/types/analysis";

/**
 * Stöd för /bolanekalkyl — en fristående klientberäkning som inte kräver
 * någon analys. Ren logik, inga React-beroenden,
 * så den kan testas direkt.
 */

// ---------------------------------------------------------------------------
// Sökparametrar
// ---------------------------------------------------------------------------

export interface BolanekalkylSearch {
  /** Förifyllning av månadsavgiften, t.ex. vid länk från en färdig analys.
   *  Skriven som `number | undefined` snarare än en valfri egenskap: TanStack
   *  Routers matchning bygger sökvägens state med
   *  `Object.assign(accumulated, validateSearch(...))`, som bara skriver
   *  över nycklar som faktiskt finns i det returnerade objektet — en
   *  utelämnad nyckel lämnar kvar ett äldre/rått värde. Ett skräpvärde
   *  måste alltså skrivas över med ett explicit `undefined`, inte utelämnas. */
  manadsavgift: number | undefined;
  /** Föreningens räntekänslighet (%) — ett nyckeltal ur en specifik
   *  årsredovisning. Får aldrig gissas fram; finns den inte i sökvägen
   *  körs ingen avgiftsstress. Samma `| undefined`-resonemang som ovan. */
  rantekanslighet: number | undefined;
  /** Förifyllning av priset, t.ex. vid länk från en färdig analys — antingen
   *  utgångspriset eller en extern värdering (se AnalysRapport). Samma
   *  `| undefined`-resonemang som manadsavgift ovan. */
  pris: number | undefined;
  /** Förifyllning av boarean från en färdig analys. Samma
   *  `| undefined`-resonemang som manadsavgift ovan. */
  boarea: number | undefined;
  /** Sant när `pris` kommer från en extern värdering märkt `source:
   *  'schablon'` i analysen (se AnalysisResult.prisanalys.externVardering) —
   *  en uppskattning, inte ett fastställt pris. En gissning får aldrig se ut
   *  som ett faktum (se CLAUDE.md): kalkylsidan använder flaggan för att
   *  ordagrant säga "uppskattning" i förifyllningstexten istället för att
   *  tyst presentera talet som ett känt pris. Samma
   *  `| undefined`-resonemang som ovan. */
  prisUppskattning: boolean | undefined;
  /** Id (uuid) på en sparad kalkyl i kontot som ska öppnas (`?sparad=`).
   *  Valfri nyckel så att länkar från andra sidor inte behöver ange den; tolkaren
   *  sätter den ändå alltid (till `undefined` vid skräp), se kommentaren ovan. */
  sparad?: string | undefined;
  /** Väntande Spara-åtgärd efter inloggning (`?spara=kalkyl`). Samma valfria nyckel. */
  spara?: "kalkyl" | undefined;
}

/**
 * Väljer räntekänslighet-parametern till bolånekalkylens förifyllnings-länk
 * (se AnalysRapport.tsx). `null` betyder att årsredovisningen inte anger
 * räntekänslighet (se Rantestress.rantekanslighetProcent i
 * src/types/analysis.ts) — ingen avgiftsstress kan då räknas fram, så
 * parametern utelämnas. `0` (en skuldfri förening) ger också "ingen
 * avgiftsstress", men det är redan vad `tolkaPositivtTal` ovan gör med den
 * — `.positive()` förkastar 0 precis som den skulle förkasta ett saknat
 * värde — så att utelämna 0 här är samma sak som att skicka med den:
 * enklast och korrekt att bara skicka tal > 0.
 */
export function veljRantekanslighetForSok(
  rantekanslighetProcent: number | null,
): number | undefined {
  return rantekanslighetProcent !== null && rantekanslighetProcent > 0
    ? rantekanslighetProcent
    : undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ett uuid som sträng, annars `undefined` (skräp, fel typ, för långt). */
function tolkaUuid(varde: unknown): string | undefined {
  return typeof varde === "string" && UUID.test(varde) ? varde : undefined;
}

const positivtTal = z.coerce.number().positive().finite();

/**
 * Tolkar ett enskilt sökparametervärde. Endast sträng eller tal godtas som
 * indata till coerce — annars kan t.ex. z.coerce.number() på en array som
 * ["3240"] råka lyckas via JS:s Number(array)-koersion, vilket vore fel:
 * en array är inte ett giltigt sökparametervärde.
 */
function tolkaPositivtTal(varde: unknown): number | undefined {
  if (typeof varde !== "string" && typeof varde !== "number") return undefined;
  const resultat = positivtTal.safeParse(varde);
  return resultat.success ? resultat.data : undefined;
}

/** Samma skräpvärdes-tolerans som `tolkaPositivtTal`, för en boolesk flagga.
 *  TanStack Routers parseSearch JSON-tolkar sökvärden, så "?x=1" kommer hit
 *  som talet 1 och "?x=true" som true (och ett search-objekt från navigate()
 *  har redan riktiga booleaner) — därför accepteras boolean, 1/0 och
 *  strängformerna. Allt annat blir `undefined`, aldrig ett kastat fel. */
function tolkaBoolean(varde: unknown): boolean | undefined {
  if (typeof varde === "boolean") return varde;
  if (varde === 1) return true;
  if (varde === 0) return false;
  if (typeof varde !== "string") return undefined;
  if (varde === "1" || varde === "true") return true;
  if (varde === "0" || varde === "false") return false;
  return undefined;
}

/**
 * Tolkar sökparametrarna utan att någonsin kasta — ett skräpvärde
 * ("?manadsavgift=abc") ska falla tillbaka till "inget värde", inte krascha
 * sidan. Används som `validateSearch` för ruttet. Sätter alltid båda
 * nycklarna (till talet eller till `undefined`) — se kommentaren på
 * BolanekalkylSearch för varför en utelämnad nyckel inte räcker.
 */
export function parseBolanekalkylSearch(search: Record<string, unknown>): BolanekalkylSearch {
  return {
    manadsavgift: tolkaPositivtTal(search["manadsavgift"]),
    rantekanslighet: tolkaPositivtTal(search["rantekanslighet"]),
    pris: tolkaPositivtTal(search["pris"]),
    boarea: tolkaPositivtTal(search["boarea"]),
    prisUppskattning: tolkaBoolean(search["prisUppskattning"]),
    sparad: tolkaUuid(search["sparad"]),
    spara: parseSparaTyp(search["spara"]) === "kalkyl" ? "kalkyl" : undefined,
  };
}

// ---------------------------------------------------------------------------
// Minimal PropertyInput
// ---------------------------------------------------------------------------

export interface MinimalPropertyInputFields {
  boarea: number;
  antalPersoner: number;
  manadsavgift: number;
  avgiftInkluderar: FeeInclusion;
}

/**
 * Bygger en PropertyInput från enbart de fält kalkylen faktiskt använder.
 * `beraknaManadskostnad` läser bara boarea, antalPersoner, manadsavgift och
 * avgiftInkluderar (se calc/manadskostnad.ts) — resten av kontraktets fält
 * är obligatoriska men oanvända här. De får uttryckliga, ofarliga
 * platshållarvärden (tomma strängar, "okänt", noll) snarare än påhittade
 * men trovärdiga siffror — inget fejk-orgnr, ingen fejk-adress.
 */
export function buildMinimalPropertyInput(fields: MinimalPropertyInputFields): PropertyInput {
  return {
    kind: "bostadsratt",
    boarea: fields.boarea,
    antalRum: 0,
    manadsavgift: fields.manadsavgift,
    andelstal: 0,
    orgnr: "",
    adress: "",
    postnummer: "",
    ort: "",
    hiss: "okant",
    balkong: "okant",
    avgiftInkluderar: fields.avgiftInkluderar,
    antalPersoner: fields.antalPersoner,
  };
}
