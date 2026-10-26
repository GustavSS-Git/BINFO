import { describe, expect, it } from "vitest";
import { lasMaxTokens, lasModellPerSteg } from "./modellPerSteg";

describe("lasModellPerSteg", () => {
  it("falls back to the standard model for both stages", () => {
    expect(lasModellPerSteg({}, "std")).toEqual({ extraktion: "std", bedomning: "std" });
  });
  it("ANTHROPIC_MODEL applies to both when no judging override is set", () => {
    expect(lasModellPerSteg({ ANTHROPIC_MODEL: "a" }, "std")).toEqual({
      extraktion: "a",
      bedomning: "a",
    });
  });
  it("ANTHROPIC_MODEL_BEDOMNING overrides only judging", () => {
    expect(
      lasModellPerSteg({ ANTHROPIC_MODEL: "a", ANTHROPIC_MODEL_BEDOMNING: "b" }, "std"),
    ).toEqual({ extraktion: "a", bedomning: "b" });
    expect(lasModellPerSteg({ ANTHROPIC_MODEL_BEDOMNING: "b" }, "std")).toEqual({
      extraktion: "std",
      bedomning: "b",
    });
  });
  it("blank values count as unset", () => {
    expect(
      lasModellPerSteg({ ANTHROPIC_MODEL: " ", ANTHROPIC_MODEL_BEDOMNING: "" }, "std"),
    ).toEqual({ extraktion: "std", bedomning: "std" });
  });
});

describe("lasMaxTokens", () => {
  it("unset or blank = undefined (the stage default)", () => {
    expect(lasMaxTokens({}, "X")).toBeUndefined();
    expect(lasMaxTokens({ X: " " }, "X")).toBeUndefined();
  });
  it("parses a positive integer", () => {
    expect(lasMaxTokens({ X: "32000" }, "X")).toBe(32000);
  });
  it("rejects anything else", () => {
    for (const v of ["0", "-1", "1.5", "abc", "128001"]) {
      expect(() => lasMaxTokens({ X: v }, "X")).toThrow(/X måste vara/);
    }
  });
});
