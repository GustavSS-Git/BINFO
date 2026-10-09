/**
 * Real `@supabase/supabase-js`-backed implementation of the `Lager` port
 * (see `./portar.ts`). A straightforward column-name mapping onto the
 * migrations in `supabase/migrations/20260913105304_init.sql` and
 * `20261009120000_register.sql` — no business logic lives here, only
 * translation between the camelCase row shapes and the database's
 * snake_case columns/RPCs.
 *
 * KEEP IN SYNC: supabase/functions/analys-steg/index.ts carries a
 * hand-written copy of every method the worker reaches (see that file's
 * note (c)). A change to a column mapping here must be made there too.
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
  ExtraktionCacheListRad,
  ExtraktionCacheRad,
  Filarkiv,
  ForeningRad,
  Lager,
  NyAnalysRad,
  NyForeningAdress,
  NyRapportFilRad,
  NyRapportRad,
  RapportDelta,
  RapportErrorCode,
  RapportFilRad,
  RapportFilter,
  RapportKonflikt,
  RapportRad,
  RapportStage,
  RapportStatus,
  Sidtext,
  SidtextKalla,
  SkapaRapportResultat,
  Textlager,
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
  /** Absent on rows read before the register migration was applied. */
  rapport_id?: string | null;
  /** Absent on rows read before the konto migration was applied. */
  principal_id?: string | null;
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
    rapportId: row.rapport_id ?? null,
    principalId: row.principal_id ?? null,
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
  // Only written when set, so a legacy insert never names a column that
  // exists only after the register migration.
  if ("rapportId" in delta && delta.rapportId != null) row["rapport_id"] = delta.rapportId;
  // Same rule for the konto migration's column.
  if ("principalId" in delta && delta.principalId != null) {
    row["principal_id"] = delta.principalId;
  }
  return row;
}

// ---------------------------------------------------------------------------
// Register rows
// ---------------------------------------------------------------------------

interface RapportRow {
  id: string;
  orgnr: string | null;
  rakenskapsar: number | null;
  pipeline_version: string;
  model: string;
  textlager: Textlager;
  status: RapportStatus;
  stage: RapportStage;
  pdf_hash: string | null;
  lease_until: string | null;
  attempts: number;
  grundtext: string | null;
  extraction: unknown;
  judgement: unknown;
  error_code: RapportErrorCode | null;
  error_message: string | null;
  cost_sek: number | string;
  cache_read_tokens: number | string;
  cache_write_tokens: number | string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  ersatt_av: string | null;
}

export function rapportFranRad(row: RapportRow): RapportRad {
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
  };
}

/** Maps only the keys present (same pattern as `radTillRad`). */
function rapportTillRad(delta: RapportDelta & Partial<NyRapportRad>): Record<string, unknown> {
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
  return row;
}

interface RapportFilRow {
  pdf_hash: string;
  rapport_id: string;
  pdf_path: string;
  sidor: number | null;
  bytes: number | null;
  uppladdad: string;
}

function rapportFilFranRad(row: RapportFilRow): RapportFilRad {
  return {
    pdfHash: row.pdf_hash,
    rapportId: row.rapport_id,
    pdfPath: row.pdf_path,
    sidor: row.sidor,
    bytes: row.bytes,
    uppladdad: row.uppladdad,
  };
}

/** The register's two partial unique indexes — its concurrency locks.
 *  Postgres reports a violation as SQLSTATE 23505 naming the index; anything
 *  else (including other 23505s) is a real error. */
