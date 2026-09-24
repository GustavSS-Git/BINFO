/**
 * LightGBM tree evaluation over the compact TreeArrays representation
 * (see types.ts). Pure, no I/O.
 *
 * The shipped model.json only ever exercises `<=` numerical splits with
 * missingType "None" and defaultLeft true on every node (asserted by
 * scripts/buildVarderingData.ts when the compact format is generated, and
 * re-checked by src/lib/vardering/dataSync.test.ts). This walker still
 * implements LightGBM's general per-split missing-value routing rather than
 * hard-coding that fact, so a future retrain that *does* vary these fields
 * would be handled correctly without changing this file — see the
 * "uncertain" note in the handback report about the exact Zero-missing-type
 * semantics, which this artefact never exercises.
 */
import type { TreeArrays } from "./types";

/**
 * Walks one tree for one feature row, returns its leaf contribution
 * (already shrinkage-applied, per LightGBM's dump_model format — summing
 * this across all trees, with no separate bias/init-score term for this
 * objective, gives the raw model output).
 */
export function evalTree(tree: TreeArrays, x: readonly number[]): number {
  let idx = 0; // root is always index 0 (see types.ts)

  while (tree.feature[idx] !== -1) {
    const featureIdx = tree.feature[idx];
    if (featureIdx === undefined) {
      throw new Error(`Vardering: tree node ${idx} has no feature index`);
    }
    const splitValue = tree.value[idx];
    const missingType = tree.missingType[idx];
    const defaultLeft = tree.defaultLeft[idx];
    if (splitValue === undefined || missingType === undefined || defaultLeft === undefined) {
      throw new Error(`Vardering: malformed tree node ${idx}`);
    }

    const v = x[featureIdx];
    if (v === undefined) {
      throw new Error(`Vardering: feature vector too short, missing index ${featureIdx}`);
    }

    let goLeft: boolean;
    if (Number.isNaN(v)) {
      // LightGBM routes NaN input by the node's recorded default direction
      // whenever the split cares about missing values at all (missingType
      // "NaN" or "Zero"); with missingType "None" the split has no missing
      // handling configured and a NaN simply fails the "<=" comparison
      // (goes right), matching plain IEEE-754 comparison semantics.
      goLeft = missingType === 0 ? false : defaultLeft === 1;
    } else if (missingType === 1 && v === 0) {
      // "Zero" missing type: LightGBM also treats an exact 0 as missing
      // (relevant for libsvm-style sparse training data). Not exercised by
      // this artefact (every node has missingType "None" — see the file
      // header above); kept for completeness against a future retrain.
      goLeft = defaultLeft === 1;
    } else {
      goLeft = v <= splitValue;
    }

    const next = goLeft ? tree.left[idx] : tree.right[idx];
    if (next === undefined) {
      throw new Error(`Vardering: tree node ${idx} missing ${goLeft ? "left" : "right"} child`);
    }
    idx = next;
  }

  const leafValue = tree.value[idx];
  if (leafValue === undefined) {
    throw new Error(`Vardering: leaf node ${idx} has no value`);
  }
  return leafValue;
}

/** Sums every tree's leaf contribution for one feature row. No init score /
 *  bias term: this model's dump_model has none (average_output: false,
 *  single-class regression, no init_score key in the booster dump). */
export function predictRaw(trees: readonly TreeArrays[], x: readonly number[]): number {
  let sum = 0;
  for (const tree of trees) {
    sum += evalTree(tree, x);
  }
  return sum;
}
