/**
 * Rena hjälpfunktioner för kontoflödena (ingen React, inget serverimport):
 * säker omdirigering efter inloggning (`?till=`), vilken sparåtgärd som väntar
 * (`?spara=`) och hur sessionssvaret tolkas.
 */

import type { SessionSvar } from "@/lib/kontoTyper";

export type SparaTyp = "vardering" | "kalkyl";

/** Läser `?spara=` ur router-sökparametrar. Allt utom de två kända värdena ignoreras. */
export function parseSparaTyp(varde: unknown): SparaTyp | undefined {
  return varde === "vardering" || varde === "kalkyl" ? varde : undefined;
}

const MAX_TILL_TECKEN = 300;
const BAS = "http://binfo.invalid";

/**
 * Släpper bara igenom en sökväg på den egna sajten (börjar med "/"). Allt annat
 * (fullständiga URL:er, `//host`, `/\host`, `javascript:`, kontrolltecken)
 * ger `reserv`, så ett manipulerat `?till=` aldrig kan skicka användaren till en
 * annan sajt (open redirect).
 */
export function saneraTill(till: unknown, reserv = "/konto"): string {
  if (typeof till !== "string") return reserv;
  const t = till.trim();
  if (t === "" || t.length > MAX_TILL_TECKEN) return reserv;
  if (!t.startsWith("/") || t.startsWith("//")) return reserv;
  // Backslash och kontrolltecken tolkas olika av webbläsare ("/\evil.com").
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c === 0x5c || c <= 0x1f || c === 0x7f) return reserv;
  }
  try {
    const u = new URL(t, BAS);
    if (u.origin !== BAS) return reserv;
  } catch {
    return reserv;
  }
  return t;
}

/** `till` med `?spara=<typ>` tillagt, så målsidan vet att den ska slutföra sparandet. */
export function medSparaParam(till: string, spara: SparaTyp | undefined): string {
  const bas = saneraTill(till);
  if (spara === undefined) return bas;
  const u = new URL(bas, BAS);
  u.searchParams.set("spara", spara);
  return `${u.pathname}${u.search}${u.hash}`;
}

/** Sökparametrar till login/skapa-sidorna, utan tomma nycklar. */
export function inloggningsSok(
  till: string | undefined,
  spara: SparaTyp | undefined,
): { till?: string; spara?: SparaTyp } {
  return {
    ...(till !== undefined ? { till } : {}),
    ...(spara !== undefined ? { spara } : {}),
  };
}

export type SessionLage = "laddar" | "utloggad" | "inloggad";

/** Tolkar frågeläget. Ett fel vid sessionshämtningen behandlas som utloggad: sidan
 *  ska hellre erbjuda inloggning än hänga. */
export function sessionLage(q: { data: SessionSvar | undefined; isError: boolean }): SessionLage {
  if (q.data !== undefined) return q.data.inloggad ? "inloggad" : "utloggad";
  return q.isError ? "utloggad" : "laddar";
}

export interface KontoSok {
  till?: string;
  spara?: SparaTyp;
}

/** `validateSearch` för sidor med `?till=` och `?spara=`. Nycklarna är utelämnade (inte
 *  `undefined`) när de saknas, så att länkar till sidan inte tvingas ange dem. */
export function parseKontoSok(s: Record<string, unknown>): KontoSok {
  const till = typeof s["till"] === "string" ? saneraTill(s["till"], "/konto") : undefined;
  const spara = parseSparaTyp(s["spara"]);
  return {
    ...(till !== undefined ? { till } : {}),
    ...(spara !== undefined ? { spara } : {}),
  };
}