export function tolkaRapportKonflikt(error: {
  code?: string;
  message: string;
}): RapportKonflikt | null {
  if (error.code !== "23505") return null;
  if (error.message.includes("rapport_identitet_uniq")) return "identitetskonflikt";
  if (error.message.includes("rapport_fil_version_uniq")) return "filkonflikt";
  return null;
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

    async hamtaSpendForDag(dag: string): Promise<number> {
      const { data, error } = await sb
        .from("spend_day")
        .select("cost_sek")
        .eq("day", dag)
        .maybeSingle();
      if (error) throw new Error(`hamtaSpendForDag misslyckades: ${error.message}`);
      return data ? Number((data as { cost_sek: number | string }).cost_sek) : 0;
    },

    async raderaAnalys(id: string): Promise<{ pdfBlevForlorad: boolean }> {
      const { data, error } = await sb.rpc("radera_analys", { p_id: id });
      if (error) throw new Error(`raderaAnalys misslyckades: ${error.message}`);
      return { pdfBlevForlorad: data === true };
    },

    // -----------------------------------------------------------------------
    // Register
    // -----------------------------------------------------------------------

    async skapaRapport(rad: NyRapportRad): Promise<SkapaRapportResultat> {
      const { data, error } = await sb
        .from("rapport")
        .insert(rapportTillRad(rad))
        .select("id")
        .single();
      if (error) {
        const konflikt = tolkaRapportKonflikt(error);
        if (konflikt) return { ok: false, orsak: konflikt };
        throw new Error(`skapaRapport misslyckades: ${error.message}`);
      }
      return { ok: true, id: (data as { id: string }).id };
    },

    async hamtaRapport(id: string): Promise<RapportRad | null> {
      const { data, error } = await sb.from("rapport").select("*").eq("id", id).maybeSingle();
      if (error) throw new Error(`hamtaRapport misslyckades: ${error.message}`);
      return data ? rapportFranRad(data as RapportRow) : null;
    },

    async uppdateraRapport(id: string, delta: RapportDelta): Promise<void> {
      const { error } = await sb.from("rapport").update(rapportTillRad(delta)).eq("id", id);
      if (error) throw new Error(`uppdateraRapport misslyckades: ${error.message}`);
    },

    async uppdateraLeasadRapport(
      id: string,
      lease: string | null,
      delta: RapportDelta,
    ): Promise<boolean> {
      let q = sb.from("rapport").update(rapportTillRad(delta)).eq("id", id).eq("status", "running");
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

    async listaRapporter(filter: RapportFilter): Promise<RapportRad[]> {
      let q = sb.from("rapport").select("*");
      if (filter.orgnr !== undefined) q = q.eq("orgnr", filter.orgnr);
      if (filter.rakenskapsar !== undefined) q = q.eq("rakenskapsar", filter.rakenskapsar);
      if (filter.pdfHash !== undefined) q = q.eq("pdf_hash", filter.pdfHash);
      let ordnad = q.order("created_at", { ascending: false });
      if (filter.limit !== undefined) ordnad = ordnad.limit(filter.limit);
      const { data, error } = await ordnad;
      if (error) throw new Error(`listaRapporter misslyckades: ${error.message}`);
      return (data as RapportRow[]).map(rapportFranRad);
    },

    async klaimaNastaRapportSteg(leaseSekunder?: number): Promise<RapportRad | null> {
      const { data, error } = await sb.rpc("claim_next_rapport_steg", {
        p_lease_sekunder: leaseSekunder ?? 300,
      });
      if (error) throw new Error(`klaimaNastaRapportSteg misslyckades: ${error.message}`);
      // A `returns rapport` function with no row comes back as an all-null
      // composite, not as null — same as claim_next_steg.
      const row = data as RapportRow | null;
      if (!row || !row.id) return null;
      return rapportFranRad(row);
    },

    async slappRapportSteg(id: string, ateranvandForsok: boolean): Promise<void> {
      const { error } = await sb.rpc("slapp_rapport_steg", {
        p_id: id,
        p_ateranvand_forsok: ateranvandForsok,
      });
      if (error) throw new Error(`slappRapportSteg misslyckades: ${error.message}`);
    },

    async hamtaRapportFil(pdfHash: string): Promise<RapportFilRad | null> {
      const { data, error } = await sb
        .from("rapport_fil")
        .select("*")
        .eq("pdf_hash", pdfHash)
        .maybeSingle();
      if (error) throw new Error(`hamtaRapportFil misslyckades: ${error.message}`);
      return data ? rapportFilFranRad(data as RapportFilRow) : null;
    },

    async skapaRapportFil(rad: NyRapportFilRad): Promise<RapportFilRad> {
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
      // Re-read: on a conflict the stored row is the concurrent winner's.
      const { data, error: lasFel } = await sb
        .from("rapport_fil")
        .select("*")
        .eq("pdf_hash", rad.pdfHash)
        .single();
      if (lasFel) throw new Error(`skapaRapportFil (omläsning) misslyckades: ${lasFel.message}`);
      return rapportFilFranRad(data as RapportFilRow);
    },

    async bytRapportForFil(
      pdfHash: string,
      franRapportId: string,
      tillRapportId: string,
    ): Promise<boolean> {
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

    async listaRapportFiler(rapportId: string): Promise<RapportFilRad[]> {
      const { data, error } = await sb
        .from("rapport_fil")
        .select("*")
        .eq("rapport_id", rapportId)
        .order("uppladdad", { ascending: true });
      if (error) throw new Error(`listaRapportFiler misslyckades: ${error.message}`);
      return (data as RapportFilRow[]).map(rapportFilFranRad);
    },

    async lankaOmAnalyser(franRapportId: string, tillRapportId: string): Promise<void> {
      const { error } = await sb
        .from("analys")
        .update({ rapport_id: tillRapportId })
        .eq("rapport_id", franRapportId);
      if (error) throw new Error(`lankaOmAnalyser misslyckades: ${error.message}`);
    },

    async hamtaAnalyserForRapport(rapportId: string, limit: number): Promise<AnalysRad[]> {
      const { data, error } = await sb
        .from("analys")
        .select("*")
        .eq("rapport_id", rapportId)
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error(`hamtaAnalyserForRapport misslyckades: ${error.message}`);
      return (data as AnalysRow[]).map(radFranRad);
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

    async hamtaForening(orgnr: string): Promise<ForeningRad | null> {
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

    async registreraForeningAdress(rad: NyForeningAdress): Promise<void> {
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

    async hamtaSidtext(rapportId: string, kalla?: SidtextKalla): Promise<Sidtext[]> {
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
      sidor: readonly Sidtext[],
      kalla: SidtextKalla,
    ): Promise<void> {
      if (sidor.length === 0) return;
      const { error } = await sb.from("sidtext").upsert(
        sidor.map((s) => ({ rapport_id: rapportId, sida: s.sida, text: s.text, kalla })),
        { onConflict: "rapport_id,sida" },
      );
      if (error) throw new Error(`sparaSidtext misslyckades: ${error.message}`);
    },

    async listaExtraktionCache(promptVersion: string): Promise<ExtraktionCacheListRad[]> {
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
          ExtraktionCacheRow & {
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

    async finns(sokvag: string): Promise<boolean> {
      // list() + exact name match rather than a download: no bytes moved.
      const snedstreck = sokvag.lastIndexOf("/");
      const katalog = snedstreck === -1 ? "" : sokvag.slice(0, snedstreck);
      const namn = sokvag.slice(snedstreck + 1);
      const { data, error } = await bucket.list(katalog, { search: namn, limit: 100 });
      if (error) throw new Error(`finns misslyckades: ${error.message}`);
      return (data ?? []).some((objekt) => objekt.name === namn);
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
