import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { POSTNORD_POSTNUMMER_URL } from "@/lib/postnummer/typer";

// Routing och serveranrop är inte under test: bara vad som ritas.
const sokning = { current: {} as Record<string, unknown> };
const redirectKast = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: object) => ({ ...opts, useSearch: () => sokning.current }),
  redirect: (o: unknown) => ({ redirect: o }),
  Link: ({ children, to }: { children?: unknown; to: string }) => (
    <a href={to}>{children as never}</a>
  ),
  useNavigate: () => () => Promise.resolve(),
}));
vi.mock("@/server/analysFn", () => ({
  hamtaAnnonsFn: vi.fn(),
  hamtaPostnummerInfoFn: vi.fn(),
  hamtaPrisuppskattningFn: vi.fn(),
  hamtaRegisterForeningFn: vi.fn(),
  hamtaSparadVarderingFn: vi.fn(),
  hamtaSessionFn: vi.fn(),
  skapaAnalysFn: vi.fn(),
  skapaAnalysFranRegisterFn: vi.fn(),
  sparaVarderingFn: vi.fn(),
}));

const servern = await import("@/server/analysFn");
const { Route } = await import("@/routes/analysera");
const Sida = (Route as unknown as { component: () => React.ReactElement }).component;
const { Route: VarderingRoute } = await import("@/routes/vardering");

const rita = () =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <Sida />
    </QueryClientProvider>,
  ).replace(/\s+/g, " ");

describe("/analysera: priskoll och BRF-analys på en sida", () => {
  it("visar båda stegen, med årsredovisningen som valfritt steg 2", () => {
    sokning.current = {};
    const html = rita();
    expect(html).toContain("Steg 1: Priskoll");
    expect(html).toContain("Gratis och direkt, ingen uppladdning");
    expect(html).toContain("Se värderingen");
    expect(html).toContain("Steg 2: Granska föreningen (valfritt)");
    expect(html).toContain("Dra och släpp årsredovisningen här");
    expect(html).toContain(">Analysera<");
    // Adress hör till steg 2 (ort har inget fält, ägarbeslut 2026-10-26); resten av fälten finns bara en gång.
    expect(html).toContain("Adress");
    expect(html).not.toContain("falt-ort");
    expect(html).not.toMatch(/>Ort</);
    expect(html.match(/placeholder="116 25"/g)).toHaveLength(1);
    expect(html.match(/placeholder="58"/g)).toHaveLength(1);
    expect(html).toContain('id="vet-ej"');
  });

  it("har Booli-länkfältet och knappen före Steg 1, och rendering anropar ingen serverfunktion", () => {
    sokning.current = {};
    const html = rita();
    const lank = html.indexOf("Klistra in länk från Booli");
    expect(lank).toBeGreaterThan(-1);
    expect(html).toContain("Hämta uppgifter");
    expect(html).toContain('placeholder="https://www.booli.se/annons/…"');
    expect(html.indexOf("Hämta uppgifter")).toBeLessThan(html.indexOf("Steg 1: Priskoll"));
    expect(lank).toBeLessThan(html.indexOf("Steg 1: Priskoll"));
    // Ingen hämtning har gjorts: inga hint eller markeringar på fälten.
    expect(html).not.toContain("Hämtat från Booli");
    expect(html).not.toContain("Fanns inte i annonsen");
    expect(html).not.toContain("Booli anger föreningen");
    for (const fn of Object.values(servern)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("har PostNord-länken för postnummer, utan hint eller serveranrop vid rendering", () => {
    sokning.current = {};
    const html = rita();
    expect(html).toContain("Vet du inte postnumret? Sök hos PostNord");
    expect(html).toContain(POSTNORD_POSTNUMMER_URL);
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("Område:");
    expect(servern.hamtaPostnummerInfoFn).not.toHaveBeenCalled();
  });

  it("länkar inte längre till den gamla priskollssidan", () => {
    sokning.current = {};
    const html = rita();
    expect(html).not.toContain("/vardering");
    expect(html).not.toContain("Bara priskoll");
  });

  it("?sparad= visar den sparade värderingen i stället för stegen", () => {
    sokning.current = { sparad: "abc" };
    const html = rita();
    expect(html).toContain("Hämtar den sparade värderingen");
    expect(html).not.toContain("Steg 1: Priskoll");
  });
});

describe("/vardering: omdirigering till /analysera", () => {
  const opts = VarderingRoute as unknown as {
    validateSearch: (s: Record<string, unknown>) => Record<string, unknown>;
    beforeLoad: (a: { search: Record<string, unknown> }) => void;
  };
  const kor = (rattSok: Record<string, unknown>) => {
    try {
      opts.beforeLoad({ search: opts.validateSearch(rattSok) });
    } catch (e) {
      redirectKast.current = e;
    }
    return (redirectKast.current as { redirect: Record<string, unknown> }).redirect;
  };

  it("301 till /analysera och bär över sparad", () => {
    expect(kor({ sparad: "x" })).toEqual({
      to: "/analysera",
      search: { sparad: "x" },
      statusCode: 301,
    });
  });

  it("bär över spara och släpper skräp", () => {
    expect(kor({ spara: "vardering", annat: "1" })).toEqual({
      to: "/analysera",
      search: { spara: "vardering" },
      statusCode: 301,
    });
    expect(kor({})).toEqual({ to: "/analysera", search: {}, statusCode: 301 });
  });
});
