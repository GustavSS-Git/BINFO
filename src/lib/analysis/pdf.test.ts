import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractPdfText, pdfHasNoTextLayer } from "./pdf";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFile(path.join(here, "__fixtures__", name));

describe("pdfHasNoTextLayer", () => {
  it("är false när minst en sida har text", () => {
    expect(pdfHasNoTextLayer(["Hej världen"])).toBe(false);
    expect(pdfHasNoTextLayer(["", "Text på sida två", ""])).toBe(false);
  });

  it("är true när alla sidor saknar text (rent tomma eller bara whitespace)", () => {
    expect(pdfHasNoTextLayer([""])).toBe(true);
    expect(pdfHasNoTextLayer(["", "   ", "\n"])).toBe(true);
  });

  it("är true för ett dokument utan sidor alls", () => {
    expect(pdfHasNoTextLayer([])).toBe(true);
  });
});

describe("extractPdfText", () => {
  it("extraherar text sida-för-sida ur en PDF med textlager", async () => {
    const data = new Uint8Array(await fixture("med-text.pdf"));
    const result = await extractPdfText(data);

    expect(result.totalPages).toBe(1);
    expect(result.pages).toEqual(["Hej varlden"]);
    expect(result.pdfSaknarTextlager).toBe(false);
  });

  it("flaggar pdfSaknarTextlager för en PDF utan extraherbar text (skannad)", async () => {
    const data = new Uint8Array(await fixture("utan-text.pdf"));
    const result = await extractPdfText(data);

    expect(result.totalPages).toBe(1);
    expect(result.pdfSaknarTextlager).toBe(true);
  });
});
