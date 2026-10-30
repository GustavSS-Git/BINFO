import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Länkarna renderas utanför en router i testet.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
  }: {
    children: unknown;
    to: string;
    search?: Record<string, string>;
  }) => (
    <a href={search === undefined ? to : `${to}?${new URLSearchParams(search).toString()}`}>
      {children as never}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ history: { push: vi.fn() } }),
}));

import { AnalysLista, KalkylLista, VarderingLista } from "@/components/konto/ProfilListor";
import { ARBETAR_RADERA, ARBETAR_TA_BORT, bekraftaKnappText } from "@/components/konto/kontoText";
import { KopguideKortVy } from "@/components/konto/KopguideKort";
import { SparaKnappVy } from "@/components/konto/SparaKnappVy";
import type { AnalysPost, SparadKalkylPost, SparadVarderingPost } from "@/lib/kontoTyper";

const plattaUt = (html: string) => html.replace(/\s/g, " ");
const noop = async () => {};

const analys: AnalysPost = {
  analysisId: "a-1",
  skapad: "2026-10-01T10:00:00Z",
  status: "klar",
  foreningNamn: "Brf Pontonjären 3",
  orgnr: "716420-0599",
  rakenskapsar: 2025,
  betyg: "B",
  adress: "Baltzar von Platens gata 6",
  utgangspris: 4950000,
};

const vardering: SparadVarderingPost = {
  id: "v-1",
  etikett: "Kungsholmen",
  skapad: "2026-10-02T10:00:00Z",
  modellVersion: "v3.1",
  input: {
    boarea: 58,
    antalRum: 2,
    manadsavgift: 3240,
    postnummer: "11242",
    hiss: "ja",
    balkong: "okant",
    utgangspris: 4950000,
  },
  vardering: 5681607,
  intervall: { low: 5000000, high: 6000000 },
};

const kalkyl: SparadKalkylPost = {
  id: "k-1",
  etikett: null,
  skapad: "2026-10-03T10:00:00Z",
  uppdaterad: "2026-10-03T10:00:00Z",
  regelversion: "r1",
  sammanfattning: {
    totalPerManad: 14500,
    belaningsgradProcent: 85,
    amorteringstaktProcent: 2,
    kvarAttLevaPaKalp: null,
  },
};

