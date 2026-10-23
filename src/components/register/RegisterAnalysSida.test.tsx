import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import type { RegisterAnalysVy } from "@/lib/registerVy";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: unknown; className?: string }) => (
    <a href={to} className={className}>
      {children as never}
    </a>
  ),
  useNavigate: () => () => undefined,
}));

import { RegisterAnalysNekad, RegisterAnalysSida } from "@/components/register/RegisterAnalysSida";

const vy: RegisterAnalysVy = {
  slug: "brf-pontonjaren-3-716420-0599",
  orgnr: "716420-0599",
  namn: "Brf Pontonjären 3",
  omrade: { slug: "kungsholmen", namn: "Kungsholmen" },
  analys: {
    rakenskapsar: 2025,
    analysdatum: "2026-10-13T10:00:00.000Z",
    forening: sampleAnalysis.forening,
    betyg: sampleAnalysis.betyg,
    betygMotivering: sampleAnalysis.betygMotivering,
    rodaFlaggor: sampleAnalysis.rodaFlaggor,
    fragor: sampleAnalysis.fragor.filter((f) => f.ursprung === "analys"),
    datakvalitet: sampleAnalysis.datakvalitet,
    aldreVersion: false,
  },
};

describe("RegisterAnalysSida (hela analysen)", () => {
  const html = renderToStaticMarkup(<RegisterAnalysSida vy={vy} />);

  it("visar motivering, röda flaggor, nyckeltal och frågor", () => {
    expect(html).toContain(sampleAnalysis.betygMotivering);
    const flagga = sampleAnalysis.rodaFlaggor[0]!;
    expect(html).toContain(flagga.titel);
    expect(html).toContain("Föreningens ekonomi");
    expect(html).toContain("Frågor att ställa");
    const fraga = sampleAnalysis.fragor.find((f) => f.ursprung === "analys")!;
    expect(html).toContain(fraga.fraga);
  });

  it("har brödsmulor med 'Analys 2025', länk tillbaka och köparens CTA", () => {
    expect(html).toContain("Analys 2025");
    expect(html).toContain('href="/brf/brf-pontonjaren-3-716420-0599"');
    expect(html).toContain("/analysera?forening=brf-pontonjaren-3-716420-0599");
    expect(html).toContain("Analysera en lägenhet i föreningen");
  });

  it("visar äldre-version-texten när analysen är från en tidigare version", () => {
    const out = renderToStaticMarkup(
      <RegisterAnalysSida vy={{ ...vy, analys: { ...vy.analys, aldreVersion: true } }} />,
    );
    expect(out).toContain("tidigare version av Binfo");
  });
});

describe("RegisterAnalysNekad", () => {
  it("visar beskedet och en länk tillbaka, inte ett fel", () => {
    const html = renderToStaticMarkup(
      <RegisterAnalysNekad slug="brf-x-1" meddelande="Logga in för att se hela analysen." />,
    );
    expect(html).toContain("Logga in för att se hela analysen.");
    expect(html).toContain('href="/brf/brf-x-1"');
  });
});
