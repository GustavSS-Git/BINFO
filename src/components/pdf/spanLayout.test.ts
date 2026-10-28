import { describe, expect, it } from "vitest";
import { layoutSpanBar, SPAN_LABEL_BREDD } from "@/components/pdf/spanLayout";

const m = (
  label: string,
  varde: number,
  ton: "utgangspris" | "vardering" | "bud" | "liknande",
) => ({
  label,
  varde,
  text: String(varde),
  ton,
});

describe("layoutSpanBar", () => {
  it("lägger markörerna efter värde, växelvis över och under stapeln, inom stapelns bredd", () => {
    const l = layoutSpanBar(
      4_990_000,
      6_100_000,
      [m("Utgångspris", 5_000_000, "utgangspris"), m("Binfos värdering", 5_550_000, "vardering")],
      480,
    );
    expect(l.markorer.map((x) => [x.label, x.sida])).toEqual([
      ["Utgångspris", "over"],
      ["Binfos värdering", "under"],
    ]);
    expect(l.markorer[0]!.x).toBeLessThan(l.markorer[1]!.x);
    for (const x of l.markorer) {
      expect(x.x).toBeGreaterThan(0);
      expect(x.x).toBeLessThan(480);
      expect(x.labelLeft).toBeGreaterThanOrEqual(0);
      expect(x.labelLeft + SPAN_LABEL_BREDD).toBeLessThanOrEqual(480);
    }
    expect(l.spannVanster + l.spannBredd).toBeLessThan(480);
  });

  it("flyttar en etikett som skulle överlappa sin granne på samma sida till yttre raden", () => {
    const l = layoutSpanBar(
      100,
      200,
      [
        m("A", 150, "utgangspris"),
        m("B", 152, "bud"),
        m("C", 153, "vardering"),
        m("D", 154, "liknande"),
      ],
      480,
    );
    expect(l.markorer.some((x) => x.rad === 1)).toBe(true);
    expect(l.radOver + l.radUnder).toBeGreaterThan(2);
  });

  it("klarar ett enda värde utan bredd (spann noll)", () => {
    const l = layoutSpanBar(100, 100, [m("A", 100, "vardering")], 300);
    expect(Number.isFinite(l.markorer[0]!.x)).toBe(true);
  });
});
