import { describe, expect, it } from "vitest";
import { skapaFakeLager } from "./__fakes__/lager";
import {
  hamtaAnalysFranCache,
  hamtaExtraktionFranCache,
  sparaAnalysICache,
  sparaExtraktionICache,
  type CacheNyckel,
} from "./cache";
import { extraktion } from "@/lib/analysis/__fixtures__/extraktion";
import { bedomStatus } from "@/lib/analysis/benchmarks";
import { ExtractionResultSchema, AnalysJudgementSchema } from "@/lib/analysis/schema";
import type { AnalysJudgement } from "@/lib/analysis/analyze";
import type { ExtractionResult, KeyFigure } from "@/types/analysis";
import type { AnalysCacheRad, ExtraktionCacheRad } from "./portar";

const NYCKEL: CacheNyckel = {
  pdfHash: "abc",
  model: "claude-sonnet-5",
  promptVersion: "1",
};

function minimalJudgement(): AnalysJudgement {
  return {
    betyg: "B",
    betygMotivering: "Rimligt stabil förening med enstaka svagheter i skuldsättningen.",
    rodaFlaggor: [],
    fragor: [],
  };
}

describe("extraktion_cache", () => {
  it("skriver och läser tillbaka en extraktion (keyFigures omgraderas, se test nedan)", async () => {
    const { db } = skapaFakeLager();

    await sparaExtraktionICache(db, NYCKEL, extraktion, 0.5);
    const last = await hamtaExtraktionFranCache(db, NYCKEL);

    expect(last).not.toBeNull();
    const { forening: lastForening, ...lastUtanForening } = last as ExtractionResult;
    const { forening: originalForening, ...originalUtanForening } = extraktion;
    const { keyFigures: lastNyckeltal, ...lastForeningUtanNyckeltal } = lastForening;
    const { keyFigures: originalNyckeltal, ...originalForeningUtanNyckeltal } = originalForening;

    // Allt utom keyFigures ska vara oförändrat.
    expect(lastUtanForening).toEqual(originalUtanForening);
    expect(lastForeningUtanNyckeltal).toEqual(originalForeningUtanNyckeltal);

    // keyFigures är redan berikade i fixturen (via berikaNyckeltal), så en
    // andra omgradering vid läsning ska ge exakt samma resultat — annars
    // vore berikaNyckeltal inte deterministisk.
    expect(lastNyckeltal).toEqual(originalNyckeltal);

    // Läst data ska alltid passera kontraktet.
    expect(ExtractionResultSchema.safeParse(last).success).toBe(true);
  });

  it("återberikar keyFigures vid läsning — en felaktig lagrad status korrigeras alltid (den viktigaste egenskapen)", async () => {
    const { db } = skapaFakeLager();

    // Medvetet trasig lagrad data: varje status satt till "kritisk" och
    // eventuellt benchmark bortplockat, som om ett gammalt cache-radsvar
    // (eller ett BENCHMARKS.md-tröskelbyte) gjort lagrad status inaktuell.
    const korrupt: ExtractionResult = {
      ...extraktion,
      forening: {
        ...extraktion.forening,
        keyFigures: extraktion.forening.keyFigures.map((kf): KeyFigure => {
          const { benchmark: _benchmark, ...utanBenchmark } = kf;
          return { ...utanBenchmark, status: "kritisk" };
        }),
      },
    };

    await sparaExtraktionICache(db, NYCKEL, korrupt, 0.5);
    const last = await hamtaExtraktionFranCache(db, NYCKEL);

    expect(last).not.toBeNull();
    let minstEnKorrigerad = false;
    for (const kf of last!.forening.keyFigures) {
      const forvantat = bedomStatus(kf.id, kf.figure.value);
      expect(kf.status).toEqual(forvantat.status);
      expect(kf.benchmark).toEqual(forvantat.benchmark);
      if (forvantat.status !== "kritisk") minstEnKorrigerad = true;
    }
    // Bevisa att det verkligen korrigerades någonstans, inte att korruptionen
    // (alla satta till "kritisk") råkade vara rätt svar för varje nyckeltal.
    expect(minstEnKorrigerad).toBe(true);
  });

  it("cache-miss på annan model, annan prompt_version eller annan pdf_hash", async () => {
    const { db } = skapaFakeLager();
    await sparaExtraktionICache(db, NYCKEL, extraktion, 0.5);

    expect(await hamtaExtraktionFranCache(db, { ...NYCKEL, model: "claude-opus-5" })).toBeNull();
    expect(await hamtaExtraktionFranCache(db, { ...NYCKEL, promptVersion: "2" })).toBeNull();
    expect(await hamtaExtraktionFranCache(db, { ...NYCKEL, pdfHash: "xyz" })).toBeNull();
  });

  it("skrivning är on-conflict-do-nothing: första skrivningen vinner", async () => {
    const { db } = skapaFakeLager();

    await sparaExtraktionICache(db, NYCKEL, extraktion, 0.5);

    const andraForsoket: ExtractionResult = {
      ...extraktion,
      forening: {
        ...extraktion.forening,
        lanebok: {
          ...extraktion.forening.lanebok!,
          totalSkuld: { value: 999_000_000, unit: "kr", source: "arsredovisning" },
        },
      },
    };
    await sparaExtraktionICache(db, NYCKEL, andraForsoket, 999);

    const last = await hamtaExtraktionFranCache(db, NYCKEL);
    expect(last!.forening.lanebok!.totalSkuld.value).toEqual(
      extraktion.forening.lanebok!.totalSkuld.value,
    );
  });

  it("kastar ett tydligt fel istället för att tyst returnera ogiltig data", async () => {
    const { db } = skapaFakeLager();

    // Konstruerar en lagrad rad som inte matchar ExtractionResultSchema
    // (namn saknas på föreningen) genom att gå förbi det typade
    // sparaExtraktionICache-omslaget och skriva direkt via Databas.
    const trasigExtraktion = structuredClone(extraktion) as unknown as ExtractionResult;
    // @ts-expect-error -- medvetet ogiltig: tar bort ett obligatoriskt fält
    delete trasigExtraktion.forening.namn;

    const rad: ExtraktionCacheRad = {
      extraction: trasigExtraktion,
      schemaVersion: "1.0.0",
      costSek: 0,
      orgnr: null,
      rakenskapsar: null,
    };
    await db.sparaExtraktion(NYCKEL.pdfHash, NYCKEL.model, NYCKEL.promptVersion, rad);

    await expect(hamtaExtraktionFranCache(db, NYCKEL)).rejects.toThrow(/ExtractionResultSchema/);
  });
});

