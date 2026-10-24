import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AVGIFT_BETA_LOG_PER_KR_M2 } from "./prognosantaganden";

describe("prognosantaganden", () => {
  it("β matches the shipped model artifact (valuation-v3.1 metadata.json)", () => {
    const metadata = JSON.parse(
      readFileSync("ml/artifacts/valuation-v3.1/metadata.json", "utf8"),
    ) as { effects_fee_per_sqm: { fee_per_sqm_per_kr_beta_log: number } };
    expect(AVGIFT_BETA_LOG_PER_KR_M2).toBe(
      metadata.effects_fee_per_sqm.fee_per_sqm_per_kr_beta_log,
    );
  });
});
