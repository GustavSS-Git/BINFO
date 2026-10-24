/**
 * hamtaAnnons against a fake fetch, a fake account store and MOCKED url/parser
 * modules (those have their own tests; the real parser runs against the
 * recorded pages in hamta.fixtures.test.ts).
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { ANNONS_FALT, ANNONS_MEDDELANDE, type AnnonsUppgifter } from "@/lib/annons/typer";
import type { AnthropicClientLike } from "@/lib/analysis/runExtraction";
import { skapaFakeKontoDatabas, type FakeKontoDatabas } from "../__fakes__/konto";
import { skapaFakeLager } from "../__fakes__/lager";
import { STANDARD_POLICY, skapaBehorighet, type Policy } from "../behorighet";
import type { Env } from "../env";
import type { Kontext } from "../kontext";
import { kvotNyckel } from "../kvot";
import type { Anropare } from "../portar";
import type { GeokodUtfall } from "./geokod";
import type { AnnonsLlmUtfall } from "./llmFallback";

const tillstand = vi.hoisted(() => ({
  tolka: null as null | ((html: string, url: string) => unknown),
  anrop: [] as Array<{ html: string; url: string }>,
}));

vi.mock("./booli", () => ({
  tolkaBooli: (html: string, url: string) => {
    tillstand.anrop.push({ html, url });
    if (!tillstand.tolka) throw new Error("tolkaBooli: inget svar inställt i testet");
    return tillstand.tolka(html, url);
  },
}));

// A tiny stand-in with the same contract as src/lib/annons/url.ts.
vi.mock("@/lib/annons/url", () => ({
  kontrolleraAnnonsUrl: (ratt: string) => {
    const m = /^https:\/\/(?:www\.)?booli\.se\/(bostad|annons)\/(\d{1,12})\/?(?:[?#].*)?$/.exec(
      ratt.trim(),
    );
    if (m) return { ok: true, url: `https://www.booli.se/${m[1]}/${m[2]}`, typ: m[1], id: m[2] };
    if (/^https?:\/\/(?:www\.)?booli\.se(\/|$)/.test(ratt.trim()))
      return { ok: false, errorCode: "ogiltig_url" };
    return { ok: false, errorCode: "fel_doman" };
  },
}));

const { hamtaAnnons, BOOLI_FETCH_HEADERS, ANNONS_MAX_KROPP_BYTES } = await import("./hamta");

const NU = new Date("2026-10-24T12:00:00Z");
const URL_A = "https://www.booli.se/bostad/720821";
const HTML = "<html><body>annons</body></html>";

const FULLA: AnnonsUppgifter = {
  adress: "Sankt Eriksgatan 31A",
  postnummer: "112 39",
  ort: "Stockholm",
  utgangspris: 5_200_000,
  manadsavgift: 3900,
  boarea: 54,
  antalRum: 2,
  vaning: 3,
  byggar: 1932,
  hiss: "ja",
  forening: "Brf Exempel",
  koordinater: { lat: 59.3326, lon: 18.0311 },
};

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
    ...over,
  };
}

const kontext: Kontext = { enhetId: "a".repeat(22), principalId: null, ipHash: "ip-hash-1" };

let konto: FakeKontoDatabas;
let nuTid: Date;

function anropare(policy?: Partial<Policy>, k: Kontext = kontext): Anropare {
  return {
    kontext: k,
    konto,
    behorighet: skapaBehorighet({ ...STANDARD_POLICY, ...policy }),
  };
}

function svarHtml(html = HTML, init: ResponseInit = {}): Response {
  return new Response(html, { status: 200, headers: { "content-type": "text/html" }, ...init });
}

interface Fetchanrop {
  url: string;
  init: RequestInit | undefined;
}

function fakeFetch(...svar: Array<Response | Error | (() => Promise<Response>)>) {
  const anrop: Fetchanrop[] = [];
  const kopia = [...svar];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    anrop.push({ url: String(url), init });
    const nasta = kopia.shift();
    if (nasta === undefined) throw new Error("oväntat extra anrop");
    if (nasta instanceof Error) throw nasta;
    return typeof nasta === "function" ? nasta() : nasta;
  });
  return { f: f as unknown as typeof fetch, anrop };
}

function ok(uppgifter: AnnonsUppgifter = FULLA) {
  tillstand.tolka = () => ({
    typ: "ok",
    uppgifter,
    saknas: ANNONS_FALT.filter((f) => uppgifter[f] === undefined),
  });
}

function kvotTotalt(): number {
  return [...konto.kvot.values()].reduce((s, r) => s + r.antal, 0);
}

let varna: MockInstance<typeof console.warn>;
function loggade(handelse: string): unknown[][] {
  return varna.mock.calls.filter((c) => c[0] === `[annons] ${handelse}`);
}

beforeEach(() => {
  nuTid = new Date(NU);
  konto = skapaFakeKontoDatabas({ nu: () => nuTid });
  tillstand.tolka = null;
  tillstand.anrop.length = 0;
  varna = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function kor(
  data: unknown,
  fetchMock: typeof fetch,
  extra: Partial<Parameters<typeof hamtaAnnons>[1]> = {},
) {
  return hamtaAnnons(data, {
    anropare: anropare(),
    env: env(),
    fetch: fetchMock,
    nu: () => nuTid,
    ...extra,
  });
}

// ---------------------------------------------------------------------------

describe("indata, avstängning och URL-kontroll (inget nätverk, ingen kvot)", () => {
  it("indata som inte är { url: string } är ogiltig_url", async () => {
    const { f, anrop } = fakeFetch();
    for (const d of [
      null,
      undefined,
      "x",
      5,
      {},
      { url: 5 },
      { url: URL_A, extra: 1 },
      { url: "x".repeat(501) },
    ]) {
      const r = await kor(d, f);
      expect(r).toEqual({
        ok: false,
        errorCode: "ogiltig_url",
        errorMessage: ANNONS_MEDDELANDE.ogiltig_url,
      });
    }
    expect(anrop).toHaveLength(0);
    expect(kvotTotalt()).toBe(0);
  });

  it("ANNONS_HAMTNING=off ger avstangd före allt annat", async () => {
    const { f, anrop } = fakeFetch();
    const r = await kor({ url: URL_A }, f, { env: env({ annonsHamtningAvstangd: true }) });
    expect(r).toEqual({
      ok: false,
      errorCode: "avstangd",
      errorMessage: ANNONS_MEDDELANDE.avstangd,
    });
    expect(anrop).toHaveLength(0);
    expect(kvotTotalt()).toBe(0);
  });

  it("standard (ingen flagga satt) är på", async () => {
    ok();
    const { f } = fakeFetch(svarHtml());
    expect((await kor({ url: URL_A }, f)).ok).toBe(true);
  });

  it("fel domän och ogiltig länk hämtar aldrig något och tar ingen kvot", async () => {
    const { f, anrop } = fakeFetch();
    expect(await kor({ url: "https://www.hemnet.se/bostad/1" }, f)).toEqual({
      ok: false,
      errorCode: "fel_doman",
      errorMessage: ANNONS_MEDDELANDE.fel_doman,
    });
    expect(await kor({ url: "https://www.booli.se/sok/slutpriser" }, f)).toEqual({
      ok: false,
      errorCode: "ogiltig_url",
      errorMessage: ANNONS_MEDDELANDE.ogiltig_url,
    });
    expect(anrop).toHaveLength(0);
    expect(kvotTotalt()).toBe(0);
    expect(tillstand.anrop).toHaveLength(0);
  });
});

describe("cache", () => {
  async function fyllCache() {
    ok();
    const { f } = fakeFetch(svarHtml());
    const forsta = await kor({ url: URL_A }, f);
    expect(forsta.ok).toBe(true);
    return forsta;
  }

  it("en färsk träff returneras utan kvot, utan hämtning och utan tolkning", async () => {
    const forsta = await fyllCache();
    const kvotFore = kvotTotalt();
    tillstand.anrop.length = 0;
    nuTid = new Date(NU.getTime() + 23 * 60 * 60 * 1000);
    const { f, anrop } = fakeFetch();
    const igen = await kor({ url: URL_A }, f);
    expect(igen).toEqual(forsta);
    expect(anrop).toHaveLength(0);
    expect(tillstand.anrop).toHaveLength(0);
    expect(kvotTotalt()).toBe(kvotFore);
  });

  it("träffen behåller sin ursprungliga hamtad-tid", async () => {
    await fyllCache();
    nuTid = new Date(NU.getTime() + 60 * 60 * 1000);
    const { f } = fakeFetch();
    const igen = await kor({ url: URL_A }, f);
    expect(igen.ok && igen.hamtad).toBe(NU.toISOString());
  });

  it("cachen nycklas på den kanoniska länken (sökfrågor och slutsnedstreck ger samma träff)", async () => {
    await fyllCache();
    const { f, anrop } = fakeFetch();
    const igen = await kor({ url: "https://booli.se/bostad/720821/?utm_source=x#bilder" }, f);
    expect(igen.ok).toBe(true);
    expect(anrop).toHaveLength(0);
  });

  it("en 25 timmar gammal rad är gammal: sidan hämtas på nytt och raden skrivs om", async () => {
    await fyllCache();
    nuTid = new Date(NU.getTime() + 25 * 60 * 60 * 1000);
    ok({ ...FULLA, utgangspris: 5_000_000 });
    const { f, anrop } = fakeFetch(svarHtml());
    const igen = await kor({ url: URL_A }, f);
    expect(anrop).toHaveLength(1);
    expect(igen.ok && igen.uppgifter.utgangspris).toBe(5_000_000);
    expect(konto.annonsCache.get(URL_A)?.hamtad).toBe(nuTid.toISOString());
  });

  it("en rad som inte går att tolka ignoreras", async () => {
    for (const skräp of [
      { ok: true },
      "text",
      null,
      { ok: true, kalla: "booli", url: URL_A, extra: 1 },
    ]) {
      konto.annonsCache.set(URL_A, { svar: skräp, hamtad: nuTid.toISOString() });
      ok();
      const { f, anrop } = fakeFetch(svarHtml());
      const r = await kor({ url: URL_A }, f);
      expect(r.ok).toBe(true);
      expect(anrop).toHaveLength(1);
    }
  });

  it("ett cachefel vid läsning behandlas som en miss (cachen är en bekvämlighet)", async () => {
    konto.lasAnnonsCache = async () => {
      throw new Error("db nere");
    };
    ok();
    const { f, anrop } = fakeFetch(svarHtml());
    expect((await kor({ url: URL_A }, f)).ok).toBe(true);
    expect(anrop).toHaveLength(1);
    expect(loggade("cache-lasning misslyckades")).toHaveLength(1);
  });

  it("ett cachefel vid skrivning loggas men fäller aldrig svaret", async () => {
    konto.skrivAnnonsCache = async () => {
      throw new Error("db nere");
    };
    ok();
    const { f } = fakeFetch(svarHtml());
    expect((await kor({ url: URL_A }, f)).ok).toBe(true);
    expect(loggade("cache-skrivning misslyckades")).toHaveLength(1);
  });

  it("bara lyckade svar cachas", async () => {
    const fall: Array<Response | Error> = [
      new Response("nej", { status: 404 }),
      new Response("nej", { status: 500 }),
      new Response("utmaning", { status: 403 }),
      new TypeError("fetch failed"),
    ];
    for (const svar of fall) {
      const { f } = fakeFetch(svar);
      expect((await kor({ url: URL_A }, f)).ok).toBe(false);
    }
    tillstand.tolka = () => ({ typ: "tolkning_misslyckad", orsak: "x", delvis: {} });
    expect((await kor({ url: URL_A }, fakeFetch(svarHtml()).f)).ok).toBe(false);
    tillstand.tolka = () => ({ typ: "blockerad" });
    expect((await kor({ url: URL_A }, fakeFetch(svarHtml()).f)).ok).toBe(false);
    expect(konto.annonsCache.size).toBe(0);

    ok();
    expect((await kor({ url: URL_A }, fakeFetch(svarHtml()).f)).ok).toBe(true);
    expect(konto.annonsCache.size).toBe(1);
  });
});

describe("behörighet och kvot", () => {
  it("nekad behörighet: inget nätverk, ingen kvot, köparsäker text", async () => {
    const { f, anrop } = fakeFetch();
    const r = await kor({ url: URL_A }, f, { anropare: anropare({ hamta_annons: () => false }) });
    expect(r).toEqual({
      ok: false,
      errorCode: "behorighet",
      errorMessage: "Du har inte tillgång till den här funktionen just nu.",
    });
    expect(anrop).toHaveLength(0);
    expect(kvotTotalt()).toBe(0);
  });

  it("en regel som kastar beviljar inte: fail closed, svaret är natverk", async () => {
    const { f, anrop } = fakeFetch();
    const r = await kor({ url: URL_A }, f, {
      anropare: anropare({
        hamta_annons: () => {
          throw new Error("db nere");
        },
      }),
    });
    expect(r).toMatchObject({ ok: false, errorCode: "natverk" });
    expect(anrop).toHaveLength(0);
  });

  it("cache-träff kräver varken behörighet eller kvot", async () => {
    ok();
    await kor({ url: URL_A }, fakeFetch(svarHtml()).f);
    const { f, anrop } = fakeFetch();
    const r = await kor({ url: URL_A }, f, { anropare: anropare({ hamta_annons: () => false }) });
    expect(r.ok).toBe(true);
    expect(anrop).toHaveLength(0);
  });

  it("enhetens 21:a hämtning på en timme nekas med kvotsvaret, utan hämtning", async () => {
    ok();
    for (let i = 0; i < 20; i++) {
      // Distinct URLs so the cache doesn't answer; distinct IPs so only the device limit bites.
      const k: Kontext = { ...kontext, ipHash: `ip-${i}` };
      const { f } = fakeFetch(svarHtml());
      expect(
        (
          await kor({ url: `https://www.booli.se/bostad/${1000 + i}` }, f, {
            anropare: anropare(undefined, k),
          })
        ).ok,
      ).toBe(true);
    }
    const { f, anrop } = fakeFetch();
    const r = await kor({ url: "https://www.booli.se/bostad/9999" }, f, {
      anropare: anropare(undefined, { ...kontext, ipHash: "ip-ny" }),
    });
    expect(r).toEqual({ ok: false, errorCode: "kvot", errorMessage: ANNONS_MEDDELANDE.kvot });
    expect(anrop).toHaveLength(0);
  });

  it("IP-ns 61:a hämtning på en timme nekas även från en ny enhet", async () => {
    ok();
    for (let i = 0; i < 60; i++) {
      const k: Kontext = {
        enhetId: `enhet-${i}`.padEnd(22, "x"),
        principalId: null,
        ipHash: "samma-ip",
      };
      const { f } = fakeFetch(svarHtml());
      expect(
        (
          await kor({ url: `https://www.booli.se/bostad/${2000 + i}` }, f, {
            anropare: anropare(undefined, k),
          })
        ).ok,
      ).toBe(true);
    }
    const { f, anrop } = fakeFetch();
    const r = await kor({ url: "https://www.booli.se/bostad/9999" }, f, {
      anropare: anropare(undefined, {
        enhetId: "helt-ny".padEnd(22, "x"),
        principalId: null,
        ipHash: "samma-ip",
      }),
    });
    expect(r).toMatchObject({ ok: false, errorCode: "kvot" });
    expect(anrop).toHaveLength(0);
    // The refused call gave the device's use back.
    const enhet = [...konto.kvot.values()].find(
      (q) => q.nyckel === kvotNyckel("annonshamtning", "enhet", "helt-ny".padEnd(22, "x")),
    );
    expect(enhet?.antal ?? 0).toBe(0);
  });

  it("en hämtning tar en användning per nyckel (enhet och IP)", async () => {
    ok();
    await kor({ url: URL_A }, fakeFetch(svarHtml()).f);
    expect([...konto.kvot.values()].map((q) => [q.nyckel, q.antal]).sort()).toEqual(
      [
        [kvotNyckel("annonshamtning", "enhet", kontext.enhetId), 1],
        [kvotNyckel("annonshamtning", "ip", "ip-hash-1"), 1],
      ].sort(),
    );
  });
});

describe("hämtningen", () => {
  it("skickar ETT anrop till den kanoniska länken med webbläsarens header-set, utan Accept-Encoding, redirect manual och en signal", async () => {
    ok();
    const { f, anrop } = fakeFetch(svarHtml());
    await kor({ url: "https://booli.se/bostad/720821?utm=x" }, f);
    expect(anrop).toHaveLength(1);
    expect(anrop[0]!.url).toBe(URL_A);
    expect(anrop[0]!.init?.redirect).toBe("manual");
    expect(anrop[0]!.init?.signal).toBeInstanceOf(AbortSignal);
    expect(anrop[0]!.init?.method).toBe("GET");
    const h = anrop[0]!.init?.headers as Record<string, string>;
    expect(h).toEqual(BOOLI_FETCH_HEADERS);
    const nycklar = Object.keys(h).map((k) => k.toLowerCase());
    expect(nycklar).not.toContain("accept-encoding");
    for (const k of [
      "user-agent",
      "accept",
      "accept-language",
      "sec-ch-ua",
      "sec-ch-ua-mobile",
      "sec-ch-ua-platform",
      "sec-fetch-dest",
      "sec-fetch-mode",
      "sec-fetch-site",
      "sec-fetch-user",
      "upgrade-insecure-requests",
    ]) {
      expect(nycklar).toContain(k);
    }
    expect(h["accept-language"]).toBe("sv-SE,sv;q=0.9,en;q=0.8");
    expect(h["sec-ch-ua-mobile"]).toBe("?0");
    expect(h["sec-ch-ua-platform"]).toBe('"macOS"');
    expect(h["user-agent"]).toContain("Chrome/130");
    expect(tillstand.anrop[0]).toEqual({ html: HTML, url: URL_A });
  });

  it("HTTP 500: natverk, exakt ett anrop (inget omförsök), orsaken loggas", async () => {
    const { f, anrop } = fakeFetch(new Response("fel", { status: 500 }));
    const r = await kor({ url: URL_A }, f);
    expect(r).toEqual({ ok: false, errorCode: "natverk", errorMessage: ANNONS_MEDDELANDE.allmant });
    expect(anrop).toHaveLength(1);
    expect(loggade("nätverk")).toEqual([["[annons] nätverk", { url: URL_A, orsak: "http 500" }]]);
  });

  it("nätverksfel: natverk, ett anrop", async () => {
    const { f, anrop } = fakeFetch(new TypeError("fetch failed"));
    expect(await kor({ url: URL_A }, f)).toMatchObject({ ok: false, errorCode: "natverk" });
    expect(anrop).toHaveLength(1);
    expect(loggade("nätverk")[0]![1]).toMatchObject({ url: URL_A, orsak: "fetch failed" });
  });

  it("avbryts efter 10 s", async () => {
    vi.useFakeTimers();
    const hangande = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener("abort", () =>
            rej(new DOMException("avbruten", "AbortError")),
          );
        }),
    ) as unknown as typeof fetch;
    ok();
    const p = kor({ url: URL_A }, hangande);
    await vi.advanceTimersByTimeAsync(9_999);
    let klar = false;
    void p.then(() => (klar = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(klar).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toMatchObject({ ok: false, errorCode: "natverk" });
    expect(hangande).toHaveBeenCalledTimes(1);
    expect(loggade("nätverk")[0]![1]).toMatchObject({ orsak: "timeout efter 10000 ms" });
  });

  it("tidsgränsen gäller också när kroppen hänger", async () => {
    vi.useFakeTimers();
    const f = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(ctrl) {
              init?.signal?.addEventListener("abort", () =>
                ctrl.error(new DOMException("avbruten", "AbortError")),
              );
            },
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const p = kor({ url: URL_A }, f);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await p).toMatchObject({ ok: false, errorCode: "natverk" });
  });

  it("404 och 410: hittades_inte", async () => {
    for (const status of [404, 410]) {
      const { f, anrop } = fakeFetch(new Response("saknas", { status }));
      expect(await kor({ url: URL_A }, f)).toEqual({
        ok: false,
        errorCode: "hittades_inte",
        errorMessage: ANNONS_MEDDELANDE.allmant,
      });
      expect(anrop).toHaveLength(1);
    }
    expect(loggade("hittades inte")).toHaveLength(2);
  });

  it("403, 503 och cf-mitigated: blockerad (loggas), ingen omgång", async () => {
    const fall = [
      new Response("Just a moment...", { status: 403, headers: { "cf-mitigated": "challenge" } }),
      new Response("x", { status: 403 }),
      new Response("x", { status: 503 }),
      new Response("x", { status: 200, headers: { "cf-mitigated": "challenge" } }),
    ];
    for (const svar of fall) {
      const { f, anrop } = fakeFetch(svar);
      expect(await kor({ url: URL_A }, f)).toEqual({
        ok: false,
        errorCode: "blockerad",
        errorMessage: ANNONS_MEDDELANDE.allmant,
      });
      expect(anrop).toHaveLength(1);
    }
    expect(loggade("blockerad")).toHaveLength(4);
    expect(tillstand.anrop).toHaveLength(0);
  });

  it("en utmaningssida med status 200 som parsern känner igen är blockerad", async () => {
    tillstand.tolka = () => ({ typ: "blockerad" });
    const { f } = fakeFetch(svarHtml("<title>Just a moment...</title>"));
    expect(await kor({ url: URL_A }, f)).toMatchObject({ ok: false, errorCode: "blockerad" });
    expect(loggade("blockerad")).toHaveLength(1);
  });

  it("loggar aldrig sidans HTML", async () => {
    tillstand.tolka = () => ({ typ: "tolkning_misslyckad", orsak: "ingen Listing", delvis: {} });
    const { f } = fakeFetch(svarHtml("<html>HEMLIGT-INNEHALL</html>"));
    await kor({ url: URL_A }, f);
    expect(JSON.stringify(varna.mock.calls)).not.toContain("HEMLIGT-INNEHALL");
  });

  describe("omdirigeringar", () => {
    it("till en annan värd: hittades_inte, inget andra anrop", async () => {
      const { f, anrop } = fakeFetch(
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example.com/bostad/1" },
        }),
      );
      expect(await kor({ url: URL_A }, f)).toMatchObject({ ok: false, errorCode: "hittades_inte" });
      expect(anrop).toHaveLength(1);
      expect(loggade("hittades inte")[0]![1]).toMatchObject({
        orsak: expect.stringContaining("omdirigering"),
      });
    });

    it("till en annan sida på Booli som inte är en annons: hittades_inte", async () => {
      const { f, anrop } = fakeFetch(
        new Response(null, { status: 301, headers: { location: "/sok/slutpriser" } }),
      );
      expect(await kor({ url: URL_A }, f)).toMatchObject({ ok: false, errorCode: "hittades_inte" });
      expect(anrop).toHaveLength(1);
    });

    it("till en annan giltig Booli-annons följs EN gång (relativ Location, kanoniserad)", async () => {
      ok();
      const { f, anrop } = fakeFetch(
        new Response(null, { status: 301, headers: { location: "/annons/6279984?x=1" } }),
        svarHtml(),
      );
      const r = await kor({ url: URL_A }, f);
      expect(r.ok).toBe(true);
      expect(anrop.map((a) => a.url)).toEqual([URL_A, "https://www.booli.se/annons/6279984"]);
      expect(anrop[1]!.init?.redirect).toBe("manual");
      expect(anrop[1]!.init?.signal).toBe(anrop[0]!.init?.signal);
      // The answer and the cache key stay the URL the buyer asked for.
      expect(r.ok && r.url).toBe(URL_A);
      expect(konto.annonsCache.has(URL_A)).toBe(true);
    });

    it("en andra omdirigering följs inte: natverk, två anrop som mest", async () => {
      const { f, anrop } = fakeFetch(
        new Response(null, { status: 301, headers: { location: "/annons/1" } }),
        new Response(null, { status: 301, headers: { location: "/annons/2" } }),
      );
      expect(await kor({ url: URL_A }, f)).toMatchObject({ ok: false, errorCode: "natverk" });
      expect(anrop).toHaveLength(2);
    });

    it("3xx utan Location: natverk", async () => {
      const { f } = fakeFetch(new Response(null, { status: 302 }));
      expect(await kor({ url: URL_A }, f)).toMatchObject({ ok: false, errorCode: "natverk" });
    });
  });

  describe("kroppens storlek", () => {
    it("en kropp över 3 MB (utan Content-Length) avbryts: natverk, ingen tolkning", async () => {
      const bit = new Uint8Array(512 * 1024).fill(97);
      let skickade = 0;
      const kropp = new ReadableStream<Uint8Array>({
        pull(ctrl) {
          if (skickade >= 20) return ctrl.close();
          skickade++;
          ctrl.enqueue(bit);
        },
      });
      const { f } = fakeFetch(new Response(kropp, { status: 200 }));
      const r = await kor({ url: URL_A }, f);
      expect(r).toMatchObject({ ok: false, errorCode: "natverk" });
      expect(tillstand.anrop).toHaveLength(0);
      expect(skickade).toBeLessThan(20);
      expect(loggade("nätverk")[0]![1]).toMatchObject({ orsak: "sidan är större än 3 MB" });
      expect(ANNONS_MAX_KROPP_BYTES).toBe(3 * 1024 * 1024);
    });

    it("en deklarerad Content-Length över 3 MB avvisas direkt", async () => {
      const { f } = fakeFetch(
        new Response("liten", {
          status: 200,
          headers: { "content-length": String(4 * 1024 * 1024) },
        }),
      );
      expect(await kor({ url: URL_A }, f)).toMatchObject({ ok: false, errorCode: "natverk" });
      expect(tillstand.anrop).toHaveLength(0);
    });

    it("en sida strax under taket läses (flerbyte-tecken delas inte sönder)", async () => {
      ok();
      const html = "å".repeat(1000) + "x".repeat(2 * 1024 * 1024);
      const { f } = fakeFetch(svarHtml(html));
      expect((await kor({ url: URL_A }, f)).ok).toBe(true);
      expect(tillstand.anrop[0]!.html).toBe(html);
    });
  });
});

describe("tolkning och delresultat", () => {
  it("ett lyckat svar: uppgifter, status per fält, postnummerKalla annons, tolkning struktur, hamtad", async () => {
    ok();
    const r = await kor({ url: URL_A }, fakeFetch(svarHtml()).f);
    expect(r).toEqual({
      ok: true,
      kalla: "booli",
      url: URL_A,
      uppgifter: FULLA,
      status: {
        boarea: "hittad",
        antalRum: "hittad",
        manadsavgift: "hittad",
        postnummer: "hittad",
        vaning: "hittad",
        byggar: "hittad",
        utgangspris: "hittad",
        hiss: "hittad",
        balkong: "saknas",
        adress: "hittad",
        ort: "hittad",
      },
      postnummerKalla: "annons",
      tolkning: "struktur",
      hamtad: NU.toISOString(),
    });
    expect(loggade("kärnfält saknas, sidans layout kan ha ändrats")).toHaveLength(0);
  });

  it("saknade fält är saknas i statusen, aldrig gissade", async () => {
    ok({
      adress: "A 1",
      postnummer: "111 22",
      ort: "Stockholm",
      boarea: 50,
      antalRum: 2,
      vaning: 1,
      byggar: 1990,
    });
    const r = await kor({ url: URL_A }, fakeFetch(svarHtml()).f);
    expect(r.ok && r.status.utgangspris).toBe("saknas");
    expect(r.ok && r.status.manadsavgift).toBe("saknas");
    expect(r.ok && "utgangspris" in r.uppgifter).toBe(false);
  });

  it("ett kärnfält som saknas på en lyckad tolkning loggas (layoutförändring)", async () => {
    ok({ adress: "A 1", postnummer: "111 22", ort: "Stockholm", boarea: 50, antalRum: 2 });
    await kor({ url: URL_A }, fakeFetch(svarHtml()).f);
    expect(loggade("kärnfält saknas, sidans layout kan ha ändrats")).toEqual([
      [
        "[annons] kärnfält saknas, sidans layout kan ha ändrats",
        { url: URL_A, saknas: ["vaning", "byggar"], tolkning: "struktur" },
      ],
    ]);
  });

  it("tolkning_misslyckad utan några formulärfält: tolkning (loggas med orsak), ingenting cachas", async () => {
    tillstand.tolka = () => ({
      typ: "tolkning_misslyckad",
      orsak: "Listing-objektet saknas",
      delvis: { forening: "Brf X" },
    });
    const r = await kor({ url: URL_A }, fakeFetch(svarHtml()).f);
    expect(r).toEqual({
      ok: false,
      errorCode: "tolkning",
      errorMessage: ANNONS_MEDDELANDE.allmant,
    });
    expect(loggade("tolkning misslyckades")).toEqual([
      ["[annons] tolkning misslyckades", { url: URL_A, orsak: "Listing-objektet saknas" }],
    ]);
    expect(konto.annonsCache.size).toBe(0);
  });

  it("tolkning_misslyckad med minst ett formulärfält: ett delvis resultat (struktur), loggas", async () => {
    tillstand.tolka = () => ({
      typ: "tolkning_misslyckad",
      orsak: "Listing-objektet saknas",
      delvis: { adress: "Sankt Eriksgatan 31A", postnummer: "112 39", utgangspris: 5_200_000 },
    });
    const r = await kor({ url: URL_A }, fakeFetch(svarHtml()).f);
    expect(r).toMatchObject({
      ok: true,
      tolkning: "struktur",
      postnummerKalla: "annons",
      uppgifter: { adress: "Sankt Eriksgatan 31A", postnummer: "112 39", utgangspris: 5_200_000 },
    });
    expect(r.ok && r.status.boarea).toBe("saknas");
    expect(r.ok && r.status.adress).toBe("hittad");
    expect(loggade("delvis resultat")).toHaveLength(1);
    expect(loggade("delvis resultat")[0]![1]).toMatchObject({
      url: URL_A,
      fält: ["postnummer", "utgangspris", "adress"].sort(
        (a, b) => ANNONS_FALT.indexOf(a as never) - ANNONS_FALT.indexOf(b as never),
      ),
    });
  });

  it("om parsern kastar blir svaret tolkning, inte ett undantag", async () => {
    tillstand.tolka = () => {
      throw new Error("oväntad struktur");
    };
    expect(await kor({ url: URL_A }, fakeFetch(svarHtml()).f)).toMatchObject({
      ok: false,
      errorCode: "tolkning",
    });
    expect(loggade("tolkning misslyckades")[0]![1]).toMatchObject({
      orsak: "undantag: oväntad struktur",
    });
  });

  it("ett oväntat undantag någon annanstans (kvotlagret) blir natverk och loggas, aldrig ett kast", async () => {
    konto.taKvot = async () => {
      throw new Error("rpc nere");
    };
    const r = await kor({ url: URL_A }, fakeFetch(svarHtml()).f);
    expect(r).toEqual({ ok: false, errorCode: "natverk", errorMessage: ANNONS_MEDDELANDE.allmant });
    expect(loggade("oväntat fel")).toEqual([["[annons] oväntat fel", { orsak: "rpc nere" }]]);
  });
});

describe("postnummer via geokodning", () => {
  const utanPostnummer: AnnonsUppgifter = { ...FULLA };
  delete utanPostnummer.postnummer;

  it("anropas inte när sidan har postnumret", async () => {
    ok();
    const geokoda = vi.fn();
    await kor({ url: URL_A }, fakeFetch(svarHtml()).f, { geokoda });
    expect(geokoda).not.toHaveBeenCalled();
  });

  it("anropas med koordinater, adress och ort när postnumret saknas; resultatet märks geokodning", async () => {
    ok(utanPostnummer);
    const geokoda = vi.fn(async (): Promise<GeokodUtfall> => ({
      postnummer: "112 39",
      metod: "reverse",
    }));
    const r = await kor({ url: URL_A }, fakeFetch(svarHtml()).f, { geokoda });
    expect(geokoda).toHaveBeenCalledTimes(1);
    expect(geokoda).toHaveBeenCalledWith({
      koordinater: FULLA.koordinater,
      adress: "Sankt Eriksgatan 31A",
      ort: "Stockholm",
    });
    expect(r).toMatchObject({
      ok: true,
      postnummerKalla: "geokodning",
      uppgifter: { postnummer: "112 39" },
    });
    expect(r.ok && r.status.postnummer).toBe("hittad");
    // The cached answer keeps the provenance.
    expect(
      (konto.annonsCache.get(URL_A)?.svar as { postnummerKalla: string }).postnummerKalla,
    ).toBe("geokodning");
    // postnummer is a core field: its absence on the page is still logged.
    expect(loggade("kärnfält saknas, sidans layout kan ha ändrats")[0]![1]).toMatchObject({
      saknas: ["postnummer"],
    });
  });

  it("misslyckad geokodning: postnumret förblir saknas, inget postnummerKalla, loggas", async () => {
    ok(utanPostnummer);
    const geokoda = vi.fn(async (): Promise<GeokodUtfall> => ({
      postnummer: null,
      orsak: "reverse: timeout",
    }));
    const r = await kor({ url: URL_A }, fakeFetch(svarHtml()).f, { geokoda });
    expect(r.ok).toBe(true);
    expect(r.ok && r.status.postnummer).toBe("saknas");
    expect(r.ok && "postnummerKalla" in r).toBe(false);
    expect(r.ok && "postnummer" in r.uppgifter).toBe(false);
    expect(loggade("geokodning gav inget postnummer")).toEqual([
      ["[annons] geokodning gav inget postnummer", { url: URL_A, orsak: "reverse: timeout" }],
    ]);
  });

  it("standardvägen går via den injicerade fetch med Nominatims regler och ett giltigt svar", async () => {
    ok(utanPostnummer);
    const nominatim = JSON.stringify({ address: { postcode: "112 39", house_number: "31" } });
    const { f, anrop } = fakeFetch(svarHtml(), new Response(nominatim, { status: 200 }));
    const r = await kor({ url: URL_A }, f);
    expect(anrop).toHaveLength(2);
    expect(anrop[1]!.url).toContain("https://nominatim.openstreetmap.org/reverse");
    expect((anrop[1]!.init?.headers as Record<string, string>)["user-agent"]).toBe(
      "Binfo/1.0 (+https://binfo.slanesens.com)",
    );
    expect(r).toMatchObject({
      ok: true,
      postnummerKalla: "geokodning",
      uppgifter: { postnummer: "112 39" },
    });
  });
});

describe("modellreserven (ANNONS_LLM_FALLBACK)", () => {
  const delvis: AnnonsUppgifter = { adress: "Sankt Eriksgatan 31A", utgangspris: 5_000_000 };
  const LLM_OK: AnnonsLlmUtfall = {
    typ: "ok",
    uppgifter: {
      adress: "Fel gata 1",
      postnummer: "112 39",
      ort: "Stockholm",
      utgangspris: 1,
      boarea: 54,
      antalRum: 2,
      vaning: 3,
    },
    kostnadSek: 0.06,
    anrop: {
      model: "claude-haiku-4-5",
      inputTokens: 4000,
      outputTokens: 120,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      latencyMs: 900,
      costSek: 0.06,
    },
  };

  beforeEach(() => {
    tillstand.tolka = () => ({ typ: "tolkning_misslyckad", orsak: "ingen Listing", delvis });
  });

  it("av som standard: modellen anropas inte (delvis resultat i stället)", async () => {
    const llm = vi.fn(async () => LLM_OK);
    const r = await kor({ url: URL_A }, fakeFetch(svarHtml()).f, { llm });
    expect(llm).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, tolkning: "struktur" });
  });

  it("flaggan satt men ingen nyckel: modellen anropas inte", async () => {
    const llm = vi.fn(async () => LLM_OK);
    await kor({ url: URL_A }, fakeFetch(svarHtml()).f, {
      llm,
      env: env({ annonsLlmFallback: true, anthropicApiKey: "" }),
    });
    expect(llm).not.toHaveBeenCalled();
  });

  it("på: modellen anropas med sidans HTML, värdena slås ihop och strukturerade värden vinner, tolkning llm, loggas", async () => {
    const llm = vi.fn(async () => LLM_OK);
    const r = await kor({ url: URL_A }, fakeFetch(svarHtml()).f, {
      llm,
      env: env({ annonsLlmFallback: true }),
    });
    expect(llm).toHaveBeenCalledTimes(1);
    expect(llm).toHaveBeenCalledWith(HTML, URL_A);
    expect(r).toMatchObject({
      ok: true,
      tolkning: "llm",
      postnummerKalla: "annons",
      uppgifter: {
        adress: "Sankt Eriksgatan 31A", // structured wins over the model's "Fel gata 1"
        utgangspris: 5_000_000, // structured wins over 1
        postnummer: "112 39",
        boarea: 54,
        antalRum: 2,
        vaning: 3,
      },
    });
    const logg = loggade("llm-fallback");
    expect(logg).toHaveLength(1);
    expect(logg[0]![1]).toMatchObject({
      url: URL_A,
      utfall: "ok",
      kostnadSek: 0.06,
      model: "claude-haiku-4-5",
      inputTokens: 4000,
      outputTokens: 120,
    });
    // An LLM answer is cached like any other success.
    expect((konto.annonsCache.get(URL_A)?.svar as { tolkning: string }).tolkning).toBe("llm");
  });

  it("modellen gav inget: faller tillbaka på det delvisa resultatet (struktur)", async () => {
    const llm = vi.fn(async (): Promise<AnnonsLlmUtfall> => ({
      typ: "ingen",
      orsak: "ogiltigt_svar",
      detalj: "boarea: Number must be",
      kostnadSek: 0.05,
    }));
    const r = await kor({ url: URL_A }, fakeFetch(svarHtml()).f, {
      llm,
      env: env({ annonsLlmFallback: true }),
    });
    expect(r).toMatchObject({ ok: true, tolkning: "struktur", uppgifter: delvis });
    expect(loggade("llm-fallback")[0]![1]).toMatchObject({
      utfall: "ogiltigt_svar",
      kostnadSek: 0.05,
    });
  });

  it("modellen gav inget och inga strukturerade fält finns: tolkning", async () => {
    tillstand.tolka = () => ({ typ: "tolkning_misslyckad", orsak: "x", delvis: {} });
    const llm = vi.fn(async (): Promise<AnnonsLlmUtfall> => ({
      typ: "ingen",
      orsak: "modellfel",
      kostnadSek: 0,
    }));
    const r = await kor({ url: URL_A }, fakeFetch(svarHtml()).f, {
      llm,
      env: env({ annonsLlmFallback: true }),
    });
    expect(r).toMatchObject({ ok: false, errorCode: "tolkning" });
  });

  it("modellen kastar: loggas, faller tillbaka", async () => {
    const llm = vi.fn(async (): Promise<AnnonsLlmUtfall> => {
      throw new Error("sdk-fel");
    });
    const r = await kor({ url: URL_A }, fakeFetch(svarHtml()).f, {
      llm,
      env: env({ annonsLlmFallback: true }),
    });
    expect(r).toMatchObject({ ok: true, tolkning: "struktur" });
    expect(loggade("llm-fallback")[0]![1]).toMatchObject({ utfall: "undantag", orsak: "sdk-fel" });
  });

  it("modellen anropas aldrig för en blockerad sida eller en lyckad tolkning", async () => {
    const llm = vi.fn(async () => LLM_OK);
    tillstand.tolka = () => ({ typ: "blockerad" });
    await kor({ url: URL_A }, fakeFetch(svarHtml()).f, {
      llm,
      env: env({ annonsLlmFallback: true }),
    });
    ok();
    await kor({ url: "https://www.booli.se/bostad/5" }, fakeFetch(svarHtml()).f, {
      llm,
      env: env({ annonsLlmFallback: true }),
    });
    expect(llm).not.toHaveBeenCalled();
  });

  describe("standardkopplingen mot dagstaket", () => {
    function klient(svar: unknown) {
      const create = vi.fn(async () => ({
        usage: { input_tokens: 3000, output_tokens: 100 },
        content: [{ type: "text", text: JSON.stringify(svar) }],
        stop_reason: "end_turn",
      }));
      const k: AnthropicClientLike = {
        messages: { countTokens: vi.fn(async () => ({ input_tokens: 0 })), create },
      };
      return { k, create };
    }
    const sidaMedText = `<html><body>${"Sankt Eriksgatan 31A, 2 rum, 54 kvm, avgift 3900 kr. ".repeat(3)}</body></html>`;

    it("reserverar mot dagstaket, anropar Haiku och stämmer av mot verklig kostnad", async () => {
      const lager = skapaFakeLager();
      const { k, create } = klient({
        adress: null,
        postnummer: null,
        ort: null,
        utgangspris: null,
        manadsavgift: 3900,
        boarea: 54,
        antalRum: 2,
        vaning: null,
        byggar: null,
        hiss: null,
        balkong: null,
        forening: null,
      });
      const r = await kor({ url: URL_A }, fakeFetch(svarHtml(sidaMedText)).f, {
        env: env({ annonsLlmFallback: true }),
        anthropicKlient: k,
        spendDb: lager.db,
      });
      expect(create).toHaveBeenCalledTimes(1);
      expect((create.mock.calls as unknown as Array<[{ model: string }]>)[0]![0].model).toBe(
        "claude-haiku-4-5",
      );
      expect(r).toMatchObject({
        ok: true,
        tolkning: "llm",
        uppgifter: { adress: "Sankt Eriksgatan 31A", manadsavgift: 3900, boarea: 54, antalRum: 2 },
      });
      const dag = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Stockholm",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const spenderat = await lager.db.hamtaSpendForDag(dag);
      // (3000 in * $1 + 100 out * $5) / 1e6 * 9.7 SEK
      expect(spenderat).toBeCloseTo(((3000 * 1 + 100 * 5) / 1_000_000) * 9.7, 6);
    });

    it("dagstaket nått: ingen modell, delvis resultat i stället", async () => {
      const lager = skapaFakeLager();
      const { k, create } = klient({});
      const r = await kor({ url: URL_A }, fakeFetch(svarHtml(sidaMedText)).f, {
        env: env({ annonsLlmFallback: true, maxDailySpendSek: 0.01 }),
        anthropicKlient: k,
        spendDb: lager.db,
      });
      expect(create).not.toHaveBeenCalled();
      expect(r).toMatchObject({ ok: true, tolkning: "struktur" });
      expect(loggade("llm-fallback")[0]![1]).toMatchObject({
        utfall: "daglig_grans",
        kostnadSek: 0,
      });
    });

    it("ANALYSIS_KILL_SWITCH=on stoppar också modellreserven", async () => {
      const lager = skapaFakeLager();
      const { k, create } = klient({});
      await kor({ url: URL_A }, fakeFetch(svarHtml(sidaMedText)).f, {
        env: env({ annonsLlmFallback: true, killSwitchPa: true }),
        anthropicKlient: k,
        spendDb: lager.db,
      });
      expect(create).not.toHaveBeenCalled();
    });
  });
});
