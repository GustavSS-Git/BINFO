import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { errorHasKnownSpend } from "./callMetrics";
import { KostnadsgransOverskriden } from "./costGuard";
import { ModelTruncatedError, ModelValidationError } from "./extract";
import { ModelRefusedError, type AnthropicClientLike } from "./runExtraction";
import { IDENTITET_PROMPT_VERSION, identifieraMedModell } from "./identitetModell";

type CountTokens = AnthropicClientLike["messages"]["countTokens"];
type Create = AnthropicClientLike["messages"]["create"];

function fakeClient() {
  return {
    messages: {
      countTokens: vi.fn<CountTokens>(),
      create: vi.fn<Create>(),
    },
  } satisfies AnthropicClientLike;
}

async function pdfMedSidor(antal: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < antal; i++) doc.addPage([200, 200]).drawText(`sida ${i + 1}`);
  return doc.save();
}

function svar(text: string, over: Partial<Awaited<ReturnType<Create>>> = {}) {
  return {
    usage: { input_tokens: 4000, output_tokens: 40 },
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    ...over,
  };
}

const GILTIG = '{"orgnr":"769616-0253","rakenskapsar":2025,"namn":"Brf Granen 10-11"}';

function klient(...svaren: Array<ReturnType<typeof svar>>) {
  const c = fakeClient();
  c.messages.countTokens.mockResolvedValue({ input_tokens: 4000 });
  for (const s of svaren) c.messages.create.mockResolvedValueOnce(s);
  return c;
}

