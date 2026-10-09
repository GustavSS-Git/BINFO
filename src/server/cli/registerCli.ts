/**
 * Admin CLI for the register of analysed reports (src/server/register.ts).
 *
 *   npm run register -- list [--orgnr X] [--limit N]
 *   npm run register -- inspect <rapportId> | inspect <orgnr> <år>
 *   npm run register -- invalidate <rapportId> [--all-versions] [--force]
 *   npm run register -- backfill-legacy [--dry-run]
 *   npm run register -- rerun --to-current [--limit N] [--dry-run]
 *
 * Talks to the LIVE project with the secret key (`envFromProcess`, i.e.
 * PROJECT_URL / PROJECT_SECRET_KEY from .env.local). Never calls Anthropic
 * itself: `rerun` only queues rapporter — the Edge Function worker runs them,
 * spend-guarded by the daily cap like any other job.
 *
 * The functions below take a `Lager`, so they are tested against the
 * in-memory fake (registerCli.test.ts); `main` is the thin argv wrapper.
 * Results go to stdout, progress/errors to stderr.
 */

import { pathToFileURL } from "node:url";
import { PROMPT_VERSION } from "@/lib/analysis/prompts";
import { envFromProcess } from "../env";
import type { Lager, RapportFilRad, RapportRad, RapportStatus } from "../portar";
import { arGiltigtOrgnr, namnLiknar, type Rapportidentitet } from "@/lib/analysis/identitet";
import {
  arAktiv,
  arGiltigIdentitet,
  hittaOmkorning,
  koaOmkorning,
  PIPELINE_VERSION,
  rapportensPdfSokvag,
  skapaRapportMedPlats,
  tolkaRapportInnehall,
} from "../register";
import { skapaLager } from "../supabase";

// ---------------------------------------------------------------------------
// list / inspect
// ---------------------------------------------------------------------------

export interface RapportSammanfattning {
  id: string;
  orgnr: string | null;
  rakenskapsar: number | null;
  namn: string | null;
  pipelineVersion: string;
  aktuellVersion: boolean;
  /** Stored extraction + judgement parse with the running code. */
  kompatibel: boolean;
  model: string;
  status: RapportStatus;
  stage: RapportRad["stage"];
  textlager: RapportRad["textlager"];
  attempts: number;
  costSek: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  errorCode: string | null;
  createdAt: string;
  finishedAt: string | null;
  ersattAv: string | null;
}

async function sammanfatta(lager: Lager, r: RapportRad): Promise<RapportSammanfattning> {
  const forening = r.orgnr ? await lager.db.hamtaForening(r.orgnr) : null;
  return {
    id: r.id,
    orgnr: r.orgnr,
    rakenskapsar: r.rakenskapsar,
    namn: forening?.namn ?? null,
    pipelineVersion: r.pipelineVersion,
    aktuellVersion: r.pipelineVersion === PIPELINE_VERSION,
    kompatibel: r.status === "done" && tolkaRapportInnehall(r) !== null,
    model: r.model,
    status: r.status,
    stage: r.stage,
    textlager: r.textlager,
    attempts: r.attempts,
    costSek: r.costSek,
    cacheReadTokens: r.cacheReadTokens,
    cacheWriteTokens: r.cacheWriteTokens,
    errorCode: r.errorCode,
    createdAt: r.createdAt,
    finishedAt: r.finishedAt,
    ersattAv: r.ersattAv,
  };
}

export async function listaRegister(
  lager: Lager,
  args: { orgnr?: string; limit?: number },
): Promise<RapportSammanfattning[]> {
  const rader = await lager.db.listaRapporter({
    ...(args.orgnr !== undefined ? { orgnr: args.orgnr } : {}),
    limit: args.limit ?? 50,
  });
  return Promise.all(rader.map((r) => sammanfatta(lager, r)));
}

export interface Inspektion {
  rapport: RapportSammanfattning;
  errorMessage: string | null;
  filer: Array<RapportFilRad & { pdfFinns: boolean }>;
  /** Analys rows linked to this rapport (capped at 1000). */
  antalAnalyser: number;
  /** The storage path the worker would read, and whether it exists. */
  pdfSokvag: string | null;
  pdfFinns: boolean;
}

