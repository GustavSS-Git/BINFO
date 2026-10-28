import { describe, expect, it } from "vitest";
import { tolkaFalt, tolkaTal } from "./indata";
import {
  andraAvgift,
  andraFalt,
  arGiltigtUnderlag,
  avgiftFranSokning,
  kalpArAndrad,
  sidaFranSokning,
  sidaFranUnderlag,
  tomSida,
  underlagFranSida,
} from "./sida";
import { tolkaKalkylUnderlag } from "./underlag";

describe("tolkaTal", () => {
  it("godtar mellanslag, hårda mellanslag och komma", () => {
    expect(tolkaTal("3 960 000")).toEqual({ art: "tal", varde: 3_960_000 });
    expect(tolkaTal("3 960 000")).toEqual({ art: "tal", varde: 3_960_000 });
    expect(tolkaTal("3,65")).toEqual({ art: "tal", varde: 3.65 });
    expect(tolkaTal("3.65")).toEqual({ art: "tal", varde: 3.65 });
    expect(tolkaTal(",5")).toEqual({ art: "tal", varde: 0.5 });
  });
  it("tomt är tomt, aldrig 0", () => {
    expect(tolkaTal("")).toEqual({ art: "tom" });
    expect(tolkaTal("   ")).toEqual({ art: "tom" });
  });
  it("skräp och negativa tal ger fel, aldrig NaN", () => {
    for (const s of ["abc", "1,2,3", "3.960.000", "1e5", "Infinity", "NaN", "5 %"]) {
      expect(tolkaTal(s).art, s).toBe("ogiltigt");
    }
    expect(tolkaTal("-5")).toEqual({ art: "ogiltigt", fel: "Värdet kan inte vara negativt." });
  });
});

describe("tolkaFalt (rimlighetsgränser)", () => {
  it("rimlighetskontrollerar med felmeddelande", () => {
    expect(tolkaFalt("31", "ranta").art).toBe("fel");
    expect(tolkaFalt("3,6", "ranta")).toEqual({ art: "tal", varde: 3.6 });
    expect(tolkaFalt("0", "boarea").art).toBe("fel");
    expect(tolkaFalt("2,5", "antalVuxna").art).toBe("fel");
    expect(tolkaFalt("", "antalPersoner").art).toBe("tom"); // antal personer går att tömma
  });
});

describe("sida <-> underlag", () => {
  it("tom sida ger ett giltigt tomt underlag med kalkylränta 7", () => {
    const { underlag, fel } = underlagFranSida(tomSida());
    expect(fel).toEqual({});
    expect(arGiltigtUnderlag(underlag)).toBe(true);
    expect(underlag.kalkylrantaProcent).toBe(7);
    expect(underlag.pris).toBeUndefined();
    expect(underlag.antalVuxna).toBe(2); // = antal låntagare
    expect(underlag.antalPersoner).toBe(2);
  });

  it("tomt antal personer betyder vuxna + barn", () => {
    const { underlag } = underlagFranSida({
      ...tomSida(),
      antalVuxna: "2",
      barn: { ...tomSida().barn, "4-6": "2", "15-17": "1" },
    });
    expect(underlag.barn).toEqual(["4-6", "4-6", "15-17"]);
    expect(underlag.antalPersoner).toBe(5);
  });

  it("rundresa: underlag -> sida -> underlag ger samma underlag", () => {
    const { underlag } = underlagFranSida({
      ...tomSida(),
      pris: "4 950 000",
      kontantinsats: "990000",
      ranta: "3,65",
      manadsavgift: "3 240",
      boarea: "58,5",
      antalLantagare: "1",
      inkomst1: "540000",
      inkomst2: "420000",
      antalPersoner: "3",
      antalVuxna: "1",
      barn: { ...tomSida().barn, "0-3": "1", "11-14": "1" },
      rantestressPp: 1.5,
      kalkylranta: "6,5",
      rantekanslighetProcent: 8.4,
      egnaKostnader: { varme: 1200 },
      kalla: { pris: 4_950_000, prisArUppskattning: true },
    });
    expect(tolkaKalkylUnderlag(underlag)).not.toBeNull();
    const igen = underlagFranSida(sidaFranUnderlag(underlag));
    expect(igen.fel).toEqual({});
    expect(igen.underlag).toEqual(underlag);
  });

  it("ogiltiga fält ger fel per fält och räknas som tomma", () => {
    const { underlag, fel } = underlagFranSida({
      ...tomSida(),
      ranta: "99",
      boarea: "x",
      barn: { ...tomSida().barn, "4-6": "-1" },
    });
    expect(Object.keys(fel).sort()).toEqual(["barn:4-6", "boarea", "ranta"]);
    expect(underlag.rantaProcent).toBeUndefined();
    expect(underlag.barn).toEqual([]);
  });
});

