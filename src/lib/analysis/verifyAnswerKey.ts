import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { APIConnectionError } from "@anthropic-ai/sdk";
import {
  jamforTecken,
  jamforTristate,
  jamforVarde,
  poangsattLan,
  type LanFacitFil,
} from "./answerKey";
import { bedomStatus } from "./benchmarks";
import { type runStructuredExtraction, type ModelEffort } from "./runExtraction";
import { korExtraktion, type StegTid } from "./korExtraktion";
import { sammanfattaSidreferenser, type Sidreferensfynd } from "./sidreferenser";
import { formatCallMetricsTable, totalCostSek, type ModelCallMetrics } from "./callMetrics";
import { STANDARD_MODELL } from "./costGuard";
import type { FeeInclusion, KeyFigureId } from "@/types/analysis";
// Never bundled for the client — this file is a Node CLI run via `tsx`, not
// part of the Vite/TanStack client graph — so importing STANDARD_EFFORT
// from src/server/ here is safe (see cli.ts, which does the same).
import { STANDARD_EFFORT } from "@/server/env";

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
 * `null` means the report prints NO such figure (e.g. only one, ambiguous,
 * debt-per-m² figure, filed under bostadsrättsyta): the extraction must leave
 * it null too.
 */
type NyckeltalForvantatVarde = number | null | { tecken: "negativ" | "positiv" };

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
 * scored separately from `nyckeltal`/`verifiering` above, since a fixture's
 * PRE-EXISTING per-file verification status (arUtkast, from
 * `kalla.verifieradMot`) predates these fields and must never be implicitly
 * upgraded just because ovrigInfo values were added alongside it.
 *
 * As of task 1.6 (2026-09-25) the product owner read every fixture's
 * ovrigInfo values against the original PDFs — see each fixture's
 * `ovrigInfoVerifiering` notes — so a fixture now opts these values INTO the
 * fixture's normal verified/draft tally (same `rakning` as `nyckeltal`) via
 * `ovrigInfoVerifierad: true`. A fixture without that flag still scores its
 * ovrigInfo in the separate, always-draft tally below, exactly as before —
 * this keeps the door open for a future fixture whose nyckeltal are verified
 * but whose ovrigInfo isn't yet. `avgiftInkluderarKallor` only carries the
 * expected PAGE per post (not the excerpt) — comparing a page number is
 * enough to catch a wrong or missing citation; the excerpt is for the human
 * verifier in `ovrigInfoVerifiering` below, not for the automated
 * comparison.
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
   * True for a fixture that has been replaced by another one and is skipped
   * entirely (kept only because files are not deleted by the agents; remove
   * the file). Replaces the former `forvantatRefuserad` fixtures: scanned PDFs
   * are now analysed, not refused.
   */
  obsolet?: boolean;
  /**
   * True when `nyckeltal` and `lanebok` are a supervisor DRAFT (read from page
   * images) not yet verified by the owner, although the rest of the fixture
   * (identity, fee inclusion, ovrigInfo) is verified. Scores those values in the
   * draft tally only — see `arUtkast` for whole-fixture drafts.
   */
  nyckeltalUtkast?: boolean;
  /** PDF page (1-based) where the nyckeltal table sits; compared against each
   *  figure's cited page and printed as information only (not scored). */
  nyckeltalSida?: number;
  /** Raw totals read by the key's author, printed next to the extraction's
   *  kontrollsummor for the sanity-check review. Not scored. */
  kontrollsummor?: Record<string, number>;
  /** Loan answer key from fixtures/answer-key-lan/<orgnr>.json, when one exists. */
  lanFacit?: LanFacitFil;
  /** See `OvrigInfoForvantat` above. */
  ovrigInfo?: OvrigInfoForvantat;
  /** Per-field page + printed text for the human verifier — same shape and
   *  purpose as `verifiering` above, but keyed to `ovrigInfo`'s fields
   *  (including dotted keys like "avgiftInkluderarKallor.el"). */
  ovrigInfoVerifiering?: Record<string, Verifieringspost>;
  /**
   * True once the product owner has read this fixture's `ovrigInfo` values
   * against the original PDF (see `ovrigInfoVerifiering` for the per-field
   * evidence) — see this interface's doc comment above for what that
   * changes about how `ovrigInfo` is scored. Absent/false means still draft.
   */
  ovrigInfoVerifierad?: boolean;
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

