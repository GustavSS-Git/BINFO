/**
 * The sales mapping (booliApiTolkning.ts: tolkaSaldRad, sammaAdress,
 * sammanstallForsaljningar) against the recorded answers in
 * fixtures/booli-api/ and hand-made edge cases.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_FORSALJNINGAR } from "@/lib/annons/forsaljningar";
import {
  normaliseraAdress,
  sammaAdress,
  sammanstallForsaljningar,
  tolkaSaldRad,
} from "./booliApiTolkning";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURER = path.join(here, "..", "..", "..", "fixtures", "booli-api");
const saldLista = (namn: string): unknown[] => {
  const { body } = JSON.parse(readFileSync(path.join(FIXTURER, namn), "utf-8")) as {
    body: { sold: unknown[] };
  };
  return body.sold;
};

function rad(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    booliId: 1,
    soldDate: "2024-05-01",
    soldPrice: 3_000_000,
    livingArea: 40,
    rooms: 2,
    floor: 3,
    rent: 2500,
    apartmentNumber: "1201",
    estimate: { price: 9_999_999 },
    soldPriceSource: "bid",
    location: {
      address: { streetAddress: " Testgatan 1 " },
      position: { latitude: 59.3, longitude: 18.0 },
    },
    ...over,
  };
}

describe("tolkaSaldRad", () => {
  it("bostad 719044: fälten, adress och läge", () => {
    expect(tolkaSaldRad(saldLista("bostad-719044-sold.json")[0])).toMatchObject({
      adress: "Sandelsgatan 35",
      rad: {
        saldDatum: "2026-10-27",
        pris: 4_900_000,
        boarea: 36,
        antalRum: 2,
        vaning: 6,
        avgift: 2618,
      },
    });
  });

  it("läser aldrig apartmentNumber, estimate eller soldPriceSource", () => {
    const t = tolkaSaldRad(rad());
    const ut = JSON.stringify(t?.rad);
    expect(ut).not.toContain("1201");
    expect(ut).not.toContain("9999999");
    expect(ut).not.toContain("bid");
    expect(Object.keys(t!.rad).sort()).toEqual([
      "antalRum",
      "avgift",
      "boarea",
      "pris",
      "saldDatum",
      "vaning",
    ]);
  });

  it("släpper rader med ogiltigt datum eller pris", () => {
    for (const over of [
      { soldDate: "2024-05" },
      { soldDate: "2024-05-01T10:00:00" },
      { soldDate: 20240501 },
      { soldDate: "2024-13-45" },
      { soldPrice: 0 },
      { soldPrice: -1 },
      { soldPrice: 3_000_000.5 },
      { soldPrice: "3000000" },
      { soldPrice: null },
    ]) {
      expect(tolkaSaldRad(rad(over))).toBeNull();
    }
    expect(tolkaSaldRad(null)).toBeNull();
    expect(tolkaSaldRad([])).toBeNull();
  });

  it("decimaler, saknade värden och 0 → null; avgift avrundas", () => {
    expect(
      tolkaSaldRad(rad({ livingArea: 54.27, rooms: 2.5, floor: 1.5, rent: 2618.6 }))?.rad,
    ).toMatchObject({ boarea: 54.3, antalRum: 2.5, vaning: 1.5, avgift: 2619 });
    expect(
      tolkaSaldRad(rad({ livingArea: 0, rooms: undefined, floor: -1, rent: null }))?.rad,
    ).toMatchObject({ boarea: null, antalRum: null, vaning: null, avgift: null });
    expect(tolkaSaldRad(rad({ location: null }))).toMatchObject({ adress: null, position: null });
  });
});

describe("sammaAdress", () => {
  it("skiftläge, mellanslag och mellanrum före bokstav spelar ingen roll; nummer och bokstav gör det", () => {
    expect(normaliseraAdress("  Östermalmsgatan   30 A ")).toBe("östermalmsgatan 30a");
    expect(sammaAdress("Östermalmsgatan 30", "östermalmsgatan  30")).toBe(true);
    expect(sammaAdress("Sankt Eriksgatan 31A", "Sankt Eriksgatan 31 a")).toBe(true);
    expect(sammaAdress("Östermalmsgatan 30", "Östermalmsgatan 30A")).toBe(false);
    expect(sammaAdress("Östermalmsgatan 30", "Östermalmsgatan 32")).toBe(false);
    expect(sammaAdress("Östermalmsgatan 30", "Östermalmsgatan 3")).toBe(false);
  });
});

describe("sammanstallForsaljningar", () => {
  it("Sankt Eriksgatan 31A: lägenhetens två egna markerade, 11 på adressen, nyast först", () => {
    const ut = sammanstallForsaljningar(
      saldLista("bostad-720821-sold.json"),
      saldLista("hus-720821-sold-box.json"),
      "Sankt Eriksgatan 31A",
      "2016-11-01",
    );
    expect(ut).toHaveLength(11);
    expect(ut.filter((f) => f.dennaLagenhet).map((f) => f.saldDatum)).toEqual([
      "2026-10-30",
      "2020-01-29",
    ]);
    const datum = ut.map((f) => f.saldDatum);
    expect(datum).toEqual([...datum].sort().reverse());
  });

  it("en försäljning i båda listorna visas en gång, som den här lägenheten", () => {
    const ut = sammanstallForsaljningar(
      [rad({ booliId: 7 })],
      [rad({ booliId: 7 }), rad({ booliId: 8, soldDate: "2024-05-01" }), rad({ booliId: 9 })],
      "Testgatan 1",
      "2016-11-01",
    );
    // booliId 8 has the same date + price as 7: also the same sale.
    expect(ut).toEqual([expect.objectContaining({ dennaLagenhet: true })]);
  });

  it("bara exakt adress från rutan, inget före fran-datumet", () => {
    const ut = sammanstallForsaljningar(
      [],
      [
        rad({ booliId: 1, soldDate: "2025-01-01" }),
        rad({
          booliId: 2,
          soldDate: "2024-01-01",
          location: { address: { streetAddress: "Testgatan 1A" } },
        }),
        rad({ booliId: 3, soldDate: "2016-10-31" }),
        rad({ booliId: 4, soldDate: "2016-11-01" }),
      ],
      "testgatan 1",
      "2016-11-01",
    );
    expect(ut.map((f) => [f.saldDatum, f.dennaLagenhet])).toEqual([
      ["2025-01-01", false],
      ["2016-11-01", false],
    ]);
  });

  it("utan adress: bara lägenhetens egna; högst MAX_FORSALJNINGAR", () => {
    expect(
      sammanstallForsaljningar(
        [rad()],
        [rad({ booliId: 2, soldDate: "2025-01-01" })],
        null,
        "2016-11-01",
      ),
    ).toHaveLength(1);
    const manga = Array.from({ length: MAX_FORSALJNINGAR + 5 }, (_, i) =>
      rad({ booliId: i + 1, soldPrice: 1_000_000 + i }),
    );
    expect(sammanstallForsaljningar([], manga, "Testgatan 1", "2016-11-01")).toHaveLength(
      MAX_FORSALJNINGAR,
    );
  });
});
