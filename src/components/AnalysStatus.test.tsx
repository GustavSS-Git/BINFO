import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children?: unknown; to: string }) => (
    <a href={to}>{children as never}</a>
  ),
}));
vi.mock("@/server/analysFn", () => ({ hamtaStatusFn: vi.fn() }));

const { HittadesInte, MedKontakt, Misslyckad, Pagar } = await import("@/components/AnalysStatus");
const { FELKOD_INNEHALL } = await import("@/lib/analysStatusCopy");
const { KONTAKT_EPOST } = await import("@/lib/kontakt");

/** sv-SE tusentalsavgränsare är ett hårt mellanslag; jämför med vanliga. */
const plattaUt = (html: string) => html.replace(/\s/g, " ");
const utanTaggar = (html: string) => plattaUt(html.replace(/<[^>]*>/g, ""));
const rita = (el: React.ReactElement) => utanTaggar(renderToStaticMarkup(el));

describe("Pagar: väntskärmen", () => {
  it("har rubrik, brödtext, exempellänk och stegindikator med Rapport som aktuell", () => {
    const html = renderToStaticMarkup(
      <Pagar status={{ stage: "uploaded", rapportSteg: "grundning" }} />,
    );
    const text = utanTaggar(html);
    expect(text).toContain("Vi läser årsredovisningen");
    expect(text).toContain(
      "Det tar några minuter. Sidan uppdateras själv när rapporten är klar. Spara rapporten då, så hittar du den i Mitt konto.",
    );
    expect(text).not.toContain("3–5 minuter");
    expect(text).toContain("Så här ser en färdig rapport ut");
    expect(html).toContain('href="/exempel"');
    expect(html).toMatch(/aria-current="step"[^>]*>(?:(?!<\/li>).)*Rapport/s);
    expect(text).toContain("Se var du är i köpguiden");
    expect(html).toContain('href="/kopguide"');
  });

  it("visar de sex stegen med rätt lägen (extraktion: 1 klart, 2 pågår, 4–6 väntar)", () => {
    const html = renderToStaticMarkup(
      <Pagar status={{ stage: "extracting", rapportSteg: "extraktion" }} />,
    );
    const text = utanTaggar(html);
    for (const steg of [
      "Läser in årsredovisningen",
      "Hämtar de sju nyckeltalen",
      "Jämför dina uppgifter med årsredovisningen",
      "Räknar på avgiften de närmaste två åren",
      "Justerar värderingen för föreningens ekonomi",
      "Skriver frågor till styrelsen",
    ]) {
      expect(text).toContain(steg);
    }
    expect(text.match(/Klart/g)).toHaveLength(1);
    expect(text.match(/Pågår/g)).toHaveLength(1);
    expect(html).toContain('aria-valuenow="17"'); // 1 klart steg av 6
  });

  it("trasigt textlager räknar inget transkriberingssteg: grundning är fortfarande steg 1", () => {
    const html = renderToStaticMarkup(
      <Pagar status={{ stage: "uploaded", textlager: "trasigt", rapportSteg: "grundning" }} />,
    );
    expect(html).toContain('aria-valuenow="0"');
    expect(utanTaggar(html)).not.toContain("Skannad årsredovisning");
    expect(utanTaggar(html)).not.toContain("några minuter extra");
  });

  it("skannad rapport: notisen ovanför kortet och tidsinskottet, bara för textlager saknas", () => {
    const skannad = rita(
      <Pagar status={{ stage: "uploaded", textlager: "saknas", rapportSteg: "transkribering" }} />,
    );
    expect(skannad).toContain("Skannad årsredovisning upptäckt – analysen tar lite längre tid.");
    expect(skannad).toContain("en skannad årsredovisning tar några minuter extra");
    const vanlig = rita(<Pagar status={{ stage: "extracting", textlager: "ok" }} />);
    expect(vanlig).not.toContain("Skannad årsredovisning");
    expect(vanlig).not.toContain("några minuter extra");
  });

  it("säger att samma årsredovisning analyseras just nu", () => {
    const text = rita(<Pagar status={{ stage: "uploaded", vantarPaRapport: true }} />);
    expect(text).toContain("Analyseras redan");
    expect(text).toContain(
      "Samma årsredovisning analyseras just nu – din analys blir klar samtidigt.",
    );
  });

  it("rubrikraden: adress · förening, med saknade delar utelämnade", () => {
    const med = rita(
      <Pagar
        status={{
          stage: "uploaded",
          adress: "Baltzar von Platens gata 6",
          foreningNamn: "Brf Pontonjären 3",
        }}
      />,
    );
    expect(med).toContain("Baltzar von Platens gata 6 · Brf Pontonjären 3");
    const bara = rita(<Pagar status={{ stage: "uploaded", adress: "Storgatan 1" }} />);
    expect(bara).toContain("Storgatan 1");
    expect(bara).not.toContain("·");
  });

  it("sidoruta: Liknande lägenheter med och utan utgångspris, och utan värde utelämnas blocket", () => {
    const med = rita(
      <Pagar
        status={{
          stage: "uploaded",
          liknande: { varde: 5_681_607 },
          utgangspris: 4_995_000,
        }}
      />,
    );
    expect(med).toContain("Medan du väntar");
    expect(med).toContain("Liknande lägenheter");
    expect(med).toContain("ca 5,7 mkr");
    expect(med).toContain(
      "Utan hänsyn till föreningen. Utgångspris 5,0 mkr. Värdet med föreningens ekonomi inräknad kommer i rapporten.",
    );
    expect(med).toContain("Inför visningen");
    expect(med).toContain(
      "Fråga mäklaren om det finns beslut om avgiftshöjning som inte syns i årsredovisningen ännu.",
    );

    const utanPris = rita(<Pagar status={{ stage: "uploaded", liknande: { varde: 5_681_607 } }} />);
    expect(utanPris).toContain("Utan hänsyn till föreningen. Värdet med");
    expect(utanPris).not.toContain("Utgångspris");

    const utan = rita(<Pagar status={{ stage: "uploaded", liknande: null }} />);
    expect(utan).not.toContain("Liknande lägenheter");
    expect(utan).not.toContain("ca ");
    expect(utan).toContain("Inför visningen");
  });
});