describe("analys_cache", () => {
  it("skriver och läser tillbaka en judgement oförändrad", async () => {
    const { db } = skapaFakeLager();
    const judgement = minimalJudgement();

    await sparaAnalysICache(db, NYCKEL, judgement, 0.2);
    const last = await hamtaAnalysFranCache(db, NYCKEL);

    expect(last).toEqual(judgement);
    expect(AnalysJudgementSchema.safeParse(last).success).toBe(true);
  });

  it("cache-miss på annan model, annan prompt_version eller annan pdf_hash", async () => {
    const { db } = skapaFakeLager();
    await sparaAnalysICache(db, NYCKEL, minimalJudgement(), 0.2);

    expect(await hamtaAnalysFranCache(db, { ...NYCKEL, model: "claude-opus-5" })).toBeNull();
    expect(await hamtaAnalysFranCache(db, { ...NYCKEL, promptVersion: "2" })).toBeNull();
    expect(await hamtaAnalysFranCache(db, { ...NYCKEL, pdfHash: "xyz" })).toBeNull();
  });

  it("skrivning är on-conflict-do-nothing: första skrivningen vinner", async () => {
    const { db } = skapaFakeLager();
    const forsta = minimalJudgement();
    await sparaAnalysICache(db, NYCKEL, forsta, 0.2);

    const andra: AnalysJudgement = { ...forsta, betyg: "E" };
    await sparaAnalysICache(db, NYCKEL, andra, 999);

    const last = await hamtaAnalysFranCache(db, NYCKEL);
    expect(last!.betyg).toEqual("B");
  });

  it("kastar ett tydligt fel istället för att tyst returnera ogiltig data", async () => {
    const { db } = skapaFakeLager();

    const trasigJudgement = {
      betyg: "B",
      // betygMotivering saknas medvetet
      rodaFlaggor: [],
      fragor: [],
    } as unknown as AnalysJudgement;

    const rad: AnalysCacheRad = { judgement: trasigJudgement, costSek: 0 };
    await db.sparaAnalysCache(NYCKEL.pdfHash, NYCKEL.model, NYCKEL.promptVersion, rad);

    await expect(hamtaAnalysFranCache(db, NYCKEL)).rejects.toThrow(/AnalysJudgementSchema/);
  });
});
