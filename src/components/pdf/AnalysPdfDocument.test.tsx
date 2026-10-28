import { renderToBuffer } from "@react-pdf/renderer";
import { extractText, getDocumentProxy } from "unpdf";
import { beforeAll, describe, expect, it } from "vitest";
import { AnalysPdfDocument } from "@/components/pdf/AnalysPdfDocument";
import { registerPdfFonts } from "@/components/pdf/fonts";
import { testFontSources } from "@/components/pdf/pdfTestFonts";
import { analysMedSparbehov } from "@/components/prognosTestdata";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import type { AnalysisResult } from "@/types/analysis";

async function render(analys: AnalysisResult): Promise<{ buffer: Buffer; text: string }> {
  const buffer = await renderToBuffer(<AnalysPdfDocument analys={analys} />);
  const doc = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(doc, { mergePages: true });
  return { buffer, text: text.replace(/\s+/g, " ") };
}

beforeAll(async () => {
  registerPdfFonts(await testFontSources());
});

describe("AnalysPdfDocument: the sample analysis as a real PDF", () => {
  let buffer: Buffer;
  let text: string;

  beforeAll(async () => {
    ({ buffer, text } = await render(sampleAnalysis));
  }, 60_000);

  it("produces a valid, non-trivially-sized PDF file", () => {
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(buffer.byteLength).toBeGreaterThan(10_000);
  });

  it("embeds å/ä/ö correctly (proves the Inter/Source Serif files carry the glyphs)", () => {
    expect(text).toContain("Räntekänslighet");
    expect(text).toContain("Föreningen");
    expect(text).toContain("Årsavgift per m²");
    expect(text).toContain("Månadsavgift");
  });

  it("has the web report's structure in the web report's order", () => {
    // Eyebrows are drawn uppercase (textTransform), so compare case-insensitively.
    const lower = text.toLowerCase();
    const iHuvud = lower.indexOf("rapport · analyserad");
    const markorer = [
      "Rapport · analyserad",
      "1 · Föreningen",
      "2 · Priset",
      "3 · Avgiften framåt",
      "4 · Inför visningen",
      "Källor och metod",
      "Rapporten är beslutsstöd, inte råd.",
    ].map((m) => lower.indexOf(m.toLowerCase()));
    expect(iHuvud).toBeGreaterThan(-1);
    expect(markorer.every((i) => i > -1)).toBe(true);
    expect([...markorer].sort((a, b) => a - b)).toEqual(markorer);
  });

  it("has the three summary cards right after the header", () => {
    const lower = text.toLowerCase();
    const iKort = lower.indexOf("stabil ekonomi");
    expect(iKort).toBeGreaterThan(lower.indexOf("rapport · analyserad"));
    expect(iKort).toBeLessThan(lower.indexOf("1 · föreningen"));
    expect(lower).toContain("binfos värdering");
    expect(lower).toContain("avgiften framåt");
    expect(text).toMatch(/\+463 kr\/mån/);
    expect(text).toContain("3 503 → ca 3 966 kr");
  });

  it("has no closing Sammanfattning (owner Q10)", () => {
    expect(text).not.toMatch(/Sammanfattning/);
  });

  it("lists every red flag as 'Att hålla koll på', with page references", () => {
    for (const flagga of sampleAnalysis.rodaFlaggor) expect(text).toContain(flagga.titel);
    expect(text).toContain("Att hålla koll på");
    expect(text).not.toMatch(/Medelrisk|Hög risk|Låg risk/);
    expect(text).toContain("fyra saker att hålla koll på");
    expect(text).toContain("s. 7");
  });

  it("has the nyckeltal table with all seven rows and 'Ingen bedömning' for the seventh", () => {
    for (const k of ["Nyckeltal", "Värde", "Bedömning", "Jämförelse", "Källa"]) {
      expect(text).toContain(k);
    }
    expect(text).toContain("Ingen bedömning");
    expect(text).toContain("Lagstadgat nyckeltal som Binfo inte bedömer");
    expect(text).toContain("Behov för huset: ca 321 kr/m²");
    expect(text).toContain("Riksgenomsnitt: 7 117 kr/m²");
    expect(text).toContain("s. 8");
  });

  it("has 'Mer ur årsredovisningen' open: händelser, I avgiften (all five items), antal", () => {
    expect(text).toContain("Mer ur årsredovisningen");
    expect(text).toContain("Väsentliga händelser");
    expect(text).toContain(sampleAnalysis.forening.vasentligaHandelser?.[0]?.text ?? "");
    expect(text).toContain("Värme, vatten och tv ingår (s. 14). El ingår inte (s. 8).");
    expect(text).toContain("39 lägenheter, 2 lokaler, 49 medlemmar (s. 4, 7).");
  });

  it("has the price section with the web's labels", () => {
    for (const t of [
      "Rimligt prisspann",
      "Priset i annonsen",
      "Vanlig budnivå i området",
      "Vad liknande lägenheter säljs för (Kungsholmen, 112 42)",
      "Föreningens ekonomi",
      "Rimligt prisspann — Binfos värdering ± 10 %",
      "Så har vi räknat",
    ]) {
      expect(text, t).toContain(t);
    }
    expect(text).not.toContain("Ungefärligt spann");
    expect(text).toContain("Utgångspris");
    expect(text).toContain("Utgångspris 5,00 mkr");
  });

  it("draws the span bar markers as text and labels the valuation an estimate", () => {
    expect(text).toContain("Vanligt bud");
    expect(text).toContain("Liknande lägenheter");
    expect(text).toContain("Uppskattning");
    expect(text).toContain("Binfo värderingsmodell");
  });

  it("has the fee section: boxes, table, drivers with 'Okänt' and '0 kr/mån'", () => {
    expect(text).toContain("Med högre ränta");
    expect(text).toContain("Dagens avgift");
    expect(text).toContain("+1 procentenhet");
    expect(text).toContain("+2 procentenheter");
    expect(text).toContain("Det här driver den förväntade avgiften");
    expect(text).toContain("Okänt");
    expect(text).toContain("0 kr/mån");
    expect(text).toContain("Förväntad avgift om två år: ca 3 966 kr");
  });

  it("has the questions with Varför, and Bra svar / Varningssignal on separate labels", () => {
    expect(text).toContain("Fem frågor till mäklaren och styrelsen");
    expect(text).toContain("Varför:");
    expect(text).toContain("Bra svar:");
    expect(text).toContain("Varningssignal:");
    for (const fraga of sampleAnalysis.fragor.filter((f) => f.ursprung === "analys")) {
      for (const ord of fraga.fraga
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .slice(0, 6)) {
        expect(text).toContain(ord);
      }
    }
  });

  it("has page numbers, the short disclaimer and the contact address in the footer", () => {
    expect(text).toMatch(/Sida 1 av \d+/);
    expect(text).toContain("Binfo är ett beslutsstöd, inte finansiell rådgivning.");
    expect(text).toContain("contactbinfohere@gmail.com");
    expect(text).toContain("tolkningsfel");
  });

  it("does not break fi/fl ligatures in the extracted text layer", () => {
    // fontkit would otherwise substitute one glyph whose ToUnicode entry several readers drop
    // ("fnansieras", "Röda faggor"); styles.page disables 'liga'.
    expect(text).toContain("finansiell");
    expect(text).toContain("fler höjningar");
    expect(text).toContain("finansiering");
  });
});

