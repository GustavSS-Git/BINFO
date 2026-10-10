import { describe, expect, it } from "vitest";
import type { ExtractionResult, KeyFigure, KeyFigureId, PropertyInput } from "@/types/analysis";
import type { AnalysJudgement } from "@/lib/analysis/analyze";
import type { NyAnalysRad, NyRapportRad } from "../portar";
import { skapaFakeLager } from "./lager";
import { skapaFakeKontoDatabas } from "./konto";

/**
 * Smoke tests for the in-memory fake, not for real Supabase. Every other
 * task's tests depend on this fake behaving like the real SQL in
 * `supabase/migrations/20260913105304_init.sql`, so these exercise exactly
 * the semantics called out in that migration: claim/lease, on-conflict-do-
 * nothing caches, the spend cap, and deletion's "was this the last
 * reference" report.
 */

const ALLA_NYCKELTAL_ID: KeyFigureId[] = [
  "arsavgift_per_m2_brf_yta",
  "arsavgift_andel_av_rorelseintakter",
  "skuldsattning_per_m2_totalyta",
  "skuldsattning_per_m2_brf_yta",
  "sparande_per_m2_totalyta",
  "rantekanslighet",
  "energikostnad_per_m2_totalyta",
];

function nyckeltal(): KeyFigure[] {
  return ALLA_NYCKELTAL_ID.map((id) => ({
    id,
    label: id,
    figure: { value: null, unit: "kr/m2", source: "berakning" },
    status: "okant",
    forklaring: "Testförklaring.",
  }));
}

function extraction(): ExtractionResult {
  return {
    schemaVersion: "1.0.0",
    forening: {
      namn: "Brf Testgården",
      orgnr: "769612-3456",
      akta: "ja",
      rakenskapsar: 2025,
      keyFigures: nyckeltal(),
    },
    datakvalitet: {
      pdfSaknarTextlager: false,
      extraktionKonfidens: { niva: "hog" },
      saknadeFalt: [],
    },
  };
}

function judgement(): AnalysJudgement {
  return {
    betyg: "B",
    betygMotivering: "Testmotivering.",
    rodaFlaggor: [],
    fragor: [],
  };
}

function propertyInput(): PropertyInput {
  return {
    kind: "bostadsratt",
    utgangspris: 3_000_000,
    boarea: 55,
    antalRum: 2,
    manadsavgift: 3_500,
    andelstal: 1.2,
    orgnr: "769612-3456",
    adress: "Testgatan 1",
    postnummer: "12345",
    ort: "Stockholm",
    hiss: "okant",
    balkong: "okant",
    avgiftInkluderar: {
      varme: "okant",
      vatten: "okant",
      el: "okant",
      bredband: "okant",
      tv: "okant",
    },
    antalPersoner: 2,
  };
}

function nyAnalysRad(overrides: Partial<NyAnalysRad> = {}): NyAnalysRad {
  return {
    pdfHash: "hash-1",
    pdfPath: "arsredovisningar/hash-1.pdf",
    propertyInput: propertyInput(),
    model: "claude-sonnet-5",
    promptVersion: "v1",
    status: "queued",
    stage: "uploaded",
    ...overrides,
  };
}

describe("skapaFakeLager — analys-kö (claim/lease)", () => {
  it("en klaimad rad kan inte klaimas igen förrän leasen gått ut", async () => {
    const lager = skapaFakeLager();
    const { id } = await lager.db.skapaAnalys(nyAnalysRad());

    const forsta = await lager.db.klaimaNastaSteg(300);
    expect(forsta).not.toBeNull();
    expect(forsta?.id).toBe(id);
    expect(forsta?.status).toBe("running");
    expect(forsta?.attempts).toBe(1);

    const andra = await lager.db.klaimaNastaSteg(300);
    expect(andra).toBeNull();
  });

  it("slappSteg gör raden klaimbar igen, och kan återanvända försöket", async () => {
    const lager = skapaFakeLager();
    const { id } = await lager.db.skapaAnalys(nyAnalysRad());
    await lager.db.klaimaNastaSteg();

    await lager.db.slappSteg(id, true);
    const rad = await lager.db.hamtaAnalys(id);
    expect(rad?.status).toBe("queued");
    expect(rad?.leaseUntil).toBeNull();
    expect(rad?.attempts).toBe(0); // återanvänt

    const nyKlaim = await lager.db.klaimaNastaSteg();
    expect(nyKlaim?.id).toBe(id);
    expect(nyKlaim?.attempts).toBe(1);
  });

  it("en rad med 3 misslyckade försök är inte längre klaimbar", async () => {
    const lager = skapaFakeLager();
    const { id } = await lager.db.skapaAnalys(nyAnalysRad());
    for (let i = 0; i < 3; i++) {
      await lager.db.klaimaNastaSteg();
      await lager.db.slappSteg(id, false);
    }
    const rad = await lager.db.klaimaNastaSteg();
    expect(rad).toBeNull();
  });
});

