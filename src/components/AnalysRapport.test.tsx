import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  analysMedPlanMal,
  analysMedPrognos,
  analysMedSparbehov,
  analysUtanPrognos,
} from "@/components/prognosTestdata";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import { visatVarde } from "@/lib/analysisView";
import { formatSpannMkr } from "@/lib/prisVy";
import type { AnalysisResult } from "@/types/analysis";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => () => undefined }));

import { AnalysRapport } from "@/components/AnalysRapport";

/** Plattar ut blanktecken (inklusive hårda mellanslag från sv-SE-formateringen). */
const platta = (html: string) => html.replace(/[\s\u00a0]+/g, " ");
const rita = (a: AnalysisResult = sampleAnalysis, extra: object = {}) =>
  platta(renderToStaticMarkup(<AnalysRapport analys={a} {...extra} />));

const utanPris = (a: AnalysisResult): AnalysisResult => {
  const { utgangspris: _u, ...input } = a.input;
  const { utgangspris: _p, prisPerM2: _m, avvikelseMotVardering: _v, ...prisanalys } = a.prisanalys;
  return { ...a, input, prisanalys };
};

describe("AnalysRapport — struktur och rubriker", () => {
  const html = rita();

  it("har en h1 (adressen), en h2 per avsnitt och ankarlänkar till dem", () => {
    expect((html.match(/<h1/g) ?? []).length).toBe(1);
    expect(html).toMatch(/<h1[^>]*>Baltzar von Platens gata 6<\/h1>/);
    for (const id of ["foreningen", "priset", "avgiften", "fragor", "metod"]) {
      expect(html).toContain(`id="${id}"`);
    }
    for (const href of ["#foreningen", "#priset", "#avgiften"]) {
      expect(html).toContain(`href="${href}"`);
    }
    const ordning = [
      "1 · Föreningen",
      "2 · Priset",
      "3 · Avgiften framåt",
      "4 · Inför visningen",
    ].map((t) => html.indexOf(t));
    expect(ordning.every((i) => i > -1)).toBe(true);
    expect([...ordning].sort((a, b) => a - b)).toEqual(ordning);
  });

  it("huvudet: eyebrow, metarad med område och byggår, åtgärder", () => {
    expect(html).toMatch(/Rapport · analyserad 26 okt\. 2026/);
    expect(html).toContain(
      "Brf Pontonjären 3 · Kungsholmen · 2 rum · 48 m² · våning 4 · avgift 3 503 kr/mån · utgångspris 4 995 000 kr · byggår 1931",
    );
    expect(html).toContain("Ladda ner PDF");
    expect(html).toContain("Räkna på månadskostnaden");
  });

  it("avsnitt 1: rubriken följer betyget och antalet flaggor", () => {
    expect(html).toContain("Stabil ekonomi, två saker att hålla koll på");
    const utanFlaggor = rita({ ...sampleAnalysis, rodaFlaggor: [] });
    expect(utanFlaggor).toContain("Stabil ekonomi, inga större varningsflaggor");
    expect(utanFlaggor).not.toContain("Att hålla koll på</");
    const enFlagga = rita({
      ...sampleAnalysis,
      betyg: "C",
      rodaFlaggor: sampleAnalysis.rodaFlaggor.slice(0, 1),
    });
    expect(enFlagga).toContain("Godtagbar, med svagheter, en sak att hålla koll på");
  });

  it("sammanfattningen är borttagen från webben (data finns kvar)", () => {
    const a = analysMedPrognos();
    expect(a.sammanfattning).toBeDefined();
    const h = rita(a);
    for (const t of ["SUMBETYG", "SUMPRIS", "SUMAVGIFT", "SUMSLUTSATS"]) expect(h).not.toContain(t);
    expect(h).not.toContain(">Sammanfattning<");
  });

  it("avslutar med källor, slutruta och friskrivning med räkenskapsår och mejllänk", () => {
    const i = (t: string) => html.indexOf(t);
    expect(i("Källor och metod")).toBeGreaterThan(i("4 · Inför visningen"));
    expect(i("Har du råd med just den här?")).toBeGreaterThan(i("Källor och metod"));
    expect(i("Rapporten är beslutsstöd, inte råd.")).toBeGreaterThan(i("Har du råd"));
    expect(html).toContain("årsredovisning för 2025");
    expect(html).toMatch(/href="mailto:[^"]+\?subject=Fel%20i%20rapporten%20om%20Brf%20Pontonj/);
    expect(html).toContain("Hittar du ett fel? Säg till.");
  });

  it("sparaSlot hamnar i åtgärdsraden i huvudet och sparaKort före friskrivningen; inget av dem på /exempel", () => {
    const med = rita(sampleAnalysis, {
      sparaSlot: <i>SPARA-TOPP</i>,
      sparaKort: <i>SPARA-KORT</i>,
    });
    expect(med.indexOf("SPARA-TOPP")).toBeGreaterThan(med.indexOf("Ladda ner PDF"));
    expect(med.indexOf("SPARA-TOPP")).toBeLessThan(med.indexOf("Räkna på månadskostnaden"));
    expect(med.indexOf("SPARA-TOPP")).toBeLessThan(med.indexOf("1 · Föreningen"));
    expect(med.indexOf("SPARA-KORT")).toBeGreaterThan(med.indexOf("Har du råd"));
    expect(med.indexOf("SPARA-KORT")).toBeLessThan(med.indexOf("Rapporten är beslutsstöd"));
    expect(html).not.toContain("SPARA-");
  });

  it("raderad adress: rubriken blir föreningens namn", () => {
    const h = rita({ ...sampleAnalysis, input: { ...sampleAnalysis.input, adress: "" } });
    expect(h).toMatch(/<h1[^>]*>Brf Pontonjären 3<\/h1>/);
    expect(h).toContain("Kungsholmen · 2 rum");
    expect(h).not.toContain("Brf Pontonjären 3 · Kungsholmen");
  });
});

