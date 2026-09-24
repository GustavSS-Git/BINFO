/**
 * Offline valuation model (task 4f) — public API.
 *
 * Server-only: this module loads ~460 KB of generated model data at import
 * time and is meant to run in a Cloudflare Worker (TanStack server
 * functions) or the Supabase Edge Function, never in the browser. Do not
 * import it from src/routes/** or any other client code. Wiring it into the
 * analysis pipeline (src/lib/analysis/**, src/server/**) is a later step,
 * not done here.
 */
export { normaliseraPostnummer, omradeForPostnummer, harKantPrefix } from "./postnummer";
export { byggFeatures, omradeCategoryForFeature } from "./features";
export { vardera, prediktera } from "./vardera";
export type { Prediktion } from "./vardera";
export { budpremieForOmrade } from "./budpremie";
export { drivareForInput, hamtaVarderingsdrivareCaveat } from "./drivare";
export type { VarderingInput, VarderingResultat, Tristate } from "./types";
// The loaded postnummer -> omrade map itself, for callers (task 4g's
// ModellPrisdatakalla) that need to run their own scope check (e.g.
// harKantPrefix) ahead of calling vardera() — vardera() has no "out of
// scope" rejection path of its own; that decision belongs to the caller.
export { postnummerOmrade } from "./data";
