import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { ExtractionResult, KeyFigure, KeyFigureId } from "@/types/analysis";
import { estimateCostSek, KostnadsgransOverskriden, SONNET_5_PRISSATTNING } from "./costGuard";
import {
  ScannedPdfError,
  runExtraction,
  runGrounding,
  runStructuredExtraction,
  stripMarkdownFence,
  toBase64,
  type AnthropicClientLike,
} from "./runExtraction";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFile(path.join(here, "__fixtures__", name));

type CountTokens = AnthropicClientLike["messages"]["countTokens"];
type Create = AnthropicClientLike["messages"]["create"];

/** A fake Anthropic client with vi.fn() spies for both methods this module
 *  calls, so tests can assert on exactly what was (or wasn't) sent. */
function fakeClient(): AnthropicClientLike & {
  messages: {
    countTokens: ReturnType<typeof vi.fn<CountTokens>>;
    create: ReturnType<typeof vi.fn<Create>>;
  };
} {
  return {
    messages: {
      countTokens: vi.fn<CountTokens>(),
      create: vi.fn<Create>(),
    },
  };
}

const ALLA_NYCKELTAL_ID: KeyFigureId[] = [
  "arsavgift_per_m2_brf_yta",
  "arsavgift_andel_av_rorelseintakter",
  "skuldsattning_per_m2_totalyta",
  "skuldsattning_per_m2_brf_yta",
  "sparande_per_m2_totalyta",
  "rantekanslighet",
  "energikostnad_per_m2_totalyta",
];

/** What pass 1 actually emits: every value unknown, status always "okant" —
 *  berikaNyckeltal (applied afterwards, inside runStructuredExtraction) is
 *  what turns this into a graded result. */
function raaNyckeltal(): KeyFigure[] {
  return ALLA_NYCKELTAL_ID.map((id) => ({
    id,
    label: id,
    figure: { value: null, unit: "kr/m2", source: "berakning" },
    status: "okant",
    forklaring: "Testförklaring.",
  }));
}

const validExtractionResult: ExtractionResult = {
  schemaVersion: "1.0.0",
  forening: {
    namn: "Brf Testgården",
    orgnr: "769612-3456",
    akta: "ja",
    rakenskapsar: 2025,
    keyFigures: raaNyckeltal(),
  },
  datakvalitet: {
    pdfSaknarTextlager: false,
    extraktionKonfidens: { niva: "hog" },
    saknadeFalt: [],
  },
};

/** A minimally valid citation-bearing grounding response. */
function groundingApiResponse() {
  return {
    usage: { input_tokens: 500, output_tokens: 200 },
    content: [
      {
        type: "text",
        text: "Föreningen heter Brf Testgården.",
        citations: [{ type: "page_location", cited_text: "Brf Testgården", start_page_number: 3 }],
      },
    ],
  };
}

