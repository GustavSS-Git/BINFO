import type { Figure } from "@/types/analysis";

/**
 * Schabloner för boendekostnader — samma formler som redan används i
 * den tidigare src/data/schabloner.ts (borttagen), men här paketerade som Figure så
 * att source/schablonBasis följer med talet in i analysen istället för att
 * bara vara ett bart nummer i UI:t.
 *
 * TODO: unverified placeholder — konstanterna nedan är inte hämtade från
 * SCB eller Energimyndigheten. Ersätt med sourcad data innan lansering.
 */

export type SchablonId = "el" | "varme" | "vatten" | "bredband" | "forsakring";

function schablon(value: number, schablonBasis: string): Figure {
  return {
    value: Math.round(value),
    unit: "kr/man",
    source: "schablon",
    schablonBasis,
  };
}

/** Hushållsel — skalar med boarea. */
export function schablonEl(boarea: number): Figure {
  return schablon(250 + 8 * boarea, `250 kr + 8 kr/m² × ${boarea} m² boarea`);
}

/** Värme — skalar med boarea, starkare koefficient än el. */
export function schablonVarme(boarea: number): Figure {
  return schablon(180 + 14 * boarea, `180 kr + 14 kr/m² × ${boarea} m² boarea`);
}

/** Vatten — skalar med antal personer i hushållet, golv på 1 person. */
export function schablonVatten(personer: number): Figure {
  const antal = Math.max(1, personer);
  return schablon(120 * antal, `120 kr × ${antal} person(er)`);
}

/** Bredband — platt belopp. */
export function schablonBredband(): Figure {
  return schablon(349, "Platt belopp");
}

/** Hemförsäkring inkl. bostadsrättstillägg — skalar med boarea. */
export function schablonForsakring(boarea: number): Figure {
  return schablon(120 + 3 * boarea, `120 kr + 3 kr/m² × ${boarea} m² boarea`);
}

export function schabloner(boarea: number, personer: number): Record<SchablonId, Figure> {
  return {
    el: schablonEl(boarea),
    varme: schablonVarme(boarea),
    vatten: schablonVatten(personer),
    bredband: schablonBredband(),
    forsakring: schablonForsakring(boarea),
  };
}
