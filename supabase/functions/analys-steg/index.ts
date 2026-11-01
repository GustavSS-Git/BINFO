// Deno entry point for the analys-steg Edge Function.
//
// (a) Invoked ONLY by pg_cron's `binfo-tick` job (see the `binfo-tick`
// schedule in supabase/migrations/20260913105304_init.sql), which fires
// every minute and, via `pg_net`'s `net.http_post`, POSTs here three times
// per tick with an `apikey` header sourced from the `automations_key` Vault
// secret. `verify_jwt = false` in supabase/config.toml means Supabase's own
// JWT check is off for this function, so nothing upstream stops an
// arbitrary caller from reaching this handler — the `apikey` check below is
// the ENTIRE auth boundary. It must never be removed or weakened.
//
// (b) The actual orchestration — claim a job row, advance it one step,
// reserve/reconcile spend, cache reads/writes, error handling — lives
// entirely in src/server/steg.ts's `korNastaSteg`. This file imports that
// function, pre-bundled by esbuild (see src/server/edge/build.ts and the
// `build:edge` npm script) into ./_bundle/steg.js, and never reimplements
// or forks any of that logic. If the pipeline's behaviour needs to change,
// the fix belongs in src/server/steg.ts, not here.
//
// (c) Bundle-boundary note (read before touching the `Lager`/`Env`
// construction below): `korNastaSteg`'s signature is
// `korNastaSteg(lager: Lager, env: Env, options?)`, and building a `Lager`
// normally means `skapaLager` from src/server/supabase.ts, with `Env` coming
// from `lasEnv` in src/server/env.ts. Both of those modules are already
// Deno-safe and already get pulled INTO ./_bundle/steg.js as dependencies of
// steg.ts — but `src/server/steg.ts` itself only exports `korNastaSteg` (by
// design, out of this task's scope to change), so esbuild's bundle only
// RE-EXPORTS `korNastaSteg`; `lasEnv` and `skapaLager`'s code is inlined
// into the bundle but not reachable from outside it. This file sits outside
// the bundle's module graph (Deno's module resolution for
// supabase/functions/** does not share this repo's tsconfig `@/` alias or
// npm-style resolution the way Vite/vitest do), so it cannot import
// src/server/env.ts or src/server/supabase.ts as separate TypeScript
// source either.
//
// The pragmatic fix, deliberately scoped to this file only: construct a
// minimal inline `Env`-shaped object (reading just the four fields
// `korNastaSteg`'s call graph actually touches — see the read of
// src/server/steg.ts, src/server/spend.ts and src/server/cache.ts done
// before writing this) and a minimal inline `Lager` adapter, talking to
// Supabase directly via `@supabase/supabase-js`'s `npm:` specifier. The
// adapter below implements the `Databas`/`Filarkiv` methods reachable from
// `korNastaSteg` (not `skapaAnalys`, `hamtaAnalys`,
// `laggUpp`, or `ta_bort` — none of those are called by the tick) plus,
// since the register (20261009120000_register.sql), EVERY register method of
// the port, and mirrors src/server/supabase.ts's exact table/column/RPC
// mapping so the two stay consistent. Change one, change the other.
//
// This DOES duplicate a slice of src/server/supabase.ts's column mapping
// into this file. That duplication is an accepted, explicitly-flagged
// trade-off of sitting outside the bundle boundary — see the file-level
// TODO at the bottom for the proper long-term fix (a second bundle entry
// point re-exporting `korNastaSteg`, `lasEnv`, and `skapaLager` together).
// Do not "clean up" this duplication without doing that first.

import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { korNastaSteg } from "./_bundle/steg.js";

const BUCKET = "arsredovisningar";

// ---------------------------------------------------------------------------
// Env — minimal inline construction. See note (c) above: this deliberately
// does NOT reimplement lasEnv's full Zod validation/error messages. It reads
// exactly the four fields korNastaSteg's call graph uses:
//   - env.maxDailySpendSek, env.killSwitchPa   (src/server/spend.ts, reserveraForSteg)
//   - env.maxCostPerAnalysisSek                (runGrounding/runStructuredExtraction, and
//                                                the judging step's enforceCostLimit)
//   - env.anthropicApiKey                      (resolveClient, in the judging step)
// env.anthropicModel is NOT read anywhere in steg.ts — each job row already
// carries its own `model` column — so it is intentionally not constructed
// here. env.supabaseUrl/env.supabaseSecretKey are consumed directly below to
// build the Supabase client, not passed through an Env object.
// ---------------------------------------------------------------------------

function kravMiljovariabel(namn: string): string {
  const varde = Deno.env.get(namn);
  if (!varde) {
    throw new Error(`Miljövariabeln ${namn} saknas för analys-steg.`);
  }
  return varde;
}

function kravPositivtTal(namn: string): number {
  const rått = kravMiljovariabel(namn);
  const tal = Number(rått);
  if (!Number.isFinite(tal) || tal <= 0) {
    throw new Error(`Miljövariabeln ${namn} måste vara ett positivt tal, fick "${rått}".`);
  }
  return tal;
}

