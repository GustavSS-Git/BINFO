/**
 * Svensk text och ren logik för `/analys/$analysisId` — jobbstegens
 * förloppstext och felkodernas köparskärmar.
 *
 * De två unionerna nedan SPEGLAR `AnalysStage`/`AnalysErrorCode` i
 * `src/server/portar.ts` för hand, i stället för att importera dem därifrån:
 * `@/server/analysFn` är den enda modulen klientkod får importera ur
 * `src/server/` (se CLAUDE.md, eslint.config.js, vite.config.ts), och
 * `portar.ts` är inte den filen. Om kontraktet i `portar.ts` någonsin ändras
 * slutar `Record`-typerna nedan kompilera (ett steg/en felkod för mycket
 * eller för lite) tills den här filen uppdaterats för hand — det är
 * medvetet, inte en risk.
 *
 * Texten säger 3–5 minuter; uppmätt tid är ca 1–3 minuter (se CLAUDE.md).
 * Texten här lovar därför aldrig "snart" eller "några sekunder" — bara vilket steg som
 * faktiskt pågår, plus ett ärligt tidsspann.
 */

export type AnalysStage = "uploaded" | "extracting" | "judging" | "complete";

export type AnalysErrorCode =
  | "scanned_pdf"
  | "cost_cap"
  | "daily_cap"
  | "validation"
  | "saknar_rantekanslighet"
  | "versionskonflikt"
  | "kvot"
  | "behorighet"
  | "unknown";

/** Ordningen stegen faktiskt inträffar i — driver den enkla förloppsstapeln. */
export const STEG_ORDNING: AnalysStage[] = ["uploaded", "extracting", "judging", "complete"];

/** Text som visas medan jobbet varken är klart eller misslyckat. */
export const STEG_TEXT: Record<AnalysStage, string> = {
  uploaded: "Läser årsredovisningen…",
  extracting: "Hämtar de sju nyckeltalen…",
  judging: "Analyserar föreningens ekonomi…",
  complete: "Sammanställer rapporten…",
};

/** Hur långt in i förloppet ett steg ligger, som andel 0–1 (aldrig 0). */
export function stegAndel(stage: AnalysStage): number {
  const index = STEG_ORDNING.indexOf(stage);
  return (index + 1) / STEG_ORDNING.length;
}

export interface FelkodInnehall {
  /** Kort rubrik för felskärmen. */
  rubrik: string;
  /** Sammanhang UTÖVER serverns errorMessage (som redan är köparsäker text
   *  att visa ordagrant, se src/server/fel.ts) — inte en omskrivning av den. */
  forklaring: string;
  /** Vad köparen konkret bör göra härnäst. */
  atgard: string;
}

export const FELKOD_INNEHALL: Record<AnalysErrorCode, FelkodInnehall> = {
  scanned_pdf: {
    rubrik: "Årsredovisningen går inte att läsa maskinellt",
    forklaring:
      "Filen verkar vara en skannad bild eller ett foto snarare än ett digitalt PDF-dokument " +
      "med text. Det händer ofta — omkring var åttonde årsredovisning vi hittills sett saknar " +
      "textlager.",
    atgard:
      "Be mäklaren eller styrelsen om den digitala originalfilen, till exempel från föreningens " +
      "ekonomiska förvaltare, och ladda upp den i stället för en skanning eller ett foto.",
  },
  cost_cap: {
    rubrik: "Tillfälligt tekniskt stopp",
    forklaring:
      "Det beror inte på din årsredovisning eller dina uppgifter — stoppet är på vår sida.",
    atgard: "Försök igen om en stund. Kvarstår det, hör av dig till oss.",
  },
  daily_cap: {
    rubrik: "Dagens gräns är nådd",
    forklaring:
      "Det beror inte på din analys — vi tar just nu emot ett begränsat antal analyser per dag.",
    atgard: "Försök igen imorgon.",
  },
  validation: {
    rubrik: "Uppgifterna kunde inte tolkas",
    forklaring: "Något i formuläret gick inte att tolka innan analysen kunde starta.",
    atgard: "Gå tillbaka till formuläret, kontrollera uppgifterna och skicka in igen.",
  },
  saknar_rantekanslighet: {
    rubrik: "Räntekänslighet saknas i årsredovisningen",
    forklaring:
      "Räntekänslighet är det viktigaste av de sju lagstadgade nyckeltalen, och den här " +
      "årsredovisningen redovisar det inte tillräckligt tydligt för att vi ska kunna räkna på det.",
    atgard:
      "Kontrollera att det är den senaste årsredovisningen (nyckeltalet är obligatoriskt sedan " +
      "räkenskapsår 2023). Saknas uppgiften ändå, fråga styrelsen om den direkt.",
  },
  versionskonflikt: {
    rubrik: "Analysen kunde inte slutföras",
    forklaring:
      "Det berodde inte på din årsredovisning — våra system uppdaterades medan analysen väntade " +
      "i kön, mellan två steg som måste köras med samma version.",
    atgard:
      "Gå tillbaka till formuläret och ladda upp årsredovisningen igen om en stund, så körs den " +
      "med den senaste versionen.",
  },
  kvot: {
    // Serverns errorMessage säger VILKEN gräns som nåddes (per enhet, per
    // nätverk eller för prisuppskattningar) och när den släpper — texten här
    // kompletterar bara.
    rubrik: "Gränsen är nådd för tillfället",
    forklaring:
      "Det beror inte på din årsredovisning eller dina uppgifter — vi begränsar hur mycket som " +
      "kan göras på kort tid, så att tjänsten räcker till alla.",
    atgard: "Vänta och försök igen senare. Kvarstår det, hör av dig till oss.",
  },
  behorighet: {
    rubrik: "Ingen tillgång just nu",
    forklaring: "Den här delen av Binfo är inte öppen för dig just nu.",
    atgard: "Hör av dig till oss om du tror att det är fel.",
  },
  unknown: {
    rubrik: "Något gick fel",
    forklaring: "Vi kunde inte slutföra analysen.",
    atgard: "Försök igen. Kvarstår felet, hör av dig till oss så tittar vi på det.",
  },
};

/**
 * Känner igen `AnalysHittadesInteError` (kastat av `hamtaResultatFn` för ett
 * okänt id, se src/server/analys.ts) utan att importera klassen — den
 * serverfunktionens fel serialiseras över RPC:n som en vanlig `Error` med
 * `.name` bevarat (seroval sätter `name` explicit när den skiljer sig från
 * `"Error"`), så `instanceof` mot originalklassen fungerar aldrig
 * klientsidan. `.name` är den stabila, dokumenterade signalen.
 */
export function arAnalysHittadesInteFel(fel: unknown): boolean {
  return fel instanceof Error && fel.name === "AnalysHittadesInteError";
}
