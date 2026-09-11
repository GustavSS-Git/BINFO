import { describe, expect, it } from "vitest";
import { beraknaManadskostnad, type LaneUnderlag } from "./manadskostnad";
import { ranteavdrag } from "./ranteavdrag";
import type { CostItemId, FeeInclusion, PropertyInput } from "@/types/analysis";

function inclusion(overrides: Partial<FeeInclusion> = {}): FeeInclusion {
  return { varme: "nej", vatten: "nej", el: "nej", bredband: "nej", tv: "nej", ...overrides };
}

function propertyInput(overrides: Partial<PropertyInput> = {}): PropertyInput {
  return {
    kind: "bostadsratt",
    utgangspris: 4_950_000,
    boarea: 58,
    antalRum: 3,
    manadsavgift: 3_240,
    andelstal: 2.1,
    orgnr: "769612-3456",
    adress: "Kapellgränd 12",
    postnummer: "116 25",
    ort: "Stockholm",
    hiss: "okant",
    balkong: "okant",
    avgiftInkluderar: inclusion(),
    antalPersoner: 2,
    antalLantagare: 2,
    ...overrides,
  };
}

describe("beraknaManadskostnad", () => {
  it("regression: 4 500 000 lån / 800 000 bruttoinkomst vid 80 % belåningsgrad ger takt 2, aldrig 3", () => {
    // bostadsvärde = lån / 0.8 => kontantinsats = bostadsvärde - lån
    const lanebelopp = 4_500_000;
    const bostadsvarde = lanebelopp / 0.8;
    const lan: LaneUnderlag = {
      lanebelopp,
      kontantinsats: bostadsvarde - lanebelopp,
      ranta: 3.6,
      bruttoinkomst: 800_000,
    };

    const m = beraknaManadskostnad(propertyInput(), lan);

    expect(m.amortering.tillampadAmorteringstakt).toBe(2);
    expect(m.amortering.belaningsgrad).toBeCloseTo(80, 1);
    expect(m.amortering.skuldkvot).toBeCloseTo(5.625, 3);
  });

  it("skuldkvoten flaggas över bankernas typiska tak men styr aldrig amorteringstakten", () => {
    const lan: LaneUnderlag = {
      lanebelopp: 4_500_000,
      kontantinsats: 500_000, // belåningsgrad ~90 % -> takt 2 oavsett skuldkvot
      ranta: 3.6,
      bruttoinkomst: 500_000, // skuldkvot 9x, långt över 5x
    };
    const m = beraknaManadskostnad(propertyInput(), lan);

    expect(m.amortering.overBankernasTypiskaTak).toBe(true);
    expect(m.amortering.tillampadAmorteringstakt).toBe(2);
  });

  it("ranteavdragPerAr matchar den fristående ranteavdrag()-funktionen för samma räntekostnad", () => {
    const lan: LaneUnderlag = {
      lanebelopp: 4_000_000,
      kontantinsats: 1_000_000,
      ranta: 4.0,
      bruttoinkomst: 900_000,
    };
    const input = propertyInput({ antalLantagare: 2 });
    const m = beraknaManadskostnad(input, lan);

    const arsranta = (lan.lanebelopp * (lan.ranta / 100));
    const forvantatAvdrag = ranteavdrag(arsranta, input.antalLantagare);

    expect(m.ranteavdragPerAr.value).toBeCloseTo(forvantatAvdrag, 0);
  });

  it("innehåller exakt de nio poster kontraktet definierar (ingen TV-post finns — CostItemId saknar en)", () => {
    const lan: LaneUnderlag = { lanebelopp: 3_000_000, kontantinsats: 1_000_000, ranta: 3, bruttoinkomst: 700_000 };
    const m = beraknaManadskostnad(propertyInput(), lan);

    const ids = m.poster.map((p) => p.id).sort();
    const forvantade: CostItemId[] = [
      "rantekostnad",
      "amortering",
      "ranteavdrag",
      "manadsavgift",
      "hushallsel",
      "varme",
      "vatten",
      "bredband",
      "hemforsakring",
    ].sort() as CostItemId[];
    expect(ids).toEqual(forvantade);
  });

  it("ränteavdraget redovisas som ett negativt belopp bland posterna", () => {
    const lan: LaneUnderlag = { lanebelopp: 3_000_000, kontantinsats: 1_000_000, ranta: 3, bruttoinkomst: 700_000 };
    const m = beraknaManadskostnad(propertyInput(), lan);
    const avdragspost = m.poster.find((p) => p.id === "ranteavdrag")!;
    expect(avdragspost.figure.value).toBeLessThan(0);
  });

  it("hemförsäkring ingår aldrig i avgiften — post.ingarIAvgift är alltid false för den", () => {
    const lan: LaneUnderlag = { lanebelopp: 3_000_000, kontantinsats: 1_000_000, ranta: 3, bruttoinkomst: 700_000 };
    const m = beraknaManadskostnad(
      propertyInput({ avgiftInkluderar: inclusion({ varme: "ja", vatten: "ja", el: "ja", bredband: "ja" }) }),
      lan,
    );
    const forsakring = m.poster.find((p) => p.id === "hemforsakring")!;
    expect(forsakring.ingarIAvgift).toBe(false);
  });

  it("en post markeras ingarIAvgift när FeeInclusion är 'ja' för den", () => {
    const lan: LaneUnderlag = { lanebelopp: 3_000_000, kontantinsats: 1_000_000, ranta: 3, bruttoinkomst: 700_000 };
    const m = beraknaManadskostnad(
      propertyInput({ avgiftInkluderar: inclusion({ varme: "ja" }) }),
      lan,
    );
    expect(m.poster.find((p) => p.id === "varme")!.ingarIAvgift).toBe(true);
    expect(m.poster.find((p) => p.id === "vatten")!.ingarIAvgift).toBe(false);
  });

  it("totalSpann saknas när alla FeeInclusion-fält är kända", () => {
    const lan: LaneUnderlag = { lanebelopp: 3_000_000, kontantinsats: 1_000_000, ranta: 3, bruttoinkomst: 700_000 };
    const m = beraknaManadskostnad(propertyInput({ avgiftInkluderar: inclusion() }), lan);
    expect(m.totalSpann).toBeUndefined();
  });

  it("totalSpann finns och breddas när ett FeeInclusion-fält är okant", () => {
    const lan: LaneUnderlag = { lanebelopp: 3_000_000, kontantinsats: 1_000_000, ranta: 3, bruttoinkomst: 700_000 };
    const m = beraknaManadskostnad(
      propertyInput({ avgiftInkluderar: inclusion({ varme: "okant" }) }),
      lan,
    );
    expect(m.totalSpann).toBeDefined();
    expect(m.totalSpann!.high).toBeGreaterThan(m.totalSpann!.low);
    expect(m.totalNetto.value).toBe(m.totalSpann!.low);
  });

  it("totalNetto är totalBrutto minus den månatliga andelen av ränteavdraget", () => {
    const lan: LaneUnderlag = { lanebelopp: 3_000_000, kontantinsats: 1_000_000, ranta: 3, bruttoinkomst: 700_000 };
    const m = beraknaManadskostnad(propertyInput(), lan);
    const forvantadNetto = m.totalBrutto.value! - Math.round(m.ranteavdragPerAr.value! / 12);
    expect(m.totalNetto.value).toBeCloseTo(forvantadNetto, 0);
  });

  it("alla valutabelopp är heltal, inga decimaler", () => {
    const lan: LaneUnderlag = { lanebelopp: 3_333_333, kontantinsats: 666_667, ranta: 3.37, bruttoinkomst: 712_345 };
    const m = beraknaManadskostnad(propertyInput(), lan);
    for (const post of m.poster) {
      expect(Number.isInteger(post.figure.value), post.id).toBe(true);
    }
    expect(Number.isInteger(m.totalBrutto.value)).toBe(true);
    expect(Number.isInteger(m.totalNetto.value)).toBe(true);
    expect(Number.isInteger(m.ranteavdragPerAr.value)).toBe(true);
  });
});