// ModelEffort/valideraEffort/STANDARD_EFFORT live in ./effort.ts — split out
// specifically so they're unit-testable under Vitest (see that file's doc
// comment for why this file itself can't be imported by a Node test runner).
import { valideraEffort, type ModelEffort } from "./effort.ts";
import { byggReinvokeUrl } from "./reinvoke.ts";

interface InlineEnv {
  maxDailySpendSek: number;
  killSwitchPa: boolean;
  anthropicApiKey: string;
  maxCostPerAnalysisSek: number;
  // effortGrounding is also what the scan 'transkribering' stage uses (WS1,
  // src/server/steg.ts) — no separate variable.
  // Task 1.2 — mirrors Env.effortGrounding/effortExtraction/effortJudging in
  // src/server/env.ts (see that file for why each stage has its own
  // variable). Always set (default STANDARD_EFFORT, from ./effort.ts) —
  // never undefined, same as the Node side.
  effortGrounding: ModelEffort;
  effortExtraction: ModelEffort;
  effortJudging: ModelEffort;
}

function lasEnvInline(): InlineEnv {
  const maxCostRått = Deno.env.get("MAX_COST_PER_ANALYSIS_SEK");
  return {
    maxDailySpendSek: kravPositivtTal("MAX_DAILY_SPEND_SEK"),
    killSwitchPa: Deno.env.get("ANALYSIS_KILL_SWITCH") === "on",
    anthropicApiKey: kravMiljovariabel("ANTHROPIC_API_KEY"),
    // Samma default (5 kr) som lasEnv i src/server/env.ts.
    maxCostPerAnalysisSek: maxCostRått ? Number(maxCostRått) : 5,
    effortGrounding: valideraEffort(
      "ANTHROPIC_EFFORT_GROUNDING",
      Deno.env.get("ANTHROPIC_EFFORT_GROUNDING"),
    ),
    effortExtraction: valideraEffort(
      "ANTHROPIC_EFFORT_EXTRACTION",
      Deno.env.get("ANTHROPIC_EFFORT_EXTRACTION"),
    ),
    effortJudging: valideraEffort(
      "ANTHROPIC_EFFORT_JUDGING",
      Deno.env.get("ANTHROPIC_EFFORT_JUDGING"),
    ),
  };
}

// ---------------------------------------------------------------------------
// Lager — minimal inline adapter. Column/RPC names mirror
// src/server/supabase.ts exactly (see that file + the migration for the
// source of truth); only the methods korNastaSteg's call graph reaches are
// implemented.
// ---------------------------------------------------------------------------

/** Mirrors `AnalysRad` in src/server/portar.ts. `propertyInput` is an opaque
 *  jsonb blob as far as this adapter is concerned — it never inspects it,
 *  only shuttles it between Postgres and `korNastaSteg`.
 *
 *  The `analys` table still has a `lan_underlag` column, deliberately left in
 *  place but dead (see the `lan_underlag_nullable` migration and SUPABASE.md).
 *  It is absent here on purpose: this interface mirrors `AnalysRad`, and
 *  carrying a field the real type no longer has is how a hand-maintained
 *  duplicate silently drifts from the thing it claims to mirror. */
interface JobbRad {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  stage: "uploaded" | "extracting" | "judging" | "complete";
  pdfHash: string;
  pdfPath: string | null;
  propertyInput: unknown;
  model: string;
  promptVersion: string;
  grundtext: string | null;
  leaseUntil: string | null;
  attempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  costSek: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Register link (20261009120000_register.sql) — mirrors AnalysRad.rapportId. */
  rapportId: string | null;
}

/** snake_case row shape for the `analys` table columns this adapter actually
 *  reads (see the migration's `create table analys`). Not every column is
 *  listed: the dead `lan_underlag` is deliberately omitted, per the note on
 *  `JobbRad` above. Postgres still returns it; TypeScript simply ignores an
 *  undeclared property on a runtime value. */
interface JobbRadKolumner {
  id: string;
  status: JobbRad["status"];
  stage: JobbRad["stage"];
  pdf_hash: string;
  pdf_path: string | null;
  property_input: unknown;
  model: string;
  prompt_version: string;
  grundtext: string | null;
  lease_until: string | null;
  attempts: number;
  error_code: string | null;
  error_message: string | null;
  cost_sek: number | string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  rapport_id?: string | null;
}

function radFranKolumner(row: JobbRadKolumner): JobbRad {
  return {
    id: row.id,
    status: row.status,
    stage: row.stage,
    pdfHash: row.pdf_hash,
    pdfPath: row.pdf_path,
    propertyInput: row.property_input,
    model: row.model,
    promptVersion: row.prompt_version,
    grundtext: row.grundtext,
    leaseUntil: row.lease_until,
    attempts: row.attempts,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    costSek: Number(row.cost_sek),
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    rapportId: row.rapport_id ?? null,
  };
}

/** Same "only the keys present in delta" mapping as
 *  src/server/supabase.ts's `radTillRad` — kept as the full field set (not
 *  trimmed to only what steg.ts currently writes) so a future call site
 *  sending an extra field doesn't silently get dropped here. */
