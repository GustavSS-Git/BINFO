import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { ExtractionResult, KeyFigure, KeyFigureId } from "@/types/analysis";
import {
  estimateCostFromUsageSek,
  estimateCostSek,
  KostnadsgransOverskriden,
  SONNET_5_PRISSATTNING,
} from "./costGuard";
import {
  buildExtractionSystemPrompt,
  buildExtractionUserPrompt,
  buildGroundingSystemPrompt,
  formatGroundingForExtraction,
} from "./prompts";
import { ModelTruncatedError } from "./extract";
import { errorHasKnownSpend } from "./callMetrics";
import {
  ModelRefusedError,
  ScannedPdfError,
  SKANNAD_KONFIDENS_SKAL,
  TomTranskriptionError,
  runExtraction,
  runGrounding,
  runGroundingFranTranskription,
  escapeControlCharsInStrings,
  fyllIOkandaAvgiftsposter,
  parseModelJson,
  runStructuredExtraction,
  stripMarkdownFence,
  toBase64,
  utanSurplusavslut,
  type AnthropicClientLike,
  type PromptCacheMode,
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

describe("runGrounding — refusal", () => {
  it("kastar ModelRefusedError annoterat med kostnaden vid stop_reason refusal", async () => {
    const data = new Uint8Array(await fixture("med-text.pdf"));
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 500 });
    client.messages.create.mockResolvedValue({
      usage: { input_tokens: 500, output_tokens: 20 },
      content: [],
      stop_reason: "refusal",
    });
    try {
      await runGrounding(data, { maxCostSek: 5, client });
      expect.fail("skulle ha kastat");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelRefusedError);
      expect(errorHasKnownSpend(error)).toBe(true);
    }
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

    await runStructuredExtraction("Fynd: Brf Testgården, sida 3.", {
      maxCostSek: 5,
      client,
      promptCache: true,
    });

    expect(client.messages.create).toHaveBeenCalledTimes(1);
    const params = client.messages.create.mock.calls[0]?.[0] as {
      messages: Array<{ content: unknown }>;
    };
    // The user content is a single text block (never a document block): with
    // promptCache on it is [{type:"text", ...}], with it off a plain string.
    const content = params.messages[0]?.content;
    expect(Array.isArray(content)).toBe(true);
    expect((content as Array<{ type: string }>).map((b) => b.type)).toEqual(["text"]);
    expect(JSON.stringify(params)).not.toContain('"type":"document"');
  });

  describe("prompt caching (explicit breakpoints)", () => {
    type Req = {
      system: unknown;
      messages: Array<{ content: unknown }>;
    };

    async function kor(promptCache?: PromptCacheMode) {
      const client = fakeClient();
      client.messages.countTokens.mockResolvedValue({ input_tokens: 300 });
      client.messages.create.mockResolvedValue({
        usage: { input_tokens: 300, output_tokens: 100 },
        content: [{ type: "text", text: JSON.stringify(validExtractionResult) }],
      });
      await runStructuredExtraction("Fynd: Brf Testgården, sida 3.", {
        maxCostSek: 5,
        client,
        ...(promptCache === undefined ? {} : { promptCache }),
      });
      return {
        client,
        create: client.messages.create.mock.calls[0]?.[0] as Req,
        count: client.messages.countTokens.mock.calls[0]?.[0] as Req,
      };
    }

    it("lägger brytpunkten på det statiska systemblocket och på användarblocket — aldrig top-level", async () => {
      const { create } = await kor(true);
      expect(create.system).toEqual([
        { type: "text", text: buildExtractionSystemPrompt(), cache_control: { type: "ephemeral" } },
      ]);
      expect(create.messages[0]?.content).toEqual([
        {
          type: "text",
          text: buildExtractionUserPrompt("Fynd: Brf Testgården, sida 3."),
          cache_control: { type: "ephemeral" },
        },
      ]);
      // Automatisk (top-level) cachning får inte användas.
      expect(Object.keys(create)).not.toContain("cache_control");
    });

    it("systemblocket är byte-för-byte identiskt mellan två olika rapporter (annars träffar aldrig cachen)", async () => {
      const a = await kor(true);
      const client = fakeClient();
      client.messages.countTokens.mockResolvedValue({ input_tokens: 300 });
      client.messages.create.mockResolvedValue({
        usage: { input_tokens: 300, output_tokens: 100 },
        content: [{ type: "text", text: JSON.stringify(validExtractionResult) }],
      });
      await runStructuredExtraction("Helt andra fynd från en annan förening.", {
        maxCostSek: 5,
        client,
        promptCache: true,
      });
      const b = client.messages.create.mock.calls[0]?.[0] as Req;
      expect(JSON.stringify(b.system)).toBe(JSON.stringify(a.create.system));
      expect(JSON.stringify(b.messages)).not.toBe(JSON.stringify(a.create.messages));
    });

    it("countTokens får samma system/messages-form som create", async () => {
      const { create, count } = await kor(true);
      expect(count.system).toEqual(create.system);
      expect(count.messages).toEqual(create.messages);
    });

    it('promptCache:"system" cachar bara det statiska systemblocket', async () => {
      const { create } = await kor("system");
      expect(create.system).toEqual([
        { type: "text", text: buildExtractionSystemPrompt(), cache_control: { type: "ephemeral" } },
      ]);
      expect(typeof create.messages[0]?.content).toBe("string");
    });

    it("promptCache:false ger enbart vanliga strängar utan cache_control", async () => {
      const { create } = await kor(false);
      expect(typeof create.system).toBe("string");
      expect(typeof create.messages[0]?.content).toBe("string");
      expect(JSON.stringify(create)).not.toContain("cache_control");
    });

    it("valideringsretryn skickar exakt samma cachebara prefix en gång till", async () => {
      const client = fakeClient();
      client.messages.countTokens.mockResolvedValue({ input_tokens: 300 });
      client.messages.create
        .mockResolvedValueOnce({
          usage: { input_tokens: 10, output_tokens: 100, cache_creation_input_tokens: 2000 },
          content: [{ type: "text", text: '{"helt": "fel form"}' }],
        })
        .mockResolvedValueOnce({
          usage: { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 2000 },
          content: [{ type: "text", text: JSON.stringify(validExtractionResult) }],
        });
      const { calls } = await runStructuredExtraction("Fynd.", { maxCostSek: 5, client });
      const [första, andra] = client.messages.create.mock.calls.map((c) => c[0]);
      expect(JSON.stringify(andra)).toBe(JSON.stringify(första));
      expect(calls[0]?.cacheCreationInputTokens).toBe(2000);
      expect(calls[1]?.cacheReadInputTokens).toBe(2000);
      // Läsningen är billigare än skrivningen.
      expect(calls[1]!.costSek).toBeLessThan(calls[0]!.costSek);
    });

    it("grundningen cachas aldrig (systemprompten ligger under modellens minimum)", async () => {
      const data = new Uint8Array(await fixture("med-text.pdf"));
      const client = fakeClient();
      client.messages.countTokens.mockResolvedValue({ input_tokens: 500 });
      client.messages.create.mockResolvedValue(groundingApiResponse());
      await runGrounding(data, { maxCostSek: 5, client });
      expect(JSON.stringify(client.messages.create.mock.calls[0]?.[0])).not.toContain(
        "cache_control",
      );
    });
  });

  it("kostnaden räknas från verklig usage inklusive cachefält", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 300 });
    client.messages.create.mockResolvedValue({
      usage: {
        input_tokens: 100,
        output_tokens: 100,
        cache_creation_input_tokens: 1000,
        cache_read_input_tokens: 3000,
      },
      content: [{ type: "text", text: JSON.stringify(validExtractionResult) }],
    });
    const { spentSek } = await runStructuredExtraction("Fynd.", { maxCostSek: 5, client });
    expect(spentSek).toBeCloseTo(
      estimateCostFromUsageSek(
        {
          input_tokens: 100,
          output_tokens: 100,
          cache_creation_input_tokens: 1000,
          cache_read_input_tokens: 3000,
        },
        SONNET_5_PRISSATTNING,
      ),
      10,
    );
  });

  it("kastar ModelRefusedError vid stop_reason refusal, annoterat med kostnaden, utan retry", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 300 });
    client.messages.create.mockResolvedValue({
      usage: { input_tokens: 300, output_tokens: 20 },
      content: [],
      stop_reason: "refusal",
    });
    try {
      await runStructuredExtraction("Fynd.", { maxCostSek: 5, client });
      expect.fail("skulle ha kastat");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelRefusedError);
      expect((error as Error).message).toContain("refusal");
      expect(errorHasKnownSpend(error)).toBe(true);
      if (errorHasKnownSpend(error)) {
        expect(error.spentSek).toBeGreaterThan(0);
        expect(error.calls).toHaveLength(1);
      }
    }
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it("använder modellens egen prissättning och kastar för en okänd modell", async () => {
    const client = fakeClient();
    await expect(
      runStructuredExtraction("Fynd.", { maxCostSek: 5, client, model: "claude-okand-1" }),
    ).rejects.toThrow(/claude-okand-1/);
    expect(client.messages.create).not.toHaveBeenCalled();
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

  it("härleder räntekänslighet och båda skuldsättning/m² till 0 (graderat 'god') när totalSkuld är exakt 0 — en skuldfri förening (Göken-fallet)", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 300 });
    const skuldfriRef = {
      page: 7,
      excerpt: "Föreningen är skuldfri och ekonomin är fortsatt god.",
    };
    const modellsSvar: ExtractionResult = {
      ...validExtractionResult,
      forening: {
        ...validExtractionResult.forening,
        keyFigures: raaNyckeltal(),
        lanebok: {
          totalSkuld: { value: 0, unit: "kr", source: "arsredovisning", ref: skuldfriRef },
        },
      },
    };
    client.messages.create.mockResolvedValue({
      usage: { input_tokens: 300, output_tokens: 100 },
      content: [{ type: "text", text: JSON.stringify(modellsSvar) }],
    });

    const { extraction } = await runStructuredExtraction("Fynd.", { maxCostSek: 5, client });

    for (const id of [
      "rantekanslighet",
      "skuldsattning_per_m2_totalyta",
      "skuldsattning_per_m2_brf_yta",
    ] as const) {
      const kf = extraction.forening.keyFigures.find((k) => k.id === id);
      expect(kf?.figure.value).toBe(0);
      expect(kf?.figure.source).toBe("berakning");
      expect(kf?.figure.ref).toEqual(skuldfriRef);
      expect(kf?.status).toBe("god");
    }
    // Ett nyckeltal härledningen inte rör (t.ex. sparande) förblir null/okant.
    const sparande = extraction.forening.keyFigures.find(
      (kf) => kf.id === "sparande_per_m2_totalyta",
    );
    expect(sparande?.figure.value).toBeNull();
    expect(sparande?.status).toBe("okant");
  });

  it("stryker modellens inaktuella 'skuldnyckeltal saknas'-skäl när 0:orna härletts, och återställer konfidensen (Göken live 2026-09-28)", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 300 });
    const modellsSvar: ExtractionResult = {
      ...validExtractionResult,
      forening: {
        ...validExtractionResult.forening,
        keyFigures: raaNyckeltal(),
        lanebok: {
          totalSkuld: {
            value: 0,
            unit: "kr",
            source: "arsredovisning",
            ref: { page: 7, excerpt: "Föreningen är skuldfri och ekonomin är fortsatt god." },
          },
        },
      },
      datakvalitet: {
        ...validExtractionResult.datakvalitet,
        extraktionKonfidens: {
          niva: "medel",
          skal: [
            "Flera nyckeltal (skuldsättning, räntekänslighet) saknas i flerårsöversikten och anges som '-' i rapporten.",
          ],
        },
      },
    };
    client.messages.create.mockResolvedValue({
      usage: { input_tokens: 300, output_tokens: 100 },
      content: [{ type: "text", text: JSON.stringify(modellsSvar) }],
    });

    const { extraction } = await runStructuredExtraction("Fynd.", { maxCostSek: 5, client });

    expect(extraction.datakvalitet.extraktionKonfidens).toEqual({ niva: "hog" });
  });

  it("härleder INTE när totalSkuld saknas eller är skild från 0", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 300 });
    const modellsSvar: ExtractionResult = {
      ...validExtractionResult,
      forening: {
        ...validExtractionResult.forening,
        keyFigures: raaNyckeltal(),
        lanebok: {
          totalSkuld: {
            value: 43_200_000,
            unit: "kr",
            source: "arsredovisning",
            ref: { page: 12, excerpt: "Summa 43 200 000" },
          },
        },
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
    expect(rantekanslighet?.figure.value).toBeNull();
    expect(rantekanslighet?.status).toBe("okant");
  });

  it("härleder INTE över ett redan tryckt värde — en riktig siffra vinner alltid, oavsett totalSkuld", async () => {
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
                  value: 3.5,
                  unit: "procent" as const,
                  source: "arsredovisning" as const,
                  ref: { page: 8, excerpt: "Räntekänslighet 3,5 %" },
                },
              }
            : kf,
        ),
        lanebok: {
          totalSkuld: {
            value: 0,
            unit: "kr",
            source: "arsredovisning",
            ref: { page: 7, excerpt: "Skuldfri" },
          },
        },
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
    expect(rantekanslighet?.figure.value).toBe(3.5);
    expect(rantekanslighet?.figure.source).toBe("arsredovisning");
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
      datakvalitet: {
        ...validExtractionResult.datakvalitet,
        pdfSaknarTextlager: false,
        kalla: "textlager",
      },
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

