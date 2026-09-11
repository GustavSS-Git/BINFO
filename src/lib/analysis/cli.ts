import { readFile } from "node:fs/promises";
import { ExtractionValidationError } from "./extract";
import { KostnadsgransOverskriden } from "./costGuard";
import { ScannedPdfError, runExtraction } from "./runExtraction";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local — fine if ANTHROPIC_API_KEY etc. are exported in the shell.
}

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error("Användning: npm run extract -- <sökväg-till-årsredovisning.pdf>");
    process.exitCode = 1;
    return;
  }

  const model = process.env["ANTHROPIC_MODEL"] || "claude-sonnet-5";
  const maxCostSek = Number(process.env["MAX_COST_PER_ANALYSIS_SEK"] ?? "5");

  const pdfBytes = new Uint8Array(await readFile(pdfPath));

  console.error(`Läser ${pdfPath} (modell: ${model}, kostnadstak: ${maxCostSek} kr)...`);

  const { extraction, spentSek } = await runExtraction(pdfBytes, { model, maxCostSek });

  console.log(JSON.stringify(extraction, null, 2));
  console.error(`Klart. Uppskattad kostnad: ${spentSek.toFixed(2)} kr.`);
}

main().catch((error: unknown) => {
  if (error instanceof ScannedPdfError) {
    console.error(`FEL: ${error.message}`);
  } else if (error instanceof KostnadsgransOverskriden) {
    console.error(`FEL: ${error.message}`);
  } else if (error instanceof ExtractionValidationError) {
    console.error(`FEL: ${error.message}`);
  } else {
    console.error("Oväntat fel:", error);
  }
  process.exitCode = 1;
});
