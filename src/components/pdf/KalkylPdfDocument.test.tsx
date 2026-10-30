import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import { extractText, getDocumentProxy } from "unpdf";
import { beforeAll, describe, expect, it } from "vitest";
import { registerPdfFonts } from "@/components/pdf/fonts";
import { EXEMPEL } from "@/components/pdf/kalkylExempel.testdata";
import { KalkylPdfDocument } from "@/components/pdf/KalkylPdfDocument";
import { buildKalkylViewModel } from "@/components/pdf/kalkylViewModel";
import { testFontSources } from "@/components/pdf/pdfTestFonts";

describe("KalkylPdfDocument", () => {
  let buffer: Buffer;
  let text: string;
  let sidor: number;

  beforeAll(async () => {
    registerPdfFonts(await testFontSources());
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

  it("har sidnummer i sidfoten på varje sida (Inter + Source Serif 4 inbäddade)", () => {
    for (let i = 1; i <= sidor; i++) expect(text).toContain(`Sida ${i} av ${sidor}`);
  });

  it("visar KALP-utfallet som tecken och belopp", () => {
    expect(text).toMatch(/(Plus|Minus):/);
  });
});
