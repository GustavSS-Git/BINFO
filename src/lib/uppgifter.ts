import { useSyncExternalStore } from "react";
import type { Tristate, AvgiftPostId } from "@/data/mockData";
import { osakraUppgifter, avgiftPoster } from "@/data/mockData";

/**
 * Delat tillstånd för objektets osäkra uppgifter.
 * En uppskattad siffra får aldrig se ut som en känd siffra, och ett okänt
 * värde får aldrig se ut som ett "nej" — därför Tristate överallt.
 * Ligger i minnet (sparas inte); /analysera och /bolanekalkyl delar det.
 */
export type UppgifterState = {
  hiss: Tristate;
  balkong: Tristate;
  ingar: Record<AvgiftPostId, Tristate>;
  boarea: number;
  antalPersoner: number;
};

let current: UppgifterState = {
  hiss: osakraUppgifter.hiss.varde,
  balkong: osakraUppgifter.balkong.varde,
  // Värme och vatten ingår normalt i avgiften i en bostadsrätt (owner 2026-10-26):
  // förvalt "ja" = 0 kr. Köparen väljer "nej" när de betalas separat; övriga poster är okända.
  ingar: avgiftPoster.reduce(
    (acc, p) => ({
      ...acc,
      [p.id]:
        p.id === "varme" || p.id === "vatten"
          ? ("ja" as Tristate)
          : osakraUppgifter.ingarIAvgiften[p.id].varde,
    }),
    {} as Record<AvgiftPostId, Tristate>,
  ),
  // Inget läser butikens boarea (/bolanekalkyl tar boarean från sitt eget fält);
  // förvalet är det gamla demovärdet.
  boarea: 58,
  antalPersoner: 2,
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function setUppgifter(patch: Partial<UppgifterState>) {
  current = { ...current, ...patch };
  emit();
}

export function setIngar(id: AvgiftPostId, value: Tristate) {
  current = { ...current, ingar: { ...current.ingar, [id]: value } };
  emit();
}

/** Nuvarande tillstånd utanför React (t.ex. efter ett await), där en hook-snapshot kan vara gammal. */
export function lasUppgifter(): UppgifterState {
  return current;
}

export function useUppgifter(): UppgifterState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => current,
  );
}
