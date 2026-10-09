import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { errorHasKnownSpend } from "./callMetrics";
import { KostnadsgransOverskriden } from "./costGuard";
import { ModelTruncatedError } from "./extract";
import { buildTranskriberingSystemPrompt, buildTranskriberingUserPrompt } from "./prompts";
import { ModelRefusedError, type AnthropicClientLike } from "./runExtraction";
import {
  arOvergaendeApiFel,
  delaPdf,
  parseTranskription,
  TranskriberingMarkorFelError,
  transkribera,
} from "./transkribering";

async function pdfMedSidor(antal: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < antal; i++) doc.addPage([200, 200]);
  return doc.save();
}

async function antalSidorI(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}

describe("delaPdf", () => {
  it("delar 12 sidor i delar om 5: 1–5, 6–10, 11–12 med originalnumren", async () => {
    const delar = await delaPdf(await pdfMedSidor(12), 5);
    expect(delar.map((d) => [d.forstaSida, d.sidor])).toEqual([
      [1, 5],
      [6, 5],
      [11, 2],
    ]);
    for (const d of delar) expect(await antalSidorI(d.bytes)).toBe(d.sidor);
  });

  it("använder 5 sidor som förval", async () => {
    const delar = await delaPdf(await pdfMedSidor(6));
    expect(delar.map((d) => d.sidor)).toEqual([5, 1]);
  });

  it("en PDF som är mindre än en del blir en enda del", async () => {
    const delar = await delaPdf(await pdfMedSidor(3), 5);
    expect(delar).toHaveLength(1);
    expect(delar[0]).toMatchObject({ forstaSida: 1, sidor: 3 });
  });

  it("ändrar inte indata-byten", async () => {
    const bytes = await pdfMedSidor(4);
    const kopia = bytes.slice();
    await delaPdf(bytes, 2);
    expect(bytes).toEqual(kopia);
  });

  it("avvisar ogiltig chunkstorlek och ogiltig PDF", async () => {
    await expect(delaPdf(await pdfMedSidor(2), 0)).rejects.toThrow(/chunkStorlek/);
    await expect(delaPdf(await pdfMedSidor(2), 2.5)).rejects.toThrow(/chunkStorlek/);
    await expect(delaPdf(new Uint8Array([1, 2, 3]), 5)).rejects.toThrow(/Kunde inte läsa PDF/);
  });
});

describe("parseTranskription", () => {
  it("delar vid markörerna och behåller originalsidnumren", () => {
    const r = parseTranskription(
      "=== SIDA 6 ===\nFörsta sidan\nrad två\n\n=== SIDA 7 ===\nAndra | 1 234",
      6,
      2,
    );
    expect(r).toEqual({
      ok: true,
      sidor: [
        { sida: 6, text: "Första sidan\nrad två" },
        { sida: 7, text: "Andra | 1 234" },
      ],
    });
  });

  it("tål CRLF och inledande blanksteg på markörraden, och släpper text före första markören", () => {
    const r = parseTranskription("Här kommer den:\r\n  === SIDA 1 ===\r\nHej\r\n", 1, 1);
    expect(r).toEqual({ ok: true, sidor: [{ sida: 1, text: "Hej" }] });
  });

  it("en tom sida behålls med tom text", () => {
    const r = parseTranskription("=== SIDA 1 ===\n\n=== SIDA 2 ===\nText", 1, 2);
    expect(r).toEqual({
      ok: true,
      sidor: [
        { sida: 1, text: "" },
        { sida: 2, text: "Text" },
      ],
    });
  });

  it("saknad markör är fel", () => {
    const r = parseTranskription("=== SIDA 1 ===\nA", 1, 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fel.join()).toMatch(/2 saknas/);
  });

  it("dubblerad markör är fel (Haiku-felet)", () => {
    const r = parseTranskription("=== SIDA 1 ===\nA\n=== SIDA 1 ===\nB", 1, 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fel.join()).toMatch(/mer än en gång/);
  });

  it("markör utanför delens sidor är fel (modellen räknade från 1 i stället för originalnumret)", () => {
    const r = parseTranskription("=== SIDA 1 ===\nA\n=== SIDA 2 ===\nB", 6, 2);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.fel.join()).toMatch(/6 saknas/);
      expect(r.fel.join()).toMatch(/oväntad sidmarkör 1/);
    }
  });

  it("ett tryckt 'Sida 3 av 20' i brödtexten är inte en markör", () => {
    const r = parseTranskription("=== SIDA 8 ===\nSida 6 av 20\nSIDA 9 ===", 8, 1);
    expect(r).toEqual({ ok: true, sidor: [{ sida: 8, text: "Sida 6 av 20\nSIDA 9 ===" }] });
  });

  it("ingen markör alls är fel", () => {
    expect(parseTranskription("bara text", 1, 1).ok).toBe(false);
  });
});

