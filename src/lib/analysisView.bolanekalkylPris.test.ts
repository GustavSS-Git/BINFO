import { describe, expect, it } from "vitest";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import { avrundaVardering, bolanekalkylPris } from "@/lib/analysisView";
import type { Prisanalys } from "@/types/analysis";

describe("bolanekalkylPris", () => {
  it("passes the SHOWN value: adjusted if present, rounded to 10 000", () => {
    const p = sampleAnalysis.prisanalys;
    const visat = p.justeradVardering?.value ?? p.externVardering?.value;
    expect(visat).toBeDefined();
    expect(bolanekalkylPris(p)).toBe(avrundaVardering(visat as number));
    expect((bolanekalkylPris(p) as number) % 10_000).toBe(0);
  });

  it("uses the baseline, rounded, when there is no adjusted value", () => {
    const { justeradVardering: _j, ...utanJusterad }: Prisanalys = sampleAnalysis.prisanalys;
    expect(
      bolanekalkylPris({
        ...utanJusterad,
        externVardering: { ...sampleAnalysis.prisanalys.externVardering!, value: 5_681_607 },
      }),
    ).toBe(5_680_000);
  });

  it("prefers the adjusted value over the baseline", () => {
    const bas = sampleAnalysis.prisanalys.externVardering!;
    expect(
      bolanekalkylPris({
        ...sampleAnalysis.prisanalys,
        externVardering: { ...bas, value: 5_681_607 },
        justeradVardering: { value: 5_565_157, unit: "kr", source: "schablon" },
      }),
    ).toBe(5_570_000);
  });

  it("faller tillbaka på utgångspriset utan värdering", () => {
    const {
      externVardering: _e,
      justeradVardering: _j,
      ...utanVardering
    }: Prisanalys = sampleAnalysis.prisanalys;
    expect(bolanekalkylPris(utanVardering)).toBe(sampleAnalysis.prisanalys.utgangspris?.value);
  });

  it("ger undefined (ingen krasch) när varken värdering eller pris finns", () => {
    const {
      externVardering: _e,
      justeradVardering: _j,
      utgangspris: _u,
      prisPerM2: _p,
      ...tom
    }: Prisanalys = sampleAnalysis.prisanalys;
    expect(bolanekalkylPris(tom)).toBeUndefined();
  });
});
