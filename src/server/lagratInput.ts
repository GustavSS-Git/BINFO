/**
 * Normalisering av en rads LAGRADE property_input innan det används.
 *
 * Egen modul med flit: både läsvägen (analys.ts) och jobbkörningen
 * (steg.ts, som bundlas till Edge-funktionen) behöver den, och steg.ts ska
 * inte dra in hela det publika API:t i analys.ts bara för en hjälpfunktion.
 */

import type { PropertyInput } from "@/types/analysis";
import { PropertyInputSchema } from "@/lib/analysis/schema";
import type { AnalysRad } from "./portar";

/**
 * Normaliserar en rads lagrade `property_input` innan det går in i
 * `assembleraAnalys`. Lagrat JSON är skrivet av den kodversion som fanns när
 * raden skapades — inte nödvändigtvis den som nu läser det. När ett fält tas
 * bort ur kontraktet (som `antalLantagare` i Fas 1 Steg 0) bär varje äldre
 * rad kvar nyckeln, och PropertyInputSchema är .strict(): utan det här steget
 * avvisar monteringen varje analys skapad före ändringen, permanent.
 *
 * Därför `.strip()` vid LÄSNING: en okänd nyckel från ett borttaget fält
 * kastas bort tyst, medan varje KÄND nyckel fortfarande valideras fullt ut —
 * ett felaktigt värde fångas precis som förut. `.strict()` behåller sitt
 * värde där det hör hemma, vid SKRIVNING i skapaAnalys, som är den plats där
 * ett stavfel i formuläret ska stoppas.
 *
 * Kastar om raden inte ens efter strippning är en giltig PropertyInput —
 * det är genuin korruption, inte schemadrift, och ska synas.
 */
export function lasPropertyInputFranRad(
  rad: Pick<AnalysRad, "id" | "propertyInput">,
): PropertyInput {
  const parsed = PropertyInputSchema.strip().safeParse(rad.propertyInput);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(
      `Lagrat property_input för analys ${rad.id} är inte en giltig PropertyInput ens efter ` +
        `strippning av okända nycklar — genuin korruption, inte schemadrift: ${issues}`,
    );
  }
  // Samma typförening som skapaAnalys ovan: Zod tillåter explicit `undefined`
  // på valfria fält, exactOptionalPropertyTypes gör det inte.
  return parsed.data as PropertyInput;
}