describe("toBase64", () => {
  // Buffer är Node-only och finns inte i Cloudflare Workers, dit appen
  // byggs. Kodningen måste därför göras med webbstandard (btoa) — men den
  // måste ge exakt samma resultat som Buffer gjorde, annars skickas en
  // trasig PDF till API:et. Buffer används här enbart som facit i testet.
  it("ger samma resultat som Buffer för en enkel byte-sekvens", () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("ger samma resultat som Buffer för godtyckliga bytes", () => {
    const bytes = new Uint8Array(1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) % 256;
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("hanterar tom indata", () => {
    expect(toBase64(new Uint8Array(0))).toBe("");
  });

  it.each([1, 2, 3, 4, 5])("hanterar längd %i (base64-padding)", (n) => {
    const bytes = new Uint8Array(n).fill(200);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  // En årsredovisning i korpusen är 11,4 MB. En naiv
  // String.fromCharCode(...bytes) spräcker anropsstacken långt innan dess,
  // så chunkningen måste bevisas på en realistisk storlek.
  it("klarar en 12 MB-buffert utan att spräcka anropsstacken", () => {
    const bytes = new Uint8Array(12 * 1024 * 1024);
    for (let i = 0; i < bytes.length; i += 997) bytes[i] = i % 256;
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });
});

describe("stripMarkdownFence", () => {
  it("lämnar text utan kodstaket orörd", () => {
    expect(stripMarkdownFence('{"a":1}')).toBe('{"a":1}');
  });

  it("tar bort ett komplett ```json ... ``` kodstaket", () => {
    const input = '```json\n{"a":1}\n```';
    expect(stripMarkdownFence(input)).toBe('{"a":1}');
  });

  it("tar bort ett komplett bart ``` kodstaket (utan 'json')", () => {
    const input = '```\n{"a":1}\n```';
    expect(stripMarkdownFence(input)).toBe('{"a":1}');
  });

  it("tar bort ett inledande kodstaket även utan avslutande — en avbruten (max_tokens) respons har annars ingen avslutande ``` alls", () => {
    const input = '```json\n{"a": 1, "b": "ofull';
    expect(stripMarkdownFence(input)).toBe('{"a": 1, "b": "ofull');
  });

  it("hanterar whitespace kring kodstaketen", () => {
    const input = '  ```json\n{"a":1}\n```  ';
    expect(stripMarkdownFence(input)).toBe('{"a":1}');
  });
});

describe("runGrounding", () => {
  it("kastar ScannedPdfError för en PDF utan textlager — innan någon klient byggs eller något anrop görs", async () => {
    const data = new Uint8Array(await fixture("utan-text.pdf"));
    const client = fakeClient();

    await expect(runGrounding(data, { maxCostSek: 5, client })).rejects.toThrow(ScannedPdfError);

    expect(client.messages.countTokens).not.toHaveBeenCalled();
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("returnerar icke-tom groundingText och spentSek > 0 för en PDF med textlager", async () => {
    const data = new Uint8Array(await fixture("med-text.pdf"));
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 500 });
    client.messages.create.mockResolvedValue(groundingApiResponse());

    const result = await runGrounding(data, { maxCostSek: 5, client });

    expect(result.groundingText.length).toBeGreaterThan(0);
    expect(result.groundingText).toContain("Sida 3");
    expect(result.spentSek).toBeGreaterThan(0);
    expect(result.pdfSaknarTextlager).toBe(false);
  });
});

describe("runStructuredExtraction", () => {
  it("skickar aldrig ett 'document'-innehållsblock till modellen — anropet är rent textbaserat", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 300 });
    client.messages.create.mockResolvedValue({
      usage: { input_tokens: 300, output_tokens: 100 },
      content: [{ type: "text", text: JSON.stringify(validExtractionResult) }],
    });

    await runStructuredExtraction("Fynd: Brf Testgården, sida 3.", { maxCostSek: 5, client });

    expect(client.messages.create).toHaveBeenCalledTimes(1);
    const params = client.messages.create.mock.calls[0]?.[0] as {
      messages: Array<{ content: unknown }>;
    };
    // ModelCaller always sends a plain string as content — never an array,
    // so a { type: "document" } block (or any other content block) simply
    // cannot occur here. Assert the shape rather than searching for the
    // absence of one string, which a Swedish prompt would never contain
    // anyway.
    expect(typeof params.messages[0]?.content).toBe("string");
    expect(JSON.stringify(params)).not.toContain('"type":"document"');
  });

  it("skriver alltid över datakvalitet.pdfSaknarTextlager med det redan kända värdet, oavsett modellens svar", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 300 });
    const modellsSvar = {
      ...validExtractionResult,
      datakvalitet: { ...validExtractionResult.datakvalitet, pdfSaknarTextlager: true },
    };
    client.messages.create.mockResolvedValue({
      usage: { input_tokens: 300, output_tokens: 100 },
      content: [{ type: "text", text: JSON.stringify(modellsSvar) }],
    });

    const { extraction } = await runStructuredExtraction("Fynd.", {
      maxCostSek: 5,
      client,
      pdfSaknarTextlager: false,
    });

    expect(extraction.datakvalitet.pdfSaknarTextlager).toBe(false);
  });
});