/** The tally a fixture's nyckeltal/lanebok values score into. */
function arNyckeltalUtkast(fixture: AnswerKeyFixture): boolean {
  return arUtkast(fixture) || fixture.nyckeltalUtkast === true;
}

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local — fine if ANTHROPIC_API_KEY etc. are exported in the shell.
}

const ANSWER_KEY_DIR = "fixtures/answer-key";
const ANSWER_KEY_LAN_DIR = "fixtures/answer-key-lan";

const GILTIGA_EFFORT: ModelEffort[] = ["low", "medium", "high", "xhigh", "max"];

/**
 * Per-stage effort override (ANTHROPIC_EFFORT_GROUNDING / _EXTRACTION),
 * falling back to a generic ANTHROPIC_EFFORT if the stage-specific variable
 * isn't set, and — as of task 1.6 — to STANDARD_EFFORT ("medium", imported
 * from src/server/env.ts) if neither is, exactly matching production's
 * default (never judging — this CLI only runs grounding+extraction). Before
 * task 1.6 an unset var meant `undefined` (Sonnet 5's own adaptive-thinking
 * default) and both stages shared one ANTHROPIC_EFFORT setting via the
 * combined runExtraction; that made this harness's timings incomparable to
 * production's per-stage numbers. Same fallback chain as cli.ts's lasEffort.
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

/**
 * Ett (1) omförsök vid anslutningsfel — medvetet ingen backoff-strategi.
 * Generisk över anropet (i stället för att vara hårdkodad mot
 * `runExtraction`) sedan task 1.6 delade upp grundning och extraktion i två
 * separata anrop, vart och ett med sitt eget effort — se `lasEffort` ovan.
 */
async function korMedEttOmforsok<T>(anrop: () => Promise<T>): Promise<T> {
  try {
    return await anrop();
  } catch (error) {
    if (!arAnslutningsfel(error)) throw error;
    console.log(`  Anslutningsfel (${felText(error)}) — gör ett omförsök...`);
    return await anrop();
  }
}

