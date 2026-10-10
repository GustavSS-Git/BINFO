/**
 * GDPR admin CLI (LIVE: talks to the real Supabase project with the secret
 * key from .env.local). No Anthropic calls.
 *
 *   npm run konto -- exportera <principalId>   # JSON on stdout
 *   npm run konto -- radera <principalId>      # erasure, prints counts
 *
 * `radera` removes the principal, every principal merged into it, their
 * analys rows (property_input), behorighet rows and device-keyed kvot rows.
 * Register data (rapport, rapport_fil, forening, …) and the shared caches
 * are untouched — they are derived from public documents and name no buyer.
 *
 * The command logic (`korKontoKommando`) is separate from `main` so it can
 * be tested against the in-memory fake.
 */

import { pathToFileURL } from "node:url";
import { envFromProcess } from "../env";
import type { KontoDatabas } from "../kontoPortar";
import { skapaKontoDatabas } from "../supabaseKonto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ANVANDNING =
  "Användning: npm run konto -- exportera <principalId> | radera <principalId>";

export interface CliUtskrift {
  ut(text: string): void;
  fel(text: string): void;
}

export interface CliAlternativ {
  /** The real CLI requires a uuid; the fake uses non-uuid ids. */
  kravUuid?: boolean;
}

/** Runs one command. Returns the process exit code. */
export async function korKontoKommando(
  db: KontoDatabas,
  argv: readonly string[],
  utskrift: CliUtskrift,
  alternativ: CliAlternativ = {},
): Promise<number> {
  const [kommando, principalId, ...rest] = argv;
  if (
    (kommando !== "exportera" && kommando !== "radera") ||
    principalId === undefined ||
    rest.length > 0
  ) {
    utskrift.fel(ANVANDNING);
    return 2;
  }
  if ((alternativ.kravUuid ?? true) && !UUID.test(principalId)) {
    utskrift.fel(`Ogiltigt principal-id (förväntade ett uuid): ${principalId}`);
    return 2;
  }

  if (kommando === "exportera") {
    const data = await db.exporteraPrincipal(principalId);
    if (data === null) {
      utskrift.fel(`Ingen principal med id ${principalId}.`);
      return 1;
    }
    utskrift.ut(JSON.stringify(data, null, 2));
    return 0;
  }

  const resultat = await db.raderaPrincipal(principalId);
  if (resultat.principaler === 0) {
    utskrift.fel(`Ingen principal med id ${principalId} — inget raderades.`);
    return 1;
  }
  utskrift.fel(
    `Raderat: ${resultat.principaler} principal(er), ${resultat.analyser} analys(er), ` +
      `${resultat.behorigheter} behörighet(er), ${resultat.kvotrader} kvotrad(er).`,
  );
  return 0;
}

async function main(): Promise<void> {
  const env = envFromProcess();
  const db = skapaKontoDatabas(env);
  process.exitCode = await korKontoKommando(db, process.argv.slice(2), {
    ut: (t) => console.log(t),
    fel: (t) => console.error(t),
  });
}

const arDirektkorning =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (arDirektkorning) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
