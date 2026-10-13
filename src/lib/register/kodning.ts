/**
 * Compact encodings for the generated register data
 * (data/postnummerStadsdel.data.ts). Shared by the build script (encode) and
 * the runtime loader (decode). Pure, no I/O, client-safe.
 *
 * Independent of src/lib/vardering (server-only, must not be imported here).
 *
 * Postnummer list: ascending 5-digit postnummer read as integers; the first
 * is written in base 36, every following one as the base-36 difference to its
 * predecessor, joined with ",".
 *
 * Index runs: a sequence of small non-negative integers (area indexes, one per
 * postnummer in list order) as runs of equal values, "<value36>:<count36>"
 * joined with ",".
 */

export function kodaPostnummerLista(postnummer: readonly string[]): string {
  const nummer = postnummer.map((p) => {
    if (!/^\d{5}$/.test(p)) throw new Error(`Register: "${p}" is not a 5-digit postnummer`);
    return Number(p);
  });
  nummer.sort((a, b) => a - b);
  let foregaende = 0;
  return nummer
    .map((n, i) => {
      if (i > 0 && n === foregaende) throw new Error(`Register: duplicate postnummer ${n} in list`);
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
    if (Number.isNaN(delta)) throw new Error(`Register: malformed encoded postnummer "${del}"`);
    summa += delta;
    return String(summa).padStart(5, "0");
  });
}

export function kodaLopare(varden: readonly number[]): string {
  const delar: string[] = [];
  let i = 0;
  while (i < varden.length) {
    const v = varden[i] as number;
    if (!Number.isInteger(v) || v < 0)
      throw new Error(`Register: run value ${v} is not a non-negative integer`);
    let j = i;
    while (j < varden.length && varden[j] === v) j++;
    delar.push(`${v.toString(36)}:${(j - i).toString(36)}`);
    i = j;
  }
  return delar.join(",");
}

export function avkodaLopare(kodad: string): number[] {
  if (kodad === "") return [];
  const ut: number[] = [];
  for (const del of kodad.split(",")) {
    const [v, n] = del.split(":");
    const varde = parseInt(v ?? "", 36);
    const antal = parseInt(n ?? "", 36);
    if (Number.isNaN(varde) || Number.isNaN(antal))
      throw new Error(`Register: malformed encoded run "${del}"`);
    for (let k = 0; k < antal; k++) ut.push(varde);
  }
  return ut;
}
