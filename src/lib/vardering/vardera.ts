/**
 * Public valuation API. Pure with respect to the loaded generated data
 * (data.ts) — no network/DB access, safe to call from a Worker or Edge
 * Function. Server-only: never import this from a client route.
 *
 * Three methods, chosen by tackning.ts from the postnummer:
 *   - 'stockholm'   : Stockholm area model (model.data.ts) with postcode_delta.
 *   - 'lan'         : kr/m² = kommun 12-month average x r(x), r from the
 *                     general model; interval x exp(+-q_regional).
 *   - 'utanfor_lan' : same, with the national average as the baseline.
 */
import type { Prisniva } from "@/types/analysis";
import {
  generalModel,
  manifest,
  modelData,
  postcodeDelta,
  postnummerOmrade,
  prisnivaData,
} from "./data";
import { byggFeatures, omradeCategoryForFeature } from "./features";
import { normaliseraPostnummer, omradeForPostnummer } from "./postnummer";
import { losTackning, type TackningLosning } from "./tackning";
import { predictRaw } from "./tree";
import type { VarderingInput, VarderingResultat } from "./types";

export interface Prediktion {
  /** The model's raw output: predicted log(price per m² living area). */
  predLog: number;
  /** The area the postnummer maps to; null = unmapped. */
  omrade: string | null;
  /** postcode_delta fed to the model (0 for an unseen postnummer). */
  postcodeDelta: number;
}

/**
 * postcode_delta for a postnummer (valuation-v3.1): the postnummer's own shrunk
 * delta if it has training sales; otherwise the shrunk delta of its 4-digit
 * prefix (neighbouring postnummer) if the prefix has training sales; otherwise
 * 0 (malformed, or no neighbours). No special confidence treatment (owner
 * decision 5). v3 used 0 for every postnummer without a training sale.
 */
export function postcodeDeltaFor(postnummer: string): number {
  const key = normaliseraPostnummer(postnummer);
  const has = (rec: Record<string, number>, k: string) =>
    Object.prototype.hasOwnProperty.call(rec, k);
  if (has(postcodeDelta.table, key)) return postcodeDelta.table[key] ?? postcodeDelta.fallback;
  const prefix = key.slice(0, postcodeDelta.prefixLength);
  if (prefix.length === postcodeDelta.prefixLength && has(postcodeDelta.prefixTable, prefix)) {
    return postcodeDelta.prefixTable[prefix] ?? postcodeDelta.fallback;
  }
  return postcodeDelta.fallback;
}

/**
 * Runs the Stockholm model only, without the back-transform to SEK, with the
 * omrade looked up from the postnummer map. Exported mainly for the parity
 * test, which compares predLog directly (the "log prediction to <=1e-9
 * absolute" criterion) before also checking the back-transformed price.
 */
export function prediktera(input: VarderingInput): Prediktion {
  return predikteraMedOmrade(input, omradeForPostnummer(input.postnummer, postnummerOmrade));
}

