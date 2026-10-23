import { describe, expect, it } from "vitest";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import { bolanekalkylPris } from "@/lib/analysisView";
import type { Prisanalys } from "@/types/analysis";

describe("bolanekalkylPris", () => {
  it("föredrar värderingen framför utgångspriset", () => {
    expect(bolanekalkylPris(sampleAnalysis.prisanalys)).toBe(
      sampleAnalysis.prisanalys.externVardering?.value,
    );
  });

  it("faller tillbaka på utgångspriset utan värdering", () => {
    const { externVardering: _e, ...utanVardering }: Prisanalys = sampleAnalysis.prisanalys;
    expect(bolanekalkylPris(utanVardering)).toBe(sampleAnalysis.prisanalys.utgangspris?.value);
  });

  it("ger undefined (ingen krasch) när varken värdering eller pris finns", () => {
    const {
      externVardering: _e,
      utgangspris: _u,
      prisPerM2: _p,
      ...tom
    }: Prisanalys = sampleAnalysis.prisanalys;
    expect(bolanekalkylPris(tom)).toBeUndefined();
  });
});
