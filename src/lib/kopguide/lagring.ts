/**
 * localStorage-adapter för köpguidens framsteg. Den som inte är inloggad
 * sparar bara här; den inloggade speglar hit. Allt är i try/catch: privat
 * läge, full lagring eller trasigt innehåll ger tom lista, aldrig ett fel.
 */

import { normaliseraKlara } from "./framsteg";

export const KOPGUIDE_LAGRINGSNYCKEL = "binfo:kopguide:v1";

type LagringsYta = Pick<Storage, "getItem" | "setItem">;

function standardYta(): LagringsYta | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function lasLokalaKlara(yta: LagringsYta | null = standardYta()): string[] {
  try {
    if (yta === null) return [];
    const ratt = yta.getItem(KOPGUIDE_LAGRINGSNYCKEL);
    if (ratt === null) return [];
    const data: unknown = JSON.parse(ratt);
    if (typeof data !== "object" || data === null) return [];
    const rad = data as { v?: unknown; klara?: unknown };
    if (rad.v !== 1) return [];
    return normaliseraKlara(rad.klara);
  } catch {
    return [];
  }
}

/** True om skrivningen lyckades. */
export function skrivLokalaKlara(
  klara: readonly string[],
  yta: LagringsYta | null = standardYta(),
  nu: () => Date = () => new Date(),
): boolean {
  try {
    if (yta === null) return false;
    yta.setItem(
      KOPGUIDE_LAGRINGSNYCKEL,
      JSON.stringify({ v: 1, klara: normaliseraKlara(klara), uppdaterad: nu().toISOString() }),
    );
    return true;
  } catch {
    return false;
  }
}

/** Vilket konto (principal-id) den här webbläsarens lokala framsteg senast
 *  slogs ihop med. Sammanslagningen görs bara första gången en webbläsare
 *  loggar in på kontot, annars skulle ett steg som bockats av på en annan
 *  enhet dyka upp igen. */
export const KOPGUIDE_SAMMANSLAGEN_NYCKEL = "binfo:kopguide:v1:sammanslagen";

export function lasSammanslagenMed(yta: LagringsYta | null = standardYta()): string | null {
  try {
    return yta === null ? null : yta.getItem(KOPGUIDE_SAMMANSLAGEN_NYCKEL);
  } catch {
    return null;
  }
}

export function skrivSammanslagenMed(
  principalId: string,
  yta: LagringsYta | null = standardYta(),
): void {
  try {
    yta?.setItem(KOPGUIDE_SAMMANSLAGEN_NYCKEL, principalId);
  } catch {
    // Ingen lagring: sammanslagningen görs om nästa gång, vilket är ofarligt.
  }
}
