/**
 * Free re-assembly of a saved analysis (no API calls): reads the file written
 * by `EXTRACT_SPARA_UNDERLAG=<file> npm run extract …` and prints the assembled
 * AnalysisResult with today's reference rate (Riksbank; fallback if offline).
 *
 *   node --import tsx scripts/monteraOm.ts <underlag.json> [input.json]
 *
 * An optional input.json ({ "input": PropertyInput }) replaces the saved
 * buyer input, e.g. to try another flat in the same förening.
 */
import { readFile } from "node:fs/promises";
import { assembleraAnalys } from "@/lib/analysis/assemble";
import { reservReferensranta } from "@/lib/analysis/calc/prognosantaganden";
import { ModellPrisdatakalla } from "@/lib/analysis/prisdata";
import { hamtaFranRiksbanken } from "@/lib/analysis/referensrantaHamtning";
import {
  AnalysJudgementSchema,
  ExtractionResultSchema,
  PropertyInputSchema,
} from "@/lib/analysis/schema";

async function main() {
  const [underlagFil, inputFil] = process.argv.slice(2);
  if (!underlagFil) throw new Error("Användning: monteraOm.ts <underlag.json> [input.json]");
  const underlag = JSON.parse(await readFile(underlagFil, "utf8")) as {
    extraction: unknown;
    analys: unknown;
    input: unknown;
  };
  const input = inputFil
    ? PropertyInputSchema.parse(
        (JSON.parse(await readFile(inputFil, "utf8")) as { input: unknown }).input,
      )
    : PropertyInputSchema.parse(underlag.input);
  const ranta = await hamtaFranRiksbanken();
  const resultat = await assembleraAnalys({
    extraction: ExtractionResultSchema.parse(underlag.extraction),
    analys: AnalysJudgementSchema.parse(underlag.analys),
    input,
    prisdatakalla: new ModellPrisdatakalla(),
    ...(ranta ? { referensranta: { ...reservReferensranta(), ...ranta, reserv: false } } : {}),
  });
  console.log(JSON.stringify(resultat, null, 2));
}

main().catch((fel: unknown) => {
  console.error(fel);
  process.exit(1);
});