describe("AnalysRapport — sammanfattningskorten", () => {
  const html = rita();
  const kort = (href: string) => {
    const i = html.indexOf(`href="${href}"`);
    return html.slice(i, html.indexOf("</a>", i));
  };

  it("föreningen: betyg, skala, titel och motiveringens första mening", () => {
    const k = kort("#foreningen");
    expect(k).toContain('aria-label="Betyg B"');
    expect(k).toContain("Stabil ekonomi");
    expect(k).toContain(
      "Alla sju nyckeltal är godkända eller ograderade: inget är svagt eller kritiskt.",
    );
    expect(k).not.toContain("Skulden är låg");
    expect(k).toContain("Föreningen →");
  });

  it("värderingen: ca, spann, läge mot spannet och ett vanligt bud", () => {
    const k = kort("#priset");
    expect(k).toContain("ca 5,6 mkr");
    expect(k).toContain("Spann 4,99–6,10 mkr");
    expect(k).toContain("Utgångspriset 5,00 mkr ligger inom spannet.");
    expect(k).toContain("Ett vanligt bud i området landar runt 5,27 mkr.");
  });

  it("avgiften: totalen, avgift före och efter och orsaken", () => {
    const k = kort("#avgiften");
    expect(k).toContain("+463 kr/mån");
    expect(k).toContain("3 503 → ca 3 966 kr");
    expect(k).toContain("Främst för att föreningen sparar för lite till underhåll.");
    expect(k).toContain("Kan bli mer: kommande underhåll saknar belopp.");
  });

  it("utan utgångspris: neutral mening, ingen jämförelse och inget bud", () => {
    const k = (() => {
      const h = rita(utanPris(sampleAnalysis));
      const i = h.indexOf('href="#priset"');
      return h.slice(i, h.indexOf("</a>", i));
    })();
    expect(k).toContain("Du angav inget utgångspris");
    expect(k).not.toContain("ligger");
    expect(k).not.toContain("vanligt bud");
  });

  it("utan avgiftsprognos: kan inte uppskattas", () => {
    const h = rita(analysUtanPrognos());
    const i = h.indexOf('href="#avgiften"');
    const k = h.slice(i, h.indexOf("</a>", i));
    expect(k).toContain("Kan inte uppskattas");
    expect(k).not.toContain("→ ca");
  });

  it("utan värdering: ingen siffra, bara besked", () => {
    const { externVardering: _e, justeradVardering: _j, ...prisanalys } = sampleAnalysis.prisanalys;
    const h = rita({ ...sampleAnalysis, prisanalys });
    const i = h.indexOf('href="#priset"');
    const k = h.slice(i, h.indexOf("</a>", i));
    expect(k).toContain("Ingen värdering");
    expect(k).not.toContain("Spann");
  });
});

