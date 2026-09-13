/**
 * Bundlar `src/server/steg.ts` (edge-funktionens jobbtick-entrypoint) till en
 * enda ESM-fil `supabase/functions/analys-steg/_bundle/steg.js`, avsedd att
 * köras av Supabase Edge Functions runtime — Deno via `supabase-edge-runtime`.
 *
 * Två paket lämnas MEDVETET obundlade och skrivs om till `npm:`-specifiers:
 * `@anthropic-ai/sdk` och `unpdf`. En tidigare spik (se SUPABASE.md) visade
 * att just de två paketen löser sig korrekt under Deno via dess egna
 * npm-kompatibilitetslager när de importeras som `npm:paket@version` —
 * ospikat (`npm:unpdf` utan version) skulle låta Deno själv välja version vid
 * varje deploy, vilket i praktiken gör paketversionen okontrollerad. Därför
 * läses den faktiskt installerade versionen (från `package-lock.json`, den
 * enda källan som har den EXAKTA upplösta versionen — `package.json` har bara
 * ett semver-intervall) och skrivs in explicit i importsökvägen.
 *
 * `@supabase/supabase-js` bundlas normalt (den är ren `fetch`-baserad, inga
 * Node-API:er) — inte täckt av spiken, men `steg.ts` importerar den inte ändå
 * (produktionens `Databas`/`Filarkiv` injiceras via `Lager`, se `./portar`),
 * så den är inte del av bundlens beroendegraf i dagsläget. Se testfilen för
 * ett säkerhetsnät som skulle upptäcka det tidigt om det ändrar sig.
 */

import * as esbuild from "esbuild";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface ByggEdgeBundleOptions {
  /** Absolut eller cwd-relativ entrypoint. Förval: "src/server/steg.ts". */
  entryPoint?: string;
  /** Sant (förvalet vid körning som skript) skriver till
   *  supabase/functions/analys-steg/_bundle/steg.js. Falskt returnerar den
   *  bundlade koden som en sträng utan att röra filsystemet — det testerna
   *  använder för att hållas snabba och filsystem-rena. */
  write?: boolean;
  outfile?: string;
}

export interface ByggEdgeBundleResultat {
  /** Den bundlade utdatan, alltid ifylld oavsett `write`. */
  code: string;
  /** Ifylld bara när `write` var sant. */
  outfile?: string;
}

const DEFAULT_ENTRY_POINT_REL = "src/server/steg.ts";
const DEFAULT_OUTFILE_REL = "supabase/functions/analys-steg/_bundle/steg.js";
const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

/** Paket som Deno löser via sitt eget npm-kompatibilitetslager (se
 *  filkommentaren) — dessa hålls externa och skrivs om till en pinnad
 *  `npm:paket@version`-specifier i stället för att bundlas. */
const DENO_NATIVA_PAKET = ["@anthropic-ai/sdk", "unpdf"] as const;
const DENO_NPM_SPECIFIER_FILTER = /^(@anthropic-ai\/sdk|unpdf)(\/.*)?$/;

/**
 * Läser den faktiskt installerade (upplösta) versionen av `paket` ur
 * `package-lock.json` — till skillnad från `package.json`, som bara har ett
 * semver-intervall (t.ex. "^0.125.0"), har låsfilen den exakta versionen som
 * verkligen ligger i `node_modules` just nu.
 */
function lasInstalleradVersion(repoRoot: string, paket: string): string {
  const lockPath = path.resolve(repoRoot, "package-lock.json");
  const lock = JSON.parse(readFileSync(lockPath, "utf-8")) as {
    packages?: Record<string, { version?: string }>;
  };
  const version = lock.packages?.[`node_modules/${paket}`]?.version;
  if (!version) {
    throw new Error(
      `Kunde inte hitta en installerad version av "${paket}" i package-lock.json — ` +
        "är paketet verkligen en dependency i package.json och har `npm install` körts?",
    );
  }
  return version;
}

/**
 * Skriver om importer av `DENO_NATIVA_PAKET` till en pinnad `npm:`-specifier
 * OCH markerar dem externa i samma steg — esbuild bundlar då aldrig deras
 * innehåll, och lämnar kvar ett importstatement i utdatan som Deno löser
 * själv vid körning.
 */
