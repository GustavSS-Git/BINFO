import { describe, expect, it } from "vitest";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import { avrundaVardering, visatVarde } from "@/lib/analysisView";
import { BETYG_TITEL } from "@/lib/betygVy";
import { formatMkr, formatSpannMkr } from "@/lib/prisVy";
import { byggStartExempel } from "@/lib/startExempel";

describe("byggStartExempel", () => {
  const e = byggStartExempel(sampleAnalysis);
  const visat = visatVarde(sampleAnalysis.prisanalys);

  it("tar namn, område, rum och boarea från exempelanalysen", () => {
    expect(e.undertext).toBe(
      `${sampleAnalysis.forening.namn}, ${sampleAnalysis.prisanalys.varderingsunderlag?.omrade} · ${sampleAnalysis.input.antalRum} rok · ${sampleAnalysis.input.boarea} m²`,
    );
  });

  it("betyg, titel och mening kommer från analysen", () => {
    expect(e.forening.betyg).toBe(sampleAnalysis.betyg);
    expect(e.forening.titel).toBe(BETYG_TITEL[sampleAnalysis.betyg]);
    expect(e.forening.text.length).toBeGreaterThan(10);
    expect(sampleAnalysis.betygMotivering.startsWith(e.forening.text.replace(/…$/, ""))).toBe(true);
  });

  it("värdering och spann följer den visade värderingen", () => {
    expect(visat).not.toBeNull();
    expect(e.vardering.varde).toBe(`ca ${formatMkr(avrundaVardering(visat!.exakt))}`);
    expect(e.vardering.spann).toBe(`Spann ${formatSpannMkr(visat!.exakt)}`);
    expect(e.vardering.text).toMatch(
      /^Utgångspriset \d,\d\d mkr ligger (under|inom|över) spannet\.$/,
    );
  });

  it("avgiften framåt kommer från avgiftsprognosen", () => {
    const total = sampleAnalysis.avgiftsprognos?.totalKrPerManad;
    expect(total).toBeTypeOf("number");
    const dagens = sampleAnalysis.rantestress.nuvarandeManadsavgift.value!;
    expect(e.avgift.varde.replace(/\s/g, " ")).toContain(
      Math.round(Math.abs(total!)).toLocaleString("sv-SE"),
    );
    expect(e.avgift.rad).toContain(Math.round(dagens + total!).toLocaleString("sv-SE"));
    expect(e.avgift.text).toBe(
      total! > 0 ? "Väntad höjning inom två år." : "Väntad sänkning inom två år.",
    );
  });

  it("tre nyckeltal med lagrad status", () => {
    expect(e.nyckeltal.map((r) => r.etikett)).toEqual([
      "Sparande per m²",
      "Skuld per m² bostadsrättsyta",
      "Räntekänslighet",
    ]);
    const sparande = sampleAnalysis.forening.keyFigures.find(
      (k) => k.id === "sparande_per_m2_totalyta",
    )!;
    expect(e.nyckeltal[0]?.status).toBe(sparande.status);
    expect(e.nyckeltal[0]?.varde).toContain(String(sparande.figure.value));
  });

  it("utan utgångspris och prognos finns inga påhittade rader", () => {
    const utan = {
      ...sampleAnalysis,
      prisanalys: { ...sampleAnalysis.prisanalys, utgangspris: undefined },
      avgiftsprognos: undefined,
    } as unknown as typeof sampleAnalysis;
    const x = byggStartExempel(utan);
    expect(x.vardering.text).toBeNull();
    expect(x.avgift.rad).toBeNull();
    expect(x.avgift.varde).toBe("Kan inte uppskattas");
  });
});
