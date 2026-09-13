/**
 * Real `@supabase/supabase-js`-backed implementation of the `Lager` port
 * (see `./portar.ts`). A straightforward column-name mapping onto the
 * migration in `supabase/migrations/20260913105304_init.sql` — no
 * business logic lives here, only translation between the camelCase
 * `AnalysRad` shape and the database's snake_case columns/RPCs.
 *
 * Deliberately web-standard-only (plus `@supabase/supabase-js`): no
 * `node:` imports, so this file can also be bundled for the Deno-based
 * Edge Function that runs the job tick.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  AnalysCacheRad,
  AnalysErrorCode,
  AnalysRad,
  AnalysStage,
  AnalysStatus,
  Databas,
  ExtraktionCacheRad,
  Filarkiv,
  Lager,
  NyAnalysRad,
} from "./portar";

const BUCKET = "arsredovisningar";

/** Row shape as it comes back from PostgREST — snake_case, matching the
 *  `analys` table exactly. */
interface AnalysRow {
  id: string;
  status: AnalysStatus;
  stage: AnalysStage;
  pdf_hash: string;
  pdf_path: string | null;
  property_input: AnalysRad["propertyInput"];
  model: string;
  prompt_version: string;
  grundtext: string | null;
  lease_until: string | null;
  attempts: number;
  error_code: AnalysErrorCode | null;
  error_message: string | null;
  cost_sek: number | string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

function radFranRad(row: AnalysRow): AnalysRad {
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
  };
}

/** Maps only the keys present in `delta` — used for both insert (via
 *  `NyAnalysRad`, which is always a full row) and partial update. */
function radTillRad(delta: Partial<AnalysRad>): Record<string, unknown> {
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
  return row;
}

interface ExtraktionCacheRow {
  extraction: ExtraktionCacheRad["extraction"];
  schema_version: string;
  cost_sek: number | string;
  orgnr: string | null;
  rakenskapsar: number | null;
}

interface AnalysCacheRow {
  judgement: AnalysCacheRad["judgement"];
  cost_sek: number | string;
}

function skapaDatabas(sb: SupabaseClient): Databas {
  return {
    async skapaAnalys(rad: NyAnalysRad): Promise<{ id: string }> {
      const { data, error } = await sb.from("analys").insert(radTillRad(rad)).select("id").single();
      if (error) throw new Error(`skapaAnalys misslyckades: ${error.message}`);
      return { id: (data as { id: string }).id };
    },

    async hamtaAnalys(id: string): Promise<AnalysRad | null> {
      const { data, error } = await sb.from("analys").select("*").eq("id", id).maybeSingle();
      if (error) throw new Error(`hamtaAnalys misslyckades: ${error.message}`);
      return data ? radFranRad(data as AnalysRow) : null;
    },

    async uppdateraAnalys(id: string, delta: Partial<AnalysRad>): Promise<void> {
      const { error } = await sb.from("analys").update(radTillRad(delta)).eq("id", id);
      if (error) throw new Error(`uppdateraAnalys misslyckades: ${error.message}`);
    },

    async klaimaNastaSteg(leaseSekunder?: number): Promise<AnalysRad | null> {
      const { data, error } = await sb.rpc("claim_next_steg", {
        p_lease_sekunder: leaseSekunder ?? 300,
      });
      if (error) throw new Error(`klaimaNastaSteg misslyckades: ${error.message}`);
      const row = data as AnalysRow | null;
      if (!row || !row.id) return null;
      return radFranRad(row);
    },

    async slappSteg(id: string, ateranvandForsok: boolean): Promise<void> {
      const { error } = await sb.rpc("slapp_steg", {
        p_id: id,
        p_ateranvand_forsok: ateranvandForsok,
      });
      if (error) throw new Error(`slappSteg misslyckades: ${error.message}`);
    },

    async hamtaExtraktion(
      pdfHash: string,
      model: string,
      promptVersion: string,
    ): Promise<ExtraktionCacheRad | null> {
      const { data, error } = await sb
        .from("extraktion_cache")
        .select("extraction, schema_version, cost_sek, orgnr, rakenskapsar")
        .eq("pdf_hash", pdfHash)
        .eq("model", model)
        .eq("prompt_version", promptVersion)
        .maybeSingle();
      if (error) throw new Error(`hamtaExtraktion misslyckades: ${error.message}`);
      if (!data) return null;
      const row = data as ExtraktionCacheRow;
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
      rad: ExtraktionCacheRad,
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

    async hamtaAnalysCache(
      pdfHash: string,
      model: string,
      promptVersion: string,
    ): Promise<AnalysCacheRad | null> {
      const { data, error } = await sb
        .from("analys_cache")
        .select("judgement, cost_sek")
        .eq("pdf_hash", pdfHash)
        .eq("model", model)
        .eq("prompt_version", promptVersion)
        .maybeSingle();
      if (error) throw new Error(`hamtaAnalysCache misslyckades: ${error.message}`);
      if (!data) return null;
      const row = data as AnalysCacheRow;
      return { judgement: row.judgement, costSek: Number(row.cost_sek) };
    },

    async sparaAnalysCache(
      pdfHash: string,
      model: string,
      promptVersion: string,
      rad: AnalysCacheRad,
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

    async raderaAnalys(id: string): Promise<{ pdfBlevForlorad: boolean }> {
      const { data, error } = await sb.rpc("radera_analys", { p_id: id });
      if (error) throw new Error(`raderaAnalys misslyckades: ${error.message}`);
      return { pdfBlevForlorad: data === true };
    },
  };
}

function skapaFilarkiv(sb: SupabaseClient): Filarkiv {
  const bucket = sb.storage.from(BUCKET);
  return {
    async laggUpp(sokvag: string, bytes: Uint8Array): Promise<void> {
      const { error } = await bucket.upload(sokvag, bytes, { upsert: false });
      if (error) {
        // Content-addressed storage: the same PDF uploaded by a second
        // buyer is expected to already exist. Tolerate that, surface
        // anything else.
        const redanFinns =
          "statusCode" in error && (error as { statusCode?: string }).statusCode === "409";
        if (redanFinns || /already exists|Duplicate/i.test(error.message)) return;
        throw new Error(`laggUpp misslyckades: ${error.message}`);
      }
    },

    async hamta(sokvag: string): Promise<Uint8Array> {
      const { data, error } = await bucket.download(sokvag);
      if (error) throw new Error(`hamta misslyckades: ${error.message}`);
      return new Uint8Array(await data.arrayBuffer());
    },

    async ta_bort(sokvag: string): Promise<void> {
      const { error } = await bucket.remove([sokvag]);
      if (error) throw new Error(`ta_bort misslyckades: ${error.message}`);
    },
  };
}

export function skapaLager(env: { supabaseUrl: string; supabaseSecretKey: string }): Lager {
  const sb = createClient(env.supabaseUrl, env.supabaseSecretKey, {
    auth: { persistSession: false },
  });
  return {
    db: skapaDatabas(sb),
    filer: skapaFilarkiv(sb),
  };
}
