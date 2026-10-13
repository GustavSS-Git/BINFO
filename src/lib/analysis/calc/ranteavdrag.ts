import { andel, tal } from "@/lib/kalkyl/regler";

/**
 * Ränteavdrag: 30 % på räntekostnad upp till 100 000 kr per person och år,
 * 21 % på det som överstiger. Taket är per person — ett hushåll med två
 * låntagare har alltså dubbelt tak innan den lägre satsen tar slut. Satser och
 * tak ligger i regelregistret (src/lib/kalkyl/regler.ts).
 *
 * Detta är den ENDA formeln för ränteavdragets storlek före skattebegränsning.
 * Skatten kan inte bli lägre än noll, så det verkliga avdraget begränsas per
 * person av den skatt personen betalar — det görs av beraknaHushallSkatt i
 * src/lib/skatt2026.ts, som anropar den här funktionen per person.
 */
export function ranteavdrag(ranteKostnadPerAr: number, antalLantagare: 1 | 2): number {
  const tak = tal("ranteavdrag_tak") * antalLantagare;
  const inomTaket = Math.min(ranteKostnadPerAr, tak);
  const overTaket = Math.max(0, ranteKostnadPerAr - tak);
  return inomTaket * andel("ranteavdrag_sats_lag") + overTaket * andel("ranteavdrag_sats_hog");
}
