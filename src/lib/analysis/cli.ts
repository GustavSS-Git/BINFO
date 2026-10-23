import { readFile } from "node:fs/promises";
import { ExtractionValidationError, ModelTruncatedError } from "./extract";
import { KostnadsgransOverskriden, STANDARD_MODELL } from "./costGuard";
import {
  ModelRefusedError,
  ScannedPdfError,
  TomTranskriptionError,
  type PromptCacheMode,
  type ModelEffort,
} from "./runExtraction";
import { korExtraktion } from "./korExtraktion";
import { sammanfattaSidreferenser } from "./sidreferenser";
import { TranskriberingMarkorFelError } from "./transkribering";
import { AnalysValidationError, runAnalys } from "./analyze";
// Never bundled for the client (this file is a Node CLI run via `tsx`, not
// part of the Vite/TanStack client graph) — importing STANDARD_EFFORT from
// src/server/ here is safe, and keeps this CLI's default in lockstep with
// production's (see env.ts's Env.effortGrounding doc comment) instead of
// letting the two silently drift apart.
import { STANDARD_EFFORT } from "@/server/env";
import { AssemblyValidationError, assembleraAnalys } from "./assemble";
import { kontrolleraInputfilText } from "./inputFil";
import {
  cacheHitRate,
  errorHasKnownSpend,
  formatCallMetricsTable,
  totalCostSek,
  type ModelCallMetrics,
} from "./callMetrics";
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

/** ANTHROPIC_PROMPT_CACHE: unset/"off" = no breakpoints (the production
 *  default — measured 2026-10-09: an isolated report costs slightly MORE with
 *  caching, see docs/PLAN-v2.md §5); "system" = breakpoint on the static
 *  system block only (worth it for bursts, e.g. backfills); "on" = system +
 *  user (A/B measurement only). */
function lasPromptCache(): PromptCacheMode {
  const v = (process.env["ANTHROPIC_PROMPT_CACHE"] ?? "").toLowerCase();
  if (v === "on") return true;
  if (v === "system") return "system";
  return false;
}

class OgiltigInputfilError extends Error {
  constructor(fel: readonly string[]) {
    super(`Objektsfilen matchar inte förväntat format: ${fel.join("; ")}`);
    this.name = "OgiltigInputfilError";
  }
}

/**
 * Reads and validates the object file BEFORE any paid call (a missing
 * andelstal/orgnr used to surface only after ~3 kr of grounding and
 * extraction). Refuses exactly what the run would fail on anyway — the same
 * PropertyInputSchema assembly uses, strict wrapper included (see inputFil.ts);
 * optional fields that are absent only get a warning on stderr.
 */
