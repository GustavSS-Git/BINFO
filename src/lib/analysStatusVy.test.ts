import { describe, expect, it } from "vitest";
import { STEG_TEXT, stegAndel } from "./analysStatusCopy";
import {
  ATERANVAND_TEXT,
  RAPPORTSTEG_TEXT,
  SKANNAD_UPPTACKT_TEXT,
  VANTAR_PA_RAPPORT_TEXT,
  arSkannadRapport,
  klarNotis,
  stegAndelFor,
  stegTextFor,
  vantaNotiser,
} from "./analysStatusVy";

describe("stegTextFor", () => {
  it("mappar varje rapportsteg till sin svenska text", () => {
    expect(stegTextFor({ stage: "uploaded", rapportSteg: "identifiering" })).toBe(
      "Identifierar föreningen…",
    );
    expect(stegTextFor({ stage: "uploaded", rapportSteg: "transkribering" })).toBe(
      "Läser av de skannade sidorna…",
    );
    expect(stegTextFor({ stage: "uploaded", rapportSteg: "grundning" })).toBe(
      "Läser årsredovisningen…",
    );
    expect(stegTextFor({ stage: "extracting", rapportSteg: "extraktion" })).toBe(
      "Hämtar de sju nyckeltalen…",
    );
    expect(stegTextFor({ stage: "judging", rapportSteg: "bedomning" })).toBe(
      "Analyserar föreningens ekonomi…",
    );
    expect(RAPPORTSTEG_TEXT.klar).toBe(STEG_TEXT.complete);
  });

  it("faller tillbaka på den gamla stage-texten utan rapportSteg", () => {
    expect(stegTextFor({ stage: "extracting" })).toBe(STEG_TEXT.extracting);
    expect(stegTextFor({ stage: "uploaded", textlager: "saknas" })).toBe(STEG_TEXT.uploaded);
  });
});

describe("stegAndelFor", () => {
  it("följer den gamla stage utan rapportSteg", () => {
    expect(stegAndelFor({ stage: "judging" })).toBe(stegAndel("judging"));
  });

  it("växer genom stegen för en rapport med textlager (transkribering ingår inte)", () => {
    const steg = ["identifiering", "grundning", "extraktion", "bedomning", "klar"] as const;
    const andelar = steg.map((rapportSteg) =>
      stegAndelFor({ stage: "uploaded", textlager: "ok", rapportSteg }),
    );
    expect(andelar).toEqual([0.2, 0.4, 0.6, 0.8, 1]);
  });

  it("räknar in transkribering för en skannad rapport", () => {
    expect(
      stegAndelFor({ stage: "uploaded", textlager: "saknas", rapportSteg: "transkribering" }),
    ).toBeCloseTo(2 / 6);
    expect(stegAndelFor({ stage: "uploaded", textlager: "saknas", rapportSteg: "klar" })).toBe(1);
  });

  it("ger aldrig 0", () => {
    expect(stegAndelFor({ stage: "uploaded", rapportSteg: "identifiering" })).toBeGreaterThan(0);
  });
});

describe("vantaNotiser", () => {
  it("visar skannad-notisen bara när textlagret saknas", () => {
    expect(vantaNotiser({ stage: "uploaded", textlager: "saknas" }).map((n) => n.text)).toEqual([
      SKANNAD_UPPTACKT_TEXT,
    ]);
    expect(vantaNotiser({ stage: "uploaded", textlager: "ok" })).toEqual([]);
    expect(vantaNotiser({ stage: "uploaded", textlager: "trasigt" })).toEqual([]);
    expect(vantaNotiser({ stage: "uploaded" })).toEqual([]);
  });

  it("visar att samma rapport analyseras just nu", () => {
    expect(vantaNotiser({ stage: "uploaded", vantarPaRapport: true }).map((n) => n.text)).toEqual([
      VANTAR_PA_RAPPORT_TEXT,
    ]);
    expect(vantaNotiser({ stage: "uploaded", vantarPaRapport: false })).toEqual([]);
  });

  it("kan visa båda", () => {
    expect(
      vantaNotiser({ stage: "uploaded", textlager: "saknas", vantarPaRapport: true }),
    ).toHaveLength(2);
  });

  it("har exakt den överenskomna svenska texten", () => {
    expect(SKANNAD_UPPTACKT_TEXT).toBe(
      "Skannad årsredovisning upptäckt – analysen tar lite längre tid.",
    );
    expect(VANTAR_PA_RAPPORT_TEXT).toBe(
      "Samma årsredovisning analyseras just nu – din analys blir klar samtidigt.",
    );
  });
});

describe("klarNotis", () => {
  it("visas bara för en återanvänd rapport", () => {
    expect(klarNotis({ ateranvand: true })?.text).toBe(ATERANVAND_TEXT);
    expect(ATERANVAND_TEXT).toBe(
      "Den här årsredovisningen var redan analyserad – din analys är klar direkt.",
    );
    expect(klarNotis({ ateranvand: false })).toBeUndefined();
    expect(klarNotis({})).toBeUndefined();
  });
});

describe("arSkannadRapport", () => {
  it("är sant bara för textlager 'saknas'", () => {
    expect(arSkannadRapport({ textlager: "saknas" })).toBe(true);
    expect(arSkannadRapport({ textlager: "trasigt" })).toBe(false);
    expect(arSkannadRapport({ textlager: "ok" })).toBe(false);
    expect(arSkannadRapport({})).toBe(false);
  });
});
