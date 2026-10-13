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
import type { AnalysJudgement } from "@/lib/analysis/analyze";
import type { Behorighet } from "./behorighet";
import type { Kontext } from "./kontext";
import type { KontoDatabas } from "./kontoPortar";

// ---------------------------------------------------------------------------
// analys table
// ---------------------------------------------------------------------------

export type AnalysStatus = "queued" | "running" | "done" | "failed";
export type AnalysStage = "uploaded" | "extracting" | "judging" | "complete";

/** Mirrors the `error_code` values the migration documents on that column.
 *  `error_code` is a plain `text` column (no enum, no CHECK constraint — see
 *  the migration) so `"versionskonflikt"` was added here without a
 *  migration; it is NOT yet listed in the migration's own comment, which
 *  documents the column's original values as of 2026-09-13.
 *
 *  `"kvot"` (rate limit, ./kvot.ts) and `"behorighet"` (entitlement refused,
 *  ./behorighet.ts) are only ever returned by a server function before any
 *  row exists — they are never stored on an `analys` or `rapport` row. They
 *  live in this union because the buyer-facing mirror
 *  (src/lib/analysStatusCopy.ts) needs copy for every code a server function
 *  can return. */
export type AnalysErrorCode =
  | "scanned_pdf"
  | "cost_cap"
  | "daily_cap"
  | "validation"
  | "saknar_rantekanslighet"
  | "versionskonflikt"
  | "kvot"
  | "behorighet"
  | "unknown";

/** One row of the `analys` table — a single buyer's analysis job (legacy
 *  rows) or a single buyer's REQUEST linked to a shared `rapport` (v2 rows,
 *  `rapportId` set — see src/server/register.ts). */
export interface AnalysRad {
  id: string;
  status: AnalysStatus;
  stage: AnalysStage;

  pdfHash: string;
  /** Object path in storage; nulled by the retention cron after 30 days. */
  pdfPath: string | null;

  propertyInput: PropertyInput;

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

  /** The shared register report this request reads from. Null = legacy row:
   *  it is processed by `claim_next_steg` and read from the caches, exactly
   *  as before the register existed. Non-null = its own status/stage/
   *  grundtext columns are unused; everything derives from the rapport. */
  rapportId: string | null;

  /** Who made this request (`principal`, migration
   *  20261009120100_konto.sql). Null for rows created before that migration
   *  and for operator uploads (the CLI), which have no requester. */
  principalId: string | null;
}

/** Fields needed to insert a new job row. Dedupe logic upstream (matching on
 *  `pdfHash`) decides whether a fresh row starts at `uploaded`, `extracting`
 *  or already `done` — this type accepts whatever starting point the caller
 *  has already decided on. */
export interface NyAnalysRad {
  pdfHash: string;
  pdfPath: string | null;
  propertyInput: PropertyInput;
  model: string;
  promptVersion: string;
  status: AnalysStatus;
  stage: AnalysStage;
  /** Omitted (or null) = legacy row. See `AnalysRad.rapportId`. */
  rapportId?: string | null;
  /** Omitted (or null) = no requester (operator CLI). See
   *  `AnalysRad.principalId`. */
  principalId?: string | null;
}

// ---------------------------------------------------------------------------
// The register: forening, rapport, rapport_fil, forening_adress
// (supabase/migrations/20261009120000_register.sql)
// ---------------------------------------------------------------------------

export type RapportStatus = "queued" | "running" | "done" | "failed" | "ersatt";
export type RapportStage =
  "identifiering" | "transkribering" | "grundning" | "extraktion" | "bedomning" | "klar";

/** How usable the PDF's own text layer is — see `klassificeraTextlager` in
 *  register.ts. */
export type Textlager = "ok" | "saknas" | "trasigt";

/** `rapport.error_code` (plain text column). Everything an analys can carry,
 *  plus the admin-only `ogiltigforklarad` (`npm run register -- invalidate`),
 *  which is never shown to a buyer as such — hamtaStatus maps it, see
 *  `ogiltigforklaradResultat` in fel.ts. */
export type RapportErrorCode = AnalysErrorCode | "ogiltigforklarad";

/** Where a rapport's result came from (`rapport.proveniens`, migration
 *  20261013120100_register_v3.sql). The worker writes 'api'. */
export type Proveniens = "api" | "batch" | "offline-session";

/** One row of `rapport` — one analysis of one årsredovisning, shared by every
 *  buyer who uploads that report. */
