/**
 * Public valuation API. Pure with respect to the loaded generated data
 * (data.ts) — no network/DB access, safe to call from a Worker or Edge
 * Function. Server-only: never import this from a client route.
 */
import { manifest, modelData, postnummerOmrade } from "./data";
import { byggFeatures } from "./features";
import { omradeForPostnummer } from "./postnummer";
import { predictRaw } from "./tree";
import type { VarderingInput, VarderingResultat } from "./types";

export interface Prediktion {
  /** The model's raw output: predicted log(price per m² living area). */
  predLog: number;
  /** The area the postnummer maps to; null = unmapped. */
  omrade: string | null;
}

/**
 * Runs the model only, without the back-transform to SEK. Exported mainly
 * for the parity test, which compares predLog directly (the brief's
 * "log prediction to <=1e-9 absolute" criterion) before also checking the
 * back-transformed price.
 */
export function prediktera(input: VarderingInput): Prediktion {
  const omrade = omradeForPostnummer(input.postnummer, postnummerOmrade);
  const x = byggFeatures(input, omrade, manifest);
  const predLog = predictRaw(modelData.trees, x);
  return { predLog, omrade };
}

function qLogForOmrade(omrade: string | null): number {
  if (omrade !== null) {
    const q = manifest.qPerAreaLog[omrade];
    if (q !== undefined) return q;
  }
  return manifest.qOverallLog;
}

function mapeForOmrade(omrade: string | null): number {
  if (omrade !== null) {
    const mape = manifest.mapePerAreaPercent[omrade];
    if (mape !== undefined) return mape;
  }
  return manifest.mapeOverallPercent;
}

/**
 * The main entry point. Back-transform (see MODEL_CARD.md /
 * metadata.json -> production_model):
 *   total   = exp(predLog)          * smearing * living_area
 *   interval = exp(predLog +/- qLog) * smearing * living_area
 * qLog falls back to qOverallLog for a null/unmapped omrade, or for an
 * omrade with no entry in qPerAreaLog (shouldn't happen for any omrade this
 * module can produce, but handled defensively). Rounds to the nearest
 * integer SEK only at the very end.
 */
export function vardera(input: VarderingInput): VarderingResultat {
  const { predLog, omrade } = prediktera(input);
  const qLog = qLogForOmrade(omrade);

  const pricePerM2 = Math.exp(predLog) * manifest.smearingFactor;
  const total = pricePerM2 * input.boarea;
  const low = Math.exp(predLog - qLog) * manifest.smearingFactor * input.boarea;
  const high = Math.exp(predLog + qLog) * manifest.smearingFactor * input.boarea;

  return {
    varde: Math.round(total),
    intervall: { low: Math.round(low), high: Math.round(high) },
    prisPerM2: Math.round(pricePerM2),
    omrade,
    modellVersion: manifest.modelVersion,
    dataperiod: manifest.dataPeriod,
    antalForsaljningar: manifest.trainingN,
    intervallTackningProcent: manifest.targetCoveragePercent,
    typisktFelProcent: mapeForOmrade(omrade),
  };
}
