/**
 * Task 4f — builds the compact, generated data files under
 * src/lib/vardering/data/ from the ml artefacts and derived CSV/JSON. Run
 * with `npm run build:vardering-data`. Re-running it must produce byte-
 * identical output (checked by src/lib/vardering/dataSync.test.ts, which
 * imports the pure build*() functions below directly and diffs their
 * output against the checked-in files).
 *
 * Sources (read-only; never written to):
 *   - ml/artifacts/valuation-v2/model.json    (LightGBM Booster.dump_model(),
 *     300 trees, 6-sig-fig rounded — the exact artefact parity_fixtures.json
 *     was generated from)
 *   - ml/artifacts/valuation-v2/metadata.json (cv_results, conformal
 *     interval, production_model back-transform constants)
 *   - ml/artifacts/valuation-v2/effects.json  (valuation drivers)
 *   - data/derived/postnummer_omrade.csv      (postnummer -> omrade map)
 *   - data/derived/utgangspris_vs_slutpris.json (budpremie per area)
 *
 * See each build*() function's header for exactly which JSON keys it reads.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ARTIFACT_DIR = path.join(ROOT, "ml", "artifacts", "valuation-v2");
const DERIVED_DIR = path.join(ROOT, "data", "derived");
const OUT_DIR = path.join(ROOT, "src", "lib", "vardering", "data");

// ---------------------------------------------------------------------------
// Raw source shapes (loose — these come from an external tool / another
// pipeline's output, not from this codebase's own types).
// ---------------------------------------------------------------------------

interface RawLeafNode {
  leaf_index: number;
  leaf_value: number;
}
interface RawSplitNode {
  split_index: number;
  split_feature: number;
  threshold: number;
  decision_type: string;
  default_left: boolean;
  missing_type: string;
  left_child: RawTreeNode;
  right_child: RawTreeNode;
}
type RawTreeNode = RawLeafNode | RawSplitNode;

function isLeaf(node: RawTreeNode): node is RawLeafNode {
  return "leaf_value" in node;
}

interface RawTreeInfo {
  tree_index: number;
  num_cat: number;
  tree_structure: RawTreeNode;
}

interface RawBoosterDump {
  tree_info: RawTreeInfo[];
}

interface RawModelJson {
  feature_order_out: string[];
  numeric_features: string[];
  missing_indicator_features: string[];
  categorical_features: string[];
  numeric_medians_for_imputation: Record<string, number>;
  categorical_fill_value_for_imputation: Record<string, string>;
  categorical_onehot_categories: Record<string, string[]>;
  lightgbm_booster: RawBoosterDump;
}

// ---------------------------------------------------------------------------
// model.data.ts — compact tree arrays
// ---------------------------------------------------------------------------

const MISSING_TYPE_CODE: Record<string, 0 | 1 | 2> = { None: 0, Zero: 1, NaN: 2 };

/**
 * Flattens one LightGBM tree_structure into parallel pre-order-indexed
 * arrays (root = index 0). Asserts decision_type "<=" and num_cat === 0
 * (no native categorical splits) — this artefact's categorical features
 * are one-hot encoded before LightGBM ever sees them, so no split should
 * be a native categorical split; a violation here means the ml pipeline
 * changed in a way this evaluator doesn't support yet, and we fail loudly
 * rather than silently mispredict.
 */
function flattenTree(tree: RawTreeInfo): {
  feature: number[];
  value: number[];
  left: number[];
  right: number[];
  missingType: (0 | 1 | 2)[];
  defaultLeft: (0 | 1)[];
} {
  if (tree.num_cat !== 0) {
    throw new Error(
      `Vardering data build: tree ${tree.tree_index} has num_cat=${tree.num_cat} ` +
        `(native categorical splits) — not supported by this evaluator.`,
    );
  }

  const feature: number[] = [];
  const value: number[] = [];
  const left: number[] = [];
  const right: number[] = [];
  const missingType: (0 | 1 | 2)[] = [];
  const defaultLeft: (0 | 1)[] = [];

  function visit(node: RawTreeNode): number {
    const idx = feature.length;
    // reserve the slot before recursing so children get later indices
    feature.push(-1);
    value.push(0);
    left.push(-1);
    right.push(-1);
    missingType.push(0);
    defaultLeft.push(1);

    if (isLeaf(node)) {
      value[idx] = node.leaf_value;
      return idx;
    }

    if (node.decision_type !== "<=") {
      throw new Error(
        `Vardering data build: unsupported decision_type "${node.decision_type}" ` +
          `at split_index ${node.split_index} — only "<=" numerical splits are supported.`,
      );
    }
    const missingCode = MISSING_TYPE_CODE[node.missing_type];
    if (missingCode === undefined) {
      throw new Error(`Vardering data build: unknown missing_type "${node.missing_type}"`);
    }

    feature[idx] = node.split_feature;
    value[idx] = node.threshold;
    missingType[idx] = missingCode;
    defaultLeft[idx] = node.default_left ? 1 : 0;
    left[idx] = visit(node.left_child);
    right[idx] = visit(node.right_child);
    return idx;
  }

  visit(tree.tree_structure);
  return { feature, value, left, right, missingType, defaultLeft };
}

