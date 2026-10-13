/**
 * Builds src/lib/register/data/postnummerStadsdel.data.ts, the compact lookup
 * the BRF register uses to place a postnummer (and a stadsdel name) in one of
 * the 19 register areas. Run with `npm run build:register-data` (script entry
 * to be added by the supervisor: `tsx scripts/buildRegisterData.ts`).
 * Re-running must be byte-identical (checked by src/lib/register/dataSync.test.ts,
 * which imports the pure build function below).
 *
 * Sources (read-only):
 *   - ml/mapping/registeromraden.csv           19 areas (slug, namn, grupp, ordning)
 *   - ml/mapping/stadsdel_registeromrade.csv   117 SBK stadsdelar -> area
 *   - data/derived/postnummer_stadsdel.csv     postnummer -> area (ml/mapping/build_postnummer_stadsdel.py)
 *   - data/derived/postnummer_stockholm_ovriga.csv  Stockholms kommun postnummer without a stadsdel
 *
 * Rules:
 *   - postnummer flagged `kommun_avviker_*` (postnummer_kommun.csv places them in
 *     another kommun) are NOT shipped: they resolve to "unknown".
 *   - `osakra`: postnummer whose area is a weak call (flag `grans` or
 *     `granne_konflikt`); still resolved, but marked.
 *   - `ovriga`: only postnummer without any kommun flag (flaggor empty), i.e. not the
 *     approximate-coordinate or weak-evidence ones.
 * No raw transaction rows, no OSM points: only per-postnummer area indexes.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { kodaLopare, kodaPostnummerLista } from "../src/lib/register/kodning";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "src", "lib", "register", "data");
const OUT_FILE = "postnummerStadsdel.data.ts";

export interface RegisterData {
  /** Area slugs in `ordning` order; every index below refers to this list. */
  omraden: string[];
  /** SBK stadsdel name (upper case, as in the polygon file) -> area index. */
  stadsdelar: Record<string, number>;
  /** Delta-coded ascending postnummer list (kodning.ts). */
  postnummer: string;
  /** Run-length coded area index per postnummer, same order as `postnummer`. */
  omradeIdx: string;
  /** Delta-coded: postnummer in `postnummer` whose area is a weak call. */
  osakra: string;
  /** Delta-coded: Stockholms kommun postnummer without a stadsdel ("Övriga Stockholm"). */
  ovriga: string;
}

function rows(csvText: string, name: string, header: string): string[][] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.length > 0);
  if (!lines[0] || !lines[0].startsWith(header)) {
    throw new Error(`Register data build: unexpected ${name} header "${lines[0] ?? ""}"`);
  }
  // None of the columns read below can contain a comma or a quote; trailing
  // free-text columns may, so only the first `n` fields are ever split off.
  return lines.slice(1).map((l) => l.split(","));
}