export async function inspektera(
  lager: Lager,
  args: { rapportId: string } | { orgnr: string; rakenskapsar: number },
): Promise<Inspektion[]> {
  const rader =
    "rapportId" in args
      ? [await lager.db.hamtaRapport(args.rapportId)].filter((r): r is RapportRad => r !== null)
      : await lager.db.listaRapporter({ orgnr: args.orgnr, rakenskapsar: args.rakenskapsar });

  const resultat: Inspektion[] = [];
  for (const r of rader) {
    const filer = await lager.db.listaRapportFiler(r.id);
    const pdfSokvag = await rapportensPdfSokvag(lager.db, r);
    resultat.push({
      rapport: await sammanfatta(lager, r),
      errorMessage: r.errorMessage,
      filer: await Promise.all(
        filer.map(async (f) => ({ ...f, pdfFinns: await lager.filer.finns(f.pdfPath) })),
      ),
      antalAnalyser: (await lager.db.hamtaAnalyserForRapport(r.id, 1000)).length,
      pdfSokvag,
      pdfFinns: pdfSokvag !== null && (await lager.filer.finns(pdfSokvag)),
    });
  }
  return resultat;
}

// ---------------------------------------------------------------------------
// invalidate
// ---------------------------------------------------------------------------

export const OGILTIGFORKLARAD_MEDDELANDE = "Ogiltigförklarad av administratör (npm run register).";

export interface OgiltigforklaraOptions {
  /** Also invalidate a rapport a worker is running right now. Safe: every
   *  worker write is leased (`uppdateraLeasadRapport`), so the running step's
   *  result is dropped instead of overwriting the invalidation. */
  force?: boolean;
  /** Every live rapport for the same report — same (orgnr, år) at any
   *  pipeline version, or, without identity, the same bytes. */
  allaVersioner?: boolean;
}

/**
 * Marks rapporter failed with error_code 'ogiltigforklarad'. That frees their
 * unique slots (both indexes skip failed rows), so the next upload of the
 * report registers and runs it afresh. Buyers already linked see "Analysen …
 * har dragits tillbaka. Ladda upp den igen" (fel.ts) — unless a newer run of
 * the same report exists, whose progress/result they then get. Refuses a
 * running rapport without `force`, and checks every target before writing
 * any.
 */
export async function ogiltigforklara(
  lager: Lager,
  rapportId: string,
  options: OgiltigforklaraOptions = {},
): Promise<Array<{ id: string; tidigareStatus: RapportStatus }>> {
  const r = await lager.db.hamtaRapport(rapportId);
  if (!r) throw new Error(`Ingen rapport med id ${rapportId}.`);
  if (r.status === "ersatt") {
    throw new Error(
      `Rapport ${rapportId} är redan ersatt av ${r.ersattAv ?? "?"} — ogiltigförklara den i stället.`,
    );
  }

  let mal: RapportRad[] = [r];
  if (options.allaVersioner) {
    const samma =
      r.orgnr !== null && r.rakenskapsar !== null
        ? await lager.db.listaRapporter({ orgnr: r.orgnr, rakenskapsar: r.rakenskapsar })
        : r.pdfHash !== null
          ? await lager.db.listaRapporter({ pdfHash: r.pdfHash })
          : [r];
    mal = samma.filter((m) => m.id === r.id || arAktiv(m));
  }

  const kors = mal.filter((m) => m.status === "running");
  if (kors.length > 0 && !options.force) {
    throw new Error(
      `${kors.map((m) => m.id).join(", ")} körs just nu (lease till ` +
        `${kors.map((m) => m.leaseUntil ?? "?").join(", ")}). Vänta tills steget är klart, ` +
        "eller kör med --force (stegets resultat släpps då i stället för att skrivas).",
    );
  }

  const resultat: Array<{ id: string; tidigareStatus: RapportStatus }> = [];
  for (const m of mal) {
    await lager.db.uppdateraRapport(m.id, {
      status: "failed",
      errorCode: "ogiltigforklarad",
      errorMessage: OGILTIGFORKLARAD_MEDDELANDE,
      leaseUntil: null,
      finishedAt: new Date().toISOString(),
    });
    resultat.push({ id: m.id, tidigareStatus: m.status });
  }
  return resultat;
}

// ---------------------------------------------------------------------------
// backfill-legacy
// ---------------------------------------------------------------------------

