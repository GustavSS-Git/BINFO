import { describe, expect, it } from "vitest";
import { amorteringstakt } from "./amortering";

describe("amorteringstakt", () => {
  it("kräver ingen amortering under 50 % belåningsgrad", () => {
    expect(amorteringstakt(0)).toBe(0);
    expect(amorteringstakt(40)).toBe(0);
  });

  it("kräver ingen amortering vid exakt 50 % (gränsen är 'överstiger')", () => {
    expect(amorteringstakt(50)).toBe(0);
  });

  it("kräver 1 %/år strax över 50 %", () => {
    expect(amorteringstakt(50.01)).toBe(1);
  });

  it("kräver 1 %/år mellan 50 och 70 %", () => {
    expect(amorteringstakt(60)).toBe(1);
  });

  it("kräver 1 %/år vid exakt 70 %", () => {
    expect(amorteringstakt(70)).toBe(1);
  });

  it("kräver 2 %/år strax över 70 %", () => {
    expect(amorteringstakt(70.01)).toBe(2);
  });

  it("kräver 2 %/år över 70 % belåningsgrad", () => {
    expect(amorteringstakt(80)).toBe(2);
    expect(amorteringstakt(100)).toBe(2);
  });

  it("regression: det skärpta amorteringskravet (skuldkvot) är slopat — får aldrig ge 3", () => {
    // Lån 4 500 000 kr, bruttoinkomst 800 000 kr/år → skuldkvot 5,625x.
    // Under de gamla reglerna (till 31 mars 2026) hade detta triggat ett
    // extra procentenhet-krav ovanpå LTV-kravet. Det är abolished.
    // Funktionen tar inte ens skuldkvot som argument — bara belåningsgrad.
    const lan = 4_500_000;
    const bruttoinkomst = 800_000;
    const skuldkvot = lan / bruttoinkomst;
    expect(skuldkvot).toBeCloseTo(5.625);

    const belaningsgrad = 80; // %
    expect(amorteringstakt(belaningsgrad)).toBe(2);
  });
});