describe("AnalysRapport — avsnitt 1: Föreningen", () => {
  const html = rita();

  it("flaggorna med pill och sidhänvisning", () => {
    expect(html).toContain("Att hålla koll på");
    expect(html).toContain("Tom lokal och 22 % avgiftshöjning");
    expect(html).toMatch(/title="[^"]*"[^>]*>s\. 7<\/span>/);
  });

  it("nyckeltalstabellen: kolumner, sju rader och den sjunde utan bedömning", () => {
    const tabell = html.slice(html.indexOf("<table"), html.indexOf("</table>"));
    expect(tabell).toContain("<caption>De sju nyckeltalen</caption>");
    for (const th of ["Nyckeltal", "Värde", "Bedömning", "Jämförelse", "Källa"]) {
      expect(tabell).toContain(`<th scope="col">${th}</th>`);
    }
    expect((tabell.match(/<th scope="row"/g) ?? []).length).toBe(7);
    expect(tabell.indexOf("Sparande per m²")).toBeLessThan(tabell.indexOf("Årsavgifternas andel"));
    expect(tabell).toContain("Ingen bedömning");
    expect(tabell).toContain("Lagstadgat nyckeltal som Binfo inte bedömer");
    expect(tabell).toContain("Riksgenomsnitt: 7 117 kr/m²");
    expect(tabell).toContain("Stockholmssnitt: 833 kr/m²");
    expect(tabell).not.toContain("Snitt Stockholm");
    expect(tabell).toContain(">s. 8<");
  });

  it("sparande jämförs med husets behov när prognosen har ett sparbehov", () => {
    const h = rita(analysMedSparbehov());
    expect(h).toContain("Behov för huset: ca 310 kr/m²");
    expect(rita(analysMedPrognos())).not.toContain("Behov för huset");
  });

  it("'Mer ur årsredovisningen': händelser, 'I avgiften' över alla fem poster och föreningens antal", () => {
    expect(html).toContain(
      "Mer ur årsredovisningen: händelser, vad som ingår i avgiften, antal lägenheter",
    );
    expect(html).toContain("Väsentliga händelser");
    expect(html).toContain("(s. 7)");
    expect(html).toContain(
      "Värme, vatten och tv ingår (s. 14). El ingår inte (s. 8). Bredband framgår inte.",
    );
    expect(html).toContain("39 lägenheter, 2 lokaler, 49 medlemmar (s. 4, 7).");
  });

  it("skannad årsredovisning visas som en synlig notis", () => {
    const h = rita({
      ...sampleAnalysis,
      datakvalitet: { ...sampleAnalysis.datakvalitet, kalla: "skannad" },
    });
    expect(h).toContain("Skannad årsredovisning");
    expect(h).toContain("siffrorna är avlästa från sidbilderna");
    expect(html).not.toContain("Skannad årsredovisning");
  });

  it("osäker figur behåller sin markering i tabellen", () => {
    const kfs = sampleAnalysis.forening.keyFigures.map((k, i) =>
      i === 0 ? { ...k, figure: { ...k.figure, osaker: "Stämmer inte med balansräkningen" } } : k,
    );
    const h = rita({
      ...sampleAnalysis,
      forening: { ...sampleAnalysis.forening, keyFigures: kfs },
    });
    expect(h).toContain("Stämmer inte med balansräkningen");
    expect(h).toContain("Osäker");
  });
});

