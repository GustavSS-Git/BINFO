import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToBuffer } from "@react-pdf/renderer";
import { extractText, getDocumentProxy } from "unpdf";
import { beforeAll, describe, expect, it } from "vitest";
import { AnalysPdfDocument } from "@/components/pdf/AnalysPdfDocument";
import { registerPdfFonts } from "@/components/pdf/fonts";
import { analysMedPrognos } from "@/components/prognosTestdata";

const fonts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../public/fonts");
const dataUrl = async (f: string) =>
  `data:font/ttf;base64,${(await readFile(path.join(fonts, f))).toString("base64")}`;

describe("AnalysPdfDocument — avgiftsprognos", () => {
  let text = "";
  beforeAll(async () => {
    registerPdfFonts({
      sans: {
        regular: await dataUrl("IBMPlexSans-Regular.ttf"),
        bold: await dataUrl("IBMPlexSans-Bold.ttf"),
      },
      serif: {
        regular: await dataUrl("LibreBaskerville-Regular.ttf"),
        bold: await dataUrl("LibreBaskerville-Bold.ttf"),
      },
    });
    const buf = await renderToBuffer(<AnalysPdfDocument analys={analysMedPrognos()} />);
    text = (await extractText(await getDocumentProxy(new Uint8Array(buf)), { mergePages: true }))
      .text;
  }, 30_000);

  it("innehåller de nya sektionerna", () => {
    for (const t of [
      "Så har vi räknat",
      "Dina uppgifter mot årsredovisningen",
      "Justerat för väntad avgiftshöjning",
      "Sammanfattning",
      "SUMSLUTSATS",
      "TABELLKOMMENTAR",
    ]) {
      expect(text).toContain(t);
    }
  });
});
