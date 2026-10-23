import { z } from "zod";
import type { PropertyInput } from "@/types/analysis";
import { PropertyInputSchema } from "./schema";

/**
 * The `{ "input": PropertyInput }` file of the `extract` CLI, checked BEFORE any
 * paid API call (a run used to fail on a missing `andelstal`/`orgnr` only after
 * ~3 kr of grounding and extraction). Pure: no I/O, no network.
 *
 * It refuses exactly what the run would fail on anyway: the same
 * `PropertyInputSchema` that assembly uses (src/lib/analysis/assemble.ts), plus
 * the strict wrapper (an unknown key is almost always a typo, and a typo in an
 * optional field would silently vanish). Fields the schema leaves optional or
 * accepts as unknown only produce warnings; the run continues.
 */

// .strict() on purpose: an unknown key in the file is almost always a typo, and silently
// ignoring it is expensive here since a run costs real money. Easy to miss in the optional
// fields: "byggår" instead of "byggar" would just vanish without it. Loan data is no longer
// part of the pipeline and does not belong in the file at all.
export const PropertyInputFileSchema = z.object({ input: PropertyInputSchema }).strict();

export type InputfilUtfall =
  { ok: true; input: PropertyInput; varningar: string[] } | { ok: false; fel: string[] };

/** Optional fields of PropertyInputSchema and what the report loses without them. */
const VALFRIA_FALT: Array<{ falt: keyof PropertyInput; konsekvens: string }> = [
  // CLAUDE.md: without an asking price the report shows the "Binfos värdering" variant.
  {
    falt: "utgangspris",
    konsekvens: 'rapporten blir varianten "Binfos värdering" utan prisjämförelse',
  },
  { falt: "byggar", konsekvens: "valfritt fält" },
  { falt: "vaning", konsekvens: "valfritt fält" },
];

function formateraFel(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join(".") || "(roten)"}: ${i.message}`);
}

/** Validates an already parsed input file. */
export function kontrolleraInputfil(raw: unknown): InputfilUtfall {
  const parsed = PropertyInputFileSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, fel: formateraFel(parsed.error) };
  // Zod's inferred optional-field type allows an explicit `undefined`;
  // exactOptionalPropertyTypes doesn't. The runtime shape is Zod-verified.
  const { input } = parsed.data as { input: PropertyInput };

  const varningar: string[] = [];
  for (const { falt, konsekvens } of VALFRIA_FALT) {
    if (input[falt] === undefined) varningar.push(`input.${falt} saknas: ${konsekvens}.`);
  }
  for (const falt of ["hiss", "balkong"] as const) {
    if (input[falt] === "okant")
      varningar.push(`input.${falt} är "okant" (svaret är inte angivet).`);
  }
  return { ok: true, input, varningar };
}

/** Parses and validates the text of an input file (JSON syntax errors are reported, not thrown). */
export function kontrolleraInputfilText(text: string): InputfilUtfall {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      fel: [`Filen är inte giltig JSON: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  return kontrolleraInputfil(raw);
}
