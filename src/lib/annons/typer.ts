/**
 * Listing fetch ("Hämta uppgifter" on /analysera): the types shared by the
 * client and the server function. Client-safe: no server imports.
 *
 * Source today: Booli only (docs/booli.md). The parser lives in
 * src/server/annons/booli.ts, the fetch in src/server/annons/hamta.ts.
 */

import type { AnnonsFalt } from "@/types/analysis";

export type { AnnonsFalt, AnnonsKalla } from "@/types/analysis";

/** Every form field a fetch can fill, in form order. */
export const ANNONS_FALT: readonly AnnonsFalt[] = [
  "boarea",
  "antalRum",
  "manadsavgift",
  "postnummer",
  "vaning",
  "byggar",
  "utgangspris",
  "hiss",
  "balkong",
  "adress",
  "ort",
];

export type FaltStatus = "hittad" | "saknas";

/**
 * Normalised listing values. A key is absent when the listing doesn't state
 * it. Units: kronor as integers, boarea in m² with at most one decimal,
 * avgift in kr/month, våning an integer, rum may be a half (2.5).
 */
export interface AnnonsUppgifter {
  adress?: string;
  /** "NNN NN" */
  postnummer?: string;
  /** Kommun, e.g. "Stockholm", "Lidingö" (the form's "Ort"). */
  ort?: string;
  utgangspris?: number;
  manadsavgift?: number;
  boarea?: number;
  antalRum?: number;
  vaning?: number;
  byggar?: number;
  /** Only ever "ja": a listing that doesn't mention a lift says nothing about it
   *  (unknown ≠ false). */
  hiss?: "ja";
  balkong?: "ja";
  /** Not a form field: shown/stored as context. */
  stadsdel?: string;
  forening?: string;
  maklarUrl?: string;
  koordinater?: { lat: number; lon: number };
}

export type AnnonsFelkod =
  | "fel_doman"
  | "ogiltig_url"
  | "blockerad"
  | "hittades_inte"
  | "tolkning"
  | "natverk"
  | "kvot"
  | "avstangd"
  | "behorighet";

export type AnnonsSvar =
  | {
      ok: true;
      kalla: "booli";
      /** Canonical listing URL (the cache key). */
      url: string;
      uppgifter: AnnonsUppgifter;
      status: Record<AnnonsFalt, FaltStatus>;
      /** Where the postcode came from, when there is one. */
      postnummerKalla?: "annons" | "geokodning";
      /** "llm" only when the optional model fallback produced the values. */
      tolkning: "struktur" | "llm";
      /** ISO timestamp of the fetch (a cached answer keeps its original time). */
      hamtad: string;
    }
  | { ok: false; errorCode: AnnonsFelkod; errorMessage: string };

/** Buyer-facing texts (owner wording 2026-10-24 for the first two). */
export const ANNONS_MEDDELANDE = {
  fel_doman: "Endast Booli-länkar stöds just nu.",
  allmant: "Vi kunde inte hämta uppgifterna, fyll i manuellt.",
  ogiltig_url:
    "Länken går inte till en bostadsannons på Booli. Kopiera adressen från annonsens sida, t.ex. https://www.booli.se/annons/1234567.",
  avstangd: "Hämtning från Booli är tillfälligt avstängd, fyll i manuellt.",
  kvot: "Du har hämtat många annonser på kort tid. Vänta en stund eller fyll i manuellt.",
} as const;

/** Found/missing per form field, from which keys the values carry. */
export function faltStatus(u: AnnonsUppgifter): Record<AnnonsFalt, FaltStatus> {
  const status = {} as Record<AnnonsFalt, FaltStatus>;
  for (const falt of ANNONS_FALT) status[falt] = u[falt] !== undefined ? "hittad" : "saknas";
  return status;
}
