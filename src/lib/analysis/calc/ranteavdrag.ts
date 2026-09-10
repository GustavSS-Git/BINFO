/**
 * Ränteavdrag: 30 % på räntekostnad upp till 100 000 kr per person och år,
 * 21 % på det som överstiger. Taket är per person — ett hushåll med två
 * låntagare har alltså dubbelt tak innan den lägre satsen tar slut.
 */
const TAK_PER_PERSON = 100_000;
const LAGRE_SATS = 0.3;
const HOGRE_SATS = 0.21;

export function ranteavdrag(ranteKostnadPerAr: number, antalLantagare: 1 | 2): number {
  const tak = TAK_PER_PERSON * antalLantagare;
  const inomTaket = Math.min(ranteKostnadPerAr, tak);
  const overTaket = Math.max(0, ranteKostnadPerAr - tak);
  return inomTaket * LAGRE_SATS + overTaket * HOGRE_SATS;
}
