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

describe("lån relativt balansdagen (PROMPT_VERSION 13)", () => {
  const lan = (
    belopp: number,
    dag: string | undefined,
    rantetyp: "rorlig" | "bunden" | "okant" = "okant",
  ) => ({
    belopp: kr(belopp),
    ranta: procent(2.5),
    ...(dag ? { villkorsandringsdag: dag } : {}),
    rantetyp,
    ref: { page: 9, excerpt: "lån" },
  });
  function medLan(lanLista: ReturnType<typeof lan>[], total: number, balansdag = "2025-12-31") {
    const e = medLanebok({ totalSkuld: kr(total), lan: lanLista });
    e.forening.balansdag = balansdag;
    return e;
  }

  it("bands loans by months after the balance date (2025-12-31)", () => {
    const fasta = beraknaFastaVarden(
      medLan(
        [
          lan(1_000_000, "2025-12-31"), // on the balance date
          lan(2_000_000, "2026-03-28"), // ≤ 12 months
          lan(2_000_000, "2026-12-31"), // exactly 12 months → in
          lan(3_000_000, "2027-06-30"), // 13–24
          lan(1_000_000, "2028-10-28"), // > 24
          lan(500_000, undefined), // no date
          lan(500_000, "2026-01-01", "rorlig"), // rörlig wins over date
        ],
        10_000_000,
      ),
    );
    expect(fasta.lan?.efterBalansdag).toEqual({
      balansdag: "2025-12-31",
      band: [
        { etikett: "vid eller före balansdagen", belopp: 1_000_000, andelProcent: 10, antalLan: 1 },
        {
          etikett: "inom 12 månader efter balansdagen",
          belopp: 4_000_000,
          andelProcent: 40,
          antalLan: 2,
        },
        {
          etikett: "13–24 månader efter balansdagen",
          belopp: 3_000_000,
          andelProcent: 30,
          antalLan: 1,
        },
        {
          etikett: "senare än 24 månader efter balansdagen",
          belopp: 1_000_000,
          andelProcent: 10,
          antalLan: 1,
        },
        { etikett: "rörlig ränta", belopp: 500_000, andelProcent: 5, antalLan: 1 },
        {
          etikett: "ingen villkorsändringsdag angiven",
          belopp: 500_000,
          andelProcent: 5,
          antalLan: 1,
        },
      ],
    });
  });

  it("renders the bands relative to the balance date, with no calendar-year ladder", () => {
    const text = formateraFastaVarden(
      beraknaFastaVarden(
        medLan([lan(2_000_000, "2026-03-28"), lan(1_000_000, "2028-10-28")], 3_000_000),
      ),
    );
    expect(text).toContain("räknade från balansdagen 2025-12-31 (inte från i dag");
    expect(text).toContain(
      "inom 12 månader efter balansdagen: 2 000 000 kr (66,7 % av totala skulden), 1 lån",
    );
    expect(text).not.toMatch(/\b2026: /);
    expect(text).not.toContain("Förfalloprofil");
  });

  it("without dated loan rows the year ladder stays, but is labelled as counted from the balance date", () => {
    const text = formateraFastaVarden(
      beraknaFastaVarden(
        medLanebok({
          totalSkuld: kr(7_759_091),
          forfalloprofil: [{ ar: 2026, belopp: kr(5_759_091) }],
        }),
      ),
    );
    expect(text).toContain("tiden räknas från balansdagen, inte från i dag");
    expect(text).toContain("2026: 5 759 091 kr (74,2 % av totala skulden)");
  });

  it("no dates at all → no bands", () => {
    expect(
      beraknaFastaVarden(medLan([lan(1_000_000, undefined)], 1_000_000)).lan?.efterBalansdag,
    ).toBeUndefined();
  });
});

describe("byggår vs värdeår i fasta värden", () => {
  const medByggar = (value: number | null, excerpt: string) => {
    const e = structuredClone(extraktion) as ExtractionResult;
    e.forening.byggar = {
      value,
      unit: "ar",
      source: "arsredovisning",
      ref: { page: 4, excerpt },
    };
    return beraknaFastaVarden(e);
  };
  it("a cited 'Värdeåret är 1931' is marked as värdeår, not byggår", () => {
    const fasta = medByggar(1931, "Värdeåret är 1931.");
    expect(fasta.byggar).toEqual({ value: 1931, arTyp: "varde" });
    const text = formateraFastaVarden(fasta);
    expect(text).toContain("Värdeår (INTE byggår): 1931");
    expect(text).toContain('"värdeår 1931"');
  });
  it("a construction year is stated plainly", () => {
    const fasta = medByggar(1965, "Byggnaden uppfördes 1965");
    expect(fasta.byggar).toEqual({ value: 1965, arTyp: "bygg" });
    expect(formateraFastaVarden(fasta)).toContain("Byggår: 1965.");
  });
  it("no value → nothing", () => {
    expect(medByggar(null, "x").byggar).toBeUndefined();
  });
});
