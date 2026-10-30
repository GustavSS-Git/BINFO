/**
 * Checks that the generated register data and the hand-written
 * REGISTEROMRADEN constant are in sync with the ml/mapping and data/derived
 * CSVs they come from. A mismatch means a CSV changed without re-running
 * `npm run build:register-data`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildRegisterData,
  readRegisterInputs,
  renderRegisterData,
} from "../../../scripts/buildRegisterData";
import data from "./data/postnummerStadsdel.data";
import { avkodaLopare, avkodaPostnummerLista } from "./kodning";
import { REGISTEROMRADEN, registeromradeForStadsdel } from "./omraden";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..", "..", "..");

describe("generated register data is in sync with its CSV sources", () => {
  it("postnummerStadsdel.data.ts equals a fresh build", () => {
    expect(data).toEqual(buildRegisterData(readRegisterInputs()));
  });

  it("the checked-in file is byte-identical to the rendered build", () => {
    const onDisk = readFileSync(path.join(here, "data", "postnummerStadsdel.data.ts"), "utf-8");
    expect(onDisk).toBe(renderRegisterData(buildRegisterData(readRegisterInputs())));
  });

  it("REGISTEROMRADEN equals ml/mapping/registeromraden.csv (slug, namn, grupp, ordning)", () => {
    const lines = readFileSync(path.join(ROOT, "ml", "mapping", "registeromraden.csv"), "utf-8")
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(1);
    const csv = lines.map((l) => {
      const [slug, namn, grupp, ordning] = l.split(",");
      return { slug, namn, grupp, ordning: Number(ordning) };
    });
    expect(csv).toEqual(
      REGISTEROMRADEN.map(({ slug, namn, grupp, ordning }) => ({ slug, namn, grupp, ordning })),
    );
  });

  it("all 117 stadsdel polygons resolve to an area", () => {
    const geo = JSON.parse(
      readFileSync(
        path.join(ROOT, "ml", "mapping", "sources", "stadsdelar_fullsize.geo.json"),
        "utf-8",
      ),
    ) as { features: { properties: { name: string } }[] };
    const names = geo.features.map((f) => f.properties.name);
    expect(names).toHaveLength(117);
    for (const n of names) expect(registeromradeForStadsdel(n), n).not.toBeNull();
  });

  it("the encoded lists decode consistently", () => {
    const pn = avkodaPostnummerLista(data.postnummer);
    expect(avkodaLopare(data.omradeIdx)).toHaveLength(pn.length);
    expect(new Set(pn).size).toBe(pn.length);
    const osakra = avkodaPostnummerLista(data.osakra);
    expect(osakra.every((p) => pn.includes(p))).toBe(true);
    const ovriga = avkodaPostnummerLista(data.ovriga);
    expect(ovriga.some((p) => pn.includes(p))).toBe(false);
  });

  it("ships only area indexes, no coordinates or addresses", () => {
    const text = readFileSync(path.join(here, "data", "postnummerStadsdel.data.ts"), "utf-8");
    expect(Object.keys(data).sort()).toEqual([
      "omradeIdx",
      "omraden",
      "osakra",
      "ovriga",
      "postnummer",
      "stadsdelar",
    ]);
    expect(text.length).toBeLessThan(20_000);
  });
});
