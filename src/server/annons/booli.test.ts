import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parsePositivtTal, parseVaning } from "@/lib/analyseraForm";
import { ANNONS_FALT } from "@/lib/annons/typer";
import type { AnnonsFalt, AnnonsUppgifter } from "@/lib/annons/typer";

import { tolkaBooli } from "./booli";

const FIXTURER = join(process.cwd(), "fixtures", "booli");
const las = (namn: string) => readFileSync(join(FIXTURER, namn), "utf8");

interface Forvantat {
  fil: string;
  url: string;
  uppgifter: AnnonsUppgifter;
  saknas: AnnonsFalt[];
}

// Expected values verified against the six fixture files (2026-10-24).
const FORVANTAT: Forvantat[] = [
  {
    fil: "bostad-719044.html",
    url: "https://www.booli.se/bostad/719044",
    uppgifter: {
      adress: "Sandelsgatan 35",
      postnummer: "115 33",
      ort: "Stockholm",
      stadsdel: "Östermalm",
      utgangspris: 4500000,
      manadsavgift: 2618,
      boarea: 36,
      antalRum: 2,
      vaning: 6,
      byggar: 1935,
      hiss: "ja",
      balkong: "ja",
      forening: "BRF Sandelsgatan 35 i Stockholm",
      maklarUrl: "https://innerstadmakleri.se/o/1972857",
      koordinater: { lat: 59.343907, lon: 18.0937966 },
    },
    saknas: [],
  },
  {
    // listPrice is null (sale not started): utgångspris must be missing and the
    // JSON-LD has no Product price either.
    fil: "bostad-69268.html",
    url: "https://www.booli.se/bostad/69268",
    uppgifter: {
      adress: "Sandelsgatan 12",
      postnummer: "115 34",
      ort: "Stockholm",
      stadsdel: "Gärdet",
      manadsavgift: 2111,
      boarea: 41.5,
      antalRum: 2,
      vaning: 6,
      byggar: 1962,
      hiss: "ja",
      balkong: "ja",
      forening: "HSB BRF Dragonen I Stockholm",
      maklarUrl:
        "https://connect-resolve.maklare.vitec.net/Description/M14499/OBJ5PZGZQR2NHTG347TB1/Booli",
      koordinater: { lat: 59.3449332, lon: 18.0897764 },
    },
    saknas: ["utgangspris"],
  },
  {
    // rent.raw is 0 (broker gave no fee): avgift missing.
    fil: "bostad-720821.html",
    url: "https://www.booli.se/bostad/720821",
    uppgifter: {
      adress: "Sankt Eriksgatan 31A",
      postnummer: "112 39",
      ort: "Stockholm",
      stadsdel: "Kungsholmen",
      utgangspris: 5995000,
      boarea: 54,
      antalRum: 2,
      vaning: 3,
      byggar: 1937,
      hiss: "ja",
      balkong: "ja",
      forening: "BRF Väktaren 16",
      maklarUrl:
        "https://connect-resolve.maklare.vitec.net/Description/M22127/OBJ22127_2099178190/Booli",
      koordinater: { lat: 59.33263196, lon: 18.03107231 },
    },
    saknas: ["manadsavgift"],
  },
  {
    fil: "bostad-4036850.html",
    url: "https://www.booli.se/bostad/4036850",
    uppgifter: {
      adress: "Wennerbergsgatan 2",
      postnummer: "112 58",
      ort: "Stockholm",
      stadsdel: "Kungsholmen",
      utgangspris: 8495000,
      manadsavgift: 6182,
      boarea: 87,
      antalRum: 3,
      vaning: 6,
      byggar: 1944,
      hiss: "ja",
      balkong: "ja",
      forening: "BRF Signalpatrullen 12",
      maklarUrl:
        "https://connect-resolve.maklare.vitec.net/Description/S13989/CMBOLGH5EEBGP98FEGRHGTF/Booli",
      koordinater: { lat: 59.3281953, lon: 18.0128221 },
    },
    saknas: [],
  },
  {
    fil: "annons-6279984.html",
    url: "https://www.booli.se/annons/6279984",
    uppgifter: {
      adress: "Torsvikssvängen 39",
      postnummer: "181 34",
      ort: "Lidingö",
      stadsdel: "Torsvik",
      utgangspris: 6695000,
      manadsavgift: 5125,
      boarea: 73.6,
      antalRum: 3,
      vaning: 2,
      byggar: 1945,
      hiss: "ja",
      balkong: "ja",
      forening: "BRF Torsborgen 3",
      maklarUrl:
        "https://connect-resolve.maklare.vitec.net/Description/S13086/OBJ5Q26NRD2ZNMPLBKTBC/Booli",
      koordinater: { lat: 59.36485357, lon: 18.11804403 },
    },
    saknas: [],
  },
  {
    fil: "annons-6323511.html",
    url: "https://www.booli.se/annons/6323511",
    uppgifter: {
      adress: "Kastellgatan 9",
      postnummer: "211 48",
      ort: "Malmö",
      stadsdel: "Davidshall",
      utgangspris: 5995000,
      manadsavgift: 6612,
      boarea: 105,
      antalRum: 4,
      vaning: 5,
      byggar: 1936,
      hiss: "ja",
      balkong: "ja",
      forening: "BRF Banéret",
      maklarUrl:
        "https://connect-resolve.maklare.vitec.net/Description/S12877/OBJ5PT9NWF2GVC86P35B2/Booli",
      koordinater: { lat: 55.59864033, lon: 12.99385682 },
    },
    saknas: [],
  },
];

