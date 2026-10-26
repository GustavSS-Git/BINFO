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
 *  - värme och vatten: Nils Holgersson-rapporten 2026, per m² boarea och
 *    månad (räknas bara med när de inte ingår i avgiften);
 *  - bredband: Binfos uppskattning (ingen publicerad källa).
 *
 * TODO: unverified placeholder — bredbandsbeloppet (349 kr) saknar källa.
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
    `Nils Holgersson 2026: ${perM2} kr/m² boarea och månad × ${boarea} m² boarea`,
  );
}

/** Vatten — kr per m² boarea och månad (Nils Holgersson 2026, VA Stockholm). */
export function schablonVatten(boarea: number): Figure {
  const perM2 = regelvarde("schablon_vatten_per_m2");
  return schablon(
    perM2 * boarea,
    `Nils Holgersson 2026: ${perM2} kr/m² boarea och månad × ${boarea} m² boarea`,
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
    vatten: schablonVatten(boarea),
    bredband: schablonBredband(),
    forsakring: schablonForsakring(personer),
  };
}
