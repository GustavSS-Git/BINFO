import { describe, expect, it, vi } from "vitest";
import { AnalysValidationError, analysera, runAnalys, tillatnaSidor } from "./analyze";
import { extraktion } from "./__fixtures__/extraktion";
import { errorHasKnownSpend } from "./callMetrics";
import { estimateCostSek, SONNET_5_PRISSATTNING } from "./costGuard";
import { ModelTruncatedError } from "./extract";
import { ModelRefusedError, type AnthropicClientLike } from "./runExtraction";
import { buildAnalysSystemPrompt } from "./prompts";

function giltigtSvar() {
  return {
    betyg: "D",
    betygMotivering:
      "Hög skuldsättning i kombination med att 31 000 000 kr av lånen omsätts 2026 och ett stambyte 2028.",
    rodaFlaggor: [
      {
        id: "hog-rantekanslighet",
        titel: "Avgiften är mycket räntekänslig",
        beskrivning:
          "Räntekänsligheten är 9,2 %, vilket betyder att avgifterna måste höjas med 9,2 % för varje procentenhet räntan stiger.",
        severity: "hog",
        ref: { page: 8, excerpt: "Räntekänslighet 9,2 %" },
        harledsFran: ["rantekanslighet", "skuldsattning_per_m2_totalyta"],
      },
      {
        id: "lagt-sparande-infor-stambyte",
        titel: "Lågt sparande inför ett planerat stambyte",
        beskrivning: "Sparandet är 180 kr/m² samtidigt som ett stambyte är planerat till 2028.",
        severity: "medel",
        harledsFran: ["sparande_per_m2_totalyta"],
      },
    ],
    fragor: [
      {
        id: "fraga-omsattning-2026",
        fraga:
          "Till vilken ränta räknar styrelsen med att kunna lägga om lånet på 31 000 000 kr under 2026?",
        ursprung: "analys",
        riktadTill: "styrelsen",
        varfor: "Mer än hälften av skulden omsätts 2026 från 1,1 %.",
        ref: { page: 12, excerpt: "SBAB 1,1 % 2026-03-01 31 000 000" },
      },
      {
        id: "fraga-stambyte-finansiering",
        fraga:
          "Hur ska stambytet 2028 finansieras — med nya lån, höjda avgifter eller befintligt sparande?",
        ursprung: "analys",
        riktadTill: "styrelsen",
        varfor: "Underhållsplanen anger ett stambyte 2028 medan sparandet är lågt.",
      },
    ],
  };
}

describe("tillatnaSidor", () => {
  it("samlar in varje sidnummer som faktiskt förekommer i extraktionen", () => {
    const sidor = tillatnaSidor(extraktion);
    expect([...sidor].sort((a, b) => a - b)).toEqual([3, 4, 6, 8, 12]);
  });
});

