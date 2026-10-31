/**
 * Live check of the Booli API source (src/server/annons/booliApi.ts) against
 * real listings: a few active Stockholm listings and a few recently sold ones,
 * each fetched as `https://www.booli.se/annons/<id>` through the real client
 * and mapping, with a per-field report.
 *
 *   node --env-file=.env.local --import tsx scripts/testaBooliApi.ts           # report only
 *   node --env-file=.env.local --import tsx scripts/testaBooliApi.ts --spara   # also rewrite fixtures/booli-api/
 *
 * (`npx tsx` fails inside the Claude Code sandbox; `node --import tsx` works.)
 * Needs BOOLI_CALLER_ID and BOOLI_PRIVATE_KEY. The keys are never printed:
 * request URLs are shown as their path only, and saved fixtures are scrubbed
 * of the caller id and every hash, with Booli's `estimate` removed (Binfo
 * never reads or stores it).
 *
 * Cost: 3 search calls + 2 per listing (listings + areas, or listings 404 +
 * sold) ≈ 19 calls for the default 5 + 3. Run it by hand, rarely; not part of
 * the test suite.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ANNONS_FALT } from "../src/lib/annons/typer";
import {
  anropaBooliApi,
  hamtaFranBooliApi,
  type BooliApiNycklar,
} from "../src/server/annons/booliApi";

const SPARA = process.argv.includes("--spara");
const FIXTURER = join(process.cwd(), "fixtures", "booli-api");
const AKTIVA_OMRADEN: readonly { q: string; antal: number }[] = [
  { q: "Södermalm", antal: 3 },
  { q: "Kungsholmen", antal: 2 },
];
const SALDA = { q: "Vasastan", antal: 3, dagarTillbaka: 30 };

const callerId = process.env.BOOLI_CALLER_ID?.trim();
const privateKey = process.env.BOOLI_PRIVATE_KEY?.trim();
if (!callerId || !privateKey) {
  console.error("BOOLI_CALLER_ID och BOOLI_PRIVATE_KEY saknas (kör med --env-file=.env.local).");
  process.exit(2);
}
const nycklar: BooliApiNycklar = { callerId, privateKey };

// ---------------------------------------------------------------------------
// A fetch that counts calls and keeps each answer (for --spara)
// ---------------------------------------------------------------------------

interface Inspelning {
  sokvag: string;
  status: number;
  kropp: string;
}
const inspelningar: Inspelning[] = [];

const raknandeFetch: typeof fetch = async (input, init) => {
  const u = new URL(String(input));
  const res = await fetch(input, init);
  const kropp = await res.clone().text();
  inspelningar.push({ sokvag: u.pathname.replace(/^\//, ""), status: res.status, kropp });
  return res;
};

function antalAnrop(): number {
  return inspelningar.length;
}

/** Removes the caller id, any hash-like value and every `estimate`. */
function maskera(kropp: string): unknown {
  let text = kropp.split(nycklar.callerId).join("<CALLER_ID>");
  text = text.replace(/\b[0-9a-f]{40}\b/g, "<HASH>");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return text;
  }
  const rensa = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(rensa);
    if (typeof v === "object" && v !== null) {
      const ut: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        if (k === "estimate" || k === "callerId" || k === "hash") continue;
        ut[k] = rensa(x);
      }
      return ut;
    }
    return v;
  };
  return rensa(json);
}

function sparaFixtur(namn: string, inspelning: Inspelning): void {
  mkdirSync(FIXTURER, { recursive: true });
  const fil = join(FIXTURER, namn);
  const innehall = { status: inspelning.status, body: maskera(inspelning.kropp) };
  writeFileSync(fil, JSON.stringify(innehall, null, 2) + "\n");
  console.log(`  sparad: fixtures/booli-api/${namn}`);
}

// ---------------------------------------------------------------------------
// Finding listings
// ---------------------------------------------------------------------------

function idn(data: unknown, samling: "listings" | "sold", antal: number): string[] {
  const lista =
    typeof data === "object" && data !== null ? (data as Record<string, unknown>)[samling] : null;
  if (!Array.isArray(lista)) return [];
  return lista
    .map((o) => (typeof o === "object" && o !== null ? (o as { booliId?: unknown }).booliId : null))
    .filter((id): id is number => typeof id === "number")
    .slice(0, antal)
    .map(String);
}

