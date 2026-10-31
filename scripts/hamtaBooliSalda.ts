/**
 * Downloads sold flats from the Booli REST API to a CSV, for analysis and
 * possible future model work (docs/research/booli-sold.md). Not used by the app.
 *
 *   node --env-file=.env.local --import tsx scripts/hamtaBooliSalda.ts [fran] [till] [areaId]
 *
 * Defaults: 2026-01-01 → today, areaId 2 (Stockholms län; 1 = Stockholms
 * kommun), objectType Lägenhet. Writes data/raw/booli/ (gitignored: Booli's
 * terms for keeping/redistributing the data are not confirmed in writing):
 *   salda_<areaId>_<fran>_<till>.csv    one row per sale, UTF-8 with BOM, comma-separated
 *   salda_<areaId>_<fran>_<till>.jsonl  the raw sold objects, for fields not in the CSV
 *
 * No offset paging (unstable on ties in soldDate): the date range is cut into
 * windows that each hold ≤ 1 000 sales (`limit` max), halving any window that
 * holds more. ≈ 1 call per week of sales in the län. The keys are never
 * printed or written; Booli's `estimate` is never kept.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { anropaBooliApi, type BooliApiNycklar } from "../src/server/annons/booliApi";

const GRANS = 1000;
const [franArg, tillArg, omradeArg] = process.argv.slice(2);
const idag = new Date().toISOString().slice(0, 10);
const FRAN = franArg ?? "2026-01-01";
const TILL = tillArg ?? idag;
const AREA_ID = omradeArg ?? "2";

const callerId = process.env.BOOLI_CALLER_ID?.trim();
const privateKey = process.env.BOOLI_PRIVATE_KEY?.trim();
if (!callerId || !privateKey) {
  console.error("BOOLI_CALLER_ID och BOOLI_PRIVATE_KEY saknas (kör med --env-file=.env.local).");
  process.exit(2);
}
const nycklar: BooliApiNycklar = { callerId, privateKey };

type Rad = Record<string, unknown>;
let anrop = 0;

function dag(d: string): number {
  return Date.parse(`${d}T00:00:00Z`) / 86_400_000;
}
function datum(n: number): string {
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}

async function hamtaFonster(fran: string, till: string): Promise<{ total: number; rader: Rad[] }> {
  anrop += 1;
  const svar = await anropaBooliApi(
    "sold",
    {
      areaId: AREA_ID,
      objectType: "Lägenhet",
      minSoldDate: fran.replaceAll("-", ""),
      maxSoldDate: till.replaceAll("-", ""),
      sort: "soldDate",
      direction: "asc",
      limit: String(GRANS),
    },
    nycklar,
    { tidsgransMs: 30_000 },
  );
  if (svar.typ === "fel") throw new Error(`${fran}–${till}: ${svar.kod} (${svar.orsak})`);
  const data = svar.data as { totalCount?: unknown; sold?: unknown };
  const rader = Array.isArray(data.sold) ? (data.sold as Rad[]) : [];
  const total = typeof data.totalCount === "number" ? data.totalCount : rader.length;
  return { total, rader };
}

/** All sales in [fran, till], halving windows over the limit. */
async function hamtaIntervall(fran: string, till: string, ut: Rad[]): Promise<void> {
  const { total, rader } = await hamtaFonster(fran, till);
  if (total <= GRANS) {
    if (rader.length !== total) {
      console.warn(`  varning ${fran}–${till}: totalCount ${total}, fick ${rader.length}`);
    }
    ut.push(...rader);
    console.log(`  ${fran} – ${till}: ${rader.length}`);
    return;
  }
  const a = dag(fran);
  const b = dag(till);
  if (a === b) {
    // One day with more than 1 000 sales: cannot split further without offset.
    console.warn(`  varning ${fran}: ${total} försäljningar på en dag, sparar ${rader.length}`);
    ut.push(...rader);
    return;
  }
  const mitt = Math.floor((a + b) / 2);
  await hamtaIntervall(fran, datum(mitt), ut);
  await hamtaIntervall(datum(mitt + 1), till, ut);
}

