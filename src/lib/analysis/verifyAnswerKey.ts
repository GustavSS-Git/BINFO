import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { APIConnectionError } from "@anthropic-ai/sdk";
import { jamforTecken, jamforTristate, jamforVarde } from "./answerKey";
import { bedomStatus } from "./benchmarks";
import { ScannedPdfError, runExtraction, type RunExtractionOptions } from "./runExtraction";
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

/**
 * A nyckeltal's expected value. Usually a plain number. When the report
 * itself only prints a sign (e.g. "neg" for sparande, no magnitude — see
 * Volontären), the answer key states that sign instead — there is no
 * number to compare exactly or approximately against, only whether the
 * extraction correctly read the sign (see `jamforTecken` in answerKey.ts).
 */
type NyckeltalForvantatVarde = number | { tecken: "negativ" | "positiv" };

/**
 * Per-field provenance for a fixture that hasn't been verified by the
 * product owner yet (see `arUtkast` below) — page and verbatim printed
 * text, or an explanation of why the value couldn't be read at all
 * (garbled text layer, ambiguous area basis, etc). Not consumed by the
 * comparison logic below; it exists purely for a human to check the draft
 * against the original PDF.
 */
type Verifieringspost = { sida: number; tryckt: string } | { anmarkning: string };

interface AnswerKeyFixture {
  orgnr: string;
  namn: string;
  kalla: { fil: string; forvaltare: string; verifieradMot: string };
  nyckeltal: Record<string, NyckeltalForvantatVarde>;
  verifiering?: Record<string, Verifieringspost>;
  lanebok?: { totalSkuld?: number; snittranta?: number };
  avgiftInkluderar?: Partial<FeeInclusion>;
  /**
   * True for a fixture whose PDF is expected to be REFUSED before any API
   * spend — today only a scanned PDF with no text layer (ScannedPdfError).
   * Success for this fixture means the refusal happened, not that any
   * nyckeltal matched; `nyckeltal` is expected to be empty.
   */
  forvantatRefuserad?: boolean;
}

/**
 * A fixture whose source comment (`kalla.verifieradMot`) says "UTKAST" —
 * the convention this task introduces for a draft answer key read locally
 * from the PDF's text layer (no model call), not yet checked by the
 * product owner against the original report. Reported in its own section
 * below rather than folded into the main pass/fail tally, since a mismatch
 * on a draft fixture might just as well mean the draft itself is wrong.
 */