export interface RapportRad {
  id: string;
  /** Identity: both set or both null (CHECK in the migration). */
  orgnr: string | null;
  rakenskapsar: number | null;
  pipelineVersion: string;
  model: string;
  textlager: Textlager;
  status: RapportStatus;
  stage: RapportStage;
  /** The exact bytes this rapport runs on (a `rapport_fil` key). Null only for
   *  rows created outside the normal paths. */
  pdfHash: string | null;
  leaseUntil: string | null;
  attempts: number;
  grundtext: string | null;
  /** Raw jsonb. Untrusted until parsed — see `tolkaRapportInnehall` in
   *  register.ts. Never served without parsing. */
  extraction: unknown;
  judgement: unknown;
  errorCode: RapportErrorCode | null;
  errorMessage: string | null;
  costSek: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Set together with status 'ersatt': the rapport this one turned out to
   *  duplicate. Readers follow it (see `foljErsattAv`). */
  ersattAv: string | null;
  proveniens: Proveniens;
}

export interface NyRapportRad {
  orgnr: string | null;
  rakenskapsar: number | null;
  pipelineVersion: string;
  model: string;
  textlager: Textlager;
  status: RapportStatus;
  stage: RapportStage;
  pdfHash: string | null;
  /** A short "setup lease" so no worker claims the row before skapaAnalys has
   *  linked its file (see register.ts). */
  leaseUntil?: string | null;
  extraction?: unknown;
  judgement?: unknown;
  costSek?: number;
  finishedAt?: string | null;
  /** Default 'api'. */
  proveniens?: Proveniens;
}

/** The fields of a rapport that may be changed by a plain update. Identity
 *  goes through `sattRapportIdentitet` (it can hit the unique index). */
export type RapportDelta = Partial<
  Omit<RapportRad, "id" | "orgnr" | "rakenskapsar" | "createdAt" | "pipelineVersion">
>;

/** Which partial unique index rejected an insert:
 *  `identitetskonflikt` = rapport_identitet_uniq (orgnr, rakenskapsar, version);
 *  `filkonflikt`        = rapport_fil_version_uniq (pdf_hash, version).
 *  Either way the caller links to the live rapport holding the slot. */
export type RapportKonflikt = "identitetskonflikt" | "filkonflikt";

export type SkapaRapportResultat = { ok: true; id: string } | { ok: false; orsak: RapportKonflikt };

/** One row of `rapport_fil` — one byte version (sha256) of a report. */
export interface RapportFilRad {
  pdfHash: string;
  rapportId: string;
  pdfPath: string;
  sidor: number | null;
  bytes: number | null;
  uppladdad: string;
}

export type NyRapportFilRad = Omit<RapportFilRad, "uppladdad">;

export interface ForeningRad {
  orgnr: string;
  namn: string | null;
  forstSedd: string;
  senastSedd: string;
}

export interface NyForeningAdress {
  orgnr: string;
  postnummer: string | null;
  kommunKod: string | null;
  omrade: string | null;
  /** Always null for kalla 'anvandare' (CHECK in the migration): a buyer's
   *  street address is per-user data and stays in analys.property_input. */
  adress: string | null;
  kalla: "rapport" | "anvandare";
}

/** A `forening_adress` row as the register area assignment reads it. */
export interface ForeningAdressRad {
  orgnr: string;
  postnummer: string | null;
  adress: string | null;
  kalla: "rapport" | "anvandare";
}

/** How a BRF's register area was decided (`forening.omrade_kalla`). */
export type OmradeKalla = "rapport_adress" | "import" | "anvandare";

/** Filter for `listaRapporter`. Results are newest first. */
export interface RapportFilter {
  orgnr?: string;
  rakenskapsar?: number;
  pdfHash?: string;
  limit?: number;
}

/** One transcribed page (`sidtext`): original 1-based page number + text. */
export interface Sidtext {
  sida: number;
  text: string;
}

/** `sidtext.kalla`: where the page text came from and, for a transcription,
 *  with which prompt version ("transkribering:v1", see
 *  `TRANSKRIBERING_KALLA` in register.ts). A page is reused by another rapport
 *  of the same bytes only when its kalla equals the current one. */
export type SidtextKalla = `transkribering:v${string}`;

/** `extraktion_cache` row plus its key — for the one-off legacy backfill. */
export interface ExtraktionCacheListRad extends ExtraktionCacheRad {
  pdfHash: string;
  model: string;
  promptVersion: string;
  createdAt: string;
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
  /** Read-only: `spend_day.cost_sek` for `dag` (reservations included), 0
   *  when the day has no row yet. Only for the up-front check at upload
   *  (`kontrolleraDagligtTak` in spend.ts) — never for deciding a
   *  reservation, which stays atomic in `reserveraSpend`. */
  hamtaSpendForDag(dag: string): Promise<number>;

  /** Wraps `radera_analys`. `pdfBlevForlorad` is true when this was the
   *  last analysis referencing that PDF's content hash, meaning the caller
   *  should also delete the storage object. */
  raderaAnalys(id: string): Promise<{ pdfBlevForlorad: boolean }>;

