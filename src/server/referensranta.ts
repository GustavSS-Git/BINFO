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
import { z } from "zod";
import type { Referensranta } from "@/types/analysis";
import {
  REFERENSRANTA_KALLA,
  REFERENSRANTA_NAMN,
  REFERENSRANTA_RESERV,
  REFERENSRANTA_SERIE,
} from "@/lib/analysis/calc/prognosantaganden";
import type { KontoDatabas } from "./kontoPortar";

export type ReferensrantaCache = Pick<KontoDatabas, "lasReferensranta" | "skrivReferensranta">;

const RIKSBANK_SENASTE = (serie: string) =>
  `https://api.riksbank.se/swea/v1/Observations/Latest/${encodeURIComponent(serie)}`;

const TIMEOUT_MS = 5000;

const ObservationSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.number().finite().min(-5).max(25),
});

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

/** The configured fallback, labelled as such. */
export function reservReferensranta(): Referensranta {
  return tillReferensranta(REFERENSRANTA_RESERV.datum, REFERENSRANTA_RESERV.procent, true);
}

/** One request to the Riksbank API; null on any failure (logged). */
export async function hamtaFranRiksbanken(
  fetchFn: typeof fetch = fetch,
): Promise<{ datum: string; procent: number } | null> {
  const avbryt = new AbortController();
  const timer = setTimeout(() => avbryt.abort(), TIMEOUT_MS);
  try {
    const svar = await fetchFn(RIKSBANK_SENASTE(REFERENSRANTA_SERIE), {
      headers: { accept: "application/json" },
      signal: avbryt.signal,
    });
    if (!svar.ok) {
      console.warn("[referensranta] Riksbanken svarade", { status: svar.status });
      return null;
    }
    const tolkad = ObservationSchema.safeParse(await svar.json());
    if (!tolkad.success) {
      console.warn("[referensranta] oväntat svar från Riksbanken");
      return null;
    }
    return { datum: tolkad.data.date, procent: tolkad.data.value };
  } catch (fel) {
    console.warn("[referensranta] hämtning misslyckades", {
      orsak: fel instanceof Error ? fel.name : "okänt",
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
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

  const farsk = await hamtaFranRiksbanken(opts.fetchFn);
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