describe("skapaFakeLager — cache (on conflict do nothing)", () => {
  it("extraktion: skriv-läs går runt, och en andra skrivning skriver inte över", async () => {
    const lager = skapaFakeLager();
    const forsta = {
      extraction: extraction(),
      schemaVersion: "1.0.0",
      costSek: 12,
      orgnr: "769612-3456",
      rakenskapsar: 2025,
    };
    await lager.db.sparaExtraktion("hash-1", "claude-sonnet-5", "v1", forsta);

    const lasVarde = await lager.db.hamtaExtraktion("hash-1", "claude-sonnet-5", "v1");
    expect(lasVarde).toEqual(forsta);

    const andra = { ...forsta, costSek: 999 };
    await lager.db.sparaExtraktion("hash-1", "claude-sonnet-5", "v1", andra);
    const efterAndraSkrivningen = await lager.db.hamtaExtraktion("hash-1", "claude-sonnet-5", "v1");
    expect(efterAndraSkrivningen?.costSek).toBe(12); // inte 999 — den första vinner
  });

  it("analys-cache: samma on-conflict-do-nothing-semantik", async () => {
    const lager = skapaFakeLager();
    const forsta = { judgement: judgement(), costSek: 5 };
    await lager.db.sparaAnalysCache("hash-1", "claude-sonnet-5", "v1", forsta);

    const andra = { judgement: judgement(), costSek: 500 };
    await lager.db.sparaAnalysCache("hash-1", "claude-sonnet-5", "v1", andra);

    const lasVarde = await lager.db.hamtaAnalysCache("hash-1", "claude-sonnet-5", "v1");
    expect(lasVarde?.costSek).toBe(5);
  });
});

describe("skapaFakeLager — spend guard", () => {
  it("accepterar reservationer under taket och nekar när taket skulle överskridas", async () => {
    const lager = skapaFakeLager();
    const forsta = await lager.db.reserveraSpend("2026-09-13", 60, 100);
    expect(forsta).toBe(true);

    const andra = await lager.db.reserveraSpend("2026-09-13", 60, 100); // 60+60 > 100
    expect(andra).toBe(false);

    const tredje = await lager.db.reserveraSpend("2026-09-13", 40, 100); // 60+40 = 100, ok
    expect(tredje).toBe(true);
  });

  it("avstamSpend justerar dagens kostnad från uppskattat till faktiskt", async () => {
    const lager = skapaFakeLager();
    await lager.db.reserveraSpend("2026-09-13", 60, 1000);
    await lager.db.avstamSpend("2026-09-13", 60, 45);
    // Efter nedjustering finns utrymme för en reservation som annars inte
    // skulle rymmas om de 60 kr fortfarande stod kvar.
    const rymmer = await lager.db.reserveraSpend("2026-09-13", 950, 1000);
    expect(rymmer).toBe(true);
  });
});

describe("skapaFakeLager — raderaAnalys", () => {
  it("rapporterar pdfBlevForlorad: true när det var sista raden för hashen", async () => {
    const lager = skapaFakeLager();
    const { id } = await lager.db.skapaAnalys(nyAnalysRad({ pdfHash: "unik-hash" }));
    const resultat = await lager.db.raderaAnalys(id);
    expect(resultat.pdfBlevForlorad).toBe(true);
  });

  it("rapporterar pdfBlevForlorad: false när en syskonrad delar samma hash", async () => {
    const lager = skapaFakeLager();
    const { id: forsta } = await lager.db.skapaAnalys(nyAnalysRad({ pdfHash: "delad-hash" }));
    await lager.db.skapaAnalys(nyAnalysRad({ pdfHash: "delad-hash" }));

    const resultat = await lager.db.raderaAnalys(forsta);
    expect(resultat.pdfBlevForlorad).toBe(false);
  });
});

