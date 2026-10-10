/**
 * Checks that src/lib/vardering/data/*.data.ts is in sync with the ml
 * artefacts / derived data it was generated from: re-runs the build's pure
 * transform functions in-memory (no file writes) and deep-equals the result
 * against the checked-in generated files. A mismatch means someone edited
 * the ml artefacts (or the CSV/JSON sources) without re-running
 * `npm run build:vardering-data`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildBudpremie,
  buildEffects,
  buildGeneralModel,
  buildKommunData,
  buildManifest,
  buildModelData,
  buildPostcodeDelta,
  buildPostnummerOmrade,
  buildPrisniva,
  filtreraKonfliktPostnummer,
} from "../../../scripts/buildVarderingData";

import modelData from "./data/model.data";
import generalModel from "./data/generalModel.data";
import manifest from "./data/manifest.data";
import postcodeDelta from "./data/postcodeDelta.data";
import postnummerOmrade from "./data/postnummerOmrade.data";
import kommun from "./data/kommun.data";
import prisniva from "./data/prisniva.data";
import budpremie from "./data/budpremie.data";
import effects from "./data/effects.data";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..", "..", "..");
const ARTIFACT_DIR = path.join(ROOT, "ml", "artifacts", "valuation-v3.1");
const DERIVED_DIR = path.join(ROOT, "data", "derived");

function readJson<T>(...segments: string[]): T {
  return JSON.parse(readFileSync(path.join(...segments), "utf-8")) as T;
}
function readText(...segments: string[]): string {
  return readFileSync(path.join(...segments), "utf-8");
}

describe("generated vardering data is in sync with ml artefacts", () => {
  it("model.data.ts matches a fresh build from ml/artifacts/valuation-v3.1/model.json", () => {
    const rawModel = readJson<Parameters<typeof buildModelData>[0]>(ARTIFACT_DIR, "model.json");
    const rawMetadata = readJson<{ version: string }>(ARTIFACT_DIR, "metadata.json");
    expect(buildModelData(rawModel, rawMetadata.version)).toEqual(modelData);
  });

  it("manifest.data.ts matches a fresh build from model.json + metadata.json", () => {
    const rawModel = readJson<Parameters<typeof buildManifest>[0]>(ARTIFACT_DIR, "model.json");
    const rawMetadata = readJson<Parameters<typeof buildManifest>[1]>(
      ARTIFACT_DIR,
      "metadata.json",
    );
    expect(buildManifest(rawModel, rawMetadata)).toEqual(manifest);
  });

  it("generalModel.data.ts matches a fresh build from general_model.json (WITH fee) + metadata.json", () => {
    const raw = readJson<Parameters<typeof buildGeneralModel>[0]>(
      ARTIFACT_DIR,
      "general_model.json",
    );
    const rawMetadata = readJson<Parameters<typeof buildGeneralModel>[1]>(
      ARTIFACT_DIR,
      "metadata.json",
    );
    expect(buildGeneralModel(raw, rawMetadata)).toEqual(generalModel);
    // Owner decision 2: the with-fee model, not the no-fee one.
    expect(generalModel.numericFeatures).toContain("fee_per_sqm");
  });

  it("postcodeDelta.data.ts matches a fresh build from postcode_encoding.json", () => {
    const raw = readJson<Parameters<typeof buildPostcodeDelta>[0]>(
      ARTIFACT_DIR,
      "postcode_encoding.json",
    );
    expect(buildPostcodeDelta(raw)).toEqual(postcodeDelta);
  });

  it("postnummerOmrade.data.ts matches a fresh, konflikt-filtered build", () => {
    const encoding = readJson<{ table: Record<string, number> }>(
      ARTIFACT_DIR,
      "postcode_encoding.json",
    );
    const { map } = filtreraKonfliktPostnummer(
      buildPostnummerOmrade(readText(DERIVED_DIR, "postnummer_omrade.csv")),
      readText(DERIVED_DIR, "postnummer_omrade_kommun_konflikter.csv"),
      new Set(Object.keys(encoding.table)),
    );
    expect(map).toEqual(postnummerOmrade);
  });

  it("drops exactly the four Huddinge postnummer (none occur in the training data)", () => {
    const encoding = readJson<{ table: Record<string, number> }>(
      ARTIFACT_DIR,
      "postcode_encoding.json",
    );
    const raw = buildPostnummerOmrade(readText(DERIVED_DIR, "postnummer_omrade.csv"));
    const { dropped, keptBecauseInTraining } = filtreraKonfliktPostnummer(
      raw,
      readText(DERIVED_DIR, "postnummer_omrade_kommun_konflikter.csv"),
      new Set(Object.keys(encoding.table)),
    );
    expect(dropped).toEqual(["12352", "12404", "12755", "12784"]);
    expect(keptBecauseInTraining).toEqual([]);
    for (const pn of dropped) {
      expect(pn in postnummerOmrade).toBe(false);
      expect(pn in encoding.table).toBe(false);
    }
  });

  it("keeps a konflikt-postnummer that does occur in the training data", () => {
    const { map, dropped, keptBecauseInTraining } = filtreraKonfliktPostnummer(
      { "12352": "Farsta-Vantör", "12404": "Farsta-Vantör" },
      "postnummer,omrade,x\n12352,Farsta-Vantör,x\n12404,Farsta-Vantör,x\n",
      new Set(["12352"]),
    );
    expect(dropped).toEqual(["12404"]);
    expect(keptBecauseInTraining).toEqual(["12352"]);
    expect(map).toEqual({ "12352": "Farsta-Vantör" });
  });

  it("kommun.data.ts matches a fresh build from postnummer_kommun.csv", () => {
    expect(buildKommunData(readText(DERIVED_DIR, "postnummer_kommun.csv"))).toEqual(kommun);
  });

  it("prisniva.data.ts matches a fresh build from regional_prisniva.json", () => {
    const raw = readJson<Parameters<typeof buildPrisniva>[0]>(
      DERIVED_DIR,
      "regional_prisniva.json",
    );
    expect(buildPrisniva(raw)).toEqual(prisniva);
  });

  it("budpremie.data.ts matches a fresh build from utgangspris_vs_slutpris.json", () => {
    const raw = readJson<Parameters<typeof buildBudpremie>[0]>(
      DERIVED_DIR,
      "utgangspris_vs_slutpris.json",
    );
    expect(buildBudpremie(raw)).toEqual(budpremie);
  });

  it("effects.data.ts matches a fresh build from ml/artifacts/valuation-v3.1/effects.json", () => {
    const raw = readJson<Parameters<typeof buildEffects>[0]>(ARTIFACT_DIR, "effects.json");
    expect(buildEffects(raw)).toEqual(effects);
  });
});
