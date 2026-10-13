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
  ForeningAdressRad,
  OmradeKalla,
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
  RegisterLasning,
  RegisterSammanfattningVy,
  Sidtext,
  SidtextKalla,
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

/** Mirrors the table `register_sammanfattning` (the nyckeltal as columns). */
export interface RegisterSammanfattningRad {
  orgnr: string;
  slug: string | null;
  namn: string | null;
  registeromrade: string | null;
  rakenskapsar: number;
  rapportId: string;
  pipelineVersion: string;
  nyckeltal: Record<string, number | null>;
  betyg: string | null;
  analysdatum: string;
}

const SAMMANFATTADE_NYCKELTAL = [
  "arsavgift_per_m2_brf_yta",
  "arsavgift_andel_av_rorelseintakter",
  "skuldsattning_per_m2_totalyta",
  "skuldsattning_per_m2_brf_yta",
  "sparande_per_m2_totalyta",
  "rantekanslighet",
  "energikostnad_per_m2_totalyta",
] as const;

/** Mirrors `register_nyckeltal`: the figure's value, null when missing/null. */
function nyckeltalVarde(extraction: unknown, id: string): number | null {
  const lista = (extraction as { forening?: { keyFigures?: unknown } } | null)?.forening
    ?.keyFigures;
  if (!Array.isArray(lista)) return null;
  const kf = lista.find((k) => (k as { id?: unknown })?.id === id) as
    { figure?: { value?: unknown } } | undefined;
  const v = kf?.figure?.value;
  return typeof v === "number" ? v : null;
}

export interface FakeDatabas extends Databas {
  /** Test-only peeks — not part of the port. */
  _allaRapporter(): RapportRad[];
  _allaRapportFiler(): RapportFilRad[];
  _allaAnalyser(): AnalysRad[];
  _allaAdresser(): Array<NyForeningAdress & { forstSedd: string; senastSedd: string }>;
  /** `forening.slug / registeromrade / omrade_kalla` of one BRF. */
  _foreningOmrade(orgnr: string): {
    slug: string | null;
    registeromrade: string | null;
    omradeKalla: OmradeKalla | null;
  } | null;
  /** `forening_slug`: old slug -> orgnr. */
  _slugHistorik(): Array<{ slug: string; orgnr: string }>;
  /** `register_sammanfattning`, one row per BRF. */
  _registerSammanfattning(): RegisterSammanfattningRad[];
  /** Every sidtext row of one rapport, with its kalla. */
  _allaSidtext(rapportId: string): Array<Sidtext & { kalla: SidtextKalla }>;
  /** The LIVE `analys` table (not a copy). Shared with the konto fake
   *  (`skapaFakeKontoDatabas({ analyser: lager.db._analysTabell() })`) so a
   *  principal merge or erasure acts on the same rows the job code reads —
   *  one `analys` table, like the real database. */
  _analysTabell(): Map<string, AnalysRad>;
  /** The public register's read port over this fake's tables (for
   *  registerPublik tests). */
  _registerLasning(): RegisterLasning;
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
  const foreningOmrade = new Map<
    string,
    { slug: string | null; registeromrade: string | null; omradeKalla: OmradeKalla | null }
  >();
  const slugHistorik: Array<{ slug: string; orgnr: string }> = [];
  const sammanfattningar = new Map<string, RegisterSammanfattningRad>();
  const adresser = new Map<string, NyForeningAdress & { forstSedd: string; senastSedd: string }>();
  /** rapport_id -> sida -> row (pk (rapport_id, sida)). */
  const sidtext = new Map<string, Map<number, { text: string; kalla: SidtextKalla }>>();

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
        proveniens: rad.proveniens ?? "api",
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
      sidtext.delete(id); // on delete cascade
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

    async hamtaForeningAdresser(orgnr: string): Promise<ForeningAdressRad[]> {
      return [...adresser.values()]
        .filter((a) => a.orgnr === orgnr)
        .map((a) => ({
          orgnr: a.orgnr,
          postnummer: a.postnummer,
          adress: a.adress,
          kalla: a.kalla,
        }));
    },

