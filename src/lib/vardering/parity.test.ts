/**
 * Parity test: every row of ml/artifacts/valuation-v2/parity_fixtures.json
 * must match the exact Python predictions/intervals that file was generated
 * from (see ml/train_valuation.py's build_parity_fixtures()). This is the
 * stated correctness criterion for this module.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { prediktera, vardera } from "./vardera";
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
  "valuation-v2",
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

describe("parity against ml/artifacts/valuation-v2/parity_fixtures.json", () => {
  it("has the expected fixture count", () => {
    expect(fixtures.length).toBe(50);
  });

  it.each(fixtures.map((f, i) => [i, f] as const))("fixture %i (postnummer %s)", (i, f) => {
    const input = toInput(f.input);
    const { predLog, omrade } = prediktera(input);

    expect(Math.abs(predLog - f.expected_output.predicted_log_price_per_sqm)).toBeLessThanOrEqual(
      1e-9,
    );

    const result = vardera(input);
    expect(
      Math.abs(result.varde - Math.round(f.expected_output.predicted_total_price_sek)),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(result.intervall.low - Math.round(f.expected_output.interval_lower_sek)),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(result.intervall.high - Math.round(f.expected_output.interval_upper_sek)),
    ).toBeLessThanOrEqual(1);

    // Sanity: our own postnummer -> omrade mapping should agree with what
    // the fixture's omrade field says (it came from the same training-time
    // mapping), except that we report null (not the literal "Okänt (...)"
    // category string) for genuinely unmapped postnummer.
    if (f.input.omrade.startsWith("Okänt")) {
      expect(omrade).toBeNull();
    } else {
      expect(omrade).toBe(f.input.omrade);
    }
  });
});