function radTillKolumner(delta: Partial<JobbRad>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if ("id" in delta) row["id"] = delta.id;
  if ("status" in delta) row["status"] = delta.status;
  if ("stage" in delta) row["stage"] = delta.stage;
  if ("pdfHash" in delta) row["pdf_hash"] = delta.pdfHash;
  if ("pdfPath" in delta) row["pdf_path"] = delta.pdfPath;
  if ("propertyInput" in delta) row["property_input"] = delta.propertyInput;
  if ("model" in delta) row["model"] = delta.model;
  if ("promptVersion" in delta) row["prompt_version"] = delta.promptVersion;
  if ("grundtext" in delta) row["grundtext"] = delta.grundtext;
  if ("leaseUntil" in delta) row["lease_until"] = delta.leaseUntil;
  if ("attempts" in delta) row["attempts"] = delta.attempts;
  if ("errorCode" in delta) row["error_code"] = delta.errorCode;
  if ("errorMessage" in delta) row["error_message"] = delta.errorMessage;
  if ("costSek" in delta) row["cost_sek"] = delta.costSek;
  if ("createdAt" in delta) row["created_at"] = delta.createdAt;
  if ("startedAt" in delta) row["started_at"] = delta.startedAt;
  if ("finishedAt" in delta) row["finished_at"] = delta.finishedAt;
  if ("rapportId" in delta && delta.rapportId != null) row["rapport_id"] = delta.rapportId;
  return row;
}

// ---------------------------------------------------------------------------
// Register rows — mirrors RapportRad/RapportFilRad and rapportFranRad /
// rapportTillRad / rapportFilFranRad / tolkaRapportKonflikt in
// src/server/supabase.ts.
// ---------------------------------------------------------------------------

interface RapportRad {
  id: string;
  orgnr: string | null;
  rakenskapsar: number | null;
  pipelineVersion: string;
  model: string;
  textlager: "ok" | "saknas" | "trasigt";
  status: "queued" | "running" | "done" | "failed" | "ersatt";
  stage: "identifiering" | "transkribering" | "grundning" | "extraktion" | "bedomning" | "klar";
  pdfHash: string | null;
  leaseUntil: string | null;
  attempts: number;
  grundtext: string | null;
  extraction: unknown;
  judgement: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  costSek: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  ersattAv: string | null;
}

interface RapportKolumner {
  id: string;
  orgnr: string | null;
  rakenskapsar: number | null;
  pipeline_version: string;
  model: string;
  textlager: RapportRad["textlager"];
  status: RapportRad["status"];
  stage: RapportRad["stage"];
  pdf_hash: string | null;
  lease_until: string | null;
  attempts: number;
  grundtext: string | null;
  extraction: unknown;
  judgement: unknown;
  error_code: string | null;
  error_message: string | null;
  cost_sek: number | string;
  cache_read_tokens: number | string;
  cache_write_tokens: number | string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  ersatt_av: string | null;
  proveniens?: "api" | "batch" | "offline-session";
}

function rapportFranKolumner(row: RapportKolumner): RapportRad {
  return {
    id: row.id,
    orgnr: row.orgnr,
    rakenskapsar: row.rakenskapsar,
    pipelineVersion: row.pipeline_version,
    model: row.model,
    textlager: row.textlager,
    status: row.status,
    stage: row.stage,
    pdfHash: row.pdf_hash,
    leaseUntil: row.lease_until,
    attempts: row.attempts,
    grundtext: row.grundtext,
    extraction: row.extraction,
    judgement: row.judgement,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    costSek: Number(row.cost_sek),
    cacheReadTokens: Number(row.cache_read_tokens),
    cacheWriteTokens: Number(row.cache_write_tokens),
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    ersattAv: row.ersatt_av,
    proveniens: row.proveniens ?? "api",
  };
}

function rapportTillKolumner(delta: Partial<RapportRad>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if ("orgnr" in delta) row["orgnr"] = delta.orgnr;
  if ("rakenskapsar" in delta) row["rakenskapsar"] = delta.rakenskapsar;
  if ("pipelineVersion" in delta) row["pipeline_version"] = delta.pipelineVersion;
  if ("model" in delta) row["model"] = delta.model;
  if ("textlager" in delta) row["textlager"] = delta.textlager;
  if ("status" in delta) row["status"] = delta.status;
  if ("stage" in delta) row["stage"] = delta.stage;
  if ("pdfHash" in delta) row["pdf_hash"] = delta.pdfHash;
  if ("leaseUntil" in delta) row["lease_until"] = delta.leaseUntil;
  if ("attempts" in delta) row["attempts"] = delta.attempts;
  if ("grundtext" in delta) row["grundtext"] = delta.grundtext;
  if ("extraction" in delta) row["extraction"] = delta.extraction;
  if ("judgement" in delta) row["judgement"] = delta.judgement;
  if ("errorCode" in delta) row["error_code"] = delta.errorCode;
  if ("errorMessage" in delta) row["error_message"] = delta.errorMessage;
  if ("costSek" in delta) row["cost_sek"] = delta.costSek;
  if ("cacheReadTokens" in delta) row["cache_read_tokens"] = delta.cacheReadTokens;
  if ("cacheWriteTokens" in delta) row["cache_write_tokens"] = delta.cacheWriteTokens;
  if ("startedAt" in delta) row["started_at"] = delta.startedAt;
  if ("finishedAt" in delta) row["finished_at"] = delta.finishedAt;
  if ("ersattAv" in delta) row["ersatt_av"] = delta.ersattAv;
  if ("proveniens" in delta) row["proveniens"] = delta.proveniens;
  return row;
}

