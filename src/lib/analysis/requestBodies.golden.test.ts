import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { runAnalys } from "./analyze";
import { extraktion } from "./__fixtures__/extraktion";
import { identifieraMedModell } from "./identitetModell";
import {
  runGrounding,
  runGroundingFranTranskription,
  runStructuredExtraction,
  type AnthropicClientLike,
  type PromptCacheMode,
} from "./runExtraction";
import { transkribera } from "./transkribering";

/**
 * GOLDEN request bodies (docs/PLAN-v3.md §3.2). The exact parameters every
 * pipeline stage sends to `messages.create` and `messages.countTokens` are
 * captured through a recording fake client and compared byte for byte with the
 * files in `__golden__/`. Captured BEFORE the build/parse split (forfragan.ts),
 * so a green run afterwards proves the refactor changed no request.
 *
 * Intended changes (a prompt edit, a new parameter) update the files with
 * `vitest run -u` and show up as a reviewable diff. Document payloads are
 * summarised: a fixture PDF by length + sha256, a PDF that pdf-lib re-creates
 * on every call (identity pages 1-3, transcription chunks; their bytes carry
 * the current time) by its page count.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = (name: string) => path.join(here, "__golden__", `${name}.json`);

type CountTokens = AnthropicClientLike["messages"]["countTokens"];
type Create = AnthropicClientLike["messages"]["create"];

function fakeClient() {
  return {
    messages: {
      countTokens: vi.fn<CountTokens>(),
      create: vi.fn<Create>(),
    },
  };
}

type Fake = ReturnType<typeof fakeClient>;

async function sammanfatta(varde: unknown, genererad: boolean): Promise<unknown> {
  if (Array.isArray(varde)) return Promise.all(varde.map((v) => sammanfatta(v, genererad)));
  if (varde === null || typeof varde !== "object") return varde;
  const obj = varde as Record<string, unknown>;
  const source = obj["source"] as { type?: string; data?: string; media_type?: string } | undefined;
  if (obj["type"] === "document" && source?.type === "base64" && typeof source.data === "string") {
    const bytes = Buffer.from(source.data, "base64");
    const { data: _data, ...restSource } = source;
    return {
      ...obj,
      source: {
        ...restSource,
        ...(genererad
          ? { sidor: (await PDFDocument.load(bytes)).getPageCount() }
          : {
              bytes: bytes.length,
              sha256: createHash("sha256").update(source.data).digest("hex"),
            }),
      },
    };
  }
  const ut: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) ut[k] = await sammanfatta(v, genererad);
  return ut;
}

async function fangaAnrop(c: Fake, genererad = false) {
  return sammanfatta(
    {
      countTokens: c.messages.countTokens.mock.calls.map(([params]) => params),
      create: c.messages.create.mock.calls.map(([params, options]) => ({
        params,
        harSignal: options?.signal !== undefined,
      })),
    },
    genererad,
  );
}

async function sparaGolden(namn: string, innehall: unknown): Promise<void> {
  await expect(JSON.stringify(innehall, null, 2) + "\n").toMatchFileSnapshot(golden(namn));
}

const USAGE = { input_tokens: 1000, output_tokens: 100 };

async function textPdf(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(here, "__fixtures__", "med-text.pdf")));
}

async function pdfMedSidor(antal: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < antal; i++) doc.addPage([200, 200]).drawText(`sida ${i + 1}`);
  return doc.save();
}

function klient(): Fake {
  const c = fakeClient();
  c.messages.countTokens.mockResolvedValue({ input_tokens: 1000 });
  return c;
}

describe("golden: request bodies of every pipeline stage", () => {
  it("identitet (Haiku, pages 1-3)", async () => {
    const c = klient();
    c.messages.create.mockResolvedValueOnce({
      usage: USAGE,
      content: [
        {
          type: "text",
          text: '{"orgnr":"769616-0253","rakenskapsar":2025,"namn":"Brf Granen 10-11"}',
        },
      ],
      stop_reason: "end_turn",
    });
    await identifieraMedModell(await pdfMedSidor(5), { maxCostSek: 1, client: c });
    await sparaGolden("identitet", await fangaAnrop(c, true));
  });

  it("transkribering (one 5-page chunk and one 2-page chunk)", async () => {
    const c = klient();
    c.messages.create.mockImplementation(async (params) => {
      const text = JSON.stringify(params).includes("första sidan har originalnummer 6")
        ? "=== SIDA 6 ===\nA\n=== SIDA 7 ===\nB"
        : "=== SIDA 1 ===\nA\n=== SIDA 2 ===\nB\n=== SIDA 3 ===\nC\n=== SIDA 4 ===\nD\n=== SIDA 5 ===\nE";
      return { usage: USAGE, content: [{ type: "text", text }], stop_reason: "end_turn" };
    });
    await transkribera(await pdfMedSidor(7), { maxCostSek: 10, client: c, effort: "medium" });
    const f = (await fangaAnrop(c, true)) as {
      countTokens: unknown[];
      create: unknown[];
    };
    // The two chunks run in parallel: sort for a stable order.
    const sortera = (a: unknown[]) =>
      [...a].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
    await sparaGolden("transkribering", {
      countTokens: sortera(f.countTokens),
      create: sortera(f.create),
    });
  });

  it("grundning på PDF (citations over the native document)", async () => {
    const c = klient();
    c.messages.create.mockResolvedValueOnce({
      usage: USAGE,
      content: [
        {
          type: "text",
          text: "Föreningen heter Brf Testgården.",
          citations: [
            { type: "page_location", cited_text: "Brf Testgården", start_page_number: 3 },
          ],
        },
      ],
      stop_reason: "end_turn",
    });
    await runGrounding(await textPdf(), { maxCostSek: 5, client: c, effort: "medium" });
    await sparaGolden("grundning-pdf", await fangaAnrop(c));
  });

  it("grundning på transkription (custom-content document)", async () => {
    const c = klient();
    c.messages.create.mockResolvedValueOnce({
      usage: USAGE,
      content: [
        {
          type: "text",
          text: "Föreningen heter Brf Testgården.",
          citations: [
            {
              type: "content_block_location",
              cited_text: "Brf Testgården",
              document_index: 0,
              start_block_index: 0,
              end_block_index: 1,
            },
          ],
        },
      ],
      stop_reason: "end_turn",
    });
    await runGroundingFranTranskription(
      [
        { sida: 1, text: "Brf Testgården\nOrg.nr 769616-0253\n\nFörvaltningsberättelse" },
        { sida: 2, text: "Nyckeltal | 2025 | 2024\nÅrsavgift kr/kvm | 670 | 640" },
      ],
      { maxCostSek: 5, client: c, effort: "medium" },
    );
    await sparaGolden("grundning-transkription", await fangaAnrop(c));
  });

  it.each<[string, PromptCacheMode]>([
    ["off", false],
    ["on", true],
    ["system", "system"],
  ])("extraktion, prompt cache %s", async (namn, promptCache) => {
    const c = klient();
    c.messages.create.mockResolvedValueOnce({
      usage: USAGE,
      content: [{ type: "text", text: JSON.stringify(extraktion) }],
      stop_reason: "end_turn",
    });
    await runStructuredExtraction('1. Sida 3: "Brf Testgården"\n   Sammanhang: namn', {
      maxCostSek: 5,
      client: c,
      effort: "medium",
      promptCache,
    });
    await sparaGolden(`extraktion-cache-${namn}`, await fangaAnrop(c));
  });

  it.each<[string, PromptCacheMode]>([
    ["off", false],
    ["on", true],
  ])("bedömning, prompt cache %s", async (namn, promptCache) => {
    const c = klient();
    c.messages.create.mockResolvedValueOnce({
      usage: USAGE,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            betyg: "C",
            betygMotivering: "Motivering.",
            rodaFlaggor: [],
            fragor: [],
          }),
        },
      ],
      stop_reason: "end_turn",
    });
    await runAnalys(extraktion, { maxCostSek: 5, client: c, effort: "medium", promptCache });
    await sparaGolden(`bedomning-cache-${namn}`, await fangaAnrop(c));
  });

  it("bedömning + omskrivning av betygMotivering (betyget justerades: andra anropet, låg effort)", async () => {
    // The fixture has one kritisk figure, so only C-E are allowed; "A" is clamped to "C".
    const c = klient();
    c.messages.create
      .mockResolvedValueOnce({
        usage: USAGE,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              betyg: "A",
              betygMotivering: "Föreningen är i mycket gott skick.",
              rodaFlaggor: [
                {
                  id: "omsattning",
                  titel: "Stor del av lånen omsätts 2026",
                  beskrivning: "31 000 000 kr förfaller 2026.",
                  severity: "hog",
                  harledsFran: ["rantekanslighet"],
                },
              ],
              fragor: [],
            }),
          },
        ],
        stop_reason: "end_turn",
      })
      .mockResolvedValueOnce({
        usage: USAGE,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              betygMotivering: "Betyget C beror på att 31 000 000 kr av lånen förfaller 2026.",
            }),
          },
        ],
        stop_reason: "end_turn",
      });
    const varna = vi.spyOn(console, "warn").mockImplementation(() => {});
    await runAnalys(extraktion, { maxCostSek: 5, client: c, effort: "medium" });
    varna.mockRestore();
    await sparaGolden("bedomning-motivering", await fangaAnrop(c));
  });
});
