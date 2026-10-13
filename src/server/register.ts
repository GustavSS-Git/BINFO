/**
 * The register of analysed reports (v2, docs/PLAN-v2.md §3).
 *
 * A `rapport` is one analysis of one årsredovisning, shared by every buyer
 * who uploads it, keyed on the BRF's orgnr + räkenskapsår + pipeline version.
 * A buyer's `analys` row is now only the per-user REQUEST (property_input)
 * and points at a rapport through `analys.rapport_id`. So a report is paid
 * for once, however many buyers — and however many byte versions of the same
 * PDF (`rapport_fil`, one row per sha256) — reach it.
 *
 * Concurrency rests on two database guarantees, both mirrored by the
 * in-memory fake:
 *   - `rapport_fil.pdf_hash` is a primary key: of two uploads of the same
 *     bytes, exactly one file row wins; the loser deletes its own (not yet
 *     referenced) rapport and links to the winner's.
 *   - the partial unique index on (orgnr, rakenskapsar, pipeline_version)
 *     over non-failed, non-'ersatt' rows: of two rapporter claiming the same
 *     identity, exactly one insert (or identity update) succeeds; the loser
 *     links to the winner.
 *   - the partial unique index on (pdf_hash, pipeline_version) over the same
 *     rows: of two live rapporter for the same bytes (concurrent uploads, or
 *     concurrent lazy re-runs of an identity-less rapport) exactly one
 *     exists; the loser links to it (`skapaRapportMedPlats`).
 * A freshly created rapport carries a short "setup lease" so no worker claims
 * it before its file row exists; skapaAnalys releases it once linked.
 *
 * Versioning: a stored rapport is COMPATIBLE with the running code when its
 * extraction parses with ExtractionResultSchema and its judgement with
 * AnalysJudgementSchema (`tolkaRapportInnehall`). Read preference
 * (`valjLasbarRapport`): the newest done rapport for the same identity at the
 * current PIPELINE_VERSION; else the linked rapport if it is done and
 * compatible (served with a note, and a lazy re-run is queued once —
 * `koaOmkorning`); else nothing — a stored result that does not parse is
 * never served.
 *
 * A rapport without identity (neither the local text scan nor the model call
 * could read orgnr + räkenskapsår) is reusable only by hash — every lookup
 * here that would use identity falls back to `pdf_hash` for it.
 */

import { losRegisteromrade } from "@/lib/register/omraden";
import { PROMPT_VERSION, TRANSKRIPTION_PROMPT_VERSION } from "@/lib/analysis/prompts";
import { IDENTITET_PROMPT_VERSION } from "@/lib/analysis/identitetModell";
import {
  arGiltigtOrgnr,
  type LokalIdentifiering,
  type Rapportidentitet,
} from "@/lib/analysis/identitet";
// Single source for the text-layer rule (shared with the CLI path).
export { klassificeraTextlager, TRASIGT_TEXTLAGER_GRANS } from "@/lib/analysis/textlager";
import type { AnalysJudgement } from "@/lib/analysis/analyze";
import { losTackning, normaliseraPostnummer } from "@/lib/vardering";
import type { ExtractionResult } from "@/types/analysis";
import { tolkaLagradBedomning, tolkaLagradExtraktion } from "./cache";
import type {
  AnalysStage,
  Databas,
  Lager,
  NyRapportRad,
  OmradeKalla,
  RapportDelta,
  RapportFilRad,
  RapportRad,
  RapportStage,
  SidtextKalla,
  Textlager,
} from "./portar";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Scanned (image-only) reports are analysed since WS1: a PDF whose text layer is
 * 'saknas' is queued like any other and takes the 'transkribering' stage
 * (steg.ts) before grounding. Kept as a code-level emergency brake — set it to
 * false and skapaAnalys refuses such a PDF again (`scanned_pdf`, before any
 * upload or spend), exactly as before the register existed. The error code
 * and `ScannedPdfError` also stay for old failed rows.
 */
export const SKANNADE_RAPPORTER_AKTIVA = true;

/**
 * `sidtext.kalla` of the pages the current code writes and accepts:
 * "transkribering:v<TRANSKRIPTION_PROMPT_VERSION>". Another rapport of the SAME
 * bytes (a version-bump re-run, a re-upload after a failure) copies pages with
 * exactly this kalla instead of paying for them again.
 */
export const TRANSKRIBERING_KALLA: SidtextKalla = `transkribering:v${TRANSKRIPTION_PROMPT_VERSION}`;

/**
 * A scanned rapport reached grounding without a complete, current-version
 * transcription (a page missing, or written by another prompt version).
 * Grounding on partial text would silently drop figures, so the step fails
 * visibly instead — terminal: another grounding attempt cannot fill the gap.
 */
export class SidtextOfullstandigError extends Error {
  constructor(
    public readonly saknade: number,
    public readonly antalSidor: number,
  ) {
    super(
      `Transkriptionen täcker inte hela rapporten (${saknade} av ${antalSidor} sidor saknas). ` +
        "Grundningen avbryts i stället för att utgå från ofullständig text.",
    );
    this.name = "SidtextOfullstandigError";
  }
}

