import type { Figure } from "@/types/analysis";
import { KONSUMENTVERKET_2026, hittaRegel } from "@/lib/kalkyl/regler";

function regelvarde(id: string): number {
  const v = hittaRegel(id)?.varde;
  if (typeof v !== "number") throw new Error(`Saknar regel: ${id}`);
  return v;
}

/**
 * Schabloner för boendekostnader, paketerade som Figure så att
 * source/schablonBasis följer med talet. Värdena kommer från regelregistret
 * (src/lib/kalkyl/regler.ts), som är enda källan:
 *  - hushållsel och hemförsäkring: Konsumentverket, Hushållskostnader 2026,
 *    per antal personer i hushållet (ingen del per m²);
 *  - värme (inklusive energin för varmvatten): Nils Holgersson 2026, per m²
 *    boarea och månad (räknas bara med när värmen inte ingår i avgiften);
 *  - vatten: 135 kr per person och månad (Konsumentverket 2026, 45,61 m³ per
 *    person och år × Nils Holgersson 2026, Stockholm, ca 35,54 kr/m³),
 *    räknas bara med när vatten inte ingår i avgiften;
 *  - bredband: Binfos uppskattning (ingen publicerad källa).
 *
 * TODO: unverified placeholder — bredbandsbeloppet (349 kr) saknar källa.
 */

/** Field hints on /bolanekalkyl; schabloner.test.ts checks that they match
 *  what the schablons depend on (boarea: värme; persons: el, vatten, försäkring). */
export const BOAREA_HINT = "Styr schablonen för värme";
export const PERSONER_HINT = "Styr schablonerna för hushållsel, vatten och hemförsäkring";

export type SchablonId = "el" | "varme" | "vatten" | "bredband" | "forsakring";

function schablon(value: number, schablonBasis: string): Figure {
  return {
    value: Math.round(value),
    unit: "kr/man",
    source: "schablon",
    schablonBasis,
  };
}

/** Hushållsstorlek som tabellen kan slå upp: heltal, minst 1, högst tabellens sista kolumn. */
function personerForTabell(personer: number): { antal: number; avkortad: boolean } {
  const heltal = Math.max(1, Math.trunc(personer) || 1);
  const max = KONSUMENTVERKET_2026.maxPersoner;
  return { antal: Math.min(heltal, max), avkortad: heltal > max };
}

function konsumentverketBasis(namn: string, personer: number): string {
  const { antal, avkortad } = personerForTabell(personer);
  return avkortad
    ? `Konsumentverket 2026, ${namn}, hushåll med ${antal} personer (tabellen slutar där; Binfos antagande att större hushåll har samma belopp)`
    : `Konsumentverket 2026, ${namn}, hushåll med ${antal} ${antal === 1 ? "person" : "personer"}`;
}

/** Hushållsel — Konsumentverket 2026 per antal personer. */
export function schablonEl(personer: number): Figure {
  const { antal } = personerForTabell(personer);
  return schablon(
    KONSUMENTVERKET_2026.gemensamma.hushallsel[antal - 1] ?? 0,
    konsumentverketBasis("hushållsel", personer),
  );
}

/** Värme — kr per m² boarea och månad (Nils Holgersson 2026, fjärrvärme Stockholm). */
export function schablonVarme(boarea: number): Figure {
  const perM2 = regelvarde("schablon_varme_per_m2");
  return schablon(
    perM2 * boarea,
    `Nils Holgersson 2026 (inklusive energin för varmvatten): ${perM2} kr/m² boarea och månad × ${boarea} m² boarea`,
  );
}

/** Vatten — kr per person och månad (Konsumentverket 2026 × Nils Holgersson 2026, Stockholm). */
export function schablonVatten(personer: number): Figure {
  const perPerson = regelvarde("schablon_vatten_per_person");
  const antal = Math.max(1, Math.trunc(personer) || 1);
  return schablon(
    perPerson * antal,
    `Konsumentverket 2026 (45,61 m³ per person och år) × Nils Holgersson 2026 (Stockholm, ca 35,54 kr/m³): ${perPerson} kr per person och månad × ${antal} ${antal === 1 ? "person" : "personer"}`,
  );
}

/** Bredband — platt belopp, Binfos uppskattning. */
export function schablonBredband(): Figure {
  return schablon(regelvarde("schablon_bredband"), "Binfos uppskattning: platt belopp");
}

/** Hemförsäkring — Konsumentverket 2026 per antal personer (hyresrätt, utan bostadsrättstillägg). */
export function schablonForsakring(personer: number): Figure {
  const { antal } = personerForTabell(personer);
  return schablon(
    KONSUMENTVERKET_2026.gemensamma.hemforsakring[antal - 1] ?? 0,
    `${konsumentverketBasis("hemförsäkring", personer)}; bostadsrättstillägg ingår inte`,
  );
}

export function schabloner(boarea: number, personer: number): Record<SchablonId, Figure> {
  return {
    el: schablonEl(personer),
    varme: schablonVarme(boarea),
    vatten: schablonVatten(personer),
    bredband: schablonBredband(),
    forsakring: schablonForsakring(personer),
  };
}
