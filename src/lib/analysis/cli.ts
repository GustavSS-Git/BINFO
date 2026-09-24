import { readFile } from "node:fs/promises";
import { z } from "zod";
import { ExtractionValidationError, ModelTruncatedError } from "./extract";
import { KostnadsgransOverskriden } from "./costGuard";
import { ScannedPdfError, runExtraction, type ModelEffort } from "./runExtraction";
import { AnalysValidationError, runAnalys } from "./analyze";
import { AssemblyValidationError, assembleraAnalys } from "./assemble";
import { PropertyInputSchema } from "./schema";
import { formatCallMetricsTable, totalCostSek, type ModelCallMetrics } from "./callMetrics";
import {
  DemoPrisdatakalla,
  SchablonPrisdatakalla,
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
 * Reads an optional per-stage effort override for experimentation (task
 * 1.2's effort sweeps), falling back to a generic ANTHROPIC_EFFORT if the
 * stage-specific variable isn't set, and to `undefined` (Sonnet 5's own
 * adaptive-thinking default) if neither is. Not documented in .env.example —
 * these are dev-only knobs for `npm run extract`/`npm run verify-extraction`,
 * not production configuration (see steg.ts for the production equivalent).
 */
function lasEffort(stageVar: string): ModelEffort | undefined {
  const rå = process.env[stageVar] || process.env["ANTHROPIC_EFFORT"];
  if (!rå) return undefined;
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
 * Which price source the CLI wires in. There is no real one yet (see
 * PIPELINE.md / prisdata.ts). The default is SchablonPrisdatakalla — the
 * interim flat kr/m² valuation, loudly labelled `source: 'schablon'` with a
 * leverantor string that names itself a schablon — so the price layer renders.
 * TomPrisdatakalla (no price data at all) and DemoPrisdatakalla (valueless
 * placeholder figures) stay selectable. Chosen via PRISKALLA so nobody has to
 * edit code to switch.
 */
function valjPrisdatakalla(input: { utgangspris: number; boarea: number }): Prisdatakalla {
  const val = (process.env["PRISKALLA"] ?? "schablon").toLowerCase();
  if (val === "tom") {
    return new TomPrisdatakalla();
  }
  if (val === "demo") {
    return new DemoPrisdatakalla(input);
  }
  return new SchablonPrisdatakalla({ boarea: input.boarea });
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
        "Miljövariabeln PRISKALLA styr prisdatakällan: 'schablon' (förval, platt värdering " +
        "80 000 kr/m², tydligt märkt som schablon), 'tom' (ingen extern prisdata alls) eller " +
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

  const {
    extraction,
    spentSek: spentExtraktion,
    calls: extraktionCalls,
  } = await runExtraction(pdfBytes, {
    model,
    maxCostSek,
    // runExtraction is grounding+extraction combined — the effort split
    // per stage only matters once the two calls are made separately
    // (runGrounding/runStructuredExtraction, as steg.ts does); this CLI
    // path uses the grounding setting for both when only one is given, so
    // a single ANTHROPIC_EFFORT still does something useful here.
    ...(effortGrounding
      ? { effort: effortGrounding }
      : effortExtraction
        ? { effort: effortExtraction }
        : {}),
  });
  allCalls.push(...extraktionCalls);

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
    ...(effortJudging ? { effort: effortJudging } : {}),
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