describe("runExtraction (komposition av runGrounding + runStructuredExtraction)", () => {
  it("producerar samma resultat som den tidigare, ihopslagna implementationen för en given svarssekvens", async () => {
    const data = new Uint8Array(await fixture("med-text.pdf"));
    const client = fakeClient();

    client.messages.countTokens
      .mockResolvedValueOnce({ input_tokens: 500 }) // grounding pre-flight
      .mockResolvedValueOnce({ input_tokens: 300 }); // extraction pre-flight

    client.messages.create.mockResolvedValueOnce(groundingApiResponse()).mockResolvedValueOnce({
      usage: { input_tokens: 300, output_tokens: 100 },
      content: [{ type: "text", text: JSON.stringify(validExtractionResult) }],
    });

    const result = await runExtraction(data, { maxCostSek: 5, client });

    const groundingSpend = estimateCostSek(500, 200, SONNET_5_PRISSATTNING);
    const extractionSpend = estimateCostSek(300, 100, SONNET_5_PRISSATTNING);

    // Exactly what the pre-split code did in one function: parse call 2's
    // JSON, force pdfSaknarTextlager to the value already known from step 0,
    // then apply berikaNyckeltal once on top — never twice, never skipped.
    expect(result.extraction).toEqual({
      ...validExtractionResult,
      datakvalitet: { ...validExtractionResult.datakvalitet, pdfSaknarTextlager: false },
      forening: {
        ...validExtractionResult.forening,
        keyFigures: raaNyckeltal().map((kf) => ({ ...kf })), // status stays "okant": every value is null
      },
    });
    expect(result.spentSek).toBeCloseTo(groundingSpend + extractionSpend, 10);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });

  it("kostnadströskeln för anrop 2 tar hänsyn till vad anrop 1 redan spenderat — precis som i den ihopslagna koden före uppdelningen", async () => {
    const data = new Uint8Array(await fixture("med-text.pdf"));
    const client = fakeClient();

    const pricing = SONNET_5_PRISSATTNING;
    const maxOutputTokensExtraction = 50;
    const extractionInputTokens = 200_000;
    // The worst-case (pre-flight) estimate call 2 will be checked against.
    const extractionCost = estimateCostSek(
      extractionInputTokens,
      maxOutputTokensExtraction,
      pricing,
    );

    // Call 1's actual usage — deliberately expensive, so most of the budget
    // is gone by the time call 2 runs.
    const groundingUsage = { input_tokens: 100, output_tokens: 9000 };
    const spentGrounding = estimateCostSek(
      groundingUsage.input_tokens,
      groundingUsage.output_tokens,
      pricing,
    );

    // Chosen so that:
    //   - the FULL budget alone covers extractionCost (a "reset per call"
    //     implementation would NOT throw here — the bug this test guards against), but
    //   - the REMAINING budget after call 1's actual spend does not (the
    //     correct, cumulative behaviour DOES throw).
    const maxCostSek = extractionCost + spentGrounding / 2;

    client.messages.countTokens
      .mockResolvedValueOnce({ input_tokens: groundingUsage.input_tokens }) // grounding pre-flight
      .mockResolvedValueOnce({ input_tokens: extractionInputTokens }); // extraction pre-flight

    client.messages.create.mockResolvedValueOnce({
      usage: groundingUsage,
      content: [{ type: "text", text: "Inga fynd." }],
    });
    // Call 2's messages.create should never be reached — enforceCostLimit
    // throws before it, both pre- and post-split.

    await expect(
      runExtraction(data, { maxCostSek, maxOutputTokensExtraction, client }),
    ).rejects.toThrow(KostnadsgransOverskriden);

    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });
});
