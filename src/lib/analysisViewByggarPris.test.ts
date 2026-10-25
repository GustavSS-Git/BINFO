import { describe, expect, it } from "vitest";
import { byggarPrisNotis } from "@/lib/analysisView";
import type { Faltjamforelse } from "@/types/analysis";

const rad = (over: Partial<Faltjamforelse>): Faltjamforelse => ({
  falt: "byggar",
  label: "Byggår",
  status: "bekraftat",
  anvant: 2017,
  text: "",
  ...over,
});

describe("byggarPrisNotis", () => {
  it("avviker: säger att värderingen räknar med årsredovisningens år, med sida", () => {
    const n = byggarPrisNotis(
      rad({
        status: "avviker",
        anvandare: 1960,
        rapport: 2017,
        anvant: 2017,
        ref: { page: 4, excerpt: "Byggår 2017" },
      }),
    );
    expect(n).toEqual({
      text: "Värderingen räknar med byggår 2017 enligt årsredovisningen, inte 1960 som du angav.",
      sida: "s. 4",
    });
  });

  it("endast_rapport med använt år: ingen jämförelse, bara året", () => {
    expect(byggarPrisNotis(rad({ status: "endast_rapport", rapport: 2017, anvant: 2017 }))).toEqual(
      { text: "Värderingen räknar med byggår 2017 enligt årsredovisningen." },
    );
  });

  it("endast_rapport där året inte används (anvant null): ingen rad", () => {
    expect(
      byggarPrisNotis(rad({ status: "endast_rapport", rapport: 2017, anvant: null })),
    ).toBeUndefined();
  });

  it("osäkert: vi använder köparens år och spannet täcker båda", () => {
    expect(
      byggarPrisNotis(rad({ status: "osakert", anvandare: 1960, rapport: 2017, anvant: 1960 })),
    ).toEqual({
      text: "Du angav 1960, årsredovisningen anger 2017. Vi använder ditt år och spannet täcker båda.",
    });
  });

  it("bekräftat, manuellt, annat fält och ingen rad: ingen rad", () => {
    expect(byggarPrisNotis(rad({ status: "bekraftat", anvandare: 2017, rapport: 2017 }))).toBe(
      undefined,
    );
    expect(byggarPrisNotis(rad({ status: "manuellt", anvandare: 1960, anvant: 1960 }))).toBe(
      undefined,
    );
    expect(
      byggarPrisNotis(rad({ falt: "totalyta", status: "endast_rapport", rapport: 5000 })),
    ).toBe(undefined);
    expect(byggarPrisNotis(undefined)).toBeUndefined();
  });
});
