import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TidigareForsaljningar } from "@/components/rapport/TidigareForsaljningar";
import { buildPdfViewModel } from "@/components/pdf/viewModel";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import type { ForsaljningarSvar } from "@/lib/annons/forsaljningar";

const svar: ForsaljningarSvar = {
  ok: true,
  adress: "Sankt Eriksgatan 31A",
  forsaljningar: [
    { saldDatum: "2026-10-15", pris: 5_950_000, boarea: 54, antalRum: 2, vaning: 3, avgift: null },
    { saldDatum: "2020-01-03", pris: 4_200_000, boarea: 54, antalRum: 2, vaning: 3, avgift: 2950 },
  ],
};

describe("TidigareForsaljningar", () => {
  it("renders the table, footnote and attribution", () => {
    const html = renderToStaticMarkup(<TidigareForsaljningar svar={svar} />);
    expect(html).toContain('data-slot="tidigare-forsaljningar"');
    expect(html).toContain("Tidigare försäljningar av Sankt Eriksgatan 31A");
    expect(html).toContain("okt 2026");
    expect(html).toContain("jan 2020");
    expect(html).toContain("Äldre priser är inte justerade");
    expect(html).toContain("Uppgifter från Booli");
  });

  it("renders nothing for failure or empty", () => {
    expect(renderToStaticMarkup(<TidigareForsaljningar svar={{ ok: false }} />)).toBe("");
    expect(renderToStaticMarkup(<TidigareForsaljningar svar={null} />)).toBe("");
  });
});

describe("PDF view model", () => {
  it("carries the sales only when loaded", () => {
    expect(buildPdfViewModel(sampleAnalysis).forsaljningar).toBeNull();
    const vm = buildPdfViewModel(sampleAnalysis, svar);
    expect(vm.forsaljningar?.rader).toHaveLength(2);
    expect(vm.forsaljningar?.rubrik).toContain("Sankt Eriksgatan 31A");
  });
});
