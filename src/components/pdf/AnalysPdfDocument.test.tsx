import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToBuffer } from "@react-pdf/renderer";
import { getDocumentProxy, extractText } from "unpdf";
import { beforeAll, describe, expect, it } from "vitest";
import { AnalysPdfDocument } from "@/components/pdf/AnalysPdfDocument";
import { registerPdfFonts, type PdfFontSources } from "@/components/pdf/fonts";
import { sampleAnalysis } from "@/data/sampleAnalysis";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicFontsDir = path.resolve(here, "../../../public/fonts");

/**
 * Node's global fetch (used internally by react-pdf's font loader in both
 * environments) cannot resolve a site-relative "/fonts/…" URL — there is no
 * origin to resolve it against outside a browser — nor a local file://
 * path (undici's fetch does not implement the file: scheme). A data: URL
 * works in both, so the test registers the exact same on-disk TTFs
 * (public/fonts/…, the files the real download path serves) as base64
 * data: URLs instead of point at a running server.
 */
async function loadTestFontSources(): Promise<PdfFontSources> {
  const toDataUrl = async (file: string) => {
    const buffer = await readFile(path.join(publicFontsDir, file));
    return `data:font/ttf;base64,${buffer.toString("base64")}`;
  };
  return {
    sans: {
      regular: await toDataUrl("IBMPlexSans-Regular.ttf"),
      bold: await toDataUrl("IBMPlexSans-Bold.ttf"),
    },
    serif: {
      regular: await toDataUrl("LibreBaskerville-Regular.ttf"),
      bold: await toDataUrl("LibreBaskerville-Bold.ttf"),
    },
  };
}

describe("AnalysPdfDocument — renders the sample analysis to a real PDF", () => {
  let pdfBuffer: Buffer;
  let extractedText: string;

  beforeAll(async () => {
    registerPdfFonts(await loadTestFontSources());
    pdfBuffer = await renderToBuffer(<AnalysPdfDocument analys={sampleAnalysis} />);

    const data = new Uint8Array(pdfBuffer);
    const doc = await getDocumentProxy(data);
    const { text } = await extractText(doc, { mergePages: true });
    extractedText = text;

    // Saved for the supervisor to open and visually inspect (see task brief).
    const scratchpadDir =
      "/private/tmp/claude-501/-Users-gustavslanesens-Documents-GitHub-BINFO/228dca42-5f10-4020-b3c2-dcc28698a4b6/scratchpad/pdf-export";
    await mkdir(scratchpadDir, { recursive: true });
    await writeFile(path.join(scratchpadDir, "exempel.pdf"), pdfBuffer);
  }, 30_000);

  it("produces a valid, non-trivially-sized PDF file", () => {
    expect(pdfBuffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pdfBuffer.byteLength).toBeGreaterThan(10_000);
  });

  it("embeds the Swedish characters å/ä/ö correctly (proves font embedding, not just glyph fallback)", () => {
    expect(extractedText).toContain("Årsavgift");
    expect(extractedText).toContain("Föreningens");
    expect(extractedText).toContain("Räntekänslighet");
  });

  it("includes the räntestress section with every scenario", () => {
    expect(extractedText).toContain("Räntekänslighet");
    expect(extractedText).toContain("+0 p.e.");
    expect(extractedText).toContain("+1 p.e.");
    expect(extractedText).toContain("+2 p.e.");
    expect(extractedText).toContain("+3 p.e.");
  });

  it("includes the frågor att ställa section with every analysis-derived question", () => {
    expect(extractedText).toContain("Frågor att ställa");
    const analysFragor = sampleAnalysis.fragor.filter((f) => f.ursprung === "analys");
    expect(analysFragor.length).toBeGreaterThan(0);
    for (const fraga of analysFragor) {
      // Long question text can wrap and be re-joined with different
      // whitespace by pdf.js's text extraction — compare the words present,
      // not the exact runs of whitespace, so the assertion is robust to
      // how a particular line happened to wrap.
      const orden = fraga.fraga.split(/\s+/).filter((w) => w.length > 3);
      const sample = orden.slice(0, 6);
      for (const ord of sample) {
        expect(extractedText).toContain(ord);
      }
    }
  });

  it("includes all röda flaggor from the sample analysis, not just the top two", () => {
    for (const flagga of sampleAnalysis.rodaFlaggor) {
      expect(extractedText).toContain(flagga.titel);
    }
  });

  it("labels the model-based extern värdering as an estimate, not a fact", () => {
    expect(extractedText).toContain("estimat");
  });

  it("includes page references for cited figures", () => {
    expect(extractedText).toContain("s. 9");
  });

  it("includes the Övrig info section with counts, fee inclusion and väsentliga händelser", () => {
    expect(extractedText).toContain("Övrig info från årsredovisningen");
    expect(extractedText).toContain("Antal medlemmar");
    expect(extractedText).toContain("72 st");
    expect(extractedText).toContain("Antal lokaler");
    expect(extractedText).toContain("Vad ingår i avgiften");
    expect(extractedText).toContain("Individuell mätning");
    expect(extractedText).toContain("Väsentliga händelser");
    expect(extractedText).toContain(sampleAnalysis.forening.vasentligaHandelser?.[0]?.text ?? "");
  });

  it("does not break fi/fl ligatures in the extracted text layer", () => {
    // Regression test: fontkit substitutes a single "fi"/"fl" ligature glyph
    // for those letter pairs, and @react-pdf/render's generated ToUnicode
    // CMap entry for that glyph — while technically spec-compliant — is not
    // parsed correctly by several real-world readers, which then drop or
    // truncate it (observed as "fnansieras", "Röda faggor", "fnns"). Fixed
    // by disabling the 'liga' OpenType feature (see styles.page in
    // AnalysPdfDocument.tsx). These exact substrings — not just a "contains
    // some words" check — are the point: they only appear if the fi/fl pair
    // survived as two separate, correctly-mapped characters.
    expect(extractedText).toContain("finansiell");
    expect(extractedText).toContain("Röda flaggor");
    expect(extractedText).toContain("finns");
    expect(extractedText).toContain("finansieras");
  });
});

