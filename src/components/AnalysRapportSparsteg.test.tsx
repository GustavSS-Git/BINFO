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
  renderToStaticMarkup(<AnalysRapport analys={a} />).replace(/[\s\u00a0]+/g, " ");

describe("AnalysRapport — sparande, lån och färger (2026-10-24c)", () => {
  it("märker de två värdena och visar komponenternas delbelopp i prislistan", () => {
    const html = rita();
    expect(html).toContain("Vad liknande lägenheter säljs för");
    expect(html).toContain("Med föreningens ekonomi inräknad");
    expect(html).not.toContain('data-slot="pris-vattenfall"');
    // 300 kr/mån × 300 = 90 000, 500 × 300 = 150 000
    expect(html).toContain("−90 000 kr");
    expect(html).toContain("−150 000 kr");
    // Rounded to 1 000 kr in the price lists, with the components summing to the total.
    expect(html).toContain("Lågt sparande −90 000 kr · lån som läggs om −150 000 kr");
  });

  it("har alla utfällbara delar stängda och 'Så har vi räknat' hopfälld", () => {
    const html = rita();
    const taggar = html.match(/<details[^>]*>/g) ?? [];
    expect(taggar.length).toBeGreaterThanOrEqual(3);
    for (const t of taggar) expect(t).not.toMatch(/\sopen/);
  });

  it("visar sparandets uträkning: behov, sparar, glapp och din avgift, med källa", () => {
    const html = rita();
    const i = html.indexOf("Indikerat underhållsbehov");
    const spar = html.slice(i, html.indexOf("Föreningens lån"));
    for (const t of [
      "ca 310 kr/m² per år",
      "spann 250–350 kr/m²",
      "Föreningen sparar i dag",
      "120 kr/m² per år",
      "s. 5",
      "Sparar för lite",
      "ca 190 kr/m² per år",
      "Så blir det din avgift",
      "ca +300 kr/mån",
      "190 kr/m² × 50 %",
    ]) {
      expect(spar).toContain(t);
    }
  });

  it("visar principmeningen om lån till underhåll bara när finansieringsregeln gäller", () => {
    const princip = "En förening med låg skuld kan låna till underhållet";
    expect(rita()).not.toContain(princip);
    const a = analysMedSparbehov();
    const pg = a.avgiftsprognos!;
    const sb = pg.sparbehov!;
    const html = rita({
      ...a,
      avgiftsprognos: {
        ...pg,
        sparbehov: {
          ...sb,
          finansiering: {
            underskottKrPerM2: 0,
            lanebartKrPerM2: 190,
            skuldKrPerM2: 3000,
            skuldBas: "totalyta",
            takKrPerM2: 5000,
            lanatKr: 760_000,
            rantaProcent: 2.65,
            krPerArUnderskott: 0,
            krPerArOlanat: 0,
            krPerArRanta: 20_140,
          },
        },
      },
    });
    expect(html).toContain(
      "En förening med låg skuld kan låna till underhållet, så då räknar vi bara med räntan. Det gäller upp till en skuld på 5 000 kr/m²; ett sparande under noll betalas alltid med avgiften.",
    );
  });

  it("visar byggdelstabellen med statusar och källan för livslängder", () => {
    const html = rita();
    for (const t of ["Stambyte", "Inget nämnt, troligen original (1958)", "2019", "40–60 år"]) {
      expect(html).toContain(t);
    }
    for (const t of ["Troligen eftersatt", "Nyligen", "Ok", "Okänt"])
      expect(html).toContain(`>${t}<`);
    expect(html).toContain("250–350 kr/m²");
    expect(html).toContain("Livslängder enligt FAR 2025 och SIB M84:10");
  });

  it("visar lånelistan med läge per lån och den fasta försiktighetsraden", () => {
    const html = rita();
    expect(html).toContain("1 mars 2027");
    expect(html).toContain("Rörlig ränta");
    expect(html).not.toContain("Rörligt");
    expect(html).toContain("2,5 %");
    expect(html).toContain("Ca 3,1 % väntas");
    expect(html).toContain("År 3–5 · väger 50 %");
    expect(html).toContain(
      "Lån som omsätts om 3–5 år räknas bara om de har lägre ränta än i dag, och väger mindre ju längre bort de ligger – ett medvetet försiktigt val.",
    );
    // Raden "Din andel" följer med in i den förväntade avgiften.
    expect(html).toContain("Din andel");
    expect(html).not.toContain("Räntekänsligheten påverkar inte värderingen");
  });

  it("mappar avgiftstryck till samma toner som nyckeltalens status", () => {
    const html = rita();
    // gul total, röd refinansiering, gul spargap
    expect(html).toMatch(/data-ton="warning"[^>]*class="[^"]*(bg|text)-warning/);
    expect(html).toMatch(/data-ton="danger"[^>]*class="[^"]*(bg|text)-danger/);
    expect(html).toContain("Visst tryck på avgiften");
    expect(html).toContain("Tydlig avgiftshöjning väntas");
  });

  it("planbaserat mål: källa 'underhållsplan, s. N', ingen dämpning och ingen byggdelstabell", () => {
    const html = rita(analysMedPlanMal());
    expect(html).toContain("Enligt föreningens underhållsplan, s. 12");
    expect(html).not.toContain("Livslängder enligt FAR 2025");
    expect(html).not.toContain("Husets byggdelar");
    expect(html).toContain("Inget tryck på avgiften");
  });

  it("gammal form (utan nya fält) renderar utan sparrader och byggdelstabell", () => {
    const html = rita(analysMedPrognos());
    expect(html).not.toContain("Indikerat underhållsbehov");
    expect(html).toContain("+500 kr/mån");
    expect(html).toContain("Föreningens lån");
    expect(html).not.toContain("Lån som omsätts om 3–5 år");
    const helt = rita(analysUtanPrognos());
    expect(helt).not.toContain("Det här driver den förväntade avgiften");
  });

  it("Priskoll utan prognos visar bara basraden, utan vattenfall", () => {
    const html = renderToStaticMarkup(
      <Prisrimlighet prisanalys={analysUtanPrognos().prisanalys} />,
    );
    expect(html).toContain("Vad jämförbara lägenheter säljs för");
    expect(html).not.toContain("Värde med hänsyn till föreningens ekonomi utöver nuvarande avgift");
    expect(html).not.toContain("pris-vattenfall");
  });
});
