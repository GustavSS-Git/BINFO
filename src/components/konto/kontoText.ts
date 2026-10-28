/** head() för alla konto-sidor: titel och noindex (privata sidor). */
export function kontoHead(title: string) {
  return {
    meta: [{ title: `${title} — Binfo` }, { name: "robots", content: "noindex" }],
  };
}

export const GENERELLT_FEL = "Något gick fel. Försök igen om en stund.";

/** "Spara analysen" på /forhandsvisning och /analys. */
export const SPARA_ANALYS_KNAPP = "Spara analysen";
export const SPARAD_I_PROFIL_TEXT = "Analysen är sparad i din profil.";

export const ARBETAR_TA_BORT = "Tar bort…";
export const ARBETAR_RADERA = "Raderar…";

/** Texten på bekräftaknappen i BekraftaDialog: åtgärdens namn, eller `arbetarText` medan den pågår. */
export function bekraftaKnappText(arbetar: boolean, bekraftaText: string, arbetarText: string) {
  return arbetar ? arbetarText : bekraftaText;
}
