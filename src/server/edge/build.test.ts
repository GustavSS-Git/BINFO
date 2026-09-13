import { readFile, rm } from "node:fs/promises";
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
