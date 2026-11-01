/**
 * tolkaTidigareForsaljningar (booliApiTolkning.ts) against the recorded
 * `sold?residenceId` answers in fixtures/booli-api/ and hand-made edge cases.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_FORSALJNINGAR } from "@/lib/annons/forsaljningar";
import { tolkaTidigareForsaljningar } from "./booliApiTolkning";

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
    soldDate: "2024-05-01",
    soldPrice: 3_000_000,
    livingArea: 40,
    rooms: 2,
    floor: 3,
    rent: 2500,
    apartmentNumber: "1201",
    estimate: { price: 9_999_999 },
    soldPriceSource: "bid",
    location: { address: { streetAddress: " Testgatan 1 " } },
    ...over,
  };
}

describe("tolkaTidigareForsaljningar", () => {
  it("bostad 720821: två försäljningar, nyast först, rent 0 → null", () => {
    expect(tolkaTidigareForsaljningar(saldLista("bostad-720821-sold.json"))).toEqual({
      adress: "Sankt Eriksgatan 31A",
      forsaljningar: [
        {
          saldDatum: "2026-10-30",
          pris: 6_025_000,
          boarea: 54,
          antalRum: 2,
          vaning: 3,
          avgift: null,
        },
        {
          saldDatum: "2020-01-29",
          pris: 5_220_000,
          boarea: 54,
          antalRum: 2,
          vaning: 3,
          avgift: null,
        },
      ],
    });
  });

  it("bostad 719044: en försäljning med avgift", () => {
    expect(tolkaTidigareForsaljningar(saldLista("bostad-719044-sold.json"))).toEqual({
      adress: "Sandelsgatan 35",
      forsaljningar: [
        {
          saldDatum: "2026-10-27",
          pris: 4_900_000,
          boarea: 36,
          antalRum: 2,
          vaning: 6,
          avgift: 2618,
        },
      ],
    });
  });

  it("läser aldrig apartmentNumber, estimate eller soldPriceSource", () => {
    const ut = JSON.stringify(tolkaTidigareForsaljningar([rad()]));
    expect(ut).not.toContain("1201");
    expect(ut).not.toContain("9999999");
    expect(ut).not.toContain("bid");
    expect(Object.keys(tolkaTidigareForsaljningar([rad()]).forsaljningar[0]!).sort()).toEqual([
      "antalRum",
      "avgift",
      "boarea",
      "pris",
      "saldDatum",
      "vaning",
    ]);
  });

  it("tom lista och skräp → tomt svar utan adress", () => {
    expect(tolkaTidigareForsaljningar([])).toEqual({ adress: null, forsaljningar: [] });
    expect(tolkaTidigareForsaljningar([null, 3, "x", []])).toEqual({
      adress: null,
      forsaljningar: [],
    });
  });

  it("släpper rader med ogiltigt datum eller pris", () => {
    const ut = tolkaTidigareForsaljningar([
      rad({ soldDate: "2024-05" }),
      rad({ soldDate: "2024-05-01T10:00:00" }),
      rad({ soldDate: 20240501 }),
      rad({ soldDate: "2024-13-45" }),
      rad({ soldPrice: 0 }),
      rad({ soldPrice: -1 }),
      rad({ soldPrice: 3_000_000.5 }),
      rad({ soldPrice: "3000000" }),
      rad({ soldPrice: null }),
      rad({ soldDate: "2023-01-02", soldPrice: 2_000_000 }),
    ]);
    expect(ut.forsaljningar).toEqual([
      {
        saldDatum: "2023-01-02",
        pris: 2_000_000,
        boarea: 40,
        antalRum: 2,
        vaning: 3,
        avgift: 2500,
      },
    ]);
  });

  it("boarea/rum en decimal, saknade eller 0 → null; avgift avrundas", () => {
    const [a, b] = tolkaTidigareForsaljningar([
      rad({ soldDate: "2025-01-01", livingArea: 54.27, rooms: 2.5, floor: 1.5, rent: 2618.6 }),
      rad({ soldDate: "2024-01-01", livingArea: 0, rooms: undefined, floor: -1, rent: null }),
    ]).forsaljningar;
    expect(a).toMatchObject({ boarea: 54.3, antalRum: 2.5, vaning: 1.5, avgift: 2619 });
    expect(b).toMatchObject({ boarea: null, antalRum: null, vaning: null, avgift: null });
  });

  it("sorterar nyast först, tar bort dubbletter (datum + pris), högst MAX_FORSALJNINGAR", () => {
    const ut = tolkaTidigareForsaljningar([
      rad({ soldDate: "2015-01-01", location: { address: { streetAddress: "Gamla 1" } } }),
      rad({ soldDate: "2022-01-01" }),
      rad({ soldDate: "2022-01-01" }),
      rad({ soldDate: "2022-01-01", soldPrice: 3_100_000 }),
      rad({ soldDate: "2018-01-01" }),
      rad({ soldDate: "2019-01-01" }),
      rad({ soldDate: "2026-01-01", location: { address: { streetAddress: " Nya 2 " } } }),
      rad({ soldDate: "2010-01-01" }),
    ]);
    expect(ut.adress).toBe("Nya 2");
    expect(ut.forsaljningar).toHaveLength(MAX_FORSALJNINGAR);
    expect(ut.forsaljningar.map((f) => `${f.saldDatum} ${f.pris}`)).toEqual([
      "2026-01-01 3000000",
      "2022-01-01 3000000",
      "2022-01-01 3100000",
      "2019-01-01 3000000",
      "2018-01-01 3000000",
    ]);
  });

  it("adress null när den nyaste raden saknar gatuadress", () => {
    expect(
      tolkaTidigareForsaljningar([rad({ location: { address: { streetAddress: "  " } } })]).adress,
    ).toBeNull();
    expect(tolkaTidigareForsaljningar([rad({ location: null })]).adress).toBeNull();
  });
});
