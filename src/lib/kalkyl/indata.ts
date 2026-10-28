/**
 * Inmatning till bolånekalkylen: tolkning av fälttext och rimlighetsgränser.
 *
 * Fälten är textfält (type="text" + inputMode="decimal"), så att mellanslag
 * som tusentalsavskiljare och komma som decimaltecken fungerar på mobil. Ett
 * tomt fält är "inget svar" (undefined), aldrig 0. Ogiltig text blir
 * `ogiltigt` med ett felmeddelande under fältet, och räknas som tom.
 *
 * Gränserna nedan är inmatningsskydd mot tryckfel (extra nollor), INTE
 * regler eller nyckeltal, och är därför inte en del av regelregistret.
 */

export type TalTolkning =
  { art: "tom" } | { art: "tal"; varde: number } | { art: "ogiltigt"; fel: string };

const FORMAT_FEL = "Skriv ett tal, till exempel 3 960 000 eller 3,6.";

/** Tolkar fälttext. Godtar mellanslag (även hårda), komma eller punkt som decimaltecken. */
export function tolkaTal(text: string): TalTolkning {
  const rent = text.replace(/[\s\u00A0\u202F]/g, "");
  if (rent === "") return { art: "tom" };
  if (/^[-−]/.test(rent)) return { art: "ogiltigt", fel: "Värdet kan inte vara negativt." };
  if (!/^(\d+([.,]\d*)?|[.,]\d+)$/.test(rent)) return { art: "ogiltigt", fel: FORMAT_FEL };
  const varde = Number(rent.replace(",", "."));
  if (!Number.isFinite(varde)) return { art: "ogiltigt", fel: FORMAT_FEL };
  return { art: "tal", varde };
}

export interface Faltgrans {
  min: number;
  max: number;
  /** Visas i felmeddelandet, t.ex. "kr" eller "%". */
  enhet: string;
  heltal?: boolean;
}

export const FALTGRANSER = {
  pris: { min: 0, max: 100_000_000, enhet: "kr" },
  kontantinsats: { min: 0, max: 100_000_000, enhet: "kr" },
  ranta: { min: 0, max: 30, enhet: "%" },
  manadsavgift: { min: 0, max: 100_000, enhet: "kr" },
  boarea: { min: 1, max: 1_000, enhet: "m²" },
  inkomst: { min: 0, max: 100_000_000, enhet: "kr per år" },
  antalPersoner: { min: 1, max: 20, enhet: "personer", heltal: true },
  antalVuxna: { min: 1, max: 10, enhet: "vuxna", heltal: true },
  barnPerAlder: { min: 0, max: 10, enhet: "barn", heltal: true },
  kalkylranta: { min: 0, max: 30, enhet: "%" },
} as const satisfies Record<string, Faltgrans>;

export type GransNyckel = keyof typeof FALTGRANSER;

const sv = (n: number) => n.toLocaleString("sv-SE");

export type FaltTolkning =
  { art: "tom" } | { art: "tal"; varde: number } | { art: "fel"; fel: string };

/** Tolkar och rimlighetskontrollerar ett fält. */
export function tolkaFalt(text: string, nyckel: GransNyckel): FaltTolkning {
  const grans: Faltgrans = FALTGRANSER[nyckel];
  const t = tolkaTal(text);
  if (t.art === "tom") return t;
  if (t.art === "ogiltigt") return { art: "fel", fel: t.fel };
  if (grans.heltal === true && !Number.isInteger(t.varde)) {
    return { art: "fel", fel: "Ange ett helt tal." };
  }
  if (t.varde < grans.min || t.varde > grans.max) {
    return {
      art: "fel",
      fel: `Värdet måste vara mellan ${sv(grans.min)} och ${sv(grans.max)} ${grans.enhet}.`,
    };
  }
  return t;
}

/** Tal till fälttext med svenskt decimaltecken, utan tusentalsavskiljare. */
export function talTillFalttext(n: number): string {
  return String(n).replace(".", ",");
}
