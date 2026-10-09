/**
 * Real `@supabase/supabase-js`-backed implementation of the `KontoDatabas`
 * port (see `./kontoPortar.ts`). Translation only — the semantics live in the
 * SQL functions of `supabase/migrations/20261009120100_konto.sql`, mirrored
 * for tests by `./__fakes__/konto.ts`.
 *
 * Web-standard only (plus `@supabase/supabase-js`), like `./supabase.ts`.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  ExporteradAnalys,
  KontoDatabas,
  PrincipalExport,
  PrincipalRad,
  PrincipalTyp,
  RaderingsResultat,
} from "./kontoPortar";

interface PrincipalRow {
  id: string;
  typ: PrincipalTyp;
  enhet_id: string | null;
  auth_user_id: string | null;
  skapad: string;
  senast_sedd: string;
  sammanslagen_till: string | null;
}

interface ExportAnalysRow {
  id: string;
  created_at: string;
  property_input: ExporteradAnalys["propertyInput"];
  rapport_id: string | null;
}

function principalFranRad(row: PrincipalRow): PrincipalRad {
  return {
    id: row.id,
    typ: row.typ,
    enhetId: row.enhet_id,
    authUserId: row.auth_user_id,
    skapad: row.skapad,
    senastSedd: row.senast_sedd,
    sammanslagenTill: row.sammanslagen_till,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tal(varde: unknown): number {
  const n = Number(varde);
  return Number.isFinite(n) ? n : 0;
}

export function skapaKontoDatabasFranKlient(sb: SupabaseClient): KontoDatabas {
  return {
    async sakerstallPrincipal(enhetId: string): Promise<string> {
      const { data, error } = await sb.rpc("sakerstall_principal", { p_enhet_id: enhetId });
      if (error) throw new Error(`sakerstallPrincipal misslyckades: ${error.message}`);
      if (typeof data !== "string" || data.length === 0) {
        throw new Error("sakerstallPrincipal misslyckades: inget principal-id returnerades");
      }
      return data;
    },

    async hamtaPrincipal(id: string): Promise<PrincipalRad | null> {
      const { data, error } = await sb.from("principal").select("*").eq("id", id).maybeSingle();
      if (error) throw new Error(`hamtaPrincipal misslyckades: ${error.message}`);
      return data ? principalFranRad(data as PrincipalRow) : null;
    },

    async slaSammanPrincipal(fran: string, till: string): Promise<void> {
      const { error } = await sb.rpc("sla_samman_principal", { p_fran: fran, p_till: till });
      if (error) throw new Error(`slaSammanPrincipal misslyckades: ${error.message}`);
    },

    async taKvot(nyckel: string, fonsterSek: number, max: number): Promise<boolean> {
      const { data, error } = await sb.rpc("ta_kvot", {
        p_nyckel: nyckel,
        p_fonster_sek: fonsterSek,
        p_max: max,
      });
      if (error) throw new Error(`taKvot misslyckades: ${error.message}`);
      return data === true;
    },

    async aterlamnaKvot(nyckel: string, fonsterSek: number): Promise<void> {
      const { error } = await sb.rpc("aterlamna_kvot", {
        p_nyckel: nyckel,
        p_fonster_sek: fonsterSek,
      });
      if (error) throw new Error(`aterlamnaKvot misslyckades: ${error.message}`);
    },

    async raderaPrincipal(id: string): Promise<RaderingsResultat> {
      const { data, error } = await sb.rpc("radera_principal", { p_id: id });
      if (error) throw new Error(`raderaPrincipal misslyckades: ${error.message}`);
      const rad = (data ?? {}) as Record<string, unknown>;
      return {
        principaler: tal(rad["principaler"]),
        analyser: tal(rad["analyser"]),
        behorigheter: tal(rad["behorigheter"]),
        kvotrader: tal(rad["kvotrader"]),
      };
    },

    async exporteraPrincipal(id: string): Promise<PrincipalExport | null> {
      // The id is interpolated into a PostgREST `or=` filter string below,
      // so it must be a plain uuid — anything else could alter the filter.
      if (!UUID.test(id)) throw new Error("exporteraPrincipal: id måste vara ett uuid");
      const { data: pData, error: pError } = await sb
        .from("principal")
        .select("id, typ, skapad, senast_sedd")
        .or(`id.eq.${id},sammanslagen_till.eq.${id}`);
      if (pError) throw new Error(`exporteraPrincipal misslyckades: ${pError.message}`);
      const rader = (pData ?? []) as Array<
        Pick<PrincipalRow, "id" | "typ" | "skapad" | "senast_sedd">
      >;
      if (!rader.some((p) => p.id === id)) return null;

      const ids = rader.map((p) => p.id);
      const { data: aData, error: aError } = await sb
        .from("analys")
        .select("id, created_at, property_input, rapport_id")
        .in("principal_id", ids)
        .order("created_at", { ascending: true });
      if (aError) throw new Error(`exporteraPrincipal misslyckades: ${aError.message}`);

      return {
        principaler: rader.map((p) => ({
          id: p.id,
          typ: p.typ,
          skapad: p.skapad,
          senastSedd: p.senast_sedd,
        })),
        analyser: ((aData ?? []) as ExportAnalysRow[]).map((a) => ({
          id: a.id,
          createdAt: a.created_at,
          propertyInput: a.property_input,
          rapportId: a.rapport_id,
        })),
      };
    },
  };
}

export function skapaKontoDatabas(env: {
  supabaseUrl: string;
  supabaseSecretKey: string;
}): KontoDatabas {
  const sb = createClient(env.supabaseUrl, env.supabaseSecretKey, {
    auth: { persistSession: false },
  });
  return skapaKontoDatabasFranKlient(sb);
}
