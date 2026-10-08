/**
 * Shared defaults and demo/seed data for Binfo's client-side UI: calculator
 * defaults, current Swedish rules for amortering, and the seed values behind
 * the shared "osäkra uppgifter" state (@/lib/uppgifter.ts). The real analysis
 * result comes from the pipeline (src/lib/analysis, src/types/analysis.ts) —
 * this file is not that pipeline's mock.
 */

export type Status = "green" | "amber" | "red";
export type PropertyType = "brf" | "hus";

export const property = {
  namn: "Brf Lindgården",
  adress: "Kapellgränd 12, Södermalm",
  ort: "Stockholm",
  utgangspris: 4_950_000,
  boarea: 58,
  rum: "3:a",
  vaning: 4,
  vaningarTotalt: 6,
  manadsavgift: 3_240,
  andelstal: 2.1,
  byggar: 1931,
  skuldPerKvm: 8_500,
  foreningensLan: 43_200_000,
  foreningensYta: 5_082, // m² → 43,2 Mkr / 5 082 m² ≈ 8 500 kr/m²
  snittranta: 1.94,
  rantebindning: "Två lån (58 %) omsätts inom 12 månader",
};

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
 * Gällande svenska regler från 1 april 2026.
 * Amorteringskravet baseras ENBART på belåningsgrad.
 * Det skärpta kravet (skuldkvot > 4,5×) är slopat.
 */
export const amorteringsregler = {
  bolanetak: 0.9, // minsta kontantinsats 10 %
  minKontantinsatsAndel: 0.1,
  bankernasInternaTak: 5.0, // skuldkvot där bankerna brukar dra gränsen
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
 * TODO(backend): säkerheten ska styra analysens konfidensintervall.
 */
export type Osaker<T> = { varde: T; sakerhet: "kand" | "okand" };

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
