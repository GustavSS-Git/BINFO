import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Prisrimlighet } from "@/components/AnalysRapport";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import { andelAvSkuldRad } from "@/lib/analysisView";
import type { PrisanalysUtanForening } from "@/types/analysis";

/** sv-SE tusentalsavgränsare är ett hårt mellanslag; jämför med vanliga. */
const plattaUt = (html: string) => html.replace(/\s/g, " ");

describe("Prisrimlighet — delad av rapporten och priskollen på /analysera", () => {
  it("visar prisjämförelsen när utgångspris finns", () => {
    const html = plattaUt(
      renderToStaticMarkup(
        <Prisrimlighet
          prisanalys={sampleAnalysis.prisanalys}
          boarea={sampleAnalysis.input.boarea}
        />,
      ),
    );
    expect(html).toContain("Är priset rimligt?");
    expect(html).toContain("Utgångspris");
    expect(html).toContain("Utgångspriset ligger");
    // Price per m² is a small line under each price, not its own row (owner 2026-10-26):
    // the asking price exactly (4 995 000 / 48), the estimates from the SHOWN value.
    expect(html).not.toContain("Pris per kvadratmeter");
    expect(html).toContain("104 063 kr/m²");
    expect(html).toContain("ca 118 300 kr/m²"); // 5 680 000 / 48
    expect(html).toContain("ca 115 600 kr/m²"); // 5 550 000 / 48
  });

  it("visar inget kvadratmeterpris för värderingen utan boarea", () => {
    const html = plattaUt(
      renderToStaticMarkup(<Prisrimlighet prisanalys={sampleAnalysis.prisanalys} />),
    );
    expect(html).not.toContain("ca 118 300 kr/m²");
  });

  it("utelämnar prisraderna och jämförelsen utan utgångspris, men visar värderingen", () => {
    const {
      utgangspris: _u,
      prisPerM2: _p,
      avvikelseMotVardering: _a,
      ...utanPris
    }: PrisanalysUtanForening = sampleAnalysis.prisanalys;
    const html = plattaUt(renderToStaticMarkup(<Prisrimlighet prisanalys={utanPris} />));
    expect(html).toContain("Binfos värdering");
    expect(html).not.toContain("Är priset rimligt?");
    expect(html).not.toContain("Pris per kvadratmeter");
    expect(html).not.toContain("(jämfört per m²)");
    // Displayed valuations are rounded to 10 000 kr, with the ±10 % span under it.
    expect(html).toContain("5 680 000 kr");
    expect(html).not.toContain("5 681 607");
    // The span sits under the MAIN value: the adjusted one (5 547 498 → 4 990 000 – 6 100 000).
    expect(html).toContain("5 550 000 kr");
    expect(html).toContain("Ungefärligt spann (±10 %): 4 990 000 – 6 100 000 kr");
  });

  it("behåller leverantörsraden dold; det dolda 90 %-spannet är ersatt av det synliga ±10 %-spannet", () => {
    const html = renderToStaticMarkup(<Prisrimlighet prisanalys={sampleAnalysis.prisanalys} />);
    const dolda = html.match(/<(p|div) class="hidden[^"]*">/g) ?? [];
    expect(dolda.length).toBe(1);
    expect(html).not.toContain("Sannolikt mellan");
    expect(html).toContain('data-slot="vardespann"');
  });

  it("visar skuldraden separat, med sidhänvisning, bara när den skickas in", () => {
    const analys = {
      ...sampleAnalysis,
      prisanalys: {
        ...sampleAnalysis.prisanalys,
        andelAvForeningensSkuld: {
          value: 485_460,
          unit: "kr" as const,
          source: "berakning" as const,
          ref: { page: 9 },
        },
      },
    };
    const med = plattaUt(
      renderToStaticMarkup(
        <Prisrimlighet prisanalys={analys.prisanalys} skuldrad={andelAvSkuldRad(analys)} />,
      ),
    );
    expect(med).toContain("Ingår inte i värderingen.");
    expect(med).toContain("s. 9");
    const utan = plattaUt(renderToStaticMarkup(<Prisrimlighet prisanalys={analys.prisanalys} />));
    expect(utan).not.toContain("Ingår inte i värderingen.");
  });

  it("markerar skuldraden Osäker med orsaken som hovertext", () => {
    const html = renderToStaticMarkup(
      <Prisrimlighet
        prisanalys={sampleAnalysis.prisanalys}
        skuldrad={{ text: "Rad.", osaker: "Verkar vara tusental." }}
      />,
    );
    expect(html).toContain('title="Verkar vara tusental."');
    expect(html).toContain("Osäker");
  });
});

describe("Prisrimlighet — %-raden följer spannet", () => {
  it("utan justerat värde: inom spannet är raden neutral, utanför är den över/under med färg", () => {
    const {
      justeradVardering: _j,
      justeringar: _g,
      avvikelseMotJusteradVardering: _a,
      ...bas
    } = sampleAnalysis.prisanalys;
    const inom = renderToStaticMarkup(
      <Prisrimlighet
        prisanalys={{
          ...bas,
          utgangspris: { value: 5_400_000, unit: "kr", source: "anvandare" },
          avvikelseMotVardering: -4.9,
        }}
      />,
    );
    expect(inom).toContain("4,9 % under värdet, inom spannet");
    expect(inom).not.toContain('text-success">Utgångspriset');
    const utanfor = renderToStaticMarkup(
      <Prisrimlighet
        prisanalys={{
          ...bas,
          utgangspris: { value: 4_000_000, unit: "kr", source: "anvandare" },
          avvikelseMotVardering: -29.6,
        }}
      />,
    );
    expect(utanfor).toContain('text-success">Utgångspriset ligger 29,6 % under (jämfört per m²)');
  });
});
