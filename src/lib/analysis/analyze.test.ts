import { describe, expect, it, vi } from "vitest";
import { AnalysValidationError, analysera, tillatnaSidor } from "./analyze";
import { extraktion } from "./__fixtures__/extraktion";

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
