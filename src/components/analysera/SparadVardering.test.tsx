import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleAnalysis } from "@/data/sampleAnalysis";

const fraga = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => fraga.current }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children?: unknown; to: string }) => (
    <a href={to}>{children as never}</a>
  ),
  useNavigate: () => () => Promise.resolve(),
}));
vi.mock("@/server/analysFn", () => ({
  hamtaPrisuppskattningFn: vi.fn(),
  hamtaSparadVarderingFn: vi.fn(),
}));

const { SparadVardering } = await import("@/components/analysera/SparadVardering");

const plattaUt = (s: string) => s.replace(/\s/g, " ");
const text = (html: string) => plattaUt(html.replace(/<[^>]*>/g, ""));
const rita = () => renderToStaticMarkup(<SparadVardering id="abc" />);

const INPUT = {
  boarea: 48,
  antalRum: 2,
  manadsavgift: 3503,
  postnummer: "112 46",
  hiss: "okant",
  balkong: "nej",
} as const;

function sparad(over: Record<string, unknown> = {}) {
  const {
    justeradVardering: _j,
    justeringar: _g,
    andelAvForeningensSkuld: _s,
    ...bas
  } = sampleAnalysis.prisanalys;
  return {
    isPending: false,
    isError: false,
    data: {
      ok: true,
      vardering: {
        id: "abc",
        etikett: "Baltzar von Platens gata 6",
        skapad: "2026-10-20T10:00:00.000Z",
        modellVersion: "v3.1",
        input: INPUT,
        resultat: {
          schemaVersion: "1.0.0",
          skapad: "2026-10-20T10:00:00.000Z",
          input: INPUT,
          prisanalys: bas,
        },
        ...over,
      },
    },
  };
}

beforeEach(() => {
  fraga.current = {};
});

describe("SparadVardering", () => {
  it("laddar: eyebrow, rubrik och väntetext, plus länkarna", () => {
    fraga.current = { isPending: true };
    const html = rita();
    expect(text(html)).toContain("Sparad värdering");
    expect(text(html)).toContain("Hämtar den sparade värderingen…");
    expect(html).toContain('href="/analysera"');
    expect(html).toContain('href="/konto"');
    expect(text(html)).toContain("Gör en ny värdering");
    expect(text(html)).toContain("Till Mitt konto");
  });

  it("ej inloggad: samma väntetext (omdirigeringen sker i en effekt)", () => {
    fraga.current = {
      isPending: false,
      isError: false,
      data: { ok: false, felKod: "ej_inloggad" },
    };
    expect(text(rita())).toContain("Hämtar den sparade värderingen…");
  });

  it("serverfel och hittades inte", () => {
    fraga.current = { isPending: false, isError: true };
    expect(text(rita())).toContain("Något gick fel. Försök igen om en stund.");
    fraga.current = {
      isPending: false,
      isError: false,
      data: { ok: false, felKod: "hittades_inte", meddelande: "x" },
    };
    expect(text(rita())).toContain("Värderingen hittades inte.");
  });

  it("ögonblicksbilden med namnet som rubrik, datum, Räkna om-knapp och resultatblocket", () => {
    fraga.current = sparad();
    const html = rita();
    const t = text(html);
    expect(html).toMatch(/<h1[^>]*>Baltzar von Platens gata 6<\/h1>/);
    expect(t).toContain("Sparad ");
    expect(t).toContain("(modell v3.1)");
    expect(t).toContain("Räkna om med dagens modell");
    expect(t).toContain("Värdering utan hänsyn till föreningen");
    expect(t).toContain("Värdering i siffror");
    expect(t).not.toContain("i steg 2");
    expect(t).not.toContain("Omräknat med dagens modell");
    // Ingen Prisrimlighet-rubrik längre.
    expect(t).not.toContain("Är priset rimligt?");
  });

  it("en gammal värdering utan byggår kan fortfarande räknas om", () => {
    fraga.current = sparad();
    expect(text(rita())).toContain("Räkna om med dagens modell");
  });

  it("oläsbar ögonblicksbild: callout, och Räkna om finns om uppgifterna går att läsa", () => {
    fraga.current = sparad({ resultat: null });
    const med = text(rita());
    expect(med).toContain("Kan inte visas som den sparades");
    expect(med).toContain("Du kan räkna om den med uppgifterna du angav.");
    expect(med).toContain("Räkna om med dagens modell");
    fraga.current = sparad({ resultat: null, input: null });
    const utan = text(rita());
    expect(utan).toContain("så den kan inte öppnas");
    expect(utan).not.toContain("Räkna om med dagens modell");
  });

  it("utan namn heter sidan 'Sparad värdering'", () => {
    fraga.current = sparad({ etikett: null });
    expect(rita()).toMatch(/<h1[^>]*>Sparad värdering<\/h1>/);
  });
});
