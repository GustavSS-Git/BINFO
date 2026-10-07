/**
 * Parity tests against the exact Python predictions the valuation-v3
 * artefacts were generated with:
 *   - parity_fixtures.json         : Stockholm area model (log prediction
 *     <= 1e-9 absolute, SEK exact after rounding, postcode_delta exact).
 *   - general_parity_fixtures.json : r(x) of the general model (log_g and r).
 * This is the stated correctness criterion for this module.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { beraknaR, prediktera, predikteraMedOmrade, varderaStockholmsmodell } from "./vardera";
import type { VarderingInput } from "./types";

const here = path.dirname(fileURLToPath(import.meta.url));

interface FixtureInput {
  postnummer: string;
  omrade: string;
  boarea: number;
  antalRum: number | null;
  manadsavgift: number | null;
  vaning: number | null;
  byggar: number | null;
  hiss: "ja" | "nej" | "okant";
  balkong: "ja" | "nej" | "okant";
}

interface Fixture {
  input: FixtureInput;
  expected_output: {
    postcode_delta: number;
    predicted_total_price_sek: number;
    predicted_log_price_per_sqm: number;
    interval_lower_sek: number;
    interval_upper_sek: number;
    q_log_used: number;
  };
}

const FIXTURES_PATH = path.resolve(
  here,
  "..",
  "..",
  "..",
  "ml",
  "artifacts",
  "valuation-v3",
  "parity_fixtures.json",
);

const fixtures: Fixture[] = JSON.parse(readFileSync(FIXTURES_PATH, "utf-8"));

function toInput(f: FixtureInput): VarderingInput {
  const input: VarderingInput = {
    postnummer: f.postnummer,
    boarea: f.boarea,
    antalRum: f.antalRum ?? NaN,
    hiss: f.hiss,
    balkong: f.balkong,
  };
  if (f.manadsavgift !== null) input.manadsavgift = f.manadsavgift;
  if (f.vaning !== null) input.vaning = f.vaning;
  if (f.byggar !== null) input.byggar = f.byggar;
  return input;
}

describe("parity against ml/artifacts/valuation-v3/parity_fixtures.json", () => {
  it("has the expected fixture count", () => {
    expect(fixtures.length).toBe(52);
  });

  it.each(fixtures.map((f, i) => [i, f] as const))("fixture %i (postnummer %s)", (i, f) => {
    const input = toInput(f.input);
    // The fixture's own omrade (training-time mapping), "Okänt" -> null.
    const fixtureOmrade = f.input.omrade.startsWith("Okänt") ? null : f.input.omrade;
    const { predLog, postcodeDelta } = predikteraMedOmrade(input, fixtureOmrade);
    const { omrade } = prediktera(input);

    expect(postcodeDelta).toBe(f.expected_output.postcode_delta);
    expect(Math.abs(predLog - f.expected_output.predicted_log_price_per_sqm)).toBeLessThanOrEqual(
      1e-9,
    );

    // End to end with the fixture's own omrade (the synthetic unseen-postnummer
    // fixtures carry an omrade that 99999 itself does not map to).
    const result = varderaStockholmsmodell(input, fixtureOmrade);
    expect(result.varde).toBe(Math.round(f.expected_output.predicted_total_price_sek));
    expect(result.intervall.low).toBe(Math.round(f.expected_output.interval_lower_sek));
    expect(result.intervall.high).toBe(Math.round(f.expected_output.interval_upper_sek));

    // Our own postnummer -> omrade mapping agrees with the fixture's omrade,
    // except that we report null (not the literal "Okänt (...)" category
    // string) for genuinely unmapped postnummer. The synthetic 99999
    // fixtures are excluded: their omrade is a label, not a mapping.
    if (f.input.postnummer !== "99999") {
      expect(omrade).toBe(fixtureOmrade);
    }
  });

  it("the synthetic unseen-postnummer fixtures get postcode_delta 0 (owner decision 5)", () => {
    const unseen = fixtures.filter((f) => f.input.postnummer === "99999");
    expect(unseen.length).toBe(2);
    for (const f of unseen) {
      expect(prediktera(toInput(f.input)).postcodeDelta).toBe(0);
    }
  });
});

interface GeneralFixture {
  input: Omit<FixtureInput, "postnummer" | "omrade">;
  expected_output: { log_g: number; r_unclipped: number; r: number };
}

const generalFixtures: GeneralFixture[] = JSON.parse(
  readFileSync(path.join(path.dirname(FIXTURES_PATH), "general_parity_fixtures.json"), "utf-8"),
);

describe("parity against ml/artifacts/valuation-v3/general_parity_fixtures.json", () => {
  it("has the expected fixture count", () => {
    expect(generalFixtures.length).toBe(52);
  });

  it.each(generalFixtures.map((f, i) => [i, f] as const))("fixture %i", (_i, f) => {
    const { logG, rOklippt, r } = beraknaR(toInput({ ...f.input, postnummer: "", omrade: "" }));
    expect(Math.abs(logG - f.expected_output.log_g)).toBeLessThanOrEqual(1e-9);
    expect(rOklippt).toBeCloseTo(f.expected_output.r_unclipped, 12);
    expect(r).toBeCloseTo(f.expected_output.r, 12);
  });
});