describe("AnalysRapport — avsnitt 2: Priset", () => {
  it("verdikt, spann, markörer och de två listorna", () => {
    const a = analysMedPrognos();
    const html = rita(a);
    expect(html).toContain("Utgångspriset ligger inom spannet");
    expect(html).toContain(`alltså ${formatSpannMkr(visatVarde(a.prisanalys)!.exakt)}`);
    expect(html).toContain("Rimligt prisspann");
    for (const m of ["Utgångspris", "Vanligt bud", "Binfos värdering", "Liknande lägenheter"]) {
      expect(html).toContain(m);
    }
    const img = /role="img" aria-label="(Värdespann[^"]*)"/.exec(html)?.[1] ?? "";
    expect(img).toContain("Värdespann 4,98 till 6,08 miljoner kronor");
    expect(img).toContain("Utgångspriset 5,0 miljoner ligger inom spannet");
    expect(img).toContain("Liknande lägenheter säljs för 5,68 miljoner");
    for (const rubrik of ["Priset i annonsen", "Vanlig budnivå i området"]) {
      expect(html).toContain(rubrik);
    }
    expect(html).toContain(
      "Utgångspriset plus 5,4 %, vad bostäder på Kungsholmen brukar gå för över utgångspris",
    );
    expect(html).toContain("Vad liknande lägenheter säljs för (Kungsholmen, 112 42)");
    expect(html).toContain("Föreningens ekonomi");
    expect(html).toContain("Med föreningens ekonomi inräknad");
    expect(html).toContain("Binfos värdering ± 10 %");
  });

  it("föreningens ekonomi: komponenternas effekter summerar till totalen", () => {
    const html = rita(analysMedSparbehov());
    expect(html).toContain("Lågt sparande −90 000 kr · lån som läggs om −150 000 kr");
    expect(html).toContain("−240 000 kr");
  });

  it("utan avgiftsprognos finns bara en värdering, ingen 'Liknande lägenheter'-markör", () => {
    const html = rita(analysUtanPrognos());
    expect(html).toContain("Utan justering för föreningens ekonomi");
    expect(html).not.toContain("Med föreningens ekonomi inräknad");
    const img = /role="img" aria-label="(Värdespann[^"]*)"/.exec(html)?.[1] ?? "";
    expect(img).not.toContain("Liknande lägenheter");
  });

  it("utan utgångspris: rubriken 'Binfos värdering', ingen annonsruta och inget vanligt bud", () => {
    const html = rita(utanPris(sampleAnalysis));
    expect(html).toContain("2 · Priset");
    const avsnitt = html.slice(html.indexOf('id="priset"'), html.indexOf('id="avgiften"'));
    expect(avsnitt).toMatch(/<h2[^>]*>Binfos värdering<\/h2>/);
    expect(avsnitt).not.toContain("Priset i annonsen");
    expect(avsnitt).not.toContain("Vanligt bud");
    expect(avsnitt).not.toContain("Vanlig budnivå");
    // Budpremien finns kvar som mening när det inte går att räkna ut ett bud.
    expect(avsnitt).toContain("Bostäder på Kungsholmen har sålts för 5,4 % över utgångspriset.");
  });

  it("utan budpremie (länet): ingen budrad eller budmarkör, och täckningsrutan kommer först", () => {
    const { budpremie: _b, ...prisanalys } = sampleAnalysis.prisanalys;
    const u = sampleAnalysis.prisanalys.varderingsunderlag!;
    const a: AnalysisResult = {
      ...sampleAnalysis,
      prisanalys: {
        ...prisanalys,
        varderingsunderlag: {
          ...u,
          omrade: null,
          tackning: "lan",
          kommun: "Nacka",
          prisniva: {
            region: "Nacka",
            krPerM2: 90_000,
            period: { fran: "2026-01-01", till: "2026-08-31" },
            kalla: "SCB",
          },
        },
      },
    };
    const html = rita(a);
    const avsnitt = html.slice(html.indexOf('id="priset"'), html.indexOf('id="avgiften"'));
    expect(avsnitt).not.toContain("Vanligt bud");
    expect(avsnitt).not.toContain("Vanlig budnivå");
    expect(avsnitt.indexOf("Värdering utanför Stockholms kommun")).toBeGreaterThan(-1);
    expect(avsnitt.indexOf("Värdering utanför Stockholms kommun")).toBeLessThan(
      avsnitt.indexOf("Rimligt prisspann"),
    );
    expect(avsnitt).toContain("Vad liknande lägenheter säljs för (Nacka, 112 42)");
    expect(html).toContain("Prisnivå för Nacka: SCB");
  });

  it("utanför länet: varningsrutan med sin rubrik", () => {
    const u = sampleAnalysis.prisanalys.varderingsunderlag!;
    const { budpremie: _b, ...prisanalys } = sampleAnalysis.prisanalys;
    const html = rita({
      ...sampleAnalysis,
      prisanalys: {
        ...prisanalys,
        varderingsunderlag: { ...u, tackning: "utanfor_lan", omrade: null },
      },
    });
    expect(html).toContain("Utanför Binfos täckningsområde");
  });

  it("utan externVardering: 'Inte tillgänglig', inget spann och ingen markör", () => {
    const {
      externVardering: _e,
      justeradVardering: _j,
      justeringar: _ju,
      ...prisanalys
    } = sampleAnalysis.prisanalys;
    const html = rita({ ...sampleAnalysis, prisanalys });
    expect(html).toContain("Inte tillgänglig — postnumret saknas eller är ogiltigt");
    expect(html).not.toContain('role="img" aria-label="Värdespann');
    expect(html).not.toContain("Rimligt prisspann");
  });

  it("behåller byggårsnotisen, döljer skuldraden och har exakt två dolda element", () => {
    const html = rita(analysMedPrognos());
    expect(html).toContain('data-slot="pris-byggar"');
    expect(html).toContain("Värderingen räknar med byggår 1958 enligt årsredovisningen, inte 1962");
    // The debt-share row stays in the DOM but is owner-hidden (Lovable, 2026-11-03).
    expect(html).toMatch(/<p class="hidden[^"]*">Lägenhetens ungefärliga andel av föreningens lån/);
    // Valuation provider line + debt-share row; nothing else may be hidden.
    expect((html.match(/<(p|div) class="hidden[^"]*">/g) ?? []).length).toBe(2);
  });

  it("'Så har vi räknat' är hopfälld och innehåller bara värderingsmodellen och spannet", () => {
    const html = rita(analysMedSparbehov());
    const i = html.indexOf("Så har vi räknat");
    const tagg = /<details[^>]*>/.exec(html.slice(html.lastIndexOf("<details", i)))?.[0] ?? "";
    expect(tagg).not.toMatch(/\sopen/);
    const inne = html.slice(i, html.indexOf("</details>", i));
    expect(inne).toContain("Värderingsmodellen");
    expect(inne).toContain("version 3.1");
    expect(inne).toContain("Modellen är tränad på");
    expect(inne).toContain("Månadsavgift: högre avgift drar ner priset.");
    expect(inne).toContain("inget statistiskt konfidensintervall");
    // Owner 2026-10-29: no typical error, no model conclusion, no fee-to-price block here.
    expect(inne).not.toContain("typiska fel");
    expect(inne).not.toContain("Hur föreningens ekonomi påverkar priset");
    expect(inne).not.toContain('data-slot="pris-vattenfall"');
  });
});