export function buildRegisterData(inputs: {
  omradenCsv: string;
  stadsdelCsv: string;
  postnummerCsv: string;
  ovrigaCsv: string;
}): RegisterData {
  const omradeRows = rows(inputs.omradenCsv, "registeromraden.csv", "slug,namn,grupp,ordning,");
  const omraden = omradeRows
    .map((r) => ({ slug: r[0] as string, ordning: Number(r[3]) }))
    .sort((a, b) => a.ordning - b.ordning)
    .map((r) => r.slug);
  const idxOf = new Map(omraden.map((s, i) => [s, i]));
  if (omraden.length !== 19 || idxOf.size !== 19) {
    throw new Error(`Register data build: expected 19 distinct areas, got ${omraden.length}`);
  }

  const stadsdelar: Record<string, number> = {};
  for (const r of rows(
    inputs.stadsdelCsv,
    "stadsdel_registeromrade.csv",
    "stadsdel,registeromrade,slug,",
  )) {
    const [stadsdel, , slug] = r;
    const idx = idxOf.get(slug ?? "");
    if (!stadsdel || idx === undefined)
      throw new Error(`Register data build: bad stadsdel row ${r.slice(0, 3).join(",")}`);
    if (stadsdel in stadsdelar)
      throw new Error(`Register data build: duplicate stadsdel ${stadsdel}`);
    stadsdelar[stadsdel] = idx;
  }
  if (Object.keys(stadsdelar).length !== 117) {
    throw new Error(
      `Register data build: expected 117 stadsdelar, got ${Object.keys(stadsdelar).length}`,
    );
  }

  // postnummer,stadsdel,share,n_points,method,registeromrade,registeromrade_share,flagga
  const pn: { postnummer: string; idx: number; osaker: boolean }[] = [];
  for (const r of rows(
    inputs.postnummerCsv,
    "postnummer_stadsdel.csv",
    "postnummer,stadsdel,share,n_points,method,",
  )) {
    const [postnummer, , , , , slug, , flagga = ""] = r;
    const idx = idxOf.get(slug ?? "");
    if (!postnummer || !/^\d{5}$/.test(postnummer) || idx === undefined) {
      throw new Error(`Register data build: bad postnummer row ${r.join(",")}`);
    }
    const flaggor = flagga.split(";").filter(Boolean);
    if (flaggor.some((f) => f.startsWith("kommun_avviker_"))) continue;
    pn.push({
      postnummer,
      idx,
      osaker: flaggor.includes("grans") || flaggor.includes("granne_konflikt"),
    });
  }
  pn.sort((a, b) => Number(a.postnummer) - Number(b.postnummer));

  // postnummer,kommun_metod,flaggor
  const ovriga: string[] = [];
  const shipped = new Set(pn.map((p) => p.postnummer));
  for (const r of rows(
    inputs.ovrigaCsv,
    "postnummer_stockholm_ovriga.csv",
    "postnummer,kommun_metod,flaggor",
  )) {
    const [postnummer, , flaggor = ""] = r;
    if (!postnummer || !/^\d{5}$/.test(postnummer))
      throw new Error(`Register data build: bad ovriga row ${r.join(",")}`);
    if (flaggor !== "") continue;
    if (shipped.has(postnummer))
      throw new Error(`Register data build: ${postnummer} is both mapped and "ovriga"`);
    ovriga.push(postnummer);
  }

  return {
    omraden,
    stadsdelar,
    postnummer: kodaPostnummerLista(pn.map((p) => p.postnummer)),
    omradeIdx: kodaLopare(pn.map((p) => p.idx)),
    osakra: kodaPostnummerLista(pn.filter((p) => p.osaker).map((p) => p.postnummer)),
    ovriga: kodaPostnummerLista(ovriga),
  };
}

export function renderRegisterData(data: RegisterData): string {
  return (
    `/* eslint-disable */\n` +
    `// AUTO-GENERATED by scripts/buildRegisterData.ts — do not edit by hand.\n` +
    `// Run \`npm run build:register-data\` to regenerate.\n` +
    `// Source: data/derived/postnummer_stadsdel.csv + postnummer_stockholm_ovriga.csv + ml/mapping/stadsdel_registeromrade.csv. Area indexes refer to \`omraden\`; postnummer lists are delta-coded base 36 (kodning.ts).\n` +
    `const data = ${JSON.stringify(data)};\n\n` +
    `export default data;\n`
  );
}

export function readRegisterInputs() {
  const read = (...s: string[]) => readFileSync(path.join(ROOT, ...s), "utf-8");
  return {
    omradenCsv: read("ml", "mapping", "registeromraden.csv"),
    stadsdelCsv: read("ml", "mapping", "stadsdel_registeromrade.csv"),
    postnummerCsv: read("data", "derived", "postnummer_stadsdel.csv"),
    ovrigaCsv: read("data", "derived", "postnummer_stockholm_ovriga.csv"),
  };
}

function main(): void {
  const data = buildRegisterData(readRegisterInputs());
  mkdirSync(OUT_DIR, { recursive: true });
  const content = renderRegisterData(data);
  writeFileSync(path.join(OUT_DIR, OUT_FILE), content, "utf-8");
  const raw = Buffer.from(content, "utf-8");
  console.log(
    `${OUT_FILE}: raw ${raw.length} B, gz ${gzipSync(raw).length} B; ` +
      `${data.postnummer.split(",").length} postnummer, ${data.ovriga ? data.ovriga.split(",").length : 0} ovriga, ` +
      `${data.osakra ? data.osakra.split(",").length : 0} osakra`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