function denoNpmSpecifierPlugin(pinnedVersions: Readonly<Record<string, string>>): esbuild.Plugin {
  return {
    name: "deno-npm-specifier",
    setup(build) {
      build.onResolve({ filter: DENO_NPM_SPECIFIER_FILTER }, (args) => {
        const match = DENO_NPM_SPECIFIER_FILTER.exec(args.path);
        const paket = match?.[1];
        if (!paket) return null;
        const version = pinnedVersions[paket];
        if (!version) return null;
        const resten = args.path.slice(paket.length); // "" eller "/undersökväg"
        return { path: `npm:${paket}@${version}${resten}`, external: true };
      });
    },
  };
}

/**
 * Löser `"@/..."`-importer mot `src/` — samma alias som `tsconfig.json`
 * (`paths: { "@/*": ["./src/*"] }`) och `vitest.config.ts` definierar, men
 * esbuilds inbyggda `alias`-option stödjer bara exakt paketnamn-ersättning,
 * inte katalogprefix som `"@/"` → `src/`. Därför en liten `onResolve`-plugin
 * i stället, som själv gör extensionsupplösningen TypeScript annars sköter
 * (importerna i den här kodbasen är alltid extensionlösa, t.ex.
 * `"@/server/portar"` eller `"@/lib/analysis/schema"`).
 */
function aliasPlugin(srcDir: string): esbuild.Plugin {
  return {
    name: "at-alias",
    setup(build) {
      build.onResolve({ filter: /^@\// }, (args) => {
        const utanPrefix = args.path.slice(2); // ta bort "@/"
        const absolutSokvag = path.resolve(srcDir, utanPrefix);
        return { path: losAliasSokvag(absolutSokvag) };
      });
    },
  };
}

function losAliasSokvag(absolutSokvagUtanExtension: string): string {
  if (existsSync(absolutSokvagUtanExtension)) {
    return absolutSokvagUtanExtension;
  }
  for (const ext of RESOLVE_EXTENSIONS) {
    const kandidat = absolutSokvagUtanExtension + ext;
    if (existsSync(kandidat)) return kandidat;
  }
  for (const ext of RESOLVE_EXTENSIONS) {
    const kandidat = path.join(absolutSokvagUtanExtension, `index${ext}`);
    if (existsSync(kandidat)) return kandidat;
  }
  throw new Error(
    `Kunde inte matcha alias-importen "${absolutSokvagUtanExtension}" mot en fil under src/.`,
  );
}

export async function byggEdgeBundle(
  options?: ByggEdgeBundleOptions,
): Promise<ByggEdgeBundleResultat> {
  const repoRoot = process.cwd();
  const entryPoint = path.resolve(repoRoot, options?.entryPoint ?? DEFAULT_ENTRY_POINT_REL);
  const srcDir = path.resolve(repoRoot, "src");

  const pinnedVersions: Record<string, string> = {};
  for (const paket of DENO_NATIVA_PAKET) {
    pinnedVersions[paket] = lasInstalleradVersion(repoRoot, paket);
  }

  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    plugins: [aliasPlugin(srcDir), denoNpmSpecifierPlugin(pinnedVersions)],
    logLevel: "silent",
  });

  const outputFile = result.outputFiles[0];
  if (!outputFile) {
    throw new Error("esbuild producerade ingen utdatafil för edge-bundlen.");
  }
  const code = outputFile.text;

  const skaSkriva = options?.write ?? true;
  if (!skaSkriva) {
    return { code };
  }

  const outfile = path.resolve(repoRoot, options?.outfile ?? DEFAULT_OUTFILE_REL);
  await mkdir(path.dirname(outfile), { recursive: true });
  await writeFile(outfile, code, "utf-8");
  return { code, outfile };
}

const korsSomSkript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (korsSomSkript) {
  byggEdgeBundle({ write: true })
    .then((resultat) => {
      console.log(
        `Bundlade edge-funktionen till ${resultat.outfile} (${resultat.code.length} tecken).`,
      );
    })
    .catch((error: unknown) => {
      console.error("Bundling av edge-funktionen misslyckades:", error);
      process.exitCode = 1;
    });
}
