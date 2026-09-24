import { describe, expect, it } from "vitest";
import { evalTree, predictRaw } from "./tree";
import type { TreeArrays } from "./types";

/**
 * A tiny hand-built 3-node tree: root splits on feature 0 at threshold 5;
 * left leaf = 1, right leaf = 2. Node 0 = root, node 1 = left leaf,
 * node 2 = right leaf (pre-order, matching flattenTree()'s layout).
 */
const SIMPLE_TREE: TreeArrays = {
  feature: [0, -1, -1],
  value: [5, 1, 2],
  left: [1, -1, -1],
  right: [2, -1, -1],
  missingType: [0, 0, 0],
  defaultLeft: [1, 1, 1],
};

describe("evalTree", () => {
  it("routes left when value <= threshold", () => {
    expect(evalTree(SIMPLE_TREE, [5])).toBe(1);
    expect(evalTree(SIMPLE_TREE, [0])).toBe(1);
  });

  it("routes right when value > threshold", () => {
    expect(evalTree(SIMPLE_TREE, [5.0001])).toBe(2);
    expect(evalTree(SIMPLE_TREE, [10])).toBe(2);
  });

  it("routes a NaN with missingType 'None' to the right (fails the <= comparison)", () => {
    expect(evalTree(SIMPLE_TREE, [NaN])).toBe(2);
  });

  it("routes a NaN by defaultLeft when missingType is 'NaN'", () => {
    const tree: TreeArrays = { ...SIMPLE_TREE, missingType: [2, 0, 0], defaultLeft: [0, 1, 1] };
    expect(evalTree(tree, [NaN])).toBe(2); // defaultLeft = 0 -> right
    const treeLeft: TreeArrays = { ...SIMPLE_TREE, missingType: [2, 0, 0], defaultLeft: [1, 1, 1] };
    expect(evalTree(treeLeft, [NaN])).toBe(1); // defaultLeft = 1 -> left
  });

  it("routes an exact 0 by defaultLeft when missingType is 'Zero'", () => {
    const tree: TreeArrays = { ...SIMPLE_TREE, missingType: [1, 0, 0], defaultLeft: [0, 1, 1] };
    expect(evalTree(tree, [0])).toBe(2); // defaultLeft = 0 -> right, even though 0 <= 5
  });
});

describe("predictRaw", () => {
  it("sums leaf contributions across all trees", () => {
    const treeA: TreeArrays = SIMPLE_TREE;
    const treeB: TreeArrays = { ...SIMPLE_TREE, value: [5, 10, 20] };
    expect(predictRaw([treeA, treeB], [0])).toBe(1 + 10);
    expect(predictRaw([treeA, treeB], [100])).toBe(2 + 20);
  });

  it("returns 0 for an empty tree list", () => {
    expect(predictRaw([], [0])).toBe(0);
  });
});