interface RapportFilKolumner {
  pdf_hash: string;
  rapport_id: string;
  pdf_path: string;
  sidor: number | null;
  bytes: number | null;
  uppladdad: string;
}

function rapportFilFranKolumner(row: RapportFilKolumner) {
  return {
    pdfHash: row.pdf_hash,
    rapportId: row.rapport_id,
    pdfPath: row.pdf_path,
    sidor: row.sidor,
    bytes: row.bytes,
    uppladdad: row.uppladdad,
  };
}

function tolkaRapportKonflikt(error: {
  code?: string;
  message: string;
}): "identitetskonflikt" | "filkonflikt" | null {
  if (error.code !== "23505") return null;
  if (error.message.includes("rapport_identitet_uniq")) return "identitetskonflikt";
  if (error.message.includes("rapport_fil_version_uniq")) return "filkonflikt";
  return null;
}

interface ExtraktionCacheKolumner {
  extraction: unknown;
  schema_version: string;
  cost_sek: number | string;
  orgnr: string | null;
  rakenskapsar: number | null;
}

interface AnalysCacheKolumner {
  judgement: unknown;
  cost_sek: number | string;
}

// deno-lint-ignore no-explicit-any
function byggLager(sb: any) {
  return {
    db: {
      async klaimaNastaSteg(leaseSekunder?: number): Promise<JobbRad | null> {
        const { data, error } = await sb.rpc("claim_next_steg", {
          p_lease_sekunder: leaseSekunder ?? 300,
        });
        if (error) throw new Error(`klaimaNastaSteg misslyckades: ${error.message}`);
        const row = data as JobbRadKolumner | null;
        if (!row || !row.id) return null;
        return radFranKolumner(row);
      },

      async slappSteg(id: string, ateranvandForsok: boolean): Promise<void> {
        const { error } = await sb.rpc("slapp_steg", {
          p_id: id,
          p_ateranvand_forsok: ateranvandForsok,
        });
        if (error) throw new Error(`slappSteg misslyckades: ${error.message}`);
      },

      async uppdateraAnalys(id: string, delta: Partial<JobbRad>): Promise<void> {
        const { error } = await sb.from("analys").update(radTillKolumner(delta)).eq("id", id);
        if (error) throw new Error(`uppdateraAnalys misslyckades: ${error.message}`);
      },

      async hamtaExtraktion(pdfHash: string, model: string, promptVersion: string) {
        const { data, error } = await sb
          .from("extraktion_cache")
          .select("extraction, schema_version, cost_sek, orgnr, rakenskapsar")
          .eq("pdf_hash", pdfHash)
          .eq("model", model)
          .eq("prompt_version", promptVersion)
          .maybeSingle();
        if (error) throw new Error(`hamtaExtraktion misslyckades: ${error.message}`);
        if (!data) return null;
        const row = data as ExtraktionCacheKolumner;
        return {
          extraction: row.extraction,
          schemaVersion: row.schema_version,
          costSek: Number(row.cost_sek),
          orgnr: row.orgnr,
          rakenskapsar: row.rakenskapsar,
        };
      },

      async sparaExtraktion(
        pdfHash: string,
        model: string,
        promptVersion: string,
        rad: {
          extraction: unknown;
          schemaVersion: string;
          costSek: number;
          orgnr: string | null;
          rakenskapsar: number | null;
        },
      ): Promise<void> {
        const { error } = await sb.from("extraktion_cache").upsert(
          {
            pdf_hash: pdfHash,
            model,
            prompt_version: promptVersion,
            extraction: rad.extraction,
            schema_version: rad.schemaVersion,
            cost_sek: rad.costSek,
            orgnr: rad.orgnr,
            rakenskapsar: rad.rakenskapsar,
          },
          { onConflict: "pdf_hash,model,prompt_version", ignoreDuplicates: true },
        );
        if (error) throw new Error(`sparaExtraktion misslyckades: ${error.message}`);
      },

      async hamtaAnalysCache(pdfHash: string, model: string, promptVersion: string) {
        const { data, error } = await sb
          .from("analys_cache")
          .select("judgement, cost_sek")
          .eq("pdf_hash", pdfHash)
          .eq("model", model)
          .eq("prompt_version", promptVersion)
          .maybeSingle();
        if (error) throw new Error(`hamtaAnalysCache misslyckades: ${error.message}`);
        if (!data) return null;
        const row = data as AnalysCacheKolumner;
        return { judgement: row.judgement, costSek: Number(row.cost_sek) };
      },

      async sparaAnalysCache(
        pdfHash: string,
        model: string,
        promptVersion: string,
        rad: { judgement: unknown; costSek: number },
      ): Promise<void> {
        const { error } = await sb.from("analys_cache").upsert(
          {
            pdf_hash: pdfHash,
            model,
            prompt_version: promptVersion,
            judgement: rad.judgement,
            cost_sek: rad.costSek,
          },
          { onConflict: "pdf_hash,model,prompt_version", ignoreDuplicates: true },
        );
        if (error) throw new Error(`sparaAnalysCache misslyckades: ${error.message}`);
      },

      async reserveraSpend(dag: string, uppskattatSek: number, takSek: number): Promise<boolean> {
        const { data, error } = await sb.rpc("reservera_spend", {
          p_dag: dag,
          p_belopp: uppskattatSek,
          p_tak: takSek,
        });
        if (error) throw new Error(`reserveraSpend misslyckades: ${error.message}`);
        return data === true;
      },

      async avstamSpend(dag: string, reserveratSek: number, faktisktSek: number): Promise<void> {
        const { error } = await sb.rpc("avstam_spend", {
          p_dag: dag,
          p_reserverat: reserveratSek,
          p_faktiskt: faktisktSek,
        });
        if (error) throw new Error(`avstamSpend misslyckades: ${error.message}`);
      },

      // skapaAnalys och hamtaAnalys är MEDVETET utelämnade —
      // ingenting i korNastaSteg's anropskedja rör dem (de hör till
      // upload-/deletion-rutterna, inte till tick-loopen).

      // ---------------------------------------------------------------------
      // Register — every method of the port, mirroring src/server/supabase.ts.
      // ---------------------------------------------------------------------

      async skapaRapport(rad: Partial<RapportRad>) {
        const { data, error } = await sb
          .from("rapport")
          .insert(rapportTillKolumner(rad))
          .select("id")
          .single();
        if (error) {
          const konflikt = tolkaRapportKonflikt(error);
          if (konflikt) return { ok: false, orsak: konflikt } as const;
          throw new Error(`skapaRapport misslyckades: ${error.message}`);
        }
        return { ok: true, id: (data as { id: string }).id } as const;
      },

      async hamtaRapport(id: string): Promise<RapportRad | null> {
        const { data, error } = await sb.from("rapport").select("*").eq("id", id).maybeSingle();
        if (error) throw new Error(`hamtaRapport misslyckades: ${error.message}`);
        return data ? rapportFranKolumner(data as RapportKolumner) : null;
      },

      async uppdateraRapport(id: string, delta: Partial<RapportRad>): Promise<void> {
        const { error } = await sb.from("rapport").update(rapportTillKolumner(delta)).eq("id", id);
        if (error) throw new Error(`uppdateraRapport misslyckades: ${error.message}`);
      },

      // The worker's leased write — see uppdateraLeasadRapport in
      // src/server/portar.ts: only while still 'running' under this lease.
      async uppdateraLeasadRapport(
        id: string,
        lease: string | null,
        delta: Partial<RapportRad>,
      ): Promise<boolean> {
        let q = sb
          .from("rapport")
          .update(rapportTillKolumner(delta))
          .eq("id", id)
          .eq("status", "running");
        q = lease === null ? q.is("lease_until", null) : q.eq("lease_until", lease);
        const { data, error } = await q.select("id");
        if (error) throw new Error(`uppdateraLeasadRapport misslyckades: ${error.message}`);
        return Array.isArray(data) && data.length === 1;
      },

      async sattRapportIdentitet(
        id: string,
        orgnr: string,
        rakenskapsar: number,
        lease?: string | null,
      ): Promise<boolean> {
        let q = sb.from("rapport").update({ orgnr, rakenskapsar }).eq("id", id);
        if (lease !== undefined) {
          q = q.eq("status", "running");
          q = lease === null ? q.is("lease_until", null) : q.eq("lease_until", lease);
        }
        const { data, error } = await q.select("id");
        if (error) {
          if (tolkaRapportKonflikt(error) === "identitetskonflikt") return false;
          throw new Error(`sattRapportIdentitet misslyckades: ${error.message}`);
        }
        return Array.isArray(data) && data.length === 1;
      },

      async raderaRapport(id: string): Promise<void> {
        const { error } = await sb.from("rapport").delete().eq("id", id);
        if (error) throw new Error(`raderaRapport misslyckades: ${error.message}`);
      },

      async listaRapporter(filter: {
        orgnr?: string;
        rakenskapsar?: number;
        pdfHash?: string;
        limit?: number;
      }): Promise<RapportRad[]> {
        let q = sb.from("rapport").select("*");
        if (filter.orgnr !== undefined) q = q.eq("orgnr", filter.orgnr);
        if (filter.rakenskapsar !== undefined) q = q.eq("rakenskapsar", filter.rakenskapsar);
        if (filter.pdfHash !== undefined) q = q.eq("pdf_hash", filter.pdfHash);
        q = q.order("created_at", { ascending: false });
        if (filter.limit !== undefined) q = q.limit(filter.limit);
        const { data, error } = await q;
        if (error) throw new Error(`listaRapporter misslyckades: ${error.message}`);
        return (data as RapportKolumner[]).map(rapportFranKolumner);
      },

      async klaimaNastaRapportSteg(leaseSekunder?: number): Promise<RapportRad | null> {
        const { data, error } = await sb.rpc("claim_next_rapport_steg", {
          p_lease_sekunder: leaseSekunder ?? 300,
        });
        if (error) throw new Error(`klaimaNastaRapportSteg misslyckades: ${error.message}`);
        const row = data as RapportKolumner | null;
        if (!row || !row.id) return null;
        return rapportFranKolumner(row);
      },

      async hamtaRapportFil(pdfHash: string) {
        const { data, error } = await sb
          .from("rapport_fil")
          .select("*")
          .eq("pdf_hash", pdfHash)
          .maybeSingle();
        if (error) throw new Error(`hamtaRapportFil misslyckades: ${error.message}`);
        return data ? rapportFilFranKolumner(data as RapportFilKolumner) : null;
      },

      async skapaRapportFil(rad: {
        pdfHash: string;
        rapportId: string;
        pdfPath: string;
        sidor: number | null;
        bytes: number | null;
      }) {
        const { error } = await sb.from("rapport_fil").upsert(
          {
            pdf_hash: rad.pdfHash,
            rapport_id: rad.rapportId,
            pdf_path: rad.pdfPath,
            sidor: rad.sidor,
            bytes: rad.bytes,
          },
          { onConflict: "pdf_hash", ignoreDuplicates: true },
        );
        if (error) throw new Error(`skapaRapportFil misslyckades: ${error.message}`);
        const { data, error: lasFel } = await sb
          .from("rapport_fil")
          .select("*")
          .eq("pdf_hash", rad.pdfHash)
          .single();
        if (lasFel) throw new Error(`skapaRapportFil (omläsning) misslyckades: ${lasFel.message}`);
        return rapportFilFranKolumner(data as RapportFilKolumner);
      },

      async bytRapportForFil(pdfHash: string, franRapportId: string, tillRapportId: string) {
        const { data, error } = await sb
          .from("rapport_fil")
          .update({ rapport_id: tillRapportId })
          .eq("pdf_hash", pdfHash)
          .eq("rapport_id", franRapportId)
          .select("pdf_hash");
        if (error) throw new Error(`bytRapportForFil misslyckades: ${error.message}`);
        return Array.isArray(data) && data.length === 1;
      },

      async flyttaRapportFiler(franRapportId: string, tillRapportId: string): Promise<void> {
        const { error } = await sb
          .from("rapport_fil")
          .update({ rapport_id: tillRapportId })
          .eq("rapport_id", franRapportId);
        if (error) throw new Error(`flyttaRapportFiler misslyckades: ${error.message}`);
      },

      async listaRapportFiler(rapportId: string) {
        const { data, error } = await sb
          .from("rapport_fil")
          .select("*")
          .eq("rapport_id", rapportId)
          .order("uppladdad", { ascending: true });
        if (error) throw new Error(`listaRapportFiler misslyckades: ${error.message}`);
        return (data as RapportFilKolumner[]).map(rapportFilFranKolumner);
      },

      async lankaOmAnalyser(franRapportId: string, tillRapportId: string): Promise<void> {
        const { error } = await sb
          .from("analys")
          .update({ rapport_id: tillRapportId })
          .eq("rapport_id", franRapportId);
        if (error) throw new Error(`lankaOmAnalyser misslyckades: ${error.message}`);
      },

      async hamtaAnalyserForRapport(rapportId: string, limit: number): Promise<JobbRad[]> {
        const { data, error } = await sb
          .from("analys")
          .select("*")
          .eq("rapport_id", rapportId)
          .order("created_at", { ascending: true })
          .limit(limit);
        if (error) throw new Error(`hamtaAnalyserForRapport misslyckades: ${error.message}`);
        return (data as JobbRadKolumner[]).map(radFranKolumner);
      },

      async hamtaPdfSokvagForHash(pdfHash: string): Promise<string | null> {
        const { data, error } = await sb
          .from("analys")
          .select("pdf_path")
          .eq("pdf_hash", pdfHash)
          .not("pdf_path", "is", null)
          .limit(1);
        if (error) throw new Error(`hamtaPdfSokvagForHash misslyckades: ${error.message}`);
        const forsta = (data as Array<{ pdf_path: string | null }>)[0];
        return forsta?.pdf_path ?? null;
      },

      async registreraForening(orgnr: string, namn: string | null): Promise<void> {
        const { error } = await sb.rpc("registrera_forening", { p_orgnr: orgnr, p_namn: namn });
        if (error) throw new Error(`registreraForening misslyckades: ${error.message}`);
      },

      async hamtaForening(orgnr: string) {
        const { data, error } = await sb
          .from("forening")
          .select("*")
          .eq("orgnr", orgnr)
          .maybeSingle();
        if (error) throw new Error(`hamtaForening misslyckades: ${error.message}`);
        if (!data) return null;
        const row = data as {
          orgnr: string;
          namn: string | null;
          forst_sedd: string;
          senast_sedd: string;
        };
        return {
          orgnr: row.orgnr,
          namn: row.namn,
          forstSedd: row.forst_sedd,
          senastSedd: row.senast_sedd,
        };
      },

      async registreraForeningAdress(rad: {
        orgnr: string;
        postnummer: string | null;
        kommunKod: string | null;
        omrade: string | null;
        adress: string | null;
        kalla: "rapport" | "anvandare";
      }): Promise<void> {
        const { error } = await sb.rpc("registrera_forening_adress", {
          p_orgnr: rad.orgnr,
          p_postnummer: rad.postnummer,
          p_kommun_kod: rad.kommunKod,
          p_omrade: rad.omrade,
          p_adress: rad.adress,
          p_kalla: rad.kalla,
        });
        if (error) throw new Error(`registreraForeningAdress misslyckades: ${error.message}`);
      },

      // v3 register: mirrors hamtaForeningAdresser / sattForeningOmrade /
      // uppdateraRegisterSammanfattning in src/server/supabase.ts.
      async hamtaForeningAdresser(orgnr: string) {
        const { data, error } = await sb
          .from("forening_adress")
          .select("orgnr, postnummer, adress, kalla")
          .eq("orgnr", orgnr);
        if (error) throw new Error(`hamtaForeningAdresser misslyckades: ${error.message}`);
        return data as Array<{
          orgnr: string;
          postnummer: string | null;
          adress: string | null;
          kalla: "rapport" | "anvandare";
        }>;
      },

      async sattForeningOmrade(
        orgnr: string,
        falt: {
          slug: string | null;
          registeromrade: string | null;
          omradeKalla: "rapport_adress" | "import" | "anvandare" | null;
        },
      ): Promise<void> {
        const { error } = await sb.rpc("satt_forening_omrade", {
          p_orgnr: orgnr,
          p_slug: falt.slug,
          p_registeromrade: falt.registeromrade,
          p_omrade_kalla: falt.omradeKalla,
        });
        if (error) throw new Error(`sattForeningOmrade misslyckades: ${error.message}`);
      },

      async uppdateraRegisterSammanfattning(orgnr: string, pipelineVersion: string): Promise<void> {
        const { error } = await sb.rpc("uppdatera_register_sammanfattning", {
          p_orgnr: orgnr,
          p_pipeline_version: pipelineVersion,
        });
        if (error) throw new Error(`uppdateraRegisterSammanfattning misslyckades: ${error.message}`);
      },

      // WS1 scan transcriptions — mirrors hamtaSidtext/sparaSidtext in
      // src/server/supabase.ts (upsert on (rapport_id, sida); deliberately not
      // lease-guarded, see the port's comment in src/server/portar.ts).
      async hamtaSidtext(
        rapportId: string,
        kalla?: string,
      ): Promise<Array<{ sida: number; text: string }>> {
        let q = sb.from("sidtext").select("sida, text").eq("rapport_id", rapportId);
        if (kalla !== undefined) q = q.eq("kalla", kalla);
        const { data, error } = await q.order("sida", { ascending: true });
        if (error) throw new Error(`hamtaSidtext misslyckades: ${error.message}`);
        return (data as Array<{ sida: number; text: string }>).map((rad) => ({
          sida: rad.sida,
          text: rad.text,
        }));
      },

      async sparaSidtext(
        rapportId: string,
        sidor: ReadonlyArray<{ sida: number; text: string }>,
        kalla: string,
      ): Promise<void> {
        if (sidor.length === 0) return;
        const { error } = await sb.from("sidtext").upsert(
          sidor.map((s) => ({ rapport_id: rapportId, sida: s.sida, text: s.text, kalla })),
          { onConflict: "rapport_id,sida" },
        );
        if (error) throw new Error(`sparaSidtext misslyckades: ${error.message}`);
      },

      async listaExtraktionCache(promptVersion: string) {
        const { data, error } = await sb
          .from("extraktion_cache")
          .select(
            "pdf_hash, model, prompt_version, extraction, schema_version, cost_sek, orgnr, rakenskapsar, created_at",
          )
          .eq("prompt_version", promptVersion)
          .order("created_at", { ascending: true });
        if (error) throw new Error(`listaExtraktionCache misslyckades: ${error.message}`);
        return (
          data as Array<
            ExtraktionCacheKolumner & {
              pdf_hash: string;
              model: string;
              prompt_version: string;
              created_at: string;
            }
          >
        ).map((row) => ({
          pdfHash: row.pdf_hash,
          model: row.model,
          promptVersion: row.prompt_version,
          createdAt: row.created_at,
          extraction: row.extraction,
          schemaVersion: row.schema_version,
          costSek: Number(row.cost_sek),
          orgnr: row.orgnr,
          rakenskapsar: row.rakenskapsar,
        }));
      },
    },

    filer: {
      async hamta(sokvag: string): Promise<Uint8Array> {
        const { data, error } = await sb.storage.from(BUCKET).download(sokvag);
        if (error) throw new Error(`hamta misslyckades: ${error.message}`);
        return new Uint8Array(await data.arrayBuffer());
      },
      // laggUpp och ta_bort är MEDVETET utelämnade — se kommentaren ovan.

      async finns(sokvag: string): Promise<boolean> {
        const snedstreck = sokvag.lastIndexOf("/");
        const katalog = snedstreck === -1 ? "" : sokvag.slice(0, snedstreck);
        const namn = sokvag.slice(snedstreck + 1);
        const { data, error } = await sb.storage
          .from(BUCKET)
          .list(katalog, { search: namn, limit: 100 });
        if (error) throw new Error(`finns misslyckades: ${error.message}`);
        return ((data ?? []) as Array<{ name: string }>).some((objekt) => objekt.name === namn);
      },
    },
  };
}