describe("skapaFakeLager — filarkiv", () => {
  it("tolererar en andra uppladdning av samma sökväg utan att kasta", async () => {
    const lager = skapaFakeLager();
    await lager.filer.laggUpp("hash-1.pdf", new Uint8Array([1, 2, 3]));
    await expect(
      lager.filer.laggUpp("hash-1.pdf", new Uint8Array([9, 9, 9])),
    ).resolves.toBeUndefined();

    const bytes = await lager.filer.hamta("hash-1.pdf");
    expect(Array.from(bytes)).toEqual([1, 2, 3]); // första skrivningen behålls
  });
});

// ---------------------------------------------------------------------------
// Register (supabase/migrations/20261009120000_register.sql)
// ---------------------------------------------------------------------------

let nastaRapportHash = 1;

/** A unique pdf_hash per call by default — two live rapporter of one version
 *  may not share bytes (rapport_fil_version_uniq). */
function nyRapport(over: Partial<NyRapportRad> = {}): NyRapportRad {
  return {
    orgnr: "769612-3456",
    rakenskapsar: 2025,
    pipelineVersion: "p5.i1.s1",
    model: "claude-sonnet-5",
    textlager: "ok",
    status: "queued",
    stage: "grundning",
    pdfHash: `hash-${nastaRapportHash++}`,
    ...over,
  };
}

describe("skapaFakeLager — register: identitetsindexet", () => {
  it("nekar en andra aktiv rapport med samma (orgnr, år, version), men inte en annan version", async () => {
    const { db } = skapaFakeLager();
    await db.registreraForening("769612-3456", "Brf Testgården");
    const forsta = await db.skapaRapport(nyRapport());
    expect(forsta.ok).toBe(true);
    expect(await db.skapaRapport(nyRapport({ pdfHash: "hash-b" }))).toEqual({
      ok: false,
      orsak: "identitetskonflikt",
    });
    expect((await db.skapaRapport(nyRapport({ pipelineVersion: "p6.i1.s1" }))).ok).toBe(true);
  });

  it("en misslyckad eller ersatt rapport frigör platsen; rader utan identitet krockar aldrig", async () => {
    const { db } = skapaFakeLager();
    await db.registreraForening("769612-3456", null);
    const forsta = await db.skapaRapport(nyRapport());
    if (!forsta.ok) throw new Error("unreachable");
    await db.uppdateraRapport(forsta.id, { status: "failed", errorCode: "ogiltigforklarad" });
    expect((await db.skapaRapport(nyRapport())).ok).toBe(true);

    const utan1 = await db.skapaRapport(nyRapport({ orgnr: null, rakenskapsar: null }));
    const utan2 = await db.skapaRapport(nyRapport({ orgnr: null, rakenskapsar: null }));
    expect(utan1.ok && utan2.ok).toBe(true);
  });

  it("sattRapportIdentitet returnerar false vid krock och kräver en forening-rad (FK)", async () => {
    const { db } = skapaFakeLager();
    const utan = await db.skapaRapport(nyRapport({ orgnr: null, rakenskapsar: null }));
    if (!utan.ok) throw new Error("unreachable");
    await expect(db.sattRapportIdentitet(utan.id, "769612-3456", 2025)).rejects.toThrow(/FK/);

    await db.registreraForening("769612-3456", null);
    await db.skapaRapport(nyRapport());
    expect(await db.sattRapportIdentitet(utan.id, "769612-3456", 2025)).toBe(false);
    expect(await db.sattRapportIdentitet(utan.id, "769612-3456", 2024)).toBe(true);
  });

  it("speglar CHECK-villkoren: identitet hel eller ingen, ersatt kräver ersatt_av", async () => {
    const { db } = skapaFakeLager();
    await db.registreraForening("769612-3456", null);
    await expect(db.skapaRapport(nyRapport({ rakenskapsar: null }))).rejects.toThrow();
    const r = await db.skapaRapport(nyRapport());
    if (!r.ok) throw new Error("unreachable");
    await expect(db.uppdateraRapport(r.id, { status: "ersatt" })).rejects.toThrow();
  });
});

