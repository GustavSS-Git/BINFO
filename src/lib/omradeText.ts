/**
 * Valuation areas where Swedes say "på" (owner-approved list, Q12 2026-10-28);
 * everything else "i". The register areas have their own field (`omraden.ts`).
 * Own module so both analysisView.ts and prisVy.ts can use it without a cycle.
 */
const PA_OMRADEN = new Set(["Kungsholmen", "Östermalm", "Södermalm", "Norrmalm", "Essingen"]);

/** "på Kungsholmen" / "i Vasastan-Norrmalm"; no area means the Stockholm-wide statistic. */
export function iEllerPaOmrade(omrade: string | null): string {
  const namn = omrade ?? "Stockholm";
  return `${PA_OMRADEN.has(namn) ? "på" : "i"} ${namn}`;
}
