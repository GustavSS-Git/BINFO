import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Länkarna och navigeringen renderas utanför en router i testet.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: unknown; to: string }) => (
    <a href={to}>{children as never}</a>
  ),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ history: { push: vi.fn() } }),
}));
// Inga serverfunktioner i en komponenttest.
vi.mock("@/server/analysFn", () => ({
  forberedSparaAnalysFn: vi.fn(),
  hamtaSparstatusFn: vi.fn(),
  sparaAnalysFn: vi.fn(),
  hamtaSessionFn: vi.fn(),
}));

const { SparaAnalysVy } = await import("@/components/konto/SparaAnalys");
const { SPARA_ANALYS_KNAPP, SPARAD_I_PROFIL_TEXT } = await import("@/components/konto/kontoText");
const { SparaKnappVy } = await import("@/components/konto/SparaKnappVy");
const { AnalysRapport } = await import("@/components/AnalysRapport");
const { sampleAnalysis } = await import("@/data/sampleAnalysis");

type Vy = Parameters<typeof SparaAnalysVy>[0];

/** The real button view, logged out, as the page passes it (no tip text). */
const knapp = () => (
  <SparaKnappVy
    sessionLage="utloggad"
    lage="vilar"
    fel={null}
    etikettKnapp={SPARA_ANALYS_KNAPP}
    utloggadTips={null}
    onKlick={() => {}}
  />
);

const rita = (p: Partial<Vy>) =>
  renderToStaticMarkup(
    <SparaAnalysVy
      variant="topp"
      sparstatus={undefined}
      aterstall={{ typ: "ingen" }}
      knapp={knapp}
      {...p}
    />,
  );

describe("SparaAnalysVy", () => {
  it("utloggad, analysen är den här webbläsarens: knappen överst och en tydligare ruta i slutet", () => {
    const topp = rita({ sparstatus: "kan_sparas" });
    expect(topp).toContain("Spara analysen");
    expect(topp).toContain("<button");
    expect(topp).not.toContain("Du behöver ett konto");

    const kort = rita({ variant: "kort", sparstatus: "kan_sparas" });
    expect(kort).toContain("Spara analysen i din profil");
    expect(kort).toContain("analysen görs inte om");
    expect(kort).toContain("<button");
  });

  it("inloggad ägare: 'Sparad i din profil' med länk till Mitt konto, ingen knapp och ingen slutruta", () => {
    const topp = rita({ sparstatus: "sparad" });
    expect(topp).toContain("Sparad i din profil");
    expect(topp).toContain('href="/konto"');
    expect(topp).not.toContain("<button");
    expect(rita({ variant: "kort", sparstatus: "sparad" })).toBe("");
  });

  it("någon annans analys (ingen), eller medan svaret laddas: ingenting", () => {
    for (const sparstatus of ["ingen", undefined] as const) {
      expect(rita({ sparstatus })).toBe("");
      expect(rita({ variant: "kort", sparstatus })).toBe("");
    }
  });

  it("återkomsten med ?spara=analys: sparar…, sedan 'Analysen är sparad i din profil.'", () => {
    expect(rita({ sparstatus: "kan_sparas", aterstall: { typ: "sparar" } })).toContain(
      "Sparar analysen…",
    );
    expect(rita({ variant: "kort", sparstatus: "kan_sparas", aterstall: { typ: "sparar" } })).toBe(
      "",
    );
    const klar = rita({ sparstatus: "sparad", aterstall: { typ: "sparad" } });
    expect(SPARAD_I_PROFIL_TEXT).toBe("Analysen är sparad i din profil.");
    expect(klar).toContain(SPARAD_I_PROFIL_TEXT);
    expect(klar).toContain('href="/konto"');
    expect(rita({ variant: "kort", aterstall: { typ: "sparad" } })).toBe("");
  });

  it("ett nekat sparande visar serverns text; knappen finns kvar om analysen fortfarande kan sparas", () => {
    const html = rita({
      sparstatus: "kan_sparas",
      aterstall: { typ: "fel", meddelande: "Analysen kunde inte sparas i din profil." },
    });
    expect(html).toContain("Analysen kunde inte sparas i din profil.");
    expect(html).toContain("<button");
    expect(
      rita({ sparstatus: "ingen", aterstall: { typ: "fel", meddelande: "Nekad." } }),
    ).toContain("Nekad.");
  });
});

describe("AnalysRapport sparaSlot", () => {
  it("renderas under betygskortet, och saknas helt utan slot (/exempel)", () => {
    const med = renderToStaticMarkup(
      <AnalysRapport analys={sampleAnalysis} sparaSlot={<p>SLOT-HAR</p>} />,
    );
    const betyg = med.indexOf("Sammanvägt riskbetyg");
    const slot = med.indexOf("SLOT-HAR");
    expect(betyg).toBeGreaterThan(-1);
    expect(slot).toBeGreaterThan(betyg);
    expect(slot).toBeLessThan(med.indexOf("Föreningens ekonomi"));
    expect(renderToStaticMarkup(<AnalysRapport analys={sampleAnalysis} />)).not.toContain(
      "SLOT-HAR",
    );
  });
});
