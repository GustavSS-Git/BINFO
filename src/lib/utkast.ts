/**
 * Utkast för "Spara" när man är utloggad (docs/PLAN-v3.md §1.4, owner 2026-10-12).
 *
 * Den som trycker Spara utan konto skickas genom inloggning/registrering och
 * kommer tillbaka till sidan. Under tiden ligger formulärets innehåll här:
 * sessionStorage (samma flik) med en spegling i localStorage, eftersom
 * bekräftelselänken i mejlet ofta öppnas i en NY flik. Aldrig i URL:en.
 * Utkastet gäller i 24 timmar, valideras med Zod vid läsning och tas bort
 * innan det sparas (så att en omladdning inte sparar två gånger).
 *
 * Allt som rör webbläsarens lagring är inneslutet i try/catch: privat läge,
 * full kvot eller blockerad lagring ger "inget utkast", aldrig ett kastat fel.
 */

import { z } from "zod";
import { saneraTill, type SparaTyp } from "@/lib/till";

export const UTKAST_TTL_MS = 24 * 60 * 60 * 1000;
const NYCKEL_PREFIX = "binfo:utkast:";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface UtkastLager {
  session: StorageLike | null;
  lokal: StorageLike | null;
}

/** Webbläsarens lagring; null där den saknas (SSR) eller är spärrad. */
export function webblasarLager(): UtkastLager {
  const hamta = (namn: "sessionStorage" | "localStorage"): StorageLike | null => {
    try {
      if (typeof window === "undefined") return null;
      return window[namn] ?? null;
    } catch {
      return null;
    }
  };
  return { session: hamta("sessionStorage"), lokal: hamta("localStorage") };
}

const KuvertSchema = z.object({
  v: z.literal(1),
  typ: z.enum(["vardering", "kalkyl"]),
  /** ms sedan epoch när utkastet skrevs. */
  skapad: z.number().finite(),
  /** Sidan man ska tillbaka till, redan sanerad. */
  till: z.string(),
  data: z.unknown(),
});

export interface Utkast<T> {
  till: string;
  data: T;
}

const nyckel = (typ: SparaTyp) => `${NYCKEL_PREFIX}${typ}`;

/** Skriver utkastet till båda lagren. True om minst ett lager tog emot det. */
export function skrivUtkast(
  typ: SparaTyp,
  data: unknown,
  till: string,
  lager: UtkastLager = webblasarLager(),
  nu: number = Date.now(),
): boolean {
  let text: string;
  try {
    text = JSON.stringify({ v: 1, typ, skapad: nu, till: saneraTill(till, "/"), data });
  } catch {
    return false;
  }
  let lyckades = false;
  for (const l of [lager.session, lager.lokal]) {
    if (l === null) continue;
    try {
      l.setItem(nyckel(typ), text);
      lyckades = true;
    } catch {
      // full kvot / blockerad lagring: försök nästa lager
    }
  }
  return lyckades;
}

function lasEtt<T>(
  l: StorageLike | null,
  typ: SparaTyp,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  nu: number,
): Utkast<T> | null {
  if (l === null) return null;
  let ratt: string | null;
  try {
    ratt = l.getItem(nyckel(typ));
  } catch {
    return null;
  }
  if (ratt === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(ratt);
  } catch {
    return null;
  }
  const kuvert = KuvertSchema.safeParse(json);
  if (!kuvert.success || kuvert.data.typ !== typ) return null;
  const alder = nu - kuvert.data.skapad;
  if (alder < 0 || alder > UTKAST_TTL_MS) return null;
  const data = schema.safeParse(kuvert.data.data);
  if (!data.success) return null;
  return { till: saneraTill(kuvert.data.till, "/"), data: data.data };
}

/** Läser ett giltigt utkast (sessionStorage först, sedan localStorage-spegeln).
 *  Utgånget, trasigt eller av fel form ger null. */
export function lasUtkast<T>(
  typ: SparaTyp,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  lager: UtkastLager = webblasarLager(),
  nu: number = Date.now(),
): Utkast<T> | null {
  return lasEtt(lager.session, typ, schema, nu) ?? lasEtt(lager.lokal, typ, schema, nu);
}

/** Sidan ett giltigt utkast av vilken typ som helst vill tillbaka till (för
 *  bekräftelselänken i en ny flik, som saknar `?till=`). */
export function lasUtkastMal(
  lager: UtkastLager = webblasarLager(),
  nu: number = Date.now(),
): { typ: SparaTyp; till: string } | null {
  for (const typ of ["vardering", "kalkyl"] as const) {
    const u = lasUtkast(typ, z.unknown(), lager, nu);
    if (u !== null) return { typ, till: u.till };
  }
  return null;
}

export function rensaUtkast(typ: SparaTyp, lager: UtkastLager = webblasarLager()): void {
  for (const l of [lager.session, lager.lokal]) {
    if (l === null) continue;
    try {
      l.removeItem(nyckel(typ));
    } catch {
      // ignoreras
    }
  }
}

// ---------------------------------------------------------------------------
// Utkastens innehåll
// ---------------------------------------------------------------------------

const TristateUtkast = z.enum(["ja", "nej", "okant"]);

/** Priskollen (steg 1 på /analysera): formulärets råtext (så att användaren får tillbaka exakt det hen skrev). */
export const VarderingUtkastSchema = z
  .object({
    form: z.object({
      utgangspris: z.string().max(40),
      boarea: z.string().max(40),
      antalRum: z.string().max(40),
      manadsavgift: z.string().max(40),
      postnummer: z.string().max(40),
      vaning: z.string().max(40),
      byggar: z.string().max(40),
    }),
    hiss: TristateUtkast,
    balkong: TristateUtkast,
    etikett: z.string().max(200),
  })
  .strict();

export type VarderingUtkast = z.infer<typeof VarderingUtkastSchema>;
