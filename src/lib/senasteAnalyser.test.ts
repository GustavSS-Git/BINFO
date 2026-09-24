import { describe, expect, it } from "vitest";
import { LocalStorageAnalysHistorik, type StorageLike } from "./senasteAnalyser";

/** En enkel in-memory-storage för test — låter oss injicera trasigt innehåll
 *  och simulera "ingen storage tillgänglig" utan jsdom/localStorage. */
function fakeStorage(initial: Record<string, string> = {}): StorageLike {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => (store.has(key) ? (store.get(key) ?? null) : null),
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

const KLOCKA = new Date("2026-09-24T12:00:00.000Z");
const dagarSedan = (dagar: number) =>
  new Date(KLOCKA.getTime() - dagar * 24 * 60 * 60 * 1000).toISOString();

describe("LocalStorageAnalysHistorik", () => {
  it("hamta() returnerar tom lista när ingen storage finns (SSR)", () => {
    const historik = new LocalStorageAnalysHistorik(() => null);
    expect(historik.hamta(KLOCKA)).toEqual([]);
  });

  it("spara() är en no-op utan storage, inte ett kastat fel", () => {
    const historik = new LocalStorageAnalysHistorik(() => null);
    expect(() => historik.spara({ analysisId: "a", skapad: KLOCKA.toISOString() })).not.toThrow();
  });

  it("sparar och hämtar en post", () => {
    const storage = fakeStorage();
    const historik = new LocalStorageAnalysHistorik(() => storage);
    historik.spara({ analysisId: "a1", skapad: dagarSedan(1), foreningsnamn: "Brf Ekot" });
    expect(historik.hamta(KLOCKA)).toEqual([
      { analysisId: "a1", skapad: dagarSedan(1), foreningsnamn: "Brf Ekot" },
    ]);
  });

  it("returnerar nyast först", () => {
    const storage = fakeStorage();
    const historik = new LocalStorageAnalysHistorik(() => storage);
    historik.spara({ analysisId: "gammal", skapad: dagarSedan(5) });
    historik.spara({ analysisId: "ny", skapad: dagarSedan(1) });
    expect(historik.hamta(KLOCKA).map((a) => a.analysisId)).toEqual(["ny", "gammal"]);
  });

  it("droppar poster äldre än 30 dagar", () => {
    const storage = fakeStorage();
    const historik = new LocalStorageAnalysHistorik(() => storage);
    historik.spara({ analysisId: "utgangen", skapad: dagarSedan(31) });
    historik.spara({ analysisId: "giltig", skapad: dagarSedan(29) });
    expect(historik.hamta(KLOCKA).map((a) => a.analysisId)).toEqual(["giltig"]);
  });

  it("behåller högst fem poster", () => {
    const storage = fakeStorage();
    const historik = new LocalStorageAnalysHistorik(() => storage);
    for (let i = 0; i < 7; i++) {
      historik.spara({ analysisId: `a${i}`, skapad: dagarSedan(i) });
    }
    const resultat = historik.hamta(KLOCKA);
    expect(resultat).toHaveLength(5);
    expect(resultat.map((a) => a.analysisId)).toEqual(["a0", "a1", "a2", "a3", "a4"]);
  });

  it("uppdaterar en befintlig post istället för att duplicera den", () => {
    const storage = fakeStorage();
    const historik = new LocalStorageAnalysHistorik(() => storage);
    historik.spara({ analysisId: "a1", skapad: dagarSedan(2) });
    historik.spara({ analysisId: "a1", skapad: dagarSedan(1) });
    const resultat = historik.hamta(KLOCKA);
    expect(resultat).toHaveLength(1);
    expect(resultat[0]?.skapad).toBe(dagarSedan(1));
  });

  it("behåller föreningsnamn från en tidigare post när en senare spara() utelämnar det", () => {
    const storage = fakeStorage();
    const historik = new LocalStorageAnalysHistorik(() => storage);
    historik.spara({ analysisId: "a1", skapad: dagarSedan(2), foreningsnamn: "Brf Ekot" });
    historik.spara({ analysisId: "a1", skapad: dagarSedan(1) });
    expect(historik.hamta(KLOCKA)[0]?.foreningsnamn).toBe("Brf Ekot");
  });

  it("skriver över föreningsnamn när en senare spara() anger ett nytt", () => {
    const storage = fakeStorage();
    const historik = new LocalStorageAnalysHistorik(() => storage);
    historik.spara({ analysisId: "a1", skapad: dagarSedan(2), foreningsnamn: "Preliminärt" });
    historik.spara({ analysisId: "a1", skapad: dagarSedan(1), foreningsnamn: "Brf Ekot" });
    expect(historik.hamta(KLOCKA)[0]?.foreningsnamn).toBe("Brf Ekot");
  });

  it("glom() tar bort en post", () => {
    const storage = fakeStorage();
    const historik = new LocalStorageAnalysHistorik(() => storage);
    historik.spara({ analysisId: "a1", skapad: dagarSedan(1) });
    historik.spara({ analysisId: "a2", skapad: dagarSedan(1) });
    historik.glom("a1");
    expect(historik.hamta(KLOCKA).map((a) => a.analysisId)).toEqual(["a2"]);
  });

  it("hamta() hanterar trasig JSON utan att kasta", () => {
    const storage = fakeStorage({ "binfo:senaste-analyser": "{inte json" });
    const historik = new LocalStorageAnalysHistorik(() => storage);
    expect(historik.hamta(KLOCKA)).toEqual([]);
  });

  it("hamta() hoppar över enskilda ogiltiga poster men behåller giltiga", () => {
    const storage = fakeStorage({
      "binfo:senaste-analyser": JSON.stringify([
        { analysisId: "ok", skapad: dagarSedan(1) },
        { skapad: dagarSedan(1) }, // saknar analysisId
        { analysisId: "utan-datum" }, // saknar skapad
        "helt fel typ",
      ]),
    });
    const historik = new LocalStorageAnalysHistorik(() => storage);
    expect(historik.hamta(KLOCKA).map((a) => a.analysisId)).toEqual(["ok"]);
  });

  it("hamta() hanterar att lagringen inte är en array", () => {
    const storage = fakeStorage({ "binfo:senaste-analyser": JSON.stringify({ not: "an array" }) });
    const historik = new LocalStorageAnalysHistorik(() => storage);
    expect(historik.hamta(KLOCKA)).toEqual([]);
  });

  it("spara() och hamta() kastar aldrig även om storage-metoderna gör det", () => {
    const kastandeStorage: StorageLike = {
      getItem: () => {
        throw new Error("blockerad");
      },
      setItem: () => {
        throw new Error("full kvot");
      },
      removeItem: () => {
        throw new Error("blockerad");
      },
    };
    const historik = new LocalStorageAnalysHistorik(() => kastandeStorage);
    expect(() => historik.spara({ analysisId: "a1", skapad: KLOCKA.toISOString() })).not.toThrow();
    expect(() => historik.hamta(KLOCKA)).not.toThrow();
    expect(() => historik.glom("a1")).not.toThrow();
    expect(historik.hamta(KLOCKA)).toEqual([]);
  });

  it("hamta() default now() fångar en nyss sparad post (ingen now injicerad)", () => {
    const storage = fakeStorage();
    const historik = new LocalStorageAnalysHistorik(() => storage);
    historik.spara({ analysisId: "a1", skapad: new Date().toISOString() });
    expect(historik.hamta().map((a) => a.analysisId)).toEqual(["a1"]);
  });
});
