import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GEOKOD_TIDSGRANS_MS,
  NOMINATIM_USER_AGENT,
  geokodaPostnummer,
  normaliseraPostnummerText,
  reverseUrl,
  searchUrl,
} from "./geokod";

const here = path.dirname(fileURLToPath(import.meta.url));
const rot = path.join(here, "..", "..", "..");

// Recorded from the real Nominatim on 2026-10-24 (Sankt Eriksgatan 31A, Booli
// bostad/720821). The reverse answer is the building; the search answer is the
// street centre line (a different postcode than the house).
const reverseSvar = await readFile(
  path.join(rot, "fixtures", "booli", "nominatim-reverse.json"),
  "utf-8",
);
const searchGata = await readFile(
  path.join(rot, "fixtures", "booli", "nominatim-search.json"),
  "utf-8",
);
// Recorded 2026-10-13 by ml/tests: a house-level search hit.
const aldreSvar = JSON.parse(
  await readFile(path.join(rot, "ml", "tests", "fixtures", "nominatim_responses.json"), "utf-8"),
) as { responses: Record<string, unknown> };
const searchHus = JSON.stringify(aldreSvar.responses["baltzar von platens gata 6||stockholm"]);

const KOORD = { lat: 59.33263196, lon: 18.03107231 };

function json(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

function fakeFetch(...svar: Array<Response | Error | (() => Promise<Response>)>) {
  const anrop: Array<{ url: string; init: RequestInit | undefined }> = [];
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

afterEach(() => {
  vi.useRealTimers();
});

describe("normaliseraPostnummerText", () => {
  it("normaliserar till NNN NN", () => {
    expect(normaliseraPostnummerText("112 39")).toBe("112 39");
    expect(normaliseraPostnummerText("11239")).toBe("112 39");
    expect(normaliseraPostnummerText(" 11239 ")).toBe("112 39");
  });
  it("avvisar allt som inte är ett enda femsiffrigt postnummer", () => {
    for (const x of ["112 39;112 40", "1123", "ABC 12", "112  39", "112-39", "", undefined]) {
      expect(normaliseraPostnummerText(x)).toBeNull();
    }
  });
});

describe("URL:er", () => {
  it("reverse: jsonv2, lat, lon, zoom=18, addressdetails=1", () => {
    const u = new URL(reverseUrl(KOORD));
    expect(u.origin + u.pathname).toBe("https://nominatim.openstreetmap.org/reverse");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      format: "jsonv2",
      lat: "59.33263196",
      lon: "18.03107231",
      zoom: "18",
      addressdetails: "1",
    });
  });
  it("search: street + city + countrycodes=se + limit=1 + addressdetails=1", () => {
    const u = new URL(searchUrl("Sankt Eriksgatan 31A", "Stockholm"));
    expect(u.origin + u.pathname).toBe("https://nominatim.openstreetmap.org/search");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      format: "jsonv2",
      street: "Sankt Eriksgatan 31A",
      city: "Stockholm",
      countrycodes: "se",
      limit: "1",
      addressdetails: "1",
    });
  });
});

