import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import { analysMedPrognos, analysUtanPrognos } from "@/components/prognosTestdata";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => () => undefined }));

import { AnalysRapport, Prisrimlighet } from "@/components/AnalysRapport";

const plattaUt = (html: string) => html.replace(/\s/g, " ");
const rita = (a = analysMedPrognos()) =>
  plattaUt(renderToStaticMarkup(<AnalysRapport analys={a} sparaSlot={<i>SPARA-TOPP</i>} />));

describe("AnalysRapport — avgiftsprognos och priskedja", () => {
  it("visar två prisrader och jämför mot den justerade värderingen", () => {
    const html = rita();
    expect(html).toContain("Vad jämförbara lägenheter säljs för");
    expect(html).toContain("Värde med hänsyn till föreningens ekonomi");
    expect(html).toContain("den justerade värderingen");
    expect(html).not.toContain("(jämfört per m²)");
  });

  it("behåller exakt två dolda element (värderingsleverantören och intervallet)", () => {
    const html = renderToStaticMarkup(
      <Prisrimlighet
        prisanalys={analysMedPrognos().prisanalys}
        avgiftsprognos={analysMedPrognos().avgiftsprognos}
      />,
    );
    expect((html.match(/<(p|div) class="hidden[^"]*">/g) ?? []).length).toBe(2);
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

  it("visar del 2 och 3 med data: komponenter, saknat underlag, pris och lån", () => {
    const html = rita();
    expect(html).toContain("+500 kr/mån");
    expect(html).toContain("Underlag saknas");
    expect(html).toContain("≈ 300 kr i pris per krona i månadsavgift");
    // The range is not shown any more, so neither are its widening reasons.
    expect(html).not.toContain("Underhållsplanens belopp saknas");
    expect(html).toContain("Energikostnaden ingår redan i dagens avgift");
    expect(html).toContain("statistiska sambandet");
    expect(html).toContain("Lån som omsätts inom horisonten");
    expect(html).toContain("3-månaders statsskuldväxel");
    expect(html).toContain("50 % av skulden");
  });

  it("utelämnar del 2 och 3 utan avgiftsprognos", () => {
    const { avgiftsprognos: _a, ...utan } = analysMedPrognos();
    const html = rita(utan);
    expect(html).not.toContain("Väntad avgiftsutveckling");
    expect(html).not.toContain("Lån som omsätts inom horisonten");
  });

  it("visar reglaget med flikarna när avgiftsprognos finns, utan tabell", () => {
    const html = rita();
    expect(html).toContain('type="range"');
    expect(html).not.toContain("TABELLKOMMENTAR");
    const avsnitt = html.slice(html.indexOf("Vad händer om räntan stiger?"));
    expect((avsnitt.match(/<tr>/g) ?? []).length).toBe(0);
    // Toggle: two buttons, default tab "Dagens avgift" (the selected one has bg-card).
    expect(avsnitt).toMatch(/<button[^>]*bg-card[^>]*>Dagens avgift<\/button>/);
    expect(avsnitt).toMatch(/<button[^>]*>Förväntad avgift<\/button>/);
    expect(avsnitt).not.toMatch(/<button[^>]*bg-card[^>]*>Förväntad avgift<\/button>/);
    // Default tab: today's slider element.
    expect(avsnitt).toContain("Stressad avgift");
    expect(avsnitt).not.toContain("mot i dag");
  });

  it("gamla resultat utan prognos får bara reglaget, ingen flikväxlare", () => {
    const html = rita(analysUtanPrognos());
    const avsnitt = html.slice(html.indexOf("Vad händer om räntan stiger?"));
    expect(avsnitt).toContain('type="range"');
    expect(avsnitt).not.toMatch(/<button[^>]*>Förväntad avgift<\/button>/);
  });

  it("visar byggårets avvikelse i objektsammanfattningen, inte som egen sektion", () => {
    const html = rita();
    expect(html).not.toContain("Dina uppgifter mot årsredovisningen");
    expect(html).not.toContain("Ej i årsredovisningen");
    expect(html).toContain("Årsredovisningen: 1958 (du angav 1962)");
    expect(html).toContain("Avviker");
    expect(html.indexOf("Avviker")).toBeLessThan(html.indexOf("Sammanvägt riskbetyg"));
  });

  it("lägger sammanfattningen efter Frågor och före knapparna", () => {
    const html = rita();
    const sam = html.indexOf("SUMBETYG");
    expect(sam).toBeGreaterThan(html.indexOf("Frågor att ställa"));
    expect(sam).toBeLessThan(html.indexOf("Ladda ner som PDF"));
    for (const t of ["SUMPRIS", "SUMAVGIFT", "SUMSLUTSATS"]) expect(html).toContain(t);
  });

  it("renderar som förut när de nya fälten saknas (gamla resultat)", () => {
    const html = rita(analysUtanPrognos());
    for (const t of [
      "Värde med hänsyn till föreningens ekonomi",
      "Justerat för väntad",
      "Sammanfattning",
      "Väntad avgiftsutveckling",
    ]) {
      expect(html).not.toContain(t);
    }
    expect(html).toContain('type="range"');
  });
});
