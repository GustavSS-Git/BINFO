/**
 * Postnummer help on /analysera (round 2026-10-25): the area hint under the
 * postnummer field and the "Vet du inte postnumret?" link to PostNord.
 * Client-safe: types and the hint text only. The lookup lives in
 * src/server/postnummer.ts (server function `hamtaPostnummerInfoFn`).
 */

/** What the valuation tables know about a postnummer (`losTackning` + an
 *  exact-match check). */
export type PostnummerInfo =
  /** A Stockholm postnummer with one of Binfo's valuation areas. */
  | { status: "omrade"; postnummer: string; omrade: string }
  /** A known postnummer whose kommun decides the valuation tier. */
  | {
      status: "kommun";
      postnummer: string;
      kommun: string;
      tackning: "stockholm" | "lan" | "utanfor_lan";
    }
  /** Not in the tables; `trolig` = the majority kommun of its neighbours. */
  | { status: "okand"; postnummer: string; trolig: string | null }
  /** Not five digits. */
  | { status: "ogiltig" };

/** "116 25" / "11625" → "11625"; null unless exactly five digits. */
export function postnummerSiffror(raw: string): string | null {
  const s = raw.replace(/\s+/g, "");
  return /^\d{5}$/.test(s) ? s : null;
}

/** "11625" → "116 25". */
export function formateraPostnummer(siffror: string): string {
  return `${siffror.slice(0, 3)} ${siffror.slice(3)}`;
}

/**
 * The hint under the postnummer field. `varning` = the postnummer is not in
 * the tables, so the field gets the warning border. No claims beyond what the
 * valuation does with the tier (src/lib/vardering/tackning.ts).
 */
export function postnummerInfoText(
  info: PostnummerInfo,
): { text: string; varning: boolean } | null {
  switch (info.status) {
    case "ogiltig":
      return null;
    case "omrade":
      return { text: `Område: ${info.omrade}, Stockholm.`, varning: false };
    case "kommun":
      if (info.tackning === "stockholm") {
        return {
          text: "Stockholm, men området är okänt. Värderingen jämför med hela Stockholm.",
          varning: false,
        };
      }
      if (info.tackning === "lan") {
        return {
          text: `Kommun: ${info.kommun}. Utanför Stockholms kommun blir värderingen grövre.`,
          varning: false,
        };
      }
      return {
        text: `Kommun: ${info.kommun}, utanför Stockholms län. Värderingen blir ungefärlig.`,
        varning: false,
      };
    case "okand":
      // The kommun table is thin outside Stockholms län (e.g. 19 Malmö
      // postnummer), so "unknown" does not mean "wrong": say what the
      // valuation does and ask for a check, never claim a typo.
      return info.trolig !== null
        ? {
            text: `Vi känner inte igen just det här postnumret. Närliggande nummer ligger i ${info.trolig}, och värderingen utgår från det. Kontrollera att postnumret stämmer.`,
            varning: false,
          }
        : {
            text: "Vi känner inte igen postnumret, så värderingen blir ungefärlig. Kontrollera att det stämmer.",
            varning: true,
          };
  }
}

/**
 * "Vet du inte postnumret?" opens PostNord's official postcode search (owner
 * 2026-10-25). An address search via OpenStreetMap/Nominatim was built and
 * dropped: on the 7 test addresses it gave a wrong postnummer in all 5 cases
 * where it found anything (usually the last digit; valuation moved 0–5.6 %).
 * PostNord manages the Swedish postcode system. URL from PostNord's own tools
 * listing (bot-protected, so not fetchable by curl; opens in a browser).
 */
export const POSTNORD_POSTNUMMER_URL =
  "https://www.postnord.se/en/our-tools/search-postcode-and-address/";