function arUtkast(fixture: AnswerKeyFixture): boolean {
  return fixture.kalla.verifieradMot.toUpperCase().includes("UTKAST");
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

/** Running tally kept separately for verified vs. draft ("UTKAST") fixtures
 *  — see `arUtkast`'s doc comment for why they're never mixed together. */
interface Rakning {
  totalFalt: number;
  godkanda: number;
}

function nyRakning(): Rakning {
  return { totalFalt: 0, godkanda: 0 };
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

  const verifierad = nyRakning();
  const utkast = nyRakning();
  let hoppadeOver = 0;
  let misslyckade = 0;
  const utkastRapporter: string[] = [];
  const refuseringsFel: string[] = [];

  for (const fixture of fixtures) {
    const rakning = arUtkast(fixture) ? utkast : verifierad;
    if (arUtkast(fixture)) utkastRapporter.push(fixture.namn);

    const pdfPath = path.join(pdfDir, fixture.kalla.fil);
    console.log(
      `\n${"=".repeat(70)}\n${fixture.namn} (${fixture.kalla.forvaltare})` +
        `${arUtkast(fixture) ? "  [UTKAST — ej verifierad]" : ""}\n${"=".repeat(70)}`,
    );

    let pdfBytes: Uint8Array;
    try {
      pdfBytes = new Uint8Array(await readFile(pdfPath));
    } catch {
      console.log(`  HOPPAR ÖVER — hittar inte ${pdfPath}`);
      hoppadeOver++;
      continue;
    }

    // --- Fixtures expected to be REFUSED before any API spend (scanned PDF) ---
    if (fixture.forvantatRefuserad) {
      try {
        await korMedEttOmforsok(pdfBytes, { model, maxCostSek });
        console.log(
          `  ✗ FÖRVÄNTAD REFUSERING UTEBLEV — extraktionen lyckades, men skulle ha kastat ScannedPdfError`,
        );
        refuseringsFel.push(fixture.namn);
        rakning.totalFalt++;
      } catch (error) {
        if (error instanceof ScannedPdfError) {
          console.log(`  ✓ Förväntad refusering — ${error.message}`);
          rakning.totalFalt++;
          rakning.godkanda++;
        } else {
          console.log(`  ✗ Fel typ av fel — förväntade ScannedPdfError, fick: ${felText(error)}`);
          refuseringsFel.push(fixture.namn);
          rakning.totalFalt++;
        }
      }
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

      if (typeof forvantat === "number") {
        const r = jamforVarde(id, kf?.figure.value ?? null, forvantat, "exakt");
        rakning.totalFalt++;
        if (r.godkand) rakning.godkanda++;
        console.log(
          `  ${r.godkand ? "✓" : "✗"} ${id}: förväntat ${r.forvantat}, fick ${r.faktiskt ?? "null"}` +
            (kf?.figure.tryckt ? ` (tryckt: "${kf.figure.tryckt}")` : ""),
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
        rakning.totalFalt++;
        if (statusGodkand) rakning.godkanda++;
        console.log(
          `  ${statusGodkand ? "✓" : "✗"} ${id}.status: förväntat "${forvantadStatus}", fick "${kf?.status ?? "saknas"}"`,
        );
      } else {
        // Sign-only expectation (e.g. "neg") — see jamforTecken's doc comment.
        const r = jamforTecken(id, kf?.figure.value ?? null, kf?.figure.tecken, forvantat.tecken);
        rakning.totalFalt++;
        if (r.godkand) rakning.godkanda++;
        console.log(
          `  ${r.godkand ? "✓" : "✗"} ${id}.tecken: förväntat "${forvantat.tecken}", fick ` +
            `${kf?.figure.tecken ? `"${kf.figure.tecken}"` : "inget tecken"}` +
            ` (value: ${kf?.figure.value ?? "null"}${kf?.figure.tryckt ? `, tryckt: "${kf.figure.tryckt}"` : ""})`,
        );

        const forvantadStatus = bedomStatus(id as KeyFigureId, null, forvantat.tecken).status;
        const statusGodkand = kf?.status === forvantadStatus;
        rakning.totalFalt++;
        if (statusGodkand) rakning.godkanda++;
        console.log(
          `  ${statusGodkand ? "✓" : "✗"} ${id}.status: förväntat "${forvantadStatus}", fick "${kf?.status ?? "saknas"}"`,
        );
      }
    }

    if (fixture.lanebok?.totalSkuld !== undefined) {
      const r = jamforVarde(
        "lanebok.totalSkuld",
        extraction.forening.lanebok?.totalSkuld.value ?? null,
        fixture.lanebok.totalSkuld,
        "exakt",
      );
      rakning.totalFalt++;
      if (r.godkand) rakning.godkanda++;
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
      rakning.totalFalt++;
      if (r.godkand) rakning.godkanda++;
      const avvikelse =
        r.avvikelseProcent !== undefined ? ` (${r.avvikelseProcent.toFixed(2)}% avvikelse)` : "";
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
        rakning.totalFalt++;
        if (r.godkand) rakning.godkanda++;
        console.log(
          `  ${r.godkand ? "✓" : "✗"} avgiftInkluderar.${post}: förväntat "${r.forvantat}", fick "${r.faktiskt ?? "saknas"}"`,
        );
      }
    }

    console.log(`  (${spentSek.toFixed(2)} kr)`);
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log("VERIFIERADE FIXTURER (facit avstämt mot originalrapporten):");
  console.log(
    `  ${verifierad.godkanda}/${verifierad.totalFalt} fält godkända.` +
      (hoppadeOver > 0 ? ` ${hoppadeOver} rapport(er) överhoppade (PDF saknas).` : "") +
      (misslyckade > 0
        ? ` ${misslyckade} rapport(er) misslyckades (körningen gick inte att slutföra).`
        : "") +
      (refuseringsFel.length > 0
        ? ` ${refuseringsFel.length} förväntad refusering uteblev: ${refuseringsFel.join(", ")}.`
        : ""),
  );

  if (utkastRapporter.length > 0) {
    console.log(
      `\nUTKAST — INTE verifierade mot originalrapporten av produktägaren (rapporteras separat, räknas INTE in ovan):`,
    );
    console.log(`  Rapporter: ${utkastRapporter.join(", ")}`);
    console.log(`  ${utkast.godkanda}/${utkast.totalFalt} fält godkända (utkast).`);
  }

  const allaGodkanda = verifierad.godkanda === verifierad.totalFalt;
  process.exitCode =
    allaGodkanda && hoppadeOver === 0 && misslyckade === 0 && refuseringsFel.length === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error("Oväntat fel:", error);
  process.exitCode = 1;
});