describe("AnalysPdfDocument: varianter", () => {
  it("renders a question's svarssignal in two labelled lines, and no signal line otherwise", async () => {
    const fraga = sampleAnalysis.fragor[0]!;
    const { svarssignal: _signal, ...utanSignalFraga } = fraga;
    const med: AnalysisResult = {
      ...sampleAnalysis,
      fragor: [
        {
          ...fraga,
          id: "med-signal",
          ursprung: "analys",
          svarssignal: "Bra svar: UNIKSIGNALALFA. Varningssignal: UNIKSIGNALBETA.",
        },
      ],
    };
    const utan: AnalysisResult = {
      ...sampleAnalysis,
      fragor: [{ ...utanSignalFraga, id: "utan", ursprung: "analys" }],
    };
    const [m, u] = await Promise.all([render(med), render(utan)]);
    expect(m.text).toContain("Bra svar: UNIKSIGNALALFA.");
    expect(m.text).toContain("Varningssignal: UNIKSIGNALBETA.");
    expect(m.text).toContain("En fråga till mäklaren och styrelsen");
    expect(u.text).not.toContain("UNIKSIGNAL");
  }, 60_000);

  it("says 'Inga röda flaggor identifierade.' when there are none", async () => {
    const { text } = await render({ ...sampleAnalysis, rodaFlaggor: [] });
    expect(text).toContain("Inga röda flaggor identifierade.");
    expect(text).toContain("inga större varningsflaggor");
  }, 60_000);

  it("shows the anonymisation notice and uses the förening as title when the address is erased", async () => {
    const { text } = await render({
      ...sampleAnalysis,
      input: { ...sampleAnalysis.input, adress: "", postnummer: "", orgnr: "" },
    });
    expect(text).toContain("Adressen raderad efter 12 månader");
    expect(text).not.toContain(sampleAnalysis.input.adress);
  }, 60_000);

  it("puts the coverage disclaimer first in the price section for utanför Stockholms län", async () => {
    const u = sampleAnalysis.prisanalys.varderingsunderlag;
    if (!u) throw new Error("sample has no varderingsunderlag");
    const { text } = await render({
      ...sampleAnalysis,
      prisanalys: {
        ...sampleAnalysis.prisanalys,
        varderingsunderlag: {
          ...u,
          omrade: null,
          tackning: "utanfor_lan" as const,
          prisniva: {
            region: "Riket",
            krPerM2: 60000,
            period: { fran: "2026-01-01", till: "2026-08-31" },
            kalla: "Svensk Mäklarstatistik",
          },
        },
      },
    });
    const iDisclaimer = text.indexOf("Utanför Binfos täckningsområde");
    expect(iDisclaimer).toBeGreaterThan(text.toLowerCase().indexOf("2 · priset"));
    expect(iDisclaimer).toBeLessThan(text.indexOf("Priset i annonsen"));
  }, 60_000);

  it("prints the osäker reason, the scanned-report notice and the debt line", async () => {
    const { text } = await render({
      ...sampleAnalysis,
      forening: {
        ...sampleAnalysis.forening,
        keyFigures: sampleAnalysis.forening.keyFigures.map((kf) =>
          kf.id === "skuldsattning_per_m2_brf_yta"
            ? { ...kf, figure: { ...kf.figure, osaker: "Skuldsättningen verkar vara i tusental." } }
            : kf,
        ),
      },
      prisanalys: {
        ...sampleAnalysis.prisanalys,
        andelAvForeningensSkuld: {
          value: 485_460,
          unit: "kr" as const,
          source: "berakning" as const,
          ref: { page: 9 },
        },
      },
      datakvalitet: { ...sampleAnalysis.datakvalitet, kalla: "skannad" as const },
    });
    expect(text).toContain("Osäker: Skuldsättningen verkar vara i tusental.");
    expect(text).toContain("Årsredovisningen var skannad");
    expect(text).toContain("Lägenhetens ungefärliga andel av föreningens lån");
    expect(text).toContain("Ingår inte i värderingen");
  }, 60_000);

  it("utan utgångspris: no annons list, no asking-price marker, 'Binfos värdering' as heading", async () => {
    const { utgangspris: _u, ...input } = sampleAnalysis.input;
    const {
      utgangspris: _pu,
      prisPerM2: _pp,
      avvikelseMotVardering: _a,
      ...prisanalys
    } = sampleAnalysis.prisanalys;
    const { text } = await render({ ...sampleAnalysis, input, prisanalys });
    expect(text).not.toContain("Priset i annonsen");
    expect(text).not.toContain("Är priset rimligt?");
    expect(text).toContain("Du angav inget utgångspris");
    expect(text).not.toMatch(/Utgångspris \d/);
  }, 60_000);

  it("utan räntekänslighet: the 'Med högre ränta' box says it cannot be computed", async () => {
    const { text } = await render({
      ...sampleAnalysis,
      rantestress: {
        ...sampleAnalysis.rantestress,
        rantekanslighetProcent: null,
        scenarier: [],
        kommentar: "Räntekänsligheten saknas.",
      },
    });
    expect(text).toContain("Inte möjligt att räkna då räntekänslighet saknas i rapporten.");
  }, 60_000);

  it("utan prognos (äldre resultat): scenario table instead of the expected-fee table", async () => {
    const { avgiftsprognos: _a, ...utan } = sampleAnalysis;
    const { text } = await render({
      ...utan,
      rantestress: { ...sampleAnalysis.rantestress, prognosTabell: undefined as never },
    });
    expect(text).toContain("Vad händer om räntan stiger?");
    expect(text).toContain("Kan inte uppskattas");
    expect(text).not.toContain("Det här driver den förväntade avgiften");
  }, 60_000);

  it("renders byggdelar, sparande och lån as tables", async () => {
    const { text } = await render(analysMedSparbehov());
    for (const t of [
      "Husets byggdelar",
      "Senast åtgärdad",
      "Troligen eftersatt",
      "Livslängder enligt FAR 2025 och SIB M84:10.",
      "Så blir det din avgift",
      "Föreningens lån",
      "År 3–5 · väger 50 %",
      "Visst tryck på avgiften",
      "−150 000 kr",
      "Din andel",
    ]) {
      expect(text, t).toContain(t);
    }
  }, 60_000);
});
