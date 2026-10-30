import { describe, expect, it } from "vitest";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import {
  SITE_URL,
  foreningBeskrivning,
  foreningJsonLd,
  foreningTitel,
  jsonLdScripts,
  nastaListaSearch,
  omradeBrodsmulor,
  parseListaSearch,
  sidHead,
  type RegisterArsSammanfattning,
  type RegisterForeningVy,
} from "@/lib/registerVy";
import { STATISKA_SIDOR, byggSitemapXml, lastmodDatum } from "@/lib/sitemap";

const senaste: RegisterArsSammanfattning = {
  rakenskapsar: 2025,
  analysdatum: "2026-10-13T10:00:00.000Z",
  betyg: sampleAnalysis.betyg,
  betygMotivering: null,
  nyckeltal: sampleAnalysis.forening.keyFigures.map((k) => ({
    id: k.id,
    label: k.label,
    figure: k.figure,
    status: k.status,
  })),
  skannad: false,
  aldreVersion: false,
};

const vy: RegisterForeningVy = {
  slug: "brf-pontonjaren-3-716420-0599",
  orgnr: "716420-0599",
  namn: "Brf Pontonjären 3",
  omrade: { slug: "kungsholmen", namn: "Kungsholmen" },
  adresser: [{ gatuadress: "Baltzar von Platens gata 6", postnummer: "112 42", ort: "Stockholm" }],
  senaste,
  tidigare: [],
};

describe("foreningTitel / foreningBeskrivning", () => {
  it("följer mönstret 'Namn, Område: nyckeltal och analys | Binfo'", () => {
    expect(foreningTitel("Brf Pontonjären 3", "Kungsholmen")).toBe(
      "Brf Pontonjären 3, Kungsholmen: nyckeltal och analys | Binfo",
    );
    expect(foreningTitel("Brf X", null)).toBe("Brf X: nyckeltal och analys | Binfo");
  });

  it("har riktiga siffror och år, och är högst 160 tecken", () => {
    const text = foreningBeskrivning(vy);
    expect(text.length).toBeLessThanOrEqual(160);
    expect(text).toContain("2025");
    expect(text).toMatch(/skuld [\d\s]+ kr\/kvm/);
    expect(text).toMatch(/sparande [\d\s-]+ kr\/kvm/);
    expect(text).toContain(`Riskbetyg ${sampleAnalysis.betyg}`);
  });

  it("påstår inget om röda flaggor eller frågor, och tål saknade nyckeltal", () => {
    const text = foreningBeskrivning({ ...vy, senaste: { ...senaste, nyckeltal: [] } });
    expect(text).not.toMatch(/flagg|fråg/i);
    expect(text).toContain("2025");
    expect(text).not.toMatch(/kr\/kvm/);
  });
});

describe("JSON-LD", () => {
  it("ger Organization (taxID, adress) och BreadcrumbList som går att parsa", () => {
    const block = foreningJsonLd(vy);
    const skript = jsonLdScripts(block);
    expect(skript).toHaveLength(2);
    const [org, krum] = skript.map((s) => JSON.parse(s.children));
    expect(org).toMatchObject({
      "@type": "Organization",
      name: "Brf Pontonjären 3",
      taxID: "716420-0599",
      address: { streetAddress: "Baltzar von Platens gata 6", postalCode: "112 42" },
    });
    expect(krum.itemListElement.map((i: { name: string }) => i.name)).toEqual([
      "BRF-register",
      "Kungsholmen",
      "Brf Pontonjären 3",
    ]);
    expect(krum.itemListElement[2].item).toBe(`${SITE_URL}/brf/brf-pontonjaren-3-716420-0599`);
  });

  it("utelämnar address när adress saknas, och kan inte stänga script-taggen", () => {
    const [org] = foreningJsonLd({ ...vy, adresser: [], namn: "Brf </script><b>" });
    expect(org).not.toHaveProperty("address");
    const [skript] = jsonLdScripts([org!]);
    expect(skript!.children).not.toContain("</script>");
    expect(JSON.parse(skript!.children).name).toBe("Brf </script><b>");
  });

  it("områdessida: BreadcrumbList med två steg", () => {
    expect(omradeBrodsmulor("Kungsholmen", "kungsholmen")["itemListElement"]).toHaveLength(2);
  });
});

