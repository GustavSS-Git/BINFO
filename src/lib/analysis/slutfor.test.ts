import { describe, expect, it } from "vitest";
import { extraktion } from "./__fixtures__/extraktion";
import {
  SKANNAD_KONFIDENS_SKAL,
  slutforAnalys,
  slutforBedomning,
  slutforExtraktion,
} from "./slutfor";

const ctx = { pdfSaknarTextlager: false, kalla: "textlager" as const };
const rå = () => structuredClone(extraktion) as unknown as Record<string, unknown>;

const bedomning = {
  betyg: "C",
  betygMotivering: "Motivering.",
  rodaFlaggor: [],
  fragor: [],
};

describe("slutforExtraktion", () => {
  it("validerar, graderar och returnerar utan att röra indata", () => {
    const indata = rå();
    const kopia = structuredClone(indata);
    const r = slutforExtraktion(indata, ctx);
    expect(r.ok).toBe(true);
    expect(indata).toEqual(kopia);
  });

  it("tar bort modellens egna osaker-markeringar och skriver över datakvalitet.kalla", () => {
    const indata = rå() as { forening: { keyFigures: Array<{ figure: Record<string, unknown> }> } };
    indata.forening.keyFigures[0]!.figure["osaker"] = "modellen tycker så";
    const r = slutforExtraktion(indata, { ...ctx, kalla: "skannad", pdfSaknarTextlager: true });
    if (!r.ok) throw new Error("ogiltig");
    expect(r.value.extraction.forening.keyFigures[0]!.figure.osaker).toBeUndefined();
    expect(r.value.extraction.datakvalitet.kalla).toBe("skannad");
    expect(r.value.extraction.datakvalitet.extraktionKonfidens.skal).toContain(
      SKANNAD_KONFIDENS_SKAL,
    );
  });

  it("returnerar ett valideringsfel i stället för att kasta", () => {
    const r = slutforExtraktion({ forening: {} }, ctx);
    expect(r.ok).toBe(false);
  });

  it("kontrollerar sidhänvisningarna när sidtexter ges", () => {
    const sidtexter = new Map([[1, "en helt annan sida som inte innehåller något av citaten"]]);
    const r = slutforExtraktion(rå(), { ...ctx, sidtexter });
    if (!r.ok) throw new Error("ogiltig");
    expect(r.value.sidreferenser.length).toBeGreaterThan(0);
    expect(r.value.extraction.datakvalitet.extraktionKonfidens.niva).not.toBe("hog");
  });
});

describe("slutforBedomning / slutforAnalys", () => {
  it("avvisar en sida som inte finns i extraktionen", () => {
    const fel = {
      ...bedomning,
      rodaFlaggor: [] as unknown[],
      fragor: [
        {
          id: "f",
          fraga: "?",
          ursprung: "analys",
          riktadTill: "styrelsen",
          varfor: "v",
          ref: { page: 99, excerpt: "x" },
        },
      ],
    };
    expect(slutforBedomning(extraktion, fel).ok).toBe(false);
    expect(slutforBedomning(extraktion, bedomning).ok).toBe(true);
  });

  it("slutforAnalys kör båda halvorna och anger vilket steg som föll", () => {
    expect(slutforAnalys(rå(), bedomning, ctx).ok).toBe(true);
    expect(slutforAnalys({}, bedomning, ctx)).toMatchObject({ ok: false, steg: "extraktion" });
    expect(slutforAnalys(rå(), { betyg: "Z" }, ctx)).toMatchObject({
      ok: false,
      steg: "bedomning",
    });
  });
});
