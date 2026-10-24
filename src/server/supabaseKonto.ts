/**
 * Real `@supabase/supabase-js`-backed implementation of the `KontoDatabas`
 * port (see `./kontoPortar.ts`). Translation only — the semantics live in the
 * SQL of `supabase/migrations/20261009120100_konto.sql` and
 * `supabase/migrations/20261013120000_konto_v3.sql`, mirrored for tests by
 * `./__fakes__/konto.ts`.
 *
 * Web-standard only (plus `@supabase/supabase-js`), like `./supabase.ts`.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  AnalysListrad,
  ExporteradKalkyl,
  ExporteradVardering,
  ExporteradAnalys,
  KontoDatabas,
  KontoPrincipalUtfall,
  NySparadKalkyl,
  NySparadVardering,
  PrincipalExport,
  PrincipalRad,
  PrincipalTyp,
  RaderingsResultat,
  SparadKalkylDelta,
  SparadKalkylRad,
  SparadVarderingListrad,
  SparadVarderingRad,
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

interface VarderingRow {
  id: string;
  principal_id: string;
  etikett: string | null;
  input: unknown;
  resultat: unknown;
  modell_version: string;
  skapad: string;
}

interface VarderingListRow {
  id: string;
  principal_id: string;
  etikett: string | null;
  input: unknown;
  extern_vardering: unknown;
  modell_version: string;
  skapad: string;
}

interface KalkylRow {
  id: string;
  principal_id: string;
  etikett: string | null;
  input: unknown;
  sammanfattning: unknown;
  regelversion: string;
  skapad: string;
  uppdaterad: string;
}

interface AnalysListRow {
  analys_id: string;
  skapad: string;
  status: string;
  stage: string;
  error_code: string | null;
  orgnr: string | null;
  namn: string | null;
  rakenskapsar: number | null;
  betyg: string | null;
  adress: string | null;
  utgangspris: number | string | null;
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

function varderingFranRad(r: VarderingRow): SparadVarderingRad {
  return {
    id: r.id,
    principalId: r.principal_id,
    etikett: r.etikett,
    input: r.input,
    resultat: r.resultat,
    modellVersion: r.modell_version,
    skapad: r.skapad,
  };
}

function kalkylFranRad(r: KalkylRow): SparadKalkylRad {
  return {
    id: r.id,
    principalId: r.principal_id,
    etikett: r.etikett,
    input: r.input,
    sammanfattning: r.sammanfattning,
    regelversion: r.regelversion,
    skapad: r.skapad,
    uppdaterad: r.uppdaterad,
  };
}

const VARDERING_KOLUMNER = "id, principal_id, etikett, input, resultat, modell_version, skapad";
const KALKYL_KOLUMNER =
  "id, principal_id, etikett, input, sammanfattning, regelversion, skapad, uppdaterad";

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
        sparadeVarderingar: tal(rad["sparade_varderingar"]),
        sparadeKalkyler: tal(rad["sparade_kalkyler"]),
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

      const { data: vData, error: vError } = await sb
        .from("sparad_vardering")
        .select(VARDERING_KOLUMNER)
        .in("principal_id", ids)
        .order("skapad", { ascending: true });
      if (vError) throw new Error(`exporteraPrincipal misslyckades: ${vError.message}`);

      const { data: kData, error: kError } = await sb
        .from("sparad_kalkyl")
        .select(KALKYL_KOLUMNER)
        .in("principal_id", ids)
        .order("skapad", { ascending: true });
      if (kError) throw new Error(`exporteraPrincipal misslyckades: ${kError.message}`);

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
        sparadeVarderingar: ((vData ?? []) as VarderingRow[]).map((v): ExporteradVardering => ({
          id: v.id,
          etikett: v.etikett,
          skapad: v.skapad,
          modellVersion: v.modell_version,
          input: v.input,
          resultat: v.resultat,
        })),
        sparadeKalkyler: ((kData ?? []) as KalkylRow[]).map((k): ExporteradKalkyl => ({
          id: k.id,
          etikett: k.etikett,
          skapad: k.skapad,
          uppdaterad: k.uppdaterad,
          regelversion: k.regelversion,
          input: k.input,
          sammanfattning: k.sammanfattning,
        })),
      };
    },

    // -----------------------------------------------------------------------
    // v3
    // -----------------------------------------------------------------------

    async sakerstallKontoPrincipal(
      authUserId: string,
      enhetId: string | null,
    ): Promise<KontoPrincipalUtfall> {
      const { data, error } = await sb.rpc("sakerstall_konto_principal", {
        p_auth_user_id: authUserId,
        p_enhet_id: enhetId,
      });
      if (error) throw new Error(`sakerstallKontoPrincipal misslyckades: ${error.message}`);
      const rad = (data ?? {}) as { principal_id?: unknown; sammanslagen?: unknown };
      if (typeof rad.principal_id !== "string" || rad.principal_id.length === 0) {
        throw new Error("sakerstallKontoPrincipal misslyckades: inget principal-id returnerades");
      }
      return { principalId: rad.principal_id, sammanslagen: rad.sammanslagen === true };
    },

    async skapaSparadVardering(rad: NySparadVardering): Promise<SparadVarderingRad> {
      const { data, error } = await sb
        .from("sparad_vardering")
        .insert({
          principal_id: rad.principalId,
          etikett: rad.etikett,
          input: rad.input,
          resultat: rad.resultat,
          modell_version: rad.modellVersion,
        })
        .select(VARDERING_KOLUMNER)
        .single();
      if (error) throw new Error(`skapaSparadVardering misslyckades: ${error.message}`);
      return varderingFranRad(data as VarderingRow);
    },

    async listaSparadeVarderingar(principalId: string): Promise<SparadVarderingListrad[]> {
      const { data, error } = await sb
        .from("sparad_vardering")
        .select(
          "id, principal_id, etikett, input, modell_version, skapad, " +
            "extern_vardering:resultat->prisanalys->externVardering",
        )
        .eq("principal_id", principalId)
        .order("skapad", { ascending: false });
      if (error) throw new Error(`listaSparadeVarderingar misslyckades: ${error.message}`);
      return ((data ?? []) as unknown as VarderingListRow[]).map((r) => ({
        id: r.id,
        principalId: r.principal_id,
        etikett: r.etikett,
        input: r.input,
        externVardering: r.extern_vardering ?? null,
        modellVersion: r.modell_version,
        skapad: r.skapad,
      }));
    },

    async hamtaSparadVardering(
      id: string,
      principalId: string,
    ): Promise<SparadVarderingRad | null> {
      const { data, error } = await sb
        .from("sparad_vardering")
        .select(VARDERING_KOLUMNER)
        .eq("id", id)
        .eq("principal_id", principalId)
        .maybeSingle();
      if (error) throw new Error(`hamtaSparadVardering misslyckades: ${error.message}`);
      return data ? varderingFranRad(data as VarderingRow) : null;
    },

    async raderaSparadVardering(id: string, principalId: string): Promise<boolean> {
      const { data, error } = await sb
        .from("sparad_vardering")
        .delete()
        .eq("id", id)
        .eq("principal_id", principalId)
        .select("id");
      if (error) throw new Error(`raderaSparadVardering misslyckades: ${error.message}`);
      return (data ?? []).length > 0;
    },

    async raknaSparadeVarderingar(principalId: string): Promise<number> {
      const { count, error } = await sb
        .from("sparad_vardering")
        .select("id", { count: "exact", head: true })
        .eq("principal_id", principalId);
      if (error) throw new Error(`raknaSparadeVarderingar misslyckades: ${error.message}`);
      return count ?? 0;
    },

    async skapaSparadKalkyl(rad: NySparadKalkyl): Promise<SparadKalkylRad> {
      const { data, error } = await sb
        .from("sparad_kalkyl")
        .insert({
          principal_id: rad.principalId,
          etikett: rad.etikett,
          input: rad.input,
          sammanfattning: rad.sammanfattning,
          regelversion: rad.regelversion,
        })
        .select(KALKYL_KOLUMNER)
        .single();
      if (error) throw new Error(`skapaSparadKalkyl misslyckades: ${error.message}`);
      return kalkylFranRad(data as KalkylRow);
    },

    async uppdateraSparadKalkyl(
      id: string,
      principalId: string,
      delta: SparadKalkylDelta,
    ): Promise<SparadKalkylRad | null> {
      const { data, error } = await sb
        .from("sparad_kalkyl")
        .update({
          etikett: delta.etikett,
          input: delta.input,
          sammanfattning: delta.sammanfattning,
          regelversion: delta.regelversion,
          uppdaterad: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("principal_id", principalId)
        .select(KALKYL_KOLUMNER)
        .maybeSingle();
      if (error) throw new Error(`uppdateraSparadKalkyl misslyckades: ${error.message}`);
      return data ? kalkylFranRad(data as KalkylRow) : null;
    },

    async listaSparadeKalkyler(principalId: string): Promise<SparadKalkylRad[]> {
      const { data, error } = await sb
        .from("sparad_kalkyl")
        .select(KALKYL_KOLUMNER)
        .eq("principal_id", principalId)
        .order("skapad", { ascending: false });
      if (error) throw new Error(`listaSparadeKalkyler misslyckades: ${error.message}`);
      return ((data ?? []) as KalkylRow[]).map(kalkylFranRad);
    },

    async hamtaSparadKalkyl(id: string, principalId: string): Promise<SparadKalkylRad | null> {
      const { data, error } = await sb
        .from("sparad_kalkyl")
        .select(KALKYL_KOLUMNER)
        .eq("id", id)
        .eq("principal_id", principalId)
        .maybeSingle();
      if (error) throw new Error(`hamtaSparadKalkyl misslyckades: ${error.message}`);
      return data ? kalkylFranRad(data as KalkylRow) : null;
    },

    async raderaSparadKalkyl(id: string, principalId: string): Promise<boolean> {
      const { data, error } = await sb
        .from("sparad_kalkyl")
        .delete()
        .eq("id", id)
        .eq("principal_id", principalId)
        .select("id");
      if (error) throw new Error(`raderaSparadKalkyl misslyckades: ${error.message}`);
      return (data ?? []).length > 0;
    },

    async raknaSparadeKalkyler(principalId: string): Promise<number> {
      const { count, error } = await sb
        .from("sparad_kalkyl")
        .select("id", { count: "exact", head: true })
        .eq("principal_id", principalId);
      if (error) throw new Error(`raknaSparadeKalkyler misslyckades: ${error.message}`);
      return count ?? 0;
    },

    async listaAnalyser(principalId: string): Promise<AnalysListrad[]> {
      const { data, error } = await sb.rpc("lista_mina_analyser", { p_principal: principalId });
      if (error) throw new Error(`listaAnalyser misslyckades: ${error.message}`);
      return ((data ?? []) as AnalysListRow[]).map((r) => ({
        analysId: r.analys_id,
        skapad: r.skapad,
        status: r.status,
        stage: r.stage,
        errorCode: r.error_code,
        orgnr: r.orgnr,
        foreningNamn: r.namn,
        rakenskapsar: r.rakenskapsar,
        betyg: r.betyg,
        adress: r.adress,
        utgangspris: r.utgangspris === null ? null : tal(r.utgangspris),
      }));
    },

    async raderaAnalysFranLista(
      principalId: string,
      analysId: string,
    ): Promise<{ borttagen: boolean; pdfBlevForlorad: boolean }> {
      const { data, error } = await sb.rpc("radera_min_analys", {
        p_principal: principalId,
        p_analys: analysId,
      });
      if (error) throw new Error(`raderaAnalysFranLista misslyckades: ${error.message}`);
      const rad = (data ?? {}) as { borttagen?: unknown; pdf_blev_forlorad?: unknown };
      return { borttagen: rad.borttagen === true, pdfBlevForlorad: rad.pdf_blev_forlorad === true };
    },

    async hamtaAnalysAgare(analysId: string): Promise<{ principalId: string | null } | null> {
      // `analys.id` is a uuid column: anything else would be a query error.
      if (!UUID.test(analysId)) return null;
      const { data, error } = await sb
        .from("analys")
        .select("principal_id")
        .eq("id", analysId)
        .maybeSingle();
      if (error) throw new Error(`hamtaAnalysAgare misslyckades: ${error.message}`);
      if (!data) return null;
      const pid = (data as { principal_id: string | null }).principal_id;
      return { principalId: typeof pid === "string" ? pid : null };
    },

    async flyttaAnalys(analysId: string, fran: string, till: string): Promise<boolean> {
      if (!UUID.test(analysId)) return false;
      const { data, error } = await sb
        .from("analys")
        .update({ principal_id: till })
        .eq("id", analysId)
        .eq("principal_id", fran)
        .select("id");
      if (error) throw new Error(`flyttaAnalys misslyckades: ${error.message}`);
      return (data ?? []).length > 0;
    },

    async lasAnnonsCache(url: string): Promise<{ svar: unknown; hamtad: string } | null> {
      const { data, error } = await sb
        .from("annons_cache")
        .select("svar, hamtad")
        .eq("url", url)
        .maybeSingle();
      if (error) throw new Error(`lasAnnonsCache misslyckades: ${error.message}`);
      if (!data) return null;
      const rad = data as { svar: unknown; hamtad: string };
      return { svar: rad.svar, hamtad: rad.hamtad };
    },

    async skrivAnnonsCache(url: string, svar: unknown): Promise<void> {
      const { error } = await sb
        .from("annons_cache")
        .upsert({ url, svar, hamtad: new Date().toISOString() }, { onConflict: "url" });
      if (error) throw new Error(`skrivAnnonsCache misslyckades: ${error.message}`);
    },

    async lasReferensranta(
      serie: string,
    ): Promise<{ datum: string; procent: number; hamtad: string } | null> {
      const { data, error } = await sb
        .from("referensranta")
        .select("datum, procent, hamtad")
        .eq("serie", serie)
        .maybeSingle();
      if (error) throw new Error(`lasReferensranta misslyckades: ${error.message}`);
      if (!data) return null;
      const rad = data as { datum: string; procent: number | string; hamtad: string };
      return { datum: rad.datum, procent: Number(rad.procent), hamtad: rad.hamtad };
    },

    async skrivReferensranta(
      serie: string,
      varde: { datum: string; procent: number },
    ): Promise<void> {
      const { error } = await sb
        .from("referensranta")
        .upsert(
          { serie, datum: varde.datum, procent: varde.procent, hamtad: new Date().toISOString() },
          { onConflict: "serie" },
        );
      if (error) throw new Error(`skrivReferensranta misslyckades: ${error.message}`);
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
