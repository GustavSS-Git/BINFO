import { readFile } from "node:fs/promises";
import { z } from "zod";
import { ExtractionValidationError, ModelTruncatedError } from "./extract";
import { KostnadsgransOverskriden } from "./costGuard";
import {
  ScannedPdfError,
  runGrounding,
  runStructuredExtraction,
  type ModelEffort,
} from "./runExtraction";
import { AnalysValidationError, runAnalys } from "./analyze";
// Never bundled for the client (this file is a Node CLI run via `tsx`, not
// part of the Vite/TanStack client graph) — importing STANDARD_EFFORT from
// src/server/ here is safe, and keeps this CLI's default in lockstep with
// production's (see env.ts's Env.effortGrounding doc comment) instead of
// letting the two silently drift apart.
import { STANDARD_EFFORT } from "@/server/env";
import { AssemblyValidationError, assembleraAnalys } from "./assemble";
import { PropertyInputSchema } from "./schema";
import { formatCallMetricsTable, totalCostSek, type ModelCallMetrics } from "./callMetrics";
import {
  DemoPrisdatakalla,
  ModellPrisdatakalla,
  TomPrisdatakalla,
  type Prisdatakalla,
} from "./prisdata";
import { SaknarRantekanslighetError } from "./calc/rantestress";
import type { PropertyInput } from "@/types/analysis";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local — fine if ANTHROPIC_API_KEY etc. are exported in the shell.
}

// .strict() med flit: ett okänt fält i objektsfilen är nästan alltid ett
// stavfel, och en tyst ignorering av det är dyr här — en körning kostar
// riktiga pengar mot Anthropic. Särskilt lätt att missa på de valfria
// fälten: "byggår" i stället för "byggar" skulle utan .strict() bara
// försvinna. Lånedata är sedan Fas 1 Steg 0 inte längre del av pipelinen och
// hör alltså inte hemma i filen alls.
const PropertyInputFileSchema = z
  .object({
    input: PropertyInputSchema,
  })
  .strict();

const GILTIGA_EFFORT: ModelEffort[] = ["low", "medium", "high", "xhigh", "max"];

/**
 * Reads a per-stage effort override for experimentation (task 1.2's effort
 * sweeps), falling back to a generic ANTHROPIC_EFFORT if the stage-specific
 * variable isn't set, and — as of task 1.6 — to STANDARD_EFFORT ("medium",
 * imported from src/server/env.ts) if neither is, exactly matching
 * production's default (see steg.ts / env.ts's Env.effortGrounding doc
 * comment). Before task 1.6 an unset var meant `undefined` (Sonnet 5's own
 * adaptive-thinking default); that made a plain `npm run extract` /
 * `npm run verify-extraction` run incomparable to a production run, since
 * production always sets an explicit effort. The env vars remain pure
 * overrides — set one to deliberately try a different depth. Not documented
 * in .env.example — these are dev-only knobs, not production configuration.
 */
function lasEffort(stageVar: string): ModelEffort {
  const rå = process.env[stageVar] || process.env["ANTHROPIC_EFFORT"];
  if (!rå) return STANDARD_EFFORT;
  if (!GILTIGA_EFFORT.includes(rå as ModelEffort)) {
    throw new Error(
      `${stageVar} (eller ANTHROPIC_EFFORT) måste vara en av ${GILTIGA_EFFORT.join(", ")}, fick "${rå}".`,
    );
  }
  return rå as ModelEffort;
}

class OgiltigInputfilError extends Error {
  constructor(zodError: z.ZodError) {
    const issues = zodError.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    super(`Objektsfilen matchar inte förväntat format: ${issues}`);
    this.name = "OgiltigInputfilError";
  }
}

/**
 * Which price source the CLI wires in. Default is ModellPrisdatakalla —
 * Binfos egen värderingsmodell (src/lib/vardering), same as production
 * (steg.ts/analys.ts). TomPrisdatakalla (no price data at all) and
 * DemoPrisdatakalla (valueless placeholder figures) stay selectable for
 * testing the price layer's other states. Chosen via PRISKALLA so nobody
 * has to edit code to switch. "schablon" is kept as a backward-compatible
 * alias for "modell" — PRISKALLA=schablon used to select the old flat
 * 80 000 kr/m² placeholder, now removed; it selects the real model instead.
 */
function valjPrisdatakalla(input: { utgangspris: number; boarea: number }): Prisdatakalla {
  const val = (process.env["PRISKALLA"] ?? "modell").toLowerCase();
  if (val === "tom") {
    return new TomPrisdatakalla();
  }
  if (val === "demo") {
    return new DemoPrisdatakalla(input);
  }
  return new ModellPrisdatakalla();
}

