import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tomSida, underlagFranSida } from "@/lib/kalkyl/sida";
import type { KalkylUnderlag } from "@/lib/kalkyl/underlag";

// Sidans routing och serveranrop är inte under test: bara vad som ritas.
const sokning = { current: {} as Record<string, unknown> };
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: object) => ({ ...opts, useSearch: () => sokning.current }),
  Link: ({ children }: { children?: unknown }) => <a>{children as never}</a>,
  useNavigate: () => () => Promise.resolve(),
}));
vi.mock("@/server/analysFn", () => ({
  hamtaSparadKalkylFn: vi.fn(),
  sparaKalkylFn: vi.fn(),
}));
const sparad = vi.hoisted(() => ({
  current: { laddar: false, ejInloggad: false, kalkyl: null, underlag: null } as {
    laddar: boolean;
    ejInloggad: boolean;
    kalkyl: unknown;
    underlag: unknown;
    hittadesInte?: boolean;
    fel?: string | null;
  },
}));
vi.mock("@/components/konto/useSparaKalkyl", async (orig) => ({
  ...(await orig<object>()),
  useSparadKalkyl: () => sparad.current,
}));

const { Route } = await import("@/routes/bolanekalkyl");
const Sida = (Route as unknown as { component: () => React.ReactElement }).component;

const rita = () =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <Sida />
    </QueryClientProvider>,
  );

const detailsTag = (html: string) => {
  const i = html.indexOf('data-slot="kalkyl-fordjupning"');
  expect(i).toBeGreaterThan(-1);
  const m = /<details[^>]*>/.exec(html.slice(i));
  expect(m).not.toBeNull();
  return m![0];
};

const KALP_ID = [
  "kalkyl-antal-vuxna",
  "kalkyl-barn-0-3",
  "kalkyl-barn-15-17",
  "kalkyl-kalkylranta",
];

const oppnadMed = (andra: Partial<KalkylUnderlag>) => {
  const u = { ...underlagFranSida({ ...tomSida(), lanebelopp: "3000000" }).underlag, ...andra };
  sparad.current = {
    laddar: false,
    ejInloggad: false,
    kalkyl: { id: "k1", etikett: null, uppdaterad: "2026-10-03T10:00:00Z", underlag: u },
    underlag: u,
  };
};

describe("/bolanekalkyl: enkel huvudvy och valfri fördjupning", () => {
  beforeEach(() => {
    sokning.current = {};
    sparad.current = { laddar: false, ejInloggad: false, kalkyl: null, underlag: null };
  });

  it("huvudformuläret har inga KALP-fält; de ligger i fördjupningen", () => {
    const html = rita();
    const i = html.indexOf('data-slot="kalkyl-fordjupning"');
    expect(i).toBeGreaterThan(-1);
    for (const id of KALP_ID) {
      const pos = html.indexOf(`id="${id}"`);
      expect(pos, id).toBeGreaterThan(i); // finns, men först i fördjupningen
    }
    // Huvudfälten finns kvar, inklusive boarea.
    for (const id of ["kalkyl-lanebelopp", "kalkyl-ranta", "kalkyl-boarea", "kalkyl-inkomst1"]) {
      const pos = html.indexOf(`id="${id}"`);
      expect(pos, id).toBeGreaterThan(-1);
      expect(pos, id).toBeLessThan(i);
    }
    expect(html).toContain("Fördjupning: räntescenarier och bankens kalkyl (valfritt)");
    expect(html).toContain("Om räntan ändras");
    expect(html).toContain("Bankens kalkyl (KALP)");
    expect(html).toContain("Regler och antaganden");
  });

  it("Spara och export ligger före fördjupningen", () => {
    const html = rita();
    expect(html.indexOf('data-slot="kalkyl-atgarder"')).toBeLessThan(
      html.indexOf('data-slot="kalkyl-fordjupning"'),
    );
  });

  it("fördjupningen är stängd som standard", () => {
    expect(detailsTag(rita())).not.toMatch(/\sopen/);
  });

  it.each([
    ["barn", { barn: ["0-3" as const] }],
    ["fler vuxna än låntagare", { antalVuxna: 3, antalLantagare: 2 as const }],
    ["annan kalkylränta", { kalkylrantaProcent: 8 }],
  ])("är öppen när en sparad kalkyl har avvikande KALP-uppgifter (%s)", (_n, andra) => {
    oppnadMed(andra);
    sokning.current = { sparad: "k1" };
    expect(detailsTag(rita())).toMatch(/\sopen/);
  });

  it("är stängd när en sparad kalkyl har förvalda KALP-uppgifter", () => {
    oppnadMed({});
    sokning.current = { sparad: "k1" };
    expect(detailsTag(rita())).not.toMatch(/\sopen/);
  });
});
