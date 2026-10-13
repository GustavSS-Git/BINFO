/** head() för alla konto-sidor: titel och noindex (privata sidor). */
export function kontoHead(title: string) {
  return {
    meta: [{ title: `${title} — Binfo` }, { name: "robots", content: "noindex" }],
  };
}

export const GENERELLT_FEL = "Något gick fel. Försök igen om en stund.";
