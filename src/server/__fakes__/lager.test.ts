import { describe, expect, it } from "vitest";
import type { ExtractionResult, KeyFigure, KeyFigureId, PropertyInput } from "@/types/analysis";
import type { AnalysJudgement } from "@/lib/analysis/analyze";
import type { LaneUnderlag } from "@/lib/analysis/calc/manadskostnad";
import type { NyAnalysRad } from "../portar";
import { skapaFakeLager } from "./lager";

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
    antalLantagare: 2,
  };
}

function lanUnderlag(): LaneUnderlag {
  return { lanebelopp: 2_000_000, kontantinsats: 1_000_000, ranta: 3.6, bruttoinkomst: 600_000 };
}

function nyAnalysRad(overrides: Partial<NyAnalysRad> = {}): NyAnalysRad {
  return {
    pdfHash: "hash-1",
    pdfPath: "arsredovisningar/hash-1.pdf",
    propertyInput: propertyInput(),
    lanUnderlag: lanUnderlag(),
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