function hamta(o: unknown, sokvag: string): unknown {
  let v: unknown = o;
  for (const k of sokvag.split(".")) {
    if (typeof v !== "object" || v === null) return undefined;
    v = (v as Record<string, unknown>)[k];
  }
  return v;
}

/** CSV column → path in the sold object (Booli's own names, flattened). */
const KOLUMNER: readonly [string, string | ((r: Rad) => unknown)][] = [
  ["booliId", "booliId"],
  ["soldDate", "soldDate"],
  ["soldPrice", "soldPrice"],
  ["soldPriceSource", "soldPriceSource"],
  ["listPrice", "listPrice"],
  ["firstPrice", "firstPrice"],
  [
    "soldPricePerM2",
    (r) => {
      const p = r["soldPrice"];
      const a = r["livingArea"];
      return typeof p === "number" && typeof a === "number" && a > 0 ? Math.round(p / a) : "";
    },
  ],
  ["published", "published"],
  ["livingArea", "livingArea"],
  ["additionalArea", "additionalArea"],
  ["rooms", "rooms"],
  ["rent", "rent"],
  ["floor", "floor"],
  ["apartmentNumber", "apartmentNumber"],
  ["constructionYear", "constructionYear"],
  ["buildingHasElevator", "buildingHasElevator"],
  ["hasBalcony", "hasBalcony"],
  ["hasPatio", "hasPatio"],
  ["hasFireplace", "hasFireplace"],
  ["heating", "heating"],
  ["isNewConstruction", "isNewConstruction"],
  ["objectType", "objectType"],
  ["streetAddress", "location.address.streetAddress"],
  ["postCode", "location.address.postCode"],
  ["municipality", "location.region.municipalityName"],
  ["county", "location.region.countyName"],
  ["namedArea", (r) => (hamta(r, "location.namedAreas") as unknown[] | undefined)?.[0] ?? ""],
  ["latitude", "location.position.latitude"],
  ["longitude", "location.position.longitude"],
  ["positionIsApproximate", "location.position.isApproximate"],
  ["distanceOcean", "location.distance.ocean"],
  ["broker", "source.name"],
  ["url", "url"],
];

function cell(v: unknown): string {
  if (v === undefined || v === null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

async function main(): Promise<void> {
  console.log(`Booli sold, areaId ${AREA_ID}, Lägenhet, ${FRAN} – ${TILL}`);
  const alla: Rad[] = [];
  // Start with calendar months so each first call is already near the limit.
  let start = dag(FRAN);
  const slut = dag(TILL);
  while (start <= slut) {
    const d = new Date(start * 86_400_000);
    const manadSlut = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0) / 86_400_000;
    const stopp = Math.min(manadSlut, slut);
    await hamtaIntervall(datum(start), datum(stopp), alla);
    start = stopp + 1;
  }

  const unika = new Map<unknown, Rad>();
  for (const r of alla) {
    const { estimate: _bort, ...utan } = r;
    unika.set(r["booliId"], utan);
  }
  const rader = [...unika.values()].sort((a, b) =>
    String(a["soldDate"]).localeCompare(String(b["soldDate"])),
  );

  const mapp = join(process.cwd(), "data", "raw", "booli");
  mkdirSync(mapp, { recursive: true });
  const bas = `salda_${AREA_ID}_${FRAN}_${TILL}`;
  const csv = [
    KOLUMNER.map(([namn]) => namn).join(","),
    ...rader.map((r) =>
      KOLUMNER.map(([, k]) => cell(typeof k === "string" ? hamta(r, k) : k(r))).join(","),
    ),
  ].join("\n");
  writeFileSync(join(mapp, `${bas}.csv`), "﻿" + csv + "\n");
  writeFileSync(join(mapp, `${bas}.jsonl`), rader.map((r) => JSON.stringify(r)).join("\n") + "\n");

  console.log(
    `\n${rader.length} försäljningar (${alla.length - rader.length} dubbletter borttagna), ${anrop} anrop.`,
  );
  console.log(`→ data/raw/booli/${bas}.csv (+ .jsonl)`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
