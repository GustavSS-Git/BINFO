import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const sokning = { current: {} as Record<string, unknown> };
const sessionMock = vi.hoisted(() => ({
  current: { lage: "utloggad", epost: null as string | null, session: null as unknown },
}));
const kopguide = vi.hoisted(() => ({
  current: {
    klara: [] as string[],
    laddar: false,
    vaxla: () => {},
    sparFel: null as string | null,
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: object) => ({ ...opts, useSearch: () => sokning.current }),
  Link: ({
    children,
    to,
    search,
  }: {
    children?: unknown;
    to: string;
    search?: Record<string, string>;
  }) => (
    <a href={search === undefined ? to : `${to}?${new URLSearchParams(search).toString()}`}>
      {children as never}
    </a>
  ),
  useNavigate: () => () => Promise.resolve(),
  useRouter: () => ({ history: { push: () => {} } }),
}));
vi.mock("@/server/analysFn", () => ({
  loggaInFn: vi.fn(),
  registreraKontoFn: vi.fn(),
  begarAterstallningFn: vi.fn(),
  bekraftaEpostFn: vi.fn(),
  sattNyttLosenordFn: vi.fn(),
  listaSparatFn: vi.fn(),
  loggaUtFn: vi.fn(),
  raderaKontoFn: vi.fn(),
  hamtaMinaUppgifterFn: vi.fn(),
  raderaSparadKalkylFn: vi.fn(),
  raderaSparadVarderingFn: vi.fn(),
  taBortAnalysFranListaFn: vi.fn(),
  hamtaSessionFn: vi.fn(),
}));
vi.mock("@/lib/session", () => ({
  SPARAT_KEY: ["sparat"],
  useSession: () => sessionMock.current,
  useSessionAtgarder: () => ({
    sattInloggad: () => {},
    sattUtloggad: () => {},
    uppdatera: () => {},
  }),
}));
vi.mock("@/lib/kopguide/useKopguide", () => ({ useKopguide: () => kopguide.current }));

const rita = async (modul: string, qc = new QueryClient()) => {
  const { Route } = (await import(/* @vite-ignore */ modul)) as { Route: unknown };
  const Sida = (Route as { component: () => React.ReactElement }).component;
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <Sida />
    </QueryClientProvider>,
  ).replace(/\s+/g, " ");
};

