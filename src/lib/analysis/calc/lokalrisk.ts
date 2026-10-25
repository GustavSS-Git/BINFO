/**
 * Which lokal leases and statements put rent at risk (owner decision
 * 2026-10-25). Pure; shared by the fee prognosis (`avgiftsprognos.ts`, the
 * amounts) and the buyer questions (`lokalfragor.ts`).
 *
 * - A `forlustsignal` (the report says the rent WILL fall away) is always at
 *   risk.
 * - A lease whose end date lies in [balansdag, horizon end] is 'osakert' (the
 *   rent may disappear) unless the report says it is renewed or replaced
 *   (`fornyelse` → 'forlangt'). Leases that already ended after the balance
 *   date are included: the report is old and does not tell us what happened.
 * - A lease whose own arshyra equals a signal's arshyra is taken to be the same
 *   rent ('tackt'): counted once, by the signal. Two different leases with an
 *   identical rent would be under-counted; that is the cautious side.
 * - Rent per lease: its arshyra, else hyresintakter ÷ max(kontrakt,
 *   antalLokaler, 1), else null.
 */
import type { Forening, PageRef } from "@/types/analysis";

type Lokaler = NonNullable<Forening["lokaler"]>;

const MANADSNAMN = [
  "januari",
  "februari",
  "mars",
  "april",
  "maj",
  "juni",
  "juli",
  "augusti",
  "september",
  "oktober",
  "november",
  "december",
];

/** "2024-12-31" → "31 december 2024". */
export function datumText(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MANADSNAMN[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

/** What the premises are called in a sentence ("kontoret (130,5 kvm)"). The
 *  lease's own `text` when it is a short noun phrase; "lokalen" when it is
 *  missing, long, or an older-style sentence about the avtal itself. */
export function lokalNamn(text: string | undefined): string {
  const t = (text ?? "").trim().replace(/[.:;]+$/, "");
  if (t.length === 0 || t.length > 60 || /avtal|löper/i.test(t)) return "lokalen";
  // Lower-case a capitalised first word, but keep acronyms ("ICA-butiken").
  const forsta = t.charAt(0);
  const andra = t.charAt(1);
  return forsta !== forsta.toLowerCase() &&
    andra === andra.toLowerCase() &&
    andra !== andra.toUpperCase()
    ? forsta.toLowerCase() + t.slice(1)
    : t;
}

export type AvtalUtfall = "osakert" | "forlangt" | "tackt";

export interface LokalSignal {
  text: string;
  /** Own arshyra, else the equal share; null when no rent is known. */
  hyra: number | null;
  ref: PageRef;
}

export interface LokalAvtal {
  namn: string;
  slutdatum: string;
  hyra: number | null;
  ref: PageRef;
  utfall: AvtalUtfall;
  /** From `fornyelse`, when stated. */
  nyttSlutdatum?: string;
}

export interface LokalKlassning {
  /** Year's lokal rent, only when stated (may be 0). */
  hyresintakter: number | null;
  signaler: LokalSignal[];
  /** Only leases whose end date is inside the window. */
  avtal: LokalAvtal[];
}

export function klassificeraLokaler(args: {
  lokaler: Lokaler | undefined;
  antalLokaler: number;
  balansdag: string;
  horisontSlut: string;
}): LokalKlassning {
  const { lokaler, antalLokaler, balansdag, horisontSlut } = args;
  const hyresintakter = lokaler?.hyresintakter?.value ?? null;
  const kontrakt = lokaler?.kontrakt ?? [];
  const delar = Math.max(kontrakt.length, antalLokaler, 1);
  const andel = hyresintakter !== null ? hyresintakter / delar : null;

  const signaler: LokalSignal[] = (lokaler?.forlustsignaler ?? []).map((s) => ({
    text: s.text,
    hyra: s.arshyra?.value ?? andel,
    ref: s.ref,
  }));
  const signalHyror = new Set(
    (lokaler?.forlustsignaler ?? [])
      .map((s) => s.arshyra?.value)
      .filter((v): v is number => v !== null && v !== undefined),
  );

  const avtal: LokalAvtal[] = [];
  for (const k of kontrakt) {
    const slut = k.slutdatum;
    if (!slut || slut < balansdag || slut > horisontSlut) continue;
    const egen = k.arshyra?.value ?? null;
    const utfall: AvtalUtfall = k.fornyelse
      ? "forlangt"
      : egen !== null && signalHyror.has(egen)
        ? "tackt"
        : "osakert";
    avtal.push({
      namn: lokalNamn(k.text),
      slutdatum: slut,
      hyra: egen ?? andel,
      ref: k.ref,
      utfall,
      ...(k.fornyelse?.nyttSlutdatum ? { nyttSlutdatum: k.fornyelse.nyttSlutdatum } : {}),
    });
  }
  return { hyresintakter, signaler, avtal };
}