export function buildModelData(rawModel: RawModelJson, version: string) {
  const trees = rawModel.lightgbm_booster.tree_info.map(flattenTree);
  return {
    version,
    nTrees: trees.length,
    trees,
  };
}

// ---------------------------------------------------------------------------
// manifest.data.ts — preprocessing manifest + smearing + conformal q + MAPE
// ---------------------------------------------------------------------------

interface RawMetadataJson {
  version: string;
  data_period: string;
  n_rows_used_for_training: number;
  cv_results: {
    lightgbm: {
      overall: { mape: number };
      per_area: Record<string, { mape: number }>;
    };
  };
  conformal_interval_evaluation: {
    target_coverage: number;
    q_overall_log: number;
    q_per_area_log: Record<string, number>;
  };
  production_model: {
    smearing_factor: number;
  };
}

/** "2026-01-01 to 2026-08-31 (8 months)" -> {fran, till}. */
function parseDataPeriod(label: string): { fran: string; till: string } {
  const m = /^(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/.exec(label);
  if (!m || !m[1] || !m[2]) {
    throw new Error(`Vardering data build: could not parse data_period "${label}"`);
  }
  return { fran: m[1], till: m[2] };
}

/** The literal fallback omrade category from ml/train_valuation.py's
 *  load_data(): `cleaned["omrade"].fillna("Okänt (postnummer ej kartlagt)")`
 *  (source: ml/train_valuation.py, load_data(), ~line 144). Verified against
 *  categorical_onehot_categories.omrade at build time in main(). */
const UNMAPPED_OMRADE_CATEGORY = "Okänt (postnummer ej kartlagt)";

export function buildManifest(rawModel: RawModelJson, rawMetadata: RawMetadataJson) {
  return {
    modelVersion: rawMetadata.version,
    dataPeriodLabel: rawMetadata.data_period,
    dataPeriod: parseDataPeriod(rawMetadata.data_period),
    trainingN: rawMetadata.n_rows_used_for_training,

    featureOrder: rawModel.feature_order_out,
    numericFeatures: rawModel.numeric_features,
    missingIndicatorFeatures: rawModel.missing_indicator_features,
    categoricalFeatures: rawModel.categorical_features,
    numericMedians: rawModel.numeric_medians_for_imputation,
    categoricalFillValues: rawModel.categorical_fill_value_for_imputation,
    categoricalCategories: rawModel.categorical_onehot_categories,
    unmappedOmradeCategory: UNMAPPED_OMRADE_CATEGORY,

    smearingFactor: rawMetadata.production_model.smearing_factor,

    targetCoveragePercent: rawMetadata.conformal_interval_evaluation.target_coverage * 100,
    qOverallLog: rawMetadata.conformal_interval_evaluation.q_overall_log,
    qPerAreaLog: rawMetadata.conformal_interval_evaluation.q_per_area_log,

    mapeOverallPercent: rawMetadata.cv_results.lightgbm.overall.mape,
    mapePerAreaPercent: Object.fromEntries(
      Object.entries(rawMetadata.cv_results.lightgbm.per_area).map(([area, v]) => [area, v.mape]),
    ),
  };
}

// ---------------------------------------------------------------------------
// postnummerOmrade.data.ts — postnummer -> omrade map
// ---------------------------------------------------------------------------

/**
 * Minimal CSV reader for postnummer_omrade.csv. Only the first two columns
 * (postnummer, omrade) are used; later columns (andel_i_omrade, n_adresser,
 * metod, kalla, granne_konflikt) can and do contain commas/quotes (free-text
 * "kalla" explanations), but postnummer/omrade never do (5-digit codes /
 * plain area names) — verified against the current file, so a plain
 * split-on-first-two-commas is safe and avoids needing a full CSV parser
 * dependency.
 */
export function buildPostnummerOmrade(csvText: string): Record<string, string> {
  const lines = csvText.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0];
  if (!header || !header.startsWith("postnummer,omrade,")) {
    throw new Error(
      `Vardering data build: unexpected postnummer_omrade.csv header "${header ?? ""}"`,
    );
  }

  const map: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const m = /^([^,]*),([^,]*),/.exec(line);
    if (!m || !m[1] || !m[2]) {
      throw new Error(`Vardering data build: could not parse postnummer_omrade.csv line "${line}"`);
    }
    const [, postnummer, omrade] = m;
    if (!/^\d{5}$/.test(postnummer)) {
      throw new Error(`Vardering data build: postnummer "${postnummer}" is not 5 digits`);
    }
    if (postnummer in map) {
      throw new Error(
        `Vardering data build: duplicate postnummer "${postnummer}" in postnummer_omrade.csv`,
      );
    }
    map[postnummer] = omrade;
  }
  return map;
}

