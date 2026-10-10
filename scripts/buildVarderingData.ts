/**
 * Task 4f — builds the compact, generated data files under
 * src/lib/vardering/data/ from the ml artefacts and derived CSV/JSON. Run
 * with `npm run build:vardering-data`. Re-running it must produce byte-
 * identical output (checked by src/lib/vardering/dataSync.test.ts, which
 * imports the pure build*() functions below directly and diffs their
 * output against the checked-in files).
 *
 * Sources (read-only; never written to):
 *   - ml/artifacts/valuation-v3.1/model.json    (Stockholm area model: LightGBM
 *     Booster.dump_model(), 250 trees, 6-sig-fig rounded — the exact
 *     artefact parity_fixtures.json was generated from)
 *   - ml/artifacts/valuation-v3.1/postcode_encoding.json (postcode_delta table + 4-digit prefix_table)
 *   - ml/artifacts/valuation-v3.1/general_model.json (r(x) model WITH fee, used
 *     in Stockholms län outside Stockholm kommun and outside the län)
 *   - ml/artifacts/valuation-v3.1/metadata.json (cv, conformal interval,
 *     regional_method, production_model back-transform constants)
 *   - ml/artifacts/valuation-v3.1/effects.json  (valuation drivers)
 *   - data/derived/postnummer_omrade.csv      (postnummer -> omrade map)
 *   - data/derived/postnummer_omrade_kommun_konflikter.csv (omrade-map rows
 *     whose postnummer lies in another kommun than Stockholm)
 *   - data/derived/postnummer_kommun.csv      (postnummer -> kommun)
 *   - data/derived/regional_prisniva.json     (kommun / riket kr/m² averages)
 *   - data/derived/utgangspris_vs_slutpris.json (budpremie per area)
 *
 * See each build*() function's header for exactly which JSON keys it reads.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { kodaPostnummerLista } from "../src/lib/vardering/kommunKodning";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ARTIFACT_DIR = path.join(ROOT, "ml", "artifacts", "valuation-v3.1");
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
  n_rows: number;
  final_model: {
    cv: {
      mape: number;
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
  regional_method: {
    q_regional_log: number;
    simulation_cv_with_fee: { n: number; mape: number };
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
    trainingN: rawMetadata.n_rows,

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

    mapeOverallPercent: rawMetadata.final_model.cv.mape,
    mapePerAreaPercent: Object.fromEntries(
      Object.entries(rawMetadata.final_model.cv.per_area).map(([area, v]) => [area, v.mape]),
    ),
  };
}

// ---------------------------------------------------------------------------
// generalModel.data.ts — r(x) model for the regional method
// ---------------------------------------------------------------------------

interface RawGeneralModelJson extends RawModelJson {
  r_inference: {
    smearing_factor: number;
    normaliser: number;
    clip_min: number;
    clip_max: number;
    n_training_rows: number;
  };
}

/**
 * general_model.json (WITH fee, not general_model_nofee.json — owner decision)
 * -> compact trees + preprocessing manifest + the r(x) constants.
 * `qRegionalLog` and `mapeRegionalPercent` come from metadata.json ->
 * regional_method: q_regional_log, and simulation_cv_with_fee.mape (5-fold
 * CV of the omrade simulation, n = 4,955 — a LOWER BOUND on error elsewhere,
 * see MODEL_CARD.md section 6).
 */
export function buildGeneralModel(rawGeneral: RawGeneralModelJson, rawMetadata: RawMetadataJson) {
  const trees = rawGeneral.lightgbm_booster.tree_info.map(flattenTree);
  return {
    version: rawMetadata.version,
    nTrees: trees.length,
    trees,
    dataPeriodLabel: rawMetadata.data_period,
    dataPeriod: parseDataPeriod(rawMetadata.data_period),
    trainingN: rawGeneral.r_inference.n_training_rows,

    featureOrder: rawGeneral.feature_order_out,
    numericFeatures: rawGeneral.numeric_features,
    missingIndicatorFeatures: rawGeneral.missing_indicator_features,
    categoricalFeatures: rawGeneral.categorical_features,
    numericMedians: rawGeneral.numeric_medians_for_imputation,
    categoricalFillValues: rawGeneral.categorical_fill_value_for_imputation,
    categoricalCategories: rawGeneral.categorical_onehot_categories,

    smearingFactor: rawGeneral.r_inference.smearing_factor,
    normaliser: rawGeneral.r_inference.normaliser,
    clipMin: rawGeneral.r_inference.clip_min,
    clipMax: rawGeneral.r_inference.clip_max,

    targetCoveragePercent: rawMetadata.conformal_interval_evaluation.target_coverage * 100,
    qRegionalLog: rawMetadata.regional_method.q_regional_log,
    mapeRegionalPercent: rawMetadata.regional_method.simulation_cv_with_fee.mape,
  };
}