describe("analysera", () => {
  it("returnerar det validerade omdömet direkt när modellens svar är giltigt", async () => {
    const callModel = vi.fn().mockResolvedValue(giltigtSvar());

    const analys = await analysera(extraktion, callModel);

    expect(analys.betyg).toBe("D");
    expect(analys.rodaFlaggor).toHaveLength(2);
    expect(analys.fragor.every((f) => f.ursprung === "analys")).toBe(true);
    expect(callModel).toHaveBeenCalledTimes(1);
  });

  it("avvisar en påhittad KeyFigureId i harledsFran — en flagga utan spårbart underlag får inte visas", async () => {
    const svar = giltigtSvar();
    svar.rodaFlaggor[0]!.harledsFran = ["soliditet"];
    const callModel = vi.fn().mockResolvedValue(svar);

    await expect(analysera(extraktion, callModel)).rejects.toThrow(AnalysValidationError);
    expect(callModel).toHaveBeenCalledTimes(2);
  });

  it("avvisar en flagga med tom harledsFran", async () => {
    const svar = giltigtSvar();
    svar.rodaFlaggor[0]!.harledsFran = [];
    const callModel = vi.fn().mockResolvedValue(svar);

    await expect(analysera(extraktion, callModel)).rejects.toThrow(AnalysValidationError);
  });

  it("avvisar en fråga med ursprung 'saknad_uppgift' — de genereras deterministiskt på annat håll", async () => {
    const svar = giltigtSvar();
    svar.fragor[0]!.ursprung = "saknad_uppgift";
    const callModel = vi.fn().mockResolvedValue(svar);

    await expect(analysera(extraktion, callModel)).rejects.toThrow(AnalysValidationError);
  });

  it("avvisar ett sidnummer som inte finns i extraktionen — modellen får aldrig hitta på en sida", async () => {
    const svar = giltigtSvar();
    svar.rodaFlaggor[0]!.ref = { page: 99, excerpt: "hittad på" };
    const callModel = vi.fn().mockResolvedValue(svar);

    await expect(analysera(extraktion, callModel)).rejects.toThrow(AnalysValidationError);
  });

  it("accepterar en ref vars sida finns i extraktionen", async () => {
    const svar = giltigtSvar();
    svar.fragor[1] = {
      ...svar.fragor[1]!,
      ref: { page: 6, excerpt: "Stambyte beräknas till 2028" },
    };
    const callModel = vi.fn().mockResolvedValue(svar);

    const analys = await analysera(extraktion, callModel);

    expect(analys.fragor[1]?.ref?.page).toBe(6);
  });

  it("avvisar dubblerade id:n bland röda flaggor", async () => {
    const svar = giltigtSvar();
    svar.rodaFlaggor[1]!.id = svar.rodaFlaggor[0]!.id;
    const callModel = vi.fn().mockResolvedValue(svar);

    await expect(analysera(extraktion, callModel)).rejects.toThrow(AnalysValidationError);
  });

  it("avvisar en tom betygMotivering — ett betyg utan motivering går inte att granska", async () => {
    const svar = giltigtSvar();
    svar.betygMotivering = "";
    const callModel = vi.fn().mockResolvedValue(svar);

    await expect(analysera(extraktion, callModel)).rejects.toThrow(AnalysValidationError);
  });

  it("försöker en gång till vid malformat svar och lyckas på försök två", async () => {
    const callModel = vi
      .fn()
      .mockResolvedValueOnce("```json\n{ inte ens giltig JSON")
      .mockResolvedValueOnce(giltigtSvar());

    const analys = await analysera(extraktion, callModel);

    expect(analys.betyg).toBe("D");
    expect(callModel).toHaveBeenCalledTimes(2);
  });

  it("ger upp efter en retry och kastar ett tydligt fel — tyst tom analys är värsta felläget", async () => {
    const callModel = vi.fn().mockResolvedValue({ nagot: "helt fel format" });

    try {
      await analysera(extraktion, callModel);
      expect.fail("skulle ha kastat");
    } catch (e) {
      expect(e).toBeInstanceOf(AnalysValidationError);
      const fel = e as AnalysValidationError;
      expect(fel.zodError.issues.length).toBeGreaterThan(0);
      expect(fel.message).toContain("Analysen");
    }
    expect(callModel).toHaveBeenCalledTimes(2);
  });

  it("skickar med hela extraktionen i användarprompten så modellen ser nyckeltalens status", async () => {
    const callModel = vi.fn().mockResolvedValue(giltigtSvar());

    await analysera(extraktion, callModel);

    const [, userPrompt] = callModel.mock.calls[0]!;
    expect(userPrompt).toContain("rantekanslighet");
    expect(userPrompt).toContain("Brf Kastanjen");
    expect(userPrompt).toContain("Stambyte planerat 2028");
  });
});

type CountTokens = AnthropicClientLike["messages"]["countTokens"];
type Create = AnthropicClientLike["messages"]["create"];

/** Same shape as runExtraction.test.ts's fakeClient — kept local rather than
 *  shared, since the two test files' fakes only need to agree on the
 *  interface, not share an import. */
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