describe("tolkaBooli: the six fixtures, every field", () => {
  it.each(FORVANTAT)("$fil", ({ fil, url, uppgifter, saknas }) => {
    const r = tolkaBooli(las(fil), url);
    expect(r).toEqual({ typ: "ok", uppgifter, saknas });
  });

  it("every fixture reports unit-correct, form-ready values", () => {
    for (const f of FORVANTAT) {
      const r = tolkaBooli(las(f.fil), f.url);
      if (r.typ !== "ok") throw new Error(f.fil);
      expect(Number.isInteger(r.uppgifter.vaning)).toBe(true);
      expect(r.uppgifter.postnummer).toMatch(/^\d{3} \d{2}$/);
      expect(r.uppgifter.maklarUrl).toMatch(/^https:\/\//);
    }
  });
});

describe("tolkaBooli: Cloudflare challenge", () => {
  it("is reported as blockerad", () => {
    expect(tolkaBooli(las("cloudflare-challenge.html"), "https://www.booli.se/bostad/1")).toEqual({
      typ: "blockerad",
    });
  });

  it("a page with a Listing is never called blocked, even if it mentions Cloudflare", () => {
    const html = las("bostad-719044.html") + "<!-- challenges.cloudflare.com _cf_chl_opt -->";
    expect(tolkaBooli(html, "u").typ).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// Synthetic pages
// ---------------------------------------------------------------------------

interface Syntetisk {
  listing?: Record<string, unknown>;
  ld?: unknown[];
  /** Split the RSC payload over this many pushes. */
  delar?: number;
}

function sida({ listing, ld = [], delar = 1 }: Syntetisk): string {
  const scripts: string[] = [];
  if (listing) {
    const payload = `5:["$","div",null,{"data":{"object":${JSON.stringify({ __typename: "Listing", ...listing })},"other":{"object":1}}}]\n`;
    const bit = Math.ceil(payload.length / delar);
    for (let i = 0; i < payload.length; i += bit) {
      scripts.push(
        `<script>self.__next_f.push(${JSON.stringify([1, payload.slice(i, i + bit)])})</script>`,
      );
    }
  }
  for (const n of ld) {
    scripts.push(`<script type="application/ld+json">${JSON.stringify(n)}</script>`);
  }
  return `<html><head><title>Bostad</title></head><body>${scripts.join("\n")}</body></html>`;
}

const GRUND = {
  streetAddress: "Testgatan 1",
  listPrice: { raw: 3000000, unit: "kr" },
  rent: { raw: 3000, unit: "kr/mån" },
  livingArea: { raw: 50, unit: "m²" },
  rooms: { raw: 2 },
  floor: { raw: 2 },
  constructionYear: 1980,
  amenities: [],
  areas: [
    { type: "municipality", name: "Stockholm" },
    { type: "postcode", name: "11122" },
  ],
};

function okUppgifter(s: Syntetisk): AnnonsUppgifter {
  const r = tolkaBooli(sida(s), "u");
  if (r.typ !== "ok") throw new Error(`expected ok, got ${r.typ}`);
  return r.uppgifter;
}

describe("tolkaBooli: synthetic listings", () => {
  it("a baseline listing maps as documented (and amenities: [] gives no hiss/balkong)", () => {
    expect(okUppgifter({ listing: GRUND })).toEqual({
      adress: "Testgatan 1",
      postnummer: "111 22",
      ort: "Stockholm",
      utgangspris: 3000000,
      manadsavgift: 3000,
      boarea: 50,
      antalRum: 2,
      vaning: 2,
      byggar: 1980,
    });
  });

  it("a yearly fee is divided by 12 and rounded", () => {
    expect(
      okUppgifter({ listing: { ...GRUND, rent: { raw: 30000, unit: "kr/år" } } }).manadsavgift,
    ).toBe(2500);
    expect(
      okUppgifter({ listing: { ...GRUND, rent: { raw: 30010, unit: "kr/år" } } }).manadsavgift,
    ).toBe(2501);
  });

  it("an unknown or missing fee unit gives no fee (not a guess)", () => {
    expect(
      okUppgifter({ listing: { ...GRUND, rent: { raw: 3000, unit: "kr" } } }),
    ).not.toHaveProperty("manadsavgift");
    expect(okUppgifter({ listing: { ...GRUND, rent: { raw: 3000 } } })).not.toHaveProperty(
      "manadsavgift",
    );
  });

  it("amenities: only 'ja' from a present key, never 'nej'", () => {
    const u = okUppgifter({
      listing: { ...GRUND, amenities: [{ key: "elevator" }, { key: "fireplace" }] },
    });
    expect(u.hiss).toBe("ja");
    expect(u).not.toHaveProperty("balkong");
    const v = okUppgifter({ listing: { ...GRUND, amenities: [{ key: "balcony" }] } });
    expect(v.balkong).toBe("ja");
    expect(v).not.toHaveProperty("hiss");
    const w = okUppgifter({ listing: { ...GRUND, amenities: undefined } });
    expect(w).not.toHaveProperty("hiss");
    expect(w).not.toHaveProperty("balkong");
  });

  it("a non-integer or negative floor is missing; floor 0 (ground floor) is kept", () => {
    expect(okUppgifter({ listing: { ...GRUND, floor: { raw: 2.5 } } })).not.toHaveProperty(
      "vaning",
    );
    expect(okUppgifter({ listing: { ...GRUND, floor: { raw: -1 } } })).not.toHaveProperty("vaning");
    expect(okUppgifter({ listing: { ...GRUND, floor: { raw: 0 } } }).vaning).toBe(0);
    expect(okUppgifter({ listing: { ...GRUND, floor: null } })).not.toHaveProperty("vaning");
  });

  it("rooms accept halves; areas round to one decimal; zero or negative is missing", () => {
    expect(okUppgifter({ listing: { ...GRUND, rooms: { raw: 2.5 } } }).antalRum).toBe(2.5);
    expect(okUppgifter({ listing: { ...GRUND, livingArea: { raw: 73.64 } } }).boarea).toBe(73.6);
    expect(okUppgifter({ listing: { ...GRUND, livingArea: { raw: 73.66 } } }).boarea).toBe(73.7);
    expect(okUppgifter({ listing: { ...GRUND, rooms: { raw: 0 } } })).not.toHaveProperty(
      "antalRum",
    );
    expect(okUppgifter({ listing: { ...GRUND, livingArea: { raw: -5 } } })).not.toHaveProperty(
      "boarea",
    );
    expect(okUppgifter({ listing: { ...GRUND, livingArea: { raw: 0.01 } } })).not.toHaveProperty(
      "boarea",
    );
    expect(
      okUppgifter({ listing: { ...GRUND, rent: { raw: 0, unit: "kr/mån" } } }),
    ).not.toHaveProperty("manadsavgift");
  });

  it("construction year outside 1600..current year + 5 is missing", () => {
    for (const ar of [0, 1599, 3000, 1999.5, "1999"]) {
      expect(okUppgifter({ listing: { ...GRUND, constructionYear: ar } })).not.toHaveProperty(
        "byggar",
      );
    }
    expect(okUppgifter({ listing: { ...GRUND, constructionYear: 1600 } }).byggar).toBe(1600);
  });

  it("a wrong type upstream gives a missing field, not a crash", () => {
    const u = okUppgifter({
      listing: {
        ...GRUND,
        rent: "3000 kr",
        livingArea: { raw: "50" },
        rooms: 2,
        floor: [],
        constructionYear: "1980",
        areas: "oops",
        amenities: { key: "elevator" },
        latitude: "59",
        longitude: {},
        listingUrl: 5,
      },
    });
    expect(u).toEqual({ adress: "Testgatan 1", utgangspris: 3000000 });
  });

  it("postcode: JSON-LD wins, then areas; anything but 5 digits is missing", () => {
    const place = (postalCode: unknown) => ({
      "@type": "Place",
      address: { streetAddress: "Testgatan 1", postalCode },
    });
    expect(okUppgifter({ listing: GRUND, ld: [place("99999")] }).postnummer).toBe("999 99");
    expect(okUppgifter({ listing: GRUND, ld: [place("111 22")] }).postnummer).toBe("111 22");
    // invalid JSON-LD postcode falls back to the area entry
    expect(okUppgifter({ listing: GRUND, ld: [place("1112")] }).postnummer).toBe("111 22");
    const utanPostnummer = {
      ...GRUND,
      areas: [{ type: "postcode", name: "1112" }],
    };
    expect(okUppgifter({ listing: utanPostnummer })).not.toHaveProperty("postnummer");
    expect(
      okUppgifter({ listing: { ...GRUND, areas: [{ type: "postcode", name: "111 222" }] } }),
    ).not.toHaveProperty("postnummer");
  });

  it("price: explicit null stays missing; JSON-LD price is used only when the key is absent", () => {
    const product = { "@type": "Product", offers: { "@type": "Offer", price: 4200000 } };
    const { listPrice: _bort, ...utanNyckel } = GRUND;
    void _bort;
    expect(
      okUppgifter({ listing: { ...GRUND, listPrice: null }, ld: [product] }),
    ).not.toHaveProperty("utgangspris");
    expect(
      okUppgifter({ listing: { ...GRUND, listPrice: { raw: null } }, ld: [product] }),
    ).not.toHaveProperty("utgangspris");
    expect(okUppgifter({ listing: utanNyckel, ld: [product] }).utgangspris).toBe(4200000);
    expect(okUppgifter({ listing: utanNyckel })).not.toHaveProperty("utgangspris");
    // listPrice wins over JSON-LD when both exist
    expect(okUppgifter({ listing: GRUND, ld: [product] }).utgangspris).toBe(3000000);
    expect(okUppgifter({ listing: { ...GRUND, listPrice: { raw: 0 } } })).not.toHaveProperty(
      "utgangspris",
    );
  });

  it("forening is the last breadcrumb that links to /bostadsrattsforening/", () => {
    const krumbror = {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", name: "Stockholms län", item: "https://www.booli.se/sok/till-salu" },
        {
          "@type": "ListItem",
          name: "BRF Först",
          item: "https://www.booli.se/bostadsrattsforening/1",
        },
        {
          "@type": "ListItem",
          name: "BRF Sist",
          item: "https://www.booli.se/bostadsrattsforening/2",
        },
        { "@type": "ListItem", name: "Gatan", item: "https://www.booli.se/sok/till-salu?x=1" },
      ],
    };
    expect(okUppgifter({ listing: GRUND, ld: [krumbror] }).forening).toBe("BRF Sist");
    expect(okUppgifter({ listing: GRUND })).not.toHaveProperty("forening");
  });

  it("JSON-LD inside @graph and arrays is found; broken JSON-LD is skipped", () => {
    const html =
      sida({ listing: GRUND }) +
      '<script type="application/ld+json">{not json</script>' +
      `<script type="application/ld+json">${JSON.stringify({
        "@graph": [
          {
            "@type": "BreadcrumbList",
            itemListElement: [
              { name: "BRF Graf", item: "https://www.booli.se/bostadsrattsforening/9" },
            ],
          },
        ],
      })}</script>`;
    const r = tolkaBooli(html, "u");
    expect(r.typ === "ok" && r.uppgifter.forening).toBe("BRF Graf");
  });

  it("koordinater only when both are finite and in range", () => {
    expect(
      okUppgifter({ listing: { ...GRUND, latitude: 59.3, longitude: 18.1 } }).koordinater,
    ).toEqual({ lat: 59.3, lon: 18.1 });
    expect(okUppgifter({ listing: { ...GRUND, latitude: 59.3 } })).not.toHaveProperty(
      "koordinater",
    );
    expect(
      okUppgifter({ listing: { ...GRUND, latitude: 999, longitude: 18.1 } }),
    ).not.toHaveProperty("koordinater");
  });

  it("maklarUrl: only http(s) URLs up to 2000 characters", () => {
    const med = (listingUrl: unknown) => okUppgifter({ listing: { ...GRUND, listingUrl } });
    expect(med("https://maklare.se/o/1").maklarUrl).toBe("https://maklare.se/o/1");
    expect(med("http://maklare.se/o/1").maklarUrl).toBe("http://maklare.se/o/1");
    expect(med("javascript:alert(1)")).not.toHaveProperty("maklarUrl");
    expect(med("/relativ")).not.toHaveProperty("maklarUrl");
    expect(med(`https://maklare.se/${"a".repeat(2000)}`)).not.toHaveProperty("maklarUrl");
    expect(med("")).not.toHaveProperty("maklarUrl");
  });

  it("the Listing scanner copes with braces, quotes and escapes inside strings", () => {
    const u = okUppgifter({
      listing: { ...GRUND, streetAddress: 'Gatan 1 "A" } {', note: '}{\\"\\\\}' },
    });
    expect(u.adress).toBe('Gatan 1 "A" } {');
    expect(u.manadsavgift).toBe(3000);
  });

  it("a payload split over several pushes is concatenated", () => {
    for (const delar of [2, 3, 7, 31]) {
      expect(okUppgifter({ listing: GRUND, delar }).adress).toBe("Testgatan 1");
    }
  });

  it("takes the first Listing that has a street address", () => {
    const forst = { __typename: "Listing", id: "1" }; // teaser without address
    const andra = { __typename: "Listing", streetAddress: "Rätt 2", id: "2" };
    const payload = `a:{"object":${JSON.stringify(forst)}} b:{"object":${JSON.stringify(andra)}}`;
    const html = `<script>self.__next_f.push(${JSON.stringify([1, payload])})</script>`;
    const r = tolkaBooli(html, "u");
    expect(r.typ === "ok" && r.uppgifter.adress).toBe("Rätt 2");
  });

  it("saknas lists exactly the ANNONS_FALT keys absent from uppgifter", () => {
    const r = tolkaBooli(sida({ listing: { streetAddress: "Bara adress 1" } }), "u");
    if (r.typ !== "ok") throw new Error("ok expected");
    expect(r.uppgifter).toEqual({ adress: "Bara adress 1" });
    expect(r.saknas).toEqual(ANNONS_FALT.filter((f) => f !== "adress"));
  });
});

describe("tolkaBooli: failures", () => {
  it("RSC scripts removed but JSON-LD kept: tolkning_misslyckad with delvis", () => {
    const html = las("bostad-719044.html").replace(
      /<script[^>]*>\s*self\.__next_f\.push\([\s\S]*?\)\s*<\/script>/g,
      "",
    );
    expect(html).not.toContain("__next_f.push");
    const r = tolkaBooli(html, "u");
    expect(r).toEqual({
      typ: "tolkning_misslyckad",
      orsak: expect.any(String),
      delvis: {
        adress: "Sandelsgatan 35",
        postnummer: "115 33",
        utgangspris: 4500000,
        forening: "BRF Sandelsgatan 35 i Stockholm",
      },
    });
  });

  it("a page without any structured data gives an empty delvis", () => {
    expect(tolkaBooli("<html><body>Hej</body></html>", "u")).toEqual({
      typ: "tolkning_misslyckad",
      orsak: expect.any(String),
      delvis: {},
    });
  });

  it("a Listing without a street address is not accepted", () => {
    const r = tolkaBooli(sida({ listing: { rent: { raw: 1, unit: "kr/mån" } } }), "u");
    expect(r.typ).toBe("tolkning_misslyckad");
  });

  it("truncated HTML never throws (cut at many points, incl. inside the Listing)", () => {
    const html = las("bostad-720821.html");
    const mitt = html.indexOf("listPrice");
    expect(mitt).toBeGreaterThan(0);
    for (const snitt of [mitt, mitt + 5, mitt - 1000, 100, 0, html.length - 1]) {
      const r = tolkaBooli(html.slice(0, snitt), "u");
      expect(["ok", "tolkning_misslyckad", "blockerad"]).toContain(r.typ);
    }
    expect(tolkaBooli(html.slice(0, mitt), "u").typ).toBe("tolkning_misslyckad");
    for (let snitt = 0; snitt < html.length; snitt += 7919) {
      expect(() => tolkaBooli(html.slice(0, snitt), "u")).not.toThrow();
    }
  });

  it("a Listing cut in the middle of the stream is not parsed", () => {
    const hel = sida({ listing: GRUND });
    const snitt = hel.indexOf("rooms");
    const r = tolkaBooli(hel.slice(0, snitt), "u");
    expect(r.typ).toBe("tolkning_misslyckad");
  });

  it("garbage input never throws", () => {
    const skrap = [
      "",
      " ",
      "<",
      "<script>",
      "<script>self.__next_f.push(</script>",
      "<script>self.__next_f.push([1,</script>",
      "<script>self.__next_f.push([1,5])</script>",
      "<script>self.__next_f.push(null)</script>",
      '<script>self.__next_f.push([1,"\\"object\\":{\\"__typename\\":\\"Listing\\""])</script>',
      `<script>self.__next_f.push([1,${JSON.stringify('"object":{"__typename":"Listing","streetAddress":')}])</script>`,
      '<script type="application/ld+json"></script>',
      '<script type="application/ld+json">null</script>',
      '<script type="application/ld+json">[null,1,"x",{"@type":"Place","address":5}]</script>',
      '<script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":5}</script>',
      "\u0000￿",
      "x".repeat(200_000),
    ];
    for (const s of skrap) {
      expect(() => tolkaBooli(s, "u")).not.toThrow();
      expect(tolkaBooli(s, "u").typ).not.toBe("ok");
    }
    for (const s of [undefined, null, 5, {}] as unknown[]) {
      expect(() => tolkaBooli(s as string, "u")).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// The values must be accepted by the form's parsers once formatted
// ---------------------------------------------------------------------------

/** Recommended formatting for the form fields: plain digits, "," as decimal
 *  separator for non-integers (the form's own convention), no thousand spaces
 *  needed (the parsers also accept them). */
function tillFormular(n: number): string {
  return String(n).replace(".", ",");
}

/** What a Swedish user might see or paste: thousand separators (NBSP). */
function tillSvenskText(n: number): string {
  return n.toLocaleString("sv-SE").replace(/−/g, "-");
}

describe("form round trip", () => {
  it("every numeric field of every fixture parses back to the same number", () => {
    for (const f of FORVANTAT) {
      const r = tolkaBooli(las(f.fil), f.url);
      if (r.typ !== "ok") throw new Error(f.fil);
      const u = r.uppgifter;
      for (const falt of ["utgangspris", "manadsavgift", "boarea", "antalRum", "byggar"] as const) {
        const v = u[falt];
        if (v === undefined) continue;
        expect(parsePositivtTal(tillFormular(v))).toBe(v);
        expect(parsePositivtTal(tillSvenskText(v))).toBe(v);
      }
      if (u.vaning !== undefined) {
        expect(parseVaning(tillFormular(u.vaning))).toBe(u.vaning);
      }
    }
  });

  it("floor 0 survives parseVaning (parsePositivtTal would reject it)", () => {
    expect(parseVaning(tillFormular(0))).toBe(0);
    expect(parsePositivtTal("0")).toBeNull();
  });

  it("formats: 73.6 -> '73,6', 2.5 -> '2,5', 4500000 -> '4500000'", () => {
    expect(tillFormular(73.6)).toBe("73,6");
    expect(tillFormular(2.5)).toBe("2,5");
    expect(tillFormular(4500000)).toBe("4500000");
    expect(parsePositivtTal("73,6")).toBe(73.6);
    expect(parsePositivtTal("2,5")).toBe(2.5);
  });
});
