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

import type { AnalysErrorCode, RapportErrorCode } from "./portar";
import { ScannedPdfError, TomTranskriptionError } from "@/lib/analysis/runExtraction";
import { TranskriberingMarkorFelError } from "@/lib/analysis/transkribering";
import { KostnadsgransOverskriden } from "@/lib/analysis/costGuard";
import { ModelTruncatedError, ModelValidationError } from "@/lib/analysis/extract";
import { AssemblyValidationError } from "@/lib/analysis/assemble";
import { SaknarRantekanslighetError } from "@/lib/analysis/calc/rantestress";
import { SAKNAR_BEHORIGHET_MEDDELANDE, SaknarBehorighetError } from "./behorighet";
import type { KvotUtfall } from "./kvot";
import { SidtextOfullstandigError } from "./register";
import type { KontoFel, KontoFelKod } from "@/lib/kontoTyper";

export interface FelResultat {
  errorCode: AnalysErrorCode;
  message: string;
}

export const GENERISKT_FEL_MEDDELANDE =
  "Analysen kunde inte slutföras på grund av ett internt fel. Försök igen, och kontakta oss om felet kvarstår.";

const SKANNAD_OLASLIG_MEDDELANDE =
  "Vi kunde inte läsa av de skannade sidorna tillförlitligt. " +
  "Försök gärna med en digital version av årsredovisningen.";

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

  if (
    error instanceof TranskriberingMarkorFelError ||
    error instanceof TomTranskriptionError ||
    error instanceof SidtextOfullstandigError
  ) {
    // BESLUT: de skannade sidorna gick inte att läsa av tillförlitligt (felaktiga
    // sidmarkörer efter ett omförsök, eller en transkription utan text). Ingen
    // ny felkod: UI:ts spegel av AnalysErrorCode (src/lib/analysStatusCopy.ts)
    // måste vara exakt lika med serverns union, och dess `scanned_pdf`-text
    // ("går inte att läsa maskinellt … be om den digitala originalfilen") är
    // precis rådet som hjälper köparen här — `validation` skulle i stället
    // skicka köparen tillbaka till formuläret. Felklassernas egna meddelanden
    // nämner sidnummer och markörer och passerar därför INTE igenom.
    return { errorCode: "scanned_pdf", message: SKANNAD_OLASLIG_MEDDELANDE };
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

  if (
    error instanceof ModelValidationError ||
    error instanceof AssemblyValidationError ||
    // Svaret klipptes vid max_tokens: för köparen samma sak som ett ogiltigt
    // svar ("försök igen"). Meddelandet nämner interna tak — skickas inte vidare.
    error instanceof ModelTruncatedError
  ) {
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

  if (error instanceof SaknarBehorighetError) {
    // BESLUT: en nekad behörighet (./behorighet.ts) — inget fel i köparens
    // data. Meddelandet är den fasta, köparsäkra konstanten (inte
    // `error.message`, även om det i dag är samma text): `formaga` och allt
    // annat på felet är intern policyinformation.
    return { errorCode: "behorighet", message: SAKNAR_BEHORIGHET_MEDDELANDE };
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
 * En nekad kvot (./kvot.ts, `kontrolleraUppladdningskvot` /
 * `kontrolleraPrisuppskattningskvot`) i samma `FelResultat`-form. Kvotens
 * meddelande är skrivet för köparen (KVOT_MEDDELANDE — enhet, nätverk eller
 * prisuppskattning) och passerar oförändrat: det är det som säger VILKEN
 * gräns som nåddes.
 */
export function tolkaKvot(utfall: Extract<KvotUtfall, { ok: false }>): FelResultat {
  return { errorCode: "kvot", message: utfall.message };
}

/**
 * Tolkar en jobbrads `promptVersion`-mismatch mot den körande kodens egen
 * `PROMPT_VERSION` (se `korNastaSteg`/`avslutaMedVersionskonflikt` i
 * `steg.ts`) till samma `FelResultat`-form som `tolkaFel`/`tolkaSpendSkal` —
 * inte ett kastat fel, utan ett tillstånd upptäckt INNAN något
 * modellanrop eller någon cache-läsning/skrivning görs.
 *
 * BAKGRUND (live incident 2026-09-28): webbplatsen och Edge Function-koden
 * deployas separat. Webbplatsen stämplar varje jobbrad med SIN EGEN
 * `PROMPT_VERSION` vid `skapaAnalys` (analys.ts); Edge Function-koden som
 * senare klaimar och kör raden kör SIN EGEN, potentiellt äldre eller nyare,
 * `PROMPT_VERSION`. När de två låg på olika versioner körde den gamla
 * arbetaren de GAMLA prompterna men skrev resultatet till cachen under
 * radens stämplade (NYA) nyckel — och förgiftade cachen: varje senare
 * köpare av samma förening fick den gamla extraktionen under den nya
 * versionens nyckel. Ett jobb vars stämplade version inte matchar den
 * körande koden får därför ALDRIG köras eller röra cachen — bara
 * misslyckas direkt, utan omkö (ett nytt försök hjälper inte förrän båda
 * sidor är på samma version igen).
 */
export function versionskonfliktResultat(): FelResultat {
  return {
    errorCode: "versionskonflikt",
    message:
      "Binfo uppdaterades medan din analys väntade i kön. Ladda upp årsredovisningen igen om en " +
      "stund, så körs den med den senaste versionen.",
  };
}

/**
 * En registerrapport som en administratör ogiltigförklarat
 * (`npm run register -- invalidate`, error_code `ogiltigforklarad`). Koden är
 * intern — den finns inte i UI:ts `AnalysErrorCode`-spegel
 * (src/lib/analysStatusCopy.ts), så en köpare får `versionskonflikt`, vars
 * skärm redan säger det enda köparen kan göra: ladda upp igen. Meddelandet är
 * däremot eget och sant (inte "Binfo uppdaterades").
 */
export function ogiltigforklaradResultat(): FelResultat {
  return {
    errorCode: "versionskonflikt",
    message:
      "Analysen av den här årsredovisningen har dragits tillbaka. Ladda upp den igen, så görs " +
      "en ny analys.",
  };
}

/**
 * Ett lagrat registerresultat som inte går att läsa med den körande koden
 * (schemat har ändrats) OCH inte går att köra om, eftersom PDF:en inte längre
 * finns i lagringen. Samma köparhandling som en versionskonflikt.
 */
export function omkorningOmojligResultat(): FelResultat {
  return {
    errorCode: "versionskonflikt",
    message:
      "Analysen gjordes med en tidigare version av Binfo och behöver göras om. Ladda upp " +
      "årsredovisningen igen.",
  };
}

/**
 * Översätter en `rapport`-rads lagrade felkod + meddelande till det en köpare
 * ser i `hamtaStatus`. Meddelandet på raden är redan köparsäkert (skrivet av
 * `tolkaFel`/`versionskonfliktResultat` i steg.ts) — utom för den interna
 * koden `ogiltigforklarad`, som får sitt eget meddelande ovan.
 */
export function tolkaRapportFel(
  code: RapportErrorCode | null,
  message: string | null,
): FelResultat {
  if (code === "ogiltigforklarad") return ogiltigforklaradResultat();
  return {
    errorCode: code ?? "unknown",
    message: message ?? GENERISKT_FEL_MEDDELANDE,
  };
}

/**
 * True ENDAST för de tillfälliga, tidsbundna tillstånden: `"daily_cap"`
 * (dagens spend-tak) och `"kvot"` (köparens egen gräns per dag/timme) — båda
 * försvinner av sig själva när fönstret rullar över, så "försök igen senare"
 * är rätt råd. En skannad PDF, en kostnadsspärr per jobb, ett valideringsfel,
 * en saknad räntekänslighet eller en nekad behörighet (`"behorighet"`, en
 * policyfråga — inte tid) försvinner inte av att man försöker igen.
 */
export function arRetrybar(code: AnalysErrorCode): boolean {
  return code === "daily_cap" || code === "kvot";
}

/**
 * Errors the client recognises BY NAME (`.name` survives the server-function
 * serialisation, see arAnalysHittadesInteFel in src/lib/analysStatusCopy.ts and
 * the loaders): they carry a Swedish, buyer-safe message and pass through.
 * Names, not classes: fel.ts cannot import analys.ts (it imports this file).
 */
const KANDA_KLIENTFEL = new Set([
  "AnalysHittadesInteError",
  "AnalysInteKlarError",
  "SaknarBehorighetError",
  "KontoEjKonfigureratError",
]);

/**
 * The last line of defence in every server-function handler (analysFn.ts): an
 * error nobody mapped — a Supabase/Storage/network message, a Zod dump — must
 * never reach the browser. It is logged server-side with its handler name, and
 * the client gets an Error with only the generic buyer-safe message.
 */
export function sakertFel(handler: string, error: unknown): Error {
  if (error instanceof Error && KANDA_KLIENTFEL.has(error.name)) return error;
  console.error(`[${handler}] oväntat fel:`, error);
  return new Error(GENERISKT_FEL_MEDDELANDE);
}

/** `sakertFel` for `skapaAnalysFn`, whose result type has an error variant:
 *  the same logging, returned instead of thrown. */
export function sakertSkapaFel(handler: string, error: unknown) {
  console.error(`[${handler}] oväntat fel:`, error);
  return {
    ok: false as const,
    errorCode: "unknown" as const,
    errorMessage: GENERISKT_FEL_MEDDELANDE,
  };
}

// ---------------------------------------------------------------------------
// Accounts and saved items (v3, src/server/auth.ts + sparat.ts).
//
// These functions return their failures as data (`KontoFel`, see
// src/lib/kontoTyper.ts) so a form can branch on `felKod`; the texts below are
// the only place their Swedish copy lives. Nothing from a caught error ever
// goes into `meddelande` (same invariant as `tolkaFel`): Auth/Supabase
// messages can name internals or leak whether an address is registered.
// ---------------------------------------------------------------------------

export const KONTO_FEL_MEDDELANDE: Readonly<Record<KontoFelKod, string>> = {
  ogiltig_epost: "Ange en giltig e-postadress.",
  svagt_losenord:
    "Lösenordet måste vara minst 10 tecken (och högst 72 byte). Det får inte heller vara ett " +
    "lösenord som förekommit i ett dataintrång eller det du redan har.",
  ogiltig_inloggning: "Fel e-postadress eller lösenord.",
  kraver_nuvarande_losenord: "Ange ditt nuvarande lösenord för att byta till ett nytt.",
  epost_ej_bekraftad:
    "E-postadressen är inte bekräftad ännu. Klicka på länken i bekräftelsemejlet först.",
  ogiltig_lank:
    "Länken är ogiltig eller har gått ut. Länkar i mejl fungerar bara en gång och en begränsad tid.",
  annan_session_aktiv:
    "Du är redan inloggad med ett annat konto. Logga ut och be om en ny länk (via Glömt lösenord eller genom att registrera dig igen).",
  kvot: "För många försök, vänta en stund.",
  ej_inloggad: "Du behöver logga in för att göra det här.",
  hittades_inte: "Vi hittade inte det du sökte.",
  ogiltig_indata: "Uppgifterna är ogiltiga. Kontrollera dem och försök igen.",
  for_manga_sparade: "Du har nått gränsen för antal sparade objekt. Ta bort något och försök igen.",
  konto_ej_konfigurerat: "Konton är inte aktiverade just nu. Försök igen senare.",
  // Not the analysis copy: account pages must not say "Analysen kunde inte…".
  unknown: "Något gick fel hos oss. Försök igen om en stund, och kontakta oss om felet kvarstår.",
};

export function kontoFel(felKod: KontoFelKod): KontoFel {
  return { ok: false, felKod, meddelande: KONTO_FEL_MEDDELANDE[felKod] };
}

/** `PROJECT_PUBLISHABLE_KEY` is optional in `Env`; the Auth flows need it.
 *  Thrown when an account function is called without it. Passes through
 *  `sakertFel` (known client error) with its Swedish message. */
export class KontoEjKonfigureratError extends Error {
  constructor() {
    super(KONTO_FEL_MEDDELANDE.konto_ej_konfigurerat);
    this.name = "KontoEjKonfigureratError";
  }
}
