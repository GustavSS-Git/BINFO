import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToBuffer } from "@react-pdf/renderer";
import { extractText, getDocumentProxy } from "unpdf";
import { beforeAll, describe, expect, it } from "vitest";
import { registerPdfFonts, type PdfFontSources } from "@/components/pdf/fonts";
import { EXEMPEL } from "@/components/pdf/kalkylExempel.testdata";
import { KalkylPdfDocument } from "@/components/pdf/KalkylPdfDocument";
import { buildKalkylViewModel } from "@/components/pdf/kalkylViewModel";

const here = path.dirname(fileURLToPath(import.meta.url));
const fontsDir = path.resolve(here, "../../../public/fonts");

async function fontKallor(): Promise<PdfFontSources> {
  const url = async (f: string) =>
    `data:font/ttf;base64,${(await readFile(path.join(fontsDir, f))).toString("base64")}`;
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

describe("KalkylPdfDocument", () => {
  let buffer: Buffer;
  let text: string;
  let sidor: number;

  beforeAll(async () => {
    registerPdfFonts(await fontKallor());
    const vm = buildKalkylViewModel(EXEMPEL, {
      datum: new Date("2026-10-13T10:00:00Z"),
      etikett: "Exempelkalkyl",
    });
    buffer = await renderToBuffer(<KalkylPdfDocument vm={vm} />);
    const doc = await getDocumentProxy(new Uint8Array(buffer));
    sidor = doc.numPages;
    text = (await extractText(doc, { mergePages: true })).text;
    const dir = process.env["KALKYL_PDF_UT"];
    if (dir !== undefined) {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "bolanekalkyl.pdf"), buffer);
    }
  }, 60_000);

  it("är en giltig PDF på några få sidor", () => {
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(sidor).toBeGreaterThanOrEqual(2);
    expect(sidor).toBeLessThanOrEqual(5);
  });

  it("innehåller alla sektioner med svenska tecken", () => {
    for (const rubrik of [
      "Indata",
      "Månadskostnad",
      "Ränteavdrag per person",
      "Amortering",
      "Om räntan ändras",
      "Bankens kalkyl (KALP)",
      "Regler och antaganden",
    ]) {
      expect(text, rubrik).toContain(rubrik);
    }
    expect(text).toContain("Schablon (uppskattning)");
    expect(text).toContain("Lag (2026:226)");
    expect(text).toContain("Binfo är ett beslutsstöd");
  });

  it("visar KALP-utfallet som tecken och belopp", () => {
    expect(text).toMatch(/(Plus|Minus):/);
  });
});
