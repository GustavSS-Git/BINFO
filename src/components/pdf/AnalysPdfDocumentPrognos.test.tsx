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
      "Värde med hänsyn till föreningens ekonomi utöver nuvarande avgift",
      "Sammanfattning",
      "SUMSLUTSATS",
      "TABELLKOMMENTAR",
    ]) {
      expect(text).toContain(t);
    }
    expect(text).not.toContain("Dina uppgifter mot årsredovisningen");
  });

  it("har byggårsnotisen vid priset", () => {
    expect(text.replace(/\s+/g, " ")).toContain(
      "Värderingen räknar med byggår 1958 enligt årsredovisningen, inte 1962 som du angav (s. 3).",
    );
  });

  it("noterar byggårets avvikelse vid Byggår i sammanfattningen", () => {
    expect(text.replace(/\s+/g, " ")).toContain("årsredovisningen: 1958, du angav 1962, s. 3");
  });
});

describe("AnalysPdfDocument — sparsteg och lån (2026-10-24c)", () => {
  it("renderar kedja, byggdelar och lån som text", async () => {
    const { analysMedSparbehov } = await import("@/components/prognosTestdata");
    const buf = await renderToBuffer(<AnalysPdfDocument analys={analysMedSparbehov()} />);
    const text = (
      await extractText(await getDocumentProxy(new Uint8Array(buf)), { mergePages: true })
    ).text.replace(/\s+/g, " ");
    for (const t of [
      "Sparande till underhåll",
      "Räknas till 50 % (schablon)",
      "Eftersatt",
      "Livslängder: FAR 2025, SIB M84:10",
      "År 3–5 · väger 50 %",
      "Visst tryck på avgiften",
      "−150 000 kr",
    ]) {
      expect(text).toContain(t);
    }
  }, 30_000);
});