describe("runAnalys", () => {
  it("tar emot en injicerad klient (samma mönster som runGrounding/runStructuredExtraction) i stället för att alltid bygga en riktig Anthropic-klient", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 300 });
    client.messages.create.mockResolvedValue({
      usage: { input_tokens: 300, output_tokens: 100 },
      content: [{ type: "text", text: JSON.stringify(giltigtSvar()) }],
    });

    const result = await runAnalys(extraktion, { maxCostSek: 5, client });

    expect(result.analys.betyg).toBe("D");
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it("returnerar ett call-metrics-objekt per faktiskt anrop, taggat 'bedomning'", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 300 });
    client.messages.create.mockResolvedValue({
      usage: { input_tokens: 300, output_tokens: 100 },
      content: [{ type: "text", text: JSON.stringify(giltigtSvar()) }],
    });

    const result = await runAnalys(extraktion, { maxCostSek: 5, client, model: "claude-sonnet-5" });

    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]).toMatchObject({
      stage: "bedomning",
      model: "claude-sonnet-5",
      inputTokens: 300,
      outputTokens: 100,
    });
    expect(result.spentSek).toBeCloseTo(estimateCostSek(300, 100, SONNET_5_PRISSATTNING), 10);
  });

  it("kastar ModelTruncatedError annoterat med den faktiska kostnaden — inte 0 kr (reviewer finding)", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 300 });
    client.messages.create.mockResolvedValue({
      usage: { input_tokens: 300, output_tokens: 16000 },
      content: [{ type: "text", text: '{"betyg": "C"' }],
      stop_reason: "max_tokens",
    });

    try {
      await runAnalys(extraktion, { maxCostSek: 5, client });
      expect.fail("skulle ha kastat");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelTruncatedError);
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
      await runAnalys(extraktion, { maxCostSek: 5, client });
      expect.fail("skulle ha kastat");
    } catch (error) {
      expect(client.messages.create).toHaveBeenCalledTimes(2);
      expect(errorHasKnownSpend(error)).toBe(true);
      if (errorHasKnownSpend(error)) {
        expect(error.calls).toHaveLength(2);
      }
    }
  });

  it("lägger brytpunkten på det statiska systemblocket och användarblocket; promptCache:false tar bort dem", async () => {
    const mk = () => {
      const client = fakeClient();
      client.messages.countTokens.mockResolvedValue({ input_tokens: 300 });
      client.messages.create.mockResolvedValue({
        usage: { input_tokens: 300, output_tokens: 100 },
        content: [{ type: "text", text: JSON.stringify(giltigtSvar()) }],
      });
      return client;
    };
    type Req = { system: unknown; messages: Array<{ content: unknown }> };

    const på = mk();
    await runAnalys(extraktion, { maxCostSek: 5, client: på, promptCache: true });
    const reqPå = på.messages.create.mock.calls[0]?.[0] as Req;
    expect(reqPå.system).toEqual([
      { type: "text", text: buildAnalysSystemPrompt(), cache_control: { type: "ephemeral" } },
    ]);
    const userBlocks = reqPå.messages[0]?.content as Array<{ cache_control?: unknown }>;
    expect(userBlocks).toHaveLength(1);
    expect(userBlocks[0]?.cache_control).toEqual({ type: "ephemeral" });
    expect(Object.keys(reqPå)).not.toContain("cache_control");

    const av = mk();
    await runAnalys(extraktion, { maxCostSek: 5, client: av, promptCache: false });
    const reqAv = av.messages.create.mock.calls[0]?.[0] as Req;
    expect(typeof reqAv.system).toBe("string");
    expect(typeof reqAv.messages[0]?.content).toBe("string");
    expect(JSON.stringify(reqAv)).not.toContain("cache_control");
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
      await runAnalys(extraktion, { maxCostSek: 5, client });
      expect.fail("skulle ha kastat");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelRefusedError);
      expect(errorHasKnownSpend(error)).toBe(true);
      if (errorHasKnownSpend(error)) expect(error.spentSek).toBeGreaterThan(0);
    }
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it("skickar output_config.effort vidare när angiven", async () => {
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 300 });
    client.messages.create.mockResolvedValue({
      usage: { input_tokens: 300, output_tokens: 100 },
      content: [{ type: "text", text: JSON.stringify(giltigtSvar()) }],
    });

    await runAnalys(extraktion, { maxCostSek: 5, client, effort: "medium" });

    const params = client.messages.create.mock.calls[0]?.[0] as { output_config?: unknown };
    expect(params.output_config).toEqual({ effort: "medium" });
  });
});
