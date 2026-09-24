/**
 * Valuation drivers (Varderingsdrivare[]) for one apartment, built from
 * ml/artifacts/valuation-v2/effects.json (an interpretable OLS companion to
 * the LightGBM production model — never used for point predictions, only
 * for "why" explanations). Pure, no I/O.
 *
 * Selection rules (product decision, confirmed 2026-09-24 — see
 * hamtaVarderingsdrivareCaveat() for the caveat text shown alongside these
 * in the UI):
 *   1. Only effects with signifikant: true (95% CI excludes 0).
 *   2. Never an "=okant" effect ("Hiss okänt"/"Balkong okänt") — an unknown
 *      answer in the årsredovisning is not a property of the apartment
 *      itself, so it is never surfaced as a driver, regardless of the
 *      apartment's own hiss/balkong Tristate value.
 *   3. "fee_per_sqm+100" is excluded: its positive sign ("higher fee ->
 *      higher price") is most likely confounded with newer/better-amenity
 *      buildings rather than a real causal driver, and showing it would
 *      mislead a buyer into reading a higher avgift as good news. Kept in
 *      the generated data file for transparency/future use, just excluded
 *      here.
 *   4. hiss 'nej': the area-specific `elevator=nej` effect for the
 *      apartment's omrade if one exists and is significant, else the
 *      city-wide `elevator=nej` effect. hiss 'ja' is the reference category
 *      (no driver — the effect is *by construction* zero relative to
 *      itself) and hiss 'okant' shows nothing (rule 2). Same pattern for
 *      balkong / `balcony=nej` — today only a (non-significant) city-wide
 *      `balcony=nej` effect exists, so it drops out under rule 1.
 *   5. The continuous effects (rooms+1, floor+1, build_year+10, boarea+10)
 *      are always included as general, city-wide, unscaled "all else equal"
 *      information (never adjusted to this apartment's actual room count /
 *      floor / build year / area), ordered after the categorical ones.
 *   6. effektProcent and the CI bounds are rounded to one decimal place for
 *      display here; the generated data file keeps full precision.
 */
import { effectsData } from "./data";
import type { Effect, Tristate } from "./types";
import type { Varderingsdrivare } from "@/types/analysis";

/** IDs deliberately never shown as a driver — see rule 3 above. */
const EXCLUDED_EFFECT_IDS = new Set<string>(["fee_per_sqm+100"]);

/** Continuous, always-shown, city-wide effects — see rule 5 above. Order
 *  here is the display order. */
const CONTINUOUS_EFFECT_IDS = ["rooms+1", "floor+1", "build_year+10", "boarea+10"];

function isOkantEffect(effect: Effect): boolean {
  return effect.id.endsWith("=okant");
}

function eligible(effect: Effect): boolean {
  return effect.signifikant && !isOkantEffect(effect) && !EXCLUDED_EFFECT_IDS.has(effect.id);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function toDrivare(effect: Effect): Varderingsdrivare {
  return {
    label: effect.labelSv,
    effektProcent: round1(effect.effektProcent),
    intervallProcent: { low: round1(effect.ciLowProcent), high: round1(effect.ciHighProcent) },
    niva: effect.niva,
  };
}

/**
 * hiss/balkong 'nej' -> area-specific effect for `omrade` when it exists
 * and is eligible, else the city-wide one. 'ja' (reference category) and
 * 'okant' (rule 2) never produce a driver.
 */
function categoricalDriver(
  tristateValue: Tristate,
  effectIdNej: string,
  omrade: string | null,
): Varderingsdrivare | null {
  if (tristateValue !== "nej") return null;

  const candidates = effectsData.effects.filter((e) => e.id === effectIdNej && eligible(e));
  const areaSpecific =
    omrade !== null
      ? candidates.find((e) => e.niva === "omrade" && e.omrade === omrade)
      : undefined;
  const cityWide = candidates.find((e) => e.niva === "stad");
  const chosen = areaSpecific ?? cityWide;
  return chosen ? toDrivare(chosen) : null;
}

/** Selects the valuation drivers relevant to this apartment: categorical
 *  (hiss, then balkong) drivers first, then the continuous city-wide
 *  effects in their effects.json order. */
export function drivareForInput(
  input: { hiss: Tristate; balkong: Tristate },
  omrade: string | null,
): Varderingsdrivare[] {
  const result: Varderingsdrivare[] = [];

  const hissDriver = categoricalDriver(input.hiss, "elevator=nej", omrade);
  if (hissDriver) result.push(hissDriver);

  const balkongDriver = categoricalDriver(input.balkong, "balcony=nej", omrade);
  if (balkongDriver) result.push(balkongDriver);

  for (const id of CONTINUOUS_EFFECT_IDS) {
    const effect = effectsData.effects.find((e) => e.id === id && e.niva === "stad" && eligible(e));
    if (effect) result.push(toDrivare(effect));
  }

  return result;
}

/** ml/artifacts/valuation-v2/effects.json's caveat_sv, verbatim — meant to
 *  be shown next to the drivers list in the UI ("Det här är genomsnittliga
 *  effekter för Stockholm..."). */
export function hamtaVarderingsdrivareCaveat(): string {
  return effectsData.caveatSv;
}
