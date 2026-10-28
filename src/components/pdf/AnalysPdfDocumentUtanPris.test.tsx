import { renderToBuffer } from "@react-pdf/renderer";
import { extractText, getDocumentProxy } from "unpdf";
import { beforeAll, describe, expect, it } from "vitest";
import { AnalysPdfDocument } from "@/components/pdf/AnalysPdfDocument";
import { registerPdfFonts } from "@/components/pdf/fonts";
import { testFontSources } from "@/components/pdf/pdfTestFonts";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import type { AnalysisResult } from "@/types/analysis";

describe("AnalysPdfDocument: utan utgångspris", () => {
  let text: string;

  beforeAll(async () => {
    registerPdfFonts(await testFontSources());
    const { utgangspris: _u, ...input } = sampleAnalysis.input;
    const {
      utgangspris: _pu,
      prisPerM2: _pp,
      avvikelseMotVardering: _a,
      ...prisanalys
    } = sampleAnalysis.prisanalys;
    const analys: AnalysisResult = { ...sampleAnalysis, input, prisanalys };
    const buffer = await renderToBuffer(<AnalysPdfDocument analys={analys} />);
    const doc = await getDocumentProxy(new Uint8Array(buffer));
    text = (await extractText(doc, { mergePages: true })).text.replace(/\s+/g, " ");
  }, 60_000);

  it("visar Binfos värdering men inga annonspris-rader eller avvikelse", () => {
    expect(text).toContain("Binfos värdering");
    expect(text).not.toContain("Är priset rimligt?");
    expect(text).not.toContain("Priset i annonsen");
    expect(text).not.toContain("Pris per kvadratmeter");
    // Etiketten följs annars av ett belopp (slutsatsen och budpremien är fri text).
    expect(text).not.toMatch(/Utgångspris \d/);
  });
});
