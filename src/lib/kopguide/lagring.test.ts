import { describe, expect, it } from "vitest";
import {
  KOPGUIDE_LAGRINGSNYCKEL,
  lasLokalaKlara,
  lasSammanslagenMed,
  skrivLokalaKlara,
  skrivSammanslagenMed,
} from "./lagring";

function minne(): Pick<Storage, "getItem" | "setItem"> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}
const trasig = {
  getItem: () => {
    throw new Error("blockerad");
  },
  setItem: () => {
    throw new Error("full");
  },
};

describe("lokal lagring av köpguiden", () => {
  it("skriver och läser tillbaka i versionsformatet", () => {
    const m = minne();
    expect(skrivLokalaKlara(["visning", "sok"], m, () => new Date("2026-10-28T10:00:00Z"))).toBe(
      true,
    );
    expect(JSON.parse(m.data.get(KOPGUIDE_LAGRINGSNYCKEL) ?? "")).toEqual({
      v: 1,
      klara: ["sok", "visning"],
      uppdaterad: "2026-10-28T10:00:00.000Z",
    });
    expect(lasLokalaKlara(m)).toEqual(["sok", "visning"]);
  });
  it("tomt, trasigt eller fel version ger tom lista", () => {
    const m = minne();
    expect(lasLokalaKlara(m)).toEqual([]);
    for (const rå of ["{", "null", "[]", '{"v":2,"klara":["sok"]}', '{"v":1,"klara":"sok"}']) {
      m.data.set(KOPGUIDE_LAGRINGSNYCKEL, rå);
      expect(lasLokalaKlara(m)).toEqual([]);
    }
  });
  it("okända id:n i lagringen filtreras bort", () => {
    const m = minne();
    m.data.set(KOPGUIDE_LAGRINGSNYCKEL, '{"v":1,"klara":["sok","gammalt"],"uppdaterad":"x"}');
    expect(lasLokalaKlara(m)).toEqual(["sok"]);
  });
  it("kastar aldrig, även när lagringen saknas eller är trasig", () => {
    expect(lasLokalaKlara(null)).toEqual([]);
    expect(lasLokalaKlara(trasig)).toEqual([]);
    expect(skrivLokalaKlara(["sok"], null)).toBe(false);
    expect(skrivLokalaKlara(["sok"], trasig)).toBe(false);
    expect(lasSammanslagenMed(trasig)).toBeNull();
    expect(() => skrivSammanslagenMed("p", trasig)).not.toThrow();
  });
  it("minns vilket konto som slagits ihop", () => {
    const m = minne();
    expect(lasSammanslagenMed(m)).toBeNull();
    skrivSammanslagenMed("p-1", m);
    expect(lasSammanslagenMed(m)).toBe("p-1");
  });
});
