import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  analysMedPlanMal,
  analysMedPrognos,
  analysMedSparbehov,
  analysUtanPrognos,
} from "@/components/prognosTestdata";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => () => undefined }));

import { AnalysRapport, Prisrimlighet } from "@/components/AnalysRapport";

const rita = (a = analysMedSparbehov()) =>
  renderToStaticMarkup(<AnalysRapport analys={a} />).replace(/\s+/g, " ");

describe("AnalysRapport — sparsteg, lån och färger (2026-10-24c)", () => {
  it("märker de två priserna och visar vattenfallet med delbelopp", () => {
    const html = rita();
    expect(html).toContain("Vad jämförbara lägenheter säljs för");
    expect(html).toContain("Värde med hänsyn till föreningens ekonomi");
    expect(html).toContain('data-slot="pris-vattenfall"');
    // 300 kr/mån × 300 = 90 000, 500 × 300 = 150 000
    expect(html).toContain("−90 000 kr");
    expect(html).toContain("−150 000 kr");
  });

  it("har alla 'Visa mer' stängda och 'Så har vi räknat' hopfälld", () => {
    const html = rita();
    const taggar = html.match(/<details[^>]*>/g) ?? [];
    expect(taggar.length).toBeGreaterThan(3);
    for (const t of taggar) expect(t).not.toMatch(/\sopen/);
    expect(html).toContain("Visa mer");
  });

  it("visar kedjan behov → sparar → glapp → avgift → pris med källtaggar", () => {
    const html = rita();
    const i = html.indexOf('data-slot="spar-steg"');
    const spar = html.slice(i, html.indexOf('data-slot="refi-steg"'));
    for (const t of [
      "Behov",
      "310 kr/m²",
      "Schablon",
      "Sparar",
      "120 kr/m²",
      "Årsredovisning s. 5",
    ])
      expect(spar).toContain(t);
    expect(spar).toContain("Glapp");
    expect(spar).toContain("190 kr/m²");
    expect(spar).toContain("+300 kr/mån");
    expect(spar).toContain("−90 000 kr");
    expect(spar).toContain("Räknas till 50 % (schablon)");
  });

  it("visar byggdelstabellen med statusar och källan för livslängder", () => {
    const html = rita();
    for (const t of ["Stambyte", "1958 (byggår)", "2019 (åtgärd)", "40–60 år"]) {
      expect(html).toContain(t);
    }
    for (const t of ["Eftersatt", "Nyligen", "Ok", "Okänt"]) expect(html).toContain(`>${t}<`);
    expect(html).toContain("250–350 kr/m²");
    expect(html).toContain("FAR 2025, SIB M84:10");
  });

  it("visar lånelistan med fas, vikt och den fasta försiktighetsraden", () => {
    const html = rita();
    expect(html).toContain("1 mars 2027");
    expect(html).toContain("Rörligt");
    expect(html).toContain("2,5 % → 3,1 %");
    expect(html).toContain("≤ 24 mån");
    expect(html).toContain("År 3–5 · väger 50 %");
    expect(html).toContain('data-fas="senare"');
    expect(html).toContain("+36 000 kr/år");
    expect(html).toContain(
      "Lån som omsätts om 3–5 år räknas bara om de har lägre ränta än i dag, och väger mindre ju längre bort de ligger – ett medvetet försiktigt val.",
    );
    expect(html).toContain("Räntekänsligheten påverkar inte priset");
  });

  it("mappar avgiftstryck till samma toner som nyckeltalens status", () => {
    const html = rita();
    // gul total, röd refinansiering, gul spargap
    expect(html).toMatch(/data-ton="warning"[^>]*class="[^"]*bg-warning/);
    expect(html).toMatch(/data-ton="danger"[^>]*class="[^"]*bg-danger/);
    expect(html).toContain("text-warning");
    expect(html).toContain("Visst tryck på avgiften");
    expect(html).toContain("Tydlig avgiftshöjning väntas");
    // Sammanfattningen får ett märke för totalen (gul)
    const sam = html.slice(html.indexOf("SUMAVGIFT") - 400, html.indexOf("SUMAVGIFT"));
    expect(sam).toContain("Visst tryck på avgiften");
    expect(sam).toContain("bg-warning/15");
  });

  it("planbaserat mål: källa 'Underhållsplan s. N', ingen dämpning och ingen byggdelstabell", () => {
    const html = rita(analysMedPlanMal());
    expect(html).toContain("Underhållsplan s. 12");
    expect(html).not.toContain("Räknas till");
    expect(html).not.toContain("Livslängder: FAR 2025");
    expect(html).toContain("Inget tryck på avgiften");
    expect(html).toContain("bg-success");
  });

  it("gammal form (utan nya fält) renderar utan kedja och byggdelstabell", () => {
    const html = rita(analysMedPrognos());
    expect(html).not.toContain('data-slot="spar-steg"');
    expect(html).toContain("+500 kr/mån");
    expect(html).toContain("Lån som omsätts");
    expect(html).not.toContain("Lån som omsätts om 3–5 år");
    const helt = rita(analysUtanPrognos());
    expect(helt).not.toContain("Väntad avgiftsutveckling");
  });

  it("Priskoll utan prognos visar bara basraden, utan vattenfall", () => {
    const html = renderToStaticMarkup(
      <Prisrimlighet prisanalys={analysUtanPrognos().prisanalys} />,
    );
    expect(html).toContain("Vad jämförbara lägenheter säljs för");
    expect(html).not.toContain("Värde med hänsyn till föreningens ekonomi");
    expect(html).not.toContain("pris-vattenfall");
  });
});