async function loadFixtures(): Promise<AnswerKeyFixture[]> {
  const files = (await readdir(ANSWER_KEY_DIR)).filter((f) => f.endsWith(".json")).sort();
  const alla: AnswerKeyFixture[] = await Promise.all(
    files.map(async (f) => JSON.parse(await readFile(path.join(ANSWER_KEY_DIR, f), "utf-8"))),
  );
  const aktiva = alla.filter((f) => !f.obsolet);

  // Loan keys (round 2026-10-24b): attached to the fixture of the same orgnr; a
  // loan key without a nyckeltal fixture (Pontonjären 3) becomes a fixture that
  // scores only its loans.
  let lanFiler: string[] = [];
  try {
    lanFiler = (await readdir(ANSWER_KEY_LAN_DIR)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    // No loan keys — fine.
  }
  for (const f of lanFiler) {
    const lan = JSON.parse(
      await readFile(path.join(ANSWER_KEY_LAN_DIR, f), "utf-8"),
    ) as LanFacitFil & Pick<AnswerKeyFixture, "orgnr" | "namn" | "kalla">;
    const fixture = aktiva.find((a) => a.orgnr === lan.orgnr);
    if (fixture) fixture.lanFacit = lan;
    else {
      aktiva.push({
        orgnr: lan.orgnr,
        namn: lan.namn,
        kalla: lan.kalla,
        nyckeltal: {},
        lanFacit: lan,
      });
    }
  }
  // VERIFY_ONLY=<orgnr>,<orgnr>: score only these reports (saves spend when a
  // change only needs a subset re-checked).
  const bara = (process.env["VERIFY_ONLY"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return bara.length > 0 ? aktiva.filter((a) => bara.includes(a.orgnr)) : aktiva;
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

  const model = process.env["ANTHROPIC_MODEL"] || STANDARD_MODELL;
  const maxCostSek = Number(process.env["MAX_COST_PER_ANALYSIS_SEK"] ?? "5");
  // A scanned report needs headroom for the parallel transcription chunks' joint
  // worst case (see transkribera); MAX_COST_PER_ANALYSIS_SEK wins when set.
  const maxCostSekSkannad = Number(process.env["MAX_COST_PER_ANALYSIS_SEK"] ?? "25");
  const effortTranskribering = lasEffort("ANTHROPIC_EFFORT_TRANSKRIBERING");
  const effortGrounding = lasEffort("ANTHROPIC_EFFORT_GROUNDING");
  const effortExtraction = lasEffort("ANTHROPIC_EFFORT_EXTRACTION");
  // ANTHROPIC_PROMPT_CACHE: unset/off = no breakpoints (production default), "system" or "on" for measurement.
  const cacheEnv = (process.env["ANTHROPIC_PROMPT_CACHE"] ?? "").toLowerCase();
  const promptCache = cacheEnv === "on" ? true : cacheEnv === "system" ? "system" : false;
  // VERIFY_FROM_RESULTS=<dir>: score saved results instead of calling the API
  // (no spend). Expects <dir>/<kalla.fil>.json, the stdout of `npm run extract
  // -- <pdf> <input.json>` (a full AnalysisResult) or of `npm run extract --
  // <pdf>` (an ExtractionResult); only `.forening` is read. Fixtures without a
  // file are skipped.
  const fromResultsDir = process.env["VERIFY_FROM_RESULTS"];
  // VERIFY_SAVE_RESULTS=<dir>: write each live result (+ page-reference findings
  // and the per-call records) to <dir>/<pdf>.json, so it can be re-scored for free.
  const sparResultatDir = process.env["VERIFY_SAVE_RESULTS"];
  const fixtures = await loadFixtures();

  const verifierad = nyRakning();
  const utkast = nyRakning();
  // Task 1.5's "Övrig info"-fält för fixturer som INTE (ännu) satt
  // ovrigInfoVerifierad: true — eget, alltid-utkast-läge (se
  // OvrigInfoForvantat's filkommentar), oavsett om samma fixtures nyckeltal
  // redan är verifierade. En fixture med ovrigInfoVerifierad: true räknas
  // istället in i samma rakning (verifierad/utkast) som nyckeltal — se loopen.
  const ovrigInfo = nyRakning();
  const ovrigInfoRapporter: string[] = [];
  const ovrigInfoVerifieradeRapporter: string[] = [];
  let hoppadeOver = 0;
  let misslyckade = 0;
  const utkastRapporter: string[] = [];
  const sanityRader: string[] = [];
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

    let pdfBytes: Uint8Array = new Uint8Array(0);
    let sparatResultat:
      | {
          forening: Awaited<ReturnType<typeof runStructuredExtraction>>["extraction"]["forening"];
          datakvalitet?: Awaited<
            ReturnType<typeof runStructuredExtraction>
          >["extraction"]["datakvalitet"];
        }
      | undefined;
    if (fromResultsDir) {
      // Saved results are named after the PDF file itself, not its subdirectory.
      const resultPath = path.join(fromResultsDir, `${path.basename(fixture.kalla.fil)}.json`);
      try {
        sparatResultat = JSON.parse(await readFile(resultPath, "utf-8"));
      } catch {
        console.log(`  HOPPAR ÖVER — hittar inte sparat resultat ${resultPath}`);
        hoppadeOver++;
        continue;
      }
    } else {
      try {
        pdfBytes = new Uint8Array(await readFile(pdfPath));
      } catch {
        console.log(`  HOPPAR ÖVER — hittar inte ${pdfPath}`);
        hoppadeOver++;
        continue;
      }
    }

    // En rapport som kraschar får inte sänka hela körningen — de övriga
    // fixturerna ska fortfarande köras och rapporteras.
    //
    // Två separata anrop, vart och ett med sitt eget effort — se lasEffort
    // ovan och cli.ts, som gör samma uppdelning för samma skäl (matchar
    // produktionens steg.ts, som kör grundning och extraktion i två skilda
    // Edge Function-invokeringar).
    let extraction: Awaited<ReturnType<typeof runStructuredExtraction>>["extraction"];
    let spentSek: number;
    let calls: ModelCallMetrics[];
    let steg: StegTid[] = [];
    let textlager: string | undefined;
    let sidreferenser: Sidreferensfynd[] = [];
    const wallStart = performance.now();
    try {
      if (sparatResultat) {
        // Saved result: nothing is called, so no cost/latency to report.
        extraction = {
          forening: sparatResultat.forening,
          ...(sparatResultat.datakvalitet ? { datakvalitet: sparatResultat.datakvalitet } : {}),
        } as Awaited<ReturnType<typeof runStructuredExtraction>>["extraction"];
        spentSek = 0;
        calls = [];
      } else {
        // Text layer: grounding on the PDF. No text layer: transcription ->
        // grounding over it (korExtraktion decides, same code as cli.ts).
        const korning = await korExtraktion(pdfBytes, {
          model,
          maxCostSek,
          maxCostSekSkannad,
          effortTranskribering,
          effortGrounding,
          effortExtraction,
          promptCache,
          omforsok: korMedEttOmforsok,
          logg: (rad) => console.log(`  ${rad}`),
        });
        extraction = korning.extraction;
        spentSek = korning.spentSek;
        calls = korning.calls;
        steg = korning.steg;
        textlager = korning.textlager;
        sidreferenser = korning.sidreferenser;
      }
    } catch (error) {
      console.log(`  MISSLYCKADES — ${fixture.kalla.fil}: ${felText(error)}`);
      misslyckade++;
      continue;
    }
    const wallMs = performance.now() - wallStart;
    totalWallMs += wallMs;
    allaAnrop.push(...calls);

    if (textlager !== undefined) {
      console.log(
        `  Textlager: ${textlager}. Steg: ` +
          steg
            .map(
              (t) => `${t.stage} ${(t.wallMs / 1000).toFixed(1)} s (${t.spentSek.toFixed(2)} kr)`,
            )
            .join(", "),
      );
    }
    if (extraction.datakvalitet?.kalla) {
      console.log(
        `  Källa: ${extraction.datakvalitet.kalla}, konfidens: ${extraction.datakvalitet.extraktionKonfidens.niva}`,
      );
    }

    // Page-reference check (sidreferenser.ts): printed for every report, every
    // finding that is not "ok" is listed.
    if (!sparatResultat) {
      const sr = sammanfattaSidreferenser(sidreferenser);
      console.log(
        `  Sidreferenser: ${sr.ok}/${sr.kontrollerade} stämde, ${sr.korrigerade} korrigerade, ` +
          `${sr.saknas} osäkra, ${sr.ejKontrollerbara} ej kontrollerbara`,
      );
      for (const f of sidreferenser.filter((x) => x.status !== "ok")) {
        console.log(
          `    ${f.status} ${f.sokvag} (sida ${f.sida}${f.nySida ? ` -> ${f.nySida}` : ""}` +
            `${f.andraSidor?.length ? `, finns på ${f.andraSidor.join("/")}` : ""}): "${f.utdrag.slice(0, 80)}"`,
        );
      }
    }
    for (const a of extraction.forening.adresser ?? []) {
      console.log(
        `  Adress: ${a.gatuadress}${a.postnummer ? `, ${a.postnummer}` : ""}${a.ort ? ` ${a.ort}` : ""}` +
          ` (sida ${a.ref.page}: "${a.ref.excerpt ?? ""}")`,
      );
    }
    for (const b of extraction.forening.fastighetsbeteckningar ?? []) {
      console.log(
        `  Fastighetsbeteckning: ${b.beteckning} (sida ${b.ref.page}: "${b.ref.excerpt ?? ""}")`,
      );
    }
    if (sparResultatDir && !sparatResultat) {
      // Same shape `VERIFY_FROM_RESULTS` reads back (only `.forening` and
      // `.datakvalitet` are used), plus the page-reference findings and the raw
      // per-call records for docs/api-runs.
      await mkdir(sparResultatDir, { recursive: true });
      const namn = path.basename(fixture.kalla.fil);
      await writeFile(
        path.join(sparResultatDir, `${namn}.json`),
        JSON.stringify({ ...extraction, sidreferenser }, null, 2),
      );
      await writeFile(
        path.join(sparResultatDir, `${namn}.calls.json`),
        JSON.stringify(
          { textlager, steg, calls, spentSek, wallMs: performance.now() - wallStart },
          null,
          2,
        ),
      );
    }

    // Nyckeltal and lanebok score into the draft tally when the key's values are a
    // draft (whole fixture, or `nyckeltalUtkast` for only these values).
    const rakningNyckeltal = arNyckeltalUtkast(fixture) ? utkast : verifierad;
    if (fixture.nyckeltalUtkast && !arUtkast(fixture) && !utkastRapporter.includes(fixture.namn)) {
      utkastRapporter.push(`${fixture.namn} (endast nyckeltal)`);
    }
    for (const [id, forvantat] of Object.entries(fixture.nyckeltal)) {
      const kf = extraction.forening.keyFigures.find((k) => k.id === id);
      const sidaInfo =
        fixture.nyckeltalSida !== undefined && kf?.figure.ref?.page !== undefined
          ? kf.figure.ref.page === fixture.nyckeltalSida
            ? ""
            : ` [citerad sida ${kf.figure.ref.page}, facit-tabellen på sida ${fixture.nyckeltalSida}]`
          : "";
      const osakerInfo = kf?.figure.osaker ? ` [OSÄKER: ${kf.figure.osaker}]` : "";
      if (kf?.figure.osaker) {
        const ratt =
          typeof forvantat === "number"
            ? kf.figure.value === forvantat
              ? "siffran var RÄTT (falsklarm)"
              : "siffran var FEL (träff)"
            : forvantat === null
              ? kf.figure.value === null
                ? "siffran var RÄTT (falsklarm)"
                : "siffran var FEL (träff)"
              : "tecken-facit";
        sanityRader.push(`${fixture.namn} · ${id}: ${ratt} — ${kf.figure.osaker}`);
      }

      if (forvantat === null) {
        // The report prints no such figure — the extraction must not invent one.
        const r = kf?.figure.value === null || kf === undefined;
        rakningNyckeltal.totalFalt++;
        if (r) rakningNyckeltal.godkanda++;
        console.log(
          `  ${r ? "✓" : "✗"} ${id}: förväntat null (finns inte i rapporten), fick ${kf?.figure.value ?? "null"}${osakerInfo}`,
        );
        const forvantadStatus = bedomStatus(id as KeyFigureId, null).status;
        const statusGodkand = kf?.status === forvantadStatus;
        rakningNyckeltal.totalFalt++;
        if (statusGodkand) rakningNyckeltal.godkanda++;
        console.log(
          `  ${statusGodkand ? "✓" : "✗"} ${id}.status: förväntat "${forvantadStatus}", fick "${kf?.status ?? "saknas"}"`,
        );
      } else if (typeof forvantat === "number") {
        const r = jamforVarde(id, kf?.figure.value ?? null, forvantat, "exakt");
        rakningNyckeltal.totalFalt++;
        if (r.godkand) rakningNyckeltal.godkanda++;
        console.log(
          `  ${r.godkand ? "✓" : "✗"} ${id}: förväntat ${r.forvantat}, fick ${r.faktiskt ?? "null"}` +
            (kf?.figure.tryckt ? ` (tryckt: "${kf.figure.tryckt}")` : "") +
            sidaInfo +
            osakerInfo,
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
        rakningNyckeltal.totalFalt++;
        if (statusGodkand) rakningNyckeltal.godkanda++;
        console.log(
          `  ${statusGodkand ? "✓" : "✗"} ${id}.status: förväntat "${forvantadStatus}", fick "${kf?.status ?? "saknas"}"`,
        );
      } else {
        // Sign-only expectation (e.g. "neg") — see jamforTecken's doc comment.
        const r = jamforTecken(id, kf?.figure.value ?? null, kf?.figure.tecken, forvantat.tecken);
        rakningNyckeltal.totalFalt++;
        if (r.godkand) rakningNyckeltal.godkanda++;
        console.log(
          `  ${r.godkand ? "✓" : "✗"} ${id}.tecken: förväntat "${forvantat.tecken}", fick ` +
            `${kf?.figure.tecken ? `"${kf.figure.tecken}"` : "inget tecken"}` +
            ` (value: ${kf?.figure.value ?? "null"}${kf?.figure.tryckt ? `, tryckt: "${kf.figure.tryckt}"` : ""})`,
        );

        const forvantadStatus = bedomStatus(id as KeyFigureId, null, forvantat.tecken).status;
        const statusGodkand = kf?.status === forvantadStatus;
        rakningNyckeltal.totalFalt++;
        if (statusGodkand) rakningNyckeltal.godkanda++;
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
      rakningNyckeltal.totalFalt++;
      if (r.godkand) rakningNyckeltal.godkanda++;
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
      rakningNyckeltal.totalFalt++;
      if (r.godkand) rakningNyckeltal.godkanda++;
      const avvikelse =
        r.avvikelseProcent !== undefined ? ` (${r.avvikelseProcent.toFixed(2)}% avvikelse)` : "";
      console.log(
        `  ${r.godkand ? "✓" : "✗"} lanebok.snittranta: förväntat ${r.forvantat}, fick ${r.faktiskt ?? "null"}${avvikelse}`,
      );
    }

    // Loans (fixtures/answer-key-lan): a key still marked UTKAST scores into the
    // draft tally, whatever the rest of the fixture is.
    if (fixture.lanFacit) {
      const rakningLan =
        fixture.lanFacit.status?.toUpperCase() === "UTKAST" || arUtkast(fixture)
          ? utkast
          : verifierad;
      const lanebok = extraction.forening.lanebok;
      const poang = poangsattLan(fixture.lanFacit, {
        balansdag: extraction.forening.balansdag,
        lan: lanebok?.lan,
        rantekostnader: lanebok?.rantekostnader,
      });
      console.log(
        `  Lån (facit ${fixture.lanFacit.status ?? "verifierad"}): ${lanebok?.lan?.length ?? 0} extraherade, ${fixture.lanFacit.lan.length} i facit`,
      );
      for (const p of poang) {
        rakningLan.totalFalt++;
        if (p.godkand) rakningLan.godkanda++;
        console.log(
          `  ${p.godkand ? "✓" : "✗"} ${p.falt}: förväntat ${p.forvantat}, fick ${p.faktiskt}`,
        );
      }
      for (const l of lanebok?.lan ?? []) {
        console.log(
          `  · lån ${l.kreditgivare ?? "?"} ${l.belopp.value ?? "null"} kr, ${l.ranta?.value ?? "?"} %, ` +
            `${l.villkorsandringsdag ?? "ingen dag"}, ${l.rantetyp}${l.belopp.osaker ? " [OSÄKER]" : ""} (sida ${l.ref.page})`,
        );
      }
      if (!utkastRapporter.includes(fixture.namn) && rakningLan === utkast) {
        utkastRapporter.push(`${fixture.namn} (endast lån)`);
      }
    }

    // Information only (not scored): the raw totals vs the key author's, and every
    // reason confidence was lowered (incl. the deterministic sanity checks).
    if (extraction.kontrollsummor && fixture.kontrollsummor) {
      for (const [nyckel, forvantat] of Object.entries(fixture.kontrollsummor)) {
        const fick = (
          extraction.kontrollsummor as Record<string, { value: number | null } | undefined>
        )[nyckel];
        console.log(
          `  · kontrollsumma ${nyckel}: facit ${forvantat}, fick ${fick?.value ?? "ej extraherad"}`,
        );
      }
    }
    for (const skal of extraction.datakvalitet?.extraktionKonfidens.skal ?? []) {
      console.log(`  · konfidensskäl: ${skal}`);
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
      // See OvrigInfoForvantat's doc comment: a fixture whose owner has read
      // ovrigInfo against the original PDF (ovrigInfoVerifierad: true) scores
      // into the SAME tally as its nyckeltal (verified or draft, whichever
      // the fixture already is) — everyone else still scores into the
      // separate, always-draft `ovrigInfo` tally, unchanged from before.
      const rakningOvrig = fixture.ovrigInfoVerifierad ? rakning : ovrigInfo;
      (fixture.ovrigInfoVerifierad ? ovrigInfoVerifieradeRapporter : ovrigInfoRapporter).push(
        fixture.namn,
      );
      const forening = extraction.forening;
      const oi = fixture.ovrigInfo;

      if (oi.antalMedlemmar !== undefined) {
        const r = jamforVarde(
          "antalMedlemmar",
          forening.antalMedlemmar?.value ?? null,
          oi.antalMedlemmar,
          "exakt",
        );
        rakningOvrig.totalFalt++;
        if (r.godkand) rakningOvrig.godkanda++;
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
        rakningOvrig.totalFalt++;
        if (r.godkand) rakningOvrig.godkanda++;
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
        rakningOvrig.totalFalt++;
        if (r.godkand) rakningOvrig.godkanda++;
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
          rakningOvrig.totalFalt++;
          if (r.godkand) rakningOvrig.godkanda++;
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
          rakningOvrig.totalFalt++;
          if (r.godkand) rakningOvrig.godkanda++;
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
        : ""),
  );

  console.log(`\n${"=".repeat(70)}`);
  console.log("RIMLIGHETSKONTROLLER SOM SLOG TILL (siffra markerad osäker):");
  if (sanityRader.length === 0) console.log("  Inga.");
  for (const rad of sanityRader) console.log(`  - ${rad}`);

  if (utkastRapporter.length > 0) {
    console.log(
      `\nUTKAST — INTE verifierade mot originalrapporten av produktägaren (rapporteras separat, räknas INTE in ovan):`,
    );
    console.log(`  Rapporter: ${utkastRapporter.join(", ")}`);
    console.log(`  ${utkast.godkanda}/${utkast.totalFalt} fält godkända (utkast).`);
  }

  if (ovrigInfoVerifieradeRapporter.length > 0) {
    console.log(
      `\nÖVRIG INFO (task 1.5), VERIFIERAD — produktägaren har läst dessa fält mot originalrapporten ` +
        `(ovrigInfoVerifierad: true), räknas in i tabellen ovan (VERIFIERADE eller UTKAST beroende på ` +
        `fixturens övriga status, se resp. rapport ovan):`,
    );
    console.log(`  Rapporter: ${ovrigInfoVerifieradeRapporter.join(", ")}`);
  }

  if (ovrigInfoRapporter.length > 0) {
    console.log(
      `\nÖVRIG INFO (task 1.5), UTKAST — INTE lästa av produktägaren än (ingen ovrigInfoVerifierad: true), räknas INTE in ovan:`,
    );
    console.log(`  Rapporter: ${ovrigInfoRapporter.join(", ")}`);
    console.log(`  ${ovrigInfo.godkanda}/${ovrigInfo.totalFalt} fält godkända (utkast).`);
  }

  const allaGodkanda = verifierad.godkanda === verifierad.totalFalt;
  process.exitCode = allaGodkanda && hoppadeOver === 0 && misslyckade === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error("Oväntat fel:", error);
  process.exitCode = 1;
});
