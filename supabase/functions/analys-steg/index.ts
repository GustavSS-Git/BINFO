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
// adapter below implements ONLY the `Databas`/`Filarkiv` methods reachable
// from `korNastaSteg` (not `skapaAnalys`, `hamtaAnalys`, `raderaAnalys`,
// `laggUpp`, or `ta_bort` — none of those are called by the tick), and
// mirrors src/server/supabase.ts's exact table/column/RPC mapping against
// supabase/migrations/20260913105304_init.sql so the two stay consistent.
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

interface InlineEnv {
  maxDailySpendSek: number;
  killSwitchPa: boolean;
  anthropicApiKey: string;
  maxCostPerAnalysisSek: number;
}

function lasEnvInline(): InlineEnv {
  const maxCostRått = Deno.env.get("MAX_COST_PER_ANALYSIS_SEK");
  return {
    maxDailySpendSek: kravPositivtTal("MAX_DAILY_SPEND_SEK"),
    killSwitchPa: Deno.env.get("ANALYSIS_KILL_SWITCH") === "on",
    anthropicApiKey: kravMiljovariabel("ANTHROPIC_API_KEY"),
    // Samma default (5 kr) som lasEnv i src/server/env.ts.
    maxCostPerAnalysisSek: maxCostRått ? Number(maxCostRått) : 5,
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
  return row;
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
        rad: { extraction: unknown; schemaVersion: string; costSek: number; orgnr: string | null; rakenskapsar: number | null },
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

      // skapaAnalys, hamtaAnalys och raderaAnalys är MEDVETET utelämnade —
      // ingenting i korNastaSteg's anropskedja rör dem (de hör till
      // upload-/deletion-rutterna, inte till tick-loopen).
    },

    filer: {
      async hamta(sokvag: string): Promise<Uint8Array> {
        const { data, error } = await sb.storage.from(BUCKET).download(sokvag);
        if (error) throw new Error(`hamta misslyckades: ${error.message}`);
        return new Uint8Array(await data.arrayBuffer());
      },
      // laggUpp och ta_bort är MEDVETET utelämnade — se kommentaren ovan.
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
    // SUPABASE_URL/SUPABASE_SECRET_KEY in .env.local.
    const sb = createClient(
      kravMiljovariabel("PROJECT_URL"),
      kravMiljovariabel("PROJECT_SECRET_KEY"),
      { auth: { persistSession: false } },
    );
    const lager = byggLager(sb);

    // deno-lint-ignore no-explicit-any
    const resultat = await korNastaSteg(lager as any, env);
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
