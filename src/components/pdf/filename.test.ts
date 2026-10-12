import { describe, expect, it } from "vitest";
import { buildPdfFilename, slugify } from "@/components/pdf/filename";
import { sampleAnalysis } from "@/data/sampleAnalysis";

describe("slugify", () => {
  it("lowercases, transliterates å/ä/ö, and hyphenates", () => {
    expect(slugify("Brf Pontonjären 3")).toBe("brf-pontonjaren-3");
    expect(slugify("Brf Åkerbäret Östra")).toBe("brf-akerbaret-ostra");
  });

  it("strips accents not covered by the explicit map", () => {
    expect(slugify("Café Résumé")).toBe("cafe-resume");
  });

  it("collapses repeated separators and trims leading/trailing hyphens", () => {
    expect(slugify("  Brf   Solen!!  ")).toBe("brf-solen");
  });

  it("returns an empty string for a name with no sluggable characters", () => {
    expect(slugify("***")).toBe("");
  });
});

describe("buildPdfFilename", () => {
  it("builds binfo-analys-<slug>-<YYYY-MM-DD>.pdf from the sample analysis", () => {
    expect(buildPdfFilename(sampleAnalysis)).toBe("binfo-analys-brf-pontonjaren-3-2026-10-12.pdf");
  });

  it("falls back to 'analys' when the förening name has no sluggable characters", () => {
    const analys = { ...sampleAnalysis, forening: { ...sampleAnalysis.forening, namn: "!!!" } };
    expect(buildPdfFilename(analys)).toBe("binfo-analys-analys-2026-10-12.pdf");
  });

  it("dates the filename from skapad, not the current date", () => {
    const analys = { ...sampleAnalysis, skapad: "2020-01-05T10:00:00.000Z" };
    expect(buildPdfFilename(analys)).toBe("binfo-analys-brf-pontonjaren-3-2020-01-05.pdf");
  });
});