// ---------------------------------------------------------------------------
// postcodeDelta.data.ts — postnummer -> postcode_delta (Stockholm model)
// ---------------------------------------------------------------------------

interface RawPostcodeEncodingJson {
  fallback_for_unseen_or_missing_postnummer: number;
  prefix_length: number;
  prefix_table: Record<string, number>;
  table: Record<string, number>;
}

export function buildPostcodeDelta(raw: RawPostcodeEncodingJson) {
  if (raw.fallback_for_unseen_or_missing_postnummer !== 0) {
    throw new Error(
      "Vardering data build: postcode_encoding.json fallback is no longer 0 — owner decision 5 " +
        "(unseen postnummer -> postcode_delta = 0) must be revisited.",
    );
  }
  for (const k of Object.keys(raw.prefix_table)) {
    if (k.length !== raw.prefix_length) {
      throw new Error(
        `Vardering data build: postcode_encoding.json prefix_table key "${k}" is not ${raw.prefix_length} digits`,
      );
    }
  }
  return {
    fallback: 0,
    prefixLength: raw.prefix_length,
    prefixTable: raw.prefix_table,
    table: raw.table,
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

/**
 * Owner decision 4: postnummer that postnummer_omrade.csv lists as a
 * Stockholm omrade but that lie in another kommun (the rows of
 * postnummer_omrade_kommun_konflikter.csv; today 12352, 12404, 12755, 12784,
 * all Huddinge) are dropped from the generated map, so they resolve through
 * the kommun map instead — UNLESS they occur in the training data, in which
 * case the omrade they were trained with is kept.
 *
 * "Occurs in the training data" is checked with the keys of
 * postcode_encoding.json -> table. That table holds every distinct non-null
 * postal_code_clean of the 4,991 cleaned training rows (Jan-Aug 2026); the
 * only rows without a key are the 18 with no postcode at all (valuation-v3.1
 * keeps `table` exactly that: the neighbour fallback lives in the separate
 * `prefix_table`, so unseen mapped postnummer are NOT keys of `table`). Its keys
 * are therefore exactly the training postnummer,
 * without shipping any raw rows.
 */
export function filtreraKonfliktPostnummer(
  omradeMap: Record<string, string>,
  konflikterCsvText: string,
  traningsPostnummer: ReadonlySet<string>,
): { map: Record<string, string>; dropped: string[]; keptBecauseInTraining: string[] } {
  const lines = konflikterCsvText.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0];
  if (!header || !header.startsWith("postnummer,omrade,")) {
    throw new Error(
      `Vardering data build: unexpected postnummer_omrade_kommun_konflikter.csv header "${header ?? ""}"`,
    );
  }
  const map = { ...omradeMap };
  const dropped: string[] = [];
  const keptBecauseInTraining: string[] = [];
  for (const line of lines.slice(1)) {
    const postnummer = line.split(",")[0] ?? "";
    if (!/^\d{5}$/.test(postnummer)) {
      throw new Error(`Vardering data build: bad konflikt line "${line}"`);
    }
    if (!(postnummer in map)) continue;
    if (traningsPostnummer.has(postnummer)) {
      keptBecauseInTraining.push(postnummer);
    } else {
      delete map[postnummer];
      dropped.push(postnummer);
    }
  }
  return { map, dropped, keptBecauseInTraining };
}

// ---------------------------------------------------------------------------
// kommun.data.ts — postnummer -> kommun (server-only, compact)
// ---------------------------------------------------------------------------

/**
 * postnummer_kommun.csv -> { kommuner: kod -> namn, postnummer: kod -> encoded
 * sorted postnummer list (see src/lib/vardering/kommunKodning.ts) }. Only the
 * first four columns (postnummer, kommun_kod, kommun_namn, lan_kod) are read;
 * the later free-text columns may contain commas but these never do. The
 * lan_kod column is cross-checked against the kommun code (a kommun's first
 * two digits ARE its län code) so the runtime can rely on the code prefix.
 */
export function buildKommunData(csvText: string) {
  const lines = csvText.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0];
  if (!header || !header.startsWith("postnummer,kommun_kod,kommun_namn,lan_kod,")) {
    throw new Error(
      `Vardering data build: unexpected postnummer_kommun.csv header "${header ?? ""}"`,
    );
  }
  const namn: Record<string, string> = {};
  const perKommun = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const line of lines.slice(1)) {
    const m = /^(\d{5}),(\d{4}),([^,"]+),(\d{2}),/.exec(line);
    if (!m || !m[1] || !m[2] || !m[3] || !m[4]) {
      throw new Error(`Vardering data build: could not parse postnummer_kommun.csv line "${line}"`);
    }
    const [, postnummer, kod, kommunNamn, lan] = m;
    if (kod.slice(0, 2) !== lan) {
      throw new Error(`Vardering data build: kommun ${kod} does not belong to lan ${lan}`);
    }
    if (seen.has(postnummer)) {
      throw new Error(
        `Vardering data build: duplicate postnummer "${postnummer}" in postnummer_kommun.csv`,
      );
    }
    seen.add(postnummer);
    const existing = namn[kod];
    if (existing !== undefined && existing !== kommunNamn) {
      throw new Error(
        `Vardering data build: kommun ${kod} has two names ("${existing}", "${kommunNamn}")`,
      );
    }
    namn[kod] = kommunNamn;
    const lista = perKommun.get(kod);
    if (lista) lista.push(postnummer);
    else perKommun.set(kod, [postnummer]);
  }
  const kodSorted = Object.keys(namn).sort();
  return {
    kommuner: Object.fromEntries(kodSorted.map((k) => [k, namn[k] as string])),
    postnummer: Object.fromEntries(
      kodSorted.map((k) => [k, kodaPostnummerLista(perKommun.get(k) ?? [])]),
    ),
  };
}

// ---------------------------------------------------------------------------
// prisniva.data.ts — published kr/m² averages (regional baseline)
// ---------------------------------------------------------------------------

interface RawPrisnivaPeriod {
  fran: string;
  till: string;
}
interface RawRegionalPrisnivaJson {
  kommuner: { kod: string; namn: string; krPerM2: number; period: RawPrisnivaPeriod }[];
  riket: { kod: string; namn: string; krPerM2: number; period: RawPrisnivaPeriod };
}

/** Publisher shown as the citation next to the figure. The kommun series is
 *  Svensk Mäklarstatistik's "Bostadsrätter - Stockholms län (kommuner)"
 *  (xlsx supplied by the owner); the riket figure is Svensk Mäklarstatistik
 *  too, supplied by the owner on 2026-10-07 (regional_prisniva.json ->
 *  riket.proveniens). */
const PRISNIVA_KALLA = "Svensk Mäklarstatistik";

export function buildPrisniva(raw: RawRegionalPrisnivaJson) {
  return {
    kalla: PRISNIVA_KALLA,
    kommuner: Object.fromEntries(
      raw.kommuner.map((k) => [
        k.kod,
        { namn: k.namn, krPerM2: k.krPerM2, period: { fran: k.period.fran, till: k.period.till } },
      ]),
    ),
    riket: {
      namn: raw.riket.namn,
      krPerM2: raw.riket.krPerM2,
      period: { fran: raw.riket.period.fran, till: raw.riket.period.till },
    },
  };
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
  const rawGeneral = readJson<RawGeneralModelJson>(ARTIFACT_DIR, "general_model.json");
  const rawEncoding = readJson<RawPostcodeEncodingJson>(ARTIFACT_DIR, "postcode_encoding.json");
  const rawMetadata = readJson<RawMetadataJson>(ARTIFACT_DIR, "metadata.json");
  const rawEffects = readJson<RawEffectsJson>(ARTIFACT_DIR, "effects.json");
  const csvText = readFileSync(path.join(DERIVED_DIR, "postnummer_omrade.csv"), "utf-8");
  const konflikterText = readFileSync(
    path.join(DERIVED_DIR, "postnummer_omrade_kommun_konflikter.csv"),
    "utf-8",
  );
  const kommunCsv = readFileSync(path.join(DERIVED_DIR, "postnummer_kommun.csv"), "utf-8");
  const rawPrisniva = readJson<RawRegionalPrisnivaJson>(DERIVED_DIR, "regional_prisniva.json");
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
  const generalModel = buildGeneralModel(rawGeneral, rawMetadata);
  const postcodeDelta = buildPostcodeDelta(rawEncoding);
  const filtrerad = filtreraKonfliktPostnummer(
    buildPostnummerOmrade(csvText),
    konflikterText,
    new Set(Object.keys(rawEncoding.table)),
  );
  const postnummerOmrade = filtrerad.map;
  const kommun = buildKommunData(kommunCsv);
  const prisniva = buildPrisniva(rawPrisniva);
  const budpremie = buildBudpremie(rawUtgangspris);
  const effects = buildEffects(rawEffects);

  console.log(
    `postnummer_omrade: dropped ${filtrerad.dropped.length} konflikt-postnummer not in the ` +
      `training data (${filtrerad.dropped.join(", ") || "none"}); kept ` +
      `${filtrerad.keptBecauseInTraining.length} because they occur in the training data ` +
      `(${filtrerad.keptBecauseInTraining.join(", ") || "none"}).`,
  );

  writeDataModule(
    "model.data.ts",
    `// Source: ml/artifacts/valuation-v3.1/model.json (lightgbm_booster, ` +
      `Booster.dump_model() format, ${modelData.nTrees} trees) -> compact ` +
      `pre-order-flattened tree arrays. See src/lib/vardering/types.ts (TreeArrays) ` +
      `for the layout.`,
    modelData,
  );
  writeDataModule(
    "manifest.data.ts",
    `// Source: ml/artifacts/valuation-v3.1/model.json (feature_order_out, ` +
      `numeric_features, missing_indicator_features, categorical_features, ` +
      `numeric_medians_for_imputation, categorical_fill_value_for_imputation, ` +
      `categorical_onehot_categories) and metadata.json (version, data_period, ` +
      `n_rows, final_model.cv.{mape,per_area[*].mape}, ` +
      `conformal_interval_evaluation.{target_coverage,q_overall_log,q_per_area_log}, ` +
      `production_model.smearing_factor [NOT conformal_interval_evaluation.smearing_factor]).`,
    manifest,
  );
  writeDataModule(
    "generalModel.data.ts",
    `// Source: ml/artifacts/valuation-v3.1/general_model.json (WITH fee; ` +
      `lightgbm_booster ${generalModel.nTrees} trees + preprocessing + r_inference) and ` +
      `metadata.json (regional_method.q_regional_log, ` +
      `regional_method.simulation_cv_with_fee.mape, data_period).`,
    generalModel,
  );
  writeDataModule(
    "postcodeDelta.data.ts",
    `// Source: ml/artifacts/valuation-v3.1/postcode_encoding.json ` +
      `(table, prefix_table, prefix_length; fallback_for_unseen_or_missing_postnummer = 0).`,
    postcodeDelta,
  );
  writeDataModule(
    "postnummerOmrade.data.ts",
    `// Source: data/derived/postnummer_omrade.csv (postnummer, omrade columns), minus the ` +
      `${filtrerad.dropped.length} postnummer in postnummer_omrade_kommun_konflikter.csv ` +
      `that do not occur in the training data (${filtrerad.dropped.join(", ")}).`,
    postnummerOmrade,
  );
  writeDataModule(
    "kommun.data.ts",
    `// Source: data/derived/postnummer_kommun.csv (postnummer, kommun_kod, kommun_namn, ` +
      `lan_kod). postnummer: kommun_kod -> delta-coded base-36 list, see kommunKodning.ts.`,
    kommun,
  );
  writeDataModule(
    "prisniva.data.ts",
    `// Source: data/derived/regional_prisniva.json (kommuner[*].{kod,namn,krPerM2,period} ` +
      `[12-month average], riket.{namn,krPerM2,period} [single month, aug 2026]).`,
    prisniva,
  );
  writeDataModule(
    "budpremie.data.ts",
    `// Source: data/derived/utgangspris_vs_slutpris.json ` +
      `(period, overall.{n,median_pct,mean_pct}, areas[*].{n,median_pct,mean_pct,fallback_to_overall}).`,
    budpremie,
  );
  writeDataModule(
    "effects.data.ts",
    `// Source: ml/artifacts/valuation-v3.1/effects.json ` +
      `(version, data_period, caveat_sv, reference_categories, effects[*].{id,label_sv,` +
      `effekt_procent,ci_low_procent,ci_high_procent,niva,omrade,n,signifikant}).`,
    effects,
  );

  console.log("Wrote src/lib/vardering/data/*.data.ts\n");
  console.log("Size report (generated data, raw vs gzip):");
  sizeReport("model", "model.data.ts");
  sizeReport("generalModel", "generalModel.data.ts");
  sizeReport("manifest", "manifest.data.ts");
  sizeReport("postcodeDelta", "postcodeDelta.data.ts");
  sizeReport("postnummerOmrade", "postnummerOmrade.data.ts");
  sizeReport("kommun", "kommun.data.ts");
  sizeReport("prisniva", "prisniva.data.ts");
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