describe("AnalysPdfDocument — anonymised analysis (adress/postnummer/orgnr cleared after 12 months)", () => {
  let extractedText: string;

  beforeAll(async () => {
    registerPdfFonts(await loadTestFontSources());
    const anonymAnalys = {
      ...sampleAnalysis,
      input: { ...sampleAnalysis.input, adress: "", postnummer: "", orgnr: "" },
    };
    const pdfBuffer = await renderToBuffer(<AnalysPdfDocument analys={anonymAnalys} />);

    const doc = await getDocumentProxy(new Uint8Array(pdfBuffer));
    const { text } = await extractText(doc, { mergePages: true });
    extractedText = text;

    // Saved for the supervisor to open and visually inspect (see task brief).
    const scratchpadDir =
      "/private/tmp/claude-501/-Users-gustavslanesens-Documents-GitHub-BINFO/228dca42-5f10-4020-b3c2-dcc28698a4b6/scratchpad/pdf-export";
    await mkdir(scratchpadDir, { recursive: true });
    await writeFile(path.join(scratchpadDir, "exempel-anonym.pdf"), pdfBuffer);
  }, 30_000);

  it("shows the same anonymisation notice as PropertySummary, never a dangling ', Stockholm'", () => {
    // The cell can wrap this fallback text onto two lines (it's long), so
    // check the two halves and the absence of the dangling-comma form
    // separately rather than one exact joined substring.
    //
    // Checks for the REAL address immediately followed by ", <ort>" —
    // not a blanket "does the substring ', Stockholm' appear anywhere in the
    // whole document" check. The latter used to hold incidentally (nothing
    // else on the page mentioned Stockholm with a leading comma), but task
    // 4g/5's Binfo-värderingsmodell content legitimately says things like
    // "OpenStreetMap-bidragsgivare (ODbL), Stockholms stad" — a real,
    // intentional mention unrelated to the address anonymisation this test
    // guards. sampleAnalysis.prisanalys is static sample data, not
    // recomputed from the anonymised input, so that text is present in both
    // the real and the anonymised render here — correctly so.
    expect(extractedText).toContain("Adressen raderad efter 12 månader");
    expect(extractedText).toContain(sampleAnalysis.input.ort);
    const dangling = `${sampleAnalysis.input.adress}, ${sampleAnalysis.input.ort}`;
    expect(extractedText).not.toContain(dangling);
  });
});

describe("AnalysPdfDocument — utanför Stockholms län", () => {
  it("shows the disclaimer before the estimate", async () => {
    registerPdfFonts(await loadTestFontSources());
    const u = sampleAnalysis.prisanalys.varderingsunderlag;
    if (!u) throw new Error("sample has no varderingsunderlag");
    const analys = {
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
    };
    const buf = await renderToBuffer(<AnalysPdfDocument analys={analys} />);
    const doc = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(doc, { mergePages: true });
    const flat = text.replace(/\s+/g, " ");
    const iDisclaimer = flat.indexOf("Utanför Binfos täckningsområde");
    expect(iDisclaimer).toBeGreaterThan(-1);
    expect(iDisclaimer).toBeLessThan(
      flat.indexOf("Utgångspris", flat.indexOf("Är priset rimligt")),
    );
  }, 30_000);
});

describe("AnalysPdfDocument — v2: osäker, skannad och andel av föreningens lån", () => {
  it("prints the osäker reason, the scanned-report notice and the debt line as visible text", async () => {
    registerPdfFonts(await loadTestFontSources());
    const analys = {
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
    };
    const buf = await renderToBuffer(<AnalysPdfDocument analys={analys} />);
    const doc = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(doc, { mergePages: true });
    const flat = text.replace(/\s+/g, " ");
    expect(flat).toContain("Osäker: Skuldsättningen verkar vara i tusental.");
    expect(flat).toContain("Årsredovisningen var skannad");
    expect(flat).toContain("Lägenhetens ungefärliga andel av föreningens lån");
    expect(flat).toContain("Ingår inte i värderingen");
  }, 30_000);
});
