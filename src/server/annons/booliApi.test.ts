/**
 * The Booli API client: signing, the request it sends, the failure classes
 * and the listings → sold → areas flow, against a fake fetch. No network.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BOOLI_API_ACCEPT,
  BOOLI_API_TIDSGRANS_MS,
  anropaBooliApi,
  booliApiNycklar,
  hamtaFranBooliApi,
  nyUnik,
  sha1Hex,
  signera,
  type BooliApiNycklar,
} from "./booliApi";

const NYCKLAR: BooliApiNycklar = { callerId: "binfo-test", privateKey: "hemlig-nyckel" };
const TID = new Date(1_793_451_600_000); // unix 1793451600 s
const UNIK = "0123456789abcdef";
/** printf '%s' "binfo-test1793451600hemlig-nyckel0123456789abcdef" | shasum -a 1 */
const VANTAD_HASH = "7600c7f037ebb76ada751389b86986c31f220d81";

interface Anrop {
  url: URL;
  init: RequestInit | undefined;
}

function fakeFetch(...svar: Array<Response | Error | (() => Promise<Response>)>) {
  const anrop: Anrop[] = [];
  const kopia = [...svar];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    anrop.push({ url: new URL(String(url)), init });
    const nasta = kopia.shift();
    if (nasta === undefined) throw new Error("oväntat extra anrop");
    if (nasta instanceof Error) throw nasta;
    return typeof nasta === "function" ? nasta() : nasta;
  });
  return { f: f as unknown as typeof fetch, anrop };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const beroenden = (f: typeof fetch) => ({ fetch: f, nu: () => TID, unik: () => UNIK });