Deno.serve(async (req: Request) => {
  // Auth boundary: the ONLY caller allowed is binfo-tick's pg_cron+pg_net
  // POST, authenticated by matching the `apikey` header against this
  // function's own `AUTOMATIONS_KEY` secret (set via
  // `supabase secrets set AUTOMATIONS_KEY=...`; must be set to the SAME
  // value as the `automations_key` Vault secret the cron job reads — that
  // pairing is a deploy-time operational detail, not something this code
  // manages). A plain `===` string comparison is an accepted, pragmatic
  // choice here rather than a timing-safe-compare dependency: this is a
  // single internal secret check on a low-frequency (once-a-minute,
  // 3x-per-tick) automation endpoint, not a public, high-frequency auth
  // surface where a timing side-channel is a realistic threat.
  const apiKey = req.headers.get("apikey");
  const expected = Deno.env.get("AUTOMATIONS_KEY");
  if (!expected || apiKey !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const env = lasEnvInline();
    // NOT Deno.env.get("SUPABASE_URL")/("SUPABASE_SECRET_KEY") — Supabase's
    // own auto-injected Edge Function env vars are documented as
    // SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (the legacy JWT pair), and on a
    // project that has migrated to the new sb_secret_/sb_publishable_ keys
    // and disabled the legacy ones (this project has, see SUPABASE.md), that
    // auto-injected value can be the now-disabled legacy JWT rather than the
    // active secret key — confirmed as a live upstream issue
    // (supabase/supabase#37648, the analogous SUPABASE_ANON_KEY case).
    // `supabase secrets set` also refuses any SUPABASE_-prefixed name
    // outright, so there is no way to override the reserved ones anyway.
    // Instead this reads two custom-named secrets set explicitly via
    // `supabase secrets set PROJECT_URL=... PROJECT_SECRET_KEY=...`,
    // carrying the exact same value as this repo's own
    // PROJECT_URL/PROJECT_SECRET_KEY in .env.local.
    const sb = createClient(
      kravMiljovariabel("PROJECT_URL"),
      kravMiljovariabel("PROJECT_SECRET_KEY"),
      { auth: { persistSession: false } },
    );
    const lager = byggLager(sb);

    // Remove the queue-waiting bottleneck: without this, a job only advances one
    // stage per `binfo-tick` (every minute). `korNastaSteg` calls `reinvoke()`
    // itself (see src/server/steg.ts) the moment a stage succeeds and leaves the
    // row `queued` with more work to do right now.
    //
    // VERIFIED on a local Supabase stack (2026-10-10): `req.url` inside the
    // runtime is the INTERNAL address (`http://kong:8081/analys-steg` — internal
    // port, no /functions/v1), which refuses the connection, so the old
    // `fetch(req.url)` never landed and every stage waited for the next minute
    // tick (a text job took 176 s instead of 106 s). The self-POST therefore goes
    // through the public gateway, `<PROJECT_URL>/functions/v1/analys-steg`
    // (reinvoke.ts), with the same `apikey` header pg_cron uses, so the auth check
    // above passes the same way as for a cron-triggered invocation.
    //
    // Deliberately NOT awaited: this invocation must return its own HTTP
    // response promptly (the reason the pipeline is split into small steps is the
    // per-invocation wall-clock and CPU limits — see SUPABASE.md). `.catch`
    // swallows a failed self-invoke on purpose: it is a pure speed-up, never a
    // correctness dependency; `binfo-tick`'s once-a-minute poll remains the safety
    // net. `EdgeRuntime.waitUntil` (when the runtime provides it) keeps the
    // outbound request alive after the response has been sent.
    const reinvokeUrl = byggReinvokeUrl(kravMiljovariabel("PROJECT_URL"));
    const reinvoke = () => {
      const gjord = fetch(reinvokeUrl, {
        method: "POST",
        headers: { apikey: expected },
      }).catch(() => {
        // Best-effort — see the comment above.
      });
      const runtime = (
        globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }
      ).EdgeRuntime;
      runtime?.waitUntil?.(gjord);
    };

    // deno-lint-ignore no-explicit-any
    const resultat = await korNastaSteg(lager as any, env, { reinvoke });
    return new Response(JSON.stringify(resultat), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "internal",
        message: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// TODO(follow-up): extend src/server/edge/build.ts to bundle a shared entry
// point (e.g. src/server/edge-entry.ts re-exporting `korNastaSteg`,
// `lasEnv`, and `skapaLager` together) so this file can import all three
// from ./_bundle instead of carrying its own duplicated Env/Lager adapter.
// Out of scope for this task — src/server/edge/build.ts and src/server/steg.ts
// are owned by other work and were deliberately not touched here.