// ---------------------------------------------------------------------------
// budpremie.data.ts
// ---------------------------------------------------------------------------

interface RawUtgangsprisJson {
  period: { start: string; end: string };
  overall: { n: number; median_pct: number; mean_pct: number };
  areas: Record<
    string,
    { n: number; median_pct: number; mean_pct: number; fallback_to_overall: boolean }
  >;
}

export function buildBudpremie(raw: RawUtgangsprisJson) {
  return {
    period: { fran: raw.period.start, till: raw.period.end },
    overall: {
      medianProcent: raw.overall.median_pct,
      medelProcent: raw.overall.mean_pct,
      n: raw.overall.n,
    },
    areas: Object.fromEntries(
      Object.entries(raw.areas).map(([area, v]) => [
        area,
        {
          medianProcent: v.median_pct,
          medelProcent: v.mean_pct,
          n: v.n,
          fallbackToOverall: v.fallback_to_overall,
        },
      ]),
    ),
  };
}

// ---------------------------------------------------------------------------
// effects.data.ts — valuation drivers
// ---------------------------------------------------------------------------

interface RawEffect {
  id: string;
  label_sv: string;
  effekt_procent: number;
  ci_low_procent: number;
  ci_high_procent: number;
  niva: "stad" | "omrade";
  omrade: string | null;
  n: number;
  signifikant: boolean;
}

interface RawEffectsJson {
  version: string;
  data_period: string;
  caveat_sv: string;
  reference_categories: { hiss: string; balkong: string };
  effects: RawEffect[];
}

