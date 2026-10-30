/**
 * Waiting-screen data for a PENDING analysis (owner Q5, 2026-10-28): the buyer's own
 * address and asking price from the stored `property_input`, and "Liknande
 * lägenheter" = the UNADJUSTED model valuation of that input. Pure and local: the
 * same shared core as the Priskoll (`byggPrisanalysUtanForening`), no API call, no
 * quota, nothing stored. Every failure becomes `null`; the status poll must never
 * fail because of this.
 */

import type { PropertyInput } from "@/types/analysis";
import { byggPrisanalysUtanForening } from "@/lib/analysis/assemble";
import { ModellPrisdatakalla, type Prisdatakalla } from "@/lib/analysis/prisdata";

export interface VantskarmVarden {
  adress: string | null;
  utgangspris: number | null;
  liknande: { varde: number } | null;
}

/** The unadjusted model valuation (exact kr), or null when it can't be made. */
export async function liknandeVarde(
  input: PropertyInput,
  kalla: Prisdatakalla = new ModellPrisdatakalla(),
): Promise<{ varde: number } | null> {
  try {
    const p = await byggPrisanalysUtanForening(
      {
        boarea: input.boarea,
        antalRum: input.antalRum,
        manadsavgift: input.manadsavgift,
        postnummer: input.postnummer,
        ...(input.vaning !== undefined ? { vaning: input.vaning } : {}),
        ...(input.byggar !== undefined ? { byggar: input.byggar } : {}),
        hiss: input.hiss,
        balkong: input.balkong,
      },
      kalla,
    );
    const v = p.externVardering?.value;
    return v !== null && v !== undefined && Number.isFinite(v) && v > 0 ? { varde: v } : null;
  } catch (fel) {
    console.error("[hamtaStatus] liknande värdering kunde inte räknas:", fel);
    return null;
  }
}

export async function vantskarmVarden(
  input: PropertyInput,
  kalla?: Prisdatakalla,
): Promise<VantskarmVarden> {
  const adress = input.adress.trim();
  return {
    adress: adress !== "" ? adress : null,
    utgangspris:
      input.utgangspris !== undefined && input.utgangspris > 0 ? input.utgangspris : null,
    liknande: await liknandeVarde(input, kalla),
  };
}