async function lasOchKontrolleraInputfil(inputPath: string): Promise<PropertyInput> {
  const resultat = kontrolleraInputfilText(await readFile(inputPath, "utf-8"));
  if (!resultat.ok) throw new OgiltigInputfilError(resultat.fel);
  for (const varning of resultat.varningar) console.error(`VARNING: ${varning}`);
  return resultat.input;
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
function valjPrisdatakalla(input: {
  utgangspris?: number | undefined;
  boarea: number;
}): Prisdatakalla {
  const val = (process.env["PRISKALLA"] ?? "modell").toLowerCase();
  if (val === "tom") {
    return new TomPrisdatakalla();
  }
  if (val === "demo") {
    return new DemoPrisdatakalla({ utgangspris: input.utgangspris ?? 0, boarea: input.boarea });
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

  // Before the first byte is sent anywhere: an invalid object file fails here, for free.
  const input = inputPath ? await lasOchKontrolleraInputfil(inputPath) : undefined;

  const model = process.env["ANTHROPIC_MODEL"] || STANDARD_MODELL;
  const effortTranskribering = lasEffort("ANTHROPIC_EFFORT_TRANSKRIBERING");
  const effortGrounding = lasEffort("ANTHROPIC_EFFORT_GROUNDING");
  const effortExtraction = lasEffort("ANTHROPIC_EFFORT_EXTRACTION");
  const effortJudging = lasEffort("ANTHROPIC_EFFORT_JUDGING");
  const promptCache = lasPromptCache();

  const pdfBytes = new Uint8Array(await readFile(pdfPath));

  // A scanned PDF is transcribed in parallel chunks, whose worst cases are reserved
  // jointly (transkribera) — a 34-page report needs ~12 kr of headroom although it
  // costs ~5-6 kr in the end. Higher default than for a text report; the env wins.
  const maxCostEnv = process.env["MAX_COST_PER_ANALYSIS_SEK"];
  const maxCostSek = Number(maxCostEnv ?? "5");
  const maxCostSekSkannad = Number(maxCostEnv ?? "25");

  console.error(
    `Läser ${pdfPath} (modell: ${model}, kostnadstak: ${maxCostSek} kr (skannad: ${maxCostSekSkannad} kr), promptcache: ${promptCache ? "på" : "av"})...`,
  );

  const wallClockStart = performance.now();
  const allCalls: ModelCallMetrics[] = [];

  // Each stage keeps its own effort — mirrors production (steg.ts runs one stage per
  // Edge Function invocation). A PDF without a text layer takes the scan route:
  // transkribering -> grundning over the transcription -> extraktion (kalla 'skannad').
  const korning = await korExtraktion(pdfBytes, {
    model,
    maxCostSek,
    maxCostSekSkannad,
    effortTranskribering,
    effortGrounding,
    effortExtraction,
    promptCache,
    transkriptionsFil: process.env["TRANSKRIPTION_CACHE"],
    logg: (rad) => console.error(rad),
  });
  const extraction = korning.extraction;
  allCalls.push(...korning.calls);
  const spentExtraktion = korning.spentSek;
  const stegTider = korning.steg
    .map((t) => `${t.stage} ${(t.wallMs / 1000).toFixed(1)} s (${t.spentSek.toFixed(2)} kr)`)
    .join(", ");
  console.error(`Textlager: ${korning.textlager}. Steg: ${stegTider}.`);
  const sidref = sammanfattaSidreferenser(korning.sidreferenser);
  console.error(
    `Sidreferenser: ${sidref.ok}/${sidref.kontrollerade} stämde, ${sidref.korrigerade} korrigerade, ` +
      `${sidref.saknas} osäkra, ${sidref.ejKontrollerbara} ej kontrollerbara.`,
  );

  if (!input) {
    console.log(JSON.stringify(extraction, null, 2));
    console.error(formatCallMetricsTable(allCalls));
    console.error(
      `Klart (endast extraktion). Uppskattad kostnad: ${totalCostSek(allCalls).toFixed(2)} kr. ` +
        `Cache-träffar: ${(cacheHitRate(allCalls) * 100).toFixed(1)} %. ` +
        `Väggklocka: ${((performance.now() - wallClockStart) / 1000).toFixed(1)} s.`,
    );
    return;
  }

  console.error(
    `Extraktion klar (${spentExtraktion.toFixed(2)} kr). Kör analys och sammanställning...`,
  );

  const { analys, calls: analysCalls } = await runAnalys(extraction, {
    model,
    maxCostSek: korning.tak - spentExtraktion,
    effort: effortJudging,
    promptCache,
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
      `Cache-träffar: ${(cacheHitRate(allCalls) * 100).toFixed(1)} %. ` +
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
    error instanceof ModelTruncatedError ||
    error instanceof ModelRefusedError ||
    error instanceof TomTranskriptionError ||
    error instanceof TranskriberingMarkorFelError
  ) {
    console.error(`FEL: ${error.message}`);
  } else {
    console.error("Oväntat fel:", error);
  }
  if (errorHasKnownSpend(error)) {
    console.error(
      `Redan förbrukat när felet inträffade: ${error.spentSek.toFixed(2)} kr (${error.calls.length} anrop).`,
    );
  }
  process.exitCode = 1;
});
