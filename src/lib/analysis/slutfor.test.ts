import { describe, expect, it, vi } from "vitest";
import { extraktion } from "./__fixtures__/extraktion";
import type { ExtractionResult, Grade, Status } from "@/types/analysis";
import {
  klampaBetyg,
  raknaStatusar,
  SKANNAD_KONFIDENS_SKAL,
  slutforAnalys,
  slutforBedomning,
  slutforExtraktion,
  tillatnaBetyg,
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

/** The fixture extraction with its key figures given these statuses (in order; the rest stay "okant"). */
function medStatusar(statusar: Status[]): ExtractionResult {
  const kopia = structuredClone(extraktion) as ExtractionResult;
  kopia.forening.keyFigures.forEach((kf, i) => {
    kf.status = statusar[i] ?? "okant";
  });
  return kopia;
}

describe("tillatnaBetyg", () => {
  it("allows A-C without kritisk, C-E with at least one kritisk", () => {
    expect(tillatnaBetyg({ svag: 0, kritisk: 0 })).toEqual(["A", "B", "C"]);
    expect(tillatnaBetyg({ svag: 2, kritisk: 0 })).toEqual(["A", "B", "C"]);
    expect(tillatnaBetyg({ svag: 0, kritisk: 1 })).toEqual(["C", "D", "E"]);
    expect(tillatnaBetyg({ svag: 3, kritisk: 2 })).toEqual(["C", "D", "E"]);
  });
});

describe("raknaStatusar", () => {
  it("counts svag and kritisk of the key figures, ignoring the rest", () => {
    const e = medStatusar(["god", "svag", "svag", "kritisk", "okant", "acceptabel", "god"]);
    expect(raknaStatusar(e)).toEqual({ svag: 2, kritisk: 1 });
    expect(raknaStatusar(medStatusar([]))).toEqual({ svag: 0, kritisk: 0 });
  });
});

describe("klampaBetyg", () => {
  const utanKritisk = tillatnaBetyg({ svag: 1, kritisk: 0 });
  const medKritisk = tillatnaBetyg({ svag: 1, kritisk: 1 });

  it("clamps D and E to C without kritisk", () => {
    expect(klampaBetyg("D", utanKritisk)).toBe("C");
    expect(klampaBetyg("E", utanKritisk)).toBe("C");
  });

  it("clamps A and B to C with kritisk", () => {
    expect(klampaBetyg("A", medKritisk)).toBe("C");
    expect(klampaBetyg("B", medKritisk)).toBe("C");
  });

  it("leaves letters inside the set untouched", () => {
    for (const g of ["A", "B", "C"] as Grade[]) expect(klampaBetyg(g, utanKritisk)).toBe(g);
    for (const g of ["C", "D", "E"] as Grade[]) expect(klampaBetyg(g, medKritisk)).toBe(g);
  });
});

describe("slutforBedomning: deterministic grade check", () => {
  const med = (betyg: string) => ({ ...bedomning, betyg });

  it("clamps an impossible letter, returns ok and logs once with the context", () => {
    const loggar: unknown[][] = [];
    const e = medStatusar(["svag", "svag", "god"]);
    const r = slutforBedomning(e, med("E"), (...args) => loggar.push(args));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("ogiltig");
    expect(r.value.betyg).toBe("C");
    expect(r.value.betygMotivering).toBe("Motivering.");
    expect(loggar).toHaveLength(1);
    const rad = JSON.stringify(loggar[0]);
    expect(rad).toContain("E");
    expect(rad).toContain("C");
    expect(rad).toContain("Brf Kastanjen");
    expect(rad).toContain("769612-3456");
    expect(rad).toContain('"svag":2');
    expect(rad).toContain('"kritisk":0');
  });

  it("clamps A with a kritisk figure", () => {
    const loggar: unknown[][] = [];
    const e = medStatusar(["kritisk", "god"]);
    const r = slutforBedomning(e, med("A"), (...args) => loggar.push(args));
    if (!r.ok) throw new Error("ogiltig");
    expect(r.value.betyg).toBe("C");
    expect(loggar).toHaveLength(1);
  });

  it("does not log or change a letter inside the set", () => {
    const loggar: unknown[][] = [];
    const e = medStatusar(["kritisk"]);
    const r = slutforBedomning(e, med("D"), (...args) => loggar.push(args));
    if (!r.ok) throw new Error("ogiltig");
    expect(r.value.betyg).toBe("D");
    expect(loggar).toHaveLength(0);
  });

  it("still fails on a Zod error, without logging", () => {
    const loggar: unknown[][] = [];
    const r = slutforBedomning(medStatusar([]), med("Z"), (...args) => loggar.push(args));
    expect(r.ok).toBe(false);
    expect(loggar).toHaveLength(0);
  });

  it("slutforAnalys applies the check through its composition", () => {
    // The fixture graded by berikaNyckeltal may or may not contain kritisk;
    // either way the result must be inside the allowed set.
    const varna = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = slutforAnalys(rå(), med("E"), ctx);
    varna.mockRestore();
    if (!r.ok) throw new Error("ogiltig");
    const tillatna = tillatnaBetyg(raknaStatusar(r.value.extraction));
    expect(tillatna).toContain(r.value.judgement.betyg);
  });
});
