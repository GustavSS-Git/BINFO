import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { byggEdgeBundle } from "./build";

/** Den enda källan med den EXAKT upplösta versionen — `package.json` har
 *  bara ett semver-intervall (`^0.125.0` / `^1.8.1`), medan `package-lock.json`
 *  säger vad som verkligen ligger i `node_modules` just nu. Testet läser
 *  samma källa som `build.ts` gör, så det inte kan råka hårdkoda en gissning
 *  som glider isär från vad som faktiskt är installerat. */
function installeradVersion(paket: string): string {
  const lockPath = path.resolve(process.cwd(), "package-lock.json");
  const lock = JSON.parse(readFileSync(lockPath, "utf-8")) as {
    packages?: Record<string, { version?: string }>;
  };
  const version = lock.packages?.[`node_modules/${paket}`]?.version;
  if (!version) throw new Error(`Saknar en installerad version av "${paket}" i låsfilen.`);
  return version;
}

const ANTHROPIC_VERSION = installeradVersion("@anthropic-ai/sdk");
const UNPDF_VERSION = installeradVersion("unpdf");
const PDF_LIB_VERSION = installeradVersion("pdf-lib");

describe("byggEdgeBundle", () => {
  it("lyckas och producerar icke-tom kod utan att röra filsystemet", async () => {
    const { code, outfile } = await byggEdgeBundle({ write: false });
    expect(code.length).toBeGreaterThan(0);
    expect(outfile).toBeUndefined();
  });

  it("skriver om @anthropic-ai/sdk till en pinnad npm:-specifier", async () => {
    const { code } = await byggEdgeBundle({ write: false });
    // Kräver att specifieren faktiskt dyker upp i ett importstatement
    // (`from "npm:..."`), inte bara att strängen finns någonstans i filen.
    const forvantad = new RegExp(`from\\s*"npm:@anthropic-ai/sdk@${ANTHROPIC_VERSION}"`);
    expect(code).toMatch(forvantad);
  });

  it("skriver om unpdf till en pinnad npm:-specifier", async () => {
    const { code } = await byggEdgeBundle({ write: false });
    const forvantad = new RegExp(`from\\s*"npm:unpdf@${UNPDF_VERSION}"`);
    expect(code).toMatch(forvantad);
  });

  it("skriver om pdf-lib till en pinnad npm:-specifier (identitetssteget, v2)", async () => {
    const { code } = await byggEdgeBundle({ write: false });
    const forvantad = new RegExp(`from\\s*"npm:pdf-lib@${PDF_LIB_VERSION.replace(/\./g, "\\.")}"`);
    expect(code).toMatch(forvantad);
    // Aldrig inbundlad: pdf-lib:s egna källfiler får inte finnas i bundlen.
    expect(code).not.toMatch(/node_modules\/pdf-lib/);
  });

  it("bundlar registret och registrets kö (claim_next_rapport_steg via Lager)", async () => {
    const { code } = await byggEdgeBundle({ write: false });
    expect(code).toContain("klaimaNastaRapportSteg");
    expect(code).toContain("PIPELINE_VERSION");
  });

  it("bundlar transkriberingssteget (WS1) och håller pdf-lib extern även på skannvägen", async () => {
    const { code } = await byggEdgeBundle({ write: false });
    // The stage and its prompt/marker contract are in the bundle ...
    expect(code).toContain("transkribera");
    expect(code).toContain("=== SIDA");
    expect(code).toContain("hamtaSidtext");
    expect(code).toContain("sparaSidtext");
    // ... pdf-lib is imported (to split chunks) only through the pinned npm: specifier,
    // never inlined ...
    const pdfLibImporter = code.match(/from\s*"npm:pdf-lib@[^"]+"/g) ?? [];
    expect(pdfLibImporter.length).toBeGreaterThan(0);
    expect(new Set(pdfLibImporter).size).toBe(1);
    expect(code).not.toMatch(/PDFDocument\s*=\s*class|class\s+PDFDocument/);
  });

  it("skannvägen använder inget Node-specifikt: ingen Buffer, process eller fs i bundlen", async () => {
    const { code } = await byggEdgeBundle({ write: false });
    expect(code).not.toMatch(/\bBuffer\b/);
    expect(code).not.toMatch(/\bprocess\.(env|cwd|argv)\b/);
    expect(code).not.toMatch(/readFileSync|writeFileSync|node:fs/);
  });

  it("innehåller aldrig en node:-importspecifier", async () => {
    const { code } = await byggEdgeBundle({ write: false });
    // Matchar en citerad specifier ("node:fs" / 'node:crypto'), inte bara
    // den bara substrängen "node:" — filen innehåller legitimt en KOMMENTAR
    // som nämner "node:crypto" i löpande text (se assemble.ts), vilket inte
    // är en importläcka och inte ska fälla testet.
    expect(code).not.toMatch(/["']node:/);
  });

  it("innehåller aldrig ett bart require(-anrop", async () => {
    const { code } = await byggEdgeBundle({ write: false });
    expect(code).not.toMatch(/\brequire\(/);
  });

  it("exporterar korNastaSteg som en riktig ESM-export", async () => {
    const { code } = await byggEdgeBundle({ write: false });
    // Kräver att namnet står i en export-sats (export { ... korNastaSteg ... })
    // eller direkt på en export-deklaration (export async function
    // korNastaSteg / export { korNastaSteg as ... }) — inte bara att
    // substrängen "korNastaSteg" förekommer någonstans (den gör den även som
    // ett internt funktionsnamn, en referens i en switch, etc.).
    expect(code).toMatch(/export\s*\{\s*korNastaSteg\s*(as\s+\w+\s*)?,?\s*\}/);
  });

  it('löser en alias-import mot en katalogs index-fil (t.ex. "@/lib/vardering"), inte katalogen själv', async () => {
    // Regressionstest: aliasPlugins losAliasSokvag accepterade tidigare den
    // BARA katalogsökvägen (existsSync är sant även för kataloger), vilket
    // fick esbuild att kasta "is a directory" i stället för att falla
    // igenom till index.ts-kontrollen. src/lib/analysis/prisdata.ts (task
    // 4g) importerar numera "@/lib/vardering" (en katalog med index.ts, inte
    // en fil med det namnet) rakt av, vilket triggar exakt den vägen — den
    // här testet isolerar den, utan att bero på att steg.ts råkar ha den
    // importen i sin beroendegraf.
    const tmpRoot = path.join(os.tmpdir(), `binfo-edge-build-alias-dir-test-${process.pid}`);
    const tmpEntry = path.join(tmpRoot, "entry.ts");
    await mkdir(tmpRoot, { recursive: true });
    await writeFile(tmpEntry, 'export { vardera } from "@/lib/vardering";\n', "utf-8");
    try {
      const { code } = await byggEdgeBundle({ write: false, entryPoint: tmpEntry });
      expect(code.length).toBeGreaterThan(0);
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("bundlar @supabase/supabase-js snarare än att lämna den som en import — säkerhetsnät", async () => {
    // steg.ts importerar inte src/server/supabase.ts (den riktiga
    // Databas/Filarkiv-implementationen injiceras via Lager, se portar.ts),
    // så @supabase/supabase-js är i dagsläget inte alls med i den här
    // bundlens beroendegraf. Det gör den här assertionen mest ett
    // dokumenterande säkerhetsnät: skulle paketet någon gång dras in
    // transitivt och misslyckas bundla rent, skulle `byggEdgeBundle`-anropet
    // självt kasta (esbuild) INNAN detta ens hinner köra — så den riktiga
    // detekteringen är att testsviten över huvud taget failar, inte den här
    // specifika expect-satsen.
    const { code } = await byggEdgeBundle({ write: false });
    expect(code).not.toContain("@supabase/supabase-js");
  });

  describe("write: true", () => {
    const tmpRoot = path.join(os.tmpdir(), `binfo-edge-build-test-${process.pid}`);
    const tmpOutfile = path.join(tmpRoot, "steg.js");

    afterEach(async () => {
      await rm(tmpRoot, { recursive: true, force: true });
    });

    it("skriver bundlen till disk på angiven outfile", async () => {
      const { code, outfile } = await byggEdgeBundle({ write: true, outfile: tmpOutfile });

      expect(outfile).toBe(tmpOutfile);
      expect(existsSync(tmpOutfile)).toBe(true);

      const paDisk = await readFile(tmpOutfile, "utf-8");
      expect(paDisk).toBe(code);
      expect(paDisk.length).toBeGreaterThan(0);
    });
  });
});

describe("Edge-limmet speglar porten", () => {
  const limmet = readFileSync(
    path.resolve(process.cwd(), "supabase/functions/analys-steg/index.ts"),
    "utf-8",
  );
  const portar = readFileSync(path.resolve(process.cwd(), "src/server/portar.ts"), "utf-8");

  /** Methods of `interface Databas`, by name. */
  function databasMetoder(): string[] {
    const start = portar.indexOf("export interface Databas {");
    const slut = portar.indexOf("\n}\n", start);
    const kropp = portar.slice(start, slut);
    return [...kropp.matchAll(/^ {2}(\w+)\(/gm)].map((m) => m[1] as string);
  }

  // Used by the upload/read paths (skapaAnalys' up-front cap check among them),
  // never by the tick (see the comment in index.ts).
  const MEDVETET_UTELAMNADE = new Set(["skapaAnalys", "hamtaAnalys", "hamtaSpendForDag"]);

  it("implementerar varje Databas-metod utom de som bara uppladdnings-/läs-/raderingsvägarna använder", () => {
    const metoder = databasMetoder();
    expect(metoder.length).toBeGreaterThan(20);
    for (const metod of metoder) {
      if (MEDVETET_UTELAMNADE.has(metod)) continue;
      expect(limmet, `Edge-limmet saknar ${metod}`).toMatch(new RegExp(`async ${metod}\\(`));
    }
  });

  it("sidtext: samma tabell, kolumner och upsert-nyckel som src/server/supabase.ts", () => {
    const adapter = readFileSync(path.resolve(process.cwd(), "src/server/supabase.ts"), "utf-8");
    for (const kalla of [limmet, adapter]) {
      expect(kalla).toContain('.from("sidtext")');
      expect(kalla).toContain('.select("sida, text").eq("rapport_id", rapportId)');
      expect(kalla).toContain('q = q.eq("kalla", kalla)');
      expect(kalla).toContain('onConflict: "rapport_id,sida"');
      expect(kalla).toMatch(/rapport_id: rapportId, sida: \w+\.sida, text: \w+\.text, kalla/);
    }
  });

  it("reinvoke går via PROJECT_URL + /functions/v1/analys-steg (reinvoke.ts), aldrig via req.url — verifierat lokalt: req.url är den interna adressen och vägras", () => {
    expect(limmet).toContain('import { byggReinvokeUrl } from "./reinvoke.ts"');
    expect(limmet).toContain('byggReinvokeUrl(kravMiljovariabel("PROJECT_URL"))');
    const utanKommentarer = limmet
      .split("\n")
      .filter((rad) => !rad.trim().startsWith("//"))
      .join("\n");
    expect(utanKommentarer).not.toMatch(/fetch\(\s*req\.url/);
  });
});
