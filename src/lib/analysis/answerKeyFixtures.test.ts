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

  it("skannade rapporters nycklar och test_rapports nyckeltal är verifierade av ägaren (2026-10-10), inte utkast", () => {
    for (const orgnr of ["769635-9905", "769607-2912", "724000-0161", "769624-6953"]) {
      const f = aktiva.find((x) => x.data.orgnr === orgnr);
      expect(f, orgnr).toBeDefined();
      expect(String(f!.data.kalla.verifieradMot).toUpperCase()).not.toContain("UTKAST");
      expect(String(f!.data.kalla.verifieradMot).startsWith("Verifierad av ägaren")).toBe(true);
      expect(f!.data.nyckeltalUtkast).toBeUndefined();
      expect(Object.keys(f!.data.nyckeltal).sort()).toEqual(
        ALLA_NYCKELTAL.map((n) => n.id as string).sort(),
      );
    }
    const test = aktiva.find((x) => x.data.orgnr === "769624-6953")!;
    expect(test.data.ovrigInfoVerifierad).toBe(true);
  });

  it("Zederslundshus: otydlig skuldbas → totalyta-fältet är null, bostadsrättsyta-fältet har värdet", () => {
    const f = aktiva.find((x) => x.data.orgnr === "724000-0161")!;
    expect(f.data.nyckeltal["skuldsattning_per_m2_totalyta"]).toBeNull();
    expect(f.data.nyckeltal["skuldsattning_per_m2_brf_yta"]).toBe(3089);
    expect(f.data.lanebok?.totalSkuld).toBe(7_706_397);
  });
});

describe("fixtures/answer-key-lan", () => {
  const lanDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../fixtures/answer-key-lan",
  );
  const lanFiler = readdirSync(lanDir).filter((f) => f.endsWith(".json"));
  interface LanFacitFilTest {
    orgnr: string;
    status: string;
    kalla: { fil: string };
    balansdag: string;
    totalSkuld: { belopp: number };
    rantekostnader?: { belopp: number };
    lan: Array<{ belopp: number; ranta: number; villkorsandringsdag: string; sida: number }>;
  }
  const nycklar = lanFiler.map((f) => ({
    fil: f,
    data: JSON.parse(readFileSync(path.join(lanDir, f), "utf-8")) as LanFacitFilTest,
  }));

  it("finns för de tio rapporterna med lånenot och den skuldfria Göken 29", () => {
    expect(nycklar.map((n) => n.data.orgnr).sort()).toEqual([
      "702000-9960",
      "702002-5446",
      "716419-8579",
      "716420-0599",
      "716421-9722",
      "743000-3215",
      "746000-1865",
      "769603-2254",
      "769616-0253",
      "769616-3273",
      "769631-3761",
    ]);
  });

  it("varje nyckel heter som sitt orgnr, är markerad UTKAST och har ISO-datum", () => {
    for (const { fil, data } of nycklar) {
      expect(fil, fil).toBe(`${data.orgnr}.json`);
      expect(data.status, fil).toBe("UTKAST");
      expect(data.balansdag, fil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const l of data.lan) {
        expect(l.villkorsandringsdag, fil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(l.ranta, fil).toBeGreaterThan(0);
        expect(l.sida, fil).toBeGreaterThan(0);
      }
    }
  });

  it("lånen summerar till den tryckta totalen", () => {
    for (const { fil, data } of nycklar) {
      const summa = data.lan.reduce((s, l) => s + l.belopp, 0);
      expect(summa, fil).toBe(data.totalSkuld.belopp);
    }
  });

  it("de fem som har en nyckeltalsnyckel pekar på samma PDF", () => {
    for (const { data } of nycklar) {
      const nyckeltalsNyckel = fixtures.find((f) => f.data.orgnr === data.orgnr);
      if (nyckeltalsNyckel) expect(nyckeltalsNyckel.data.kalla.fil).toBe(data.kalla.fil);
    }
  });
});

describe("fixtures/answer-key-underhall", () => {
  const dir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../fixtures/answer-key-underhall",
  );
  interface UnderhallNyckel {
    orgnr: string;
    status: string;
    kalla: { fil: string };
    genomfordaAtgarder: Array<{ byggdel: string; ar: number; sida: number }>;
    tillatnaExtra?: Array<{ byggdel: string; ar: number }>;
  }
  const BYGGDELAR = ["stambyte", "tak", "fasad", "fonster", "ventilation", "el", "hiss"];
  const nycklar = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      fil: f,
      data: JSON.parse(readFileSync(path.join(dir, f), "utf-8")) as UnderhallNyckel,
    }));

  it("finns för nio rapporter, heter som sitt orgnr och är markerade UTKAST", () => {
    expect(nycklar).toHaveLength(9);
    for (const { fil, data } of nycklar) {
      expect(fil, fil).toBe(`${data.orgnr}.json`);
      expect(data.status, fil).toBe("UTKAST");
    }
  });

  it("åtgärderna har en av de sju byggdelarna, ett rimligt år och en sida, utan dubbletter", () => {
    for (const { fil, data } of nycklar) {
      const sett = new Set<string>();
      for (const a of [...data.genomfordaAtgarder, ...(data.tillatnaExtra ?? [])]) {
        expect(BYGGDELAR, fil).toContain(a.byggdel);
        expect(a.ar, fil).toBeGreaterThan(1900);
        expect(a.ar, fil).toBeLessThanOrEqual(2025);
        const k = `${a.byggdel} ${a.ar}`;
        expect(sett.has(k), `${fil}: ${k}`).toBe(false);
        sett.add(k);
      }
      for (const a of data.genomfordaAtgarder) expect(a.sida, fil).toBeGreaterThan(0);
    }
  });

  it("pekar på samma PDF som nyckeltals- och lånenyckeln för samma orgnr", () => {
    for (const { data } of nycklar) {
      const n = fixtures.find((f) => f.data.orgnr === data.orgnr);
      if (n) expect(n.data.kalla.fil).toBe(data.kalla.fil);
    }
  });
});