export type BackfillUtfall =
  | "skapad"
  | "kopplad_till_befintlig"
  | "skulle_skapas"
  | "redan_i_registret"
  | "saknar_bedomning"
  | "inkompatibel";

export interface BackfillRad {
  pdfHash: string;
  model: string;
  orgnr: string | null;
  rakenskapsar: number | null;
  utfall: BackfillUtfall;
  /** Whether the rapport carries (or would carry) the identity. False =
   *  hash-only: no valid (Luhn) orgnr/year, or the name rule refused it. */
  medIdentitet?: boolean;
  rapportId?: string;
  pdfSokvag?: string;
  /** False = the PDF is gone (pre-register 30-day retention): the result is
   *  reusable by hash/identity, but can never be re-run. */
  pdfFinns?: boolean;
}

/**
 * One-off, idempotent: moves the legacy caches (extraktion_cache +
 * analys_cache) of the CURRENT PROMPT_VERSION into the register, so no report
 * a buyer already paid for is paid for again after the switch. Every cache
 * row with a judgement that parses becomes (or joins) a 'done' rapport at the
 * current PIPELINE_VERSION (same prompts; the identity prompt never ran,
 * which does not affect the result), plus a rapport_fil row for its bytes
 * (PDF path from the analys rows, default `<hash>.pdf`):
 *   - with a Luhn-valid orgnr + year and no name conflict → with identity;
 *     another byte version of the same report joins that rapport only when
 *     BOTH names are known and alike (the upload rule);
 *   - otherwise → a hash-only rapport (identity null), reusable by its bytes.
 * A hash already in rapport_fil is skipped, so re-running is a no-op.
 */
export async function backfillLegacy(
  lager: Lager,
  args: { dryRun: boolean },
): Promise<BackfillRad[]> {
  const { db } = lager;
  const resultat: BackfillRad[] = [];

  for (const rad of await db.listaExtraktionCache(PROMPT_VERSION)) {
    const bas = {
      pdfHash: rad.pdfHash,
      model: rad.model,
      orgnr: rad.orgnr,
      rakenskapsar: rad.rakenskapsar,
    };
    if (await db.hamtaRapportFil(rad.pdfHash)) {
      resultat.push({ ...bas, utfall: "redan_i_registret" });
      continue;
    }
    const bedomning = await db.hamtaAnalysCache(rad.pdfHash, rad.model, rad.promptVersion);
    if (!bedomning) {
      resultat.push({ ...bas, utfall: "saknar_bedomning" });
      continue;
    }
    const innehall = tolkaRapportInnehall({
      extraction: rad.extraction,
      judgement: bedomning.judgement,
    });
    if (!innehall) {
      resultat.push({ ...bas, utfall: "inkompatibel" });
      continue;
    }

    const namn = innehall.extraction.forening.namn.trim() || null;
    let identitet: Rapportidentitet | null =
      rad.orgnr !== null && rad.rakenskapsar !== null
        ? { orgnr: rad.orgnr, rakenskapsar: rad.rakenskapsar, namn }
        : null;
    if (identitet && !arGiltigIdentitet(identitet)) identitet = null;
    if (identitet) {
      const registrerat = (await db.hamtaForening(identitet.orgnr))?.namn ?? null;
      if (registrerat && identitet.namn && !namnLiknar(registrerat, identitet.namn)) {
        identitet = null; // a misread orgnr must not claim the slot
      }
    }

    const pdfSokvag = (await db.hamtaPdfSokvagForHash(rad.pdfHash)) ?? `${rad.pdfHash}.pdf`;
    const pdfFinns = await lager.filer.finns(pdfSokvag);
    if (args.dryRun) {
      resultat.push({
        ...bas,
        utfall: "skulle_skapas",
        medIdentitet: identitet !== null,
        pdfSokvag,
        pdfFinns,
      });
      continue;
    }

    const ny = (id: Rapportidentitet | null) =>
      skapaRapportMedPlats(db, {
        orgnr: id?.orgnr ?? null,
        rakenskapsar: id?.rakenskapsar ?? null,
        pipelineVersion: PIPELINE_VERSION,
        model: rad.model,
        textlager: "ok",
        status: "done",
        stage: "klar",
        pdfHash: rad.pdfHash,
        extraction: rad.extraction,
        judgement: bedomning.judgement,
        costSek: Math.round((rad.costSek + bedomning.costSek) * 100) / 100,
        finishedAt: rad.createdAt,
      });

    let rapportId: string | null = null;
    let utfall: BackfillUtfall = "skapad";
    let medIdentitet = false;
    if (identitet) {
      await db.registreraForening(identitet.orgnr, identitet.namn);
      const insatt = await ny(identitet);
      if (insatt.ok) {
        rapportId = insatt.id;
        medIdentitet = true;
      } else {
        // Another byte version of the same report holds the slot: join it
        // only under the full name rule (both known and alike).
        const registrerat = (await db.hamtaForening(identitet.orgnr))?.namn ?? null;
        if (registrerat && identitet.namn && namnLiknar(registrerat, identitet.namn)) {
          rapportId = insatt.innehavare.rapport.id;
          utfall = "kopplad_till_befintlig";
          medIdentitet = true;
        }
      }
    }
    if (rapportId === null) {
      const insatt = await ny(null);
      if (insatt.ok) {
        rapportId = insatt.id;
      } else {
        rapportId = insatt.innehavare.rapport.id;
        utfall = "kopplad_till_befintlig";
      }
    }

    await db.skapaRapportFil({
      pdfHash: rad.pdfHash,
      rapportId,
      pdfPath: pdfSokvag,
      sidor: null,
      bytes: null,
    });
    resultat.push({ ...bas, utfall, medIdentitet, rapportId, pdfSokvag, pdfFinns });
  }
  return resultat;
}

