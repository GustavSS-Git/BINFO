import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { APIConnectionError } from "@anthropic-ai/sdk";
import { jamforTristate, jamforVarde } from "./answerKey";
import { bedomStatus } from "./benchmarks";
import { runExtraction, type RunExtractionOptions } from "./runExtraction";
import type { FeeInclusion, KeyFigureId } from "@/types/analysis";

/**
 * PIPELINE.md step 5's harness: runs pass 1 against every fixture in
 * fixtures/answer-key/ and reports every deviation field by field.
 * "Without this you do not know the extraction works. You hope it does,
 * until a paying customer finds a debt figure that is wrong by seven
 * digits."
 *
 * Real annual reports are never committed (see .gitignore) — this reads
 * them from a local directory you point it at.
 */
interface AnswerKeyFixture {
  orgnr: string;
  namn: string;
  kalla: { fil: string; forvaltare: string; verifieradMot: string };
  nyckeltal: Record<string, number>;
  lanebok?: { totalSkuld?: number; snittranta?: number };
  avgiftInkluderar?: Partial<FeeInclusion>;
}

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local — fine if ANTHROPIC_API_KEY etc. are exported in the shell.
}

const ANSWER_KEY_DIR = "fixtures/answer-key";

function felText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * Anslutningsfel (t.ex. "write EPIPE" mitt i uppladdningen av en 12 MB
 * PDF) är övergående och drabbar de stora rapporterna. Allt annat —
 * kostnadstak, skannad PDF, schemavalidering — är ett riktigt resultat och
 * ska inte försökas om.
 */
function arAnslutningsfel(error: unknown): boolean {
  return (
    error instanceof APIConnectionError ||
    (error instanceof Error && /EPIPE|ECONNRESET|ETIMEDOUT|socket hang up/i.test(error.message))
  );
}

/** Ett (1) omförsök vid anslutningsfel — medvetet ingen backoff-strategi. */
async function korMedEttOmforsok(pdfBytes: Uint8Array, options: RunExtractionOptions) {
  try {
    return await runExtraction(pdfBytes, options);
  } catch (error) {
    if (!arAnslutningsfel(error)) throw error;
    console.log(`  Anslutningsfel (${felText(error)}) — gör ett omförsök...`);
    return await runExtraction(pdfBytes, options);
  }
}

async function loadFixtures(): Promise<AnswerKeyFixture[]> {
  const files = (await readdir(ANSWER_KEY_DIR)).filter((f) => f.endsWith(".json"));
  return Promise.all(
    files.map(async (f) => JSON.parse(await readFile(path.join(ANSWER_KEY_DIR, f), "utf-8"))),
  );
}

