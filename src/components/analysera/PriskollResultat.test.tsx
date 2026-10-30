import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PriskollResultat } from "@/components/analysera/PriskollResultat";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import type { Prisanalys, PrisuppskattningResultat } from "@/types/analysis";

const plattaUt = (html: string) => html.replace(/\s/g, " ");
const utanTaggar = (html: string) => plattaUt(html.replace(/<[^>]*>/g, ""));

/** Priskollens form: provexemplets värdering utan avgiftsjusteringen (finns inte i Priskollen). */
function resultat(over: Partial<Prisanalys> = {}): PrisuppskattningResultat {
  const {
    justeradVardering: _j,
    justeringar: _g,
    avvikelseMotJusteradVardering: _a,
    breddningsskal: _b,
    andelAvForeningensSkuld: _s,
    ...bas
  } = sampleAnalysis.prisanalys;
  return {
    schemaVersion: "1.0.0",
    skapad: "2026-10-28T10:00:00.000Z",
    input: {
      boarea: 48,
      antalRum: 2,
      manadsavgift: 3503,
      postnummer: "112 46",
      hiss: "okant",
      balkong: "nej",
    },
    prisanalys: { ...bas, ...over },
  };
}

const utan = <K extends keyof Prisanalys>(...nycklar: K[]): Partial<Prisanalys> =>
  Object.fromEntries(nycklar.map((n) => [n, undefined])) as Partial<Prisanalys>;

const rita = (r: PrisuppskattningResultat, props: Record<string, unknown> = {}) => {
  const html = renderToStaticMarkup(<PriskollResultat resultat={r} {...props} />);
  return { html, text: utanTaggar(html) };
};

describe("PriskollResultat med utgångspris och budpremie", () => {
  const med = resultat({
    utgangspris: { value: 4_995_000, unit: "kr", source: "anvandare" },
    budpremie: {
      omrade: "Kungsholmen",
      medianProcent: 5.4,
      medelProcent: 7.9,
      n: 120,
      dataperiod: { fran: "2026-01", till: "2026-08" },
    },
  });

  it("verdict, stycke, spann, tabell, notis och 'vad värderingen bygger på'", () => {
    const { html, text } = rita(med);
    expect(html).toContain('id="varde"');
    expect(text).toContain("Värdering utan hänsyn till föreningen");
    expect(text).toContain("Utgångspriset ligger under spannet");
    expect(text).toContain("Liknande lägenheter i området säljs för omkring 5,7 mkr");
    expect(text).toContain("spannet är 5,11–6,25 mkr");
    expect(text).toContain("Utgångspriset 5,0 mkr ligger under det.");
    // Medianen, inte "i snitt": samma ord och siffra.
    expect(text).toContain(
      "Räkna med budgivning: på Kungsholmen har bostäder typiskt sålts för 5,4 % över utgångspriset.",
    );
    expect(text).not.toContain("i snitt");
    expect(html).toContain('role="img"');
    for (const markor of ["Utgångspris", "Vanligt bud", "Liknande lägenheter"]) {
      expect(text).toContain(markor);
    }
    expect(text).toContain("5,26 mkr");
    expect(text).toContain("Värdering i siffror");
    expect(text).toContain("ca 5 680 000 kr");
    expect(text).toContain("5 110 000 – 6 250 000 kr");
    expect(text).toContain("4 995 000 kr");
    expect(text).toContain("ca 104 100 kr/m²");
    expect(text).toContain("ca 5 260 000 kr");
    expect(text).toContain("Utgångspris + 5,4 %, typiskt på Kungsholmen");
    expect(text).toContain("Föreningens ekonomi är inte inräknad, förutom avgiften.");
    expect(text).toContain("Lägg till årsredovisningen i steg 2 så räknar vi in det.");
    expect(text).toContain("Vad värderingen bygger på");
    expect(text).toContain("samband i försäljningsdata, inte orsaker");
    expect(text).toContain("Boarea:");
    expect(text).toContain("januari–augusti 2026");
  });

  it("utgångspris inom och över spannet ger rätt verdict och ordval", () => {
    const inom = rita(
      resultat({
        ...med.prisanalys,
        utgangspris: { value: 5_500_000, unit: "kr", source: "anvandare" },
      }),
    ).text;
    expect(inom).toContain("Utgångspriset ligger inom spannet");
    expect(inom).toContain("ligger inom det.");
    const over = rita(
      resultat({
        ...med.prisanalys,
        utgangspris: { value: 7_000_000, unit: "kr", source: "anvandare" },
      }),
    ).text;
    expect(over).toContain("Utgångspriset ligger över spannet");
    expect(over).toContain("ligger över det.");
  });

  it("negativ budpremie säger 'under' utan 'Räkna med budgivning'", () => {
    const { text } = rita(
      resultat({
        ...med.prisanalys,
        budpremie: {
          ...med.prisanalys.budpremie!,
          medianProcent: -2.3,
          omrade: "Hägersten-Liljeholmen",
        },
      }),
    );
    expect(text).toContain(
      "I Hägersten-Liljeholmen har bostäder typiskt sålts för 2,3 % under utgångspriset.",
    );
    expect(text).not.toContain("Räkna med budgivning");
    expect(text).toContain("Utgångspris − 2,3 %, typiskt i Hägersten-Liljeholmen");
  });

  it("sparad värdering utan steg 2 hänvisar inte till ett steg 2", () => {
    const { text } = rita(med, {
      harSteg2: false,
      eyebrow: "Omräknat med dagens modell",
      id: "omrakning",
    });
    expect(text).toContain("Omräknat med dagens modell");
    expect(text).not.toContain("i steg 2");
    expect(text).toContain("Analysera bostaden tillsammans med årsredovisningen");
  });
});

