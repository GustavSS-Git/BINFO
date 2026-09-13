/**
 * Felöversättning: den ENDA platsen där ett infångat fel från
 * analyspipelinen får bli text en köpare ser.
 *
 * SÄKERHETSINVARIANT: `tolkaFel` får ALDRIG vidarebefordra något från det
 * infångade värdet — varken `error.message`, en stacktrace eller någon del
 * av ett rått kastat värde — förutom för de sex uttryckligen kända,
 * pipeline-interna felklasserna nedan, som redan (by convention i
 * `src/lib/analysis/`) skriver sina meddelanden på svenska och köparsäkert.
 * Allt annat — ett okänt `Error`, eller ett kastat icke-Error-värde — mappas
 * till `"unknown"` med en generisk, hårdkodad svensk mening. Anledningen är
 * att ett okänt fel kan bära på ett fragment av en API-nyckel, ett rått
 * modellsvar eller annan intern detalj (se `ModelValidationError`, som
 * lägger en bit av modellens rå-svar i sitt eget `.message`) — den typen av
 * information får aldrig nå en köpares skärm.
 */

import type { AnalysErrorCode } from "./portar";
import { ScannedPdfError } from "@/lib/analysis/runExtraction";
import { KostnadsgransOverskriden } from "@/lib/analysis/costGuard";
import { ModelValidationError } from "@/lib/analysis/extract";
import { AssemblyValidationError } from "@/lib/analysis/assemble";
import { SaknarRantekanslighetError } from "@/lib/analysis/calc/rantestress";

export interface FelResultat {
  errorCode: AnalysErrorCode;
  message: string;
}

const GENERISKT_FEL_MEDDELANDE =
  "Analysen kunde inte slutföras på grund av ett internt fel. Försök igen, och kontakta oss om felet kvarstår.";

/**
 * Kastas av spend-guard-lagret (kommande `src/server/spend.ts`) för att
 * markera VARFÖR en reservation nekades — inte ett `Error`, bara en av två
 * strängliteraler. Definierad lokalt (inte importerad från `spend.ts`, som
 * inte finns än) för att inte skapa ett beroende den här modulen inte
 * behöver, per uppgiftens instruktion.
 */
export type SpendSkal = "daily_cap" | "kill_switch";

/**
 * Tolkar ett infånget fel (typiskt i en `catch (error) { ... }` runt
 * pipelinesteg) till en felkod plus ett meddelande som är säkert att visa en
 * köpare ordagrant.
 *
 * Ordning: `ExtractionValidationError` och `AnalysValidationError` ärver
 * båda `ModelValidationError` (se `extract.ts`) och mappas till samma
 * `"validation"`-kod som `AssemblyValidationError` (som INTE ärver den
 * basklassen — den är sitt eget fristående fel i `assemble.ts`, men råkar
 * betyda samma sak för en köpare: sammanställningen gick inte att lita på).
 * Att kolla basklassen en gång täcker båda subklasserna utan att behöva
 * upprepa samma gren tre gånger — subklass-före-bas-ordning spelar ingen
 * roll här eftersom alla tre redan mappar till samma kod.
 */
