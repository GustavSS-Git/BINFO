import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bedomTextkvalitet,
  bedomTextkvalitetPerSida,
  extractPdfText,
  pdfHasNoTextLayer,
} from "./pdf";

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

  it("detacherar sin input-buffer (unpdf/pdf.js transfererar den) — en anropare som behöver bytesen efteråt (t.ex. för att skicka PDF:en vidare till API:et) måste skicka in en kopia", async () => {
    const data = new Uint8Array(await fixture("med-text.pdf"));
    expect(data.byteLength).toBeGreaterThan(0);

    await extractPdfText(data);

    expect(data.byteLength).toBe(0);
  });
});

describe("bedomTextkvalitetPerSida", () => {
  it("ger 0 för en sida med normal, sammanhängande text", () => {
    const [sida] = bedomTextkvalitetPerSida(["Föreningen har en skuld på flera miljoner kronor."]);
    expect(sida!.andelEntecknsTokens).toBe(0);
  });

  it("ger 1 för en sida där varje tecken är ett eget token (test_rapport.pdf-fallet)", () => {
    const [sida] = bedomTextkvalitetPerSida(["7 , 4 3 8 , 0 0"]);
    expect(sida!.andelEntecknsTokens).toBe(1);
    expect(sida!.tokenAntal).toBe(8);
  });

  it("ger 0 för en helt tom sida — det är pdfHasNoTextLayer:s jobb att flagga tomhet, inte detta", () => {
    const [sida] = bedomTextkvalitetPerSida([""]);
    expect(sida!.andelEntecknsTokens).toBe(0);
    expect(sida!.tokenAntal).toBe(0);
  });

  it("räknar en blandad sida proportionerligt", () => {
    const [sida] = bedomTextkvalitetPerSida(["a b cd ef g"]); // 3 av 5 tokens är entecken
    expect(sida!.tokenAntal).toBe(5);
    expect(sida!.andelEntecknsTokens).toBeCloseTo(3 / 5, 10);
  });

  it("ger en post per sida, i ordning, 1-indexerad", () => {
    const resultat = bedomTextkvalitetPerSida(["normal text här", "7 , 4 3 8"]);
    expect(resultat.map((s) => s.sida)).toEqual([1, 2]);
    expect(resultat[0]!.andelEntecknsTokens).toBe(0);
    expect(resultat[1]!.andelEntecknsTokens).toBe(1);
  });

  it("hanterar flera mellanslag/radbrytningar mellan tokens", () => {
    const [sida] = bedomTextkvalitetPerSida(["a\n\nb   c"]);
    expect(sida!.tokenAntal).toBe(3);
    expect(sida!.andelEntecknsTokens).toBe(1);
  });
});

describe("bedomTextkvalitet (dokumentnivå)", () => {
  it("ger 0 för ett dokument med enbart normal text", () => {
    expect(
      bedomTextkvalitet(["Föreningen har en skuld på flera miljoner.", "Sida två, också normal."]),
    ).toBe(0);
  });

  it("ger 1 för ett dokument där alla sidor är helt tecken-för-tecken", () => {
    expect(bedomTextkvalitet(["7 , 4 3 8", "9 , 0 0"])).toBe(1);
  });

  it("viktar per token, inte per sida — en kort garblad sida väger mindre än en lång normal sida", () => {
    const normalSida = Array.from({ length: 20 }, (_, i) => `ord${i}`).join(" "); // 20 tokens, längd > 1
    const garbladSida = "7 , 4 3 8"; // 5 entecken-tokens
    const score = bedomTextkvalitet([normalSida, garbladSida]);
    expect(score).toBeCloseTo(5 / 25, 10);
  });

  it("ger 0 för ett dokument utan text alls", () => {
    expect(bedomTextkvalitet(["", ""])).toBe(0);
  });

  it("ger 0 för ett dokument utan sidor", () => {
    expect(bedomTextkvalitet([])).toBe(0);
  });
});
