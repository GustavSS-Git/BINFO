/**
 * In-memory fake of the `KontoDatabas` port (see `../kontoPortar.ts`).
 * Mirrors the SQL in `supabase/migrations/20261009120100_konto.sql`:
 * `sakerstall_principal`, `sla_samman_principal`, `ta_kvot` /
 * `aterlamna_kvot` (UTC-aligned fixed windows), `radera_principal`, and the
 * export query.
 *
 * Holds its own minimal `analys`/`behorighet` tables (only the columns this
 * layer touches) so merge/delete/export can be tested without the job fake.
 *
 * `skapaFakeKontoDatabas()` returns a fresh instance — one per test. Pass
 * `nu` to control the clock (window rollover tests).
 */

import type { PropertyInput } from "@/types/analysis";
import type {
  KontoDatabas,
  PrincipalExport,
  PrincipalRad,
  RaderingsResultat,
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

export interface FakeKontoDatabas extends KontoDatabas {
  readonly principaler: Map<string, PrincipalRad>;
  readonly analyser: Map<string, FakeAnalysRad>;
  readonly behorigheter: Map<string, FakeBehorighetRad>;
  /** Keyed `${nyckel}|${fonsterStart}`. */
  readonly kvot: Map<string, FakeKvotRad>;
  laggTillAnalys(rad: Omit<FakeAnalysRad, "createdAt"> & { createdAt?: string }): void;
  laggTillBehorighet(rad: Omit<FakeBehorighetRad, "id">): string;
}

/** Same arithmetic as `kvot_fonster_start`: floor(epoch / window) * window. */
export function fonsterStart(nu: Date, fonsterSek: number): string {
  const sek = Math.floor(nu.getTime() / 1000 / fonsterSek) * fonsterSek;
  return new Date(sek * 1000).toISOString();
}

export function skapaFakeKontoDatabas(opts: { nu?: () => Date } = {}): FakeKontoDatabas {
  const nu = opts.nu ?? (() => new Date());
  const principaler = new Map<string, PrincipalRad>();
  const analyser = new Map<string, FakeAnalysRad>();
  const behorigheter = new Map<string, FakeBehorighetRad>();
  const kvot = new Map<string, FakeKvotRad>();
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

  /** `where id = p_id or sammanslagen_till = p_id`. */
  function medSammanslagna(id: string): PrincipalRad[] {
    return [...principaler.values()].filter((p) => p.id === id || p.sammanslagenTill === id);
  }

  return {
    principaler,
    analyser,
    behorigheter,
    kvot,

    laggTillAnalys(rad) {
      analyser.set(rad.id, { ...rad, createdAt: rad.createdAt ?? nu().toISOString() });
    },

    laggTillBehorighet(rad) {
      const id = `fake-behorighet-${nastaId++}`;
      behorigheter.set(id, { ...rad, id });
      return id;
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
      if (fran === till) {
        throw new Error("sla_samman_principal: two different principal ids are required");
      }
      if (!principaler.has(fran))
        throw new Error(`sla_samman_principal: unknown principal ${fran}`);
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
      };
    },
  };
}
