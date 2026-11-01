/**
 * hamtaForsaljningar: the real URL check, API client and mapping, the recorded
 * `sold?residenceId` answers in fixtures/booli-api/ served by a fake fetch,
 * and the fake konto database (cache + quota). No network.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { forsaljningarCacheNyckel } from "@/lib/annons/forsaljningar";
import { skapaFakeKontoDatabas, type FakeKontoDatabas } from "../__fakes__/konto";
import { STANDARD_POLICY, skapaBehorighet } from "../behorighet";
import type { Env } from "../env";
import type { Kontext } from "../kontext";
import { kvotNyckel } from "../kvot";
import type { Anropare } from "../portar";
import { hamtaForsaljningar } from "./forsaljningar";
import { ANNONS_CACHE_GILTIGHET_MS } from "./hamta";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROT = path.join(here, "..", "..", "..", "fixtures");
const apiFixtur = (namn: string): Response => {
  const { status, body } = JSON.parse(readFileSync(path.join(ROT, "booli-api", namn), "utf-8")) as {
    status: number;
    body: unknown;
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
};
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const NU = new Date("2026-11-01T12:00:00Z");
const kontext: Kontext = { enhetId: "a".repeat(22), principalId: null, ipHash: "ip-hash-1" };
const CALLER = "binfo-caller-test";
const NYCKEL = "hemlig-privat-nyckel";
const BOSTAD = "https://www.booli.se/bostad/720821";

function env(over: Partial<Env> = {}): Env {
  return {
    supabaseUrl: "https://example.supabase.co",
    supabaseSecretKey: "test-hemlighet",
    maxDailySpendSek: 100,
    killSwitchPa: false,
    anthropicApiKey: "test-key",
    anthropicModel: "claude-sonnet-5-5",
    maxCostPerAnalysisSek: 5,
    effortGrounding: "medium",
    effortExtraction: "medium",
    effortJudging: "medium",
    booliCallerId: CALLER,
    booliPrivateKey: NYCKEL,
    ...over,
  };
}

let konto: FakeKontoDatabas;
let varna: MockInstance<typeof console.warn>;
let klocka: Date;

function anropare(): Anropare {
  return { kontext, konto, behorighet: skapaBehorighet(STANDARD_POLICY) };
}

function fakeFetch(...svar: Array<Response | Error>) {
  const anrop: URL[] = [];
  const kopia = [...svar];
  const f = vi.fn(async (url: string | URL | Request) => {
    anrop.push(new URL(String(url)));
    const nasta = kopia.shift();
    if (nasta === undefined) throw new Error("oväntat extra anrop");
    if (nasta instanceof Error) throw nasta;
    return nasta;
  });
  return { f: f as unknown as typeof fetch, anrop };
}

function kor(url: unknown, f: typeof fetch, e: Env = env(), a: Anropare = anropare()) {
  return hamtaForsaljningar(
    { url },
    { anropare: a, env: e, fetch: f, nu: () => klocka, unik: () => "0123456789abcdef" },
  );
}

function kvotTotalt(): number {
  return [...konto.kvot.values()].reduce((s, r) => s + r.antal, 0);
}

function loggade(handelse: string): unknown[][] {
  return varna.mock.calls.filter((c) => c[0] === `[annons] ${handelse}`);
}

/** The flat's own sales + the 200 m box around it (233 sales, 11 at 31A). */
const hus = () =>
  fakeFetch(apiFixtur("bostad-720821-sold.json"), apiFixtur("hus-720821-sold-box.json"));

beforeEach(() => {
  klocka = NU;
  konto = skapaFakeKontoDatabas({ nu: () => klocka });
  varna = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  const logg = JSON.stringify(varna.mock.calls);
  expect(logg).not.toContain(CALLER);
  expect(logg).not.toContain(NYCKEL);
  expect(logg).not.toMatch(/hash=|callerId=|\b[0-9a-f]{40}\b/);
  vi.restoreAllMocks();
});