describe("kontosidor", () => {
  it("logga in: formulär med autocomplete och sidoruta med fyra punkter", async () => {
    sokning.current = {};
    const html = await rita("@/routes/konto.logga-in");
    expect(html).toContain("Logga in för att se dina sparade analyser, värderingar och kalkyler.");
    expect(html).toContain('autoComplete="email"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain("Det här sparas på ditt konto");
    expect(html).toContain("Hur långt du har kommit i köpguiden");
    expect(html).toContain("Du behöver inget konto för att analysera en bostad.");
    expect(html).toContain("Analysera utan att logga in");
    expect(html).toContain("Glömt lösenordet?");
    expect(html).toContain("Skapa konto");
  });

  it("logga in med ?spara: ingressen säger att uppgifterna finns kvar", async () => {
    sokning.current = { spara: "vardering", till: "/analysera" };
    const html = await rita("@/routes/konto.logga-in");
    expect(html).toContain("Logga in för att spara.");
    expect(html).toContain("/konto/skapa?");
  });

  it("nytt lösenord: ingress, 'Bra att veta' utan dataintrångspunkten, länkar", async () => {
    sokning.current = { nuvarande: "ja" };
    const html = await rita("@/routes/konto.nytt-losenord");
    expect(html).toContain("Lösenordet ska vara minst 10 tecken.");
    expect(html).toContain("Nuvarande lösenord");
    expect(html).toContain("Minst 10 tecken.");
    expect(html).toContain("Spara nytt lösenord");
    expect(html).toContain("Bra att veta");
    expect(html).toContain("behöver du inte ange det nuvarande lösenordet");
    expect(html).toContain("När lösenordet är bytt loggas du ut på andra enheter.");
    expect(html).not.toContain("dataintrång");
    expect(html).toContain("Tillbaka till Mitt konto");
    expect(html).toContain('href="/konto/glomt-losenord"');
    expect(html).toContain("Glömt ditt nuvarande lösenord?");
  });

  it("nytt lösenord utan ?nuvarande: fältet för nuvarande lösenord visas inte", async () => {
    sokning.current = {};
    const html = await rita("@/routes/konto.nytt-losenord");
    expect(html).not.toContain("Nuvarande lösenord");
  });

  it("skapa konto och glömt lösenord: sidoruta och rätt autocomplete", async () => {
    sokning.current = {};
    const skapa = await rita("@/routes/konto.skapa");
    expect(skapa).toContain('autoComplete="new-password"');
    expect(skapa).toContain("Det här sparas på ditt konto");
    const glomt = await rita("@/routes/konto.glomt-losenord");
    expect(glomt).toContain("Bra att veta");
    expect(glomt).toContain('autoComplete="email"');
  });

  it("bekräfta: ofullständig länk ger felruta och sidoruta", async () => {
    sokning.current = {};
    const html = await rita("@/routes/konto.bekrafta");
    expect(html).toContain("Länken fungerar inte");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Bra att veta");
  });
});

describe("/kopguide med sparat framsteg", () => {
  it("visar det som useKopguide levererar", async () => {
    kopguide.current = {
      klara: ["lanelofte", "sok", "visning", "ekonomi"],
      laddar: false,
      vaxla: () => {},
      sparFel: null,
    };
    const html = await rita("@/routes/kopguide");
    expect(html).toContain("4 av 12 steg klara");
    expect(html).toContain("Budgivning →");
    expect(html).toContain("Hela bostadsköpet, steg för steg");
  });

  it("visar sparfelet från hooken", async () => {
    kopguide.current = {
      klara: [],
      laddar: false,
      vaxla: () => {},
      sparFel: "Det gick inte att spara ditt framsteg just nu. Försök igen om en stund.",
    };
    const html = await rita("@/routes/kopguide");
    expect(html).toContain("Det gick inte att spara ditt framsteg just nu.");
  });
});

describe("/konto inloggad", () => {
  it("rubrik, e-post, tre listor, köpguidekort, notering och kontoinställningar", async () => {
    sessionMock.current = { lage: "inloggad", epost: "anna@example.se", session: null };
    kopguide.current = {
      klara: ["lanelofte", "sok", "visning", "ekonomi"],
      laddar: false,
      vaxla: () => {},
      sparFel: null,
    };
    const qc = new QueryClient();
    qc.setQueryData(["sparat"], { ok: true, analyser: [], varderingar: [], kalkyler: [] });
    const html = await rita("@/routes/konto.index", qc);
    expect(html).toContain(">Sparat</h1>");
    expect(html).toContain("<strong");
    expect(html).toContain("anna@example.se");
    for (const t of [
      "Analysera en bostad",
      "Du har inga analyser än",
      "Du har inga sparade värderingar",
      "Du har inga sparade bolånekalkyler",
      "Köpguiden",
      "4 av 12 steg klara. Nästa: budgivning.",
      "Fortsätt i köpguiden",
      "Innan något raderas får du bekräfta.",
      'id="installningar"',
      "Hit skickar vi länkar för att återställa lösenordet.",
      "/konto/nytt-losenord?nuvarande=ja",
      "Logga ut",
      "Dina uppgifter",
      "hur långt du har kommit i köpguiden",
      "Ladda ner mina uppgifter",
      "Radera mitt konto",
      "Du får ange ditt lösenord för att bekräfta.",
    ]) {
      expect(html).toContain(t);
    }
  });

  it("listfel visas med 'Försök igen'", async () => {
    sessionMock.current = { lage: "inloggad", epost: "anna@example.se", session: null };
    const qc = new QueryClient();
    qc.setQueryData(["sparat"], {
      ok: false,
      felKod: "unknown",
      meddelande: "Något gick fel hos oss.",
    });
    const html = await rita("@/routes/konto.index", qc);
    expect(html).toContain("Något gick fel hos oss.");
    expect(html).toContain("Försök igen");
  });
});