// ---------------------------------------------------------------------------
// rerun --to-current
// ---------------------------------------------------------------------------

export interface OmkorningsRad {
  kallaId: string;
  orgnr: string | null;
  rakenskapsar: number | null;
  pipelineVersion: string;
  utfall: "koad" | "skulle_koas" | "finns" | "pdf_saknas";
  rapportId?: string;
}

/**
 * Queues a current-version re-run for every DONE rapport at an older
 * pipeline version that has none yet (same rule as the lazy re-run on read,
 * `koaOmkorning`). `limit` caps how many are queued (or would be, in a dry
 * run). Spend is guarded where it happens: the worker reserves against the
 * daily cap before each stage.
 */
export async function rerunTillAktuell(
  lager: Lager,
  args: { limit?: number; dryRun: boolean; model: string },
): Promise<OmkorningsRad[]> {
  const resultat: OmkorningsRad[] = [];
  let koade = 0;
  const gamla = (await lager.db.listaRapporter({})).filter(
    (r) => r.status === "done" && r.pipelineVersion !== PIPELINE_VERSION,
  );
  for (const r of gamla) {
    if (args.limit !== undefined && koade >= args.limit) break;
    const bas = {
      kallaId: r.id,
      orgnr: r.orgnr,
      rakenskapsar: r.rakenskapsar,
      pipelineVersion: r.pipelineVersion,
    };
    const befintlig = await hittaOmkorning(lager.db, r);
    if (befintlig) {
      resultat.push({ ...bas, utfall: "finns", rapportId: befintlig.id });
      continue;
    }
    if (args.dryRun) {
      const sokvag = await rapportensPdfSokvag(lager.db, r);
      const finns = sokvag !== null && (await lager.filer.finns(sokvag));
      resultat.push({ ...bas, utfall: finns ? "skulle_koas" : "pdf_saknas" });
      if (finns) koade++;
      continue;
    }
    const utfall = await koaOmkorning(lager, r, args.model);
    if (utfall.utfall === "pdf_saknas") {
      resultat.push({ ...bas, utfall: "pdf_saknas" });
      continue;
    }
    resultat.push({ ...bas, utfall: utfall.utfall, rapportId: utfall.rapportId });
    if (utfall.utfall === "koad") koade++;
  }
  return resultat;
}

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------

export type Kommando =
  | { typ: "list"; orgnr?: string; limit?: number }
  | { typ: "inspect"; rapportId: string }
  | { typ: "inspect"; orgnr: string; rakenskapsar: number }
  | { typ: "invalidate"; rapportId: string; force: boolean; allaVersioner: boolean }
  | { typ: "backfill-legacy"; dryRun: boolean }
  | { typ: "rerun"; limit?: number; dryRun: boolean };

