/**
 * Storage ports for the analysis job orchestration.
 *
 * `Lager` ("storage/warehouse") is the ONLY surface the job orchestration and
 * server functions may use to reach Postgres or object storage. Every method
 * here maps to exactly one thing a caller upstream (the tick handler, the
 * upload route, the deletion route, ...) actually needs — nothing is added
 * speculatively.
 *
 * This exists so that no test anywhere needs to mock `@supabase/supabase-js`
 * directly: production code talks to `src/server/supabase.ts`'s real
 * adapter, tests talk to `src/server/__fakes__/lager.ts`'s in-memory fake,
 * and both implement this same interface.
 *
 * These are interfaces only — no implementation lives in this file.
 */

import type { ExtractionResult, PropertyInput } from "@/types/analysis";
import type { LaneUnderlag } from "@/lib/analysis/calc/manadskostnad";
import type { AnalysJudgement } from "@/lib/analysis/analyze";

// ---------------------------------------------------------------------------
// analys table
// ---------------------------------------------------------------------------

export type AnalysStatus = "queued" | "running" | "done" | "failed";
export type AnalysStage = "uploaded" | "extracting" | "judging" | "complete";

/** Mirrors the `error_code` values the migration documents on that column. */
export type AnalysErrorCode =
  "scanned_pdf" | "cost_cap" | "daily_cap" | "validation" | "saknar_rantekanslighet" | "unknown";

/** One row of the `analys` table — a single buyer's analysis job. */
export interface AnalysRad {
  id: string;
  status: AnalysStatus;
  stage: AnalysStage;

  pdfHash: string;
  /** Object path in storage; nulled by the retention cron after 30 days. */
  pdfPath: string | null;

  propertyInput: PropertyInput;
  lanUnderlag: LaneUnderlag;

  /** Which model/prompt this job's cache entries are keyed by. */
  model: string;
  promptVersion: string;

  /** Pass 1's intermediate grounding text. Set by step 1, consumed and
   *  nulled by step 2. */
  grundtext: string | null;

  /** ISO timestamp. Null when the row is not currently leased. */
  leaseUntil: string | null;
  attempts: number;

  errorCode: AnalysErrorCode | null;
  errorMessage: string | null;

  costSek: number;

  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Fields needed to insert a new job row. Dedupe logic upstream (matching on
 *  `pdfHash`) decides whether a fresh row starts at `uploaded`, `extracting`
 *  or already `done` — this type accepts whatever starting point the caller
 *  has already decided on. */
export interface NyAnalysRad {
  pdfHash: string;
  pdfPath: string | null;
  propertyInput: PropertyInput;
  lanUnderlag: LaneUnderlag;
  model: string;
  promptVersion: string;
  status: AnalysStatus;
  stage: AnalysStage;
}

// ---------------------------------------------------------------------------
// extraktion_cache / analys_cache tables
// ---------------------------------------------------------------------------

/** Row of `extraktion_cache` — pass 1's output, keyed by document + model +
 *  prompt version so every bidder on the same förening shares one result. */
export interface ExtraktionCacheRad {
  extraction: ExtractionResult;
  schemaVersion: string;
  costSek: number;
  orgnr: string | null;
  rakenskapsar: number | null;
}

/** Row of `analys_cache` — pass 2's output, same keying as above. */
export interface AnalysCacheRad {
  judgement: AnalysJudgement;
  costSek: number;
}

// ---------------------------------------------------------------------------
// Databas — the job queue, both caches, the spend guard, and deletion
// ---------------------------------------------------------------------------

export interface Databas {
  skapaAnalys(rad: NyAnalysRad): Promise<{ id: string }>;
  hamtaAnalys(id: string): Promise<AnalysRad | null>;
  uppdateraAnalys(id: string, delta: Partial<AnalysRad>): Promise<void>;

  /** Wraps the `claim_next_steg` SQL function. Returns the claimed row, or
   *  `null` when nothing is claimable. */
  klaimaNastaSteg(leaseSekunder?: number): Promise<AnalysRad | null>;
  /** Wraps `slapp_steg`. `ateranvandForsok` refunds the attempt just
   *  consumed by the claim — used when the failure was not the job's fault
   *  (e.g. the daily spend cap). */
  slappSteg(id: string, ateranvandForsok: boolean): Promise<void>;

  hamtaExtraktion(
    pdfHash: string,
    model: string,
    promptVersion: string,
  ): Promise<ExtraktionCacheRad | null>;
  /** On-conflict-do-nothing: a second write to the same
   *  (pdfHash, model, promptVersion) key is silently ignored, never
   *  overwritten. */
  sparaExtraktion(
    pdfHash: string,
    model: string,
    promptVersion: string,
    rad: ExtraktionCacheRad,
  ): Promise<void>;

  hamtaAnalysCache(
    pdfHash: string,
    model: string,
    promptVersion: string,
  ): Promise<AnalysCacheRad | null>;
  /** Same on-conflict-do-nothing semantics as `sparaExtraktion`. */
  sparaAnalysCache(
    pdfHash: string,
    model: string,
    promptVersion: string,
    rad: AnalysCacheRad,
  ): Promise<void>;

  /** Wraps `reservera_spend`. Returns whether the reservation was accepted
   *  (i.e. the day's spend, including this reservation, stays at or under
   *  `takSek`). */
  reserveraSpend(dag: string, uppskattatSek: number, takSek: number): Promise<boolean>;
  /** Wraps `avstam_spend` — reconciles a reservation down (or up) to the
   *  actual cost once the step has run. */
  avstamSpend(dag: string, reserveratSek: number, faktisktSek: number): Promise<void>;

  /** Wraps `radera_analys`. `pdfBlevForlorad` is true when this was the
   *  last analysis referencing that PDF's content hash, meaning the caller
   *  should also delete the storage object. */
  raderaAnalys(id: string): Promise<{ pdfBlevForlorad: boolean }>;
}

// ---------------------------------------------------------------------------
// Filarkiv — the `arsredovisningar` storage bucket
// ---------------------------------------------------------------------------

export interface Filarkiv {
  /** Must tolerate the object already existing (content-addressed storage —
   *  the same PDF uploaded by a second buyer) without throwing. */
  laggUpp(sokvag: string, bytes: Uint8Array): Promise<void>;
  hamta(sokvag: string): Promise<Uint8Array>;
  ta_bort(sokvag: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Lager — everything the job orchestration and server functions touch
// ---------------------------------------------------------------------------

export interface Lager {
  db: Databas;
  filer: Filarkiv;
}