describe("transkriberings-prompten", () => {
  it("kräver ordagrann avskrift, tabellceller med ' | ', exakta tal, originalnummer, [oläsligt] och att textlagret inte ska litas på", () => {
    const p = buildTranskriberingSystemPrompt();
    expect(p).toMatch(/ordagrant/);
    expect(p).toContain('" | "');
    expect(p).toMatch(/EXAKT/);
    expect(p).toContain("tkr");
    expect(p).toContain("neg");
    expect(p).toContain("=== SIDA n ===");
    expect(p).toMatch(/ORIGINALNUMMER/);
    expect(p).toContain("[oläsligt]");
    expect(p).toMatch(/Gissa aldrig/);
    expect(p).toMatch(/textlager.*trasigt/s);
    expect(p).toMatch(/Förlita dig ALDRIG på textlagret/);
  });

  it("användarprompten anger delens första och sista originalsida", () => {
    const u = buildTranskriberingUserPrompt(6, 5);
    expect(u).toContain('"=== SIDA 6 ==="');
    expect(u).toContain("nummer 10");
    expect(buildTranskriberingUserPrompt(16, 1)).not.toContain("den sista");
  });
});

describe("arOvergaendeApiFel", () => {
  it("känner igen anslutningsfel, 429, 5xx och 529 — men inte 400/401", () => {
    expect(arOvergaendeApiFel(new Error("Connection error."))).toBe(true);
    expect(arOvergaendeApiFel(Object.assign(new Error("x"), { status: 429 }))).toBe(true);
    expect(arOvergaendeApiFel(Object.assign(new Error("x"), { status: 500 }))).toBe(true);
    expect(arOvergaendeApiFel(Object.assign(new Error("x"), { status: 529 }))).toBe(true);
    expect(arOvergaendeApiFel(Object.assign(new Error("x"), { status: 400 }))).toBe(false);
    expect(arOvergaendeApiFel(Object.assign(new Error("x"), { status: 401 }))).toBe(false);
    expect(arOvergaendeApiFel(new Error("något helt annat"))).toBe(false);
    expect(arOvergaendeApiFel("sträng")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// transkribera, with a fake client
// ---------------------------------------------------------------------------

type CountTokens = AnthropicClientLike["messages"]["countTokens"];
type Create = AnthropicClientLike["messages"]["create"];
type CreateParams = Parameters<Create>[0];

function fakeClient() {
  return {
    messages: { countTokens: vi.fn<CountTokens>(), create: vi.fn<Create>() },
  } satisfies AnthropicClientLike;
}

/** What the user prompt tells the model: first page and page count of the chunk. */
function delenIFraga(params: CreateParams): { forsta: number; antal: number } {
  const content = params.messages[0]!.content as Array<{ type: string; text?: string }>;
  const text = content.find((b) => b.type === "text")!.text!;
  return {
    forsta: Number(/originalnummer (\d+)/.exec(text)![1]),
    antal: Number(/innehåller (\d+) sida/.exec(text)![1]),
  };
}

function korrektSvar(forsta: number, antal: number): string {
  return Array.from(
    { length: antal },
    (_, i) => `=== SIDA ${forsta + i} ===\nText på sida ${forsta + i} | 1 234`,
  ).join("\n\n");
}

function svar(text: string, over: Partial<Awaited<ReturnType<Create>>> = {}) {
  return {
    usage: { input_tokens: 8500, output_tokens: 3000 },
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    ...over,
  };
}

function okKlient() {
  const client = fakeClient();
  client.messages.countTokens.mockResolvedValue({ input_tokens: 8500 });
  client.messages.create.mockImplementation(async (params) => {
    const { forsta, antal } = delenIFraga(params);
    return svar(korrektSvar(forsta, antal));
  });
  return client;
}

describe("transkribera", () => {
  it("transkriberar alla delar parallellt och returnerar sidorna i ordning med kostnad och anropsmått", async () => {
    const client = okKlient();
    const sparade: number[][] = [];
    const r = await transkribera(await pdfMedSidor(12), {
      maxCostSek: 20,
      client,
      sparaSidor: async (sidor) => {
        sparade.push(sidor.map((s) => s.sida));
      },
    });

    expect(r.sidor.map((s) => s.sida)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(r.sidor[10]!.text).toBe("Text på sida 11 | 1 234");
    expect(client.messages.create).toHaveBeenCalledTimes(3);
    expect(r.calls).toHaveLength(3);
    expect(r.calls.every((c) => c.stage === "transkribering")).toBe(true);
    expect(r.spentSek).toBeCloseTo(
      r.calls.reduce((s, c) => s + c.costSek, 0),
      10,
    );
    expect(r.spentSek).toBeGreaterThan(0);
    // Persisted once per finished chunk.
    expect(sparade.map((s) => s.length).sort()).toEqual([2, 5, 5]);
  });

  it("skickar varje del som ett PDF-document-block utan citations, med transkriptionsprompten och effort medium", async () => {
    const client = okKlient();
    await transkribera(await pdfMedSidor(6), { maxCostSek: 20, client });
    const params = client.messages.create.mock.calls[0]![0];
    const content = params.messages[0]!.content as Array<Record<string, unknown>>;
    const doc = content[0] as {
      type: string;
      source: { type: string; media_type: string; data: string };
      citations?: unknown;
    };
    expect(doc.type).toBe("document");
    expect(doc.source.type).toBe("base64");
    expect(doc.source.media_type).toBe("application/pdf");
    expect(doc.citations).toBeUndefined();
    expect(doc.source.data.length).toBeGreaterThan(100);
    expect(params.system).toBe(buildTranskriberingSystemPrompt());
    expect(params.output_config).toEqual({ effort: "medium" });
    expect(params.model).toBe("claude-sonnet-5-5");
    // Pre-flight used the SAME messages.
    expect(client.messages.countTokens).toHaveBeenCalledTimes(2);
  });

  it("skickar vald modell och effort vidare", async () => {
    const client = okKlient();
    await transkribera(await pdfMedSidor(2), {
      maxCostSek: 20,
      client,
      model: "claude-sonnet-5",
      effort: "low",
    });
    const params = client.messages.create.mock.calls[0]![0];
    expect(params.model).toBe("claude-sonnet-5");
    expect(params.output_config).toEqual({ effort: "low" });
  });

  it("hoppar över delar som redan är helt sparade — inga anrop, ingen kostnad — och tar med deras text", async () => {
    const client = okKlient();
    const redan = new Map<number, string>(
      [1, 2, 3, 4, 5].map((n) => [n, `sparad ${n}`] as [number, string]),
    );
    const sparade: number[][] = [];
    const r = await transkribera(await pdfMedSidor(8), {
      maxCostSek: 20,
      client,
      redanKlara: redan,
      sparaSidor: async (s) => {
        sparade.push(s.map((x) => x.sida));
      },
    });
    expect(client.messages.create).toHaveBeenCalledTimes(1);
    expect(sparade).toEqual([[6, 7, 8]]);
    expect(r.sidor.map((s) => s.sida)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(r.sidor[0]!.text).toBe("sparad 1");
    expect(r.sidor[5]!.text).toBe("Text på sida 6 | 1 234");
  });

  it("en del som bara delvis är sparad görs om i sin helhet", async () => {
    const client = okKlient();
    const r = await transkribera(await pdfMedSidor(5), {
      maxCostSek: 20,
      client,
      redanKlara: new Map([
        [1, "a"],
        [2, "b"],
      ]),
    });
    expect(client.messages.create).toHaveBeenCalledTimes(1);
    expect(r.sidor[0]!.text).toBe("Text på sida 1 | 1 234");
  });

  it("allt redan sparat: inget anrop alls, ingen klient behövs", async () => {
    const r = await transkribera(await pdfMedSidor(2), {
      maxCostSek: 1,
      redanKlara: new Map([
        [1, "a"],
        [2, "b"],
      ]),
    });
    expect(r.calls).toEqual([]);
    expect(r.spentSek).toBe(0);
    expect(r.sidor).toEqual([
      { sida: 1, text: "a" },
      { sida: 2, text: "b" },
    ]);
  });

  it("gör om en del en gång när sidmarkörerna är fel, och lyckas", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 8500 });
    client.messages.create
      .mockResolvedValueOnce(svar("=== SIDA 1 ===\nA\n=== SIDA 1 ===\nB"))
      .mockResolvedValueOnce(svar(korrektSvar(1, 2)));
    const r = await transkribera(await pdfMedSidor(2), { maxCostSek: 20, client });
    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(r.sidor).toHaveLength(2);
    expect(r.calls).toHaveLength(2);
    // Both attempts are paid for.
    expect(r.spentSek).toBeCloseTo(r.calls[0]!.costSek * 2, 10);
  });

  it("kastar ett tydligt fel om markörerna är fel även efter omförsöket, annoterat med båda anropens kostnad", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 8500 });
    client.messages.create.mockResolvedValue(svar("=== SIDA 3 ===\nfel"));
    const fel = await transkribera(await pdfMedSidor(2), { maxCostSek: 20, client }).catch(
      (e: unknown) => e,
    );
    expect(fel).toBeInstanceOf(TranskriberingMarkorFelError);
    expect((fel as Error).message).toMatch(/sidorna 1–2/);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(errorHasKnownSpend(fel)).toBe(true);
    if (errorHasKnownSpend(fel)) {
      expect(fel.calls).toHaveLength(2);
      expect(fel.spentSek).toBeGreaterThan(0);
    }
  });

  it("gör om en del en gång vid ett övergående API-fel (Connection error)", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 8500 });
    client.messages.create
      .mockRejectedValueOnce(new Error("Connection error."))
      .mockResolvedValueOnce(svar(korrektSvar(1, 2)));
    const r = await transkribera(await pdfMedSidor(2), {
      maxCostSek: 20,
      client,
      omforsokFordrojningMs: 0,
    });
    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(r.calls).toHaveLength(1); // the failed attempt produced no usage
    expect(r.sidor).toHaveLength(2);
  });

  it("ger upp efter ett andra övergående fel — och sparar ändå de delar som lyckades", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 8500 });
    client.messages.create.mockImplementation(async (params) => {
      const { forsta, antal } = delenIFraga(params);
      if (forsta === 6) throw Object.assign(new Error("overloaded"), { status: 529 });
      return svar(korrektSvar(forsta, antal));
    });
    const sparade: number[] = [];
    const fel = await transkribera(await pdfMedSidor(10), {
      maxCostSek: 20,
      client,
      omforsokFordrojningMs: 0,
      sparaSidor: async (s) => {
        sparade.push(...s.map((x) => x.sida));
      },
    }).catch((e: unknown) => e);
    expect((fel as Error).message).toBe("overloaded");
    expect(sparade).toEqual([1, 2, 3, 4, 5]);
    // chunk 1 once, chunk 2 twice
    expect(client.messages.create).toHaveBeenCalledTimes(3);
    expect(errorHasKnownSpend(fel)).toBe(true);
    if (errorHasKnownSpend(fel)) expect(fel.calls).toHaveLength(1);
  });

  it("ett 400-fel görs inte om", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 8500 });
    client.messages.create.mockRejectedValue(Object.assign(new Error("bad"), { status: 400 }));
    await expect(
      transkribera(await pdfMedSidor(2), { maxCostSek: 20, client, omforsokFordrojningMs: 0 }),
    ).rejects.toThrow("bad");
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it("kastar ModelTruncatedError vid max_tokens, annoterat med kostnaden", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 8500 });
    client.messages.create.mockResolvedValue(
      svar("=== SIDA 1 ===\nhalv", { stop_reason: "max_tokens" }),
    );
    const fel = await transkribera(await pdfMedSidor(1), { maxCostSek: 20, client }).catch(
      (e: unknown) => e,
    );
    expect(fel).toBeInstanceOf(ModelTruncatedError);
    expect(errorHasKnownSpend(fel) && fel.spentSek > 0).toBe(true);
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it("kastar ModelRefusedError vid refusal, utan omförsök", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 8500 });
    client.messages.create.mockResolvedValue(svar("", { stop_reason: "refusal" }));
    const fel = await transkribera(await pdfMedSidor(1), { maxCostSek: 20, client }).catch(
      (e: unknown) => e,
    );
    expect(fel).toBeInstanceOf(ModelRefusedError);
    expect(errorHasKnownSpend(fel) && fel.spentSek > 0).toBe(true);
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it("avbryter innan något betalt anrop om delarnas SAMMANLAGDA värsta fall överstiger taket", async () => {
    const client = okKlient();
    // 7 chunks, each worst case (8500 in + 16000 out) ~ 1.75 kr -> ~12 kr.
    const fel = await transkribera(await pdfMedSidor(35), { maxCostSek: 5, client }).catch(
      (e: unknown) => e,
    );
    expect(fel).toBeInstanceOf(KostnadsgransOverskriden);
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("ett omförsök som inte ryms under taket avbryts i stället för att överskrida det", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 8500 });
    client.messages.create.mockResolvedValue(svar("=== SIDA 9 ===\nfel"));
    // One chunk: worst case ~1.75 kr; cap 2 kr fits the first attempt (reserved 1.75),
    // the retry then needs 1.75 more after ~0.5 kr spent -> must not be sent.
    const fel = await transkribera(await pdfMedSidor(2), { maxCostSek: 2, client }).catch(
      (e: unknown) => e,
    );
    expect(fel).toBeInstanceOf(KostnadsgransOverskriden);
    expect(client.messages.create).toHaveBeenCalledTimes(1);
    expect(errorHasKnownSpend(fel) && fel.spentSek > 0).toBe(true);
  });

  it("läser ihop flera textblock och ignorerar andra blocktyper (thinking)", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 8500 });
    client.messages.create.mockResolvedValue({
      usage: { input_tokens: 1000, output_tokens: 500 },
      content: [
        { type: "thinking" },
        { type: "text", text: "=== SIDA 1 ===\nA" },
        { type: "text", text: "=== SIDA 2 ===\nB" },
      ],
      stop_reason: "end_turn",
    });
    const r = await transkribera(await pdfMedSidor(2), { maxCostSek: 20, client });
    expect(r.sidor.map((s) => s.text)).toEqual(["A", "B"]);
  });
});
