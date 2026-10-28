import { describe, expect, it } from "vitest";
import {
  KALKYL_UNDERLAG_VERSION,
  KalkylSammanfattningSchema,
  KalkylUnderlagInSchema,
  tolkaKalkylUnderlag,
} from "./underlag";

/** A real version-1 shape as stored in `sparad_kalkyl.input` / 24 h drafts before 2026-10-28. */
const V1 = {
  version: 1,
  lanebelopp: 3_960_000,
  kontantinsats: 990_000,
  rantaProcent: 3.6,
  manadsavgift: 3_240,
  boarea: 58,
  avgiftInkluderar: { varme: "ja", vatten: "okant", el: "nej", bredband: "okant", tv: "ja" },
  antalLantagare: 2,
  inkomst1: 540_000,
  inkomst2: 420_000,
  antalPersoner: 3,
  antalVuxna: 2,
  barn: ["4-6"],
  rantestressPp: 1.5,
  rantekanslighetProcent: 8.4,
  kalkylrantaProcent: 7,
  egnaKostnader: { varme: 1_200 },
  kalla: { pris: 4_950_000, prisArUppskattning: true },
} as const;

describe("tolkaKalkylUnderlag: version 1 migreras", () => {
  it("version är 2", () => {
    expect(KALKYL_UNDERLAG_VERSION).toBe(2);
  });

  it("pris = lånebelopp + kontantinsats, okant blir nej, övriga fält 1:1", () => {
    const u = tolkaKalkylUnderlag(V1);
    expect(u).not.toBeNull();
    expect(u).toEqual({
      version: 2,
      pris: 4_950_000,
      kontantinsats: 990_000,
      rantaProcent: 3.6,
      manadsavgift: 3_240,
      boarea: 58,
      avgiftInkluderar: { varme: "ja", vatten: "nej", el: "nej", bredband: "nej", tv: "ja" },
      antalLantagare: 2,
      inkomst1: 540_000,
      inkomst2: 420_000,
      antalPersoner: 3,
      antalVuxna: 2,
      barn: ["4-6"],
      rantestressPp: 1.5,
      rantekanslighetProcent: 8.4,
      kalkylrantaProcent: 7,
      egnaKostnader: { varme: 1_200 },
      kalla: { pris: 4_950_000, prisArUppskattning: true },
    });
  });

  it("bara lånebelopp: priset går inte att härleda, så pris blir tomt och lånebeloppet släpps", () => {
    const { kontantinsats: _k, ...utanInsats } = V1;
    const u = tolkaKalkylUnderlag(utanInsats);
    expect(u).not.toBeNull();
    expect(u?.pris).toBeUndefined();
    expect(u?.kontantinsats).toBeUndefined();
    expect(u).not.toHaveProperty("lanebelopp");
    expect(u?.manadsavgift).toBe(3_240);
  });

  it("bara kontantinsats behålls, pris tomt", () => {
    const { lanebelopp: _l, ...utanLan } = V1;
    const u = tolkaKalkylUnderlag(utanLan);
    expect(u?.pris).toBeUndefined();
    expect(u?.kontantinsats).toBe(990_000);
  });

  it("ett nästan tomt version-1-underlag (som en nyss öppnad kalkyl) migreras också", () => {
    const u = tolkaKalkylUnderlag({
      version: 1,
      avgiftInkluderar: { varme: "ja", vatten: "ja", el: "okant", bredband: "okant", tv: "okant" },
      antalLantagare: 2,
      antalPersoner: 2,
      antalVuxna: 2,
      barn: [],
      rantestressPp: 0,
      kalkylrantaProcent: 7,
      egnaKostnader: {},
    });
    expect(u?.avgiftInkluderar).toEqual({
      varme: "ja",
      vatten: "ja",
      el: "nej",
      bredband: "nej",
      tv: "nej",
    });
  });

  it("version 2 läses oförändrat; okant i version 2 och okända fält avvisas", () => {
    const v2 = tolkaKalkylUnderlag(V1)!;
    expect(tolkaKalkylUnderlag(v2)).toEqual(v2);
    expect(
      tolkaKalkylUnderlag({ ...v2, avgiftInkluderar: { ...v2.avgiftInkluderar, el: "okant" } }),
    ).toBeNull();
    expect(tolkaKalkylUnderlag({ ...v2, lanebelopp: 1 })).toBeNull();
    expect(tolkaKalkylUnderlag({ ...V1, extra: 1 })).toBeNull();
    expect(tolkaKalkylUnderlag({ ...V1, version: 3 })).toBeNull();
    expect(tolkaKalkylUnderlag(null)).toBeNull();
  });

  it("utkast-schemat (KalkylUnderlagInSchema) migrerar version 1 och avvisar skräp", () => {
    expect(KalkylUnderlagInSchema.safeParse(V1).success).toBe(true);
    expect(KalkylUnderlagInSchema.safeParse({ version: 1 }).success).toBe(false);
  });
});

describe("KalkylSammanfattningSchema", () => {
  it("läser en gammal sammanfattning med totalPerManadHog och en ny utan", () => {
    const bas = {
      totalPerManad: 18_450,
      belaningsgradProcent: 80,
      amorteringstaktProcent: 2,
      kvarAttLevaPaKalp: 1_000,
    };
    expect(KalkylSammanfattningSchema.safeParse({ ...bas, totalPerManadHog: 20_745 }).success).toBe(
      true,
    );
    expect(KalkylSammanfattningSchema.safeParse(bas).success).toBe(true);
  });
});