/**
 * Guard on the scan path (product limit, confirmed by the owner 2026-10-10;
 * not a domain fact): transcription costs about
 * 0.105 SEK/page (measured), and nothing else bounds a single scanned upload
 * except the daily cap. The annual reports seen so far have 12–34 pages, so 60
 * leaves ample room (≈ 6.5 SEK) while refusing a 300-page scan (≈ 31 SEK).
 * Text-layer PDFs are not affected.
 */
export const MAX_SIDOR_SKANNAD_RAPPORT = 60;

export const FOR_MANGA_SKANNADE_SIDOR_MEDDELANDE =
  "Den skannade årsredovisningen har fler sidor än vi kan läsa av just nu. " +
  "Ladda gärna upp en digital version (med textlager) av årsredovisningen.";

/** Major version of the extraction schema (`ExtractionResult.schemaVersion`
 *  "1.x.y"). Bump together with a breaking ExtractionResultSchema change. */
export const SCHEMA_MAJOR = 1;

/**
 * The version key of a rapport. A rapport is only ever (re)used at the same
 * version for registration and claiming; reads may serve an older compatible
 * one (see the file comment). The model is recorded on the row but is NOT
 * part of this key — see the report-back note in SUPABASE.md ("Register").
 */
export const PIPELINE_VERSION = `p${PROMPT_VERSION}.i${IDENTITET_PROMPT_VERSION}.s${SCHEMA_MAJOR}`;

/**
 * Spend reservation for the 'identifiering' stage (pages 1–3, small model,
 * short JSON answer). PLAN-v2 §3.2 estimates ~0.05–0.1 kr per call; rounded
 * up generously, like the other per-stage estimates in spend.ts.
 */
export const UPPSKATTAD_KOSTNAD_IDENTIFIERING_SEK = 0.3;

/** How long a just-created rapport is withheld from workers while
 *  skapaAnalys links its file. Released explicitly on success; on a crash
 *  the row simply becomes claimable when it expires. */
export const SETUP_LEASE_SEKUNDER = 120;

export const ALDRE_VERSION_SKAL = "Analysen gjordes med en tidigare version av Binfo.";

export function nyareArSkal(ar: number): string {
  return `Det finns en nyare årsredovisning (${ar}) analyserad för föreningen.`;
}

const MAX_ERSATT_KEDJA = 10;

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** Luhn-checked orgnr (identitet.ts) and an integer year. */
export function arGiltigIdentitet(identitet: Rapportidentitet): boolean {
  return arGiltigtOrgnr(identitet.orgnr) && Number.isInteger(identitet.rakenskapsar);
}

/** queued/running — work still to do. */
export function arPagaende(r: Pick<RapportRad, "status">): boolean {
  return r.status === "queued" || r.status === "running";
}

/** Holds (or may hold) its identity slot: anything but failed/ersatt. */
export function arAktiv(r: Pick<RapportRad, "status">): boolean {
  return r.status !== "failed" && r.status !== "ersatt";
}

/** Where a rapport goes once its identity question is settled. */
export function stegEfterIdentifiering(textlager: Textlager): RapportStage {
  return textlager === "saknas" ? "transkribering" : "grundning";
}

/**
 * Rapport stage → the legacy `AnalysStage` union the UI renders
 * (src/lib/analysStatusCopy.ts mirrors it by hand, so it must not grow):
 *   identifiering, transkribering, grundning → 'uploaded'   ("Läser årsredovisningen…")
 *   extraktion                               → 'extracting'
 *   bedomning                                → 'judging'
 *   klar                                     → 'complete'
 * The real stage is reported separately as `rapportSteg`.
 */
export function tillAnalysStage(stage: RapportStage): AnalysStage {
  switch (stage) {
    case "identifiering":
    case "transkribering":
    case "grundning":
      return "uploaded";
    case "extraktion":
      return "extracting";
    case "bedomning":
      return "judging";
    case "klar":
      return "complete";
  }
}

export interface RapportInnehall {
  extraction: ExtractionResult;
  judgement: AnalysJudgement;
}

/** The compatibility test: both stored halves parse with the running code's
 *  schemas (extraction re-enriched, as on every read). Null = incompatible or
 *  incomplete — never serve it. */
export function tolkaRapportInnehall(
  r: Pick<RapportRad, "extraction" | "judgement">,
): RapportInnehall | null {
  const extraction = tolkaLagradExtraktion(r.extraction);
  if (!extraction) return null;
  const judgement = tolkaLagradBedomning(r.judgement);
  if (!judgement) return null;
  return { extraction, judgement };
}

/** Done, but its stored result does not parse with the running code. At an
 *  older version that is ordinary schema drift (re-run lazily); at the
 *  CURRENT version it is a dead end that would otherwise hold the slot for
 *  ever — see `frigorTrasigPlats`. */
