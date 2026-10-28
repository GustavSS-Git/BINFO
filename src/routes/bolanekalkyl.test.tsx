import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReglerTabell } from "@/components/kalkyl/ReglerTabell";
import { regelGrupper, regelTyp, reglerMeta } from "@/components/kalkyl/regelTyper";
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

/** `<details>` som innehåller "Klarar ni bankens kalkyl?". */
const kalpDetails = (html: string) => {
  const i = html.indexOf("Klarar ni bankens kalkyl?");
  expect(i).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<details", i);
  return /<details[^>]*>/.exec(html.slice(start))![0];
};

const KALP_ID = [
  "kalkyl-antal-vuxna",
  "kalkyl-barn-0-3",
  "kalkyl-barn-15-17",
  "kalkyl-kalkylranta",
];

const oppnadMed = (andra: Partial<KalkylUnderlag>) => {
  const u = { ...underlagFranSida({ ...tomSida(), pris: "3000000" }).underlag, ...andra };
  sparad.current = {
    laddar: false,
    ejInloggad: false,
    kalkyl: { id: "k1", etikett: null, uppdaterad: "2026-10-03T10:00:00Z", underlag: u },
    underlag: u,
  };
};

describe("/bolanekalkyl: redesignad sida", () => {
  beforeEach(() => {
    sokning.current = {};
    sparad.current = { laddar: false, ejInloggad: false, kalkyl: null, underlag: null };
  });

  it("har rubrik, tre formulärsektioner och KALP efter huvudfälten", () => {
    const html = rita();
    expect(html).toContain("Vad kostar bostaden per månad?");
    expect(html).toContain("Med 2026 års amorteringsregler, ränteavdrag och skatt i Stockholm.");
    const kalp = html.indexOf("Klarar ni bankens kalkyl?");
    for (const rubrik of ["Lånet", "Bostaden", "Hushållet"]) {
      const pos = html.indexOf(`>${rubrik}</h2>`);
      expect(pos, rubrik).toBeGreaterThan(-1);
      expect(pos, rubrik).toBeLessThan(kalp);
    }
    for (const id of [
      "kalkyl-pris",
      "kalkyl-kontantinsats",
      "kalkyl-ranta",
      "kalkyl-boarea",
      "kalkyl-inkomst1",
    ]) {
      const pos = html.indexOf(`id="${id}"`);
      expect(pos, id).toBeGreaterThan(-1);
      expect(pos, id).toBeLessThan(kalp);
    }
    // KALP-fälten finns, men efter sammanfattningen.
    for (const id of KALP_ID) expect(html.indexOf(`id="${id}"`), id).toBeGreaterThan(kalp);
    expect(html).toContain("Om räntan stiger");
    expect(html).toContain("Regler och antaganden");
  });

  it("Spara och export ligger före reglerna", () => {
    const html = rita();
    expect(html.indexOf('data-slot="kalkyl-atgarder"')).toBeLessThan(
      html.indexOf('data-slot="kalkyl-regler"'),
    );
    expect(html).toContain("Namn på kalkylen");
    expect(html).toContain("Ladda ner PDF");
    expect(html).toContain("Ladda ner Excel");
  });

  it("KALP är stängd som standard", () => {
    expect(kalpDetails(rita())).not.toMatch(/\sopen/);
  });

  it.each([
    ["barn", { barn: ["0-3" as const] }],
    ["fler vuxna än låntagare", { antalVuxna: 3, antalLantagare: 2 as const }],
    ["annan kalkylränta", { kalkylrantaProcent: 8 }],
  ])("KALP är öppen när en sparad kalkyl har avvikande uppgifter (%s)", (_n, andra) => {
    oppnadMed(andra);
    sokning.current = { sparad: "k1" };
    expect(kalpDetails(rita())).toMatch(/\sopen/);
  });

  it("KALP är stängd när en sparad kalkyl har förvalda uppgifter", () => {
    oppnadMed({});
    sokning.current = { sparad: "k1" };
    expect(kalpDetails(rita())).not.toMatch(/\sopen/);
  });

  it("öppnad sparad kalkyl visar remsan 'Öppnad från ditt konto'", () => {
    oppnadMed({});
    sokning.current = { sparad: "k1" };
    expect(rita()).toContain("Öppnad från ditt konto:");
  });

  it("tom sida: 'Pris du räknar med', t.ex.-platshållare, inget 'Vet ej', inget spann, ett enda totalbelopp", () => {
    const html = rita();
    expect(html).toContain("Pris du räknar med");
    expect(html).not.toContain("Lånebelopp");
    expect(html).not.toMatch(/Vet ej/);
    expect(html).not.toContain("spann");
    expect(html).toContain('placeholder="t.ex.');
    expect(html).toContain("Styr schablonen för värme");
    expect(html).toContain("Styr schablonerna för hushållsel, vatten och hemförsäkring");
    expect(html).toContain("Fyll i bruttoinkomst för att se nettoinkomst");
    expect(html).not.toContain('data-slot="kalkyl-remsa"');
    expect(html).not.toContain("Från rapporten");
  });

  it("fem avgiftschips som växlar (aria-pressed), även när de är förifyllda", () => {
    sokning.current = { pris: 5_000_000, ingar: "varme,vatten,tv", ingarEj: "el,bredband" };
    const html = rita();
    const fs = html.slice(
      html.indexOf("Ingår i avgiften</legend>") === -1 ? 0 : html.indexOf("Ingår i avgiften"),
    );
    for (const namn of ["Värme", "Vatten", "Hushållsel", "Bredband", "Tv"]) {
      expect(fs, namn).toMatch(
        new RegExp(`aria-pressed="(true|false)"[^>]*>(<svg.*?</svg>)?${namn}<`),
      );
    }
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(3);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
    expect(html).not.toContain("Ingår ej");
  });

  it("länk från rapporten: remsa, förifyllt pris och insats, 'Från rapporten' på det som rapporten angav", () => {
    sokning.current = {
      pris: 5_260_000,
      manadsavgift: 3503,
      boarea: 48,
      rantekanslighet: 4.2,
      ingar: "varme,vatten",
      ingarEj: "el",
    };
    const html = rita();
    expect(html).toMatch(/id="kalkyl-pris"[^>]*value="5260000"/);
    expect(html).toMatch(/id="kalkyl-kontantinsats"[^>]*value="526000"/);
    expect(html).toContain("Binfos värdering enligt rapporten");
    expect(html).not.toContain("Vanligt bud");
    expect(html).toContain("10 % av priset · minst 10 % krävs");
    // Remsan: bara det som faktiskt fylldes i.
    expect(html).toContain("Ifyllt från rapporten.");
    expect(html).toContain(
      "Pris, avgift, boarea, vad som ingår i avgiften och föreningens räntekänslighet.",
    );
    // Märken: pris, avgift, boarea och legenden för avgiftsposterna.
    expect(html.match(/>Från rapporten</g)).toHaveLength(4);
  });

  it("remsan har ingen länk 'Till rapporten' när ingen rapport kan pekas ut", () => {
    sokning.current = { pris: 5_260_000 };
    const html = rita();
    expect(html).toContain("Ifyllt från rapporten.");
    expect(html).not.toContain("Till rapporten");
  });

  it("uppskattat pris märks som uppskattning", () => {
    sokning.current = { pris: 5_000_000, prisUppskattning: true };
    expect(rita()).toContain("Binfos uppskattning av priset enligt rapporten");
  });

  it("räntestress: slider med namn, värdetext och skala", () => {
    const html = rita();
    expect(html).toMatch(/<label[^>]*for="kalkyl-rantestress"[^>]*>Räntestress</);
    expect(html).toMatch(/id="kalkyl-rantestress"[^>]*aria-valuetext="\+0,0 procentenheter"/);
    expect(html).toContain("+3 p.e.");
  });

  it("räntescenarier: +0 till +3 och bankens kalkylränta, med tabellrubriker", () => {
    sokning.current = { pris: 5_000_000, manadsavgift: 3500, boarea: 50, rantekanslighet: 4 };
    const html = rita();
    // Ränta ifylld via sparad kalkyl behövs för tabellen: här saknas den.
    expect(html).toContain("Fyll i ränta ovan för att se scenarierna.");
    oppnadMed({ rantaProcent: 3.5, manadsavgift: 3500, boarea: 50, rantekanslighetProcent: 4 });
    sokning.current = { sparad: "k1" };
    const ok = rita();
    expect(ok).toContain('scope="col">Din ränta<');
    expect(ok).toContain("Totalt per månad");
    expect(ok).toContain("Din ränta</span>");
    expect(ok).toContain("+3 procentenheter");
    expect(ok).toContain("Bankens kalkylränta");
    expect(ok).toContain("Avgiften stiger");
  });
});

