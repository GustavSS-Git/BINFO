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

const SANKT_ERIKSGATAN = {
  ok: true,
  adress: "Sankt Eriksgatan 31A",
  forsaljningar: [
    { saldDatum: "2026-10-30", pris: 6_025_000, boarea: 54, antalRum: 2, vaning: 3, avgift: null },
    { saldDatum: "2020-01-29", pris: 5_220_000, boarea: 54, antalRum: 2, vaning: 3, avgift: null },
  ],
};

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
  it("/bostad/: ett anrop sold?residenceId, mappat, cachat, en kvot", async () => {
    const h = fakeFetch(apiFixtur("bostad-720821-sold.json"));
    const r = await kor(BOSTAD, h.f);
    expect(r).toEqual(SANKT_ERIKSGATAN);
    expect(h.anrop).toHaveLength(1);
    const u = h.anrop[0]!;
    expect(u.host).toBe("api.booli.se");
    expect(u.pathname).toBe("/sold");
    expect(
      Object.fromEntries(
        ["residenceId", "sort", "direction", "limit"].map((k) => [k, u.searchParams.get(k)]),
      ),
    ).toEqual({
      residenceId: "720821",
      sort: "soldDate",
      direction: "desc",
      limit: "50",
    });
    expect(kvotTotalt()).toBe(2); // device + IP, one fetch
    expect(konto.annonsCache.get(forsaljningarCacheNyckel("720821"))?.svar).toEqual(
      SANKT_ERIKSGATAN,
    );
  });

  it("cacheträff: inget anrop, ingen kvot", async () => {
    await kor(BOSTAD, fakeFetch(apiFixtur("bostad-720821-sold.json")).f);
    const kvotFore = kvotTotalt();
    const h = fakeFetch();
    klocka = new Date(NU.getTime() + ANNONS_CACHE_GILTIGHET_MS - 1000);
    expect(await kor("https://booli.se/bostad/720821?x=1", h.f)).toEqual(SANKT_ERIKSGATAN);
    expect(h.anrop).toHaveLength(0);
    expect(kvotTotalt()).toBe(kvotFore);
  });

  it("gammal cache (24 h) hämtas om; trasig cache-rad ignoreras", async () => {
    await kor(BOSTAD, fakeFetch(apiFixtur("bostad-720821-sold.json")).f);
    klocka = new Date(NU.getTime() + ANNONS_CACHE_GILTIGHET_MS);
    const h = fakeFetch(apiFixtur("bostad-720821-sold.json"));
    expect(await kor(BOSTAD, h.f)).toEqual(SANKT_ERIKSGATAN);
    expect(h.anrop).toHaveLength(1);

    await konto.skrivAnnonsCache(forsaljningarCacheNyckel("720821"), { ok: true, skrap: 1 });
    const h2 = fakeFetch(apiFixtur("bostad-720821-sold.json"));
    expect(await kor(BOSTAD, h2.f)).toEqual(SANKT_ERIKSGATAN);
    expect(h2.anrop).toHaveLength(1);
  });

  it("tom lista cachas och visas inte (ok med tom lista)", async () => {
    const h = fakeFetch(
      json({ totalCount: 0, count: 0, sold: [], searchParams: { residenceId: "720821" } }),
    );
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
    const h = fakeFetch(apiFixtur("bostad-720821-sold.json"));
    expect(await kor(BOSTAD, h.f, env(), a)).toEqual(SANKT_ERIKSGATAN);
    expect(loggade("försäljningar: cache-läsning misslyckades")).toHaveLength(1);
  });
});