async function main() {
  const pdfPath = process.argv[2];
  const inputPath = process.argv[3];
  if (!pdfPath) {
    console.error(
      "Användning: npm run -s extract -- <sökväg-till-årsredovisning.pdf> [sökväg-till-objekt.json]\n\n" +
        "Notera -s (--silent): utan den skriver npm sin egen banner till stdout, " +
        "vilket gör utdatan ogiltig som JSON när den skickas vidare till en fil " +
        "eller till jq. Resultatet går till stdout, all loggning till stderr.\n\n" +
        "Utan objektsfil skrivs enbart pass 1:s ExtractionResult ut.\n" +
        'Med en objektsfil ({ "input": PropertyInput }) körs hela pipelinen (extraktion → analys → ' +
        "sammanställning) och ett fullständigt AnalysisResult skrivs ut. Filen får bara innehålla " +
        '"input" — okända fält avvisas, så ett stavfel tyst försvinner aldrig. Lånedata är inte ' +
        "längre del av pipelinen.\n\n" +
        "Miljövariabeln PRISKALLA styr prisdatakällan: 'modell' (förval, Binfos egen " +
        "värderingsmodell, se src/lib/vardering), 'tom' (ingen extern prisdata alls) eller " +
        "'demo' (platshållarfigurer utan värde, se prisdata.ts).",
    );
    process.exitCode = 1;
    return;
  }

  const model = process.env["ANTHROPIC_MODEL"] || "claude-sonnet-5";
  const maxCostSek = Number(process.env["MAX_COST_PER_ANALYSIS_SEK"] ?? "5");
  const effortGrounding = lasEffort("ANTHROPIC_EFFORT_GROUNDING");
  const effortExtraction = lasEffort("ANTHROPIC_EFFORT_EXTRACTION");
  const effortJudging = lasEffort("ANTHROPIC_EFFORT_JUDGING");

  const pdfBytes = new Uint8Array(await readFile(pdfPath));

  console.error(`Läser ${pdfPath} (modell: ${model}, kostnadstak: ${maxCostSek} kr)...`);

  const wallClockStart = performance.now();
  const allCalls: ModelCallMetrics[] = [];

  // Two calls, each with its own effort — mirrors production exactly
  // (steg.ts calls runGrounding/runStructuredExtraction separately, one per
  // Edge Function invocation). Before task 1.6 this CLI called the combined
  // `runExtraction` with a single effort for both stages, which is why a
  // local `npm run extract` run's timings weren't directly comparable to
  // production's per-stage numbers.
  const {
    groundingText,
    spentSek: spentGrounding,
    pdfSaknarTextlager,
    calls: groundingCalls,
  } = await runGrounding(pdfBytes, { model, maxCostSek, effort: effortGrounding });
  allCalls.push(...groundingCalls);

  console.error(`Grundning klar (${spentGrounding.toFixed(2)} kr). Kör extraktion...`);

  const {
    extraction,
    spentSek: spentStructured,
    calls: extraktionCalls,
  } = await runStructuredExtraction(groundingText, {
    model,
    maxCostSek: maxCostSek - spentGrounding,
    effort: effortExtraction,
    pdfSaknarTextlager,
  });
  allCalls.push(...extraktionCalls);
  const spentExtraktion = spentGrounding + spentStructured;

  if (!inputPath) {
    console.log(JSON.stringify(extraction, null, 2));
    console.error(formatCallMetricsTable(allCalls));
    console.error(
      `Klart (endast extraktion). Uppskattad kostnad: ${totalCostSek(allCalls).toFixed(2)} kr. ` +
        `Väggklocka: ${((performance.now() - wallClockStart) / 1000).toFixed(1)} s.`,
    );
    return;
  }

  console.error(
    `Extraktion klar (${spentExtraktion.toFixed(2)} kr). Kör analys och sammanställning...`,
  );

  const rawInputFile: unknown = JSON.parse(await readFile(inputPath, "utf-8"));
  const parsedInputFile = PropertyInputFileSchema.safeParse(rawInputFile);
  if (!parsedInputFile.success) {
    throw new OgiltigInputfilError(parsedInputFile.error);
  }
  // Zod's inferred optional-field type allows an explicit `undefined`;
  // exactOptionalPropertyTypes doesn't. Runtime shape is already
  // Zod-verified — this reconciles the two type systems, nothing more
  // (same pattern as extract.ts/analyze.ts).
  const { input } = parsedInputFile.data as { input: PropertyInput };

  const { analys, calls: analysCalls } = await runAnalys(extraction, {
    model,
    maxCostSek: maxCostSek - spentExtraktion,
    effort: effortJudging,
  });
  allCalls.push(...analysCalls);

  const resultat = await assembleraAnalys({
    extraction,
    input,
    prisdatakalla: valjPrisdatakalla(input),
    analys,
  });

  const wallClockS = (performance.now() - wallClockStart) / 1000;
  console.log(JSON.stringify(resultat, null, 2));
  console.error(formatCallMetricsTable(allCalls));
  console.error(
    `Klart. Uppskattad total kostnad: ${totalCostSek(allCalls).toFixed(2)} kr. ` +
      `Väggklocka: ${wallClockS.toFixed(1)} s.`,
  );
}

main().catch((error: unknown) => {
  if (
    error instanceof ScannedPdfError ||
    error instanceof KostnadsgransOverskriden ||
    error instanceof ExtractionValidationError ||
    error instanceof AnalysValidationError ||
    error instanceof AssemblyValidationError ||
    error instanceof SaknarRantekanslighetError ||
    error instanceof OgiltigInputfilError ||
    error instanceof ModelTruncatedError
  ) {
    console.error(`FEL: ${error.message}`);
  } else {
    console.error("Oväntat fel:", error);
  }
  process.exitCode = 1;
});
