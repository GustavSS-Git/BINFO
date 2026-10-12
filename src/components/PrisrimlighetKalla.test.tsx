import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Prisrimlighet } from "@/components/AnalysRapport";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import type { PrisanalysUtanForening } from "@/types/analysis";

const KALLA =
  "Modellen är tränad på bostadsrättsförsäljningar i Stockholm under perioden januari–augusti 2026, baserade på data från Svensk Mäklarstatistik. Områdesindelningen bygger på data från © OpenStreetMap-bidragsgivare (ODbL), Stockholms stad och GeoNames (CC BY 4.0).";
const RUBRIK = "Exempel på faktorer som påverkar värderingen utöver område:";

function renderaHtml(): string {
  const u = sampleAnalysis.prisanalys.varderingsunderlag;
  if (!u) throw new Error("sampleAnalysis saknar varderingsunderlag");
  const prisanalys: PrisanalysUtanForening = {
    ...sampleAnalysis.prisanalys,
    varderingsunderlag: {
      ...u,
      dataperiod: { fran: "2026-01-01", till: "2026-08-31" },
      drivare: [
        {
          label: "Ett rum till",
          effektProcent: 5.4,
          intervallProcent: { low: 4, high: 6.7 },
          niva: "stad",
        },
        {
          label: "En våning högre",
          effektProcent: 1.7,
          intervallProcent: { low: 1.4, high: 2 },
          niva: "stad",
        },
      ],
    },
  };
  return renderToStaticMarkup(<Prisrimlighet prisanalys={prisanalys} />);
}

describe("Prisrimlighet — källtext och rubrik", () => {
  const html = renderaHtml();

  it("visar källtexten exakt en gång", () => {
    expect(html.split(KALLA).length - 1).toBe(1);
  });

  it("visar rubriken utan versaler", () => {
    expect(html).toContain(RUBRIK);
    const m = html.match(new RegExp(`<p class="([^"]*)">\\s*${RUBRIK}`));
    expect(m).not.toBeNull();
    expect(m?.[1]).not.toContain("uppercase");
  });

  it("visar inga av de borttagna texterna", () => {
    for (const borta of [
      "Bygger på försäljningar",
      "Områdesindelning: Binfos egen",
      "Vad påverkar värderingen",
      "10 kvm större boarea",
    ]) {
      expect(html).not.toContain(borta);
    }
  });
});
