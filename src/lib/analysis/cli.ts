import { readFile } from "node:fs/promises";
import { z } from "zod";
import { ExtractionValidationError } from "./extract";
import { KostnadsgransOverskriden } from "./costGuard";
import { ScannedPdfError, runExtraction } from "./runExtraction";
import { AnalysValidationError, runAnalys } from "./analyze";
import { AssemblyValidationError, assembleraAnalys } from "./assemble";
import { PropertyInputSchema } from "./schema";
import { DemoPrisdatakalla, TomPrisdatakalla, type Prisdatakalla } from "./prisdata";
import { SaknarRantekanslighetError } from "./calc/rantestress";
import type { LaneUnderlag } from "./calc/manadskostnad";
import type { PropertyInput } from "@/types/analysis";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local — fine if ANTHROPIC_API_KEY etc. are exported in the shell.
}

/**
 * The buyer/household loan assumptions LaneUnderlag needs. Not part of the
 * AnalysisResult contract (see calc/manadskostnad.ts's file comment) — a
 * small local schema so a typo in the input file fails with a clear Swedish
 * message rather than a bad number silently reaching the analysis.
 */
const LaneUnderlagSchema = z
  .object({
    lanebelopp: z.number(),
    kontantinsats: z.number(),
    ranta: z.number(),
    bruttoinkomst: z.number(),
  })
  .strict();

const PropertyInputFileSchema = z
  .object({
    input: PropertyInputSchema,
    lan: LaneUnderlagSchema,
  })
  .strict();

class OgiltigInputfilError extends Error {
  constructor(zodError: z.ZodError) {
    const issues = zodError.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    super(`Objektsfilen matchar inte förväntat format: ${issues}`);
    this.name = "OgiltigInputfilError";
  }
}

/**
 * Which price source the CLI wires in. There is no real one yet (see
 * PIPELINE.md / prisdata.ts) — TomPrisdatakalla is the honest production
 * default, DemoPrisdatakalla is a clearly-labelled placeholder useful for
 * seeing the full report shape while developing. Chosen via PRISKALLA so
 * nobody has to edit code to switch, and defaults to the honest one.
 */
function valjPrisdatakalla(input: { utgangspris: number; boarea: number }): Prisdatakalla {
  const val = (process.env["PRISKALLA"] ?? "tom").toLowerCase();
  if (val === "demo") {
    return new DemoPrisdatakalla(input);
  }
  return new TomPrisdatakalla();
}

async function main() {
  const pdfPath = process.argv[2];
  const inputPath = process.argv[3];
  if (!pdfPath) {
    console.error(
      "Användning: npm run extract -- <sökväg-till-årsredovisning.pdf> [sökväg-till-objekt.json]\n\n" +
        "Utan objektsfil skrivs enbart pass 1:s ExtractionResult ut.\n" +
        'Med en objektsfil ({ "input": PropertyInput, "lan": LaneUnderlag }) körs hela pipelinen ' +
        "(extraktion → analys → sammanställning) och ett fullständigt AnalysisResult skrivs ut.\n\n" +
        "Miljövariabeln PRISKALLA styr prisdatakällan: 'tom' (förval, ingen extern prisdata) eller " +
        "'demo' (tydligt märkta platshållarfigurer, se prisdata.ts).",
    );
    process.exitCode = 1;
    return;
  }

  const model = process.env["ANTHROPIC_MODEL"] || "claude-sonnet-5";
  const maxCostSek = Number(process.env["MAX_COST_PER_ANALYSIS_SEK"] ?? "5");

  const pdfBytes = new Uint8Array(await readFile(pdfPath));

  console.error(`Läser ${pdfPath} (modell: ${model}, kostnadstak: ${maxCostSek} kr)...`);

  const { extraction, spentSek: spentExtraktion } = await runExtraction(pdfBytes, {
    model,
    maxCostSek,
  });

  if (!inputPath) {
    console.log(JSON.stringify(extraction, null, 2));
    console.error(
      `Klart (endast extraktion). Uppskattad kostnad: ${spentExtraktion.toFixed(2)} kr.`,
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
  const { input, lan } = parsedInputFile.data as { input: PropertyInput; lan: LaneUnderlag };

  const { analys, spentSek: spentAnalys } = await runAnalys(extraction, {
    model,
    maxCostSek: maxCostSek - spentExtraktion,
  });

  const resultat = await assembleraAnalys({
    extraction,
    input,
    lan,
    prisdatakalla: valjPrisdatakalla(input),
    analys,
  });

  const totalKostnad = spentExtraktion + spentAnalys;
  console.log(JSON.stringify(resultat, null, 2));
  console.error(`Klart. Uppskattad total kostnad: ${totalKostnad.toFixed(2)} kr.`);
}

main().catch((error: unknown) => {
  if (
    error instanceof ScannedPdfError ||
    error instanceof KostnadsgransOverskriden ||
    error instanceof ExtractionValidationError ||
    error instanceof AnalysValidationError ||
    error instanceof AssemblyValidationError ||
    error instanceof SaknarRantekanslighetError ||
    error instanceof OgiltigInputfilError
  ) {
    console.error(`FEL: ${error.message}`);
  } else {
    console.error("Oväntat fel:", error);
  }
  process.exitCode = 1;
});