export const ANVANDNING = [
  "Användning:",
  "  npm run register -- list [--orgnr X] [--limit N]",
  "  npm run register -- inspect <rapportId> | inspect <orgnr> <år>",
  "  npm run register -- invalidate <rapportId> [--all-versions] [--force]",
  "  npm run register -- backfill-legacy [--dry-run]",
  "  npm run register -- rerun --to-current [--limit N] [--dry-run]",
].join("\n");

function flaggvarde(argv: readonly string[], flagga: string): string | undefined {
  const i = argv.indexOf(flagga);
  return i === -1 ? undefined : argv[i + 1];
}

function positivtHeltal(rått: string | undefined, namn: string): number | undefined {
  if (rått === undefined) return undefined;
  const tal = Number(rått);
  if (!Number.isInteger(tal) || tal <= 0)
    throw new Error(`${namn} måste vara ett positivt heltal.`);
  return tal;
}

/** Throws with a usage-friendly message on anything it does not recognise. */
export function tolkaArgument(argv: readonly string[]): Kommando {
  const [kommando, ...resten] = argv;
  const dryRun = resten.includes("--dry-run");
  switch (kommando) {
    case "list": {
      const orgnr = flaggvarde(resten, "--orgnr");
      const limit = positivtHeltal(flaggvarde(resten, "--limit"), "--limit");
      return {
        typ: "list",
        ...(orgnr !== undefined ? { orgnr } : {}),
        ...(limit !== undefined ? { limit } : {}),
      };
    }
    case "inspect": {
      const [forsta, andra] = resten;
      if (forsta && andra) {
        const ar = positivtHeltal(andra, "år");
        if (!arGiltigtOrgnr(forsta) || ar === undefined) {
          throw new Error("inspect <orgnr> <år> kräver orgnr på formen NNNNNN-NNNN och ett år.");
        }
        return { typ: "inspect", orgnr: forsta, rakenskapsar: ar };
      }
      if (forsta) return { typ: "inspect", rapportId: forsta };
      throw new Error("inspect kräver ett rapport-id eller orgnr + år.");
    }
    case "invalidate": {
      const [rapportId] = resten;
      if (!rapportId || rapportId.startsWith("--")) {
        throw new Error("invalidate kräver ett rapport-id.");
      }
      return {
        typ: "invalidate",
        rapportId,
        force: resten.includes("--force"),
        allaVersioner: resten.includes("--all-versions"),
      };
    }
    case "backfill-legacy":
      return { typ: "backfill-legacy", dryRun };
    case "rerun": {
      if (!resten.includes("--to-current")) {
        throw new Error("rerun kräver --to-current (den enda målversionen som stöds).");
      }
      const limit = positivtHeltal(flaggvarde(resten, "--limit"), "--limit");
      return { typ: "rerun", dryRun, ...(limit !== undefined ? { limit } : {}) };
    }
    default:
      throw new Error(`Okänt kommando "${kommando ?? ""}".`);
  }
}

async function main(): Promise<void> {
  let kommando: Kommando;
  try {
    kommando = tolkaArgument(process.argv.slice(2));
  } catch (fel) {
    console.error(`${fel instanceof Error ? fel.message : String(fel)}\n\n${ANVANDNING}`);
    process.exitCode = 1;
    return;
  }

  const env = envFromProcess();
  const lager = skapaLager(env);
  console.error(`PIPELINE_VERSION=${PIPELINE_VERSION} (LIVE-projekt: ${env.supabaseUrl})`);

  let utdata: unknown;
  switch (kommando.typ) {
    case "list":
      utdata = await listaRegister(lager, kommando);
      break;
    case "inspect":
      utdata = await inspektera(lager, kommando);
      break;
    case "invalidate":
      utdata = await ogiltigforklara(lager, kommando.rapportId, kommando);
      break;
    case "backfill-legacy":
      utdata = await backfillLegacy(lager, kommando);
      break;
    case "rerun":
      utdata = await rerunTillAktuell(lager, { ...kommando, model: env.anthropicModel });
      break;
  }
  console.log(JSON.stringify(utdata, null, 2));
}

const korsSomSkript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (korsSomSkript) {
  main().catch((fel: unknown) => {
    console.error(fel instanceof Error ? fel.message : fel);
    process.exitCode = 1;
  });
}