async function sok(
  samling: "listings" | "sold",
  parametrar: Record<string, string>,
  antal: number,
): Promise<string[]> {
  const svar = await anropaBooliApi(samling, parametrar, nycklar, { fetch: raknandeFetch });
  if (svar.typ === "fel") {
    console.error(`  sökning ${samling} ${parametrar.q}: ${svar.kod} (${svar.orsak})`);
    return [];
  }
  return idn(svar.data, samling, antal);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Rad {
  id: string;
  forvantat: "aktiv" | "såld";
  resultat: string;
  anrop: number;
  hittade: string[];
  saknade: string[];
}

async function main(): Promise<void> {
  const fall: { id: string; forvantat: "aktiv" | "såld" }[] = [];
  for (const { q, antal } of AKTIVA_OMRADEN) {
    for (const id of await sok(
      "listings",
      { q, limit: String(antal), objectType: "lägenhet" },
      antal,
    )) {
      fall.push({ id, forvantat: "aktiv" });
    }
  }
  const fran = new Date(Date.now() - SALDA.dagarTillbaka * 86_400_000).toISOString().slice(0, 10);
  for (const id of await sok(
    "sold",
    { q: SALDA.q, limit: String(SALDA.antal), minSoldDate: fran, objectType: "lägenhet" },
    SALDA.antal,
  )) {
    fall.push({ id, forvantat: "såld" });
  }
  console.log(`Sökningar: ${antalAnrop()} anrop, ${fall.length} annonser.\n`);

  const rader: Rad[] = [];
  for (const { id, forvantat } of fall) {
    const fore = antalAnrop();
    const utfall = await hamtaFranBooliApi(id, nycklar, { fetch: raknandeFetch });
    const egna = inspelningar.slice(fore);
    console.log(`annons/${id} (${forvantat})`);
    if (utfall.typ === "fel") {
      console.log(`  FEL ${utfall.kod}: ${utfall.orsak}`);
      rader.push({
        id,
        forvantat,
        resultat: `fel ${utfall.kod}`,
        anrop: egna.length,
        hittade: [],
        saknade: [],
      });
      continue;
    }
    const u = utfall.uppgifter;
    for (const falt of ANNONS_FALT) {
      const v = u[falt];
      console.log(`  ${falt.padEnd(13)} ${v === undefined ? "— saknas" : JSON.stringify(v)}`);
    }
    console.log(
      `  ${"stadsdel".padEnd(13)} ${u.stadsdel ?? "—"}   koordinater ${u.koordinater ? "ja" : "nej"}   samling ${utfall.samling}` +
        (utfall.postnummerOrsak ? `   postnummer: ${utfall.postnummerOrsak}` : ""),
    );
    rader.push({
      id,
      forvantat,
      resultat: `ok (${utfall.samling})`,
      anrop: egna.length,
      hittade: ANNONS_FALT.filter((f) => u[f] !== undefined),
      saknade: ANNONS_FALT.filter((f) => u[f] === undefined),
    });
    if (SPARA) {
      for (const ins of egna) {
        const [slutpunkt] = ins.sokvag.split("/");
        sparaFixtur(`${slutpunkt}-${id}.json`, ins);
      }
    }
  }

  console.log("\nSammanfattning");
  console.log("id        | väntat | resultat        | anrop | saknas");
  for (const r of rader) {
    console.log(
      `${r.id.padEnd(9)} | ${r.forvantat.padEnd(6)} | ${r.resultat.padEnd(15)} | ${String(r.anrop).padEnd(5)} | ${r.saknade.join(", ") || "—"}`,
    );
  }
  console.log(`\nTotalt ${antalAnrop()} API-anrop.`);
}

main().catch((fel: unknown) => {
  const text = fel instanceof Error ? fel.message : String(fel);
  console.error(
    "Oväntat fel:",
    text.split(nycklar.callerId).join("<CALLER_ID>").split(nycklar.privateKey).join("<KEY>"),
  );
  process.exit(1);
});
