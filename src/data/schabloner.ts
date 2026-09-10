/**
 * Schabloner för boendekostnader.
 *
 * TODO: ersätt med riktig data från SCB/Energimyndigheten i backend.
 * Alla funktioner returnerar kronor per månad.
 */

export type SchablonId = "el" | "varme" | "vatten" | "bredband" | "forsakring";

/** Hushållsel — skalar med boarea. */
export function schablonEl(boarea: number): number {
  return 250 + 8 * boarea;
}

/** Värme — skalar med boarea, starkare koefficient än el. */
export function schablonVarme(boarea: number): number {
  return 180 + 14 * boarea;
}

/** Vatten — skalar med antal personer i hushållet. */
export function schablonVatten(personer: number): number {
  return 120 * Math.max(1, personer);
}

/** Bredband — platt belopp. */
export function schablonBredband(): number {
  return 349;
}

/** Hemförsäkring inkl. bostadsrättstillägg — skalar med boarea. */
export function schablonForsakring(boarea: number): number {
  return 120 + 3 * boarea;
}

export function schabloner(boarea: number, personer: number): Record<SchablonId, number> {
  return {
    el: schablonEl(boarea),
    varme: schablonVarme(boarea),
    vatten: schablonVatten(personer),
    bredband: schablonBredband(),
    forsakring: schablonForsakring(boarea),
  };
}
