/**
 * Spend-vakten: reserve-then-reconcile, inte check-then-increment.
 *
 * Varje pipeline-steg som anropar Anthropic-API:et MÅSTE gå via
 * `reserveraForSteg` INNAN anropet görs (så att det dagliga taket hålls
 * atomärt även när flera steg körs samtidigt) och `stamAvSteg` EFTER att
 * anropet är klart (så att reservationen justeras ner — eller upp — till
 * den faktiska kostnaden).
 *
 * Atomiciteten kommer inte från något i den här filen: `db.reserveraSpend`
 * lägger hela avgörandet "får dagens totalsumma + den här reservationen
 * plats under taket?" i en enda databas-rundtur (se `reservera_spend` i
 * supabase/migrations/20260913105304_init.sql, och motsvarande fake i
 * __fakes__/lager.ts). Den här modulen läser aldrig dagens totalsumma själv
 * och beslutar client-side — det vore precis den check-then-act-race som
 * designen ska undvika. Vi skickar bara vidare uppskattningen och agerar på
 * svaret.
 *
 * `ANALYSIS_KILL_SWITCH=on` (env.killSwitchPa) refuserar INNAN någon
 * reservation ens försöks — ett avstängt system ska inte röra `spend_day`
 * alls, inte ens läsa/skriva en no-op-rad.
 */

import type { Databas } from "./portar";
import type { Env } from "./env";

export type SpendSkal = "daily_cap" | "kill_switch";

export interface SpendResultat {
  ok: boolean;
  skal?: SpendSkal;
  reserveratSek?: number;
}

/**
 * Uppskattade kostnader per pipeline-steg, i SEK — avsiktligt avrundade
 * UPPÅT (ett steg ska reservera minst så mycket som det troligen kostar,
 * aldrig mindre). Källa: GOLIVE.md, tabellen "Measured cost of one cold
 * run" (mätning mot Nabo-rapporten):
 *
 *   | Pass 1 — extraction (sends the whole PDF) | 3,27 kr |
 *   | Pass 2 — judgement (text only)             | 0,64 kr |
 *
 * Pass 1 görs i sin tur av två separata API-anrop — grundning (skickar hela
 * PDF:en, se `grundtext`-fältet på `AnalysRad` i portar.ts) och därefter
 * extraktion (resonerar bara över grundtexten, text only). GOLIVE.md mäter
 * inte den interna fördelningen mellan de två separat, men grundning är
 * steget som bär hela dokumentet genom modellen och antas därför dominera
 * pass 1:s kostnad; extraktion är billigare. Bedömning (Pass 2) mäts direkt
 * till 0,64 kr och avrundas uppåt till 1,5 kr för marginal.
 */
export const UPPSKATTAD_KOSTNAD_GRUNDNING_SEK = 3;
export const UPPSKATTAD_KOSTNAD_EXTRAKTION_SEK = 1;
export const UPPSKATTAD_KOSTNAD_BEDOMNING_SEK = 1.5;

/**
 * Dagens datum som "YYYY-MM-DD", i Europe/Stockholm — inte UTC. Ett
 * medvetet men lågstakes-val: köparna och spendet hör hemma i svensk tid,
 * så dygnsgränsen för det dagliga taket ska följa den, inte UTC (som annars
 * skulle flytta gränsen 1–2 timmar fel beroende på sommar-/vintertid). Går
 * att ompröva senare om systemet får köpare i andra tidszoner.
 */
function dagensDatumStockholm(): string {
  // "en-CA" råkar formatera som YYYY-MM-DD, men det avgörande valet här är
  // timeZone — inte lokalen.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Försöker reservera `uppskattatSek` av dagens spend-tak INNAN ett steg
 * anropar Anthropic-API:et. Se filkommentaren för varför det här är säkert
 * mot race conditions.
 */
export async function reserveraForSteg(
  db: Databas,
  env: Pick<Env, "maxDailySpendSek" | "killSwitchPa">,
  uppskattatSek: number,
  dag: string = dagensDatumStockholm(),
): Promise<SpendResultat> {
  if (env.killSwitchPa) {
    return { ok: false, skal: "kill_switch" };
  }

  const accepterad = await db.reserveraSpend(dag, uppskattatSek, env.maxDailySpendSek);
  if (!accepterad) {
    return { ok: false, skal: "daily_cap" };
  }
  return { ok: true, reserveratSek: uppskattatSek };
}

/**
 * Stämmer av en tidigare reservation mot den faktiska kostnaden efter att
 * steget är klart — frigör mellanskillnaden om den faktiska kostnaden blev
 * lägre, eller drar av mer om den blev högre.
 */
export async function stamAvSteg(
  db: Databas,
  reserveratSek: number,
  faktisktSek: number,
  dag: string = dagensDatumStockholm(),
): Promise<void> {
  await db.avstamSpend(dag, reserveratSek, faktisktSek);
}