// ---------------------------------------------------------------------------
// Scanned route: grounding over a transcription, kalla, osaker, sanity checks
// ---------------------------------------------------------------------------

describe("runGroundingFranTranskription", () => {
  const sidor = [
    {
      sida: 6,
      text: "Flerårsöversikt\n\nNyckeltal | 2025 | 2024\nÅrsavgift per kvm | 1 262 | 1 200",
    },
    { sida: 7, text: "" },
    { sida: 8, text: "Summa tillgångar | 300 622 392" },
  ];

  function citeratSvar(citations: unknown[]) {
    return {
      usage: { input_tokens: 700, output_tokens: 250 },
      content: [{ type: "text", text: "Årsavgiften är 1 262 kr/m².", citations }],
      stop_reason: "end_turn",
    };
  }

  it("skickar ETT custom-content-dokument med fina block och citat på, utan base64-PDF", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 700 });
    client.messages.create.mockResolvedValue(citeratSvar([]));

    await runGroundingFranTranskription(sidor, { maxCostSek: 5, client });

    const params = client.messages.create.mock.calls[0]?.[0] as {
      system: string;
      messages: Array<{ content: Array<Record<string, unknown>> }>;
    };
    const doc = params.messages[0]!.content[0] as {
      type: string;
      source: { type: string; content: Array<{ type: string; text: string }> };
      citations: { enabled: boolean };
      title: string;
    };
    expect(doc.type).toBe("document");
    expect(doc.source.type).toBe("content");
    expect(doc.citations).toEqual({ enabled: true });
    expect(doc.source.content.map((b) => b.text)).toEqual([
      "Flerårsöversikt",
      "Nyckeltal | 2025 | 2024",
      "Årsavgift per kvm | 1 262 | 1 200",
      "Summa tillgångar | 300 622 392",
    ]);
    expect(JSON.stringify(params)).not.toContain("base64");
    // Same grounding prompts as the native route.
    expect(params.system).toBe(buildGroundingSystemPrompt());
  });

  it("mappar content_block_location till originalsidan och formaterar som dagens 'Sida N: …'", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 700 });
    client.messages.create.mockResolvedValue(
      citeratSvar([
        {
          type: "content_block_location",
          cited_text: "Summa tillgångar | 300 622 392",
          document_index: 0,
          start_block_index: 3,
          end_block_index: 4,
        },
        // Out of range: must be dropped, never given a guessed page.
        {
          type: "content_block_location",
          cited_text: "x",
          start_block_index: 40,
          end_block_index: 41,
        },
      ]),
    );

    const r = await runGroundingFranTranskription(sidor, { maxCostSek: 5, client });

    expect(r.groundingText).toBe(
      formatGroundingForExtraction([
        { text: "Årsavgiften är 1 262 kr/m².", citat: "Summa tillgångar | 300 622 392", sida: 8 },
      ]),
    );
    expect(r.pdfSaknarTextlager).toBe(true);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.stage).toBe("grundning");
    expect(r.spentSek).toBeCloseTo(
      estimateCostFromUsageSek({ input_tokens: 700, output_tokens: 250 }, SONNET_5_PRISSATTNING),
      10,
    );
  });

  it("kastar TomTranskriptionError före något anrop när ingen sida har text", async () => {
    const client = fakeClient();
    await expect(
      runGroundingFranTranskription([{ sida: 1, text: "  " }], { maxCostSek: 5, client }),
    ).rejects.toBeInstanceOf(TomTranskriptionError);
    expect(client.messages.countTokens).not.toHaveBeenCalled();
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("kostnadsgränsen och trunkering/refusal fungerar som på den vanliga vägen", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 5_000_000 });
    await expect(
      runGroundingFranTranskription(sidor, { maxCostSek: 1, client }),
    ).rejects.toBeInstanceOf(KostnadsgransOverskriden);
    expect(client.messages.create).not.toHaveBeenCalled();

    client.messages.countTokens.mockResolvedValue({ input_tokens: 700 });
    client.messages.create.mockResolvedValueOnce({ ...citeratSvar([]), stop_reason: "max_tokens" });
    const trunc = await runGroundingFranTranskription(sidor, { maxCostSek: 5, client }).catch(
      (e: unknown) => e,
    );
    expect(trunc).toBeInstanceOf(ModelTruncatedError);
    expect(errorHasKnownSpend(trunc) && trunc.spentSek > 0).toBe(true);

    client.messages.create.mockResolvedValueOnce({ ...citeratSvar([]), stop_reason: "refusal" });
    await expect(
      runGroundingFranTranskription(sidor, { maxCostSek: 5, client }),
    ).rejects.toBeInstanceOf(ModelRefusedError);
  });
});

