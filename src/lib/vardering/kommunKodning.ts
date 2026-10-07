/**
 * Compact encoding of a set of 5-digit postnummer, used for the generated
 * postnummer -> kommun map (data/kommun.data.ts). Shared by the build script
 * (encode) and the runtime loader (decode), so the round trip is tested in
 * one place. Pure, no I/O.
 *
 * Format: the postnummer are sorted ascending and read as integers; the
 * first is written in base 36, every following one as the base-36 difference
 * to its predecessor; entries are joined with ",". Swedish postnummer never
 * start with 0, so the integer round trip needs no padding beyond 5 digits.
 */

export function kodaPostnummerLista(postnummer: readonly string[]): string {
  const nummer = postnummer.map((p) => {
    if (!/^\d{5}$/.test(p)) throw new Error(`Vardering: "${p}" is not a 5-digit postnummer`);
    return Number(p);
  });
  nummer.sort((a, b) => a - b);
  let foregaende = 0;
  return nummer
    .map((n, i) => {
      if (i > 0 && n === foregaende) {
        throw new Error(`Vardering: duplicate postnummer ${n} in list`);
      }
      const delta = n - foregaende;
      foregaende = n;
      return delta.toString(36);
    })
    .join(",");
}

export function avkodaPostnummerLista(kodad: string): string[] {
  if (kodad === "") return [];
  let summa = 0;
  return kodad.split(",").map((del) => {
    const delta = parseInt(del, 36);
    if (Number.isNaN(delta)) throw new Error(`Vardering: malformed encoded postnummer "${del}"`);
    summa += delta;
    return String(summa).padStart(5, "0");
  });
}