describe("Misslyckad", () => {
  it("visar rubrik som h1, serverns text, åtgärd och knappen Till formuläret", () => {
    const html = renderToStaticMarkup(
      <Misslyckad errorCode="validation" errorMessage="Uppgifterna var ogiltiga." />,
    );
    expect(html).toMatch(/<h1[^>]*>Uppgifterna kunde inte tolkas<\/h1>/);
    const text = utanTaggar(html);
    expect(text).toContain("Analysen kunde inte slutföras");
    expect(text).toContain("Uppgifterna var ogiltiga.");
    expect(text).toContain(FELKOD_INNEHALL.validation.forklaring);
    expect(text).toContain("Till formuläret");
    expect(html).toContain('href="/analysera"');
  });

  it("varje felkod renderar sin rubrik och åtgärd", () => {
    for (const [kod, innehall] of Object.entries(FELKOD_INNEHALL)) {
      const text = rita(<Misslyckad errorCode={kod as keyof typeof FELKOD_INNEHALL} />);
      expect(text).toContain(innehall.rubrik);
      expect(text).toContain(innehall.forklaring);
    }
  });

  it("okänd felkod blir 'unknown'; scanned_pdf säger inte att skanningar inte stöds", () => {
    expect(rita(<Misslyckad />)).toContain(FELKOD_INNEHALL.unknown.rubrik);
    const text = rita(<Misslyckad errorCode="scanned_pdf" />);
    expect(text).toContain("Det händer med vissa skannade eller fotograferade sidor, och med skanningar på fler än 60 sidor.");
    expect(text).toContain("Försök med en digital version (med textlager)");
  });

  it("'kontakta oss' är en mailto-länk när kontaktadressen finns", () => {
    expect(KONTAKT_EPOST).not.toBeNull();
    const html = renderToStaticMarkup(<Misslyckad errorCode="unknown" />);
    expect(html).toContain(`href="mailto:${KONTAKT_EPOST}"`);
    expect(html).toContain(">hör av dig till oss<");
  });
});

describe("MedKontakt", () => {
  it("utan adress blir det ren text utan kontaktlöfte", () => {
    const html = renderToStaticMarkup(
      <MedKontakt text="Försök igen. Kvarstår det, kontakta oss." epost={null} />,
    );
    expect(html).not.toContain("mailto:");
    expect(html).not.toMatch(/kontakta oss/);
    expect(utanTaggar(html)).toBe("Försök igen.");
  });
});

describe("HittadesInte", () => {
  it("visar rubrik, förklaring och knappen Starta en ny analys", () => {
    const html = renderToStaticMarkup(<HittadesInte />);
    expect(html).toMatch(/<h1[^>]*>Vi hittar ingen analys med det här id:t<\/h1>/);
    expect(utanTaggar(html)).toContain("Starta en ny analys");
    expect(html).toContain('href="/analysera"');
  });
});
