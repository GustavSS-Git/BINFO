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
  it("visar rubrik, stegindikator och båda stegen i den ritade ordningen", () => {
    sokning.current = {};
    const html = rita();
    expect(html).toContain("Vad är bostaden värd, och hur mår föreningen?");
    expect(html).toContain("Analysera en bostad");
    expect(html).toMatch(/aria-label="Steg"/);
    for (const rubrik of ["Bostaden", "Föreningen", "Rapport"]) expect(html).toContain(rubrik);
    expect(html).toContain("Om bostaden");
    expect(html).toContain("Det här behöver vi för värderingen.");
    expect(html).toContain("Granska föreningen");
    expect(html).toContain(
      "Ladda upp föreningens senaste årsredovisning. Den får du av mäklaren eller styrelsen.",
    );
    expect(html).toContain("Dra hit årsredovisningen, eller välj fil");
    expect(html).toContain("PDF, högst 25 MB");
    expect(html).toContain("Se värderingen utan hänsyn till föreningen");
    expect(html).toContain("Tar några sekunder. Visas här nedanför.");
    expect(html).toContain("Analysera bostaden och föreningen");
    expect(html).toContain("Tar några minuter. Du följer analysen på nästa sida.");
    expect(html.indexOf("Om bostaden")).toBeLessThan(html.indexOf("Granska föreningen"));
  });

  it("säger aldrig gratis eller valfritt, och har inget ortfält", () => {
    sokning.current = {};
    const html = rita();
    expect(html).not.toMatch(/gratis/i);
    expect(html).not.toMatch(/valfri/i);
    expect(html).not.toContain("(om du vet det)");
    expect(html).not.toContain("falt-ort");
    expect(html).not.toMatch(/>Ort</);
  });

  it("har alla fält i steg 1, med adress där och en gång var, samt #vet-ej", () => {
    sokning.current = {};
    const html = rita();
    for (const id of [
      "falt-adress",
      "falt-postnummer",
      "falt-boarea",
      "falt-antalRum",
      "falt-vaning",
      "falt-manadsavgift",
      "falt-byggar",
      "falt-utgangspris",
    ]) {
      expect(html.match(new RegExp(`id="${id}"`, "g"))).toHaveLength(1);
    }
    expect(html).toContain('placeholder="Gatuadress och nummer"');
    expect(html).toContain('placeholder="t.ex. 1965"');
    expect(html).toContain("Fyller du i det jämför vi det med värderingen.");
    expect(html).toContain("Fler uppgifter som ger en säkrare värdering");
    expect(html).toContain('id="vet-ej"');
    // Hiss och Balkong som fältgrupper med förklarande rubrik.
    expect(html).toMatch(/<fieldset[^>]*><legend[^>]*>Hiss/);
    expect(html).toMatch(/<fieldset[^>]*><legend[^>]*>Balkong/);
    expect(html.match(/Vet ej/g)).toHaveLength(2);
  });

  it("har Booli-kortet före Steg 1, och rendering anropar ingen serverfunktion", () => {
    sokning.current = {};
    const html = rita();
    const kort = html.indexOf("Snabbast: hämta från annonsen");
    expect(kort).toBeGreaterThan(-1);
    expect(html).toContain("Länk från Booli");
    expect(html).toContain("Hämta uppgifter");
    expect(html).toContain('placeholder="https://www.booli.se/annons/…"');
    expect(html).toContain("Klistra in länken till annonsen så fyller vi i uppgifterna åt dig.");
    expect(kort).toBeLessThan(html.indexOf("Om bostaden"));
    // Ingen hämtning har gjorts: inga märken eller markeringar på fälten.
    expect(html).not.toContain("Från annonsen<");
    expect(html).not.toContain("Fanns inte i annonsen");
    expect(html).not.toContain("Vi fyllde i");
    expect(html).not.toContain("Booli anger föreningen");
    for (const fn of Object.values(servern)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("har 'Hitta postnummer' mot PostNord, utan hint eller serveranrop vid rendering", () => {
    sokning.current = {};
    const html = rita();
    expect(html).toContain("Hitta postnummer");
    expect(html).toContain(POSTNORD_POSTNUMMER_URL);
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("Område:");
    expect(servern.hamtaPostnummerInfoFn).not.toHaveBeenCalled();
  });

  it("sidorutan: vad du får (rättade ord), exempelrapport, var hittar jag, korrekt integritetsrad", () => {
    sokning.current = {};
    const html = rita();
    expect(html).toContain("Det här får du");
    expect(html).toContain("Sju nyckeltal, förklarade och bedömda");
    expect(html).not.toContain("jämförda med snittet");
    expect(html).toContain("Se en exempelrapport →");
    expect(html).toContain('href="/exempel"');
    expect(html).toContain("Var hittar jag årsredovisningen?");
    expect(html).toContain(
      "Priskollen sparas inte. Vid en analys sparar vi lägenhetsuppgifterna i 12 månader.",
    );
    expect(html).not.toContain("Vi sparar inte uppgifterna om du inte loggar in");
    expect(html).toContain("Integritet och personuppgifter");
    expect(html).toContain('href="/integritet"');
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
    expect(html).not.toContain("Om bostaden");
  });

  it("?forening=: medan föreningen hämtas visas laddtexten och uppladdningen finns inte än", () => {
    sokning.current = { forening: "brf-test-123456-7890" };
    const html = rita();
    expect(html).toContain("Hämtar föreningen från registret…");
    expect(html).not.toContain("Dra hit årsredovisningen");
    expect(html).not.toMatch(/gratis|valfri/i);
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
