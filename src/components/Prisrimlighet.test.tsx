import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Prisrimlighet } from "@/components/AnalysRapport";
import { Pagar } from "@/components/AnalysStatus";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import { andelAvSkuldRad } from "@/lib/analysisView";
import type { PrisanalysUtanForening } from "@/types/analysis";

/** sv-SE tusentalsavgränsare är ett hårt mellanslag; jämför med vanliga. */
const plattaUt = (html: string) => html.replace(/\s/g, " ");

describe("Prisrimlighet — delad av rapporten och /vardering", () => {
  it("visar prisjämförelsen när utgångspris finns", () => {
    const html = plattaUt(
      renderToStaticMarkup(<Prisrimlighet prisanalys={sampleAnalysis.prisanalys} />),
    );
    expect(html).toContain("Är priset rimligt?");
    expect(html).toContain("Utgångspris");
    expect(html).toContain("Pris per kvadratmeter");
    expect(html).toContain("Utgångspriset ligger");
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
    expect(html).toContain("2 365 580 kr");
  });

  it("behåller de ägardolda elementen dolda (leverantör, spann, drivarnas förbehåll)", () => {
    const html = renderToStaticMarkup(<Prisrimlighet prisanalys={sampleAnalysis.prisanalys} />);
    const dolda = html.match(/<(p|div) class="hidden[^"]*">/g) ?? [];
    expect(dolda.length).toBe(3);
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

describe("Pagar — väntskärmen", () => {
  it("visar stegtexten från rapportSteg", () => {
    const html = renderToStaticMarkup(
      <Pagar status={{ stage: "uploaded", rapportSteg: "identifiering" }} />,
    );
    expect(html).toContain("Identifierar föreningen…");
  });

  it("visar skannad-notisen och 'några minuter extra' bara för en skannad rapport", () => {
    const skannad = plattaUt(
      renderToStaticMarkup(
        <Pagar
          status={{ stage: "uploaded", textlager: "saknas", rapportSteg: "transkribering" }}
        />,
      ),
    );
    expect(skannad).toContain("Skannad årsredovisning upptäckt – analysen tar lite längre tid.");
    expect(skannad).toContain("Läser av de skannade sidorna…");
    expect(skannad).toContain("några minuter extra");

    const vanlig = plattaUt(
      renderToStaticMarkup(<Pagar status={{ stage: "extracting", textlager: "ok" }} />),
    );
    expect(vanlig).not.toContain("Skannad årsredovisning");
    expect(vanlig).not.toContain("några minuter extra");
    expect(vanlig).toContain("3–5 minuter");
    expect(vanlig).toContain("Hämtar de sju nyckeltalen…");
  });

  it("säger att samma årsredovisning analyseras just nu", () => {
    const html = renderToStaticMarkup(
      <Pagar status={{ stage: "uploaded", vantarPaRapport: true }} />,
    );
    expect(html).toContain(
      "Samma årsredovisning analyseras just nu – din analys blir klar samtidigt.",
    );
  });
});