describe("AnalysRapport — avsnitt 3: Avgiften framåt", () => {
  it("rubrik, ingress, flikar och reglage med prognos", () => {
    const html = rita();
    expect(html).toContain("Räkna med ca 463 kr mer i månaden inom två år");
    expect(html).toContain("Det mesta beror på att föreningen sparar för lite till underhåll.");
    expect(html).toContain("Hur mycket räntan påverkar ser du längre ner.");
    expect(html).toContain('type="range"');
    expect(html).toContain("Räntehöjning för föreningen");
    expect(html).toMatch(/<button[^>]*bg-card[^>]*>Dagens avgift<\/button>/);
    expect(html).toMatch(/<button[^>]*>Förväntad avgift<\/button>/);
    expect(html).not.toMatch(/<button[^>]*bg-card[^>]*>Förväntad avgift<\/button>/);
    expect(html).toContain("Med högre ränta");
    expect(html).toContain("+1 p.e.");
  });

  it("gamla resultat utan prognos: bara reglaget, ingen flikväxlare", () => {
    const html = rita(analysUtanPrognos());
    expect(html).toContain('type="range"');
    expect(html).not.toMatch(/<button[^>]*>Förväntad avgift<\/button>/);
    expect(html).toContain("Vad händer om räntan stiger?");
    expect(html).not.toContain("Det här driver den förväntade avgiften");
  });

  it("utan räntekänslighet: låst reglage och förklaring", () => {
    const a = analysMedPrognos();
    const html = rita({
      ...a,
      rantestress: { ...a.rantestress, rantekanslighetProcent: null, scenarier: [] },
    });
    expect(html).toMatch(/<input[^>]*type="range"[^>]*disabled/);
    expect(html).toContain("Räntekänslighet saknas i årsredovisningen");
    expect(html).toContain("Inte möjligt att räkna då räntekänslighet saknas i rapporten.");
  });

  it("drivartabellen: värden per komponent, 'Okänt', grupperad rad och 'Förväntad avgift om två år'", () => {
    const html = rita();
    const i = html.indexOf("Det här driver den förväntade avgiften");
    expect(html.slice(i, i + 200)).toContain("ca 3 966 kr om två år (+463)");
    const det = html.slice(i, html.indexOf("</details>", i));
    expect(det).toContain("+450 kr/mån");
    expect(det).toContain("+13 kr/mån");
    expect(det).toContain("Okänt");
    expect(det).toContain("Beslutade höjningar, lokalhyra, energiprojekt");
    expect(det).toContain("0 kr/mån");
    expect(det).toContain("Förväntad avgift om två år");
    expect(det).toContain("Energikostnaden ingår redan i dagens avgift");
  });

  it("byggdelstabell, sparandets uträkning och lånen (schablonmål)", () => {
    const html = rita(analysMedSparbehov());
    for (const t of [
      "Husets byggdelar",
      "Senast åtgärdad",
      "Brukar hålla",
      "Stambyte",
      "40–60 år",
    ]) {
      expect(html).toContain(t);
    }
    expect(html).toContain("Inget nämnt, troligen original (1958)");
    expect(html).toContain("2019 <span");
    for (const t of ["Troligen eftersatt", "Nyligen", ">Ok<", ">Okänt<"]) expect(html).toContain(t);
    expect(html).toContain("Livslängder enligt FAR 2025 och SIB M84:10.");
    expect(html).toContain("250–350 kr/m²");
    expect(html).toContain("Så blir det din avgift");
    expect(html).toContain("190 kr/m² × 50 %");
    expect(html).toContain("Föreningens lån");
    expect(html).toContain("Ränta i årsredovisningen");
    expect(html).toContain("1 mars 2027");
    expect(html).toContain("Rörlig ränta");
    expect(html).toContain("År 3–5 · väger 50 %");
    expect(html).toContain("2,5 %");
    expect(html).toContain("3-månaders statsskuldväxel");
    expect(html).toContain("Lån som omsätts om 3–5 år räknas bara om de har lägre ränta än i dag");
    expect(html).toContain("Förväntad förändring i föreningens årliga räntekostnader");
    expect(html).toContain("Din andel");
  });

  it("planbaserat mål: sparrader men ingen byggdelstabell", () => {
    const html = rita(analysMedPlanMal());
    expect(html).toContain("Enligt föreningens underhållsplan, s. 12");
    expect(html).not.toContain("Husets byggdelar");
    expect(html).not.toContain("Brukar hålla");
  });

  it("gammal form med prognos men utan sparbehov och lånelista: inga byggdelar, lånerader som text", () => {
    const html = rita(analysMedPrognos());
    expect(html).not.toContain("Husets byggdelar");
    expect(html).toContain("Föreningens lån");
    expect(html).toContain("50 % av skulden");
  });
});