describe("geokodaPostnummer", () => {
  it("reverse från koordinater med de inspelade svaret: 112 39, ett anrop, identifierande User-Agent", async () => {
    const { f, anrop } = fakeFetch(json(reverseSvar));
    const r = await geokodaPostnummer(
      { koordinater: KOORD, adress: "Sankt Eriksgatan 31A" },
      { fetch: f },
    );
    expect(r).toEqual({ postnummer: "112 39", metod: "reverse" });
    expect(anrop).toHaveLength(1);
    expect(anrop[0]!.url).toBe(reverseUrl(KOORD));
    expect((anrop[0]!.init?.headers as Record<string, string>)["user-agent"]).toBe(
      NOMINATIM_USER_AGENT,
    );
    expect(NOMINATIM_USER_AGENT).toBe("Binfo/1.0 (+https://binfo.slanesens.com)");
  });

  it("utan koordinater söks adressen med ort; en husträff ger postnumret", async () => {
    const { f, anrop } = fakeFetch(json(searchHus));
    const r = await geokodaPostnummer(
      { adress: "Baltzar von Platens gata 6", ort: "Stockholm" },
      { fetch: f },
    );
    expect(r).toEqual({ postnummer: "112 35", metod: "search" });
    expect(anrop).toHaveLength(1);
    const u = new URL(anrop[0]!.url);
    expect(u.searchParams.get("street")).toBe("Baltzar von Platens gata 6");
    expect(u.searchParams.get("city")).toBe("Stockholm");
  });

  it("utan ort gissas ingen stad: ingen sökning, postnumret saknas", async () => {
    const { f, anrop } = fakeFetch(json(searchHus));
    const r = await geokodaPostnummer({ adress: "Kastellgatan 9" }, { fetch: f });
    expect(r.postnummer).toBeNull();
    expect(anrop).toHaveLength(0);
  });

  it("använder ort när den finns", async () => {
    const { f, anrop } = fakeFetch(json(searchHus));
    await geokodaPostnummer({ adress: "Storgatan 1", ort: "Lidingö" }, { fetch: f });
    expect(new URL(anrop[0]!.url).searchParams.get("city")).toBe("Lidingö");
  });

  it("en gatuträff (inget husnummer) avvisas: fel postnummer är värre än inget", async () => {
    const { f } = fakeFetch(json(searchGata));
    const r = await geokodaPostnummer(
      { adress: "Sankt Eriksgatan 31A", ort: "Stockholm" },
      { fetch: f },
    );
    expect(r).toEqual({ postnummer: null, orsak: "search: träffen är en gata" });
  });

  it("reverse utan postnummer faller tillbaka på sökningen: högst ett anrop vardera", async () => {
    const { f, anrop } = fakeFetch(json('{"error":"Unable to geocode"}'), json(searchHus));
    const r = await geokodaPostnummer(
      { koordinater: KOORD, adress: "Baltzar von Platens gata 6", ort: "Stockholm" },
      { fetch: f },
    );
    expect(r).toEqual({ postnummer: "112 35", metod: "search" });
    expect(anrop).toHaveLength(2);
    expect(anrop[0]!.url).toContain("/reverse");
    expect(anrop[1]!.url).toContain("/search");
  });

  it("ingen koordinat och ingen adress: inga anrop, orsak anges", async () => {
    const { f, anrop } = fakeFetch();
    const r = await geokodaPostnummer({}, { fetch: f });
    expect(r).toEqual({ postnummer: null, orsak: "varken koordinater eller adress" });
    expect(anrop).toHaveLength(0);
  });

  it("ogiltiga koordinater (NaN, utanför intervall) används inte", async () => {
    const { f, anrop } = fakeFetch();
    for (const k of [
      { lat: Number.NaN, lon: 18 },
      { lat: 95, lon: 18 },
      { lat: 59, lon: 181 },
    ]) {
      expect((await geokodaPostnummer({ koordinater: k }, { fetch: f })).postnummer).toBeNull();
    }
    expect(anrop).toHaveLength(0);
  });

  it("felaktigt formade svar ger null, aldrig ett kast", async () => {
    const fall: Array<[string, string]> = [
      ["ingen JSON", "<html>blocked</html>"],
      ["fel form (array för reverse)", "[]"],
      ["postcode är ett tal", '{"address":{"postcode":11239}}'],
      ["flera postnummer", '{"address":{"postcode":"112 39;112 40"}}'],
      ["text som postnummer", '{"address":{"postcode":"Stockholm"}}'],
      ["address saknas", "{}"],
    ];
    for (const [namn, body] of fall) {
      const { f } = fakeFetch(json(body));
      const r = await geokodaPostnummer({ koordinater: KOORD }, { fetch: f });
      expect(r.postnummer, namn).toBeNull();
    }
  });

  it("felaktig sökning: fel form, tom lista och för stort svar ger null", async () => {
    for (const body of [
      "{}",
      "[]",
      '[{"address":{"house_number":"6","postcode":"x"}}]',
      "x".repeat(300_000),
    ]) {
      const { f } = fakeFetch(json(body));
      expect(
        (await geokodaPostnummer({ adress: "Storgatan 1" }, { fetch: f })).postnummer,
      ).toBeNull();
    }
  });

  it("HTTP-fel och nätverksfel ger null och hoppar över sökningen (Nominatim nere)", async () => {
    const a = fakeFetch(json("busy", 429));
    const r1 = await geokodaPostnummer(
      { koordinater: KOORD, adress: "Storgatan 1" },
      { fetch: a.f },
    );
    expect(r1).toEqual({ postnummer: null, orsak: "reverse: http 429" });
    expect(a.anrop).toHaveLength(1);

    const b = fakeFetch(new TypeError("fetch failed"));
    const r2 = await geokodaPostnummer(
      { koordinater: KOORD, adress: "Storgatan 1" },
      { fetch: b.f },
    );
    expect(r2.postnummer).toBeNull();
    expect(b.anrop).toHaveLength(1);
  });

  it("avbryter efter 5 s", async () => {
    vi.useFakeTimers();
    const hangande = (url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        void url;
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("avbruten", "AbortError")),
        );
      });
    const resultat = geokodaPostnummer(
      { koordinater: KOORD },
      { fetch: hangande as unknown as typeof fetch },
    );
    await vi.advanceTimersByTimeAsync(GEOKOD_TIDSGRANS_MS);
    expect(await resultat).toEqual({ postnummer: null, orsak: "reverse: timeout" });
    expect(GEOKOD_TIDSGRANS_MS).toBe(5000);
  });
});
