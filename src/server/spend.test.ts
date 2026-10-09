import { describe, expect, it, vi } from "vitest";
import { skapaFakeLager } from "./__fakes__/lager";
import type { Env } from "./env";
import {
  kontrolleraDagligtTak,
  reserveraForSteg,
  stamAvSteg,
  UPPSKATTAD_KOSTNAD_BEDOMNING_SEK,
  UPPSKATTAD_KOSTNAD_EXTRAKTION_SEK,
  UPPSKATTAD_KOSTNAD_GRUNDNING_SEK,
  UPPSKATTAD_KOSTNAD_TRANSKRIBERING_SEK_PER_SIDA,
  TRANSKRIBERING_MAX_OUTPUT_TOKENS_PER_CHUNK,
  TRANSKRIBERING_VARSTA_FALL_SEK_PER_CHUNK,
  transkriberingsTak,
  uppskattadKostnadTranskribering,
} from "./spend";
import { estimateCostSek, prissattningForModell, STANDARD_MODELL } from "@/lib/analysis/costGuard";

/** Minimal Env-liknande objekt — testerna behöver bara de två fält
 *  spend-vakten faktiskt läser. */
function miljo(delta: Partial<Pick<Env, "maxDailySpendSek" | "killSwitchPa">> = {}) {
  return { maxDailySpendSek: 10, killSwitchPa: false, ...delta };
}

const DAG = "2026-09-13";

describe("reserveraForSteg", () => {
  it("en reservation under taket accepteras och minskar kvarvarande utrymme", async () => {
    const { db } = skapaFakeLager();

    const resultat = await reserveraForSteg(db, miljo({ maxDailySpendSek: 10 }), 4, DAG);
    expect(resultat).toEqual({ ok: true, reserveratSek: 4 });

    // 10 - 4 = 6 kr kvar. En reservation på exakt 6 kr ska gå igenom...
    const andra = await reserveraForSteg(db, miljo({ maxDailySpendSek: 10 }), 6, DAG);
    expect(andra.ok).toBe(true);

    // ...men taket är nu nått: minsta möjliga tillägg refuseras.
    const tredje = await reserveraForSteg(db, miljo({ maxDailySpendSek: 10 }), 0.01, DAG);
    expect(tredje.ok).toBe(false);
    expect(tredje.skal).toBe("daily_cap");
  });

  it("en reservation som skulle spränga taket refuseras och lämnar inget spår", async () => {
    const { db } = skapaFakeLager();

    const refuserad = await reserveraForSteg(db, miljo({ maxDailySpendSek: 10 }), 11, DAG);
    expect(refuserad).toEqual({ ok: false, skal: "daily_cap" });

    // Kontroll: hela taket (10 kr) ska fortfarande fungera i en enda
    // reservation — den refuserade 11-kr-reservationen fick inte ändra
    // dagens totalsumma.
    const kontroll = await reserveraForSteg(db, miljo({ maxDailySpendSek: 10 }), 10, DAG);
    expect(kontroll).toEqual({ ok: true, reserveratSek: 10 });
  });

  it("killSwitchPa refuserar direkt utan att röra db.reserveraSpend", async () => {
    const { db } = skapaFakeLager();
    const spionerad = vi.fn(db.reserveraSpend.bind(db));
    const dbMedSpion = { ...db, reserveraSpend: spionerad };

    const resultat = await reserveraForSteg(
      dbMedSpion,
      miljo({ killSwitchPa: true, maxDailySpendSek: 10 }),
      1,
      DAG,
    );

    expect(resultat).toEqual({ ok: false, skal: "kill_switch" });
    expect(spionerad).not.toHaveBeenCalled();
  });

  it("två sekventiella reservationer som var för sig ryms men tillsammans spränger taket: bara den första accepteras", async () => {
    const { db } = skapaFakeLager();

    const forsta = await reserveraForSteg(db, miljo({ maxDailySpendSek: 10 }), 6, DAG);
    expect(forsta.ok).toBe(true);

    const andra = await reserveraForSteg(db, miljo({ maxDailySpendSek: 10 }), 6, DAG);
    expect(andra).toEqual({ ok: false, skal: "daily_cap" });
  });
});