  // -------------------------------------------------------------------------
  // Register (v2). See register.ts for the semantics built on these.
  // -------------------------------------------------------------------------

  /** Insert. `{ ok: false }` when the partial unique index on
   *  (orgnr, rakenskapsar, pipeline_version) rejects it — the concurrency
   *  lock; the caller links to the existing rapport instead. */
  skapaRapport(rad: NyRapportRad): Promise<SkapaRapportResultat>;
  hamtaRapport(id: string): Promise<RapportRad | null>;
  uppdateraRapport(id: string, delta: RapportDelta): Promise<void>;
  /** The worker's write: applies `delta` only while the row is still
   *  'running' under the lease the worker claimed it with
   *  (`status = 'running' and lease_until = lease`). False = someone else
   *  (an admin invalidate, the reaper, a re-claim after lease expiry) changed
   *  the row since — the worker's result is dropped, never written over a
   *  terminal state. */
  uppdateraLeasadRapport(id: string, lease: string | null, delta: RapportDelta): Promise<boolean>;
  /** Sets orgnr + rakenskapsar. False = the identity index rejected it, or
   *  (when `lease` is given — the worker) the row is no longer 'running'
   *  under that lease. */
  sattRapportIdentitet(
    id: string,
    orgnr: string,
    rakenskapsar: number,
    lease?: string | null,
  ): Promise<boolean>;
  /** Only for a rapport nothing references yet (lost a setup race). */
  raderaRapport(id: string): Promise<void>;
  /** Newest first (created_at desc). Every given filter field must match. */
  listaRapporter(filter: RapportFilter): Promise<RapportRad[]>;
  /** Wraps `claim_next_rapport_steg` — same semantics as `klaimaNastaSteg`. */
  klaimaNastaRapportSteg(leaseSekunder?: number): Promise<RapportRad | null>;
  /** Wraps `slapp_rapport_steg` — same semantics as `slappSteg`. */
  slappRapportSteg(id: string, ateranvandForsok: boolean): Promise<void>;

  hamtaRapportFil(pdfHash: string): Promise<RapportFilRad | null>;
  /** Insert on conflict (pdf_hash) do nothing, then returns the row that is
   *  actually stored — the caller's own, or a concurrent winner's. */
  skapaRapportFil(rad: NyRapportFilRad): Promise<RapportFilRad>;
  /** Compare-and-set: re-points one file from `franRapportId` to
   *  `tillRapportId`. False = it no longer pointed at `franRapportId`. */
  bytRapportForFil(pdfHash: string, franRapportId: string, tillRapportId: string): Promise<boolean>;
  /** Re-points every file of one rapport to another (an 'ersatt' rapport). */
  flyttaRapportFiler(franRapportId: string, tillRapportId: string): Promise<void>;
  listaRapportFiler(rapportId: string): Promise<RapportFilRad[]>;

  /** `update analys set rapport_id = till where rapport_id = fran`. */
  lankaOmAnalyser(franRapportId: string, tillRapportId: string): Promise<void>;
  /** Oldest first. */
  hamtaAnalyserForRapport(rapportId: string, limit: number): Promise<AnalysRad[]>;
  /** A legacy PDF path for a content hash (from `analys.pdf_path`), or null. */
  hamtaPdfSokvagForHash(pdfHash: string): Promise<string | null>;

  /** Wraps `registrera_forening`: insert, or bump senast_sedd and take a
   *  non-null name. */
  registreraForening(orgnr: string, namn: string | null): Promise<void>;
  hamtaForening(orgnr: string): Promise<ForeningRad | null>;
  /** Wraps `registrera_forening_adress` (upsert on the natural key). */
  registreraForeningAdress(rad: NyForeningAdress): Promise<void>;
  /** All `forening_adress` rows of one BRF. */
  hamtaForeningAdresser(orgnr: string): Promise<ForeningAdressRad[]>;
  /** Wraps `satt_forening_omrade`: sets slug / register area; a changed slug
   *  keeps the old one in `forening_slug`. Null fields leave the column as is. */
  sattForeningOmrade(
    orgnr: string,
    falt: { slug: string | null; registeromrade: string | null; omradeKalla: OmradeKalla | null },
  ): Promise<void>;
  /** Wraps `uppdatera_register_sammanfattning`: recomputes the BRF's row in
   *  `register_sammanfattning` (prefers a rapport at `pipelineVersion`). */
  uppdateraRegisterSammanfattning(orgnr: string, pipelineVersion: string): Promise<void>;

