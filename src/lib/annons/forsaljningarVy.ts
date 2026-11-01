import { ATTRIBUTION_BOOLI_TEXT, ATTRIBUTION_BOOLI_URL } from "@/lib/annons/formular";
import {
  FORSALJNINGAR_AR,
  MAX_FORSALJNINGAR,
  VISADE_FORSALJNINGAR,
  type ForsaljningarSvar,
  type TidigareForsaljning,
} from "@/lib/annons/forsaljningar";

/**
 * Texts for the "Sålda lägenheter på <adress>" table (web and PDF). Pure: everything shown comes
 * from the server answer. Shown only, never a valuation input (docs/plans/salt-i-huset.md §3).
 */

export interface ForsaljningRad {
  sald: string;
  pris: string;
  krPerM2: string;
  storlek: string;
  vaning: string;
  avgift: string;
  /** A sale of the linked flat itself: tagged "Den här lägenheten". */
  dennaLagenhet: boolean;
}

export interface ForsaljningarVy {
  rubrik: string;
  /** Every sale, newest first; the page shows the first `visas`. */
  rader: ForsaljningRad[];
  visas: number;
  /** "Visa alla (n)" when there are more than `visas`, else null. */
  visaAllaText: string | null;
  /** PDF line under a cut table: "Visar de 5 senaste av n försäljningar.", else null. */
  urvalText: string | null;
  fotnot: string;
  attributionText: string;
  attributionUrl: string;
}

export const FORSALJNINGAR_FOTNOT = `Försäljningar de senaste ${FORSALJNINGAR_AR} åren. Äldre priser är inte justerade för prisutvecklingen.`;
export const DENNA_LAGENHET_TEXT = "Den här lägenheten";

const MANADER = [
  "jan",
  "feb",
  "mar",
  "apr",
  "maj",
  "jun",
  "jul",
  "aug",
  "sep",
  "okt",
  "nov",
  "dec",
];
const STRECK = "—";

function tal(n: number): string {
  return Math.round(n).toLocaleString("sv-SE");
}

function saldText(datum: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(datum);
  const manad = m ? MANADER[Number(m[2]) - 1] : undefined;
  return m && manad ? `${manad} ${m[1]}` : STRECK;
}

function storlekText(boarea: number | null, antalRum: number | null): string {
  const delar: string[] = [];
  if (boarea !== null)
    delar.push(`${boarea.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} m²`);
  if (antalRum !== null) delar.push(`${antalRum.toLocaleString("sv-SE")} rum`);
  return delar.length > 0 ? delar.join(", ") : STRECK;
}

function rad(f: TidigareForsaljning): ForsaljningRad {
  return {
    sald: saldText(f.saldDatum),
    pris: `${tal(f.pris)} kr`,
    krPerM2: f.boarea !== null && f.boarea > 0 ? tal(f.pris / f.boarea) : STRECK,
    storlek: storlekText(f.boarea, f.antalRum),
    vaning: f.vaning !== null ? f.vaning.toLocaleString("sv-SE") : STRECK,
    avgift: f.avgift !== null ? `${tal(f.avgift)} kr` : STRECK,
    dennaLagenhet: f.dennaLagenhet,
  };
}

export function byggForsaljningarVy(
  svar: ForsaljningarSvar | null | undefined,
): ForsaljningarVy | null {
  if (!svar || !svar.ok || svar.forsaljningar.length === 0) return null;
  const sorterade = [...svar.forsaljningar]
    .sort((a, b) => (a.saldDatum < b.saldDatum ? 1 : a.saldDatum > b.saldDatum ? -1 : 0))
    .slice(0, MAX_FORSALJNINGAR);
  const fler = sorterade.length > VISADE_FORSALJNINGAR;
  return {
    rubrik: svar.adress ? `Sålda lägenheter på ${svar.adress}` : "Sålda lägenheter på samma adress",
    rader: sorterade.map(rad),
    visas: VISADE_FORSALJNINGAR,
    visaAllaText: fler ? `Visa alla (${sorterade.length})` : null,
    urvalText: fler
      ? `Visar de ${VISADE_FORSALJNINGAR} senaste av ${sorterade.length} försäljningar.`
      : null,
    fotnot: FORSALJNINGAR_FOTNOT,
    attributionText: ATTRIBUTION_BOOLI_TEXT,
    attributionUrl: ATTRIBUTION_BOOLI_URL,
  };
}