    async sattForeningOmrade(orgnr, falt): Promise<void> {
      if (!foreningar.has(orgnr)) throw new Error(`Fake: okänd forening ${orgnr}.`);
      const nu = foreningOmrade.get(orgnr) ?? {
        slug: null,
        registeromrade: null,
        omradeKalla: null,
      };
      if (nu.slug !== null && falt.slug !== null && nu.slug !== falt.slug) {
        if (!slugHistorik.some((h) => h.slug === nu.slug)) {
          slugHistorik.push({ slug: nu.slug, orgnr });
        }
      }
      if (falt.slug !== null) {
        for (const [o, f] of foreningOmrade) {
          if (o !== orgnr && f.slug === falt.slug) {
            throw new Error("Fake: forening_slug_uniq — sluggen används av en annan förening.");
          }
        }
      }
      foreningOmrade.set(orgnr, {
        slug: falt.slug ?? nu.slug,
        registeromrade: falt.registeromrade ?? nu.registeromrade,
        omradeKalla: falt.registeromrade !== null ? falt.omradeKalla : nu.omradeKalla,
      });
    },

    async uppdateraRegisterSammanfattning(orgnr: string, pipelineVersion: string): Promise<void> {
      // Mirrors uppdatera_register_sammanfattning: latest räkenskapsår, then the
      // given pipeline version, then the most recently finished.
      const kandidater = [...rapporter.values()]
        .filter(
          (r) =>
            r.orgnr === orgnr &&
            r.status === "done" &&
            r.extraction !== null &&
            r.judgement !== null,
        )
        .sort(
          (a, b) =>
            b.rakenskapsar! - a.rakenskapsar! ||
            Number(b.pipelineVersion === pipelineVersion) -
              Number(a.pipelineVersion === pipelineVersion) ||
            (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""),
        );
      const r = kandidater[0];
      if (!r) {
        sammanfattningar.delete(orgnr);
        return;
      }
      const f = foreningar.get(orgnr);
      const o = foreningOmrade.get(orgnr);
      const betyg = (r.judgement as { betyg?: unknown } | null)?.betyg;
      sammanfattningar.set(orgnr, {
        orgnr,
        slug: o?.slug ?? null,
        namn: f?.namn ?? null,
        registeromrade: o?.registeromrade ?? null,
        rakenskapsar: r.rakenskapsar!,
        rapportId: r.id,
        pipelineVersion: r.pipelineVersion,
        nyckeltal: Object.fromEntries(
          SAMMANFATTADE_NYCKELTAL.map((id) => [id, nyckeltalVarde(r.extraction, id)]),
        ),
        betyg: typeof betyg === "string" && "ABCDE".includes(betyg) ? betyg : null,
        analysdatum: r.finishedAt ?? r.createdAt,
      });
    },

    async hamtaSidtext(rapportId: string, kalla?: SidtextKalla): Promise<Sidtext[]> {
      const rader = sidtext.get(rapportId);
      if (!rader) return [];
      return [...rader.entries()]
        .filter(([, rad]) => kalla === undefined || rad.kalla === kalla)
        .map(([sida, rad]) => ({ sida, text: rad.text }))
        .sort((a, b) => a.sida - b.sida);
    },

    async sparaSidtext(
      rapportId: string,
      sidor: readonly Sidtext[],
      kalla: SidtextKalla,
    ): Promise<void> {
      if (!rapporter.has(rapportId)) {
        throw new Error(`Fake: sidtext.rapport_id pekar på okänd rapport ${rapportId} (FK).`);
      }
      // Validate the whole batch first: one statement, all or nothing.
      for (const s of sidor) {
        if (!Number.isInteger(s.sida) || s.sida < 1) {
          throw new Error(`Fake: sidtext_sida_check — sida måste vara >= 1, fick ${s.sida}.`);
        }
      }
      const rader =
        sidtext.get(rapportId) ?? new Map<number, { text: string; kalla: SidtextKalla }>();
      for (const s of sidor) rader.set(s.sida, { text: s.text, kalla });
      sidtext.set(rapportId, rader);
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
    _allaSidtext: (rapportId) =>
      [...(sidtext.get(rapportId) ?? [])]
        .map(([sida, rad]) => ({ sida, text: rad.text, kalla: rad.kalla }))
        .sort((a, b) => a.sida - b.sida),
    _foreningOmrade: (orgnr) => foreningOmrade.get(orgnr) ?? null,
    _slugHistorik: () => [...slugHistorik],
    _registerSammanfattning: () => [...sammanfattningar.values()],
    _analysTabell: () => analysRader,
    _registerLasning: () =>
      skapaFakeRegisterLasning(
        sammanfattningar,
        foreningar,
        foreningOmrade,
        slugHistorik,
        rapporter,
      ),
  };
}

/** Fake of the register's read port, mirroring src/server/supabase.ts's
 *  `skapaRegisterLasningFranKlient` (name/orgnr search, sort, nulls last). */