describe("skapaFakeLager — register: kön", () => {
  it("klaimar äldst först, respekterar lease och attempts, och hoppar över klar/ersatt", async () => {
    const { db } = skapaFakeLager();
    const a = await db.skapaRapport(nyRapport({ orgnr: null, rakenskapsar: null }));
    const b = await db.skapaRapport(
      nyRapport({
        orgnr: null,
        rakenskapsar: null,
        leaseUntil: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    const c = await db.skapaRapport(nyRapport({ orgnr: null, rakenskapsar: null }));
    if (!a.ok || !b.ok || !c.ok) throw new Error("unreachable");
    await db.uppdateraRapport(a.id, { status: "done", stage: "klar" });

    const klaimad = await db.klaimaNastaRapportSteg();
    expect(klaimad?.id).toBe(c.id); // a är klar, b har en aktiv setup-lease
    expect(klaimad?.attempts).toBe(1);
    expect(await db.klaimaNastaRapportSteg()).toBeNull();

    await db.slappRapportSteg(c.id, true);
    expect((await db.hamtaRapport(c.id))?.attempts).toBe(0);
    expect((await db.klaimaNastaRapportSteg())?.id).toBe(c.id);
  });

  it("slappRapportSteg återupplivar aldrig en klar/ersatt rad", async () => {
    const { db } = skapaFakeLager();
    const r = await db.skapaRapport(nyRapport({ orgnr: null, rakenskapsar: null }));
    if (!r.ok) throw new Error("unreachable");
    await db.uppdateraRapport(r.id, { status: "done", stage: "klar" });
    await db.slappRapportSteg(r.id, false);
    expect((await db.hamtaRapport(r.id))?.status).toBe("done");
  });

  it("den gamla kön klaimar aldrig en registerlänkad analys-rad", async () => {
    const { db } = skapaFakeLager();
    const r = await db.skapaRapport(nyRapport({ orgnr: null, rakenskapsar: null }));
    if (!r.ok) throw new Error("unreachable");
    await db.skapaAnalys(nyAnalysRad({ rapportId: r.id }));
    expect(await db.klaimaNastaSteg()).toBeNull();
  });
});

describe("skapaFakeLager — register: rapport_fil, forening, adresser", () => {
  it("rapport_fil: on conflict do nothing returnerar vinnaren; bytRapportForFil är compare-and-set", async () => {
    const { db } = skapaFakeLager();
    const a = await db.skapaRapport(nyRapport({ orgnr: null, rakenskapsar: null }));
    const b = await db.skapaRapport(nyRapport({ orgnr: null, rakenskapsar: null }));
    if (!a.ok || !b.ok) throw new Error("unreachable");
    const fil = { pdfHash: "h", pdfPath: "h.pdf", sidor: 3, bytes: 100 };
    expect((await db.skapaRapportFil({ ...fil, rapportId: a.id })).rapportId).toBe(a.id);
    expect((await db.skapaRapportFil({ ...fil, rapportId: b.id })).rapportId).toBe(a.id);
    expect(await db.bytRapportForFil("h", b.id, b.id)).toBe(false);
    expect(await db.bytRapportForFil("h", a.id, b.id)).toBe(true);
    expect((await db.hamtaRapportFil("h"))?.rapportId).toBe(b.id);
    await expect(db.raderaRapport(b.id)).rejects.toThrow(/refererad/);
  });

  it("registreraForening behåller ett känt namn när det nya är null", async () => {
    const { db } = skapaFakeLager();
    await db.registreraForening("769612-3456", "Brf Testgården");
    await db.registreraForening("769612-3456", null);
    expect((await db.hamtaForening("769612-3456"))?.namn).toBe("Brf Testgården");
    await expect(db.registreraForening("7696123456", null)).rejects.toThrow();
  });

  it("forening_adress: en rad per naturlig nyckel (nulls not distinct), aldrig gatuadress från köpare", async () => {
    const { db } = skapaFakeLager();
    await db.registreraForening("769612-3456", null);
    const rad = {
      orgnr: "769612-3456",
      postnummer: "11532",
      kommunKod: "0180",
      omrade: null,
      adress: null,
      kalla: "anvandare" as const,
    };
    await db.registreraForeningAdress(rad);
    await db.registreraForeningAdress(rad);
    expect(db._allaAdresser()).toHaveLength(1);
    await expect(db.registreraForeningAdress({ ...rad, adress: "Storgatan 1" })).rejects.toThrow();
  });

  it("raderaAnalys: en PDF som registret refererar blir aldrig 'förlorad'", async () => {
    const { db } = skapaFakeLager();
    const r = await db.skapaRapport(nyRapport({ orgnr: null, rakenskapsar: null }));
    if (!r.ok) throw new Error("unreachable");
    await db.skapaRapportFil({
      pdfHash: "abc",
      rapportId: r.id,
      pdfPath: "abc.pdf",
      sidor: 1,
      bytes: 1,
    });
    const { id } = await db.skapaAnalys(nyAnalysRad({ pdfHash: "abc" }));
    expect(await db.raderaAnalys(id)).toEqual({ pdfBlevForlorad: false });
  });
});

describe("skapaFakeLager — register: filindexet och leasade skrivningar", () => {
  it("M3: en levande rapport per (pdf_hash, version); failed/ersatt och andra versioner tar ingen plats", async () => {
    const { db } = skapaFakeLager();
    const utan = { orgnr: null, rakenskapsar: null };
    const a = await db.skapaRapport(nyRapport({ ...utan, pdfHash: "h" }));
    if (!a.ok) throw new Error("unreachable");
    expect(await db.skapaRapport(nyRapport({ ...utan, pdfHash: "h" }))).toEqual({
      ok: false,
      orsak: "filkonflikt",
    });
    expect(
      (await db.skapaRapport(nyRapport({ ...utan, pdfHash: "h", pipelineVersion: "x" }))).ok,
    ).toBe(true);
    await db.uppdateraRapport(a.id, { status: "failed" });
    expect((await db.skapaRapport(nyRapport({ ...utan, pdfHash: "h" }))).ok).toBe(true);
  });

  it("L7: uppdateraLeasadRapport skriver bara medan raden körs under samma lease", async () => {
    const { db } = skapaFakeLager();
    const r = await db.skapaRapport(nyRapport({ orgnr: null, rakenskapsar: null }));
    if (!r.ok) throw new Error("unreachable");
    expect(await db.uppdateraLeasadRapport(r.id, null, { stage: "extraktion" })).toBe(false);
    const klaimad = await db.klaimaNastaRapportSteg();
    const lease = klaimad?.leaseUntil ?? null;
    expect(
      await db.uppdateraLeasadRapport(r.id, "2000-01-01T00:00:00.000Z", { stage: "extraktion" }),
    ).toBe(false);
    expect(await db.uppdateraLeasadRapport(r.id, lease, { stage: "extraktion" })).toBe(true);
    await db.uppdateraRapport(r.id, { status: "failed" });
    expect(await db.uppdateraLeasadRapport(r.id, lease, { stage: "bedomning" })).toBe(false);
    expect((await db.hamtaRapport(r.id))?.stage).toBe("extraktion");
  });
});

describe("principal_id och kontolagret (en analys-tabell)", () => {
  it("skapaAnalys sparar principalId; utelämnat blir null", async () => {
    const lager = skapaFakeLager();
    const { id: med } = await lager.db.skapaAnalys({ ...nyAnalysRad(), principalId: "p-1" });
    const { id: utan } = await lager.db.skapaAnalys(nyAnalysRad());
    expect((await lager.db.hamtaAnalys(med))?.principalId).toBe("p-1");
    expect((await lager.db.hamtaAnalys(utan))?.principalId).toBeNull();
  });

  it("sammanslagning, export och radering i kontolagret verkar på jobb-fakens rader", async () => {
    const lager = skapaFakeLager();
    const konto = skapaFakeKontoDatabas({ analyser: lager.db._analysTabell() });
    const enhet = await konto.sakerstallPrincipal("enhet-a");
    const kontoP = await konto.sakerstallPrincipal("enhet-b");
    const { id } = await lager.db.skapaAnalys({ ...nyAnalysRad(), principalId: enhet });
    const { id: annans } = await lager.db.skapaAnalys({ ...nyAnalysRad(), principalId: null });

    await konto.slaSammanPrincipal(enhet, kontoP);
    expect((await lager.db.hamtaAnalys(id))?.principalId).toBe(kontoP);

    const exporten = await konto.exporteraPrincipal(kontoP);
    expect(exporten?.analyser.map((a) => a.id)).toEqual([id]);

    const radering = await konto.raderaPrincipal(kontoP);
    expect(radering.analyser).toBe(1);
    expect(await lager.db.hamtaAnalys(id)).toBeNull();
    // Andras rader (och registret) rörs inte.
    expect(await lager.db.hamtaAnalys(annans)).not.toBeNull();
  });
});

describe("hamtaSpendForDag", () => {
  it("läser dagens summa utan att ändra den; 0 för en dag utan rad", async () => {
    const { db } = skapaFakeLager();
    expect(await db.hamtaSpendForDag("2026-10-09")).toBe(0);
    await db.reserveraSpend("2026-10-09", 3, 10);
    expect(await db.hamtaSpendForDag("2026-10-09")).toBe(3);
    expect(await db.hamtaSpendForDag("2026-10-09")).toBe(3);
  });
});

describe("sidtext (WS1, scan transcriptions)", () => {
  async function medRapport() {
    const lager = skapaFakeLager();
    const skapad = await lager.db.skapaRapport({
      orgnr: null,
      rakenskapsar: null,
      pipelineVersion: "p-test",
      model: "m",
      textlager: "saknas",
      status: "queued",
      stage: "transkribering",
      pdfHash: "h",
    });
    if (!skapad.ok) throw new Error("kunde inte skapa rapport");
    return { lager, rapportId: skapad.id };
  }

  it("hamtaSidtext: tom lista utan rader, annars sorterad på sida", async () => {
    const { lager, rapportId } = await medRapport();
    expect(await lager.db.hamtaSidtext(rapportId)).toEqual([]);
    await lager.db.sparaSidtext(
      rapportId,
      [
        { sida: 6, text: "sex" },
        { sida: 1, text: "ett" },
      ],
      "transkribering:v1",
    );
    expect(await lager.db.hamtaSidtext(rapportId)).toEqual([
      { sida: 1, text: "ett" },
      { sida: 6, text: "sex" },
    ]);
  });

  it("hamtaSidtext med kalla returnerar bara sidor med exakt den kallan (en annan prompt-version är gammal)", async () => {
    const { lager, rapportId } = await medRapport();
    await lager.db.sparaSidtext(rapportId, [{ sida: 1, text: "ny" }], "transkribering:v2");
    await lager.db.sparaSidtext(rapportId, [{ sida: 2, text: "gammal" }], "transkribering:v1");
    expect(await lager.db.hamtaSidtext(rapportId, "transkribering:v2")).toEqual([
      { sida: 1, text: "ny" },
    ]);
    expect((await lager.db.hamtaSidtext(rapportId)).map((s) => s.sida)).toEqual([1, 2]);
    expect(lager.db._allaSidtext(rapportId).map((s) => s.kalla)).toEqual([
      "transkribering:v2",
      "transkribering:v1",
    ]);
  });

  it("sparaSidtext är en upsert på (rapport_id, sida): en omskrivning ersätter, andra rader rörs inte", async () => {
    const { lager, rapportId } = await medRapport();
    await lager.db.sparaSidtext(
      rapportId,
      [
        { sida: 1, text: "gammal" },
        { sida: 2, text: "två" },
      ],
      "transkribering:v1",
    );
    await lager.db.sparaSidtext(rapportId, [{ sida: 1, text: "ny" }], "transkribering:v1");
    expect(await lager.db.hamtaSidtext(rapportId)).toEqual([
      { sida: 1, text: "ny" },
      { sida: 2, text: "två" },
    ]);
  });

  it("en tom text är en giltig sida (en blank sida behålls)", async () => {
    const { lager, rapportId } = await medRapport();
    await lager.db.sparaSidtext(rapportId, [{ sida: 3, text: "" }], "transkribering:v1");
    expect(await lager.db.hamtaSidtext(rapportId)).toEqual([{ sida: 3, text: "" }]);
  });

  it("rapporterna är isolerade från varandra", async () => {
    const { lager, rapportId } = await medRapport();
    await lager.db.sparaSidtext(rapportId, [{ sida: 1, text: "a" }], "transkribering:v1");
    expect(await lager.db.hamtaSidtext("fake-rapport-999")).toEqual([]);
  });

  it("FK: en okänd rapport nekas, sida < 1 nekas (som CHECK i migrationen)", async () => {
    const { lager, rapportId } = await medRapport();
    await expect(
      lager.db.sparaSidtext("fake-rapport-999", [{ sida: 1, text: "x" }], "transkribering:v1"),
    ).rejects.toThrow(/FK|okänd/);
    await expect(
      lager.db.sparaSidtext(rapportId, [{ sida: 0, text: "x" }], "transkribering:v1"),
    ).rejects.toThrow(/sida/);
  });

  it("on delete cascade: raderaRapport tar sidtexten med sig", async () => {
    const { lager, rapportId } = await medRapport();
    await lager.db.sparaSidtext(rapportId, [{ sida: 1, text: "a" }], "transkribering:v1");
    await lager.db.raderaRapport(rapportId);
    expect(await lager.db.hamtaSidtext(rapportId)).toEqual([]);
  });

  it("skriver aldrig om rapportens status (en terminal rapport väcks inte till liv)", async () => {
    const { lager, rapportId } = await medRapport();
    await lager.db.uppdateraRapport(rapportId, { status: "failed" });
    await lager.db.sparaSidtext(rapportId, [{ sida: 1, text: "a" }], "transkribering:v1");
    expect((await lager.db.hamtaRapport(rapportId))?.status).toBe("failed");
  });
});