export function predikteraMedOmrade(input: VarderingInput, omrade: string | null): Prediktion {
  const delta = postcodeDeltaFor(input.postnummer);
  const x = byggFeatures(input, manifest, {
    omradeKategori: omradeCategoryForFeature(omrade, manifest),
    postcodeDelta: delta,
  });
  const predLog = predictRaw(modelData.trees, x);
  return { predLog, omrade, postcodeDelta: delta };
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
 * The Stockholm area model, end to end, for an explicit omrade (null = the
 * Stockholm-wide fallback). Back-transform (MODEL_CARD.md section 1):
 *   total    = exp(predLog)          * smearing * living_area
 *   interval = exp(predLog +/- qLog) * smearing * living_area
 * qLog falls back to qOverallLog for a null omrade or an omrade with no
 * entry in qPerAreaLog. Rounds to integer SEK only at the very end.
 * Exported for the parity test, which supplies the fixture's own omrade.
 */
export function varderaStockholmsmodell(
  input: VarderingInput,
  omrade: string | null,
): Omit<VarderingResultat, "tackning" | "kommun"> {
  const { predLog } = predikteraMedOmrade(input, omrade);
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

export interface RPrediktion {
  /** Booster output: log of the price per m² relative to the omrade average. */
  logG: number;
  /** exp(logG) * smearing / normaliser, before clipping. */
  rOklippt: number;
  /** r(x) = rOklippt clipped to [clipMin, clipMax]. */
  r: number;
}

/**
 * r = clip(exp(logG) * smearing / normaliser, clipMin, clipMax)
 * (MODEL_CARD.md section 6, formula 2). Pure, exported for the arithmetic
 * and clip tests: the shipped clip bounds are the min/max of r over the
 * training rows, so no real input reaches them.
 */
export function rFranLogG(
  logG: number,
  params: { smearingFactor: number; normaliser: number; clipMin: number; clipMax: number },
): { rOklippt: number; r: number } {
  const rOklippt = (Math.exp(logG) * params.smearingFactor) / params.normaliser;
  return { rOklippt, r: Math.min(Math.max(rOklippt, params.clipMin), params.clipMax) };
}

/** r(x) from the general model (MODEL_CARD.md section 6, formulas 1-2). */
export function beraknaR(input: VarderingInput): RPrediktion {
  const x = byggFeatures(input, generalModel);
  const logG = predictRaw(generalModel.trees, x);
  return { logG, ...rFranLogG(logG, generalModel) };
}

const KANDA_SVAR = ["ja", "nej"] as const;

/**
 * r(x) as used for pricing: beraknaR(), except that an 'okant' hiss/balkong
 * is held between the r values of its known answers. The general model's
 * monotone constraint covers only the ja/nej columns, so 'okant' could
 * otherwise price above a confirmed lift (+1,9 % at 12352 in review) — an
 * unknown must never be worth more than every known answer (CLAUDE.md: no
 * effect against the obvious direction). beraknaR() itself stays the raw
 * model output so it keeps matching the Python parity fixtures.
 */
export function rForPrissattning(input: VarderingInput): number {
  const { r } = beraknaR(input);
  if (input.hiss !== "okant" && input.balkong !== "okant") return r;
  const hissSvar = input.hiss === "okant" ? KANDA_SVAR : [input.hiss];
  const balkongSvar = input.balkong === "okant" ? KANDA_SVAR : [input.balkong];
  const kandaR = hissSvar.flatMap((hiss) =>
    balkongSvar.map((balkong) => beraknaR({ ...input, hiss, balkong }).r),
  );
  return Math.min(Math.max(r, Math.min(...kandaR)), Math.max(...kandaR));
}

/**
 * The published price level a regional estimate is scaled to: the kommun's
 * 12-month average for 'lan', the national average for 'utanfor_lan'.
 * Null only if the data has no entry (cannot happen for a kommun in
 * Stockholms län — data.ts asserts it at import).
 */
function prisnivaFor(losning: TackningLosning): Prisniva | null {
  if (losning.tackning === "lan") {
    const punkt = losning.kommunKod !== null ? prisnivaData.kommuner[losning.kommunKod] : undefined;
    if (!punkt) return null;
    return {
      region: punkt.namn,
      krPerM2: punkt.krPerM2,
      period: punkt.period,
      kalla: prisnivaData.kalla,
    };
  }
  return {
    region: prisnivaData.riket.namn,
    krPerM2: prisnivaData.riket.krPerM2,
    period: prisnivaData.riket.period,
    kalla: prisnivaData.kalla,
  };
}

/**
 * The regional method, end to end (MODEL_CARD.md section 6):
 *   kr/m^2 = A * r(x);  pris = kr/m^2 * boarea;  interval = pris * exp(+-q).
 */
function varderaRegionalt(
  input: VarderingInput,
  losning: TackningLosning,
  prisniva: Prisniva,
): VarderingResultat {
  const r = rForPrissattning(input);
  const krPerM2 = prisniva.krPerM2 * r;
  const total = krPerM2 * input.boarea;
  const q = generalModel.qRegionalLog;
  return {
    varde: Math.round(total),
    intervall: { low: Math.round(total * Math.exp(-q)), high: Math.round(total * Math.exp(q)) },
    prisPerM2: Math.round(krPerM2),
    tackning: losning.tackning,
    omrade: null,
    kommun: losning.kommun,
    prisniva,
    modellVersion: generalModel.version,
    dataperiod: generalModel.dataPeriod,
    antalForsaljningar: generalModel.trainingN,
    intervallTackningProcent: generalModel.targetCoveragePercent,
    typisktFelProcent: generalModel.mapeRegionalPercent,
  };
}

/**
 * The main entry point. Returns null when no valuation is possible: the
 * postnummer is empty or not five digits (e.g. an anonymised report).
 */
export function vardera(input: VarderingInput): VarderingResultat | null {
  const losning = losTackning(input.postnummer);
  if (!losning) return null;

  if (losning.tackning === "stockholm") {
    return {
      ...varderaStockholmsmodell(input, losning.omrade),
      tackning: "stockholm",
      kommun: losning.kommun,
    };
  }

  const prisniva = prisnivaFor(losning);
  if (!prisniva) {
    throw new Error(
      `Vardering: no price level for kommun ${losning.kommunKod ?? "?"} (${losning.kommun ?? "?"})`,
    );
  }
  return varderaRegionalt(input, losning, prisniva);
}
