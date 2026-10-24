/**
 * One request for the latest reference-rate observation from the Riksbank's
 * open SWEA API (no key). Plain web fetch, no secrets: shared by the server's
 * cached lookup (src/server/referensranta.ts) and the extraction CLI.
 * Returns null on any failure (logged), never throws.
 */
import { z } from "zod";
import { REFERENSRANTA_SERIE } from "./calc/prognosantaganden";

const RIKSBANK_SENASTE = (serie: string) =>
  `https://api.riksbank.se/swea/v1/Observations/Latest/${encodeURIComponent(serie)}`;

const TIMEOUT_MS = 5000;

const ObservationSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.number().finite().min(-5).max(25),
});

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