export function buildEffects(raw: RawEffectsJson) {
  return {
    modelVersion: raw.version,
    dataPeriod: parseDataPeriod(raw.data_period),
    caveatSv: raw.caveat_sv,
    referenceCategories: raw.reference_categories,
    effects: raw.effects.map((e) => ({
      id: e.id,
      labelSv: e.label_sv,
      effektProcent: e.effekt_procent,
      ciLowProcent: e.ci_low_procent,
      ciHighProcent: e.ci_high_procent,
      niva: e.niva,
      omrade: e.omrade,
      n: e.n,
      signifikant: e.signifikant,
    })),
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function writeDataModule(fileName: string, sourceComment: string, data: unknown): void {
  // NOTE: Prettier is deliberately not applied to the JSON payload line
  // below — these files can be hundreds of KB of numeric arrays, and
  // Prettier would explode a single such line into one-element-per-line
  // formatting, working directly against the "as small as reasonably
  // possible" goal for the shipped data. The leading `/* eslint-disable */`
  // opts the whole generated file out of lint/format checks instead (the
  // usual treatment for generated/vendored files) — see eslint.config.js's
  // own "ml/**" ignore for the same reasoning applied to the ml artefacts.
  const content =
    `/* eslint-disable */\n` +
    `// AUTO-GENERATED by scripts/buildVarderingData.ts — do not edit by hand.\n` +
    `// Run \`npm run build:vardering-data\` to regenerate.\n` +
    `${sourceComment}\n` +
    `const data = ${JSON.stringify(data)};\n\n` +
    `export default data;\n`;
  writeFileSync(path.join(OUT_DIR, fileName), content, "utf-8");
}

function readJson<T>(...segments: string[]): T {
  return JSON.parse(readFileSync(path.join(...segments), "utf-8")) as T;
}

function sizeReport(label: string, fileName: string): void {
  const filePath = path.join(OUT_DIR, fileName);
  const raw = readFileSync(filePath);
  const gz = gzipSync(raw);
  console.log(
    `  ${label.padEnd(28)} raw ${raw.length.toString().padStart(9)} B   gz ${gz.length
      .toString()
      .padStart(8)} B   (${fileName})`,
  );
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });

  const rawModel = readJson<RawModelJson>(ARTIFACT_DIR, "model.json");
  const rawMetadata = readJson<RawMetadataJson>(ARTIFACT_DIR, "metadata.json");
  const rawEffects = readJson<RawEffectsJson>(ARTIFACT_DIR, "effects.json");
  const csvText = readFileSync(path.join(DERIVED_DIR, "postnummer_omrade.csv"), "utf-8");
  const rawUtgangspris = readJson<RawUtgangsprisJson>(DERIVED_DIR, "utgangspris_vs_slutpris.json");

  if (!rawModel.categorical_onehot_categories["omrade"]?.includes(UNMAPPED_OMRADE_CATEGORY)) {
    throw new Error(
      `Vardering data build: expected omrade category "${UNMAPPED_OMRADE_CATEGORY}" not found in ` +
        `model.json's categorical_onehot_categories.omrade — has the training pipeline's fallback ` +
        `label changed? Update UNMAPPED_OMRADE_CATEGORY in this script.`,
    );
  }

  const modelData = buildModelData(rawModel, rawMetadata.version);
  const manifest = buildManifest(rawModel, rawMetadata);
  const postnummerOmrade = buildPostnummerOmrade(csvText);
  const budpremie = buildBudpremie(rawUtgangspris);
  const effects = buildEffects(rawEffects);

  writeDataModule(
    "model.data.ts",
    `// Source: ml/artifacts/valuation-v2/model.json (lightgbm_booster, ` +
      `Booster.dump_model() format, ${modelData.nTrees} trees) -> compact ` +
      `pre-order-flattened tree arrays. See src/lib/vardering/types.ts (TreeArrays) ` +
      `for the layout.`,
    modelData,
  );
  writeDataModule(
    "manifest.data.ts",
    `// Source: ml/artifacts/valuation-v2/model.json (feature_order_out, ` +
      `numeric_features, missing_indicator_features, categorical_features, ` +
      `numeric_medians_for_imputation, categorical_fill_value_for_imputation, ` +
      `categorical_onehot_categories) and metadata.json (version, data_period, ` +
      `n_rows_used_for_training, cv_results.lightgbm.{overall,per_area}.mape ` +
      `[RESTRICTED feature set CV MAPE, the shipped model], ` +
      `conformal_interval_evaluation.{target_coverage,q_overall_log,q_per_area_log}, ` +
      `production_model.smearing_factor [NOT conformal_interval_evaluation.smearing_factor]).`,
    manifest,
  );
  writeDataModule(
    "postnummerOmrade.data.ts",
    `// Source: data/derived/postnummer_omrade.csv (postnummer, omrade columns).`,
    postnummerOmrade,
  );
  writeDataModule(
    "budpremie.data.ts",
    `// Source: data/derived/utgangspris_vs_slutpris.json ` +
      `(period, overall.{n,median_pct,mean_pct}, areas[*].{n,median_pct,mean_pct,fallback_to_overall}).`,
    budpremie,
  );
  writeDataModule(
    "effects.data.ts",
    `// Source: ml/artifacts/valuation-v2/effects.json ` +
      `(version, data_period, caveat_sv, reference_categories, effects[*].{id,label_sv,` +
      `effekt_procent,ci_low_procent,ci_high_procent,niva,omrade,n,signifikant}).`,
    effects,
  );

  console.log("Wrote src/lib/vardering/data/*.data.ts\n");
  console.log("Size report (generated data, raw vs gzip):");
  sizeReport("model", "model.data.ts");
  sizeReport("manifest", "manifest.data.ts");
  sizeReport("postnummerOmrade", "postnummerOmrade.data.ts");
  sizeReport("budpremie", "budpremie.data.ts");
  sizeReport("effects", "effects.data.ts");

  const originalRaw = readFileSync(path.join(ARTIFACT_DIR, "model.json"));
  const originalGz = gzipSync(originalRaw);
  console.log(
    `\n  original ml/artifacts model.json    raw ${originalRaw.length.toString().padStart(9)} B   ` +
      `gz ${originalGz.length.toString().padStart(8)} B`,
  );
}

// Only run when executed directly (`tsx scripts/buildVarderingData.ts`), not
// when imported by dataSync.test.ts for its pure build*() functions.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
