import { describe, expect, it } from "vitest";
import { rantestressScenario } from "./rantestress";

describe("rantestressScenario", () => {
  // Rantekänslighet är redan den statutory nyckeltalet "hur många procent
  // avgiften måste höjas per procentenhet högre ränta" — funktionen ska
  // konsumera det talet direkt, inte räkna om skuld/avgiftsintäkt själv.
  // (Ingen räntebärande skuld eller avgiftsintäkt förekommer som argument.)
  const nuvarandeManadsavgift = 3_240;
  const rantekanslighetProcent = 12.7;

  it("ger oförändrad avgift vid 0 procentenheters ökning", () => {
    const s = rantestressScenario(nuvarandeManadsavgift, rantekanslighetProcent, 0);
    expect(s.nyManadsavgift).toBe(3_240);
    expect(s.avgiftsokningKrPerManad).toBe(0);
  });

  it("höjer avgiften med rantekänslighet % vid +1 procentenhet", () => {
    const s = rantestressScenario(nuvarandeManadsavgift, rantekanslighetProcent, 1);
    expect(s.nyManadsavgift).toBe(3_651);
    expect(s.avgiftsokningKrPerManad).toBe(411);
  });

  it("skalar linjärt med antal procentenheter vid +2", () => {
    const s = rantestressScenario(nuvarandeManadsavgift, rantekanslighetProcent, 2);
    expect(s.nyManadsavgift).toBe(4_063);
    expect(s.avgiftsokningKrPerManad).toBe(823);
  });

  it("skalar linjärt med antal procentenheter vid +3", () => {
    const s = rantestressScenario(nuvarandeManadsavgift, rantekanslighetProcent, 3);
    expect(s.nyManadsavgift).toBe(4_474);
    expect(s.avgiftsokningKrPerManad).toBe(1_234);
  });

  it("avrundar till hela kronor (inga decimaler)", () => {
    const s = rantestressScenario(1_000, 5.55, 1);
    expect(Number.isInteger(s.nyManadsavgift)).toBe(true);
    expect(Number.isInteger(s.avgiftsokningKrPerManad)).toBe(true);
  });
});
