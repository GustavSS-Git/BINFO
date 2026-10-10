import { describe, expect, it } from "vitest";
import {
  ALLA_FORMAGOR,
  STANDARD_POLICY,
  SaknarBehorighetError,
  harBehorighet,
  kravBehorighet,
  skapaBehorighet,
  type Policy,
} from "./behorighet";
import type { Kontext } from "./kontext";

const kontext: Kontext = { enhetId: "a".repeat(22), principalId: null, ipHash: null };

describe("behörighet", () => {
  it("standardpolicyn ger alla alla förmågor i dag", async () => {
    for (const formaga of ALLA_FORMAGOR) {
      expect(await harBehorighet(kontext, formaga)).toBe(true);
      expect(await harBehorighet(kontext, formaga, { rapportId: "r1" })).toBe(true);
      await expect(kravBehorighet(kontext, formaga)).resolves.toBeUndefined();
    }
  });

  it("policytabellen täcker exakt de fyra förmågorna", () => {
    expect(Object.keys(STANDARD_POLICY).sort()).toEqual([...ALLA_FORMAGOR].sort());
  });

  it("en injicerad nekande policy får kravBehorighet att kasta SaknarBehorighetError", async () => {
    const neka: Policy = { ...STANDARD_POLICY, full_rapport: () => false };
    const b = skapaBehorighet(neka);

    expect(await b.harBehorighet(kontext, "full_rapport")).toBe(false);
    expect(await b.harBehorighet(kontext, "prisuppskattning")).toBe(true);

    const fel = await b.kravBehorighet(kontext, "full_rapport").catch((e: unknown) => e);
    expect(fel).toBeInstanceOf(SaknarBehorighetError);
    expect((fel as SaknarBehorighetError).formaga).toBe("full_rapport");
    expect((fel as SaknarBehorighetError).message).toMatch(/tillgång/);
  });

  it("skickar rapportId vidare till regeln", async () => {
    const sedda: Array<string | undefined> = [];
    const b = skapaBehorighet({
      ...STANDARD_POLICY,
      full_rapport: ({ rapportId }) => {
        sedda.push(rapportId);
        return rapportId === "kopt";
      },
    });
    expect(await b.harBehorighet(kontext, "full_rapport", { rapportId: "kopt" })).toBe(true);
    expect(await b.harBehorighet(kontext, "full_rapport", { rapportId: "annan" })).toBe(false);
    expect(await b.harBehorighet(kontext, "full_rapport")).toBe(false);
    expect(sedda).toEqual(["kopt", "annan", undefined]);
  });

  it("en regel som kastar beviljar inte (fail closed)", async () => {
    const b = skapaBehorighet({
      ...STANDARD_POLICY,
      pdf_export: () => {
        throw new Error("db nere");
      },
    });
    await expect(b.harBehorighet(kontext, "pdf_export")).rejects.toThrow("db nere");
    await expect(b.kravBehorighet(kontext, "pdf_export")).rejects.toThrow("db nere");
  });
});
