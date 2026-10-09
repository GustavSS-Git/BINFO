/**
 * In-memory fake of the `Lager` port (see `../portar.ts`), for other tasks'
 * tests. Mirrors the semantics of the real SQL in
 * `supabase/migrations/20260913105304_init.sql` and
 * `supabase/migrations/20261009120000_register.sql` closely enough that a
 * test written against this fake exercises the same behavior a test against
 * a live database would: claim/lease/attempts (both queues), cache
 * on-conflict-do-nothing, the spend cap, the register's partial unique index
 * on (orgnr, rakenskapsar, pipeline_version), `rapport_fil`'s primary key and
 * the `forening`/`forening_adress` upserts.
 *
 * Every method is async and awaits nothing but its own body, so two calls
 * started with `Promise.all` interleave at every `await` in the CALLER — that
 * is what the concurrency tests in analys.test.ts rely on. Each individual
 * method is atomic, like one SQL statement.
 *
 * `skapaFakeLager()` returns a fresh instance — call it once per test so
 * tests never share state.
 */

import type {
  AnalysCacheRad,
  AnalysRad,
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
  RapportKonflikt,
  RapportFilRad,
  RapportFilter,
  RapportRad,
  SkapaRapportResultat,
} from "../portar";

const STANDARD_LEASE_SEKUNDER = 300;
const ORGNR_MONSTER = /^\d{6}-\d{4}$/;

function cacheNyckel(pdfHash: string, model: string, promptVersion: string): string {
  return `${pdfHash} ${model} ${promptVersion}`;
}

/** Rows that hold slots in the two partial unique indexes. */
function arLevande(r: Pick<RapportRad, "status">): boolean {
  return r.status !== "failed" && r.status !== "ersatt";
}

/** Mirrors `rapport_identitet_uniq` (orgnr, rakenskapsar, pipeline_version)
 *  and `rapport_fil_version_uniq` (pdf_hash, pipeline_version), both over
 *  live rows. Either way the caller links to the slot holder. */
function konflikt(
  rader: Iterable<RapportRad>,
  kandidat: Pick<
    RapportRad,
    "id" | "orgnr" | "rakenskapsar" | "pipelineVersion" | "status" | "pdfHash"
  >,
): RapportKonflikt | null {
  if (!arLevande(kandidat)) return null;
  let fil = false;
  for (const r of rader) {
    if (r.id === kandidat.id || !arLevande(r) || r.pipelineVersion !== kandidat.pipelineVersion) {
      continue;
    }
    if (
      kandidat.orgnr !== null &&
      kandidat.rakenskapsar !== null &&
      r.orgnr === kandidat.orgnr &&
      r.rakenskapsar === kandidat.rakenskapsar
    ) {
      return "identitetskonflikt";
    }
    if (kandidat.pdfHash !== null && r.pdfHash === kandidat.pdfHash) fil = true;
  }
  return fil ? "filkonflikt" : null;
}

/** Mirrors the migration's CHECK constraints on `rapport`. */
function kontrolleraRapport(r: RapportRad): void {
  if ((r.orgnr === null) !== (r.rakenskapsar === null)) {
    throw new Error("Fake: rapport_identitet_hel — orgnr och rakenskapsar sätts tillsammans.");
  }
  if (r.orgnr !== null && !ORGNR_MONSTER.test(r.orgnr)) {
    throw new Error(`Fake: ogiltigt orgnr "${r.orgnr}".`);
  }
  if (r.status === "ersatt" && r.ersattAv === null) {
    throw new Error("Fake: rapport_ersatt_har_mal — status 'ersatt' kräver ersatt_av.");
  }
}

