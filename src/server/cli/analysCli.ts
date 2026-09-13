/**
 * End-to-end verifiering av HELA den asynkrona jobbkön mot ett LIVE
 * Supabase-projekt: skapar ett jobb, pollar dess status, skriver ut
 * slutresultatet. Terminal-motsvarigheten till `npm run extract`
 * (`src/lib/analysis/cli.ts`) — men den kör pipelinen synkront i den här
 * processen, medan det här skriptet går via den riktiga jobbkön
 * (Supabase-tabellen `analys` + cron-tick) och därför beror på att någon
 * annan process (cron-tick/Edge Function) faktiskt plockar upp jobbet.
 *
 * Resultatet går till stdout, all loggning/progress till stderr — samma
 * disciplin som `cli.ts`.
 */

import { readFile } from "node:fs/promises";
import { setTimeout as somna } from "node:timers/promises";
import { z } from "zod";
import { envFromProcess } from "../env";
import { skapaLager } from "../supabase";
import {
  skapaAnalys,
  hamtaStatus,
  hamtaResultat,
  AnalysHittadesInteError,
  AnalysInteKlarError,
} from "../analys";
import { PropertyInputSchema } from "@/lib/analysis/schema";
import type { PropertyInput } from "@/types/analysis";

// .strict() med flit: ett okänt fält i objektsfilen är nästan alltid ett
// stavfel, och en tyst ignorering av det är extra dyr här — det här skriptet
// skapar en riktig rad mot LIVE-projektet och drar riktig Anthropic-kostnad
// vid cache miss. Särskilt lätt att missa på de valfria fälten: "byggår" i
// stället för "byggar" skulle utan .strict() bara försvinna. Lånedata är
// sedan Fas 1 Steg 0 rent klientsidigt och hör inte hemma i filen alls.
const PropertyInputFileSchema = z
  .object({
    input: PropertyInputSchema,
  })
  .strict();

class OgiltigInputfilError extends Error {
  constructor(zodError: z.ZodError) {
    const issues = zodError.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    super(`Objektsfilen matchar inte förväntat format: ${issues}`);
    this.name = "OgiltigInputfilError";
  }
}

const POLL_INTERVALL_MS = 5000;
const TIMEOUT_MS = 10 * 60 * 1000; // 10 minuter — generöst men ändligt.

