import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import { analysMedPrognos, analysUtanPrognos } from "@/components/prognosTestdata";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => () => undefined }));

import { AnalysRapport, Prisrimlighet } from "@/components/AnalysRapport";

const plattaUt = (html: string) => html.replace(/[\s\u00a0]+/g, " ");
const rita = (a = analysMedPrognos()) =>
  plattaUt(renderToStaticMarkup(<AnalysRapport analys={a} sparaSlot={<i>SPARA-TOPP</i>} />));

describe("AnalysRapport — avgiftsprognos och priskedja", () => {
  it("visar de två värdena (liknande lägenheter och Binfos värdering) och verdiktet mot spannet", () => {
    const html = rita();
    expect(html).toContain("Vad liknande lägenheter säljs för");
    expect(html).toContain("Med föreningens ekonomi inräknad");
    // Inside the ±10 % span of the shown (adjusted) value.
    expect(html).toContain("Utgångspriset ligger inom spannet");
    expect(html).not.toContain("(jämfört per m²)");
  });

  it("utanför spannet: verdiktet 'över spannet' mot den justerade värderingen", () => {
    const a = analysMedPrognos();
    const html = rita({
      ...a,
      prisanalys: {
        ...a.prisanalys,
        utgangspris: { value: 9_000_000, unit: "kr", source: "anvandare" },
        avvikelseMotJusteradVardering: 60,
      },
    });
    expect(html).toContain("Utgångspriset ligger över spannet");
    expect(html).toContain("Utgångspriset 9,0 miljoner ligger över spannet.");
    // Slutsatsen (i "Så har vi räknat") nämner fortfarande den justerade värderingen.
    expect(html).toContain("Utgångspris");
  });

  it("visar byggårsnotisen vid priset i den fullständiga analysen, inte på Priskollen", () => {
    const html = rita();
    expect(html).toContain('data-slot="pris-byggar"');
    expect(html).toContain(
      "Värderingen räknar med byggår 1958 enligt årsredovisningen, inte 1962 som du angav.",
    );
    // Priskollen skickar ingen uppgiftsjamforelse.
    const koll = plattaUt(
      renderToStaticMarkup(<Prisrimlighet prisanalys={analysMedPrognos().prisanalys} />),
    );
    expect(koll).not.toContain("pris-byggar");
    expect(koll).not.toContain("Värderingen räknar med byggår");
  });

  it("behåller exakt ett dolt element (värderingsleverantören), i rapporten och på Priskollen", () => {
    const rapport = renderToStaticMarkup(<AnalysRapport analys={analysMedPrognos()} />);
    expect((rapport.match(/<(p|div) class="hidden[^"]*">/g) ?? []).length).toBe(1);
    const html = renderToStaticMarkup(
      <Prisrimlighet
        prisanalys={analysMedPrognos().prisanalys}
        avgiftsprognos={analysMedPrognos().avgiftsprognos}
      />,
    );
    expect((html.match(/<(p|div) class="hidden[^"]*">/g) ?? []).length).toBe(1);
  });

  it("har 'Så har vi räknat' hopfälld, med faktorlistan och källan inuti", () => {
    const html = rita();
    const i = html.indexOf("Så har vi räknat");
    expect(i).toBeGreaterThan(-1);
    const detaljer = /<details[^>]*>/.exec(html.slice(html.lastIndexOf("<details", i)));
    expect(detaljer?.[0]).not.toMatch(/\sopen/);
    const slut = html.indexOf("</details>", i);
    const inne = html.slice(i, slut);
    expect(inne).not.toContain("Exempel på faktorer som påverkar värderingen utöver område:");
    expect(inne).toContain("Månadsavgift: högre avgift drar ner priset.");
    expect(inne).toContain("Modellen är tränad på");
    expect(html.split("Modellen är tränad på").length - 1).toBe(1);
  });

  it("visar prognosen med data: komponenter, saknat underlag, pris och lån", () => {
    const html = rita();
    expect(html).toContain("+500 kr/mån");
    expect(html).toContain("Okänt");
    expect(html).toContain("≈ 300 kr i pris per krona i månadsavgift");
    // The range is not shown any more, so neither are its widening reasons.
    expect(html).not.toContain("Underhållsplanens belopp saknas");
    expect(html).toContain("Energikostnaden ingår redan i dagens avgift");
    expect(html).toContain("statistiska sambandet");
    expect(html).toContain("Lån som omsätts inom horisonten");
    expect(html).toContain("3-månaders statsskuldväxel");
    expect(html).toContain("50 % av skulden");
  });

  it("utelämnar prognosdelarna utan avgiftsprognos", () => {
    const { avgiftsprognos: _a, ...utan } = analysMedPrognos();
    const html = rita(utan);
    expect(html).not.toContain("Det här driver den förväntade avgiften");
    expect(html).not.toContain("Lån som omsätts inom horisonten");
  });

  it("visar reglaget med flikarna när avgiftsprognos finns, utan tabell", () => {
    const html = rita();
    expect(html).toContain('type="range"');
    expect(html).not.toContain("TABELLKOMMENTAR");
    const avsnitt = html.slice(
      html.indexOf("Räntehöjning för föreningen"),
      html.indexOf("Det här driver den förväntade avgiften"),
    );
    expect((avsnitt.match(/<tr>/g) ?? []).length).toBe(0);
    // Toggle: two buttons, default tab "Dagens avgift" (the selected one has bg-card).
    const flikar = html.slice(html.indexOf("Utgå från"));
    expect(flikar).toMatch(/<button[^>]*bg-card[^>]*>Dagens avgift<\/button>/);
    expect(flikar).toMatch(/<button[^>]*>Förväntad avgift<\/button>/);
    expect(flikar).not.toMatch(/<button[^>]*bg-card[^>]*>Förväntad avgift<\/button>/);
    // Default tab: today's slider element.
    expect(avsnitt).toContain("Med högre ränta");
    expect(avsnitt).not.toContain("mot i dag");
  });

  it("gamla resultat utan prognos får bara reglaget, ingen flikväxlare", () => {
    const html = rita(analysUtanPrognos());
    const avsnitt = html.slice(html.indexOf("Räntehöjning för föreningen"));
    expect(avsnitt).toContain('type="range"');
    expect(avsnitt).not.toMatch(/<button[^>]*>Förväntad avgift<\/button>/);
  });

  it("visar byggårets avvikelse i huvudet, inte som egen sektion", () => {
    const html = rita();
    expect(html).not.toContain("Dina uppgifter mot årsredovisningen");
    expect(html).not.toContain("Ej i årsredovisningen");
    expect(html).toContain("Årsredovisningen: 1958 (du angav 1962)");
    expect(html).toContain("Avviker");
    expect(html.indexOf("Avviker")).toBeLessThan(html.indexOf("1 · Föreningen"));
  });

  it("renderar den avslutande sammanfattningen inte längre (ägarbeslut 2026-10-28)", () => {
    const html = rita();
    for (const t of ["SUMBETYG", "SUMPRIS", "SUMAVGIFT", "SUMSLUTSATS"]) {
      expect(html).not.toContain(t);
    }
    expect(html.indexOf("Ladda ner PDF")).toBeGreaterThan(-1);
    expect(html.indexOf("Har du råd med just den här?")).toBeGreaterThan(
      html.indexOf("Fem frågor"),
    );
  });

  it("renderar som förut när de nya fälten saknas (gamla resultat)", () => {
    const html = rita(analysUtanPrognos());
    for (const t of [
      "Värde med hänsyn till föreningens ekonomi utöver nuvarande avgift",
      "Justerat för väntad",
      "Sammanfattning",
      "Väntad avgiftsutveckling",
    ]) {
      expect(html).not.toContain(t);
    }
    expect(html).toContain('type="range"');
    expect(sampleAnalysis.betyg).toBeDefined();
  });
});
