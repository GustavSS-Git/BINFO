import { postnummerInfoText, type PostnummerInfo } from "./typer";

/**
 * Props for the postnummer `Field`: area hint first, then the provenance text
 * (Booli), joined with a space. `framhav` = the Booli highlight or a
 * postnummer warning. Keys are omitted when unused (exactOptionalPropertyTypes).
 */
export function postnummerFaltVisning(args: {
  info: PostnummerInfo | null;
  annons: { hint?: string; framhav?: boolean };
}): { hint?: string; framhav?: boolean } {
  const omrade = args.info ? postnummerInfoText(args.info) : null;
  const delar = [omrade?.text, args.annons.hint].filter((s): s is string => !!s);
  const framhav = args.annons.framhav === true || omrade?.varning === true;
  return {
    ...(delar.length > 0 ? { hint: delar.join(" ") } : {}),
    ...(framhav ? { framhav: true } : {}),
  };
}
