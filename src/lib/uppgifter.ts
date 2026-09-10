import { useSyncExternalStore } from "react";
import type { Tristate, AvgiftPostId } from "@/data/mockData";
import { osakraUppgifter, avgiftPoster, property } from "@/data/mockData";

/**
 * Delat tillstånd för objektets osäkra uppgifter.
 * En uppskattad siffra får aldrig se ut som en känd siffra, och ett okänt
 * värde får aldrig se ut som ett "nej" — därför Tristate överallt.
 *
 * TODO(backend): detta tillstånd ska hämtas/sparas mot analyspipelinen,
 * och osäkerheten ska påverka analysens konfidensintervall.
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
  ingar: avgiftPoster.reduce(
    (acc, p) => ({ ...acc, [p.id]: osakraUppgifter.ingarIAvgiften[p.id].varde }),
    {} as Record<AvgiftPostId, Tristate>,
  ),
  boarea: property.boarea,
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

/** Alla tre-lägesfält, för säkerhetsmätaren och auto-genererade frågor. */
export function tristateFalt(s: UppgifterState) {
  return [
    {
      id: "hiss",
      etikett: "Hiss",
      varde: s.hiss,
      fraga: `Kontrollera om det finns hiss — påverkar värdet på våning ${property.vaning}.`,
    },
    {
      id: "balkong",
      etikett: "Balkong",
      varde: s.balkong,
      fraga: "Kontrollera om lägenheten har balkong — påverkar både pris och jämförbarhet.",
    },
    ...avgiftPoster.map((p) => ({
      id: p.id,
      etikett: p.label,
      varde: s.ingar[p.id],
      fraga: `Fråga mäklaren: ingår ${p.label.toLowerCase()} i månadsavgiften?`,
    })),
  ];
}

export function sakerhet(s: UppgifterState) {
  const falt = tristateFalt(s);
  const kanda = falt.filter((f) => f.varde !== "okant").length;
  return { kanda, totalt: falt.length, okanda: falt.filter((f) => f.varde === "okant") };
}