function skapaFakeRegisterLasning(
  sammanfattningar: Map<string, RegisterSammanfattningRad>,
  foreningar: Map<string, ForeningRad>,
  foreningOmrade: Map<
    string,
    { slug: string | null; registeromrade: string | null; omradeKalla: OmradeKalla | null }
  >,
  slugHistorik: Array<{ slug: string; orgnr: string }>,
  rapporter: Map<string, RapportRad>,
): RegisterLasning {
  const foreningRad = (orgnr: string) => {
    const f = foreningar.get(orgnr);
    if (!f) return null;
    const o = foreningOmrade.get(orgnr);
    return {
      orgnr,
      namn: f.namn,
      slug: o?.slug ?? null,
      registeromrade: o?.registeromrade ?? null,
    };
  };
  return {
    async listaOmradeRader(omraden) {
      return [...sammanfattningar.values()]
        .filter((r) => r.registeromrade !== null && omraden.includes(r.registeromrade))
        .map((r) => ({
          slug: r.slug,
          registeromrade: r.registeromrade!,
          analysdatum: r.analysdatum,
        }));
    },
    async listaSammanfattningar(p) {
      const sok = p.sok.trim().toLowerCase();
      const siffror = sok.replace(/\D/g, "");
      const kandidater: RegisterSammanfattningVy[] = [];
      for (const r of sammanfattningar.values()) {
        if (r.slug === null || r.namn === null || r.registeromrade === null) continue;
        if (!p.omraden.includes(r.registeromrade)) continue;
        if (sok !== "") {
          const namnTraff = r.namn.toLowerCase().includes(sok);
          const orgnrTraff =
            /^[\d\s-]+$/.test(sok) &&
            siffror.length >= 4 &&
            r.orgnr.replace("-", "").includes(siffror);
          if (!namnTraff && !orgnrTraff) continue;
        }
        const nt = r.nyckeltal;
        kandidater.push({
          orgnr: r.orgnr,
          slug: r.slug,
          namn: r.namn,
          registeromrade: r.registeromrade,
          rakenskapsar: r.rakenskapsar,
          betyg: (r.betyg as RegisterSammanfattningVy["betyg"]) ?? null,
          skuldsattningPerM2BrfYta: nt["skuldsattning_per_m2_brf_yta"] ?? null,
          arsavgiftPerM2BrfYta: nt["arsavgift_per_m2_brf_yta"] ?? null,
          sparandePerM2Totalyta: nt["sparande_per_m2_totalyta"] ?? null,
          analysdatum: r.analysdatum,
        });
      }
      const varde = (r: RegisterSammanfattningVy): string | number | null => {
        switch (p.sortering) {
          case "skuldsattning_per_m2_brf_yta":
            return r.skuldsattningPerM2BrfYta;
          case "arsavgift_per_m2_brf_yta":
            return r.arsavgiftPerM2BrfYta;
          case "sparande_per_m2_totalyta":
            return r.sparandePerM2Totalyta;
          case "betyg":
            return r.betyg;
          case "analysdatum":
            return r.analysdatum;
        }
      };
      kandidater.sort((a, b) => {
        const x = varde(a);
        const y = varde(b);
        if (x === null && y !== null) return 1; // nulls last in both directions
        if (y === null && x !== null) return -1;
        if (x !== null && y !== null && x !== y) {
          const c = x < y ? -1 : 1;
          return p.stigande ? c : -c;
        }
        return a.orgnr.localeCompare(b.orgnr);
      });
      return { rader: kandidater.slice(p.fran, p.fran + p.antal), totalt: kandidater.length };
    },
    async hamtaForeningViaSlug(slug) {
      for (const [orgnr, o] of foreningOmrade) if (o.slug === slug) return foreningRad(orgnr);
      return null;
    },
    async hamtaOrgnrViaGammalSlug(slug) {
      return slugHistorik.find((h) => h.slug === slug)?.orgnr ?? null;
    },
    async hamtaForeningViaOrgnr(orgnr) {
      return foreningRad(orgnr);
    },
    async listaKlaraRapporter(orgnr) {
      return [...rapporter.values()]
        .filter(
          (r) =>
            r.orgnr === orgnr &&
            r.status === "done" &&
            r.extraction !== null &&
            r.judgement !== null,
        )
        .sort(
          (a, b) =>
            b.rakenskapsar! - a.rakenskapsar! ||
            (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""),
        )
        .map((r) => ({
          id: r.id,
          rakenskapsar: r.rakenskapsar!,
          pipelineVersion: r.pipelineVersion,
          extraction: r.extraction,
          judgement: r.judgement,
          analysdatum: r.finishedAt ?? r.createdAt,
        }));
    },
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
