import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { APIConnectionError } from "@anthropic-ai/sdk";
import { jamforTecken, jamforTristate, jamforVarde } from "./answerKey";
import { bedomStatus } from "./benchmarks";
import {
  ScannedPdfError,
  runExtraction,
  type ModelEffort,
  type RunExtractionOptions,
} from "./runExtraction";
import { formatCallMetricsTable, totalCostSek, type ModelCallMetrics } from "./callMetrics";
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

/**
 * Task 1.5's new "Övrig info" fields (Forening.antalMedlemmar,
 * .antalHyresratter, .antalLokaler, .avgiftInkluderarKallor,
 * .individuellMatning — see src/types/analysis.ts). Kept in its own block,
 * scored in its own always-draft tally (see `ovrigInfoUtkast` below), and
 * deliberately NOT folded into `nyckeltal`/`verifiering` above: those two
 * fields describe a fixture's PRE-EXISTING, per-file verification status
 * (arUtkast reads `kalla.verifieradMot` for the WHOLE fixture), and several
 * of these fixtures already have verified nyckeltal — this task must not
 * alter that verified status just because it adds new, not-yet-verified
 * fields alongside it. `avgiftInkluderarKallor` only carries the expected
 * PAGE per post (not the excerpt) — comparing a page number is enough to
 * catch a wrong or missing citation; the excerpt is for the human verifier
 * in `ovrigInfoVerifiering` below, not for the automated comparison.
 */
interface OvrigInfoForvantat {
  antalMedlemmar?: number;
  antalHyresratter?: number;
  antalLokaler?: number;
  avgiftInkluderarKallor?: Partial<Record<keyof FeeInclusion, number>>;
  individuellMatning?: Partial<Record<"el" | "vatten" | "varme", "ja" | "nej">>;
}

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
  /** See `OvrigInfoForvantat` above. */
  ovrigInfo?: OvrigInfoForvantat;
  /** Per-field page + printed text for the human verifier — same shape and
   *  purpose as `verifiering` above, but keyed to `ovrigInfo`'s fields
   *  (including dotted keys like "avgiftInkluderarKallor.el"). */
  ovrigInfoVerifiering?: Record<string, Verifieringspost>;
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

const GILTIGA_EFFORT: ModelEffort[] = ["low", "medium", "high", "xhigh", "max"];

/** ANTHROPIC_EFFORT — one setting for the whole run (this CLI runs
 *  runExtraction, i.e. grounding+extraction combined, never judging), for
 *  effort sweeps against the regression set (task 1.2). Unset means Sonnet
 *  5's own adaptive-thinking default, unchanged from before this option
 *  existed. */
