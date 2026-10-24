/**
 * The reference rate behind "new rate = reference rate + BRF margin" in the
 * fee prognosis (docs/avgiftsprognos.md). Server-only.
 *
 * Today: the Riksbank's 3-month T-bill (SWEA series SETB3MBENCH). STIBOR would
 * be the natural rate, but the Riksbank stopped publishing it in 2020 and
 * SFBF's data needs a licence (owner decision 2026-10-24). Swapping in a
 * licensed STIBOR source means another `ReferensrantaKalla` and re-measuring
 * BRF_MARGINAL_PROCENT against it — nothing else changes.
 *
 * Order: today's cached value → a fresh fetch (once per Stockholm day) → the
 * last cached value, however old → the configured fallback (`reserv: true`).
 * Never throws: a missing rate must not break a report read.
 */
import type { Referensranta } from "@/types/analysis";
import {
  REFERENSRANTA_KALLA,
  REFERENSRANTA_NAMN,
  REFERENSRANTA_SERIE,
  reservReferensranta,
} from "@/lib/analysis/calc/prognosantaganden";
import { hamtaFranRiksbanken } from "@/lib/analysis/referensrantaHamtning";
import type { KontoDatabas } from "./kontoPortar";

export { hamtaFranRiksbanken };

export type ReferensrantaCache = Pick<KontoDatabas, "lasReferensranta" | "skrivReferensranta">;

/** YYYY-MM-DD in Stockholm time. */
export function stockholmsDatum(nu: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(nu);
}

function tillReferensranta(datum: string, procent: number, reserv: boolean): Referensranta {
  return {
    namn: REFERENSRANTA_NAMN,
    serie: REFERENSRANTA_SERIE,
    datum,
    procent,
    kalla: REFERENSRANTA_KALLA,
    reserv,
  };
}

export { reservReferensranta };

const MISSLYCKAD_PAUS_MS = 5 * 60 * 1000;
let senastMisslyckadMs = Number.NEGATIVE_INFINITY;

/** Tests only: forget an earlier failed fetch. */
export function aterstallReferensrantaPaus(): void {
  senastMisslyckadMs = Number.NEGATIVE_INFINITY;
}

/**
 * The reference rate for a read. `cache` null = no database (CLI): fetch
 * directly, else the fallback.
 */
export async function hamtaReferensranta(
  cache: ReferensrantaCache | null,
  opts: { fetchFn?: typeof fetch; nu?: Date } = {},
): Promise<Referensranta> {
  const nu = opts.nu ?? new Date();
  let cachad: { datum: string; procent: number; hamtad: string } | null = null;
  if (cache) {
    try {
      cachad = await cache.lasReferensranta(REFERENSRANTA_SERIE);
    } catch (fel) {
      console.warn("[referensranta] cacheläsning misslyckades", {
        orsak: fel instanceof Error ? fel.message : "okänt",
      });
    }
    if (cachad && stockholmsDatum(new Date(cachad.hamtad)) === stockholmsDatum(nu)) {
      return tillReferensranta(cachad.datum, cachad.procent, false);
    }
  }

  // After a failed fetch, don't make every read wait for the timeout again:
  // serve the cached/fallback value for a few minutes (per isolate).
  const nuMs = nu.getTime();
  let farsk: { datum: string; procent: number } | null = null;
  if (nuMs - senastMisslyckadMs >= MISSLYCKAD_PAUS_MS) {
    farsk = await hamtaFranRiksbanken(opts.fetchFn);
    if (!farsk) senastMisslyckadMs = nuMs;
  }
  if (farsk) {
    if (cache) {
      try {
        await cache.skrivReferensranta(REFERENSRANTA_SERIE, farsk);
      } catch (fel) {
        console.warn("[referensranta] cacheskrivning misslyckades", {
          orsak: fel instanceof Error ? fel.message : "okänt",
        });
      }
    }
    return tillReferensranta(farsk.datum, farsk.procent, false);
  }
  if (cachad) return tillReferensranta(cachad.datum, cachad.procent, false);
  return reservReferensranta();
}
