import { useSyncExternalStore } from "react";
import type { PropertyType } from "@/data/mockData";

/**
 * Delat val av bostadstyp (Bostadsrätt/Hus).
 * Styr vilka steg och kostnader som visas i köpguiden och rapporterna.
 */
let current: PropertyType = "brf";
const listeners = new Set<() => void>();

export function setPropertyType(next: PropertyType) {
  current = next;
  listeners.forEach((l) => l());
}

export function usePropertyType(): [PropertyType, (t: PropertyType) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => current,
  );
  return [value, setPropertyType];
}