describe("runStructuredExtraction — kalla, osaker och rimlighetskontroll", () => {
  function klientMedSvar(svar: unknown) {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 300 });
    client.messages.create.mockResolvedValue({
      usage: { input_tokens: 300, output_tokens: 100 },
      content: [{ type: "text", text: JSON.stringify(svar) }],
    });
    return client;
  }

  it("sätter datakvalitet.kalla deterministiskt: 'textlager' som förval, oavsett vad modellen skrev", async () => {
    const modell = {
      ...validExtractionResult,
      datakvalitet: { ...validExtractionResult.datakvalitet, kalla: "skannad" },
    };
    const { extraction } = await runStructuredExtraction("Fynd.", {
      maxCostSek: 5,
      client: klientMedSvar(modell),
    });
    expect(extraction.datakvalitet.kalla).toBe("textlager");
    expect(extraction.datakvalitet.extraktionKonfidens.niva).toBe("hog");
  });

  it("kalla 'skannad': sätter kalla, tar hog → medel och lägger till skälet", async () => {
    const { extraction } = await runStructuredExtraction("Fynd.", {
      maxCostSek: 5,
      client: klientMedSvar(validExtractionResult),
      pdfSaknarTextlager: true,
      kalla: "skannad",
    });
    expect(extraction.datakvalitet.kalla).toBe("skannad");
    expect(extraction.datakvalitet.pdfSaknarTextlager).toBe(true);
    expect(extraction.datakvalitet.extraktionKonfidens).toEqual({
      niva: "medel",
      skal: [SKANNAD_KONFIDENS_SKAL],
    });
    expect(SKANNAD_KONFIDENS_SKAL).toBe(
      "Årsredovisningen saknade textlager; siffrorna är avlästa från sidbilder.",
    );
  });

  it("kalla 'skannad' höjer aldrig en redan låg konfidens, och dubblerar inte skälet", async () => {
    const modell = {
      ...validExtractionResult,
      datakvalitet: {
        ...validExtractionResult.datakvalitet,
        extraktionKonfidens: { niva: "lag", skal: ["många fynd saknas"] },
      },
    };
    const { extraction } = await runStructuredExtraction("Fynd.", {
      maxCostSek: 5,
      client: klientMedSvar(modell),
      kalla: "skannad",
    });
    expect(extraction.datakvalitet.extraktionKonfidens).toEqual({
      niva: "lag",
      skal: ["många fynd saknas", SKANNAD_KONFIDENS_SKAL],
    });
  });

  it("stryker osaker som modellen skrev på en figur — bara den deterministiska kontrollen får sätta den", async () => {
    const nyckeltal = raaNyckeltal();
    nyckeltal[0] = {
      ...nyckeltal[0]!,
      figure: {
        value: 670,
        unit: "kr/m2",
        source: "arsredovisning",
        ref: { page: 8, excerpt: "Årsavgift 670" },
        osaker: "modellen tycker att den är konstig",
      },
    };
    const modell = {
      ...validExtractionResult,
      forening: { ...validExtractionResult.forening, keyFigures: nyckeltal },
    };
    const { extraction } = await runStructuredExtraction("Fynd.", {
      maxCostSek: 5,
      client: klientMedSvar(modell),
    });
    expect(extraction.forening.keyFigures[0]!.figure.osaker).toBeUndefined();
    expect(extraction.forening.keyFigures[0]!.figure.value).toBe(670);
  });

  it("kör rimlighetskontrollen: tkr/kr-fel markeras osaker, konfidensen sänks en nivå och ett skäl läggs till", async () => {
    const nyckeltal = raaNyckeltal();
    nyckeltal[0] = {
      ...nyckeltal[0]!,
      figure: {
        value: 670_000, // tkr/kr slip: 670 kr/m² printed as 670 000
        unit: "kr/m2",
        source: "arsredovisning",
        ref: { page: 8, excerpt: "Årsavgift 670" },
      },
    };
    const modell = {
      ...validExtractionResult,
      forening: { ...validExtractionResult.forening, keyFigures: nyckeltal },
    };
    const { extraction } = await runStructuredExtraction("Fynd.", {
      maxCostSek: 5,
      client: klientMedSvar(modell),
    });
    const fig = extraction.forening.keyFigures[0]!.figure;
    expect(fig.osaker).toMatch(/rimliga intervallet/);
    expect(fig.value).toBe(670_000); // never changed or hidden
    expect(extraction.datakvalitet.extraktionKonfidens.niva).toBe("medel");
    expect(extraction.datakvalitet.extraktionKonfidens.skal?.join(" ")).toMatch(
      /rimliga intervallet/,
    );
  });

  it("använder kontrollsummorna: balansräkning som inte går ihop sänker konfidensen", async () => {
    const fig = (value: number) => ({
      value,
      unit: "kr",
      source: "arsredovisning",
      ref: { page: 10, excerpt: "Summa" },
    });
    const modell = {
      ...validExtractionResult,
      kontrollsummor: {
        summaTillgangar: fig(1_000_000),
        summaEgetKapitalOchSkulder: fig(1_100_000),
      },
    };
    const { extraction } = await runStructuredExtraction("Fynd.", {
      maxCostSek: 5,
      client: klientMedSvar(modell),
    });
    expect(extraction.kontrollsummor?.summaTillgangar?.osaker).toBeTruthy();
    expect(extraction.datakvalitet.extraktionKonfidens.niva).toBe("medel");
  });
});