describe("profilens listor", () => {
  it("visar månadskostnaden som ett spann när osäkra avgiftsposter ger ett", () => {
    const html = renderToStaticMarkup(
      <KalkylLista
        kalkyler={[
          { ...kalkyl, sammanfattning: { ...kalkyl.sammanfattning!, totalPerManadHog: 16_200 } },
        ]}
        onRadera={noop}
      />,
    ).replace(/\u00a0|&nbsp;/g, " ");
    expect(html).toContain("14 500 kr–16 200 kr i månaden efter ränteavdrag");
  });

  it("visar tomma lägen med en väg vidare", () => {
    const html = renderToStaticMarkup(
      <>
        <AnalysLista analyser={[]} onTaBort={noop} />
        <VarderingLista varderingar={[]} onRadera={noop} />
        <KalkylLista kalkyler={[]} onRadera={noop} />
      </>,
    );
    expect(html).toContain("Du har inga analyser än");
    expect(html).toContain("Du har inga sparade värderingar");
    expect(html).toContain("Du har inga sparade bolånekalkyler");
    expect(html).toContain('href="/analysera"');
    expect(html).not.toContain('href="/vardering"');
    expect(html).toContain('href="/bolanekalkyl"');
  });

  it("länkar värderingarna till priskollen på /analysera (inte den gamla /vardering)", () => {
    const tom = renderToStaticMarkup(<VarderingLista varderingar={[]} onRadera={noop} />);
    expect(tom).toContain('href="/analysera"');
    const fylld = renderToStaticMarkup(
      <VarderingLista varderingar={[vardering]} onRadera={noop} />,
    );
    expect(fylld).toContain(`href="/analysera?sparad=${vardering.id}"`);
    expect(fylld).not.toContain("/vardering");
  });

  it("visar datum, namn, nyckeltal och åtgärder för fyllda listor", () => {
    const html = plattaUt(
      renderToStaticMarkup(
        <>
          <AnalysLista analyser={[analys]} onTaBort={noop} />
          <VarderingLista varderingar={[vardering]} onRadera={noop} />
          <KalkylLista kalkyler={[kalkyl]} onRadera={noop} />
        </>,
      ),
    );
    expect(html).toContain("Brf Pontonjären 3");
    expect(html).toContain("Betyg B");
    expect(html).toContain("Utgångspris 4 950 000 kr");
    expect(html).toContain("Ta bort från listan");
    // Saved valuations are shown rounded to 10 000 kr like every other valuation.
    expect(html).toContain("Liknande lägenheter ca 5 680 000 kr");
    expect(html).toContain("Kungsholmen");
    // Old summaries (no upper bound) show one figure, labelled as after ränteavdrag.
    expect(html).toContain("14 500 kr i månaden efter ränteavdrag");
    expect(html).toContain("Belåningsgrad 85 %");
    expect(html).toContain("Radera");
    expect(html).toContain(">Öppna<");
    // Det dolda värderingsspannet visas aldrig i listan.
    expect(html).not.toContain("5 000 000");
  });

  it("visar 'Kan inte öppnas' för poster som inte längre går att tolka, utan att krascha", () => {
    const trasigVardering: SparadVarderingPost = {
      ...vardering,
      input: null,
      vardering: null,
      intervall: null,
      etikett: null,
    };
    const trasigKalkyl: SparadKalkylPost = { ...kalkyl, sammanfattning: null };
    const html = renderToStaticMarkup(
      <>
        <VarderingLista varderingar={[trasigVardering]} onRadera={noop} />
        <KalkylLista kalkyler={[trasigKalkyl]} onRadera={noop} />
      </>,
    );
    // Värderingen utan läsbar input kan inte öppnas. Kalkylen med saknad sammanfattning
    // kan fortfarande öppnas (kalkylsidan avgör om underlaget går att läsa).
    expect(html.match(/Kan inte öppnas/g)).toHaveLength(1);
    expect(html.match(/>Öppna</g)).toHaveLength(1);
    expect(html).toContain("/bolanekalkyl?sparad=k-1");
    // Man kan fortfarande radera dem.
    expect(html.match(/Radera/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("pågående analys länkar till förhandsvisningen och saknat namn ger en neutral text", () => {
    const html = renderToStaticMarkup(
      <AnalysLista
        analyser={[{ ...analys, status: "pagar", foreningNamn: null, betyg: null, adress: null }]}
        onTaBort={noop}
      />,
    );
    expect(html).toContain("Förening ej identifierad");
    expect(html).toContain("Pågår");
    expect(html).not.toContain("Betyg");
  });
});

describe("BekraftaDialog: knapptext medan åtgärden pågår", () => {
  it("passar åtgärden: 'Tar bort…' för borttagning från listan, 'Raderar…' för radering", () => {
    expect(ARBETAR_TA_BORT).toBe("Tar bort…");
    expect(ARBETAR_RADERA).toBe("Raderar…");
    expect(bekraftaKnappText(true, "Radera kontot", ARBETAR_RADERA)).toBe("Raderar…");
    expect(bekraftaKnappText(true, "Ta bort från listan", ARBETAR_TA_BORT)).toBe("Tar bort…");
    expect(bekraftaKnappText(false, "Radera kontot", ARBETAR_RADERA)).toBe("Radera kontot");
  });
});

describe("Köpguiden på Mitt konto", () => {
  it("visar framstegstexten från framstegText och en länk vidare", () => {
    const html = renderToStaticMarkup(
      <KopguideKortVy klara={["lanelofte", "sok", "visning", "ekonomi"]} laddar={false} />,
    );
    expect(html).toContain("4 av 12 steg klara. Nästa: budgivning.");
    expect(html).toContain("Fortsätt i köpguiden");
    expect(html).toContain('href="/kopguide"');
    expect(html).toContain('aria-valuenow="33"');
  });

  it("utan avbockade steg: ingen siffra, men länken finns kvar", () => {
    const html = renderToStaticMarkup(<KopguideKortVy klara={[]} laddar={false} />);
    expect(html).toContain("Du har inte bockat av något steg ännu.");
    expect(html).toContain("Fortsätt i köpguiden");
  });
});

describe("SparaKnappVy", () => {
  const vy = (p: Partial<Parameters<typeof SparaKnappVy>[0]>) =>
    renderToStaticMarkup(
      <SparaKnappVy
        sessionLage="inloggad"
        lage="vilar"
        fel={null}
        etikettKnapp="Spara värderingen"
        onKlick={() => {}}
        {...p}
      />,
    );

  it("inloggad: bara knappen", () => {
    const html = vy({});
    expect(html).toContain("Spara värderingen");
    expect(html).not.toContain("Du behöver ett konto");
  });

  it("utloggad: förklarar att man loggar in först och att uppgifterna finns kvar", () => {
    const html = vy({ sessionLage: "utloggad" });
    expect(html).toContain("Spara värderingen");
    expect(html).toContain("Du behöver ett konto för att spara");
  });

  it("session som laddar: knappen är avstängd", () => {
    expect(vy({ sessionLage: "laddar" })).toContain("disabled");
  });

  it("sparad: bekräftelse och länk till Mitt konto", () => {
    const html = vy({ lage: "sparad" });
    expect(html).toContain("Sparad i ditt konto");
    expect(html).toContain('href="/konto"');
    expect(html).not.toContain("<button");
  });

  it("fel: visar serverns text ordagrant", () => {
    const html = vy({ lage: "fel", fel: "Du har sparat för många värderingar." });
    expect(html).toContain("Du har sparat för många värderingar.");
  });
});