function lasEffort(): ModelEffort | undefined {
  const rå = process.env["ANTHROPIC_EFFORT"];
  if (!rå) return undefined;
  if (!GILTIGA_EFFORT.includes(rå as ModelEffort)) {
    throw new Error(
      `ANTHROPIC_EFFORT måste vara en av ${GILTIGA_EFFORT.join(", ")}, fick "${rå}".`,
    );
  }
  return rå as ModelEffort;
}

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
  const effort = lasEffort();
  const fixtures = await loadFixtures();

  const verifierad = nyRakning();
  const utkast = nyRakning();
  // Task 1.5's new "Övrig info"-fält — alltid ett eget, alltid-utkast-läge
  // (se OvrigInfoForvantat's filkommentar), oavsett om samma fixtures
  // nyckeltal redan är verifierade.
  const ovrigInfo = nyRakning();
  const ovrigInfoRapporter: string[] = [];
  let hoppadeOver = 0;
  let misslyckade = 0;
  const utkastRapporter: string[] = [];
  const refuseringsFel: string[] = [];
  const allaAnrop: ModelCallMetrics[] = [];
  let totalWallMs = 0;

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
        // No wall-clock/cost tracking here on purpose: a refusal is a local,
        // pre-flight check (extractPdfText's text-layer detection) that
        // fires before any Anthropic call is made — there is nothing to
        // measure.
        await korMedEttOmforsok(pdfBytes, { model, maxCostSek, ...(effort ? { effort } : {}) });
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
    let calls: ModelCallMetrics[];
    const wallStart = performance.now();
    try {
      ({ extraction, spentSek, calls } = await korMedEttOmforsok(pdfBytes, {
        model,
        maxCostSek,
        ...(effort ? { effort } : {}),
      }));
    } catch (error) {
      console.log(`  MISSLYCKADES — ${fixture.kalla.fil}: ${felText(error)}`);
      misslyckade++;
      continue;
    }
    const wallMs = performance.now() - wallStart;
    totalWallMs += wallMs;
    allaAnrop.push(...calls);

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

    if (fixture.ovrigInfo) {
      ovrigInfoRapporter.push(fixture.namn);
      const forening = extraction.forening;
      const oi = fixture.ovrigInfo;

      if (oi.antalMedlemmar !== undefined) {
        const r = jamforVarde(
          "antalMedlemmar",
          forening.antalMedlemmar?.value ?? null,
          oi.antalMedlemmar,
          "exakt",
        );
        ovrigInfo.totalFalt++;
        if (r.godkand) ovrigInfo.godkanda++;
        console.log(
          `  ${r.godkand ? "✓" : "✗"} antalMedlemmar: förväntat ${r.forvantat}, fick ${r.faktiskt ?? "null"}`,
        );
      }
      if (oi.antalHyresratter !== undefined) {
        const r = jamforVarde(
          "antalHyresratter",
          forening.antalHyresratter?.value ?? null,
          oi.antalHyresratter,
          "exakt",
        );
        ovrigInfo.totalFalt++;
        if (r.godkand) ovrigInfo.godkanda++;
        console.log(
          `  ${r.godkand ? "✓" : "✗"} antalHyresratter: förväntat ${r.forvantat}, fick ${r.faktiskt ?? "null"}`,
        );
      }
      if (oi.antalLokaler !== undefined) {
        const r = jamforVarde(
          "antalLokaler",
          forening.antalLokaler?.value ?? null,
          oi.antalLokaler,
          "exakt",
        );
        ovrigInfo.totalFalt++;
        if (r.godkand) ovrigInfo.godkanda++;
        console.log(
          `  ${r.godkand ? "✓" : "✗"} antalLokaler: förväntat ${r.forvantat}, fick ${r.faktiskt ?? "null"}`,
        );
      }
      if (oi.avgiftInkluderarKallor) {
        for (const [post, forvantadSida] of Object.entries(oi.avgiftInkluderarKallor)) {
          const faktiskSida =
            forening.avgiftInkluderarKallor?.[post as keyof FeeInclusion]?.page ?? null;
          const r = jamforVarde(
            `avgiftInkluderarKallor.${post}`,
            faktiskSida,
            forvantadSida,
            "exakt",
          );
          ovrigInfo.totalFalt++;
          if (r.godkand) ovrigInfo.godkanda++;
          console.log(
            `  ${r.godkand ? "✓" : "✗"} avgiftInkluderarKallor.${post}: förväntad sida ${r.forvantat}, fick ${r.faktiskt ?? "saknas"}`,
          );
        }
      }
      if (oi.individuellMatning) {
        for (const [post, forvantatMatning] of Object.entries(oi.individuellMatning)) {
          const faktiskMatning =
            forening.individuellMatning?.[post as "el" | "vatten" | "varme"]?.matning;
          const r = jamforTristate(`individuellMatning.${post}`, faktiskMatning, forvantatMatning);
          ovrigInfo.totalFalt++;
          if (r.godkand) ovrigInfo.godkanda++;
          console.log(
            `  ${r.godkand ? "✓" : "✗"} individuellMatning.${post}: förväntat "${r.forvantat}", fick "${r.faktiskt ?? "saknas"}"`,
          );
        }
      }
    }

    console.log(`\n${formatCallMetricsTable(calls)}`);
    console.log(
      `  (${spentSek.toFixed(2)} kr, ${(wallMs / 1000).toFixed(1)} s väggklocka för denna rapport)`,
    );
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log("KOSTNAD OCH VÄGGKLOCKA — HELA KÖRNINGEN:");
  console.log(
    `  ${allaAnrop.length} API-anrop totalt, ${totalCostSek(allaAnrop).toFixed(2)} kr, ` +
      `${(totalWallMs / 1000).toFixed(1)} s summerad väggklocka över rapporterna ` +
      `(körda sekventiellt — se rapporten för uppskattad produktions-väggklocka per rapport).`,
  );

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

  if (ovrigInfoRapporter.length > 0) {
    console.log(
      `\nÖVRIG INFO (task 1.5) — nya fält, alltid UTKAST oavsett fixturens övriga verifieringsstatus, INTE lästa av produktägaren än (räknas INTE in ovan):`,
    );
    console.log(`  Rapporter: ${ovrigInfoRapporter.join(", ")}`);
    console.log(`  ${ovrigInfo.godkanda}/${ovrigInfo.totalFalt} fält godkända (utkast).`);
  }

  const allaGodkanda = verifierad.godkanda === verifierad.totalFalt;
  process.exitCode =
    allaGodkanda && hoppadeOver === 0 && misslyckade === 0 && refuseringsFel.length === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error("Oväntat fel:", error);
  process.exitCode = 1;
});
