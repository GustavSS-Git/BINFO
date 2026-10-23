/**
 * Booli listing page parser (docs/booli.md). Pure: HTML in, normalised
 * values out. No network, no LLM.
 *
 * STUB (T1): implemented in T2a. Contract:
 *   - reads the RSC `Listing` object (`self.__next_f`) and JSON-LD only, never
 *     the visible HTML;
 *   - `blockerad` for a Cloudflare challenge page;
 *   - `tolkning_misslyckad` when no Listing object is found (with whatever
 *     JSON-LD gave in `delvis`, possibly empty);
 *   - `ok` otherwise; `saknas` lists the form fields the page doesn't state.
 */

import type { AnnonsFalt, AnnonsUppgifter } from "@/lib/annons/typer";

export type BooliTolkning =
  | { typ: "ok"; uppgifter: AnnonsUppgifter; saknas: AnnonsFalt[] }
  | { typ: "blockerad" }
  | { typ: "tolkning_misslyckad"; orsak: string; delvis: AnnonsUppgifter };

export function tolkaBooli(_html: string, _url: string): BooliTolkning {
  throw new Error("tolkaBooli: not implemented (T2a)");
}
