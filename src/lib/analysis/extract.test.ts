import { describe, expect, it, vi } from "vitest";
import { ExtractionValidationError, extractWithRetry } from "./extract";
import type { ExtractionResult, KeyFigure, KeyFigureId } from "@/types/analysis";

const ALLA_NYCKELTAL_ID: KeyFigureId[] = [
  "arsavgift_per_m2_brf_yta",
  "arsavgift_andel_av_rorelseintakter",
  "skuldsattning_per_m2_totalyta",
  "skuldsattning_per_m2_brf_yta",
  "sparande_per_m2_totalyta",
  "rantekanslighet",
  "energikostnad_per_m2_totalyta",
];

function nyckeltal(): KeyFigure[] {
  return ALLA_NYCKELTAL_ID.map((id) => ({
    id,
    label: id,
    figure: {
      value: 100,
      unit: "kr/m2",
      source: "arsredovisning",
      ref: { page: 4, excerpt: "Testcitat från rapporten" },
    },
    status: "god",
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
    keyFigures: nyckeltal(),
  },
  datakvalitet: {
    pdfSaknarTextlager: false,
    extraktionKonfidens: { niva: "hog" },
    saknadeFalt: [],
  },
};

describe("extractWithRetry", () => {
  it("returnerar det validerade resultatet direkt om första försöket är giltigt", async () => {
    const callModel = vi.fn().mockResolvedValue(validExtractionResult);

    const result = await extractWithRetry("system", "user", callModel);

    expect(result).toEqual(validExtractionResult);
    expect(callModel).toHaveBeenCalledTimes(1);
  });

  it("försöker en gång till om första svaret är malformad JSON, och lyckas på försök två", async () => {
    const callModel = vi
      .fn()
      .mockResolvedValueOnce({ nagot: "helt fel format" })
      .mockResolvedValueOnce(validExtractionResult);

    const result = await extractWithRetry("system", "user", callModel);

    expect(result).toEqual(validExtractionResult);
    expect(callModel).toHaveBeenCalledTimes(2);
  });

  it("ger upp efter en retry och kastar ett tydligt fel — tyst tom analys är värsta felläget", async () => {
    const callModel = vi.fn().mockResolvedValue({ nagot: "helt fel format" });

    await expect(extractWithRetry("system", "user", callModel)).rejects.toThrow(
      ExtractionValidationError,
    );
    expect(callModel).toHaveBeenCalledTimes(2); // ett första försök + en retry, sen ge upp
  });

  it("felmeddelandet pekar ut vilka fält som inte validerade", async () => {
    const callModel = vi.fn().mockResolvedValue({ nagot: "helt fel format" });

    try {
      await extractWithRetry("system", "user", callModel);
      expect.fail("skulle ha kastat");
    } catch (e) {
      expect(e).toBeInstanceOf(ExtractionValidationError);
      const err = e as ExtractionValidationError;
      expect(err.zodError.issues.length).toBeGreaterThan(0);
    }
  });
});
