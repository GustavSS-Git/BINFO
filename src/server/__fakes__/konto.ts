/**
 * In-memory fake of the `KontoDatabas` port (see `../kontoPortar.ts`).
 * Mirrors the SQL in `supabase/migrations/20261009120100_konto.sql` and
 * `supabase/migrations/20261013120000_konto_v3.sql`:
 * `sakerstall_principal`, `sakerstall_konto_principal`, `sla_samman_principal`
 * (moves the saved items too), `ta_kvot` / `aterlamna_kvot` (UTC-aligned fixed
 * windows), `radera_principal` (with the FK cascade of the saved items), the
 * export query, `lista_mina_analyser`, `radera_min_analys`, and the plain
 * `analys` owner read / compare-and-set move behind "Spara analysen", and the
 * `annons_cache` read / upsert (`supabase/migrations/20261024120000_annons.sql`).
 *
 * By default it holds its own minimal `analys` table (only the columns this
 * layer touches) so merge/delete/export can be tested without the job fake.
 * To get ONE `analys` table — as in the real database, where
 * `sla_samman_principal`/`radera_principal` act on the very rows the job
 * code reads — pass the job fake's live table:
 *
 *   const lager = skapaFakeLager();
 *   const konto = skapaFakeKontoDatabas({ analyser: lager.db._analysTabell() });
 *
 * Then create rows through `lager.db.skapaAnalys` (with `principalId`), not
 * `laggTillAnalys` (which inserts only this layer's subset of columns).
 * `behorighet`, the saved items and the (list-only) `rapporter` are always
 * this fake's own tables.
 *
 * `skapaFakeKontoDatabas()` returns a fresh instance — one per test. Pass
 * `nu` to control the clock (window rollover tests).
 */

import type { PropertyInput } from "@/types/analysis";
import type {
  AnalysListrad,
  KontoDatabas,
  KontoPrincipalUtfall,
  NySparadKalkyl,
  NySparadVardering,
  PrincipalExport,
  PrincipalRad,
  RaderingsResultat,
  SparadKalkylDelta,
  SparadKalkylRad,
  SparadVarderingListrad,
  SparadVarderingRad,
} from "../kontoPortar";

export interface FakeAnalysRad {
  id: string;
  principalId: string | null;
  createdAt: string;
  propertyInput: PropertyInput;
  rapportId: string | null;
}

export interface FakeBehorighetRad {
  id: string;
  principalId: string;
  formaga: string;
  kalla: "gratis" | "kop" | "prenumeration";
  rapportId: string | null;
  giltigTill: string | null;
}

export interface FakeKvotRad {
  nyckel: string;
  fonsterStart: string;
  antal: number;
}

/** The slice of `rapport` + `forening` that `lista_mina_analyser` reads. */
export interface FakeRapportRad {
  id: string;
  orgnr: string | null;
  foreningNamn: string | null;
  rakenskapsar: number | null;
  status: string;
  stage: string;
  errorCode: string | null;
  /** `judgement->>'betyg'`; only listed when status is 'done'. */
  betyg: string | null;
}

export interface FakeKontoDatabas extends KontoDatabas {
  readonly principaler: Map<string, PrincipalRad>;
  readonly analyser: Map<string, FakeAnalysRad>;
  readonly behorigheter: Map<string, FakeBehorighetRad>;
  readonly sparadeVarderingar: Map<string, SparadVarderingRad>;
  readonly sparadeKalkyler: Map<string, SparadKalkylRad>;
  readonly rapporter: Map<string, FakeRapportRad>;
  /** `annons_cache`, keyed by the canonical listing URL. */
  readonly annonsCache: Map<string, { svar: unknown; hamtad: string }>;
  /** `referensranta`, keyed by series id. */
  readonly referensrantor: Map<string, { datum: string; procent: number; hamtad: string }>;
  /** Keyed `${nyckel}|${fonsterStart}`. */
  readonly kvot: Map<string, FakeKvotRad>;
  /** Calls to `radera_analys` made by `raderaAnalysFranLista` (analysId). */
  readonly raderadeAnalyser: string[];
  laggTillAnalys(rad: Omit<FakeAnalysRad, "createdAt"> & { createdAt?: string }): void;
  laggTillBehorighet(rad: Omit<FakeBehorighetRad, "id">): string;
  laggTillRapport(rad: FakeRapportRad): void;
}