const UTAN_SOK = {
  manadsavgift: undefined,
  rantekanslighet: undefined,
  pris: undefined,
  boarea: undefined,
  prisUppskattning: undefined,
  ingar: undefined,
  ingarEj: undefined,
} as const;

describe("sidaFranSokning (förifyllning)", () => {
  it("priset fyller prisfältet och kontantinsatsen är minsta tillåtna (10 %, uppåt)", () => {
    const s = sidaFranSokning({
      ...UTAN_SOK,
      manadsavgift: 3240,
      rantekanslighet: 8.4,
      pris: 4_950_001,
      boarea: 58.5,
      prisUppskattning: true,
    });
    expect(s.pris).toBe("4950001");
    expect(s.kontantinsats).toBe("495001"); // ceil(10 %)
    expect(s.manadsavgift).toBe("3240");
    expect(s.boarea).toBe("58,5");
    expect(s.rantekanslighetProcent).toBe(8.4);
    expect(s.kalla).toEqual({ pris: 4_950_001, prisArUppskattning: true });
    // Lånet blir pris − insats.
    expect(underlagFranSida(s).underlag.pris).toBe(4_950_001);
  });

  it("märker det som kommer från rapporten, men inte kontantinsatsen (Binfos förval)", () => {
    const s = sidaFranSokning({
      ...UTAN_SOK,
      pris: 5_000_000,
      manadsavgift: 3000,
      boarea: 50,
      ingar: "vatten",
      ingarEj: "el,tv",
    });
    expect(s.franRapport).toEqual({
      pris: true,
      manadsavgift: true,
      boarea: true,
      avgift: { vatten: true, el: true, tv: true },
    });
    expect(s.avgiftInkluderar).toEqual({
      varme: "ja", // förval, rapporten säger inget
      vatten: "ja",
      el: "nej",
      bredband: "nej",
      tv: "nej",
    });
  });

  it("rapporten kan sätta förval åt båda hållen; okända nycklar behåller förvalet", () => {
    const s = sidaFranSokning({ ...UTAN_SOK, ingar: "el,bredband", ingarEj: "varme" });
    expect(s.avgiftInkluderar).toEqual({
      varme: "nej",
      vatten: "ja",
      el: "ja",
      bredband: "ja",
      tv: "nej",
    });
    expect(avgiftFranSokning({ ingar: undefined, ingarEj: undefined })).toEqual({});
  });

  it("utan sökparametrar är allt tomt, inklusive boarea (ingen 58 m²-gissning)", () => {
    const s = sidaFranSokning({ ...UTAN_SOK });
    expect(s).toEqual(tomSida());
    expect(s.boarea).toBe("");
    expect(s.franRapport).toEqual({});
  });

  it("ändrar användaren ett fält försvinner dess märke; en chip tappar sitt märke när den slås om", () => {
    const s = sidaFranSokning({ ...UTAN_SOK, pris: 5_000_000, manadsavgift: 3000, ingarEj: "el" });
    const a = andraFalt(s, "pris", "5100000");
    expect(a.pris).toBe("5100000");
    expect(a.franRapport).toEqual({ manadsavgift: true, avgift: { el: true } });
    const b = andraAvgift(a, "el", "ja");
    expect(b.avgiftInkluderar.el).toBe("ja");
    expect(b.franRapport).toEqual({ manadsavgift: true });
    // Ett fält utan märke påverkar inte de andra.
    expect(andraFalt(b, "ranta", "3").franRapport).toEqual({ manadsavgift: true });
  });
});

describe("två lägen för avgiften i sidans underlag", () => {
  it("den delade butikens 'okant' räknas som 'nej' i kalkylen", () => {
    const { underlag } = underlagFranSida({
      ...tomSida(),
      avgiftInkluderar: { varme: "okant", vatten: "ja", el: "okant", bredband: "nej", tv: "ja" },
    });
    expect(underlag.avgiftInkluderar).toEqual({
      varme: "nej",
      vatten: "ja",
      el: "nej",
      bredband: "nej",
      tv: "ja",
    });
  });
});

describe("kalpArAndrad", () => {
  const bas = underlagFranSida(tomSida()).underlag;
  it("förvalet är inte ändrat", () => {
    expect(kalpArAndrad(bas)).toBe(false);
  });
  it("barn, vuxna ≠ låntagare eller annan kalkylränta räknas som ändrat", () => {
    expect(kalpArAndrad({ ...bas, barn: ["0-3"] })).toBe(true);
    expect(kalpArAndrad({ ...bas, antalVuxna: bas.antalLantagare + 1 })).toBe(true);
    expect(kalpArAndrad({ ...bas, kalkylrantaProcent: bas.kalkylrantaProcent + 1 })).toBe(true);
  });
});