export function tolkaFel(error: unknown): FelResultat {
  if (error instanceof ScannedPdfError) {
    // BESLUT: ScannedPdfError:s eget meddelande är redan skrivet på svenska,
    // utan interna detaljer (inget modellsvar, ingen stacktrace, inget
    // variabelnamn) — det är by convention i pipeline-zonen redan
    // köparsäkert. Att skriva om det hade bara dupliceats texten. Passera
    // igenom oförändrat.
    return { errorCode: "scanned_pdf", message: error.message };
  }

  if (error instanceof KostnadsgransOverskriden) {
    // BESLUT: här passerar vi INTE .message igenom — det nämner
    // `MAX_COST_PER_ANALYSIS_SEK`, ett internt miljövariabelnamn. De publika
    // fälten `estimatedCostSek`/`limitSek` är rena tal utan intern
    // information, så vi formulerar ett nytt köparvänligt meddelande av dem.
    return {
      errorCode: "cost_cap",
      message:
        "Den här analysens uppskattade kostnad överstiger vad vi tillåter per rapport just nu. " +
        "Försök igen senare, eller kontakta oss om det upprepas.",
    };
  }

  if (error instanceof ModelValidationError || error instanceof AssemblyValidationError) {
    // BESLUT: `ModelValidationError` (basklass för `ExtractionValidationError`
    // och `AnalysValidationError`) och `AssemblyValidationError` bär båda på
    // interna detaljer i sitt `.message` — Zod-issues, en förhandsvisning av
    // modellens råa svar, eller (för monteringsfelet) själva det interna
    // resultatobjektet. Inget av det får nå en köpare. Ett generiskt,
    // hårdkodat meddelande — samma som det övergripande unknown-fallet,
    // eftersom en köpare inte kan agera annorlunda på "modellen svarade fel"
    // kontra "monteringen missade ett fält": båda betyder "försök igen".
    return { errorCode: "validation", message: GENERISKT_FEL_MEDDELANDE };
  }

  if (error instanceof SaknarRantekanslighetError) {
    // BESLUT: det här är INTE en bugg i vår kod eller ett trasigt modellsvar
    // — det är årsredovisningen som saknar det viktigaste av de sju
    // lagstadgade nyckeltalen (se CLAUDE.md: "Räntekänslighet är det
    // viktigaste av de sju nyckeltalen"). Köparen förtjänar den specifika,
    // ärliga förklaringen — att just den här rapporten saknar uppgiften —
    // inte ett generiskt "något gick fel" som antyder ett fel i vår kod.
    // SaknarRantekanslighetError:s eget meddelande säger redan precis detta
    // på köparsäker svenska (samma resonemang som ScannedPdfError ovan).
    return { errorCode: "saknar_rantekanslighet", message: error.message };
  }

  // Okänt Error, eller ett kastat icke-Error-värde (sträng, objekt, etc.):
  // aldrig något från `error` i meddelandet, se filkommentaren.
  return { errorCode: "unknown", message: GENERISKT_FEL_MEDDELANDE };
}

/**
 * Tolkar spend-guardens nekande-anledning (inget kastat `Error`, bara en
 * strängliteral från `SpendResultat.skal`, se `SpendSkal` ovan) till samma
 * `FelResultat`-form som `tolkaFel`.
 */
export function tolkaSpendSkal(skal: SpendSkal): FelResultat {
  if (skal === "daily_cap") {
    return {
      errorCode: "daily_cap",
      message: "Dagens gräns för antal analyser är nådd. Det är tillfälligt — försök igen imorgon.",
    };
  }

  // skal === "kill_switch".
  // BESLUT: kill-switchen är en manuell nödbroms för driften (t.ex. vid ett
  // pågående kostnadsläckage), inte ett fel i köparens data eller i
  // pipelinen, och den har ingen egen plats i `AnalysErrorCode`-unionen i
  // `portar.ts` — den unionen ändras inte här utan starkare skäl (se
  // uppgiftens instruktion). "unknown" är rimligt eftersom en kill-switch-
  // avstängning i praktiken aldrig är tänkt att nå en riktig köpare (den
  // slår igen intaget innan nya jobb ens skapas) — men meddelandet hålls
  // ändå ärligt och köparsäkert ifall det av någon anledning ändå syns.
  return {
    errorCode: "unknown",
    message:
      "Analyser är tillfälligt pausade av driftskäl. Försök igen senare, eller kontakta oss.",
  };
}

/**
 * True ENDAST för `"daily_cap"` — det enda felläget som är ett tillfälligt,
 * externt tillstånd (dagens spend-tak) snarare än något som beror på just
 * den här rapporten eller det här jobbet. En skannad PDF, en
 * kostnadsspärr per jobb, ett valideringsfel eller en saknad
 * räntekänslighet försvinner inte av att man försöker igen.
 */
export function arRetrybar(code: AnalysErrorCode): boolean {
  return code === "daily_cap";
}
