/**
 * Tier resolution: which valuation method applies to a postnummer.
 * Pure — takes its lookup tables as arguments (defaults to the loaded data),
 * so the branches can be tested against the real tables and against small
 * synthetic ones.
 *
 * Order (supervisor decision):
 *   0. postnummer normalised to 5 digits, else null (no valuation: empty or
 *      malformed, e.g. an anonymised report).
 *   a. in the postnummer -> omrade map            -> 'stockholm', with omrade.
 *   b. the kommun map says Stockholm (0180)       -> 'stockholm', omrade null
 *      (Stockholm-wide fallback).
 *   c. kommun in Stockholms län (code "01...")    -> 'lan'.
 *   d. any other known kommun                     -> 'utanfor_lan'.
 *   e. unknown postnummer: the majority kommun among same-prefix postnummer
 *      in the kommun map -> (b)/(c)/(d); else, if the 3-digit prefix is in the
 *      omrade map (e.g. Stockholm's 109xx/110xx box ranges, absent from the
 *      kommun map) -> 'stockholm', omrade null; else 'utanfor_lan' with
 *      kommun null. Kommun evidence goes first because prefixes such as 141
 *      are shared: 74 of 77 known 141xx postnummer are Huddinge.
 */
import type { VarderingsTackning } from "@/types/analysis";
import {
  dominerandeKommunPerPrefix,
  kommunForPostnummer,
  kommunNamn,
  postnummerOmrade,
} from "./data";
import { normaliseraPostnummer } from "./postnummer";
import type { PostnummerOmradeMap } from "./types";

export const STOCKHOLM_KOMMUNKOD = "0180";
const STOCKHOLMS_LAN_PREFIX = "01";

export interface TackningLosning {
  tackning: VarderingsTackning;
  /** Stockholm omrade; null for everything but a mapped Stockholm postnummer. */
  omrade: string | null;
  /** 4-digit kommun code; null = could not be resolved. */
  kommunKod: string | null;
  /** Kommun name; null = could not be resolved. */
  kommun: string | null;
}

export interface TackningTabeller {
  omradeMap: PostnummerOmradeMap;
  kommunPerPostnummer: ReadonlyMap<string, string>;
  dominerandeKommunPerPrefix: ReadonlyMap<string, string>;
  kommunNamn: Readonly<Record<string, string>>;
}

const LADDADE_TABELLER: TackningTabeller = {
  omradeMap: postnummerOmrade,
  kommunPerPostnummer: kommunForPostnummer,
  dominerandeKommunPerPrefix,
  kommunNamn,
};

function perKommun(kommunKod: string, t: TackningTabeller): TackningLosning {
  const kommun = t.kommunNamn[kommunKod] ?? null;
  if (kommunKod === STOCKHOLM_KOMMUNKOD) {
    return { tackning: "stockholm", omrade: null, kommunKod, kommun };
  }
  return {
    tackning: kommunKod.startsWith(STOCKHOLMS_LAN_PREFIX) ? "lan" : "utanfor_lan",
    omrade: null,
    kommunKod,
    kommun,
  };
}

export function losTackning(
  postnummer: string,
  t: TackningTabeller = LADDADE_TABELLER,
): TackningLosning | null {
  const pn = normaliseraPostnummer(postnummer);
  if (!/^\d{5}$/.test(pn)) return null;

  // (a) Mapped to a Stockholm omrade.
  const omrade = Object.prototype.hasOwnProperty.call(t.omradeMap, pn)
    ? (t.omradeMap[pn] ?? null)
    : null;
  if (omrade !== null) {
    return {
      tackning: "stockholm",
      omrade,
      kommunKod: STOCKHOLM_KOMMUNKOD,
      kommun: t.kommunNamn[STOCKHOLM_KOMMUNKOD] ?? null,
    };
  }

  // (b)-(d) Known postnummer -> its kommun decides.
  const kommunKod = t.kommunPerPostnummer.get(pn);
  if (kommunKod !== undefined) return perKommun(kommunKod, t);

  // (e) Unknown postnummer.
  const prefix = pn.slice(0, 3);
  const granneKommun = t.dominerandeKommunPerPrefix.get(prefix);
  if (granneKommun !== undefined) return perKommun(granneKommun, t);
  if (Object.keys(t.omradeMap).some((k) => k.startsWith(prefix))) {
    return {
      tackning: "stockholm",
      omrade: null,
      kommunKod: STOCKHOLM_KOMMUNKOD,
      kommun: t.kommunNamn[STOCKHOLM_KOMMUNKOD] ?? null,
    };
  }
  return { tackning: "utanfor_lan", omrade: null, kommunKod: null, kommun: null };
}