export function arTrasig(r: RapportRad): boolean {
  return r.status === "done" && tolkaRapportInnehall(r) === null;
}

export const TRASIG_PLATS_MEDDELANDE =
  "Lagrat resultat matchar inte den körande kodens schema trots samma pipeline-version; " +
  "ogiltigförklarat automatiskt för omkörning.";

/**
 * A current-version rapport that is done but unparseable holds its unique
 * slots (identity and bytes) with a result nobody can ever be served. Mark it
 * failed/'ogiltigforklarad' — exactly what an admin invalidate does — so a
 * re-run can take the slot. True when it did.
 */
export async function frigorTrasigPlats(db: Databas, r: RapportRad): Promise<boolean> {
  if (r.pipelineVersion !== PIPELINE_VERSION || !arTrasig(r)) return false;
  console.error(`[register] Rapport ${r.id}: ${TRASIG_PLATS_MEDDELANDE}`);
  await db.uppdateraRapport(r.id, {
    status: "failed",
    errorCode: "ogiltigforklarad",
    errorMessage: TRASIG_PLATS_MEDDELANDE,
    leaseUntil: null,
    finishedAt: new Date().toISOString(),
  });
  return true;
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/** Follows `ersatt_av` to the rapport that actually carries the work. */
export async function foljErsattAv(
  db: Databas,
  start: RapportRad | null,
): Promise<RapportRad | null> {
  let r = start;
  for (let i = 0; r && r.status === "ersatt" && r.ersattAv && i < MAX_ERSATT_KEDJA; i++) {
    r = await db.hamtaRapport(r.ersattAv);
  }
  return r;
}

/** Same report as `r`: by identity when known, else by its bytes. Newest
 *  first. */
async function sammaRapport(db: Databas, r: RapportRad): Promise<RapportRad[]> {
  if (r.orgnr !== null && r.rakenskapsar !== null) {
    return db.listaRapporter({ orgnr: r.orgnr, rakenskapsar: r.rakenskapsar });
  }
  if (r.pdfHash !== null) return db.listaRapporter({ pdfHash: r.pdfHash });
  return [r];
}

export type Registertraff =
  /** Both names known and alike: the same report. */
  | { typ: "traff"; rapport: RapportRad }
  | { typ: "miss" }
  /** Both names known and different: the orgnr may be misread. The identity
   *  must not be used at all — no reuse, no claiming the slot. */
  | { typ: "namnkonflikt" }
  /** A candidate exists but the name is unknown on one side (the PDF's or
   *  the registered förening's). Not enough to merge: no reuse. */
  | { typ: "namnOkant"; rapport: RapportRad };

export interface RegisteruppslagOptions {
  namnLiknar: (a: string, b: string) => boolean;
  /** Exclude this rapport (the caller itself, in the worker). */
  uteslutId?: string;
  /** Also accept the newest DONE, compatible rapport at an older pipeline
   *  version (upload path: served at once with a note, lazily re-run). The
   *  worker passes false — continuing its own run IS the re-run. */
  tillatAldreVersion: boolean;
}

/**
 * Register lookup on an identity. A candidate at the current version is any
 * live (not failed/'ersatt') rapport that is not `arTrasig`. The name guard
 * (PLAN D3, tightened after review): a merge needs BOTH names known and
 * `namnLiknar` true; two known, different names are a conflict even without
 * a candidate (a misread orgnr must not claim the slot either).
 */
export async function hittaRegistertraff(
  db: Databas,
  identitet: Rapportidentitet,
  options: RegisteruppslagOptions,
): Promise<Registertraff> {
  const forening = await db.hamtaForening(identitet.orgnr);
  const registreratNamn = forening?.namn ?? null;
  const badaNamnKanda = Boolean(registreratNamn) && Boolean(identitet.namn);
  if (badaNamnKanda && !options.namnLiknar(registreratNamn as string, identitet.namn as string)) {
    return { typ: "namnkonflikt" };
  }

  const kandidater = (
    await db.listaRapporter({ orgnr: identitet.orgnr, rakenskapsar: identitet.rakenskapsar })
  ).filter((r) => r.id !== options.uteslutId);

  let kandidat = kandidater.find(
    (r) => r.pipelineVersion === PIPELINE_VERSION && arAktiv(r) && !arTrasig(r),
  );
  if (!kandidat && options.tillatAldreVersion) {
    kandidat = kandidater.find((r) => r.status === "done" && tolkaRapportInnehall(r) !== null);
  }
  if (!kandidat) return { typ: "miss" };
  return badaNamnKanda
    ? { typ: "traff", rapport: kandidat }
    : { typ: "namnOkant", rapport: kandidat };
}

export interface LasbarRapport {
  rapport: RapportRad;
  innehall: RapportInnehall;
  /** Served from an older pipeline version (note + lazy re-run). */
  aldreVersion: boolean;
}

/** See the file comment: what a linked analys actually reads. Null = nothing
 *  servable yet. */
export async function valjLasbarRapport(
  db: Databas,
  lankad: RapportRad,
): Promise<LasbarRapport | null> {
  for (const r of await sammaRapport(db, lankad)) {
    if (r.status !== "done" || r.pipelineVersion !== PIPELINE_VERSION) continue;
    const innehall = tolkaRapportInnehall(r);
    if (innehall) return { rapport: r, innehall, aldreVersion: false };
  }
  if (lankad.status === "done") {
    const innehall = tolkaRapportInnehall(lankad);
    if (innehall) {
      return {
        rapport: lankad,
        innehall,
        aldreVersion: lankad.pipelineVersion !== PIPELINE_VERSION,
      };
    }
  }
  return null;
}

/** A current-version rapport for the same report other than `kalla` (any
 *  status but 'ersatt' — a failed re-run counts, so a re-run is queued at
 *  most once per report and a failure stays visible). An invalidated one
 *  ('ogiltigforklarad', by an admin or by `frigorTrasigPlats`) does not
 *  count: invalidating means "do it again". */
export async function hittaOmkorning(db: Databas, kalla: RapportRad): Promise<RapportRad | null> {
  for (const r of await sammaRapport(db, kalla)) {
    if (
      r.id !== kalla.id &&
      r.pipelineVersion === PIPELINE_VERSION &&
      r.status !== "ersatt" &&
      r.errorCode !== "ogiltigforklarad"
    ) {
      return r;
    }
  }
  return null;
}

export interface Platshallare {
  rapport: RapportRad;
  /** Which slot it holds against the rejected row. */
  via: "identitet" | "fil";
}

/** The live current-version rapport holding a slot `rad` needs: the identity
 *  slot first, else the bytes slot. */
async function hittaPlatshallare(
  db: Databas,
  rad: Pick<NyRapportRad, "orgnr" | "rakenskapsar" | "pdfHash" | "pipelineVersion">,
): Promise<Platshallare | null> {
  const levande = (r: RapportRad) => r.pipelineVersion === rad.pipelineVersion && arAktiv(r);
  if (rad.orgnr !== null && rad.rakenskapsar !== null) {
    const r = (await db.listaRapporter({ orgnr: rad.orgnr, rakenskapsar: rad.rakenskapsar })).find(
      levande,
    );
    if (r) return { rapport: r, via: "identitet" };
  }
  if (rad.pdfHash !== null) {
    const r = (await db.listaRapporter({ pdfHash: rad.pdfHash })).find(levande);
    if (r) return { rapport: r, via: "fil" };
  }
  return null;
}

export type Insattning = { ok: true; id: string } | { ok: false; innehavare: Platshallare };

/**
 * Inserts a rapport, settling the two partial unique indexes: on a conflict
 * it finds the slot holder; a holder that is current-version done-but-
 * unparseable is freed (`frigorTrasigPlats`) and the insert retried; any
 * other holder is returned for the caller to link to. A holder that vanished
 * between the conflict and the lookup (it just failed) is retried too.
 * Never throws for a conflict.
 */
export async function skapaRapportMedPlats(db: Databas, rad: NyRapportRad): Promise<Insattning> {
  let senaste: Platshallare | null = null;
  for (let forsok = 0; forsok < 3; forsok++) {
    const skapad = await db.skapaRapport(rad);
    if (skapad.ok) return skapad;
    senaste = await hittaPlatshallare(db, rad);
    if (senaste === null) continue;
    if (await frigorTrasigPlats(db, senaste.rapport)) continue;
    return { ok: false, innehavare: senaste };
  }
  if (senaste) return { ok: false, innehavare: senaste };
  throw new Error("En rapport krockade upprepade gånger utan att någon platsinnehavare hittades.");
}

/** The latest DONE fiscal year for the same förening, if later than `r`'s. */
export async function hittaNyareAr(db: Databas, r: RapportRad): Promise<number | null> {
  if (r.orgnr === null || r.rakenskapsar === null) return null;
  const egetAr = r.rakenskapsar;
  let nyast: number | null = null;
  for (const annan of await db.listaRapporter({ orgnr: r.orgnr })) {
    if (annan.status !== "done" || annan.rakenskapsar === null || annan.rakenskapsar <= egetAr) {
      continue;
    }
    nyast = nyast === null ? annan.rakenskapsar : Math.max(nyast, annan.rakenskapsar);
  }
  return nyast;
}

/** The storage path of the bytes a rapport runs on. */
export async function rapportensPdfSokvag(db: Databas, r: RapportRad): Promise<string | null> {
  if (r.pdfHash === null) return null;
  const fil = await db.hamtaRapportFil(r.pdfHash);
  return fil?.pdfPath ?? `${r.pdfHash}.pdf`;
}

// ---------------------------------------------------------------------------
// Lazy re-run
// ---------------------------------------------------------------------------

export type OmkorningsUtfall =
  | { utfall: "koad"; rapportId: string }
  | { utfall: "finns"; rapportId: string }
  /** The PDF is gone from storage (pre-register 30-day retention), or the
   *  rapport never had one — a re-run is impossible. */
  | { utfall: "pdf_saknas" };

/**
 * Queues a re-run of `kalla` at the current PIPELINE_VERSION, unless one
 * already exists (`hittaOmkorning`). The new rapport runs on the same bytes
 * (`pdf_hash`), keeps the identity (straight to grundning) or, without one,
 * starts at identifiering. Racing callers are settled by the two unique
 * indexes (`skapaRapportMedPlats`): the loser gets 'finns'. A `kalla` that is
 * itself current-version done-but-unparseable is invalidated first — it would
 * otherwise hold the very slot its re-run needs.
 */
export async function koaOmkorning(
  lager: Lager,
  kalla: RapportRad,
  model: string,
): Promise<OmkorningsUtfall> {
  const { db } = lager;
  const befintlig = await hittaOmkorning(db, kalla);
  if (befintlig && !(await frigorTrasigPlats(db, befintlig))) {
    return { utfall: "finns", rapportId: befintlig.id };
  }

  const sokvag = await rapportensPdfSokvag(db, kalla);
  if (sokvag === null || !(await lager.filer.finns(sokvag))) return { utfall: "pdf_saknas" };

  await frigorTrasigPlats(db, kalla);
  const harIdentitet = kalla.orgnr !== null && kalla.rakenskapsar !== null;
  const insatt = await skapaRapportMedPlats(db, {
    orgnr: kalla.orgnr,
    rakenskapsar: kalla.rakenskapsar,
    pipelineVersion: PIPELINE_VERSION,
    model,
    textlager: kalla.textlager,
    status: "queued",
    stage: harIdentitet ? stegEfterIdentifiering(kalla.textlager) : "identifiering",
    pdfHash: kalla.pdfHash,
  });
  return insatt.ok
    ? { utfall: "koad", rapportId: insatt.id }
    : { utfall: "finns", rapportId: insatt.innehavare.rapport.id };
}

// ---------------------------------------------------------------------------
// Replacing a duplicate
// ---------------------------------------------------------------------------

/**
 * Marks `fran` (a rapport the worker holds the lease on) as a duplicate of
 * `till`: status 'ersatt' + ersatt_av, then moves its files and every analys
 * row linked to it. The mark is a leased write — false (and nothing moved)
 * when the row changed under the worker. Marked first: a crash after that
 * still leaves every reader correct (they follow ersatt_av).
 */
export async function ersattRapport(
  db: Databas,
  fran: Pick<RapportRad, "id" | "leaseUntil">,
  tillId: string,
  delta: RapportDelta = {},
): Promise<boolean> {
  const markerad = await db.uppdateraLeasadRapport(fran.id, fran.leaseUntil, {
    ...delta,
    status: "ersatt",
    ersattAv: tillId,
    leaseUntil: null,
    errorCode: null,
    errorMessage: null,
    finishedAt: new Date().toISOString(),
  });
  if (!markerad) return false;
  await db.flyttaRapportFiler(fran.id, tillId);
  await db.lankaOmAnalyser(fran.id, tillId);
  return true;
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

/**
 * Records that a buyer looked at a flat in this förening's area: postnummer +
 * kommun code + Stockholm område from the valuation's own coverage mapping
 * (`losTackning`). The street address is NEVER stored here — it is per-user
 * data and stays in analys.property_input (anonymised after 12 months). Returns
 * false (and writes nothing) when the postnummer does not resolve.
 */
export async function registreraAnvandarAdress(
  db: Databas,
  orgnr: string,
  postnummer: string,
): Promise<boolean> {
  const tackning = losTackning(postnummer);
  if (!tackning || (tackning.kommunKod === null && tackning.omrade === null)) return false;
  await db.registreraForeningAdress({
    orgnr,
    postnummer: normaliseraPostnummer(postnummer),
    kommunKod: tackning.kommunKod,
    omrade: tackning.omrade,
    adress: null,
    kalla: "anvandare",
  });
  return true;
}

// ---------------------------------------------------------------------------
// Upload: link an uploaded PDF to the register
// ---------------------------------------------------------------------------

export interface IdentitetsBeroenden {
  identifieraLokalt: (sidor: readonly string[]) => LokalIdentifiering;
  namnLiknar: (a: string, b: string) => boolean;
}

export interface Uppladdning {
  pdfHash: string;
  pdfPath: string;
  sidor: readonly string[];
  antalSidor: number;
  bytes: number;
  textlager: Textlager;
  /** The model a NEW rapport is stamped with (env.anthropicModel). */
  model: string;
}

export interface Koppling {
  rapportId: string;
  /** Linked to an already finished, servable rapport — no new work. */
  ateranvand: boolean;
  /** Linked to a rapport someone else's upload already started. */
  vantarPaRapport: boolean;
  orgnr: string | null;
  /** The link was found through the EXACT bytes (`rapport_fil.pdf_hash`), not
   *  through the report's identity. Only then is the strict upload quota given
   *  back for a free upload: a changed file (another byte version of the same
   *  report) must still cost quota, or altering one byte would make uploads
   *  free for ever. */
  viaHash: boolean;
}

/** How an upload can join an existing rapport, or null when it cannot (failed,
 *  incompatible, or in progress at another pipeline version — that one will
 *  hit the worker's version guard). */
async function befintligKoppling(db: Databas, r: RapportRad): Promise<Koppling | null> {
  const lasbar = await valjLasbarRapport(db, r);
  if (lasbar) {
    return {
      rapportId: lasbar.rapport.id,
      ateranvand: true,
      vantarPaRapport: false,
      orgnr: lasbar.rapport.orgnr,
      viaHash: false,
    };
  }
  if (arPagaende(r) && r.pipelineVersion === PIPELINE_VERSION) {
    return {
      rapportId: r.id,
      ateranvand: false,
      vantarPaRapport: true,
      orgnr: r.orgnr,
      viaHash: false,
    };
  }
  return null;
}

/**
 * A hash hit whose rapport cannot be joined directly (done but incompatible,
 * failed, or stale) may still have a current-version re-run for the same
 * report: join that. A done-but-incompatible one without a re-run gets one
 * queued now (it carries the identity, unlike a fresh identity-less rapport).
 * Never throws: on any failure here the upload simply falls through to the
 * next step (local identity / a new rapport).
 */
async function kopplingViaOmkorning(
  lager: Lager,
  r: RapportRad,
  model: string,
): Promise<Koppling | null> {
  const { db } = lager;
  try {
    const omkorning = await foljErsattAv(db, await hittaOmkorning(db, r));
    if (omkorning && arAktiv(omkorning) && !arTrasig(omkorning)) {
      return befintligKoppling(db, omkorning);
    }
    if (r.status !== "done") return null;

    const utfall = await koaOmkorning(lager, r, model);
    if (utfall.utfall === "pdf_saknas") return null;
    const ny = await foljErsattAv(db, await db.hamtaRapport(utfall.rapportId));
    if (!ny) return null;
    if (utfall.utfall === "koad") {
      return {
        rapportId: ny.id,
        ateranvand: false,
        vantarPaRapport: false,
        orgnr: ny.orgnr,
        viaHash: true,
      };
    }
    return befintligKoppling(db, ny);
  } catch (fel) {
    console.error(`[register] Kunde inte ansluta till en omkörning av rapport ${r.id}:`, fel);
    return null;
  }
}

/** Joining the live rapport that holds a slot we were refused. */
async function kopplingTillInnehavare(db: Databas, h: Platshallare): Promise<Koppling> {
  return (
    (await befintligKoppling(db, h.rapport).then(
      (k) => k && { ...k, viaHash: h.via === "fil" },
    )) ?? {
      rapportId: h.rapport.id,
      ateranvand: false,
      vantarPaRapport: arPagaende(h.rapport),
      orgnr: h.rapport.orgnr,
      viaHash: h.via === "fil",
    }
  );
}

/** After losing a race on `rapport_fil`: join whatever the file points at. */
async function kopplingForFil(db: Databas, pdfHash: string): Promise<Koppling> {
  const fil = await db.hamtaRapportFil(pdfHash);
  if (!fil) throw new Error(`rapport_fil för ${pdfHash} försvann mitt i en uppladdning.`);
  const r = await foljErsattAv(db, await db.hamtaRapport(fil.rapportId));
  if (!r) throw new Error(`rapport_fil ${pdfHash} pekar på en saknad rapport ${fil.rapportId}.`);
  // Found through the file row: the exact bytes.
  return (
    (await befintligKoppling(db, r).then((k) => k && { ...k, viaHash: true })) ?? {
      rapportId: r.id,
      ateranvand: false,
      vantarPaRapport: arPagaende(r),
      orgnr: r.orgnr,
      viaHash: true,
    }
  );
}

/** Makes `rapport_fil(pdfHash)` point at `k.rapportId` — insert, or re-point
 *  a file whose rapport could not be reused (compare-and-set). */
async function kopplaFil(
  db: Databas,
  upp: Uppladdning,
  befintligFil: RapportFilRad | null,
  k: Koppling,
): Promise<Koppling> {
  if (befintligFil) {
    if (befintligFil.rapportId === k.rapportId) return k;
    const bytt = await db.bytRapportForFil(upp.pdfHash, befintligFil.rapportId, k.rapportId);
    return bytt ? k : kopplingForFil(db, upp.pdfHash);
  }
  const vinnare = await db.skapaRapportFil({
    pdfHash: upp.pdfHash,
    rapportId: k.rapportId,
    pdfPath: upp.pdfPath,
    sidor: upp.antalSidor,
    bytes: upp.bytes,
  });
  return vinnare.rapportId === k.rapportId ? k : kopplingForFil(db, upp.pdfHash);
}

function setupLease(): string {
  return new Date(Date.now() + SETUP_LEASE_SEKUNDER * 1000).toISOString();
}

async function skapaNyRapport(
  db: Databas,
  upp: Uppladdning,
  befintligFil: RapportFilRad | null,
  identitet: Rapportidentitet | null,
  beroenden: IdentitetsBeroenden,
): Promise<Koppling> {
  const ny = (id: Rapportidentitet | null) =>
    skapaRapportMedPlats(db, {
      orgnr: id?.orgnr ?? null,
      rakenskapsar: id?.rakenskapsar ?? null,
      pipelineVersion: PIPELINE_VERSION,
      model: upp.model,
      textlager: upp.textlager,
      status: "queued",
      stage: id ? stegEfterIdentifiering(upp.textlager) : "identifiering",
      pdfHash: upp.pdfHash,
      leaseUntil: setupLease(),
    });

  // Only reached with an identity on a register miss, where no name
  // disagrees — so registering the name cannot overwrite a different one.
  if (identitet) await db.registreraForening(identitet.orgnr, identitet.namn);
  let insatt = await ny(identitet);
  let anvandIdentitet = identitet;

  if (!insatt.ok && insatt.innehavare.via === "identitet" && identitet) {
    // Identity race: another upload registered the same (orgnr, år, version)
    // since our lookup. Join it only under the full name rule; otherwise run
    // without identity and let the identifiering stage settle it.
    const traff = await hittaRegistertraff(db, identitet, {
      namnLiknar: beroenden.namnLiknar,
      tillatAldreVersion: false,
    });
    if (traff.typ === "traff") {
      const k = await befintligKoppling(db, traff.rapport);
      if (k) return kopplaFil(db, upp, befintligFil, k);
    }
    anvandIdentitet = null;
    insatt = await ny(null);
  }
  if (!insatt.ok) {
    // Bytes race (rapport_fil_version_uniq): the same bytes are already
    // being analysed at this version — join that run.
    return kopplaFil(db, upp, befintligFil, await kopplingTillInnehavare(db, insatt.innehavare));
  }
  const id = insatt.id;

  const egen: Koppling = {
    rapportId: id,
    ateranvand: false,
    vantarPaRapport: false,
    orgnr: anvandIdentitet?.orgnr ?? null,
    viaHash: false,
  };
  const kopplad = await kopplaFil(db, upp, befintligFil, egen);
  if (kopplad.rapportId !== id) {
    // Lost the file race: nothing references our rapport yet — drop it.
    await db.raderaRapport(id);
    return kopplad;
  }
  await db.uppdateraRapport(id, { leaseUntil: null });
  return kopplad;
}

/**
 * The register half of skapaAnalys (PLAN-v2 §3.2 "Flow at upload"):
 *   1. hash → rapport_fil → its rapport (following ersatt_av): servable →
 *      reuse; in progress at this version → wait on it; else join (or queue)
 *      its current-version re-run;
 *   2. local identity (free) → register hit with BOTH names known and alike
 *      → link this file to it (a name unknown on either side → no reuse);
 *   3. else a new rapport — at 'grundning' with the local identity, or at
 *      'identifiering' without one — settling both races described in the
 *      file comment.
 * The PDF must already be uploaded to `upp.pdfPath`.
 */
export async function kopplaUppladdning(
  lager: Lager,
  upp: Uppladdning,
  beroenden: IdentitetsBeroenden,
): Promise<Koppling> {
  const { db } = lager;

  const fil = await db.hamtaRapportFil(upp.pdfHash);
  if (fil) {
    const r = await foljErsattAv(db, await db.hamtaRapport(fil.rapportId));
    const k = r
      ? ((await befintligKoppling(db, r)) ?? (await kopplingViaOmkorning(lager, r, upp.model)))
      : null;
    // Found through the exact bytes (rapport_fil), not through the identity.
    if (k) return { ...k, viaHash: true };
  }

  const lokal = beroenden.identifieraLokalt(upp.sidor);
  let identitet = lokal.identitet && arGiltigIdentitet(lokal.identitet) ? lokal.identitet : null;
  if (identitet) {
    const traff = await hittaRegistertraff(db, identitet, {
      namnLiknar: beroenden.namnLiknar,
      tillatAldreVersion: true,
    });
    if (traff.typ === "traff") {
      const k = await befintligKoppling(db, traff.rapport);
      if (k) return kopplaFil(db, upp, fil, k);
    }
    // A name conflict, or a candidate with a name unknown on either side: no
    // instant reuse. The new rapport starts at identifiering without
    // identity, which applies the same rule with the model's reading.
    if (traff.typ === "namnkonflikt" || traff.typ === "namnOkant") identitet = null;
  }

  return skapaNyRapport(db, upp, fil, identitet, beroenden);
}

// ---------------------------------------------------------------------------
// The public register (docs/PLAN-v3.md §2.2, §2.5): slug, area and summary
// ---------------------------------------------------------------------------

/**
 * `<namn>-<orgnr>`: lowercase, å/ä -> a, ö -> o, é -> e (other diacritics are
 * dropped), every run of non-alphanumerics becomes one hyphen, hyphens trimmed.
 * The orgnr suffix makes the slug unique per association, so two BRFs with the
 * same name never collide.
 */
export function slugForForening(namn: string | null, orgnr: string): string {
  const bas = (namn ?? "")
    .toLowerCase()
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/é/g, "e")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${bas === "" ? "brf" : bas}-${orgnr}`;
}

/**
 * Resolves a register area from postnummer. The REAL resolver comes from the
 * area-mapping workstream (W4, src/lib/register/omraden.ts: postnummer ->
 * stadsdel -> registeromrade); it plugs in as the `losOmrade` argument of
 * `uppdateraRegisterForOrgnr` (the call sites in steg.ts pass the default
 * until then). `kalla` says which evidence the list is (the report's own
 * addresses, or buyers' postnummer).
 */
export type LosRegisteromrade = (
  postnummerLista: string[],
  kalla: OmradeKalla,
) => { omrade: string | null };

/** Never assigns an area (tests). */
export const INGET_REGISTEROMRADE: LosRegisteromrade = () => ({ omrade: null });

/** The register's area taxonomy (src/lib/register/omraden.ts): postnummer →
 *  stadsdel → one of the 19 register areas, or `ovriga-stockholm`. */
export const STANDARD_REGISTEROMRADE: LosRegisteromrade = (postnummerLista, kalla) => ({
  omrade: losRegisteromrade([{ postnummer: postnummerLista, kalla }]).omrade,
});

function femsiffrigtPostnummer(pn: string | undefined): string | null {
  if (pn === undefined) return null;
  const rent = normaliseraPostnummer(pn);
  return /^\d{5}$/.test(rent) ? rent : null;
}

/**
 * After a rapport is done (and after identity/ersatt changes): writes the
 * association's own addresses from its latest servable extraction as
 * forening_adress kalla 'rapport', decides slug + register area, and refreshes
 * its register_sammanfattning row.
 *
 * Area priority: the report's own addresses, else buyers' postnummer. A resolver
 * answer of null leaves any known area alone. Best effort: it never throws (a
 * register hiccup must not fail a finished analysis).
 */
export async function uppdateraRegisterForOrgnr(
  db: Databas,
  orgnr: string,
  losOmrade: LosRegisteromrade = STANDARD_REGISTEROMRADE,
): Promise<void> {
  try {
    const forening = await db.hamtaForening(orgnr);
    const rapporter = await db.listaRapporter({ orgnr });
    let extraction: ExtractionResult | null = null;
    // Explicit order, not whatever `listaRapporter` returns: latest fiscal year
    // first, then the most recently finished.
    const nyastForst = [...rapporter].sort(
      (a, b) =>
        (b.rakenskapsar ?? -1) - (a.rakenskapsar ?? -1) ||
        (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""),
    );
    for (const r of nyastForst) {
      if (r.status !== "done") continue;
      const innehall = tolkaRapportInnehall(r);
      if (innehall) {
        extraction = innehall.extraction;
        break;
      }
    }

    const rapportPostnummer: string[] = [];
    for (const a of extraction?.forening.adresser ?? []) {
      const pn = femsiffrigtPostnummer(a.postnummer);
      await db.registreraForeningAdress({
        orgnr,
        postnummer: pn,
        kommunKod: null,
        omrade: null,
        adress: a.gatuadress,
        kalla: "rapport",
      });
      if (pn !== null && !rapportPostnummer.includes(pn)) rapportPostnummer.push(pn);
    }

    let omrade: string | null = null;
    let omradeKalla: OmradeKalla | null = null;
    if (rapportPostnummer.length > 0) {
      omrade = losOmrade(rapportPostnummer, "rapport_adress").omrade;
      if (omrade !== null) omradeKalla = "rapport_adress";
    }
    if (omrade === null) {
      const kopare = (await db.hamtaForeningAdresser(orgnr))
        .filter((a) => a.kalla === "anvandare")
        .map((a) => a.postnummer)
        .filter((p): p is string => p !== null);
      if (kopare.length > 0) {
        omrade = losOmrade(kopare, "anvandare").omrade;
        if (omrade !== null) omradeKalla = "anvandare";
      }
    }

    await db.sattForeningOmrade(orgnr, {
      slug: slugForForening(forening?.namn ?? null, orgnr),
      registeromrade: omrade,
      omradeKalla,
    });
    await db.uppdateraRegisterSammanfattning(orgnr, PIPELINE_VERSION);
  } catch (fel) {
    console.warn(
      `[register] Kunde inte uppdatera registret för ${orgnr}: ` +
        (fel instanceof Error ? fel.message : String(fel)),
    );
  }
}
