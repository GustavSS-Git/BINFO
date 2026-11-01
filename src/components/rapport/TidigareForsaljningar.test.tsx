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
    {
      saldDatum: "2026-10-15",
      pris: 5_950_000,
      boarea: 54,
      antalRum: 2,
      vaning: 3,
      avgift: null,
      dennaLagenhet: true,
    },
    {
      saldDatum: "2020-01-03",
      pris: 4_200_000,
      boarea: 54,
      antalRum: 2,
      vaning: 3,
      avgift: 2950,
      dennaLagenhet: false,
    },
  ],
};

describe("TidigareForsaljningar", () => {
  it("renders the table, footnote and attribution", () => {
    const html = renderToStaticMarkup(<TidigareForsaljningar svar={svar} />);
    expect(html).toContain('data-slot="tidigare-forsaljningar"');
    expect(html).toContain("Sålda lägenheter på Sankt Eriksgatan 31A");
    expect(html.match(/Den här lägenheten/g)).toHaveLength(1);
    expect(html).not.toContain("Visa alla");
    expect(html).toContain("okt 2026");
    expect(html).toContain("jan 2020");
    expect(html).toContain("Äldre priser är inte justerade");
    expect(html).toContain("Uppgifter från Booli");
  });

  it("shows five rows and 'Visa alla (n)' when there are more", () => {
    const manga: ForsaljningarSvar = {
      ok: true,
      adress: "X 1",
      forsaljningar: Array.from({ length: 8 }, (_, i) => ({
        saldDatum: `2025-0${i + 1}-01`,
        pris: 1_000_000 + i,
        boarea: 50,
        antalRum: 2,
        vaning: 1,
        avgift: null,
        dennaLagenhet: false,
      })),
    };
    const html = renderToStaticMarkup(<TidigareForsaljningar svar={manga} />);
    expect(html.match(/<tr class="grid/g)).toHaveLength(5);
    expect(html).toContain("Visa alla (8)");
    expect(html).toContain('aria-expanded="false"');
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
