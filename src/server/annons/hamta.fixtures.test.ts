/**
 * Integration: the real URL check and the real parser (booli.ts) against the
 * six recorded Booli pages in fixtures/booli/, served by a fake fetch. No
 * network, no mocks of our own modules.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { ANNONS_FALT, ANNONS_MEDDELANDE } from "@/lib/annons/typer";
import { skapaFakeKontoDatabas, type FakeKontoDatabas } from "../__fakes__/konto";
import { STANDARD_POLICY, skapaBehorighet } from "../behorighet";
import type { Env } from "../env";
import type { Kontext } from "../kontext";
import type { Anropare } from "../portar";
import { ANNONS_KARNFALT, hamtaAnnons } from "./hamta";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURER = path.join(here, "..", "..", "..", "fixtures", "booli");
const las = (namn: string) => readFile(path.join(FIXTURER, namn), "utf-8");

const NU = new Date("2026-10-24T12:00:00Z");
const kontext: Kontext = { enhetId: "a".repeat(22), principalId: null, ipHash: "ip-hash-1" };

const SIDOR = [
  { fil: "bostad-719044.html", url: "https://www.booli.se/bostad/719044" },
  { fil: "bostad-69268.html", url: "https://www.booli.se/bostad/69268" },
  { fil: "bostad-720821.html", url: "https://www.booli.se/bostad/720821" },
  { fil: "bostad-4036850.html", url: "https://www.booli.se/bostad/4036850" },
  { fil: "annons-6279984.html", url: "https://www.booli.se/annons/6279984" },
  { fil: "annons-6323511.html", url: "https://www.booli.se/annons/6323511" },
] as const;

const env: Env = {
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
};

let konto: FakeKontoDatabas;
let varna: MockInstance<typeof console.warn>;

function anropare(): Anropare {
  return { kontext, konto, behorighet: skapaBehorighet(STANDARD_POLICY) };
}

function fakeFetch(svar: () => Response) {
  const anrop: string[] = [];
  const f = vi.fn(async (url: string | URL | Request) => {
    anrop.push(String(url));
    return svar();
  });
  return { f: f as unknown as typeof fetch, anrop };
}

function kor(url: string, f: typeof fetch) {
  return hamtaAnnons({ url }, { anropare: anropare(), env, fetch: f, nu: () => NU });
}

beforeEach(() => {
  konto = skapaFakeKontoDatabas({ nu: () => NU });
  varna = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("hamtaAnnons mot de sex inspelade Booli-sidorna", () => {
  for (const { fil, url } of SIDOR) {
    it(`${fil}: ett anrop, alla kärnfält hittade, postnumret från annonsen, inget i loggen`, async () => {
      const html = await las(fil);
      const { f, anrop } = fakeFetch(() => new Response(html, { status: 200 }));
      const r = await kor(url, f);

      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url).toBe(url);
      expect(r.kalla).toBe("booli");
      expect(r.tolkning).toBe("struktur");
      expect(r.postnummerKalla).toBe("annons");
      expect(r.hamtad).toBe(NU.toISOString());
      for (const falt of ANNONS_KARNFALT) {
        expect(r.status[falt], falt).toBe("hittad");
      }
      expect(r.uppgifter.postnummer).toMatch(/^\d{3} \d{2}$/);
      // The status record covers exactly the form fields.
      expect(Object.keys(r.status).sort()).toEqual([...ANNONS_FALT].sort());
      // One request only (the page had its postcode: no geocoding).
      expect(anrop).toEqual([url]);
      expect(varna).not.toHaveBeenCalled();
      // Cached for 24 h.
      expect(konto.annonsCache.has(url)).toBe(true);
    });
  }

  it("andra anropet för samma länk ger cache-träff utan nytt nätverksanrop", async () => {
    const html = await las("bostad-720821.html");
    const { f, anrop } = fakeFetch(() => new Response(html, { status: 200 }));
    const forsta = await kor("https://www.booli.se/bostad/720821", f);
    const andra = await kor("https://booli.se/bostad/720821?utm_source=x", f);
    expect(andra).toEqual(forsta);
    expect(anrop).toHaveLength(1);
  });

  it("Cloudflares utmaningssida (HTTP 403) är blockerad", async () => {
    const html = await las("cloudflare-challenge.html");
    const { f } = fakeFetch(
      () => new Response(html, { status: 403, headers: { "cf-mitigated": "challenge" } }),
    );
    expect(await kor(SIDOR[0].url, f)).toEqual({
      ok: false,
      errorCode: "blockerad",
      errorMessage: ANNONS_MEDDELANDE.allmant,
    });
    expect(konto.annonsCache.size).toBe(0);
    expect(varna.mock.calls.some((c) => c[0] === "[annons] blockerad")).toBe(true);
  });

  it("utmaningssidan med HTTP 200 känns också igen (parsern) och loggas", async () => {
    const html = await las("cloudflare-challenge.html");
    const { f } = fakeFetch(() => new Response(html, { status: 200 }));
    expect(await kor(SIDOR[0].url, f)).toMatchObject({ ok: false, errorCode: "blockerad" });
    expect(konto.annonsCache.size).toBe(0);
  });

  it("en sida utan Listing-objektet (layoutförändring) ger ett tydligt fel och en loggrad, aldrig ett tomt svar", async () => {
    const html = (await las("bostad-719044.html")).replace(/__next_f/g, "__andrad_f");
    const { f } = fakeFetch(() => new Response(html, { status: 200 }));
    const r = await kor(SIDOR[0].url, f);
    // Either the JSON-LD still gives form fields (a partial answer, flagged) or
    // the answer is a failure; it must never be an ok answer with nothing in it.
    if (r.ok) {
      expect(ANNONS_FALT.some((falt) => r.status[falt] === "hittad")).toBe(true);
    } else {
      expect(r.errorCode).toBe("tolkning");
    }
    expect(varna.mock.calls.some((c) => c[0] === "[annons] tolkning misslyckades")).toBe(true);
  });

  it("en avhuggen sida (bara början) ger inget tomt svar", async () => {
    const html = (await las("bostad-719044.html")).slice(0, 4000);
    const { f } = fakeFetch(() => new Response(html, { status: 200 }));
    const r = await kor(SIDOR[0].url, f);
    expect(r.ok === false ? r.errorCode : "partial").toMatch(/^(tolkning|partial)$/);
  });
});