export interface FakeDatabas extends Databas {
  /** Test-only peeks — not part of the port. */
  _allaRapporter(): RapportRad[];
  _allaRapportFiler(): RapportFilRad[];
  _allaAnalyser(): AnalysRad[];
  _allaAdresser(): Array<NyForeningAdress & { forstSedd: string; senastSedd: string }>;
  /** The LIVE `analys` table (not a copy). Shared with the konto fake
   *  (`skapaFakeKontoDatabas({ analyser: lager.db._analysTabell() })`) so a
   *  principal merge or erasure acts on the same rows the job code reads —
   *  one `analys` table, like the real database. */
  _analysTabell(): Map<string, AnalysRad>;
}

function skapaFakeDatabas(): FakeDatabas {
  // Insertion order of this Map IS the "oldest first" claim order — a JS
  // Map preserves insertion order regardless of later value updates, which
  // matches `order by created_at` without needing timestamp comparisons.
  const analysRader = new Map<string, AnalysRad>();
  const extraktionCache = new Map<string, ExtraktionCacheRad & { createdAt: string }>();
  const analysCache = new Map<string, AnalysCacheRad>();
  const spendDagar = new Map<string, { costSek: number; runs: number }>();

  const rapporter = new Map<string, RapportRad>();
  const rapportFiler = new Map<string, RapportFilRad>();
  const foreningar = new Map<string, ForeningRad>();
  const adresser = new Map<string, NyForeningAdress & { forstSedd: string; senastSedd: string }>();

  let nastaId = 1;
  let nastaRapportId = 1;

  /** created_at desc, with insertion order breaking ties (the fake creates
   *  many rows within one millisecond). */
  function nyastForst(rader: RapportRad[]): RapportRad[] {
    const ordning = [...rapporter.keys()];
    return [...rader].sort((a, b) => ordning.indexOf(b.id) - ordning.indexOf(a.id));
  }

  return {
    async skapaAnalys(rad: NyAnalysRad): Promise<{ id: string }> {
      const id = `fake-analys-${nastaId++}`;
      const nu = new Date().toISOString();
      if (rad.rapportId && !rapporter.has(rad.rapportId)) {
        throw new Error(`Fake: analys.rapport_id pekar på okänd rapport ${rad.rapportId}.`);
      }
      const fullRad: AnalysRad = {
        id,
        status: rad.status,
        stage: rad.stage,
        pdfHash: rad.pdfHash,
        pdfPath: rad.pdfPath,
        propertyInput: rad.propertyInput,
        model: rad.model,
        promptVersion: rad.promptVersion,
        grundtext: null,
        leaseUntil: null,
        attempts: 0,
        errorCode: null,
        errorMessage: null,
        costSek: 0,
        createdAt: nu,
        startedAt: null,
        finishedAt: null,
        rapportId: rad.rapportId ?? null,
        principalId: rad.principalId ?? null,
      };
      analysRader.set(id, fullRad);
      return { id };
    },

    async hamtaAnalys(id: string): Promise<AnalysRad | null> {
      return analysRader.get(id) ?? null;
    },

    async uppdateraAnalys(id: string, delta: Partial<AnalysRad>): Promise<void> {
      const befintlig = analysRader.get(id);
      if (!befintlig) return;
      analysRader.set(id, { ...befintlig, ...delta });
    },

    async klaimaNastaSteg(leaseSekunder = STANDARD_LEASE_SEKUNDER): Promise<AnalysRad | null> {
      const nu = Date.now();
      for (const rad of analysRader.values()) {
        // Register-linked rows are never claimed by the legacy queue
        // (`and rapport_id is null` in claim_next_steg since the register
        // migration).
        if (rad.rapportId !== null) continue;
        if (rad.stage === "complete") continue;
        if (rad.status !== "queued" && rad.status !== "running") continue;
        if (rad.attempts >= 3) continue;
        const leaseAktiv = rad.leaseUntil !== null && new Date(rad.leaseUntil).getTime() >= nu;
        if (leaseAktiv) continue;

        const uppdaterad: AnalysRad = {
          ...rad,
          status: "running",
          attempts: rad.attempts + 1,
          leaseUntil: new Date(nu + leaseSekunder * 1000).toISOString(),
          startedAt: rad.startedAt ?? new Date(nu).toISOString(),
        };
        analysRader.set(rad.id, uppdaterad);
        return uppdaterad;
      }
      return null;
    },

    async slappSteg(id: string, ateranvandForsok: boolean): Promise<void> {
      const befintlig = analysRader.get(id);
      if (!befintlig) return;
      analysRader.set(id, {
        ...befintlig,
        status: "queued",
        leaseUntil: null,
        attempts: ateranvandForsok ? Math.max(befintlig.attempts - 1, 0) : befintlig.attempts,
      });
    },

    async hamtaExtraktion(
      pdfHash: string,
      model: string,
      promptVersion: string,
    ): Promise<ExtraktionCacheRad | null> {
      const rad = extraktionCache.get(cacheNyckel(pdfHash, model, promptVersion));
      if (!rad) return null;
      const { createdAt: _createdAt, ...utanTid } = rad;
      return utanTid;
    },

    async sparaExtraktion(
      pdfHash: string,
      model: string,
      promptVersion: string,
      rad: ExtraktionCacheRad,
    ): Promise<void> {
      const nyckel = cacheNyckel(pdfHash, model, promptVersion);
      if (extraktionCache.has(nyckel)) return; // on conflict do nothing
      extraktionCache.set(nyckel, { ...rad, createdAt: new Date().toISOString() });
    },

    async hamtaAnalysCache(
      pdfHash: string,
      model: string,
      promptVersion: string,
    ): Promise<AnalysCacheRad | null> {
      return analysCache.get(cacheNyckel(pdfHash, model, promptVersion)) ?? null;
    },

    async sparaAnalysCache(
      pdfHash: string,
      model: string,
      promptVersion: string,
      rad: AnalysCacheRad,
    ): Promise<void> {
      const nyckel = cacheNyckel(pdfHash, model, promptVersion);
      if (analysCache.has(nyckel)) return; // on conflict do nothing
      analysCache.set(nyckel, rad);
    },

    async reserveraSpend(dag: string, uppskattatSek: number, takSek: number): Promise<boolean> {
      const befintlig = spendDagar.get(dag) ?? { costSek: 0, runs: 0 };
      if (befintlig.costSek + uppskattatSek > takSek) return false;
      spendDagar.set(dag, {
        costSek: befintlig.costSek + uppskattatSek,
        runs: befintlig.runs + 1,
      });
      return true;
    },

    async avstamSpend(dag: string, reserveratSek: number, faktisktSek: number): Promise<void> {
      const befintlig = spendDagar.get(dag) ?? { costSek: 0, runs: 0 };
      spendDagar.set(dag, {
        costSek: befintlig.costSek - reserveratSek + faktisktSek,
        runs: befintlig.runs,
      });
    },

    async hamtaSpendForDag(dag: string): Promise<number> {
      return spendDagar.get(dag)?.costSek ?? 0;
    },

    async raderaAnalys(id: string): Promise<{ pdfBlevForlorad: boolean }> {
      const rad = analysRader.get(id);
      if (!rad) return { pdfBlevForlorad: false };
      analysRader.delete(id);
      const finnsSyskon = [...analysRader.values()].some((r) => r.pdfHash === rad.pdfHash);
      // Since the register migration a PDF a rapport_fil row points at is
      // kept indefinitely, whoever uploaded it.
      const iRegistret = rapportFiler.has(rad.pdfHash);
      return { pdfBlevForlorad: !finnsSyskon && !iRegistret };
    },

    // -----------------------------------------------------------------------
    // Register
    // -----------------------------------------------------------------------

    async skapaRapport(rad: NyRapportRad): Promise<SkapaRapportResultat> {
      const id = `fake-rapport-${nastaRapportId++}`;
      const ny: RapportRad = {
        id,
        orgnr: rad.orgnr,
        rakenskapsar: rad.rakenskapsar,
        pipelineVersion: rad.pipelineVersion,
        model: rad.model,
        textlager: rad.textlager,
        status: rad.status,
        stage: rad.stage,
        pdfHash: rad.pdfHash,
        leaseUntil: rad.leaseUntil ?? null,
        attempts: 0,
        grundtext: null,
        extraction: rad.extraction ?? null,
        judgement: rad.judgement ?? null,
        errorCode: null,
        errorMessage: null,
        costSek: rad.costSek ?? 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        createdAt: new Date().toISOString(),
        startedAt: null,
        finishedAt: rad.finishedAt ?? null,
        ersattAv: null,
      };
      kontrolleraRapport(ny);
      if (ny.orgnr !== null && !foreningar.has(ny.orgnr)) {
        throw new Error(`Fake: rapport.orgnr ${ny.orgnr} saknar forening-rad (FK).`);
      }
      const krock = konflikt(rapporter.values(), ny);
      if (krock) return { ok: false, orsak: krock };
      rapporter.set(id, ny);
      return { ok: true, id };
    },

    async hamtaRapport(id: string): Promise<RapportRad | null> {
      return rapporter.get(id) ?? null;
    },

    async uppdateraRapport(id: string, delta: RapportDelta): Promise<void> {
      const befintlig = rapporter.get(id);
      if (!befintlig) return;
      const ny: RapportRad = { ...befintlig, ...delta };
      kontrolleraRapport(ny);
      const krock = konflikt(rapporter.values(), ny);
      if (krock) throw new Error(`Fake: duplicate key value violates unique constraint (${krock})`);
      rapporter.set(id, ny);
    },

    async uppdateraLeasadRapport(
      id: string,
      lease: string | null,
      delta: RapportDelta,
    ): Promise<boolean> {
      const befintlig = rapporter.get(id);
      if (!befintlig || befintlig.status !== "running" || befintlig.leaseUntil !== lease) {
        return false;
      }
      const ny: RapportRad = { ...befintlig, ...delta };
      kontrolleraRapport(ny);
      const krock = konflikt(rapporter.values(), ny);
      if (krock) throw new Error(`Fake: duplicate key value violates unique constraint (${krock})`);
      rapporter.set(id, ny);
      return true;
    },

    async sattRapportIdentitet(
      id: string,
      orgnr: string,
      rakenskapsar: number,
      lease?: string | null,
    ): Promise<boolean> {
      const befintlig = rapporter.get(id);
      if (!befintlig) return false;
      if (
        lease !== undefined &&
        (befintlig.status !== "running" || befintlig.leaseUntil !== lease)
      ) {
        return false;
      }
      if (!foreningar.has(orgnr)) {
        throw new Error(`Fake: rapport.orgnr ${orgnr} saknar forening-rad (FK).`);
      }
      const ny: RapportRad = { ...befintlig, orgnr, rakenskapsar };
      kontrolleraRapport(ny);
      const krock = konflikt(rapporter.values(), ny);
      if (krock === "identitetskonflikt") return false;
      if (krock) throw new Error(`Fake: duplicate key value violates unique constraint (${krock})`);
      rapporter.set(id, ny);
      return true;
    },

    async raderaRapport(id: string): Promise<void> {
      const refererad =
        [...rapportFiler.values()].some((f) => f.rapportId === id) ||
        [...analysRader.values()].some((a) => a.rapportId === id) ||
        [...rapporter.values()].some((r) => r.ersattAv === id);
      if (refererad) throw new Error(`Fake: rapport ${id} är refererad (FK) och kan inte raderas.`);
      rapporter.delete(id);
    },

    async listaRapporter(filter: RapportFilter): Promise<RapportRad[]> {
      const traffar = [...rapporter.values()].filter(
        (r) =>
          (filter.orgnr === undefined || r.orgnr === filter.orgnr) &&
          (filter.rakenskapsar === undefined || r.rakenskapsar === filter.rakenskapsar) &&
          (filter.pdfHash === undefined || r.pdfHash === filter.pdfHash),
      );
      const sorterade = nyastForst(traffar);
      return filter.limit === undefined ? sorterade : sorterade.slice(0, filter.limit);
    },

    async klaimaNastaRapportSteg(
      leaseSekunder = STANDARD_LEASE_SEKUNDER,
    ): Promise<RapportRad | null> {
      const nu = Date.now();
      for (const rad of rapporter.values()) {
        if (rad.stage === "klar") continue;
        if (rad.status !== "queued" && rad.status !== "running") continue;
        if (rad.attempts >= 3) continue;
        const leaseAktiv = rad.leaseUntil !== null && new Date(rad.leaseUntil).getTime() >= nu;
        if (leaseAktiv) continue;

        const uppdaterad: RapportRad = {
          ...rad,
          status: "running",
          attempts: rad.attempts + 1,
          leaseUntil: new Date(nu + leaseSekunder * 1000).toISOString(),
          startedAt: rad.startedAt ?? new Date(nu).toISOString(),
        };
        rapporter.set(rad.id, uppdaterad);
        return uppdaterad;
      }
      return null;
    },

    async slappRapportSteg(id: string, ateranvandForsok: boolean): Promise<void> {
      const befintlig = rapporter.get(id);
      // Like slapp_rapport_steg: only a row still in the queue is released —
      // never resurrects a done/failed/ersatt one.
      if (!befintlig || (befintlig.status !== "queued" && befintlig.status !== "running")) return;
      rapporter.set(id, {
        ...befintlig,
        status: "queued",
        leaseUntil: null,
        attempts: ateranvandForsok ? Math.max(befintlig.attempts - 1, 0) : befintlig.attempts,
      });
    },

    async hamtaRapportFil(pdfHash: string): Promise<RapportFilRad | null> {
      return rapportFiler.get(pdfHash) ?? null;
    },

    async skapaRapportFil(rad: NyRapportFilRad): Promise<RapportFilRad> {
      const befintlig = rapportFiler.get(rad.pdfHash);
      if (befintlig) return befintlig; // on conflict do nothing, return the winner
      if (!rapporter.has(rad.rapportId)) {
        throw new Error(`Fake: rapport_fil.rapport_id pekar på okänd rapport ${rad.rapportId}.`);
      }
      const ny: RapportFilRad = { ...rad, uppladdad: new Date().toISOString() };
      rapportFiler.set(rad.pdfHash, ny);
      return ny;
    },

    async bytRapportForFil(
      pdfHash: string,
      franRapportId: string,
      tillRapportId: string,
    ): Promise<boolean> {
      const befintlig = rapportFiler.get(pdfHash);
      if (!befintlig || befintlig.rapportId !== franRapportId) return false;
      rapportFiler.set(pdfHash, { ...befintlig, rapportId: tillRapportId });
      return true;
    },

    async flyttaRapportFiler(franRapportId: string, tillRapportId: string): Promise<void> {
      for (const [hash, fil] of rapportFiler) {
        if (fil.rapportId === franRapportId) {
          rapportFiler.set(hash, { ...fil, rapportId: tillRapportId });
        }
      }
    },

    async listaRapportFiler(rapportId: string): Promise<RapportFilRad[]> {
      return [...rapportFiler.values()].filter((f) => f.rapportId === rapportId);
    },

    async lankaOmAnalyser(franRapportId: string, tillRapportId: string): Promise<void> {
      for (const [id, rad] of analysRader) {
        if (rad.rapportId === franRapportId) {
          analysRader.set(id, { ...rad, rapportId: tillRapportId });
        }
      }
    },

    async hamtaAnalyserForRapport(rapportId: string, limit: number): Promise<AnalysRad[]> {
      return [...analysRader.values()].filter((a) => a.rapportId === rapportId).slice(0, limit);
    },

    async hamtaPdfSokvagForHash(pdfHash: string): Promise<string | null> {
      for (const rad of analysRader.values()) {
        if (rad.pdfHash === pdfHash && rad.pdfPath !== null) return rad.pdfPath;
      }
      return null;
    },

    async registreraForening(orgnr: string, namn: string | null): Promise<void> {
      if (!ORGNR_MONSTER.test(orgnr)) throw new Error(`Fake: ogiltigt orgnr "${orgnr}".`);
      const nu = new Date().toISOString();
      const befintlig = foreningar.get(orgnr);
      if (!befintlig) {
        foreningar.set(orgnr, { orgnr, namn, forstSedd: nu, senastSedd: nu });
        return;
      }
      foreningar.set(orgnr, { ...befintlig, namn: namn ?? befintlig.namn, senastSedd: nu });
    },

    async hamtaForening(orgnr: string): Promise<ForeningRad | null> {
      return foreningar.get(orgnr) ?? null;
    },

    async registreraForeningAdress(rad: NyForeningAdress): Promise<void> {
      if (!foreningar.has(rad.orgnr)) {
        throw new Error(`Fake: forening_adress.orgnr ${rad.orgnr} saknar forening-rad (FK).`);
      }
      if (rad.kalla === "anvandare" && rad.adress !== null) {
        throw new Error(
          "Fake: forening_adress_anvandare_utan_gata — ingen gatuadress från köpare.",
        );
      }
      // unique NULLS NOT DISTINCT (orgnr, postnummer, adress, kalla)
      const nyckel = JSON.stringify([rad.orgnr, rad.postnummer, rad.adress, rad.kalla]);
      const nu = new Date().toISOString();
      const befintlig = adresser.get(nyckel);
      if (!befintlig) {
        adresser.set(nyckel, { ...rad, forstSedd: nu, senastSedd: nu });
        return;
      }
      adresser.set(nyckel, {
        ...befintlig,
        kommunKod: rad.kommunKod ?? befintlig.kommunKod,
        omrade: rad.omrade ?? befintlig.omrade,
        senastSedd: nu,
      });
    },

    async listaExtraktionCache(promptVersion: string): Promise<ExtraktionCacheListRad[]> {
      const rader: ExtraktionCacheListRad[] = [];
      for (const [nyckel, rad] of extraktionCache) {
        const [pdfHash, model, version] = nyckel.split(" ");
        if (version !== promptVersion || pdfHash === undefined || model === undefined) continue;
        rader.push({ ...rad, pdfHash, model, promptVersion: version });
      }
      return rader;
    },

    _allaRapporter: () => [...rapporter.values()],
    _allaRapportFiler: () => [...rapportFiler.values()],
    _allaAnalyser: () => [...analysRader.values()],
    _allaAdresser: () => [...adresser.values()],
    _analysTabell: () => analysRader,
  };
}

function skapaFakeFilarkiv(): Filarkiv {
  const filer = new Map<string, Uint8Array>();
  return {
    async laggUpp(sokvag: string, bytes: Uint8Array): Promise<void> {
      if (filer.has(sokvag)) return; // tolerate "already exists"
      filer.set(sokvag, bytes);
    },
    async hamta(sokvag: string): Promise<Uint8Array> {
      const data = filer.get(sokvag);
      if (!data) throw new Error(`Fake Filarkiv: hittar inte "${sokvag}"`);
      return data;
    },
    async ta_bort(sokvag: string): Promise<void> {
      filer.delete(sokvag);
    },
    async finns(sokvag: string): Promise<boolean> {
      return filer.has(sokvag);
    },
  };
}

export interface FakeLager extends Lager {
  db: FakeDatabas;
}

export function skapaFakeLager(): FakeLager {
  return {
    db: skapaFakeDatabas(),
    filer: skapaFakeFilarkiv(),
  };
}
