/**
 * Köpguidens framsteg: ren modell utan lagring (redesign v4, steg 3c).
 * Ett framsteg är en lista steg-id:n som användaren bockat av. Okända id:n
 * (t.ex. från en äldre version) kastas bort, ordningen är stegens egen.
 */

import type { PropertyType } from "@/data/mockData";
import { KOPGUIDE_STEG, type KopguideSteg } from "./steg";

/** Övre gräns för hur många id:n som sparas (matchar tabellens check). */
export const MAX_KLARA = 20;

const KANDA_IDN: ReadonlySet<string> = new Set(KOPGUIDE_STEG.map((s) => s.id));

/** Bara kända id:n, unika, i stegens ordning. Allt annat än en array → []. */
export function normaliseraKlara(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const valda = new Set<string>();
  for (const id of ids) if (typeof id === "string" && KANDA_IDN.has(id)) valda.add(id);
  return KOPGUIDE_STEG.map((s) => s.id).filter((id) => valda.has(id));
}

export function synligaSteg(typ: PropertyType): KopguideSteg[] {
  return KOPGUIDE_STEG.filter((s) => !s.only || s.only === typ);
}

/** Antal avbockade steg som syns i det valda läget. */
export function antalKlara(klara: readonly string[], typ: PropertyType): number {
  const klart = new Set(klara);
  return synligaSteg(typ).filter((s) => klart.has(s.id)).length;
}

/** Första synliga steget som inte är avbockat, eller null när allt är klart. */
export function nastaSteg(klara: readonly string[], typ: PropertyType): KopguideSteg | null {
  const klart = new Set(klara);
  return synligaSteg(typ).find((s) => !klart.has(s.id)) ?? null;
}

/** Union av två listor, normaliserad. */
export function slaSamman(a: readonly string[], b: readonly string[]): string[] {
  return normaliseraKlara([...a, ...b]);
}

function liteBokstav(titel: string): string {
  const [forsta, andra] = [titel.charAt(0), titel.charAt(1)];
  // Behåll versal i förkortningar ("BRF") men inte i vanliga ord.
  if (andra !== "" && andra === andra.toUpperCase() && andra !== andra.toLowerCase()) return titel;
  return forsta.toLowerCase() + titel.slice(1);
}

/** "4 av 12 steg klara. Nästa: budgivning." och dess varianter. */
export function framstegText(klara: readonly string[], typ: PropertyType): string {
  const totalt = synligaSteg(typ).length;
  const antal = antalKlara(klara, typ);
  if (antal === 0) return "Du har inte bockat av något steg ännu.";
  const nasta = nastaSteg(klara, typ);
  if (nasta === null) return `Alla ${totalt} steg klara.`;
  return `${antal} av ${totalt} steg klara. Nästa: ${liteBokstav(nasta.titel)}.`;
}