  /** The transcribed pages of a rapport (`sidtext`), ordered by page. Empty
   *  when nothing has been transcribed yet. With `kalla`, only pages with
   *  exactly that kalla (a page written by another prompt version is stale). */
  hamtaSidtext(rapportId: string, kalla?: SidtextKalla): Promise<Sidtext[]>;
  /** Upsert on (rapport_id, sida): a rewrite replaces the page. Deliberately
   *  NOT lease-guarded: a page is paid-for output of the same bytes, so one
   *  that finishes after the worker lost its lease is kept for the next
   *  attempt instead of being transcribed (and paid for) twice. It never
   *  touches the rapport row, so it cannot resurrect a terminal rapport —
   *  that stays with the leased `uppdateraLeasadRapport`. */
  sparaSidtext(rapportId: string, sidor: readonly Sidtext[], kalla: SidtextKalla): Promise<void>;

  /** All `extraktion_cache` rows for one prompt version (legacy backfill). */
  listaExtraktionCache(promptVersion: string): Promise<ExtraktionCacheListRad[]>;
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
  /** Whether an object exists (register inspection, lazy re-runs). */
  finns(sokvag: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Lager — everything the job orchestration and server functions touch
// ---------------------------------------------------------------------------

export interface Lager {
  db: Databas;
  filer: Filarkiv;
}

// ---------------------------------------------------------------------------
// Anropare — who is asking, for the buyer-facing server functions
// ---------------------------------------------------------------------------

/** Everything a buyer-facing implementation needs to know about the
 *  requester: the resolved request context (./kontext.ts), the account-layer
 *  store (principals, quotas — ./kontoPortar.ts) and the entitlement checks
 *  (./behorighet.ts). Built once per request by `analysFn.ts`; tests inject
 *  the fakes and a deny policy. */
export interface Anropare {
  kontext: Kontext;
  konto: KontoDatabas;
  behorighet: Behorighet;
}

// ---------------------------------------------------------------------------
// RegisterLasning — the read side of the PUBLIC register (docs/PLAN-v3.md §2.5)
// ---------------------------------------------------------------------------

/** A column of `register_sammanfattning` the area table can sort on. */
export type RegisterSorteringsKolumn =
  | "skuldsattning_per_m2_brf_yta"
  | "arsavgift_per_m2_brf_yta"
  | "sparande_per_m2_totalyta"
  | "betyg"
  | "analysdatum";

/** The light part of a summary row: enough for area counts and the sitemap. */
export interface RegisterOmradeRad {
  slug: string | null;
  registeromrade: string;
  analysdatum: string;
}

/** One `register_sammanfattning` row as the lists show it. */
export interface RegisterSammanfattningVy {
  orgnr: string;
  slug: string;
  namn: string;
  registeromrade: string;
  rakenskapsar: number;
  betyg: "A" | "B" | "C" | "D" | "E" | null;
  skuldsattningPerM2BrfYta: number | null;
  arsavgiftPerM2BrfYta: number | null;
  sparandePerM2Totalyta: number | null;
  analysdatum: string;
}

export interface RegisterListaParametrar {
  /** Area slugs to include (always set: only listed areas are ever public). */
  omraden: readonly string[];
  /** Free text: matches the name (ilike, trigram-indexed on `forening`) or the orgnr. */
  sok: string;
  sortering: RegisterSorteringsKolumn;
  stigande: boolean;
  /** 0-based offset and page size. */
  fran: number;
  antal: number;
}

/** What the public pages may read about one association: `forening` plus the
 *  rapporter's parse-only columns (never `property_input`, never `analys`). */
export interface RegisterForeningRad {
  orgnr: string;
  namn: string | null;
  slug: string | null;
  registeromrade: string | null;
}

export interface RegisterRapportRad {
  id: string;
  rakenskapsar: number;
  pipelineVersion: string;
  /** Raw jsonb: parse with `tolkaRapportInnehall` before use. */
  extraction: unknown;
  judgement: unknown;
  analysdatum: string;
}

export interface RegisterLasning {
  /** Every summary row in a listed area, light columns only (paged internally). */
  listaOmradeRader(omraden: readonly string[]): Promise<RegisterOmradeRad[]>;
  /** One page of summary rows plus the total match count. */
  listaSammanfattningar(
    p: RegisterListaParametrar,
  ): Promise<{ rader: RegisterSammanfattningVy[]; totalt: number }>;
  hamtaForeningViaSlug(slug: string): Promise<RegisterForeningRad | null>;
  /** `forening_slug`: the orgnr an old slug belonged to. */
  hamtaOrgnrViaGammalSlug(slug: string): Promise<string | null>;
  hamtaForeningViaOrgnr(orgnr: string): Promise<RegisterForeningRad | null>;
  /** Done rapporter of one BRF, newest räkenskapsår first. */
  listaKlaraRapporter(orgnr: string): Promise<RegisterRapportRad[]>;
}