describe("parseModelJson — rå radbrytning i en JSON-sträng", () => {
  it("escapar kontrolltecken inuti strängar, lämnar allt annat orört", () => {
    expect(escapeControlCharsInStrings('{"a":"x\ny\tz","b":1}')).toBe('{"a":"x\\ny\\tz","b":1}');
    // Redan escapade sekvenser och citattecken inuti strängen rörs inte.
    expect(escapeControlCharsInStrings('{"a":"x\\"y\\n"}')).toBe('{"a":"x\\"y\\n"}');
    // Blanksteg/radbrytningar UTANFÖR strängar (formatering) lämnas.
    expect(escapeControlCharsInStrings('{\n "a": 1\n}')).toBe('{\n "a": 1\n}');
  });

  it("tolkar ett svar där modellen kopierat ett flerradigt citat rakt in i en excerpt", () => {
    const text = '{"excerpt":"Rad ett\nRad två","value":3}';
    expect(parseModelJson([{ type: "text", text }])).toEqual({
      excerpt: "Rad ett\nRad två",
      value: 3,
    });
  });

  it("ogiltig JSON även efter reparation ger fortfarande råtexten (Zod avvisar den sedan)", () => {
    expect(parseModelJson([{ type: "text", text: '{"a": ' }])).toBe('{"a": ');
  });
});

