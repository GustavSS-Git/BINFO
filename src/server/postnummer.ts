/**
 * Postnummer help on /analysera (round 2026-10-25): `postnummerInfo`, behind
 * the server function `hamtaPostnummerInfoFn`, says what the valuation tables
 * know about a postnummer (area, kommun, tier, or "unknown"). Pure lookup over
 * the same tables as the valuation (`losTackning`), so the hint never
 * disagrees with the tier the valuation then uses. No I/O, no cookies, no
 * quota. (An address → postnummer search via Nominatim was dropped, see
 * POSTNORD_POSTNUMMER_URL in src/lib/postnummer/typer.ts.)
 */

import { z } from "zod";
import { postnummerSiffror, type PostnummerInfo } from "@/lib/postnummer/typer";
import { kommunForPostnummer, postnummerOmrade } from "@/lib/vardering/data";
import { losTackning } from "@/lib/vardering/tackning";

const InfoIndataSchema = z.object({ postnummer: z.string().max(20) }).strict();

export function postnummerInfo(data: unknown): PostnummerInfo {
  const indata = InfoIndataSchema.safeParse(data);
  if (!indata.success) return { status: "ogiltig" };
  const pn = postnummerSiffror(indata.data.postnummer);
  if (pn === null) return { status: "ogiltig" };
  const losning = losTackning(pn);
  if (losning === null) return { status: "ogiltig" };

  const kand =
    Object.prototype.hasOwnProperty.call(postnummerOmrade, pn) || kommunForPostnummer.has(pn);
  if (!kand) return { status: "okand", postnummer: pn, trolig: losning.kommun };
  if (losning.omrade !== null) {
    return { status: "omrade", postnummer: pn, omrade: losning.omrade };
  }
  if (losning.kommun === null) return { status: "okand", postnummer: pn, trolig: null };
  return {
    status: "kommun",
    postnummer: pn,
    kommun: losning.kommun,
    tackning: losning.tackning,
  };
}
