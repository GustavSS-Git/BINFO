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
  buildManifest,
  buildModelData,
  buildPostnummerOmrade,
} from "../../../scripts/buildVarderingData";

import modelData from "./data/model.data";
import manifest from "./data/manifest.data";
import postnummerOmrade from "./data/postnummerOmrade.data";
import budpremie from "./data/budpremie.data";
import effects from "./data/effects.data";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..", "..", "..");
const ARTIFACT_DIR = path.join(ROOT, "ml", "artifacts", "valuation-v2");
const DERIVED_DIR = path.join(ROOT, "data", "derived");

function readJson<T>(...segments: string[]): T {
  return JSON.parse(readFileSync(path.join(...segments), "utf-8")) as T;
}

describe("generated vardering data is in sync with ml artefacts", () => {
  it("model.data.ts matches a fresh build from ml/artifacts/valuation-v2/model.json", () => {
    const rawModel = readJson<Parameters<typeof buildModelData>[0]>(ARTIFACT_DIR, "model.json");
    const rawMetadata = readJson<{ version: string }>(ARTIFACT_DIR, "metadata.json");
    const fresh = buildModelData(rawModel, rawMetadata.version);
    expect(fresh).toEqual(modelData);
  });

  it("manifest.data.ts matches a fresh build from model.json + metadata.json", () => {
    const rawModel = readJson<Parameters<typeof buildManifest>[0]>(ARTIFACT_DIR, "model.json");
    const rawMetadata = readJson<Parameters<typeof buildManifest>[1]>(
      ARTIFACT_DIR,
      "metadata.json",
    );
    const fresh = buildManifest(rawModel, rawMetadata);
    expect(fresh).toEqual(manifest);
  });

  it("postnummerOmrade.data.ts matches a fresh build from postnummer_omrade.csv", () => {
    const csvText = readFileSync(path.join(DERIVED_DIR, "postnummer_omrade.csv"), "utf-8");
    const fresh = buildPostnummerOmrade(csvText);
    expect(fresh).toEqual(postnummerOmrade);
  });

  it("budpremie.data.ts matches a fresh build from utgangspris_vs_slutpris.json", () => {
    const raw = readJson<Parameters<typeof buildBudpremie>[0]>(
      DERIVED_DIR,
      "utgangspris_vs_slutpris.json",
    );
    const fresh = buildBudpremie(raw);
    expect(fresh).toEqual(budpremie);
  });

  it("effects.data.ts matches a fresh build from ml/artifacts/valuation-v2/effects.json", () => {
    const raw = readJson<Parameters<typeof buildEffects>[0]>(ARTIFACT_DIR, "effects.json");
    const fresh = buildEffects(raw);
    expect(fresh).toEqual(effects);
  });
});
