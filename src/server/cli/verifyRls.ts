/**
 * Bevisar EMPIRISKT — mot det riktiga Supabase-projektet, inte på förtroende
 * — att (a) PROJECT_SECRET_KEY (`sb_secret_...`) förbigår RLS trots
 * "enable row level security" + noll policies på tabellerna i
 * `supabase/migrations/*_init.sql`, och (b) PROJECT_PUBLISHABLE_KEY
 * korrekt nekas. Stänger den öppna frågan i SUPABASE.md om det nya
 * `sb_secret_...`-nyckelformatet verkligen beter sig som gamla
 * `service_role`.
 *
 * Använder `spend_day` (day/cost_sek/runs) som oskyldig probe-tabell, med
 * ett datum långt bak i tiden (1999) som aldrig kan krocka med riktig data.
 *
 * Det här är en säkerhetskritisk kontroll: ett skript som rapporterar falsk
 * trygghet är värre än ett som är högljutt om ett misslyckande. Därför:
 * exit 1 om NÅGOT beter sig annorlunda än förväntat, även om resten gick
 * bra.
 */

import { createClient } from "@supabase/supabase-js";
import { envFromProcess } from "../env";

const DAG_SECRET = "1999-01-01";
const DAG_PUBLISHABLE = "1999-01-02";

interface Utfall {
  namn: string;
  godkant: boolean;
  detalj: string;
}

function loggaUtfall(u: Utfall): void {
  console.error(`${u.godkant ? "OK  " : "FEL "} ${u.namn}: ${u.detalj}`);
}

async function main() {
  const env = envFromProcess();

  if (!env.supabasePublishableKey) {
    console.error(
      "PROJECT_PUBLISHABLE_KEY saknas i .env.local. Den är valfri i Env generellt (se " +
        "src/server/env.ts), men KRÄVS för det här skriptet — utan den kan vi inte visa att en " +
        "icke-secret nyckel faktiskt nekas av RLS. Lägg till den och försök igen.",
    );
    process.exitCode = 1;
    return;
  }

  const secretClient = createClient(env.supabaseUrl, env.supabaseSecretKey, {
    auth: { persistSession: false },
  });
  const publishableClient = createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { persistSession: false },
  });

  const utfall: Utfall[] = [];

  // -------------------------------------------------------------------------
  // 1. Secret-nyckeln ska kunna skriva OCH läsa trots RLS + noll policies.
  // -------------------------------------------------------------------------
  console.error(`Skriver probe-rad (${DAG_SECRET}) med secret-nyckeln...`);
  const insertSecret = await secretClient
    .from("spend_day")
    .upsert({ day: DAG_SECRET, cost_sek: 0, runs: 0 }, { onConflict: "day" });
  utfall.push({
    namn: "secret-nyckeln kan skriva",
    godkant: insertSecret.error === null,
    detalj: insertSecret.error
      ? `fel: ${JSON.stringify(insertSecret.error)}`
      : "upsert lyckades utan fel",
  });

  console.error(`Läser tillbaka probe-raden (${DAG_SECRET}) med secret-nyckeln...`);
  const selectSecret = await secretClient.from("spend_day").select("*").eq("day", DAG_SECRET);
  const secretFickRad = selectSecret.error === null && (selectSecret.data?.length ?? 0) === 1;
  utfall.push({
    namn: "secret-nyckeln kan läsa tillbaka den",
    godkant: secretFickRad,
    detalj: selectSecret.error
      ? `fel: ${JSON.stringify(selectSecret.error)}`
      : `data: ${JSON.stringify(selectSecret.data)}`,
  });

  // -------------------------------------------------------------------------
  // 2. Publishable-nyckeln ska NEKAS både select och insert.
  //    RLS-nekade selects ger ofta { data: [], error: null } snarare än ett
  //    fel — kolla radantal, inte bara närvaron av ett fel.
  // -------------------------------------------------------------------------
  console.error(`Försöker läsa samma rad (${DAG_SECRET}) med publishable-nyckeln (ska nekas)...`);
  const selectPublishable = await publishableClient
    .from("spend_day")
    .select("*")
    .eq("day", DAG_SECRET);
  const selectNekad =
    selectPublishable.error !== null || (selectPublishable.data?.length ?? 0) === 0;
  utfall.push({
    namn: "publishable-nyckeln nekas select",
    godkant: selectNekad,
    detalj: selectPublishable.error
      ? `nekad med fel: ${JSON.stringify(selectPublishable.error)}`
      : `svar utan fel, ${selectPublishable.data?.length ?? 0} rader: ${JSON.stringify(selectPublishable.data)}`,
  });

  console.error(
    `Försöker skriva en ny rad (${DAG_PUBLISHABLE}) med publishable-nyckeln (ska nekas)...`,
  );
  const insertPublishable = await publishableClient
    .from("spend_day")
    .insert({ day: DAG_PUBLISHABLE, cost_sek: 0, runs: 0 });
  // Ett lyckat-utseende svar räcker inte som bevis på att inget skrevs — en
  // insert kan svara utan fel men ändå inte returnera raden. Kontrollera med
  // secret-nyckeln om raden faktiskt landade.
  const kontrollLasning = await secretClient
    .from("spend_day")
    .select("*")
    .eq("day", DAG_PUBLISHABLE);
  const insertNekad = insertPublishable.error !== null || (kontrollLasning.data?.length ?? 0) === 0;
  utfall.push({
    namn: "publishable-nyckeln nekas insert",
    godkant: insertNekad,
    detalj: insertPublishable.error
      ? `nekad med fel: ${JSON.stringify(insertPublishable.error)}`
      : `svar utan fel (${JSON.stringify(insertPublishable.data)}); kontrollerat med secret-nyckeln: ` +
        `${kontrollLasning.data?.length ?? 0} rader hittades i efterhand`,
  });

  for (const u of utfall) loggaUtfall(u);

  // -------------------------------------------------------------------------
  // 3. Städa upp — oavsett utfall ovan, defensivt, så skriptet aldrig
  //    lämnar skräp kvar (inte ens vid ett delvis misslyckande).
  // -------------------------------------------------------------------------
  console.error("Städar bort probe-raderna med secret-nyckeln...");
  const stad = await secretClient
    .from("spend_day")
    .delete()
    .in("day", [DAG_SECRET, DAG_PUBLISHABLE]);
  if (stad.error) {
    console.error(`Varning: städning misslyckades: ${JSON.stringify(stad.error)}`);
  }

  const secretForbigarRls = utfall
    .filter((u) => u.namn.startsWith("secret-nyckeln"))
    .every((u) => u.godkant);
  const publishableNekas = utfall
    .filter((u) => u.namn.startsWith("publishable-nyckeln"))
    .every((u) => u.godkant);
  const allaGodkanda = utfall.every((u) => u.godkant);

  console.log("");
  console.log("=== Slutresultat: RLS-verifiering mot spend_day ===");
  console.log(`Secret-nyckeln förbigår RLS: ${secretForbigarRls ? "JA" : "NEJ"}`);
  console.log(`Publishable-nyckeln nekas av RLS: ${publishableNekas ? "JA" : "NEJ"}`);
  console.log(`Totalt: ${allaGodkanda ? "GODKÄNT" : "UNDERKÄNT"}`);
  console.log("");
  for (const u of utfall) {
    console.log(`  ${u.godkant ? "OK  " : "FEL "} ${u.namn} — ${u.detalj}`);
  }

  if (!allaGodkanda) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("Oväntat fel:", error);
  process.exitCode = 1;
});
