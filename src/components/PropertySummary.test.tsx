import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PropertySummary } from "@/components/PropertySummary";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import type { Faltjamforelse, PropertyInput } from "@/types/analysis";

const rita0 = (input: PropertyInput, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <PropertySummary input={input} foreningNamn="Brf Test" skapad="2026-10-12" {...extra} />,
  ).replace(/[\s\u00a0]+/g, " ");

describe("PropertySummary — rapportens huvud", () => {
  it("eyebrow med datum, adressen som h1 och metaraden med utgångspriset", () => {
    const html = rita0(sampleAnalysis.input, { omrade: "Kungsholmen" });
    expect(html).toContain("Rapport · analyserad 12 okt. 2026");
    expect(html).toMatch(/<h1[^>]*>Baltzar von Platens gata 6<\/h1>/);
    expect(html).toContain(
      "Brf Test · Kungsholmen · 2 rum · 48 m² · våning 4 · avgift 3 503 kr/mån · utgångspris 4 995 000 kr · byggår 1931",
    );
  });

  it("utelämnar utgångspris, våning och område helt när de saknas", () => {
    const { utgangspris: _u, vaning: _v, ...utan } = sampleAnalysis.input;
    const html = rita0(utan);
    expect(html).not.toContain("utgångspris");
    expect(html).not.toContain("våning");
    expect(html).toContain("Brf Test · 2 rum · 48 m² · avgift");
    expect(html).not.toContain("undefined");
  });

  it("raderad adress: h1 är föreningens namn som inte upprepas i metaraden", () => {
    const html = rita0({ ...sampleAnalysis.input, adress: "" }, { omrade: "Kungsholmen" });
    expect(html).toMatch(/<h1[^>]*>Brf Test<\/h1>/);
    expect(html).toContain("Kungsholmen · 2 rum");
    expect(html).not.toContain("Brf Test · Kungsholmen");
  });

  it("åtgärderna ligger i huvudet", () => {
    const html = renderToStaticMarkup(
      <PropertySummary input={sampleAnalysis.input} foreningNamn="Brf Test" skapad="2026-10-12">
        <button>KNAPP-A</button>
      </PropertySummary>,
    );
    expect(html).toContain("KNAPP-A");
    expect(html.indexOf("KNAPP-A")).toBeGreaterThan(html.indexOf("<h1"));
  });
});

describe("PropertySummary — byggårsmarkör", () => {
  const byggar = (r: Partial<Faltjamforelse>): Faltjamforelse => ({
    falt: "byggar",
    label: "Byggår",
    status: "bekraftat",
    anvant: 1962,
    text: "FORKLARING",
    ...r,
  });
  const rita = (
    rad?: Faltjamforelse,
    input: PropertyInput = { ...sampleAnalysis.input, byggar: 1962 },
  ) =>
    renderToStaticMarkup(
      <PropertySummary
        input={input}
        foreningNamn="Brf Test"
        skapad="2026-10-12"
        byggarJamforelse={rad}
      />,
    );

  it("bekräftat (äldre data): ingen 'Bekräftat'-markör, bara året", () => {
    const html = rita(
      byggar({ anvandare: 1962, rapport: 1962, ref: { page: 4, excerpt: "Värdeåret 1962" } }),
    );
    expect(html).toContain("1962");
    expect(html).not.toContain("Bekräftat");
    expect(html).not.toContain("✓");
  });

  it("visar bara adressen, aldrig ort", () => {
    const html = rita(undefined, { ...sampleAnalysis.input, ort: "Stockholm" });
    expect(html).toContain(sampleAnalysis.input.adress);
    expect(html).not.toContain(`${sampleAnalysis.input.adress}, `);
    const { ort: _o, ...utanOrt } = sampleAnalysis.input;
    expect(rita(undefined, utanOrt)).toContain(sampleAnalysis.input.adress);
    expect(rita(undefined, utanOrt)).not.toContain("undefined");
  });

  it("värdeår: årsredovisningens utdrag säger det", () => {
    const { byggar: _b, ...utanByggar } = sampleAnalysis.input;
    const html = rita(
      byggar({
        status: "endast_rapport",
        rapport: 1931,
        anvant: 1931,
        ref: { page: 2, excerpt: "Värdeår 1931" },
      }),
      utanByggar,
    );
    expect(html).toContain("värdeår 1931 enligt årsredovisningen");
  });

  it("avviker: visar årsredovisningens år och avvikelsen synligt, inte bara i tooltip", () => {
    const html = rita(
      byggar({
        status: "avviker",
        anvandare: 1962,
        rapport: 1974,
        anvant: 1974,
        ref: { page: 3 },
      }),
    );
    expect(html).toContain("1974");
    expect(html).toContain("Avviker");
    expect(html).toContain("Årsredovisningen: 1974 (du angav 1962) · s. 3");
    expect(html).toContain('<span class="sr-only">FORKLARING');
  });

  it("endast_rapport: årsredovisningens år med markören 'Från årsredovisningen'", () => {
    const { byggar: _b, ...utanByggar } = sampleAnalysis.input;
    const html = rita(
      byggar({ status: "endast_rapport", rapport: 1958, anvant: 1958 }),
      utanByggar,
    );
    expect(html).toContain("byggår 1958 enligt årsredovisningen");
    expect(html).not.toContain("Okänt");
  });

  it("manuellt och ingen rad: användarens år utan markör", () => {
    for (const rad of [byggar({ status: "manuellt", anvandare: 1962 }), undefined]) {
      const html = rita(rad);
      expect(html).toContain("1962");
      expect(html).not.toContain("Bekräftat");
      expect(html).not.toContain("Avviker");
      expect(html).not.toContain("sr-only");
      expect(html).not.toContain("title=");
    }
  });
});