describe("AnalysRapport — avsnitt 4 och byggår", () => {
  it("frågorna: rubrik i ord, ingress och bara analysfrågor", () => {
    const html = rita();
    expect(html).toContain("Fem frågor till mäklaren och styrelsen");
    expect(html).toContain(
      "Svaren avgör om betyget och avgiftsprognosen håller. Bocka av frågorna när du har fått svar.",
    );
    expect(html).not.toContain("Ingår bredband i månadsavgiften?");
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(5);
  });

  it("byggårets avvikelse syns i huvudet, inte som egen sektion", () => {
    const html = rita(analysMedPrognos());
    expect(html).not.toContain("Dina uppgifter mot årsredovisningen");
    expect(html).toContain("Årsredovisningen: 1958 (du angav 1962)");
    expect(html).toContain("Avviker");
    expect(html.indexOf("Avviker")).toBeLessThan(html.indexOf("1 · Föreningen"));
  });

  it("värdeår enligt årsredovisningen i metaraden", () => {
    const { byggar: _b, ...input } = sampleAnalysis.input;
    const html = rita({
      ...sampleAnalysis,
      input,
      uppgiftsjamforelse: [
        {
          falt: "byggar",
          label: "Byggår",
          status: "endast_rapport",
          rapport: 1931,
          anvant: 1931,
          text: "Årsredovisningen anger 1931.",
          ref: { page: 4, excerpt: "Värdeåret är 1931" },
        },
      ],
    });
    expect(html).toContain("värdeår 1931 enligt årsredovisningen");
  });
});

describe("AnalysRapport — Booli i källor och metod", () => {
  it("syns bara när uppgifterna hämtats från en Booli-annons", () => {
    expect(rita()).not.toContain("hämtades från Booli");
    const medBooli: AnalysisResult = {
      ...sampleAnalysis,
      input: {
        ...sampleAnalysis.input,
        kalla: {
          typ: "booli",
          url: "https://www.booli.se/annons/6279984",
          hamtad: "2026-10-24T10:00:00.000Z",
          oandradeFalt: [],
        },
      },
    };
    expect(rita(medBooli)).toContain(
      "Uppgifter om bostaden hämtades från Booli (booli.se) den 24 okt. 2026.",
    );
  });
});