async function main() {
  const pdfDir = process.argv[2];
  if (!pdfDir) {
    console.error(
      "Användning: npm run verify-extraction -- <mapp-med-årsredovisningar>\n" +
        "Mappen måste innehålla en PDF-fil per fixture (se kalla.fil i fixtures/answer-key/*.json).",
    );
    process.exitCode = 1;
    return;
  }

  const model = process.env["ANTHROPIC_MODEL"] || "claude-sonnet-5";
  const maxCostSek = Number(process.env["MAX_COST_PER_ANALYSIS_SEK"] ?? "5");
  const fixtures = await loadFixtures();

  let totalFalt = 0;
  let godkanda = 0;
  let hoppadeOver = 0;
  let misslyckade = 0;

  for (const fixture of fixtures) {
    const pdfPath = path.join(pdfDir, fixture.kalla.fil);
    console.log(`\n${"=".repeat(70)}\n${fixture.namn} (${fixture.kalla.forvaltare})\n${"=".repeat(70)}`);

    let pdfBytes: Uint8Array;
    try {
      pdfBytes = new Uint8Array(await readFile(pdfPath));
    } catch {
      console.log(`  HOPPAR ÖVER — hittar inte ${pdfPath}`);
      hoppadeOver++;
      continue;
    }

    // En rapport som kraschar får inte sänka hela körningen — de övriga
    // fixturerna ska fortfarande köras och rapporteras.
    let extraction: Awaited<ReturnType<typeof runExtraction>>["extraction"];
    let spentSek: number;
    try {
      ({ extraction, spentSek } = await korMedEttOmforsok(pdfBytes, { model, maxCostSek }));
    } catch (error) {
      console.log(`  MISSLYCKADES — ${fixture.kalla.fil}: ${felText(error)}`);
      misslyckade++;
      continue;
    }

    for (const [id, forvantat] of Object.entries(fixture.nyckeltal)) {
      const kf = extraction.forening.keyFigures.find((k) => k.id === id);
      const r = jamforVarde(id, kf?.figure.value ?? null, forvantat, "exakt");
      totalFalt++;
      if (r.godkand) godkanda++;
      console.log(
        `  ${r.godkand ? "✓" : "✗"} ${id}: förväntat ${r.forvantat}, fick ${r.faktiskt ?? "null"}`,
      );

      // Status är nu deterministisk (benchmarks.ts) — det finns inget för
      // modellen att "träffa fel" på, så det förväntade värdet härleds här
      // från samma funktion produktionskoden använder, istället för att
      // dupliceras för hand i varje fixture (vilket skulle bli inaktuellt
      // så fort en tröskel ändras). Det som faktiskt testas är att
      // berikning verkligen körs igenom den riktiga pipelinen — en
      // sammankopplingsbugg, inte ett gissningsfel.
      const forvantadStatus = bedomStatus(id as KeyFigureId, forvantat).status;
      const statusGodkand = kf?.status === forvantadStatus;
      totalFalt++;
      if (statusGodkand) godkanda++;
      console.log(
        `  ${statusGodkand ? "✓" : "✗"} ${id}.status: förväntat "${forvantadStatus}", fick "${kf?.status ?? "saknas"}"`,
      );
    }

    if (fixture.lanebok?.totalSkuld !== undefined) {
      const r = jamforVarde(
        "lanebok.totalSkuld",
        extraction.forening.lanebok?.totalSkuld.value ?? null,
        fixture.lanebok.totalSkuld,
        "exakt",
      );
      totalFalt++;
      if (r.godkand) godkanda++;
      console.log(
        `  ${r.godkand ? "✓" : "✗"} lanebok.totalSkuld: förväntat ${r.forvantat}, fick ${r.faktiskt ?? "null"}`,
      );
    }

    if (fixture.lanebok?.snittranta !== undefined) {
      const r = jamforVarde(
        "lanebok.snittranta",
        extraction.forening.lanebok?.snittranta?.value ?? null,
        fixture.lanebok.snittranta,
        "ungefar",
      );
      totalFalt++;
      if (r.godkand) godkanda++;
      const avvikelse = r.avvikelseProcent !== undefined ? ` (${r.avvikelseProcent.toFixed(2)}% avvikelse)` : "";
      console.log(
        `  ${r.godkand ? "✓" : "✗"} lanebok.snittranta: förväntat ${r.forvantat}, fick ${r.faktiskt ?? "null"}${avvikelse}`,
      );
    }

    if (fixture.avgiftInkluderar) {
      const faktisktInkluderar = extraction.forening.avgiftInkluderarEnligtForening;
      for (const [post, forvantat] of Object.entries(fixture.avgiftInkluderar)) {
        const r = jamforTristate(
          `avgiftInkluderar.${post}`,
          faktisktInkluderar?.[post as keyof FeeInclusion],
          forvantat,
        );
        totalFalt++;
        if (r.godkand) godkanda++;
        console.log(
          `  ${r.godkand ? "✓" : "✗"} avgiftInkluderar.${post}: förväntat "${r.forvantat}", fick "${r.faktiskt ?? "saknas"}"`,
        );
      }
    }

    console.log(`  (${spentSek.toFixed(2)} kr)`);
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(
    `${godkanda}/${totalFalt} fält godkända.` +
      (hoppadeOver > 0 ? ` ${hoppadeOver} rapport(er) överhoppade (PDF saknas).` : "") +
      (misslyckade > 0
        ? ` ${misslyckade} rapport(er) misslyckades (körningen gick inte att slutföra).`
        : ""),
  );
  process.exitCode = godkanda === totalFalt && hoppadeOver === 0 && misslyckade === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error("Oväntat fel:", error);
  process.exitCode = 1;
});