describe("/bolanekalkyl: regler och antaganden", () => {
  it("rubrikens antal är summan av grupperna och datumet är det senaste kontrolldatumet", () => {
    const grupper = regelGrupper();
    const summa = grupper.reduce((a, g) => a + g.regler.length, 0);
    const alla = grupper.flatMap((g) => g.regler);
    expect(reglerMeta(alla)).toMatch(
      new RegExp(`^${summa} st, kontrollerade \\d+ \\p{L}+\\.? 20\\d\\d$`, "u"),
    );
    const html = renderToStaticMarkup(<ReglerTabell />);
    expect(html).toContain(`${summa} st, kontrollerade`);
    for (const g of grupper) expect(html).toContain(`${g.regler.length} st`);
    // En tabell per grupp med kolumnrubriker och scope.
    expect(html.match(/scope="col">Typ</g)).toHaveLength(grupper.length);
    expect(html).toContain('scope="row"');
  });

  it("typmappning: regel, referensvärde, antagande, uppskattning", () => {
    expect(regelTyp("faststalld").etikett).toBe("Regel");
    expect(regelTyp("antagande").etikett).toBe("Antagande");
    expect(regelTyp("schablon").etikett).toBe("Uppskattning");
    // Ett publicerat värde med offentlig källa är inte Binfos gissning.
    expect(regelTyp("referens").etikett).toBe("Referensvärde");
    expect(regelTyp("referens").etikett).not.toBe(regelTyp("schablon").etikett);
  });

  it("varje rad i registret får en typ, och bara poster utan källa är 'Uppskattning'", () => {
    for (const g of regelGrupper()) {
      for (const r of g.regler) {
        if (regelTyp(r.status).etikett === "Uppskattning") expect(r.kalla.url).toBeNull();
      }
    }
  });
});