describe("stamAvSteg", () => {
  it("avstämning ner till faktisk kostnad frigör mellanskillnaden", async () => {
    const { db } = skapaFakeLager();

    // Reservera en uppskattning på 3 kr av ett tak på 4 kr.
    const reservation = await reserveraForSteg(db, miljo({ maxDailySpendSek: 4 }), 3, DAG);
    expect(reservation).toEqual({ ok: true, reserveratSek: 3 });

    // Utan avstämning skulle bara 1 kr till rymmas (4 - 3). Stäm av ner till
    // den faktiska kostnaden 1,5 kr — det frigör 1,5 kr utrymme (3 - 1,5).
    await stamAvSteg(db, 3, 1.5, DAG);

    // Nu ska 2,5 kr till rymmas (4 - 1,5), vilket inte hade fått plats utan
    // avstämningen (1,5 + 2,5 = 4 <= 4 kr tak; utan avstämning hade det varit
    // 3 + 2,5 = 5,5 > 4 kr tak).
    const efterAvstamning = await reserveraForSteg(db, miljo({ maxDailySpendSek: 4 }), 2.5, DAG);
    expect(efterAvstamning).toEqual({ ok: true, reserveratSek: 2.5 });
  });
});

describe("uppskattade kostnadskonstanter", () => {
  it("är alla positiva tal", () => {
    expect(UPPSKATTAD_KOSTNAD_GRUNDNING_SEK).toBeGreaterThan(0);
    expect(UPPSKATTAD_KOSTNAD_EXTRAKTION_SEK).toBeGreaterThan(0);
    expect(UPPSKATTAD_KOSTNAD_BEDOMNING_SEK).toBeGreaterThan(0);
  });
});

describe("kontrolleraDagligtTak", () => {
  it("ok under taket, daily_cap när dagens kostnad når taket — och reserverar aldrig något", async () => {
    const { db } = skapaFakeLager();
    expect(await kontrolleraDagligtTak(db, miljo({ maxDailySpendSek: 10 }), DAG)).toEqual({
      ok: true,
    });

    await reserveraForSteg(db, miljo({ maxDailySpendSek: 10 }), 9, DAG);
    expect((await kontrolleraDagligtTak(db, miljo({ maxDailySpendSek: 10 }), DAG)).ok).toBe(true);

    await reserveraForSteg(db, miljo({ maxDailySpendSek: 10 }), 1, DAG);
    expect(await kontrolleraDagligtTak(db, miljo({ maxDailySpendSek: 10 }), DAG)).toEqual({
      ok: false,
      skal: "daily_cap",
    });
    // Läsningen ändrade ingenting: dagens summa är fortfarande exakt 10.
    expect(await db.hamtaSpendForDag(DAG)).toBe(10);
  });

  it("en dag utan spend_day-rad räknas som 0", async () => {
    const { db } = skapaFakeLager();
    expect(await db.hamtaSpendForDag("2026-01-01")).toBe(0);
    expect(
      (await kontrolleraDagligtTak(db, miljo({ maxDailySpendSek: 0.5 }), "2026-01-01")).ok,
    ).toBe(true);
  });
});

describe("transkribering (WS1): reservation och tak", () => {
  it("reserverar realistiskt per sida (mätt 0,105 kr/sida inkl. headers → 0,15), inte värsta fallet", () => {
    expect(UPPSKATTAD_KOSTNAD_TRANSKRIBERING_SEK_PER_SIDA).toBe(0.15);
    expect(uppskattadKostnadTranskribering(34)).toBeCloseTo(5.1, 10);
    expect(uppskattadKostnadTranskribering(0)).toBe(0);
  });

  it("värsta fallet per chunk (8,6k in / 8k ut på Sonnet 5.5) ryms i 1,0 kr; max_tokens är 8000", () => {
    expect(TRANSKRIBERING_MAX_OUTPUT_TOKENS_PER_CHUNK).toBe(8000);
    const varsta = estimateCostSek(
      8_600,
      TRANSKRIBERING_MAX_OUTPUT_TOKENS_PER_CHUNK,
      prissattningForModell(STANDARD_MODELL),
    );
    expect(varsta).toBeGreaterThan(0.9);
    expect(varsta).toBeLessThanOrEqual(TRANSKRIBERING_VARSTA_FALL_SEK_PER_CHUNK);
  });

  it("taket är max(per-analys-taket, antal chunkar × 1,0)", () => {
    expect(transkriberingsTak(5, 7)).toBe(7); // 34 sidor = 7 chunkar
    expect(transkriberingsTak(5, 3)).toBe(5);
    expect(transkriberingsTak(10, 7)).toBe(10);
    expect(transkriberingsTak(5, 0)).toBe(5);
  });
});