describe("identifieraMedModell", () => {
  it("exposes the prompt version", () => {
    expect(IDENTITET_PROMPT_VERSION).toBe("1");
  });

  it("returns the identity from valid JSON and reports metrics for the one call", async () => {
    const c = klient(svar(GILTIG));
    const r = await identifieraMedModell(await pdfMedSidor(5), { maxCostSek: 1, client: c });
    expect(r.identitet).toEqual({
      orgnr: "769616-0253",
      rakenskapsar: 2025,
      namn: "Brf Granen 10-11",
    });
    expect(r.calls).toHaveLength(1);
    const call = r.calls[0]!;
    expect(call.model).toBe("claude-haiku-4-5");
    expect(call.inputTokens).toBe(4000);
    expect(call.outputTokens).toBe(40);
    expect(call.cacheCreationInputTokens).toBe(0);
    expect(call.cacheReadInputTokens).toBe(0);
    expect(call.stopReason).toBe("end_turn");
    // Haiku 4.5: $1 in / $5 out per MTok
    expect(r.spentSek).toBeCloseTo(call.costSek, 10);
    expect(r.spentSek).toBeGreaterThan(0);
    expect(r.spentSek).toBeLessThan(0.1);
  });

  it("sends only pages 1-3 as a base64 document block without citations, with no effort setting", async () => {
    const c = klient(svar(GILTIG));
    await identifieraMedModell(await pdfMedSidor(5), { maxCostSek: 1, client: c });

    const params = c.messages.create.mock.calls[0]![0];
    expect(params.model).toBe("claude-haiku-4-5");
    expect(params.output_config).toBeUndefined();
    expect(params.max_tokens).toBeLessThanOrEqual(500);

    const content = params.messages[0]!.content as Array<Record<string, unknown>>;
    const doc = content.find((b) => b["type"] === "document") as {
      source: { type: string; media_type: string; data: string };
      citations?: unknown;
    };
    expect(doc.source.type).toBe("base64");
    expect(doc.source.media_type).toBe("application/pdf");
    expect(doc.citations).toBeUndefined();
    const sent = await PDFDocument.load(Buffer.from(doc.source.data, "base64"));
    expect(sent.getPageCount()).toBe(3);

    // the same document goes to countTokens
    const counted = c.messages.countTokens.mock.calls[0]![0];
    expect(counted.model).toBe("claude-haiku-4-5");
  });

  it("sends fewer pages when the PDF is shorter than three", async () => {
    const c = klient(svar(GILTIG));
    await identifieraMedModell(await pdfMedSidor(2), { maxCostSek: 1, client: c });
    const content = c.messages.create.mock.calls[0]![0].messages[0]!.content as Array<
      Record<string, unknown>
    >;
    const doc = content.find((b) => b["type"] === "document") as { source: { data: string } };
    expect((await PDFDocument.load(Buffer.from(doc.source.data, "base64"))).getPageCount()).toBe(2);
  });

  it("does not consume the caller's byte array", async () => {
    const bytes = await pdfMedSidor(4);
    const langd = bytes.length;
    await identifieraMedModell(bytes, { maxCostSek: 1, client: klient(svar(GILTIG)) });
    expect(bytes.length).toBe(langd);
  });

  it("normalises a ten-digit orgnr and a year given as a string", async () => {
    const c = klient(svar('{"orgnr":"7696160253","rakenskapsar":"2025","namn":null}'));
    const r = await identifieraMedModell(await pdfMedSidor(1), { maxCostSek: 1, client: c });
    expect(r.identitet).toEqual({ orgnr: "769616-0253", rakenskapsar: 2025, namn: null });
  });

  it("unwraps a markdown-fenced answer", async () => {
    const c = klient(svar("```json\n" + GILTIG + "\n```"));
    const r = await identifieraMedModell(await pdfMedSidor(1), { maxCostSek: 1, client: c });
    expect(r.identitet?.orgnr).toBe("769616-0253");
  });

  it("returns null identity (no retry) when the orgnr fails the Luhn check", async () => {
    const c = klient(svar('{"orgnr":"769616-0254","rakenskapsar":2025,"namn":"Brf Granen 10-11"}'));
    const r = await identifieraMedModell(await pdfMedSidor(1), { maxCostSek: 1, client: c });
    expect(r.identitet).toBeNull();
    expect(c.messages.create).toHaveBeenCalledTimes(1);
  });

  it("returns null identity when the model says the orgnr or year is not printed", async () => {
    for (const json of [
      '{"orgnr":null,"rakenskapsar":2025,"namn":"Brf X"}',
      '{"orgnr":"769616-0253","rakenskapsar":null,"namn":"Brf X"}',
      '{"orgnr":"769616-0253","rakenskapsar":1850,"namn":"Brf X"}',
    ]) {
      const r = await identifieraMedModell(await pdfMedSidor(1), {
        maxCostSek: 1,
        client: klient(svar(json)),
      });
      expect(r.identitet, json).toBeNull();
    }
  });

  it("retries once on a validation failure and accumulates both calls", async () => {
    const c = klient(svar("Jag kunde inte läsa dokumentet."), svar(GILTIG));
    const r = await identifieraMedModell(await pdfMedSidor(1), { maxCostSek: 1, client: c });
    expect(r.identitet?.orgnr).toBe("769616-0253");
    expect(r.calls).toHaveLength(2);
    expect(r.spentSek).toBeCloseTo(r.calls[0]!.costSek + r.calls[1]!.costSek, 10);
  });

  it("throws after the retry also fails, annotated with the real spend of both calls", async () => {
    const c = klient(svar("inte json"), svar('{"orgnr": 5}'));
    const fel = await identifieraMedModell(await pdfMedSidor(1), {
      maxCostSek: 1,
      client: c,
    }).catch((e: unknown) => e);
    expect(fel).toBeInstanceOf(ModelValidationError);
    expect(c.messages.create).toHaveBeenCalledTimes(2);
    expect(errorHasKnownSpend(fel)).toBe(true);
    if (errorHasKnownSpend(fel)) {
      expect(fel.calls).toHaveLength(2);
      expect(fel.spentSek).toBeGreaterThan(0);
    }
  });

  it("treats stop_reason max_tokens as an error without retrying", async () => {
    const c = klient(svar('{"orgnr":"769616-0253","rakenskap', { stop_reason: "max_tokens" }));
    const fel = await identifieraMedModell(await pdfMedSidor(1), {
      maxCostSek: 1,
      client: c,
    }).catch((e: unknown) => e);
    expect(fel).toBeInstanceOf(ModelTruncatedError);
    expect(c.messages.create).toHaveBeenCalledTimes(1);
    expect(errorHasKnownSpend(fel) && fel.calls.length).toBe(1);
  });

  it("treats stop_reason refusal as an error without retrying", async () => {
    const c = klient(svar("", { stop_reason: "refusal", content: [] }));
    const fel = await identifieraMedModell(await pdfMedSidor(1), {
      maxCostSek: 1,
      client: c,
    }).catch((e: unknown) => e);
    expect(fel).toBeInstanceOf(ModelRefusedError);
    expect(c.messages.create).toHaveBeenCalledTimes(1);
  });

  it("aborts before the call when the pre-flight estimate exceeds the cap", async () => {
    const c = klient(svar(GILTIG));
    c.messages.countTokens.mockResolvedValue({ input_tokens: 5_000_000 });
    const fel = await identifieraMedModell(await pdfMedSidor(1), {
      maxCostSek: 0.5,
      client: c,
    }).catch((e: unknown) => e);
    expect(fel).toBeInstanceOf(KostnadsgransOverskriden);
    expect(c.messages.create).not.toHaveBeenCalled();
  });

  it("fails clearly (no API call) on bytes that are not a PDF", async () => {
    const c = klient(svar(GILTIG));
    await expect(
      identifieraMedModell(new Uint8Array([1, 2, 3]), { maxCostSek: 1, client: c }),
    ).rejects.toThrow(/PDF/);
    expect(c.messages.countTokens).not.toHaveBeenCalled();
    expect(c.messages.create).not.toHaveBeenCalled();
  });

  it("uses the model passed in options", async () => {
    const c = klient(svar(GILTIG));
    await identifieraMedModell(await pdfMedSidor(1), {
      maxCostSek: 1,
      client: c,
      model: "claude-sonnet-5",
    });
    expect(c.messages.create.mock.calls[0]![0].model).toBe("claude-sonnet-5");
  });
});
