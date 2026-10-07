/**
 * Offline valuation model (task 4f) — public API.
 *
 * Server-only: this module loads ~3.5 MB of generated model data at import
 * time and is meant to run in a Cloudflare Worker (TanStack server
 * functions) or the Supabase Edge Function, never in the browser. Do not
 * import it from src/routes/** or any other client code. It is wired into
 * the analysis pipeline through src/lib/analysis/prisdata.ts.
 */
export { normaliseraPostnummer, omradeForPostnummer, harKantPrefix } from "./postnummer";
export { byggFeatures, omradeCategoryForFeature } from "./features";
export { vardera, prediktera, varderaStockholmsmodell, beraknaR } from "./vardera";
export type { Prediktion, RPrediktion } from "./vardera";
export { losTackning } from "./tackning";
export type { TackningLosning } from "./tackning";
export { budpremieForOmrade } from "./budpremie";
export { drivareForInput, hamtaVarderingsdrivareCaveat } from "./drivare";
export type { VarderingInput, VarderingResultat, Tristate } from "./types";