async function main() {
  const pdfPath = process.argv[2];
  const inputPath = process.argv[3];
  if (!pdfPath || !inputPath) {
    console.error(
      "Användning: npm run analys -- <sökväg-till-årsredovisning.pdf> <sökväg-till-objekt.json>\n\n" +
        "VARNING: till skillnad från `npm run extract` (som kör hela pipelinen lokalt/synkront i " +
        "denna process) läser och skriver det här skriptet mot ett LIVE Supabase-projekt — det " +
        "skapar en riktig rad i `analys`-tabellen och, vid en cache miss, drar en riktig " +
        "Anthropic API-kostnad när cron-ticket plockar upp jobbet. Kör inte det här slentrianmässigt.\n\n" +
        'Objektsfilen ska ha formen { "input": PropertyInput }, se ' +
        "fixtures/property-input-example.json för ett exempel. Okända fält avvisas, så ett " +
        "stavfel tyst försvinner aldrig. Lånedata skickas aldrig till servern.\n\n" +
        "Flaggan --knuffa loggar bara en not om hur en fullständig driftsättning skulle knuffa på " +
        "Edge-funktionen direkt (se TODO-kommentaren i koden) — den gör inget riktigt HTTP-anrop.",
    );
    process.exitCode = 1;
    return;
  }

  const env = envFromProcess();

  const pdfBytes = new Uint8Array(await readFile(pdfPath));

  const rawInputFile: unknown = JSON.parse(await readFile(inputPath, "utf-8"));
  const parsedInputFile = PropertyInputFileSchema.safeParse(rawInputFile);
  if (!parsedInputFile.success) {
    throw new OgiltigInputfilError(parsedInputFile.error);
  }
  // Samma isär-hållning av Zods inferrade typ och exactOptionalPropertyTypes
  // som cli.ts och analys.ts redan gör — formen är redan verifierad ovan.
  const { input } = parsedInputFile.data as { input: PropertyInput };

  const lager = skapaLager(env);

  console.error(`Skapar analysjobb mot LIVE Supabase-projekt (${env.supabaseUrl})...`);

  const skapat = await skapaAnalys(lager, env, {
    pdfBytes,
    propertyInput: input,
  });

  if (!skapat.ok) {
    console.error(`FEL (${skapat.errorCode}): ${skapat.errorMessage}`);
    process.exitCode = 1;
    return;
  }

  const { analysisId } = skapat;
  console.error(
    `Jobb skapat: ${analysisId}. Väntar på att köns cron-tick bearbetar det (kan ta några ` +
      "minuter — se GOLIVE.md för uppmätta tider)...",
  );

  if (process.argv.includes("--knuffa")) {
    // TODO: I en fullständig driftsättning skulle --knuffa här anropa
    // Edge-funktionen direkt via HTTP (dess funktions-URL, med
    // automations-nyckeln som autentisering) i stället för att vänta på
    // nästa cron-minut. Den här CLI:n har varken funktions-URL:en eller
    // automations-nyckeln i sitt `Env` (se src/server/env.ts) — det är
    // deployment-specifika hemligheter som inte är del av den här
    // uppgiftens scope. Så länge dess inte finns här nöjer vi oss med att
    // logga den här noten och fortsätta polla precis som vanligt.
    console.error(
      "--knuffa: i en fullständig driftsättning skulle det här knuffa på Edge-funktionen direkt " +
        "via HTTP i stället för att vänta på cron-tick. Se TODO ovan i koden för varför det inte " +
        "görs här ännu. Fortsätter polla normalt.",
    );
  }

  const start = Date.now();
  for (;;) {
    const elapsedMs = Date.now() - start;
    if (elapsedMs > TIMEOUT_MS) {
      console.error(
        `Timeout: väntade ${Math.round(elapsedMs / 1000)}s utan att jobbet blev klart eller ` +
          "misslyckades. Jobbet är INTE avbrutet — det kan fortfarande bli klart i bakgrunden, " +
          "det är bara det här skriptet som har slutat titta. Kör skriptet igen, eller slå upp " +
          `analysen (id ${analysisId}) direkt i Supabase, för att se hur det till slut gick.`,
      );
      process.exitCode = 1;
      return;
    }

    const statusSvar = await hamtaStatus(lager, analysisId);
    if (!statusSvar) {
      throw new AnalysHittadesInteError(analysisId);
    }

    console.error(
      `[${Math.round(elapsedMs / 1000)}s] status=${statusSvar.status} stage=${statusSvar.stage}`,
    );

    if (statusSvar.status === "done") {
      const resultat = await hamtaResultat(lager, analysisId);
      console.log(JSON.stringify(resultat, null, 2));
      // AnalysStatusSvar exponerar ingen cost_sek (se src/server/analys.ts)
      // — bara status/stage/fel — så det finns ingen kostnadssiffra att
      // skriva ut här. Att lägga till den i status-svaret vore en trevlig
      // uppföljning men är utanför den här uppgiftens scope.
      console.error("Klart.");
      return;
    }

    if (statusSvar.status === "failed") {
      console.error(
        `FEL (${statusSvar.errorCode ?? "unknown"}): ${statusSvar.errorMessage ?? "okänt fel"}`,
      );
      process.exitCode = 1;
      return;
    }

    await somna(POLL_INTERVALL_MS);
  }
}

main().catch((error: unknown) => {
  if (
    error instanceof OgiltigInputfilError ||
    error instanceof AnalysHittadesInteError ||
    error instanceof AnalysInteKlarError
  ) {
    console.error(`FEL: ${error.message}`);
  } else {
    console.error("Oväntat fel:", error);
  }
  process.exitCode = 1;
});
