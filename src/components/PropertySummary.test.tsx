import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PropertySummary } from "@/components/PropertySummary";
import { sampleAnalysis } from "@/data/sampleAnalysis";

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
