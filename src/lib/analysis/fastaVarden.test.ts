import { describe, expect, it } from "vitest";
import type { ExtractionResult, Figure } from "@/types/analysis";
import { extraktion } from "./__fixtures__/extraktion";
import { beraknaFastaVarden, formateraFastaVarden, formateraTal } from "./fastaVarden";

const kr = (value: number | null): Figure => ({ value, unit: "kr", source: "arsredovisning" });
const procent = (value: number): Figure => ({ value, unit: "procent", source: "arsredovisning" });

function medLanebok(lanebok: ExtractionResult["forening"]["lanebok"]): ExtractionResult {
  const kopia = structuredClone(extraktion) as ExtractionResult;
  if (lanebok === undefined) delete kopia.forening.lanebok;
  else kopia.forening.lanebok = lanebok;
  return kopia;
}

describe("beraknaFastaVarden", () => {
  it("copies the seven key figures verbatim with their status", () => {
    const fasta = beraknaFastaVarden(extraktion);
    expect(fasta.nyckeltal).toHaveLength(7);
    const kf = extraktion.forening.keyFigures;
    fasta.nyckeltal.forEach((n, i) => {
      expect(n).toEqual({
        id: kf[i]!.id,
        label: kf[i]!.label,
        value: kf[i]!.figure.value,
        unit: kf[i]!.figure.unit,
        status: kf[i]!.status,
      });
    });
    // The fixture has one missing figure: it stays null, never a guess.
    expect(fasta.nyckeltal.some((n) => n.value === null)).toBe(true);
  });

  it("carries the allowed letters and the status counts", () => {
    const fasta = beraknaFastaVarden(extraktion);
    expect(fasta.antalSvaga + fasta.antalKritiska).toBeGreaterThan(0);
    expect(fasta.tillatnaBetyg.length).toBeGreaterThan(0);
  });

  it("computes each maturity row's share of the total, one decimal (the 74 % case)", () => {
    const fasta = beraknaFastaVarden(
      medLanebok({
        totalSkuld: kr(7_759_091),
        forfalloprofil: [
          { ar: 2026, belopp: kr(5_759_091), ranta: procent(1.1) },
          { ar: 2029, belopp: kr(2_000_000) },
        ],
        snittranta: procent(1.98),
      }),
    );
    expect(fasta.lan?.totalSkuld).toBe(7_759_091);
    expect(fasta.lan?.forfallo).toEqual([
      { ar: 2026, belopp: 5_759_091, andelProcent: 74.2, ranta: { value: 1.1, unit: "procent" } },
      { ar: 2029, belopp: 2_000_000, andelProcent: 25.8 },
    ]);
    expect(fasta.lan?.snittranta).toEqual({ value: 1.98, unit: "procent" });
  });

  it("sums several loans in the same year and accumulates over the years", () => {
    const fasta = beraknaFastaVarden(
      medLanebok({
        totalSkuld: kr(10_000_000),
        forfalloprofil: [
          { ar: 2027, belopp: kr(1_000_000) },
          { ar: 2026, belopp: kr(2_000_000) },
          { ar: 2026, belopp: kr(1_500_000) },
        ],
      }),
    );
    expect(fasta.lan?.perAr).toEqual([
      { ar: 2026, belopp: 3_500_000, andelProcent: 35 },
      { ar: 2027, belopp: 1_000_000, andelProcent: 10 },
    ]);
    expect(fasta.lan?.kumulativt).toEqual([
      { tillOchMedAr: 2026, belopp: 3_500_000, andelProcent: 35 },
      { tillOchMedAr: 2027, belopp: 4_500_000, andelProcent: 45 },
    ]);
  });

  it("skips rows without an amount and gives no shares without a total", () => {
    const utanBelopp = beraknaFastaVarden(
      medLanebok({
        totalSkuld: kr(4_000_000),
        forfalloprofil: [
          { ar: 2026, belopp: kr(null) },
          { ar: 2028, belopp: kr(1_000_000) },
        ],
      }),
    );
    expect(utanBelopp.lan?.forfallo.map((f) => f.ar)).toEqual([2028]);

    const utanTotal = beraknaFastaVarden(
      medLanebok({ totalSkuld: kr(null), forfalloprofil: [{ ar: 2026, belopp: kr(1_000_000) }] }),
    );
    expect(utanTotal.lan).toBeUndefined();
    expect(beraknaFastaVarden(medLanebok(undefined)).lan).toBeUndefined();
  });

  it("a debt-free association has total 0 and no shares (no division by zero)", () => {
    const fasta = beraknaFastaVarden(
      medLanebok({ totalSkuld: kr(0), forfalloprofil: [{ ar: 2026, belopp: kr(100) }] }),
    );
    expect(fasta.lan).toEqual({ totalSkuld: 0, forfallo: [], perAr: [], kumulativt: [] });
  });
});

describe("formateraFastaVarden", () => {
  it("renders Swedish numbers and the allowed grades", () => {
    const text = formateraFastaVarden(
      beraknaFastaVarden(
        medLanebok({
          totalSkuld: kr(7_759_091),
          forfalloprofil: [{ ar: 2026, belopp: kr(5_759_091), ranta: procent(1.1) }],
        }),
      ),
    );
    expect(text).toContain("Tillåtna betyg:");
    expect(text).toContain("7 759 091 kr");
    expect(text).toContain("2026: 5 759 091 kr (74,2 % av totala skulden), ränta 1,1 %");
    expect(text).toContain("saknas i rapporten");
  });

  it("formateraTal uses a decimal comma and spaces for thousands", () => {
    expect(formateraTal(5759091)).toBe("5 759 091");
    expect(formateraTal(74.2)).toBe("74,2");
    expect(formateraTal(-1200)).toBe("-1 200");
    expect(formateraTal(0)).toBe("0");
  });
});
