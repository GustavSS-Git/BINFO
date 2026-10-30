import { renderToBuffer } from "@react-pdf/renderer";
import { extractText, getDocumentProxy } from "unpdf";
import { beforeAll, describe, expect, it } from "vitest";
import { AnalysPdfDocument } from "@/components/pdf/AnalysPdfDocument";
import { registerPdfFonts } from "@/components/pdf/fonts";
import { testFontSources } from "@/components/pdf/pdfTestFonts";
import { analysMedPrognos } from "@/components/prognosTestdata";

describe("AnalysPdfDocument: avgiftsprognos", () => {
  let text = "";
  beforeAll(async () => {
    registerPdfFonts(await testFontSources());
    const buf = await renderToBuffer(<AnalysPdfDocument analys={analysMedPrognos()} />);
    text = (
      await extractText(await getDocumentProxy(new Uint8Array(buf)), { mergePages: true })
    ).text.replace(/\s+/g, " ");
  }, 60_000);

  it("innehåller prisets och avgiftens avsnitt men ingen Sammanfattning", () => {
    for (const t of [
      "Så har vi räknat",
      "Föreningens ekonomi",
      "Med föreningens ekonomi inräknad",
      "Det här driver den förväntade avgiften",
      "TABELLKOMMENTAR",
    ]) {
      expect(text, t).toContain(t);
    }
    expect(text).not.toContain("SUMSLUTSATS");
    expect(text).not.toContain("Sammanfattning");
    expect(text).not.toContain("Dina uppgifter mot årsredovisningen");
  });

  it("har byggårsnotisen vid priset", () => {
    expect(text).toContain(
      "Värderingen räknar med byggår 1958 enligt årsredovisningen, inte 1962 som du angav (s. 3).",
    );
  });

  it("noterar byggårets avvikelse under rapportens metarad", () => {
    expect(text).toMatch(/Avviker: .*1958/);
  });
});
