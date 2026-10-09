import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ALLA_NYCKELTAL } from "./prompts";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/answer-key");
const filer = readdirSync(dir).filter((f) => f.endsWith(".json"));
interface Facit {
  orgnr: string;
  kalla: { fil: string; verifieradMot: string };
  nyckeltal: Record<string, unknown>;
  lanebok?: { totalSkuld?: number };
  obsolet?: boolean;
  ersattAv?: string;
  nyckeltalUtkast?: boolean;
  ovrigInfoVerifierad?: boolean;
}
const fixtures = filer.map((f) => ({
  fil: f,
  data: JSON.parse(readFileSync(path.join(dir, f), "utf-8")) as Facit,
}));
const aktiva = fixtures.filter((f) => !f.data.obsolet);

describe("fixtures/answer-key", () => {
  it("varje aktiv fixture heter som sitt orgnr och har kalla.fil", () => {
    for (const { fil, data } of aktiva) {
      expect(fil, fil).toBe(`${data.orgnr}.json`);
      expect(typeof data.kalla.fil, fil).toBe("string");
    }
  });

  it("nyckeltalsvärden är tal, null (finns inte i rapporten) eller { tecken }", () => {
    const ids = new Set(ALLA_NYCKELTAL.map((n) => n.id as string));
    for (const { fil, data } of aktiva) {
      for (const [id, v] of Object.entries(data.nyckeltal)) {
        expect(ids.has(id), `${fil}: ${id}`).toBe(true);
        const ok =
          typeof v === "number" ||
          v === null ||
          (typeof v === "object" &&
            ["negativ", "positiv"].includes(String((v as { tecken?: string }).tecken)));
        expect(ok, `${fil}: ${id}`).toBe(true);
      }
    }
  });

  it("utkast markeras med UTKAST i kalla.verifieradMot (hela filen) eller nyckeltalUtkast (bara nyckeltalen)", () => {
    for (const orgnr of ["769635-9905", "769607-2912", "724000-0161"]) {
      const f = aktiva.find((x) => x.data.orgnr === orgnr);
      expect(f, orgnr).toBeDefined();
      expect(String(f!.data.kalla.verifieradMot).toUpperCase()).toContain("UTKAST");
      expect(Object.keys(f!.data.nyckeltal).sort()).toEqual(
        ALLA_NYCKELTAL.map((n) => n.id as string).sort(),
      );
    }
    const test = aktiva.find((x) => x.data.orgnr === "769624-6953")!;
    expect(test.data.nyckeltalUtkast).toBe(true);
    // Resten av filen är verifierad av ägaren: hela filen är inte ett utkast.
    expect(String(test.data.kalla.verifieradMot).startsWith("Verifierad av ägaren")).toBe(true);
    expect(Object.keys(test.data.nyckeltal)).toHaveLength(7);
    expect(test.data.ovrigInfoVerifierad).toBe(true);
  });

  it("Zederslundshus: otydlig skuldbas → totalyta-fältet är null, bostadsrättsyta-fältet har värdet", () => {
    const f = aktiva.find((x) => x.data.orgnr === "724000-0161")!;
    expect(f.data.nyckeltal["skuldsattning_per_m2_totalyta"]).toBeNull();
    expect(f.data.nyckeltal["skuldsattning_per_m2_brf_yta"]).toBe(3089);
    expect(f.data.lanebok?.totalSkuld).toBe(7_706_397);
  });
});