describe("hamtaForsaljningar", () => {
  it("/bostad/: egna försäljningar + rutan runt huset, filtrerat på adressen, cachat, en kvot", async () => {
    const h = hus();
    const r = await kor(BOSTAD, h.f);
    if (!r.ok) throw new Error("ok väntat");
    expect(r.adress).toBe("Sankt Eriksgatan 31A");
    expect(r.forsaljningar).toHaveLength(11);
    expect(r.forsaljningar.filter((f) => f.dennaLagenhet).map((f) => f.saldDatum)).toEqual([
      "2026-10-30",
      "2020-01-29",
    ]);
    expect(r.forsaljningar[0]).toEqual({
      saldDatum: "2026-10-30",
      pris: 6_025_000,
      boarea: 54,
      antalRum: 2,
      vaning: 3,
      avgift: null,
      dennaLagenhet: true,
    });
    const datum = r.forsaljningar.map((f) => f.saldDatum);
    expect(datum).toEqual([...datum].sort().reverse());
    expect(datum.every((d) => d >= "2016-11-01")).toBe(true);

    expect(h.anrop.map((u) => u.pathname)).toEqual(["/sold", "/sold"]);
    const [egen, box] = h.anrop as [URL, URL];
    expect(
      Object.fromEntries(
        ["residenceId", "sort", "direction", "limit"].map((k) => [k, egen.searchParams.get(k)]),
      ),
    ).toEqual({ residenceId: "720821", sort: "soldDate", direction: "desc", limit: "50" });
    expect(
      Object.fromEntries(
        ["dim", "objectType", "minSoldDate", "limit"].map((k) => [k, box.searchParams.get(k)]),
      ),
    ).toEqual({ dim: "200,200", objectType: "Lägenhet", minSoldDate: "20161101", limit: "1000" });
    expect(box.searchParams.get("center")).toMatch(/^59\.\d+,18\.\d+$/);
    expect(kvotTotalt()).toBe(2); // device + IP, one fetch
    expect(konto.annonsCache.get(forsaljningarCacheNyckel("720821"))?.svar).toEqual(r);
  });

  it("inga egna försäljningar: adress och läge från annonsen, bara exakt adress, bara 10 år", async () => {
    const rad = (adress: string, soldDate: string, booliId: number) => ({
      booliId,
      soldDate,
      soldPrice: 5_000_000,
      livingArea: 60,
      rooms: 2,
      floor: 2,
      location: { address: { streetAddress: adress } },
    });
    const h = fakeFetch(
      json({ totalCount: 0, sold: [], searchParams: { residenceId: "798609" } }),
      apiFixtur("bostad-798609-listings.json"),
      json({
        totalCount: 4,
        sold: [
          rad("Östermalmsgatan 30", "2025-10-24", 1),
          rad("östermalmsgatan  30", "2019-05-22", 2),
          rad("Östermalmsgatan 32", "2025-01-01", 3),
          rad("Östermalmsgatan 30A", "2024-01-01", 4),
          rad("Östermalmsgatan 30", "2016-10-31", 5),
        ],
      }),
    );
    const r = await kor("https://www.booli.se/bostad/798609", h.f);
    expect(r).toMatchObject({ ok: true, adress: "Östermalmsgatan 30" });
    expect(r.ok && r.forsaljningar.map((f) => [f.saldDatum, f.dennaLagenhet])).toEqual([
      ["2025-10-24", false],
      ["2019-05-22", false],
    ]);
    expect(h.anrop.map((u) => u.pathname)).toEqual(["/sold", "/listings", "/sold"]);
    expect(h.anrop[1]!.searchParams.get("residenceId")).toBe("798609");
  });

  it("rutan misslyckas: lägenhetens egna försäljningar visas ändå, felet loggas", async () => {
    const h = fakeFetch(apiFixtur("bostad-720821-sold.json"), new Error("timeout"));
    const r = await kor(BOSTAD, h.f);
    expect(r.ok && r.forsaljningar.map((f) => f.dennaLagenhet)).toEqual([true, true]);
    expect(loggade("försäljningar: nätverk")).toHaveLength(1);
  });

  it("en tom rad från första versionen (nyckeln booli-salda:<id>) döljer inte husets försäljningar", async () => {
    await konto.skrivAnnonsCache("booli-salda:720821", {
      ok: true,
      adress: null,
      forsaljningar: [],
    });
    const h = hus();
    const r = await kor(BOSTAD, h.f);
    expect(r.ok && r.forsaljningar).toHaveLength(11);
    expect(h.anrop).toHaveLength(2);
  });

  it("cacheträff: inget anrop, ingen kvot", async () => {
    const forsta = await kor(BOSTAD, hus().f);
    const kvotFore = kvotTotalt();
    const h = fakeFetch();
    klocka = new Date(NU.getTime() + ANNONS_CACHE_GILTIGHET_MS - 1000);
    expect(await kor("https://booli.se/bostad/720821?x=1", h.f)).toEqual(forsta);
    expect(h.anrop).toHaveLength(0);
    expect(kvotTotalt()).toBe(kvotFore);
  });

  it("gammal cache (24 h) hämtas om; trasig cache-rad ignoreras", async () => {
    const forsta = await kor(BOSTAD, hus().f);
    klocka = new Date(NU.getTime() + ANNONS_CACHE_GILTIGHET_MS);
    const h = hus();
    expect(await kor(BOSTAD, h.f)).toEqual(forsta);
    expect(h.anrop).toHaveLength(2);

    await konto.skrivAnnonsCache(forsaljningarCacheNyckel("720821"), { ok: true, skrap: 1 });
    const h2 = hus();
    expect(await kor(BOSTAD, h2.f)).toEqual(forsta);
    expect(h2.anrop).toHaveLength(2);
  });

  it("varken försäljningar eller annons: tom lista cachas och visas inte", async () => {
    const tom = (samling: string) =>
      json({ totalCount: 0, [samling]: [], searchParams: { residenceId: "720821" } });
    const h = fakeFetch(tom("sold"), tom("listings"), tom("listings"));
    expect(await kor(BOSTAD, h.f)).toEqual({ ok: true, adress: null, forsaljningar: [] });
    expect(konto.annonsCache.has(forsaljningarCacheNyckel("720821"))).toBe(true);
  });

  it("/annons/-länk, fel domän, fel indata: ok:false, inga anrop, ingen kvot", async () => {
    const h = fakeFetch();
    expect(await kor("https://www.booli.se/annons/6332006", h.f)).toEqual({ ok: false });
    expect(await kor("https://example.com/bostad/720821", h.f)).toEqual({ ok: false });
    expect(await kor(42, h.f)).toEqual({ ok: false });
    expect(
      await hamtaForsaljningar(null, { anropare: anropare(), env: env(), fetch: h.f }),
    ).toEqual({
      ok: false,
    });
    expect(h.anrop).toHaveLength(0);
    expect(kvotTotalt()).toBe(0);
  });

  it("API avstängt, nycklar saknas eller ANNONS_HAMTNING=off: inga anrop", async () => {
    const h = fakeFetch();
    expect(await kor(BOSTAD, h.f, env({ booliApiAvstangd: true }))).toEqual({ ok: false });
    expect(await kor(BOSTAD, h.f, env({ booliPrivateKey: "" }))).toEqual({ ok: false });
    expect(await kor(BOSTAD, h.f, env({ annonsHamtningAvstangd: true }))).toEqual({ ok: false });
    expect(h.anrop).toHaveLength(0);
    expect(kvotTotalt()).toBe(0);
  });

  it("svar utan eko av residenceId → ok:false, inget cachas", async () => {
    const h = fakeFetch(json({ totalCount: 1, sold: [{ soldDate: "2024-01-01", soldPrice: 1 }] }));
    expect(await kor(BOSTAD, h.f)).toEqual({ ok: false });
    expect(konto.annonsCache.size).toBe(0);
    expect(loggade("försäljningar: tolkning misslyckades")).toHaveLength(1);
  });

  it("fel eko eller > 50 träffar → ok:false", async () => {
    const h = fakeFetch(
      json({ totalCount: 1, sold: [], searchParams: { residenceId: "1" } }),
      json({ totalCount: 51, sold: [], searchParams: { residenceId: "720821" } }),
    );
    expect(await kor(BOSTAD, h.f)).toEqual({ ok: false });
    expect(await kor(BOSTAD, h.f)).toEqual({ ok: false });
    expect(konto.annonsCache.size).toBe(0);
  });

  it("401 → ok:false och loggar booli-api nyckel avvisad", async () => {
    const h = fakeFetch(json({ error: "FAILURE_INVALID_CALLER" }, 401));
    expect(await kor(BOSTAD, h.f)).toEqual({ ok: false });
    const rader = loggade("booli-api nyckel avvisad");
    expect(rader).toHaveLength(1);
    expect(rader[0]![1]).toMatchObject({ kalla: "booli_api", url: BOSTAD });
    expect(konto.annonsCache.size).toBe(0);
  });

  it("nätverksfel → ok:false, kvoten tas en gång per miss", async () => {
    const h = fakeFetch(new Error("connect ECONNREFUSED"), new Error("timeout"));
    expect(await kor(BOSTAD, h.f)).toEqual({ ok: false });
    expect(kvotTotalt()).toBe(2);
    expect(await kor(BOSTAD, h.f)).toEqual({ ok: false });
    expect(kvotTotalt()).toBe(4);
    expect(loggade("försäljningar: nätverk")).toHaveLength(2);
  });

  it("kvoten slut → ok:false utan anrop", async () => {
    const h = fakeFetch();
    const nyckel = kvotNyckel("annonshamtning", "enhet", kontext.enhetId);
    for (let i = 0; i < 20; i += 1) await konto.taKvot(nyckel, 3600, 20);
    expect(await kor(BOSTAD, h.f)).toEqual({ ok: false });
    expect(h.anrop).toHaveLength(0);
  });

  it("cache-läsfel loggas och ignoreras", async () => {
    const a = anropare();
    a.konto.lasAnnonsCache = () => Promise.reject(new Error("db nere"));
    const r = await kor(BOSTAD, hus().f, env(), a);
    expect(r.ok && r.forsaljningar).toHaveLength(11);
    expect(loggade("försäljningar: cache-läsning misslyckades")).toHaveLength(1);
  });
});