describe("parseModelJson — en avslutande klammer för mycket", () => {
  it("klipper bort överskjutande } efter det första kompletta JSON-värdet (uppmätt: modellen skrev }}}}} i stället för }}}})", () => {
    const text = '{"a":{"b":{"c":1}}}}';
    expect(parseModelJson([{ type: "text", text }])).toEqual({ a: { b: { c: 1 } } });
  });

  it("räknar inte klamrar inuti strängar", () => {
    const text = '{"a":"} ] {","b":[1,2]}}';
    expect(parseModelJson([{ type: "text", text }])).toEqual({ a: "} ] {", b: [1, 2] });
  });

  it("tål både ett överskott och en rå radbrytning i samma svar", () => {
    const text = '{"a":"x\ny"}}';
    expect(parseModelJson([{ type: "text", text }])).toEqual({ a: "x\ny" });
  });

  it("klipper INTE bort riktig text efter JSON-värdet — svaret förblir ogiltigt", () => {
    const text = '{"a":1} och här är en förklaring';
    expect(parseModelJson([{ type: "text", text }])).toBe(text);
    expect(utanSurplusavslut(text)).toBe(text);
  });

  it("ett trunkerat svar (för få klamrar) lämnas orört", () => {
    expect(utanSurplusavslut('{"a":{"b":1}')).toBe('{"a":{"b":1}');
  });
});

describe("runStructuredExtraction — ofullständiga avgiftsposter", () => {
  it("fyller i poster modellen utelämnat som 'okant' (aldrig 'nej') i stället för att kasta ett valideringsfel och betala en omkörning", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 300 });
    const modell = {
      ...validExtractionResult,
      forening: {
        ...validExtractionResult.forening,
        avgiftInkluderarEnligtForening: { el: "ja", tv: "okant" },
      },
    };
    client.messages.create.mockResolvedValue({
      usage: { input_tokens: 300, output_tokens: 100 },
      content: [{ type: "text", text: JSON.stringify(modell) }],
    });
    const { extraction, calls } = await runStructuredExtraction("Fynd.", { maxCostSek: 5, client });
    expect(calls).toHaveLength(1);
    expect(extraction.forening.avgiftInkluderarEnligtForening).toEqual({
      varme: "okant",
      vatten: "okant",
      el: "ja",
      bredband: "okant",
      tv: "okant",
    });
  });

  it("rör inte ett helt utelämnat fält", () => {
    const raw = { forening: {} };
    fyllIOkandaAvgiftsposter(raw);
    expect(raw).toEqual({ forening: {} });
  });
});