describe("PriskollResultat utan utgångspris", () => {
  const utanPris = resultat({
    ...utan("utgangspris", "prisPerM2", "avvikelseMotVardering", "budpremie"),
  });

  it("verdict är 'Liknande lägenheter säljs för ca …' och ingen budnivå eller utgångspriksmarkör", () => {
    const { text } = rita(utanPris);
    expect(text).toContain("Liknande lägenheter säljs för ca 5,7 mkr");
    expect(text).toContain(
      "Liknande lägenheter i området säljs för omkring 5,7 mkr, och spannet är 5,11–6,25 mkr.",
    );
    expect(text).not.toContain("Utgångspriset");
    expect(text).not.toContain("Vanligt bud");
    expect(text).not.toContain("Vanlig budnivå");
    expect(text).toContain("Rimligt prisintervall");
  });
});

describe("PriskollResultat utan budpremie (med utgångspris)", () => {
  it("visar inga budrader eller budmening", () => {
    const { text } = rita(
      resultat({
        utgangspris: { value: 4_995_000, unit: "kr", source: "anvandare" },
        ...utan("budpremie"),
      }),
    );
    expect(text).toContain("Utgångspriset ligger under spannet");
    expect(text).not.toContain("Vanligt bud");
    expect(text).not.toContain("Vanlig budnivå");
    expect(text).not.toContain("Räkna med budgivning");
  });
});

describe("PriskollResultat: täckning och saknad värdering", () => {
  it("utanför länet: täckningsvarning först i blocket", () => {
    const bas = resultat();
    const u = bas.prisanalys.varderingsunderlag!;
    const { html, text } = rita({
      ...bas,
      prisanalys: {
        ...bas.prisanalys,
        varderingsunderlag: {
          ...u,
          tackning: "utanfor_lan",
          prisniva: {
            region: "Riket",
            krPerM2: 40_000,
            period: { fran: "2026-01", till: "2026-08" },
            kalla: "SCB",
          },
        },
      },
    });
    expect(text).toContain("Utanför Binfos täckningsområde");
    expect(html.indexOf("Utanför Binfos täckningsområde")).toBeLessThan(
      html.indexOf("Värdering utan hänsyn till föreningen"),
    );
  });

  it("länet: metodtexten ligger i 'Vad värderingen bygger på'", () => {
    const bas = resultat();
    const u = bas.prisanalys.varderingsunderlag!;
    const { text } = rita({
      ...bas,
      prisanalys: {
        ...bas.prisanalys,
        varderingsunderlag: {
          ...u,
          tackning: "lan",
          kommun: "Nacka",
          prisniva: {
            region: "Nacka",
            krPerM2: 90_000,
            period: { fran: "2026-01", till: "2026-08" },
            kalla: "SCB",
          },
        },
      },
    });
    expect(text).toContain("skalade till genomsnittspriset i Nacka");
    expect(text).not.toContain("Utanför Binfos täckningsområde");
  });

  it("ingen värdering: 'Inte tillgänglig' och inga siffror, ingen spannfigur", () => {
    const { html, text } = rita(
      resultat({
        ...utan("externVardering", "justeradVardering", "varderingsunderlag", "budpremie"),
      }),
    );
    expect(text).toContain("Binfos värdering");
    expect(text).toContain("Inte tillgänglig — postnumret saknas eller är ogiltigt");
    expect(text).not.toContain("Värdering i siffror");
    expect(html).not.toContain('role="img"');
  });

  it("låg tillförlitlighet visar skälen", () => {
    const bas = resultat();
    const { text } = rita({
      ...bas,
      prisanalys: {
        ...bas.prisanalys,
        konfidens: { niva: "lag", skal: ["Postnumret saknas i områdesindelningen."] },
      },
    });
    expect(text).toContain("Låg tillförlitlighet: Postnumret saknas i områdesindelningen.");
  });
});
