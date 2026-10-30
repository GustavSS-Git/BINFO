import { describe, expect, it } from "vitest";
import {
  antalKlara,
  framstegText,
  nastaSteg,
  normaliseraKlara,
  slaSamman,
  synligaSteg,
} from "./framsteg";
import { KOPGUIDE_FASER, KOPGUIDE_STEG } from "./steg";

describe("stegdata", () => {
  it("har 12 bostadsrättssteg och 13 för hus, med unika id:n", () => {
    expect(synligaSteg("brf")).toHaveLength(12);
    expect(synligaSteg("hus")).toHaveLength(13);
    expect(new Set(KOPGUIDE_STEG.map((s) => s.id)).size).toBe(KOPGUIDE_STEG.length);
  });
  it("varje steg tillhör exakt en fas, via id", () => {
    const alla = KOPGUIDE_FASER.flatMap((f) => f.stegIds);
    expect([...alla].sort()).toEqual(KOPGUIDE_STEG.map((s) => s.id).sort());
  });
  it("medlemskapets text är komplett", () => {
    const s = KOPGUIDE_STEG.find((x) => x.id === "medlemskap");
    expect(s?.beskrivning.endsWith("några veckor.")).toBe(true);
    expect(s?.beskrivning).toContain("bostadsrättslagen, vanligtvis");
  });
});

describe("normaliseraKlara", () => {
  it("behåller bara kända, unika id:n i stegens ordning", () => {
    expect(normaliseraKlara(["efter", "sok", "sok", "nope", 3, null, "lanelofte"])).toEqual([
      "lanelofte",
      "sok",
      "efter",
    ]);
  });
  it("allt som inte är en array blir tomt", () => {
    for (const x of [undefined, null, "sok", { 0: "sok" }, 5])
      expect(normaliseraKlara(x)).toEqual([]);
  });
});

describe("antal, nästa och union", () => {
  it("räknar bara synliga steg", () => {
    expect(antalKlara(["sok", "lagfart"], "brf")).toBe(1);
    expect(antalKlara(["sok", "lagfart"], "hus")).toBe(2);
  });
  it("nästa är första ej avbockade synliga steget", () => {
    expect(nastaSteg([], "brf")?.id).toBe("lanelofte");
    expect(nastaSteg(["lanelofte", "visning"], "brf")?.id).toBe("sok");
    expect(
      nastaSteg(
        synligaSteg("brf").map((s) => s.id),
        "brf",
      ),
    ).toBeNull();
    // lagfart är osynligt för bostadsrätt men väntar på hus.
    const allaBrf = synligaSteg("brf").map((s) => s.id);
    expect(nastaSteg(allaBrf, "hus")?.id).toBe("lagfart");
  });
  it("slaSamman är en union", () => {
    expect(slaSamman(["visning", "sok"], ["sok", "efter", "x"])).toEqual([
      "sok",
      "visning",
      "efter",
    ]);
  });
});

describe("framstegText", () => {
  it("inget bockat", () => {
    expect(framstegText([], "brf")).toBe("Du har inte bockat av något steg ännu.");
  });
  it("delvis", () => {
    expect(framstegText(["lanelofte", "sok", "visning", "ekonomi"], "brf")).toBe(
      "4 av 12 steg klara. Nästa: budgivning.",
    );
  });
  it("alla", () => {
    expect(
      framstegText(
        synligaSteg("brf").map((s) => s.id),
        "brf",
      ),
    ).toBe("Alla 12 steg klara.");
  });
  it("hus räknar 13", () => {
    expect(framstegText(["sok"], "hus")).toBe(
      "1 av 13 steg klara. Nästa: förberedelse & lånelöfte.",
    );
  });
});
