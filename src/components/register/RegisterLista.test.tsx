import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: unknown; className?: string }) => (
    <a href={to} className={className}>
      {children as never}
    </a>
  ),
}));

import { ForeningsTabell, SorteraVal, TomtLage } from "@/components/register/RegisterLista";
import {
  SORT_ALTERNATIV,
  sorteringsEtikett,
  sorteringsVarde,
  tolkaSorteringsVarde,
  type RegisterListaSvar,
  type RegisterListrad,
} from "@/lib/registerVy";

const rad = (o: Partial<RegisterListrad>): RegisterListrad => ({
  slug: "brf-pontonjaren-3-716420-0599",
  orgnr: "716420-0599",
  namn: "Brf Pontonjären 3",
  omradeSlug: "kungsholmen",
  omradeNamn: "Kungsholmen",
  rakenskapsar: 2025,
  betyg: "B",
  skuldPerM2Brf: 3617,
  avgiftPerM2: 861,
  sparandePerM2: 125,
  analysdatum: "2026-10-14T10:00:00.000Z",
  ...o,
});

const svar = (o: Partial<RegisterListaSvar> = {}): RegisterListaSvar => ({
  status: "ok",
  omrade: { slug: "kungsholmen", namn: "Kungsholmen" },
  rader: [
    rad({}),
    rad({ orgnr: "1", slug: "brf-startfaltet", namn: "Brf Startfältet", betyg: "D" }),
  ],
  totalt: 2,
  sida: 1,
  sidstorlek: 50,
  sortering: "betyg",
  riktning: "asc",
  sok: "",
  ...o,
});

const rendera = (s: RegisterListaSvar, visaOmrade = false) =>
  renderToStaticMarkup(<ForeningsTabell svar={s} visaOmrade={visaOmrade} onAndra={() => {}} />);

describe("ForeningsTabell", () => {
  const html = rendera(svar());

  it("visar betyget som färgad ruta per rad (B grönt, D rött)", () => {
    expect(html).toContain("bg-grade-b");
    expect(html).toContain("bg-grade-d");
    expect(html).toContain('aria-label="Betyg B"');
    expect(html).not.toContain("Betygsmarke");
  });

  it("har kolumnerna som ritat, med aria-sort på det aktiva sorteringsläget", () => {
    for (const k of [
      "Förening",
      "Betyg",
      "Skuld per m² bostadsrättsyta",
      "Årsavgift per m²",
      "Sparande per m²",
      "Räkenskapsår",
      "Analyserad",
    ]) {
      expect(html).toContain(k);
    }
    expect(html).toMatch(/aria-sort="ascending"[^>]*><button[^>]*>Betyg ↑/);
    expect(html).not.toContain(">Område<");
  });

  it("lägger till Område vid sökning över flera områden", () => {
    expect(rendera(svar(), true)).toContain(">Område<");
  });

  it("räknar i singular: '1 förening'", () => {
    expect(rendera(svar({ rader: [rad({})], totalt: 1 }))).toContain("1 förening<");
    expect(rendera(svar({ rader: [rad({})], totalt: 1 }))).not.toContain("1 föreningar");
  });

  it("sidnavigering när det finns fler än en sida", () => {
    const out = rendera(svar({ totalt: 120, sida: 2 }));
    expect(out).toContain("Sida 2 av 3 · 120 föreningar");
  });
});

describe("Sortera efter", () => {
  it("de fem alternativen mappar till befintliga servernycklar och riktningar", () => {
    expect(SORT_ALTERNATIV.map((a) => [a.etikett, a.sortering, a.riktning])).toEqual([
      ["Betyg (bäst först)", "betyg", "asc"],
      ["Skuld per m² (lägst först)", "skuld_brf", "asc"],
      ["Årsavgift per m² (lägst först)", "avgift", "asc"],
      ["Sparande per m² (högst först)", "sparande", "desc"],
      ["Senast analyserad (nyast först)", "analysdatum", "desc"],
    ]);
  });

  it("värdet går att tolka tillbaka, och skräp avvisas", () => {
    for (const a of SORT_ALTERNATIV) {
      expect(tolkaSorteringsVarde(sorteringsVarde(a.sortering, a.riktning))).toEqual({
        sortering: a.sortering,
        riktning: a.riktning,
      });
    }
    expect(tolkaSorteringsVarde("betyg")).toBeNull();
    expect(tolkaSorteringsVarde("x:asc")).toBeNull();
    expect(tolkaSorteringsVarde("betyg:up")).toBeNull();
  });

  it("ett läge från kolumnrubrik (betyg fallande) får en egen etikett och markeras som valt", () => {
    expect(sorteringsEtikett("betyg", "desc")).toBe("Betyg (sämst först)");
    const html = renderToStaticMarkup(
      <SorteraVal sortering="betyg" riktning="desc" onAndra={() => {}} />,
    );
    expect(html).toContain('<option value="betyg:desc" selected="">Betyg (sämst först)</option>');
    expect(html).toContain("Sortera efter");
  });

  it("det aktuella läget är valt i listan", () => {
    const html = renderToStaticMarkup(
      <SorteraVal sortering="sparande" riktning="desc" onAndra={() => {}} />,
    );
    expect(html).toContain('<option value="sparande:desc" selected="">');
    expect((html.match(/<option/g) ?? []).length).toBe(5);
  });
});

describe("TomtLage", () => {
  it("ger sökmeddelandet vid sökning och en länk till Analysera annars", () => {
    expect(renderToStaticMarkup(<TomtLage sok="abc" />)).toContain("Inga föreningar matchar");
    const tomt = renderToStaticMarkup(<TomtLage sok="" />);
    expect(tomt).toContain("Inga föreningar här ännu");
    expect(tomt).toContain('href="/analysera"');
  });
});
