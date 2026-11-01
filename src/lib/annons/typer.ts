/**
 * Listing fetch ("Hämta uppgifter" on /analysera): the types shared by the
 * client and the server function. Client-safe: no server imports.
 *
 * Source today: Booli only (docs/booli.md, docs/plans/booli-api.md): the
 * Booli REST API (src/server/annons/booliApi.ts) and, behind a flag, the
 * listing page (src/server/annons/booli.ts); orchestration in
 * src/server/annons/hamta.ts.
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
  /** Kommun, e.g. "Stockholm", "Lidingö" (the form has no Ort field since 2026-10-26; only the server geocoder uses it). */
  ort?: string;
  utgangspris?: number;
  manadsavgift?: number;
  boarea?: number;
  antalRum?: number;
  vaning?: number;
  byggar?: number;
  /** "nej" only from the API's explicit 0 (owner 2026-10-31); the listing page
   *  only ever gives "ja" (a missing amenity there is unknown, not "nej"). */
  hiss?: "ja" | "nej";
  balkong?: "ja" | "nej";
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
      /** How the listing was read: Booli's API or its listing page. Absent on
       *  answers cached before 2026-10-31 (= "sida"). */
      metod?: "api" | "sida";
      /** ISO timestamp of the fetch (a cached answer keeps its original time). */
      hamtad: string;
    }
  | { ok: false; errorCode: AnnonsFelkod; errorMessage: string };

/** Buyer-facing texts (owner wording 2026-10-24 for the first two). */
export const ANNONS_MEDDELANDE = {
  fel_doman: "Endast Booli-länkar stöds just nu.",
  allmant: "Vi kunde inte hämta uppgifterna, fyll i manuellt.",
  ogiltig_url:
    "Länken går inte till en bostadsannons på Booli. Kopiera adressen från bostadens eller annonsens sida, t.ex. https://www.booli.se/bostad/798609.",
  avstangd: "Hämtning från Booli är tillfälligt avstängd, fyll i manuellt.",
  kvot: "Du har hämtat många annonser på kort tid. Vänta en stund eller fyll i manuellt.",
} as const;

/** Found/missing per form field, from which keys the values carry. */
export function faltStatus(u: AnnonsUppgifter): Record<AnnonsFalt, FaltStatus> {
  const status = {} as Record<AnnonsFalt, FaltStatus>;
  for (const falt of ANNONS_FALT) status[falt] = u[falt] !== undefined ? "hittad" : "saknas";
  return status;
}
