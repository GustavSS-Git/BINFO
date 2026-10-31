/**
 * hamtaAnnons with the Booli API as the source (docs/plans/booli-api.md §3):
 * the real URL check, the real API client and mapping, the recorded answers
 * in fixtures/booli-api/ (and one recorded page in fixtures/booli/ for the
 * page fallback), served by a fake fetch. No network.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { ANNONS_MEDDELANDE } from "@/lib/annons/typer";
import { skapaFakeKontoDatabas, type FakeKontoDatabas } from "../__fakes__/konto";
import { STANDARD_POLICY, skapaBehorighet } from "../behorighet";
import type { Env } from "../env";
import type { Kontext } from "../kontext";
import type { Anropare } from "../portar";
import { hamtaAnnons } from "./hamta";

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
const sidFixtur = (namn: string): Response =>
  new Response(readFileSync(path.join(ROT, "booli", namn), "utf-8"), { status: 200 });

const NU = new Date("2026-10-31T12:00:00Z");
const kontext: Kontext = { enhetId: "a".repeat(22), principalId: null, ipHash: "ip-hash-1" };
const CALLER = "binfo-caller-test";
const NYCKEL = "hemlig-privat-nyckel";

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

function utan(e: Env, ...nycklar: Array<keyof Env>): Env {
  const kopia: Partial<Env> = { ...e };
  for (const n of nycklar) delete kopia[n];
  return kopia as Env;
}

let konto: FakeKontoDatabas;
let varna: MockInstance<typeof console.warn>;

function anropare(): Anropare {
  return { kontext, konto, behorighet: skapaBehorighet(STANDARD_POLICY) };
}

function fakeFetch(...svar: Array<Response | Error | (() => Promise<Response>)>) {
  const anrop: URL[] = [];
  const kopia = [...svar];
  const f = vi.fn(async (url: string | URL | Request) => {
    anrop.push(new URL(String(url)));
    const nasta = kopia.shift();
    if (nasta === undefined) throw new Error("oväntat extra anrop");
    if (nasta instanceof Error) throw nasta;
    return typeof nasta === "function" ? nasta() : nasta;
  });
  return {
    f: f as unknown as typeof fetch,
    anrop,
    api: () => anrop.filter((u) => u.host === "api.booli.se").map((u) => u.pathname),
    sida: () => anrop.filter((u) => u.host === "www.booli.se").map((u) => u.href),
  };
}

function kor(url: string, f: typeof fetch, e: Env = env(), extra: object = {}) {
  return hamtaAnnons(
    { url },
    {
      anropare: anropare(),
      env: e,
      fetch: f,
      nu: () => NU,
      unik: () => "0123456789abcdef",
      ...extra,
    },
  );
}

function kvotTotalt(): number {
  return [...konto.kvot.values()].reduce((s, r) => s + r.antal, 0);
}

function loggade(handelse: string): unknown[][] {
  return varna.mock.calls.filter((c) => c[0] === `[annons] ${handelse}`);
}

beforeEach(() => {
  konto = skapaFakeKontoDatabas({ nu: () => NU });
  varna = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  // Nothing logged may ever hold the keys or a request hash.
  const logg = JSON.stringify(varna.mock.calls);
  expect(logg).not.toContain(CALLER);
  expect(logg).not.toContain(NYCKEL);
  expect(logg).not.toMatch(/hash=|callerId=|\b[0-9a-f]{40}\b/);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("API-vägen för /annons/<id>", () => {
  it("aktiv annons: listings + areas, metod api, postnummer från Booli (annons), cachad", async () => {
    const h = fakeFetch(apiFixtur("listings-6332006.json"), apiFixtur("areas-6332006.json"));
    const r = await kor("https://www.booli.se/annons/6332006", h.f);
    expect(r).toMatchObject({
      ok: true,
      kalla: "booli",
      url: "https://www.booli.se/annons/6332006",
      metod: "api",
      tolkning: "struktur",
      postnummerKalla: "annons",
      hamtad: NU.toISOString(),
    });
    if (!r.ok) return;
    expect(r.uppgifter).toMatchObject({
      adress: "Ringvägen 155C",
      postnummer: "116 31",
      ort: "Stockholm",
      boarea: 63,
      antalRum: 2,
      manadsavgift: 3537,
      utgangspris: 6_395_000,
      vaning: 2,
      byggar: 1928,
      hiss: "ja",
      balkong: "ja",
    });
    expect(r.uppgifter.forening).toBeUndefined();
    expect(r.uppgifter.maklarUrl).toBeUndefined();
    expect(r.status.postnummer).toBe("hittad");
    expect(h.api()).toEqual(["/listings/6332006", "/areas"]);
    expect(h.sida()).toEqual([]);
    expect(konto.annonsCache.get("https://www.booli.se/annons/6332006")?.svar).toEqual(r);
    expect(kvotTotalt()).toBe(2); // one use per key (device and IP)
    expect(varna).not.toHaveBeenCalled();
  });

  it("såld annons: listings 404 → sold, utgångspriset är listPrice, postnumret från raden", async () => {
    const h = fakeFetch(apiFixtur("listings-6309077.json"), apiFixtur("sold-6309077.json"));
    const r = await kor("https://www.booli.se/annons/6309077", h.f);
    expect(r).toMatchObject({ ok: true, metod: "api", postnummerKalla: "annons" });
    if (r.ok) {
      expect(r.uppgifter).toMatchObject({
        adress: "Sankt Eriksgatan 65",
        postnummer: "113 32",
        utgangspris: 4_995_000,
        hiss: "ja",
        balkong: "nej",
      });
    }
    expect(h.api()).toEqual(["/listings/6309077", "/sold/6309077"]);
  });

  it("andra hämtningen är en cacheträff: noll anrop", async () => {
    const h = fakeFetch(apiFixtur("listings-6332006.json"), apiFixtur("areas-6332006.json"));
    const forsta = await kor("https://www.booli.se/annons/6332006", h.f);
    const andra = await kor("https://booli.se/annons/6332006/?utm=x", h.f);
    expect(andra).toEqual(forsta);
    expect(h.anrop).toHaveLength(2);
    expect(kvotTotalt()).toBe(2);
  });

  it("finns varken aktiv eller såld: hittades_inte, sidan prövas inte ens när den är på", async () => {
    const h = fakeFetch(
      new Response('{"listings":[]}', { status: 404 }),
      new Response('{"sold":[]}', { status: 200 }),
    );
    const r = await kor("https://www.booli.se/annons/1", h.f, env({ annonsSidhamtning: true }));
    expect(r).toEqual({
      ok: false,
      errorCode: "hittades_inte",
      errorMessage: ANNONS_MEDDELANDE.allmant,
    });
    expect(h.sida()).toEqual([]);
    expect(loggade("hittades inte")[0]![1]).toMatchObject({ kalla: "booli_api", anrop: 2 });
    expect(konto.annonsCache.size).toBe(0);
  });

  it("nyckeln avvisas: loggas 'booli-api nyckel avvisad', fyll i manuellt, ingen sidhämtning som standard", async () => {
    const h = fakeFetch(new Response("FAILURE_INVALID_HASH", { status: 403 }));
    const r = await kor("https://www.booli.se/annons/6279984", h.f);
    expect(r).toEqual({ ok: false, errorCode: "natverk", errorMessage: ANNONS_MEDDELANDE.allmant });
    expect(h.api()).toEqual(["/listings/6279984"]);
    expect(h.sida()).toEqual([]);
    expect(loggade("booli-api nyckel avvisad")).toEqual([
      [
        "[annons] booli-api nyckel avvisad",
        {
          url: "https://www.booli.se/annons/6279984",
          kalla: "booli_api",
          orsak: "listings/6279984: http 403 FAILURE_INVALID_HASH",
          anrop: 1,
        },
      ],
    ]);
  });

  it("nyckeln avvisas och ANNONS_SIDHAMTNING=on: sidan hämtas, metod sida", async () => {
    const h = fakeFetch(
      new Response("Unauthorized", { status: 401 }),
      sidFixtur("annons-6279984.html"),
    );
    const r = await kor(
      "https://www.booli.se/annons/6279984",
      h.f,
      env({ annonsSidhamtning: true }),
    );
    expect(r).toMatchObject({ ok: true, metod: "sida", postnummerKalla: "annons" });
    expect(h.api()).toEqual(["/listings/6279984"]);
    expect(h.sida()).toEqual(["https://www.booli.se/annons/6279984"]);
    expect(loggade("api misslyckades, provar sidan")[0]![1]).toMatchObject({
      kalla: "booli_api",
      kod: "nyckel",
    });
  });

  it("timeout på API:t: natverk, loggas med källan", async () => {
    const hanger = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener("abort", () => rej(new Error("aborted")));
        }),
    ) as unknown as typeof fetch;
    const r = kor("https://www.booli.se/annons/6332006", hanger, env(), { apiTidsgransMs: 50 });
    expect(await r).toMatchObject({ ok: false, errorCode: "natverk" });
    expect(loggade("nätverk")[0]![1]).toMatchObject({
      kalla: "booli_api",
      orsak: "listings/6332006: timeout efter 50 ms",
    });
  });
});

describe("/bostad/<id>-länkar går aldrig till API:t", () => {
  it("API på, sidhämtning av: bostadslank, NOLL anrop, ingen kvot", async () => {
    const h = fakeFetch();
    const r = await kor("https://www.booli.se/bostad/720821", h.f);
    expect(r).toEqual({
      ok: false,
      errorCode: "bostadslank",
      errorMessage: ANNONS_MEDDELANDE.bostadslank,
    });
    expect(h.anrop).toHaveLength(0);
    expect(kvotTotalt()).toBe(0);
  });

  it("sidhämtning på: sidan hämtas, fortfarande noll API-anrop", async () => {
    const h = fakeFetch(sidFixtur("bostad-720821.html"));
    const r = await kor(
      "https://www.booli.se/bostad/720821",
      h.f,
      env({ annonsSidhamtning: true }),
    );
    expect(r).toMatchObject({ ok: true, metod: "sida" });
    expect(h.api()).toEqual([]);
    expect(h.sida()).toEqual(["https://www.booli.se/bostad/720821"]);
  });
});

describe("API:t avstängt eller utan nycklar", () => {
  for (const [namn, e] of [
    ["BOOLI_API=off", env({ booliApiAvstangd: true })],
    ["nycklar saknas", utan(env(), "booliCallerId", "booliPrivateKey")],
    ["bara en nyckel", utan(env(), "booliPrivateKey")],
  ] as const) {
    it(`${namn}: inga API-anrop; utan sidhämtning avstangd utan kvot, med sidhämtning sidan`, async () => {
      const utan = fakeFetch();
      expect(await kor("https://www.booli.se/annons/6279984", utan.f, e)).toEqual({
        ok: false,
        errorCode: "avstangd",
        errorMessage: ANNONS_MEDDELANDE.avstangd,
      });
      expect(utan.anrop).toHaveLength(0);
      expect(kvotTotalt()).toBe(0);

      const med = fakeFetch(sidFixtur("annons-6279984.html"));
      const r = await kor("https://www.booli.se/annons/6279984", med.f, {
        ...e,
        annonsSidhamtning: true,
      });
      expect(r).toMatchObject({ ok: true, metod: "sida" });
      expect(med.api()).toEqual([]);
    });
  }

  it("ANNONS_HAMTNING=off stänger fortfarande av allt", async () => {
    const h = fakeFetch();
    expect(
      await kor("https://www.booli.se/annons/6332006", h.f, env({ annonsHamtningAvstangd: true })),
    ).toMatchObject({ ok: false, errorCode: "avstangd" });
    expect(h.anrop).toHaveLength(0);
  });
});

describe("cache-rader från före API:t", () => {
  it("en rad utan metod (sidan, hiss bara 'ja') tolkas fortfarande och serveras utan anrop", async () => {
    const url = "https://www.booli.se/annons/6279984";
    const gammal = {
      ok: true,
      kalla: "booli",
      url,
      uppgifter: { adress: "Torsvikssvängen 39", postnummer: "181 34", hiss: "ja" },
      status: {
        boarea: "saknas",
        antalRum: "saknas",
        manadsavgift: "saknas",
        postnummer: "hittad",
        vaning: "saknas",
        byggar: "saknas",
        utgangspris: "saknas",
        hiss: "hittad",
        balkong: "saknas",
        adress: "hittad",
        ort: "saknas",
      },
      postnummerKalla: "annons",
      tolkning: "struktur",
      hamtad: "2026-10-31T06:00:00.000Z",
    };
    await konto.skrivAnnonsCache(url, gammal);
    const h = fakeFetch();
    expect(await kor(url, h.f)).toEqual(gammal);
    expect(h.anrop).toHaveLength(0);
  });

  it("ett API-svar med hiss/balkong 'nej' går att cacha och läsa tillbaka", async () => {
    const h = fakeFetch(apiFixtur("listings-6331911.json"), apiFixtur("areas-6331911.json"));
    const r = await kor("https://www.booli.se/annons/6331911", h.f);
    expect(r).toMatchObject({ ok: true, uppgifter: { hiss: "nej", balkong: "nej" } });
    expect(await kor("https://www.booli.se/annons/6331911", fakeFetch().f)).toEqual(r);
  });
});