/** Same arithmetic as `kvot_fonster_start`: floor(epoch / window) * window. */
export function fonsterStart(nu: Date, fonsterSek: number): string {
  const sek = Math.floor(nu.getTime() / 1000 / fonsterSek) * fonsterSek;
  return new Date(sek * 1000).toISOString();
}

export interface FakeKontoOptions {
  nu?: () => Date;
  /** Share an existing `analys` table (the job fake's
   *  `lager.db._analysTabell()`) instead of a private one. Rows are mutated
   *  in place, like an SQL update. */
  analyser?: Map<string, FakeAnalysRad>;
}

/** A deterministic uuid-shaped id (the service layer validates ids as uuids). */
function fakeUuid(prefix: number, n: number): string {
  return `${prefix.toString(16).padStart(8, "0")}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

export function skapaFakeKontoDatabas(opts: FakeKontoOptions = {}): FakeKontoDatabas {
  const nu = opts.nu ?? (() => new Date());
  const principaler = new Map<string, PrincipalRad>();
  const analyser = opts.analyser ?? new Map<string, FakeAnalysRad>();
  const behorigheter = new Map<string, FakeBehorighetRad>();
  const sparadeVarderingar = new Map<string, SparadVarderingRad>();
  const sparadeKalkyler = new Map<string, SparadKalkylRad>();
  const rapporter = new Map<string, FakeRapportRad>();
  const kvot = new Map<string, FakeKvotRad>();
  const annonsCache = new Map<string, { svar: unknown; hamtad: string }>();
  const referensrantor = new Map<string, { datum: string; procent: number; hamtad: string }>();
  const raderadeAnalyser: string[] = [];
  let nastaId = 1;

  function kravFonster(fonsterSek: number, namn: string): void {
    if (!Number.isFinite(fonsterSek) || fonsterSek <= 0) {
      throw new Error(`${namn}: p_fonster_sek must be > 0, got ${fonsterSek}`);
    }
  }

  function hittaPaEnhet(enhetId: string): PrincipalRad | undefined {
    for (const p of principaler.values()) if (p.enhetId === enhetId) return p;
    return undefined;
  }

  function hittaPaAuthUser(authUserId: string): PrincipalRad | undefined {
    for (const p of principaler.values()) if (p.authUserId === authUserId) return p;
    return undefined;
  }

  /** `where id = p_id or sammanslagen_till = p_id`. */
  function medSammanslagna(id: string): PrincipalRad[] {
    return [...principaler.values()].filter((p) => p.id === id || p.sammanslagenTill === id);
  }

  function slaSamman(fran: string, till: string): void {
    if (fran === till) {
      throw new Error("sla_samman_principal: two different principal ids are required");
    }
    if (!principaler.has(fran)) throw new Error(`sla_samman_principal: unknown principal ${fran}`);
    const mal = principaler.get(till);
    if (!mal) throw new Error(`sla_samman_principal: unknown principal ${till}`);
    if (mal.sammanslagenTill !== null) {
      throw new Error(`sla_samman_principal: target ${till} is itself merged`);
    }
    for (const p of principaler.values()) {
      if (p.id === fran || p.sammanslagenTill === fran) p.sammanslagenTill = till;
    }
    for (const a of analyser.values()) if (a.principalId === fran) a.principalId = till;
    for (const b of behorigheter.values()) if (b.principalId === fran) b.principalId = till;
    for (const v of sparadeVarderingar.values()) if (v.principalId === fran) v.principalId = till;
    for (const k of sparadeKalkyler.values()) if (k.principalId === fran) k.principalId = till;
  }

  return {
    principaler,
    analyser,
    behorigheter,
    sparadeVarderingar,
    sparadeKalkyler,
    rapporter,
    kvot,
    annonsCache,
    referensrantor,
    raderadeAnalyser,

    laggTillAnalys(rad) {
      analyser.set(rad.id, { ...rad, createdAt: rad.createdAt ?? nu().toISOString() });
    },

    laggTillBehorighet(rad) {
      const id = `fake-behorighet-${nastaId++}`;
      behorigheter.set(id, { ...rad, id });
      return id;
    },

    laggTillRapport(rad) {
      rapporter.set(rad.id, { ...rad });
    },

    async sakerstallPrincipal(enhetId: string): Promise<string> {
      if (enhetId.length === 0) throw new Error("sakerstall_principal: p_enhet_id is required");
      const tid = nu().toISOString();
      const befintlig = hittaPaEnhet(enhetId);
      if (befintlig) {
        befintlig.senastSedd = tid;
        return befintlig.sammanslagenTill ?? befintlig.id;
      }
      const id = `fake-principal-${nastaId++}`;
      principaler.set(id, {
        id,
        typ: "anonym",
        enhetId,
        authUserId: null,
        skapad: tid,
        senastSedd: tid,
        sammanslagenTill: null,
      });
      return id;
    },

    async hamtaPrincipal(id: string): Promise<PrincipalRad | null> {
      const p = principaler.get(id);
      return p ? { ...p } : null;
    },

    async slaSammanPrincipal(fran: string, till: string): Promise<void> {
      slaSamman(fran, till);
    },

    async taKvot(nyckel: string, fonsterSek: number, max: number): Promise<boolean> {
      kravFonster(fonsterSek, "ta_kvot");
      const start = fonsterStart(nu(), fonsterSek);
      const k = `${nyckel}|${start}`;
      const rad = kvot.get(k) ?? { nyckel, fonsterStart: start, antal: 0 };
      kvot.set(k, rad);
      if (rad.antal + 1 > max) return false;
      rad.antal += 1;
      return true;
    },

    async aterlamnaKvot(nyckel: string, fonsterSek: number): Promise<void> {
      kravFonster(fonsterSek, "aterlamna_kvot");
      const rad = kvot.get(`${nyckel}|${fonsterStart(nu(), fonsterSek)}`);
      if (rad && rad.antal > 0) rad.antal -= 1;
    },

    async raderaPrincipal(id: string): Promise<RaderingsResultat> {
      const rader = medSammanslagna(id);
      const resultat: RaderingsResultat = {
        principaler: 0,
        analyser: 0,
        behorigheter: 0,
        kvotrader: 0,
        sparadeVarderingar: 0,
        sparadeKalkyler: 0,
      };
      if (rader.length === 0) return resultat;
      const ids = new Set(rader.map((p) => p.id));
      const suffix = rader
        .map((p) => p.enhetId)
        .filter((e): e is string => e !== null)
        .map((e) => `:enhet:${e}`);

      for (const [k, a] of analyser) {
        if (a.principalId !== null && ids.has(a.principalId)) {
          analyser.delete(k);
          resultat.analyser++;
        }
      }
      for (const [k, b] of behorigheter) {
        if (ids.has(b.principalId)) {
          behorigheter.delete(k);
          resultat.behorigheter++;
        }
      }
      for (const [k, v] of sparadeVarderingar) {
        if (ids.has(v.principalId)) {
          sparadeVarderingar.delete(k);
          resultat.sparadeVarderingar++;
        }
      }
      for (const [k, s] of sparadeKalkyler) {
        if (ids.has(s.principalId)) {
          sparadeKalkyler.delete(k);
          resultat.sparadeKalkyler++;
        }
      }
      for (const [k, r] of kvot) {
        if (suffix.some((s) => r.nyckel.endsWith(s))) {
          kvot.delete(k);
          resultat.kvotrader++;
        }
      }
      for (const pid of ids) {
        principaler.delete(pid);
        resultat.principaler++;
      }
      return resultat;
    },

    async exporteraPrincipal(id: string): Promise<PrincipalExport | null> {
      const rader = medSammanslagna(id);
      if (!rader.some((p) => p.id === id)) return null;
      const ids = new Set(rader.map((p) => p.id));
      return {
        principaler: rader.map(({ id: pid, typ, skapad, senastSedd }) => ({
          id: pid,
          typ,
          skapad,
          senastSedd,
        })),
        analyser: [...analyser.values()]
          .filter((a) => a.principalId !== null && ids.has(a.principalId))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map(({ id: aid, createdAt, propertyInput, rapportId }) => ({
            id: aid,
            createdAt,
            propertyInput,
            rapportId,
          })),
        sparadeVarderingar: [...sparadeVarderingar.values()]
          .filter((v) => ids.has(v.principalId))
          .sort((a, b) => a.skapad.localeCompare(b.skapad))
          .map((v) => ({
            id: v.id,
            etikett: v.etikett,
            skapad: v.skapad,
            modellVersion: v.modellVersion,
            input: v.input,
            resultat: v.resultat,
          })),
        sparadeKalkyler: [...sparadeKalkyler.values()]
          .filter((k) => ids.has(k.principalId))
          .sort((a, b) => a.skapad.localeCompare(b.skapad))
          .map((k) => ({
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
      if (authUserId.length === 0) {
        throw new Error("sakerstall_konto_principal: p_auth_user_id is required");
      }
      let konto = hittaPaAuthUser(authUserId);
      if (!konto) {
        const tid = nu().toISOString();
        const id = `fake-principal-${nastaId++}`;
        konto = {
          id,
          typ: "konto",
          enhetId: null,
          authUserId,
          skapad: tid,
          senastSedd: tid,
          sammanslagenTill: null,
        };
        principaler.set(id, konto);
      }
      let sammanslagen = false;
      if (enhetId !== null && enhetId.length > 0) {
        const enhet = hittaPaEnhet(enhetId);
        if (
          enhet &&
          enhet.typ === "anonym" &&
          enhet.sammanslagenTill === null &&
          enhet.id !== konto.id
        ) {
          slaSamman(enhet.id, konto.id);
          sammanslagen = true;
        }
      }
      return { principalId: konto.id, sammanslagen };
    },

    async skapaSparadVardering(rad: NySparadVardering): Promise<SparadVarderingRad> {
      if (!principaler.has(rad.principalId)) {
        throw new Error("sparad_vardering_principal_id_fkey: unknown principal");
      }
      if (rad.etikett !== null && rad.etikett.length > 120) {
        throw new Error("sparad_vardering_etikett_check: etikett too long");
      }
      const id = fakeUuid(1, nastaId++);
      const ny: SparadVarderingRad = {
        id,
        principalId: rad.principalId,
        etikett: rad.etikett,
        input: structuredClone(rad.input),
        resultat: structuredClone(rad.resultat),
        modellVersion: rad.modellVersion,
        skapad: nu().toISOString(),
      };
      sparadeVarderingar.set(id, ny);
      return structuredClone(ny);
    },

    async listaSparadeVarderingar(principalId: string): Promise<SparadVarderingListrad[]> {
      return [...sparadeVarderingar.values()]
        .filter((v) => v.principalId === principalId)
        .sort((a, b) => b.skapad.localeCompare(a.skapad))
        .map((v) => {
          const resultat = v.resultat as {
            prisanalys?: { externVardering?: unknown };
          } | null;
          return {
            id: v.id,
            principalId: v.principalId,
            etikett: v.etikett,
            input: structuredClone(v.input),
            externVardering: structuredClone(resultat?.prisanalys?.externVardering ?? null),
            modellVersion: v.modellVersion,
            skapad: v.skapad,
          };
        });
    },

    async hamtaSparadVardering(id, principalId) {
      const v = sparadeVarderingar.get(id);
      return v && v.principalId === principalId ? structuredClone(v) : null;
    },

    async raderaSparadVardering(id, principalId) {
      const v = sparadeVarderingar.get(id);
      if (!v || v.principalId !== principalId) return false;
      sparadeVarderingar.delete(id);
      return true;
    },

    async raknaSparadeVarderingar(principalId) {
      return [...sparadeVarderingar.values()].filter((v) => v.principalId === principalId).length;
    },

    async skapaSparadKalkyl(rad: NySparadKalkyl): Promise<SparadKalkylRad> {
      if (!principaler.has(rad.principalId)) {
        throw new Error("sparad_kalkyl_principal_id_fkey: unknown principal");
      }
      if (rad.etikett !== null && rad.etikett.length > 120) {
        throw new Error("sparad_kalkyl_etikett_check: etikett too long");
      }
      const id = fakeUuid(2, nastaId++);
      const tid = nu().toISOString();
      const ny: SparadKalkylRad = {
        id,
        principalId: rad.principalId,
        etikett: rad.etikett,
        input: structuredClone(rad.input),
        sammanfattning: structuredClone(rad.sammanfattning),
        regelversion: rad.regelversion,
        skapad: tid,
        uppdaterad: tid,
      };
      sparadeKalkyler.set(id, ny);
      return structuredClone(ny);
    },

    async uppdateraSparadKalkyl(id, principalId, delta: SparadKalkylDelta) {
      const k = sparadeKalkyler.get(id);
      if (!k || k.principalId !== principalId) return null;
      k.etikett = delta.etikett;
      k.input = structuredClone(delta.input);
      k.sammanfattning = structuredClone(delta.sammanfattning);
      k.regelversion = delta.regelversion;
      k.uppdaterad = nu().toISOString();
      return structuredClone(k);
    },

    async listaSparadeKalkyler(principalId) {
      return [...sparadeKalkyler.values()]
        .filter((k) => k.principalId === principalId)
        .sort((a, b) => b.skapad.localeCompare(a.skapad))
        .map((k) => structuredClone(k));
    },

    async hamtaSparadKalkyl(id, principalId) {
      const k = sparadeKalkyler.get(id);
      return k && k.principalId === principalId ? structuredClone(k) : null;
    },

    async raderaSparadKalkyl(id, principalId) {
      const k = sparadeKalkyler.get(id);
      if (!k || k.principalId !== principalId) return false;
      sparadeKalkyler.delete(id);
      return true;
    },

    async raknaSparadeKalkyler(principalId) {
      return [...sparadeKalkyler.values()].filter((k) => k.principalId === principalId).length;
    },

    async listaAnalyser(principalId: string): Promise<AnalysListrad[]> {
      return [...analyser.values()]
        .filter((a) => a.principalId === principalId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((a): AnalysListrad => {
          const rapport = a.rapportId === null ? undefined : rapporter.get(a.rapportId);
          // A legacy row (no rapport) reads its own status columns when the
          // shared job fake provides them.
          const eget = a as unknown as {
            status?: string;
            stage?: string;
            errorCode?: string | null;
          };
          const pi = a.propertyInput as unknown as { adress?: unknown; utgangspris?: unknown };
          const adress = typeof pi.adress === "string" && pi.adress !== "" ? pi.adress : null;
          return {
            analysId: a.id,
            skapad: a.createdAt,
            status: rapport?.status ?? eget.status ?? "queued",
            stage: rapport?.stage ?? eget.stage ?? "uploaded",
            errorCode: rapport ? rapport.errorCode : (eget.errorCode ?? null),
            orgnr: rapport?.orgnr ?? null,
            foreningNamn: rapport?.foreningNamn ?? null,
            rakenskapsar: rapport?.rakenskapsar ?? null,
            betyg: rapport?.status === "done" ? rapport.betyg : null,
            adress,
            utgangspris: typeof pi.utgangspris === "number" ? pi.utgangspris : null,
          };
        })
        .slice(0, 500);
    },

    async raderaAnalysFranLista(principalId, analysId) {
      const a = analyser.get(analysId);
      if (!a || a.principalId !== principalId) {
        return { borttagen: false, pdfBlevForlorad: false };
      }
      analyser.delete(analysId);
      raderadeAnalyser.push(analysId);
      return { borttagen: true, pdfBlevForlorad: false };
    },

    async hamtaAnalysAgare(analysId) {
      const a = analyser.get(analysId);
      return a ? { principalId: a.principalId } : null;
    },

    async flyttaAnalys(analysId, fran, till) {
      if (!principaler.has(till)) throw new Error("analys_principal_id_fkey: unknown principal");
      const a = analyser.get(analysId);
      if (!a || a.principalId !== fran) return false;
      a.principalId = till;
      return true;
    },

    // select svar, hamtad from annons_cache where url = $1
    async lasAnnonsCache(url) {
      const rad = annonsCache.get(url);
      return rad ? { svar: structuredClone(rad.svar), hamtad: rad.hamtad } : null;
    },

    // insert into annons_cache (url, svar, hamtad) values ($1, $2, now())
    //   on conflict (url) do update set svar = excluded.svar, hamtad = now()
    async skrivAnnonsCache(url, svar) {
      annonsCache.set(url, { svar: structuredClone(svar), hamtad: nu().toISOString() });
    },

    // select datum, procent, hamtad from referensranta where serie = $1
    async lasReferensranta(serie) {
      const rad = referensrantor.get(serie);
      return rad ? { ...rad } : null;
    },

    // insert into referensranta … on conflict (serie) do update, hamtad = now()
    async skrivReferensranta(serie, varde) {
      referensrantor.set(serie, { ...varde, hamtad: nu().toISOString() });
    },
  };
}