describe("sidHead", () => {
  it("ger canonical, og:url/title/description/image och valfri noindex", () => {
    const h = sidHead({ titel: "T", beskrivning: "B", path: "/brf/x" });
    expect(h.links).toEqual([{ rel: "canonical", href: `${SITE_URL}/brf/x` }]);
    const meta = Object.fromEntries(
      h.meta.map((m) => [
        ("property" in m ? m.property : "name" in m ? m.name : "title") as string,
        m,
      ]),
    );
    expect(meta["og:url"]).toMatchObject({ content: `${SITE_URL}/brf/x` });
    expect(meta["og:image"]).toMatchObject({ content: `${SITE_URL}/og.png` });
    expect(meta["og:title"]).toMatchObject({ content: "T" });
    expect(meta["robots"]).toBeUndefined();
    expect(
      sidHead({ titel: "T", beskrivning: "B", path: "/x", noindex: true }).meta,
    ).toContainEqual({ name: "robots", content: "noindex" });
  });
});

describe("parseListaSearch / nastaListaSearch", () => {
  it("släpper bara igenom giltiga värden och skriver inte tillbaka standard", () => {
    expect(parseListaSearch({})).toEqual({});
    expect(
      parseListaSearch({ sok: "  ek ", sortering: "betyg", riktning: "desc", sida: "3" }),
    ).toEqual({ sok: "ek", sortering: "betyg", riktning: "desc", sida: 3 });
    expect(parseListaSearch({ sortering: "drop", riktning: "x", sida: "0", sok: {} })).toEqual({});
    expect(parseListaSearch({ sida: "1" })).toEqual({});
    // The router JSON-parses ?sok=7164200599 into a number.
    expect(parseListaSearch({ sok: 7164200599 })).toEqual({ sok: "7164200599" });
  });

  it("nästa vy behåller sökning och sortering men byter sida", () => {
    expect(nastaListaSearch({ sok: "ek", sortering: "avgift" }, { sida: 2 })).toEqual({
      sok: "ek",
      sortering: "avgift",
      sida: 2,
    });
    expect(nastaListaSearch({ sok: "ek" }, { sok: "" })).toEqual({});
  });
});

describe("sitemap", () => {
  const xml = byggSitemapXml([
    { path: "/brf", lastmod: "2026-10-13T10:00:00.000Z" },
    { path: "/brf/omrade/kungsholmen", lastmod: "2026-10-13T10:00:00.000Z" },
    { path: "/brf/brf-pontonjaren-3-716420-0599", lastmod: "2026-10-13T10:00:00.000Z" },
    { path: "/brf/a&b-1", lastmod: null },
  ]);

  it("är välformad XML med rätt namnrymd och bara listade sidor", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([
      ...STATISKA_SIDOR.map((p) => `${SITE_URL}${p}`),
      `${SITE_URL}/brf`,
      `${SITE_URL}/brf/omrade/kungsholmen`,
      `${SITE_URL}/brf/brf-pontonjaren-3-716420-0599`,
      `${SITE_URL}/brf/a&amp;b-1`,
    ]);
    expect(xml).toContain("<lastmod>2026-10-13</lastmod>");
    expect(xml).not.toMatch(/\/(analys|forhandsvisning|konto)(\/|<)/);
    // Every opening tag is closed.
    expect((xml.match(/<url>/g) ?? []).length).toBe((xml.match(/<\/url>/g) ?? []).length);
  });

  it("lastmodDatum tål skräp", () => {
    expect(lastmodDatum("inte ett datum")).toBeNull();
    expect(lastmodDatum(null)).toBeNull();
  });
});

describe("antalForeningar och kortDatum", () => {
  it("singular för 1, plural annars", async () => {
    const { antalForeningar } = await import("@/lib/registerVy");
    expect(antalForeningar(1)).toBe("1 förening");
    expect(antalForeningar(0)).toBe("0 föreningar");
    expect(antalForeningar(13)).toBe("13 föreningar");
  });

  it("kort datum utan år", async () => {
    const { kortDatum } = await import("@/lib/registerVy");
    expect(kortDatum("2026-10-24T10:00:00.000Z")).toBe("24 okt.");
  });
});