const LISTNING = {
  booliId: 6121622,
  location: {
    address: { streetAddress: "Tomtebogatan 23A" },
    region: { municipalityName: "Stockholm" },
    position: { latitude: 59.34104525, longitude: 18.03175462 },
    namedAreas: ["Vasastan Birkastan"],
  },
  livingArea: 51,
  rooms: 2,
  rent: 2130,
  listPrice: 7_250_000,
  floor: 4,
  constructionYear: 1908,
  buildingHasElevator: 1,
  hasBalcony: 1,
  hasPatio: 0,
};
const OMRADEN = {
  areas: [
    { name: "Stockholm", types: ["Kommun"], size: 215073905 },
    { name: "11339", types: ["Postnummer"], size: 3068 },
  ],
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("signering", () => {
  it("hash = sha1(callerId + time + privateKey + unique), oberoende uträknad", async () => {
    expect(await signera(NYCKLAR, "1793451600", UNIK)).toBe(VANTAD_HASH);
  });

  it("sha1Hex av tom text är den kända SHA-1:an", async () => {
    expect(await sha1Hex("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
  });

  it("unique är 16 hexadecimala tecken och slumpas", () => {
    const a = nyUnik();
    const b = nyUnik();
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(b).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toBe(b);
  });
});

describe("anropet", () => {
  it("GET mot api.booli.se med v2-Accept, time i SEKUNDER, unique och hash", async () => {
    const { f, anrop } = fakeFetch(json({ listings: [LISTNING] }));
    const r = await anropaBooliApi("listings/6121622", {}, NYCKLAR, beroenden(f));
    expect(r.typ).toBe("ok");
    expect(anrop).toHaveLength(1);
    const { url, init } = anrop[0]!;
    expect(url.origin).toBe("https://api.booli.se");
    expect(url.pathname).toBe("/listings/6121622");
    expect(url.searchParams.get("callerId")).toBe("binfo-test");
    expect(url.searchParams.get("time")).toBe("1793451600");
    expect(url.searchParams.get("unique")).toBe(UNIK);
    expect(url.searchParams.get("hash")).toBe(VANTAD_HASH);
    expect(url.searchParams.has("privateKey")).toBe(false);
    expect(url.href).not.toContain("hemlig-nyckel");
    expect(init?.method).toBe("GET");
    expect(init?.headers).toEqual({ accept: BOOLI_API_ACCEPT });
    expect(BOOLI_API_ACCEPT).toBe("application/vnd.booli-v2+json");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("401/403 och FAILURE_*-svar är nyckel; orsaken håller aldrig nycklarna eller frågan", async () => {
    for (const res of [
      new Response("Unauthorized", { status: 401 }),
      new Response('{"error":"FAILURE_INVALID_HASH"}', { status: 403 }),
      new Response("FAILURE_MISSING_PARAM callerId, unique, time and hash", { status: 400 }),
    ]) {
      const { f } = fakeFetch(res);
      const r = await anropaBooliApi("listings/1", {}, NYCKLAR, beroenden(f));
      expect(r).toMatchObject({ typ: "fel", kod: "nyckel" });
      if (r.typ === "fel") {
        expect(r.orsak).toMatch(/^listings\/1: http \d{3}/);
        expect(r.orsak).not.toMatch(/binfo-test|hemlig|callerId|hash=|\?/);
      }
    }
  });

  it("404 är hittades_inte, 5xx och 429 är natverk, trasig JSON är tolkning", async () => {
    const fall: Array<[Response, string]> = [
      [json({ listings: [] }, 404), "hittades_inte"],
      [new Response("x", { status: 500 }), "natverk"],
      [new Response("x", { status: 503 }), "natverk"],
      [new Response("x", { status: 429 }), "natverk"],
      [new Response("<html>", { status: 200 }), "tolkning"],
    ];
    for (const [res, kod] of fall) {
      const { f } = fakeFetch(res);
      expect(await anropaBooliApi("listings/1", {}, NYCKLAR, beroenden(f))).toMatchObject({
        typ: "fel",
        kod,
      });
    }
  });

  it("ett nätverksfel vars text innehåller adressen tvättas", async () => {
    const { f } = fakeFetch(
      new Error(
        `connect failed https://api.booli.se/listings/1?callerId=binfo-test&hash=${VANTAD_HASH} key hemlig-nyckel`,
      ),
    );
    const r = await anropaBooliApi("listings/1", {}, NYCKLAR, beroenden(f));
    expect(r).toMatchObject({ typ: "fel", kod: "natverk" });
    if (r.typ === "fel") expect(r.orsak).not.toMatch(/binfo-test|hemlig|callerId|7600c7f0/);
  });

  it("standardtidsgränsen är 8 s per anrop; en hängande förfrågan avbryts (natverk, timeout)", async () => {
    expect(BOOLI_API_TIDSGRANS_MS).toBe(8_000);
    // Real timers with a short deadline: crypto.subtle resolves outside the
    // fake-timer queue, so fake timers would advance before the timer exists.
    const f = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener("abort", () => rej(new Error("aborted")));
        }),
    ) as unknown as typeof fetch;
    expect(
      await anropaBooliApi("listings/1", {}, NYCKLAR, { ...beroenden(f), tidsgransMs: 30 }),
    ).toEqual({
      typ: "fel",
      kod: "natverk",
      orsak: "listings/1: timeout efter 30 ms",
    });
  });
});

describe("hamtaFranBooliApi", () => {
  it("aktiv annons: listings + areas (två anrop), postnumret från Postnummer-området", async () => {
    const { f, anrop } = fakeFetch(json({ listings: [LISTNING] }), json(OMRADEN));
    const r = await hamtaFranBooliApi("6121622", NYCKLAR, beroenden(f));
    expect(r).toMatchObject({ typ: "ok", samling: "listings", anrop: 2 });
    if (r.typ !== "ok") return;
    expect(r.uppgifter).toMatchObject({
      adress: "Tomtebogatan 23A",
      postnummer: "113 39",
      ort: "Stockholm",
      boarea: 51,
      antalRum: 2,
      manadsavgift: 2130,
      utgangspris: 7_250_000,
      vaning: 4,
      byggar: 1908,
      hiss: "ja",
      balkong: "ja",
    });
    expect(anrop.map((a) => a.url.pathname)).toEqual(["/listings/6121622", "/areas"]);
    expect(anrop[1]!.url.searchParams.get("lat")).toBe("59.34104525");
    expect(anrop[1]!.url.searchParams.get("lng")).toBe("18.03175462");
  });

  it("404 på listings → sold/{id}; den sålda raden har postCode, så inget areas-anrop", async () => {
    const sald = {
      ...LISTNING,
      soldPrice: 8_000_000,
      location: { ...LISTNING.location, address: { streetAddress: "X 1", postCode: 11341 } },
    };
    const { f, anrop } = fakeFetch(json({ listings: [] }, 404), json({ sold: [sald] }));
    const r = await hamtaFranBooliApi("6121622", NYCKLAR, beroenden(f));
    expect(r).toMatchObject({ typ: "ok", samling: "sold", anrop: 2 });
    if (r.typ === "ok") {
      expect(r.uppgifter.postnummer).toBe("113 41");
      expect(r.uppgifter.utgangspris).toBe(7_250_000);
    }
    expect(anrop.map((a) => a.url.pathname)).toEqual(["/listings/6121622", "/sold/6121622"]);
  });

  it("en tom lista med 200 räknas också som 'inte aktiv'", async () => {
    const { f } = fakeFetch(json({ listings: [] }), json({ sold: [] }));
    expect(await hamtaFranBooliApi("5", NYCKLAR, beroenden(f))).toMatchObject({
      typ: "fel",
      kod: "hittades_inte",
      anrop: 2,
    });
  });

  it("varken aktiv eller såld: hittades_inte efter två anrop", async () => {
    const { f } = fakeFetch(json({ listings: [] }, 404), json({ sold: [] }, 404));
    expect(await hamtaFranBooliApi("5", NYCKLAR, beroenden(f))).toMatchObject({
      typ: "fel",
      kod: "hittades_inte",
      anrop: 2,
    });
  });

  it("nyckel avvisad på första anropet: inget sold-anrop", async () => {
    const { f, anrop } = fakeFetch(new Response("FAILURE_INVALID_HASH", { status: 403 }));
    expect(await hamtaFranBooliApi("5", NYCKLAR, beroenden(f))).toMatchObject({
      typ: "fel",
      kod: "nyckel",
      anrop: 1,
    });
    expect(anrop).toHaveLength(1);
  });

  it("ett svar som gäller ett annat id avvisas (fel lägenhet)", async () => {
    const { f } = fakeFetch(json({ listings: [{ ...LISTNING, booliId: 999 }] }));
    expect(await hamtaFranBooliApi("6121622", NYCKLAR, beroenden(f))).toMatchObject({
      typ: "fel",
      kod: "hittades_inte",
    });
  });

  it("oväntad form (ingen lista) är tolkning; ett objekt utan formulärfält är tolkning", async () => {
    const a = fakeFetch(json({ annat: 1 }));
    expect(await hamtaFranBooliApi("1", NYCKLAR, beroenden(a.f))).toMatchObject({
      typ: "fel",
      kod: "tolkning",
    });
    const b = fakeFetch(json({ listings: [{ booliId: 1, published: "x" }] }));
    expect(await hamtaFranBooliApi("1", NYCKLAR, beroenden(b.f))).toMatchObject({
      typ: "fel",
      kod: "tolkning",
    });
  });

  it("areas misslyckas: svaret är ändå ok, postnumret saknas och orsaken anges", async () => {
    const { f } = fakeFetch(json({ listings: [LISTNING] }), new Response("x", { status: 500 }));
    const r = await hamtaFranBooliApi("6121622", NYCKLAR, beroenden(f));
    expect(r).toMatchObject({ typ: "ok", anrop: 2, postnummerOrsak: "areas: http 500" });
    if (r.typ === "ok") expect(r.uppgifter.postnummer).toBeUndefined();
  });

  it("utan koordinater görs inget areas-anrop", async () => {
    const { location: _l, ...utan } = LISTNING;
    const { f, anrop } = fakeFetch(json({ listings: [{ ...utan, location: {} }] }));
    const r = await hamtaFranBooliApi("6121622", NYCKLAR, beroenden(f));
    expect(r).toMatchObject({ typ: "ok", anrop: 1, postnummerOrsak: "inga koordinater" });
    expect(anrop).toHaveLength(1);
  });

  it("ett id som inte är siffror skickas aldrig", async () => {
    const { f, anrop } = fakeFetch();
    expect(await hamtaFranBooliApi("12/../x", NYCKLAR, beroenden(f))).toMatchObject({
      typ: "fel",
      kod: "hittades_inte",
      anrop: 0,
    });
    expect(anrop).toHaveLength(0);
  });
});

describe("booliApiNycklar", () => {
  it("båda nycklarna krävs, BOOLI_API=off stänger av", () => {
    expect(booliApiNycklar({ booliCallerId: "a", booliPrivateKey: "b" })).toEqual({
      callerId: "a",
      privateKey: "b",
    });
    expect(booliApiNycklar({ booliCallerId: "a" })).toBeNull();
    expect(booliApiNycklar({ booliPrivateKey: "b" })).toBeNull();
    expect(
      booliApiNycklar({ booliCallerId: "a", booliPrivateKey: "b", booliApiAvstangd: true }),
    ).toBeNull();
  });
});
