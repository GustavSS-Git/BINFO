import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToBuffer } from "@react-pdf/renderer";
import { getDocumentProxy, extractText } from "unpdf";
import { beforeAll, describe, expect, it } from "vitest";
import { AnalysPdfDocument } from "@/components/pdf/AnalysPdfDocument";
import { registerPdfFonts, type PdfFontSources } from "@/components/pdf/fonts";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import type { AnalysisResult } from "@/types/analysis";

const here = path.dirname(fileURLToPath(import.meta.url));
const fontsDir = path.resolve(here, "../../../public/fonts");

async function fontSources(): Promise<PdfFontSources> {
  const url = async (file: string) =>
    `data:font/ttf;base64,${(await readFile(path.join(fontsDir, file))).toString("base64")}`;
  return {
    sans: {
      regular: await url("IBMPlexSans-Regular.ttf"),
      bold: await url("IBMPlexSans-Bold.ttf"),
    },
    serif: {
      regular: await url("LibreBaskerville-Regular.ttf"),
      bold: await url("LibreBaskerville-Bold.ttf"),
    },
  };
}

describe("AnalysPdfDocument — utan utgångspris", () => {
  let text: string;

  beforeAll(async () => {
    registerPdfFonts(await fontSources());
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
    text = (await extractText(doc, { mergePages: true })).text;
  }, 30_000);

  it("visar Binfos värdering men inga prisrader eller avvikelse", () => {
    expect(text).toContain("Binfos värdering");
    expect(text).not.toContain("Är priset rimligt?");
    expect(text).not.toContain("Pris per kvadratmeter");
    // Etiketten följs annars av ett belopp (slutsatsen och budpremien är fri text).
    expect(text).not.toMatch(/Utgångspris\s+\d/);
  });
});
