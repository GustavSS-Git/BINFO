/**
 * Shared defaults for Binfo's client-side UI: calculator placeholder values,
 * the fee items, the seed values behind the shared "osäkra uppgifter" state
 * (@/lib/uppgifter.ts) and the `kr` formatter. The real analysis result comes
 * from the pipeline (src/lib/analysis, src/types/analysis.ts) — this file is
 * not that pipeline's mock.
 */

export type Status = "green" | "amber" | "red";
export type PropertyType = "brf" | "hus";

/** Bolånekalkylens exempelvärden — visas gråa i de tomma fälten, räknas inte
 *  med förrän köparen själv skriver in ett belopp. */
export const kalkylDefaults = {
  lanebelopp: 3_960_000, // 80 % av utgångspriset
  kontantinsats: 990_000,
  ranta: 3.6,
  bruttoinkomst: 900_000,
  antalLantagare: 2,
};

/**
 * Tre lägen för alla osäkra uppgifter. "okant" är alltid förvalt —
 * ett okänt värde får aldrig se ut som ett "nej".
 */
export type Tristate = "ja" | "nej" | "okant";

export type AvgiftPostId = "varme" | "vatten" | "el" | "bredband" | "tv";

export const avgiftPoster: { id: AvgiftPostId; label: string }[] = [
  { id: "varme", label: "Värme" },
  { id: "vatten", label: "Vatten" },
  { id: "el", label: "El" },
  { id: "bredband", label: "Bredband" },
  { id: "tv", label: "TV" },
];

/**
 * Varje osäkert attribut modelleras som värde + säkerhet, aldrig som ett
 * platt värde.
 */
type Osaker<T> = { varde: T; sakerhet: "kand" | "okand" };

const okand = <T>(varde: T): Osaker<T> => ({ varde, sakerhet: "okand" });

export const osakraUppgifter: {
  hiss: Osaker<Tristate>;
  balkong: Osaker<Tristate>;
  ingarIAvgiften: Record<AvgiftPostId, Osaker<Tristate>>;
} = {
  hiss: okand<Tristate>("okant"),
  balkong: okand<Tristate>("okant"),
  ingarIAvgiften: {
    varme: okand<Tristate>("okant"),
    vatten: okand<Tristate>("okant"),
    el: okand<Tristate>("okant"),
    bredband: okand<Tristate>("okant"),
    tv: okand<Tristate>("okant"),
  },
};

export function kr(n: number): string {
  return Math.round(n).toLocaleString("sv-SE") + " kr";
}
