import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { ExtractionResult, KeyFigure, KeyFigureId } from "@/types/analysis";
import { estimateCostSek, KostnadsgransOverskriden, SONNET_5_PRISSATTNING } from "./costGuard";
import { ModelTruncatedError } from "./extract";
import { errorHasKnownSpend } from "./callMetrics";
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

  it("kastar ModelTruncatedError när svaret klipptes av (stop_reason max_tokens) — inte en tyst, ofullständig groundingText", async () => {
    const data = new Uint8Array(await fixture("med-text.pdf"));
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 500 });
    client.messages.create.mockResolvedValue({
      ...groundingApiResponse(),
      stop_reason: "max_tokens",
    });

    await expect(runGrounding(data, { maxCostSek: 5, client })).rejects.toThrow(
      ModelTruncatedError,
    );
  });

  it("returnerar exakt ett call-metrics-objekt med modell, tokens och latens", async () => {
    const data = new Uint8Array(await fixture("med-text.pdf"));
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 500 });
    client.messages.create.mockResolvedValue(groundingApiResponse());

    const result = await runGrounding(data, { maxCostSek: 5, client, model: "claude-sonnet-5" });

    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]).toMatchObject({
      stage: "grundning",
      model: "claude-sonnet-5",
      inputTokens: 500,
      outputTokens: 200,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      stopReason: null,
    });
    expect(result.calls[0]?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("annoterar ModelTruncatedError med den redan uppmätta kostnaden och anropet — inte 0 kr", async () => {
    const data = new Uint8Array(await fixture("med-text.pdf"));
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 500 });
    client.messages.create.mockResolvedValue({
      ...groundingApiResponse(),
      stop_reason: "max_tokens",
    });

    try {
      await runGrounding(data, { maxCostSek: 5, client });
      expect.fail("skulle ha kastat");
    } catch (error) {
      expect(errorHasKnownSpend(error)).toBe(true);
      if (errorHasKnownSpend(error)) {
        expect(error.spentSek).toBeGreaterThan(0);
        expect(error.calls).toHaveLength(1);
      }
    }
  });

  it("skickar output_config.effort vidare när angiven, annars inget output_config alls", async () => {
    const data = new Uint8Array(await fixture("med-text.pdf"));
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 500 });
    client.messages.create.mockResolvedValue(groundingApiResponse());

    await runGrounding(data, { maxCostSek: 5, client, effort: "low" });
    const params = client.messages.create.mock.calls[0]?.[0] as { output_config?: unknown };
    expect(params.output_config).toEqual({ effort: "low" });

    client.messages.create.mockClear();
    await runGrounding(data, { maxCostSek: 5, client });
    const paramsUtanEffort = client.messages.create.mock.calls[0]?.[0] as {
      output_config?: unknown;
    };
    expect(paramsUtanEffort.output_config).toBeUndefined();
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

  it("kastar ModelTruncatedError när svaret klipptes av (stop_reason max_tokens) i stället för att gå via en meningslös retry", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 300 });
    client.messages.create.mockResolvedValue({
      usage: { input_tokens: 300, output_tokens: 16000 },
      content: [{ type: "text", text: '{"schemaVersion": "1.0.0"' }],
      stop_reason: "max_tokens",
    });

    await expect(
      runStructuredExtraction("Fynd: Brf Testgården, sida 3.", { maxCostSek: 5, client }),
    ).rejects.toThrow(ModelTruncatedError);
    // Ingen retry — ett avklippt svar från samma prompt och samma tak skulle
    // med största sannolikhet klippas av likadant igen.
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it("annoterar en trunkering med den faktiska kostnaden (reviewer finding: 0 kr var fel)", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 300 });
    client.messages.create.mockResolvedValue({
      usage: { input_tokens: 300, output_tokens: 16000 },
      content: [{ type: "text", text: '{"schemaVersion": "1.0.0"' }],
      stop_reason: "max_tokens",
    });

    try {
      await runStructuredExtraction("Fynd.", { maxCostSek: 5, client });
      expect.fail("skulle ha kastat");
    } catch (error) {
      expect(errorHasKnownSpend(error)).toBe(true);
      if (errorHasKnownSpend(error)) {
        expect(error.spentSek).toBeGreaterThan(0);
        expect(error.calls).toHaveLength(1);
      }
    }
  });

  it("annoterar ett valideringsfel efter uttömd retry med kostnaden av BÅDA anropen", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 300 });
    client.messages.create.mockResolvedValue({
      usage: { input_tokens: 300, output_tokens: 100 },
      content: [{ type: "text", text: '{"helt": "fel form"}' }],
    });

    try {
      await runStructuredExtraction("Fynd.", { maxCostSek: 5, client });
      expect.fail("skulle ha kastat");
    } catch (error) {
      expect(client.messages.create).toHaveBeenCalledTimes(2);
      expect(errorHasKnownSpend(error)).toBe(true);
      if (errorHasKnownSpend(error)) {
        expect(error.calls).toHaveLength(2);
        expect(error.spentSek).toBeCloseTo(
          estimateCostSek(300, 100, SONNET_5_PRISSATTNING) * 2,
          10,
        );
      }
    }
  });

  it("returnerar ett call-metrics-objekt per faktiskt anrop", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 300 });
    client.messages.create.mockResolvedValue({
      usage: { input_tokens: 300, output_tokens: 100 },
      content: [{ type: "text", text: JSON.stringify(validExtractionResult) }],
    });

    const result = await runStructuredExtraction("Fynd.", { maxCostSek: 5, client });

    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]).toMatchObject({
      stage: "extraktion",
      inputTokens: 300,
      outputTokens: 100,
    });
  });

  it("tolkar tryckt-fältet deterministiskt och låter det vinna över modellens egen value (Volontären-fallet: 'neg')", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 300 });
    const modellsSvar: ExtractionResult = {
      ...validExtractionResult,
      forening: {
        ...validExtractionResult.forening,
        keyFigures: raaNyckeltal().map((kf) =>
          kf.id === "sparande_per_m2_totalyta"
            ? {
                ...kf,
                figure: {
                  ...kf.figure,
                  value: -50, // modellens egen (felaktiga) gissning
                  tryckt: "neg",
                  source: "arsredovisning" as const,
                  ref: { page: 4, excerpt: "Sparande per kvm, kr neg neg neg" },
                },
              }
            : kf,
        ),
      },
    };
    client.messages.create.mockResolvedValue({
      usage: { input_tokens: 300, output_tokens: 100 },
      content: [{ type: "text", text: JSON.stringify(modellsSvar) }],
    });

    const { extraction } = await runStructuredExtraction("Fynd.", { maxCostSek: 5, client });

    const sparande = extraction.forening.keyFigures.find(
      (kf) => kf.id === "sparande_per_m2_totalyta",
    );
    expect(sparande?.figure.value).toBeNull();
    expect(sparande?.figure.tecken).toBe("negativ");
    expect(sparande?.status).toBe("svag"); // gradering via tecken, Q1-beslutet
    expect(extraction.datakvalitet.extraktionKonfidens.skal).toBeDefined();
    expect(extraction.datakvalitet.extraktionKonfidens.skal!.join(" ")).toContain("neg");
  });

  it("noterar en implausibel negativ läsning på ett 'lägre är bättre'-nyckeltal i datakvalitet, graderar 'okant' i stället för 'god'", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 300 });
    const modellsSvar: ExtractionResult = {
      ...validExtractionResult,
      forening: {
        ...validExtractionResult.forening,
        keyFigures: raaNyckeltal().map((kf) =>
          kf.id === "rantekanslighet"
            ? {
                ...kf,
                figure: {
                  ...kf.figure,
                  value: -5,
                  source: "arsredovisning" as const,
                  ref: { page: 8, excerpt: "Räntekänslighet -5 %" },
                },
              }
            : kf,
        ),
      },
    };
    client.messages.create.mockResolvedValue({
      usage: { input_tokens: 300, output_tokens: 100 },
      content: [{ type: "text", text: JSON.stringify(modellsSvar) }],
    });

    const { extraction } = await runStructuredExtraction("Fynd.", { maxCostSek: 5, client });

    const rantekanslighet = extraction.forening.keyFigures.find(
      (kf) => kf.id === "rantekanslighet",
    );
    expect(rantekanslighet?.status).toBe("okant");
    expect(extraction.datakvalitet.extraktionKonfidens.skal!.join(" ")).toContain(
      "rantekanslighet",
    );
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
