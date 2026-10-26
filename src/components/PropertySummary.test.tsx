import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PropertySummary } from "@/components/PropertySummary";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import type { Faltjamforelse, PropertyInput } from "@/types/analysis";

describe("PropertySummary — utgångspris är valfritt", () => {
  it("visar Utgångspris-raden när priset finns", () => {
    const html = renderToStaticMarkup(
      <PropertySummary input={sampleAnalysis.input} foreningNamn="Brf Test" skapad="2026-10-12" />,
    );
    expect(html).toContain("Utgångspris");
    expect(html).toContain("md:grid-cols-5");
  });

  it("utelämnar raden helt när priset saknas", () => {
    const { utgangspris: _u, ...utanPris } = sampleAnalysis.input;
    const html = renderToStaticMarkup(
      <PropertySummary input={utanPris} foreningNamn="Brf Test" skapad="2026-10-12" />,
    );
    expect(html).not.toContain("Utgångspris");
    expect(html).toContain("Boarea");
    expect(html).toContain("md:grid-cols-4");
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
    expect(html).toContain("Värdeår enligt årsredovisningen");
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
    expect(html).toContain("1958");
    expect(html).toContain("Från årsredovisningen");
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
