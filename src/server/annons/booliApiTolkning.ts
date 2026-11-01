/**
 * Booli REST API JSON → `AnnonsUppgifter` (docs/plans/booli-api.md §2 and §7).
 * Pure: no I/O, never throws. The schema is permissive in the same way as the
 * page parser (booli.ts): a field whose type changes becomes missing, it never
 * fails the whole answer. Unknown keys are stripped, so Booli's own `estimate`
 * (and `soldPrice`) never reach the result.
 *
 *   adress       location.address.streetAddress
 *   postnummer   sold: location.address.postCode; active listing: the
 *                `areas?lat&lng` answer (`postnummerFranOmraden`), "NNN NN"
 *   ort          location.region.municipalityName
 *   utgangspris  listPrice (> 0; a sold listing too, owner D3; never soldPrice)
 *   manadsavgift rent (> 0; 0 = not stated)
 *   boarea       livingArea (> 0, one decimal)
 *   antalRum     rooms (> 0, one decimal; 2.5 happens)
 *   vaning       floor (≥ 0, truncated like `parseVaning`: 1.5 → 1)
 *   byggar       constructionYear (plausible range, `rimligtByggar`)
 *   hiss         buildingHasElevator 1 → "ja", 0 → "nej" (owner D1)
 *   balkong      hasBalcony 1 → "ja", 0 → "nej" unless hasPatio is 1 (D1)
 *                A 0 on a sparse listing (`glestObjekt`) stays unknown: fresh
 *                listings send 0 for every amenity before the broker fills
 *                them in (supervisor, owner delegated, 2026-10-31).
 *   stadsdel     location.namedAreas[0]
 *   koordinater  location.position
 *
 * forening and maklarUrl are not in the API (`source` is the broker company,
 * not the listing page).
 */

import { z } from "zod";
import { MAX_FORSALJNINGAR, type TidigareForsaljning } from "@/lib/annons/forsaljningar";
import { ANNONS_FALT, type AnnonsFalt, type AnnonsUppgifter } from "@/lib/annons/typer";
import { rimligtByggar } from "./kallor";

export type BooliApiSamling = "listings" | "sold";

const strang = z.string().nullable().optional().catch(undefined);
const tal = z.number().finite().nullable().optional().catch(undefined);
/** 0/1 in every recorded answer; a boolean is accepted as the same thing. */
const flagga = z.union([z.number(), z.boolean()]).nullable().optional().catch(undefined);

const ApiObjektSchema = z.object({
  booliId: tal,
  listPrice: tal,
  rent: tal,
  livingArea: tal,
  rooms: tal,
  floor: tal,
  constructionYear: tal,
  buildingHasElevator: flagga,
  hasBalcony: flagga,
  hasPatio: flagga,
  location: z
    .object({
      address: z
        .object({
          streetAddress: strang,
          postCode: z.union([z.string(), z.number()]).nullable().optional().catch(undefined),
        })
        .nullable()
        .optional()
        .catch(undefined),
      region: z.object({ municipalityName: strang }).nullable().optional().catch(undefined),
      position: z.object({ latitude: tal, longitude: tal }).nullable().optional().catch(undefined),
      namedAreas: z.array(z.unknown()).nullable().optional().catch(undefined),
    })
    .nullable()
    .optional()
    .catch(undefined),
});

const OmradeSchema = z.object({
  name: z.union([z.string(), z.number()]),
  types: z.array(z.unknown()),
  size: z.number().optional().catch(undefined),
});

function arObjekt(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function text(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

function positivt(n: number | null | undefined): number | undefined {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
}

function hogstEnDecimal(n: number): number {
  return Math.round(n * 10) / 10;
}

function sant(v: number | boolean | null | undefined): boolean {
  return v === 1 || v === true;
}
function falskt(v: number | boolean | null | undefined): boolean {
  return v === 0 || v === false;
}

/** A listing missing at least two of rent, floor, construction year and
 *  asking price. Booli sends 0 for every amenity on such listings (Rålambsvägen
 *  48, 2026-10-31), so a 0 there means "not filled in", not "nej". */
function glestObjekt(
  o: Pick<z.infer<typeof ApiObjektSchema>, "rent" | "floor" | "constructionYear" | "listPrice">,
): boolean {
  const saknade = [
    positivt(o.rent) === undefined,
    typeof o.floor !== "number" || o.floor < 0,
    typeof o.constructionYear !== "number",
    positivt(o.listPrice) === undefined,
  ].filter(Boolean).length;
  return saknade >= 2;
}

/** "11339", 11339 or "113 39" → "113 39"; anything else → undefined. */
export function formateraPostnummer(v: unknown): string | undefined {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v : "";
  const siffror = s.replace(/\s/g, "");
  if (!/^\d{5}$/.test(siffror)) return undefined;
  return `${siffror.slice(0, 3)} ${siffror.slice(3)}`;
}

/** The first object in `svar[samling]` (`{ listings: [ … ] }` / `{ sold: [ … ] }`), if any. */
export function forstaObjekt(svar: unknown, samling: BooliApiSamling): unknown {
  if (!arObjekt(svar)) return undefined;
  const lista = svar[samling];
  if (!Array.isArray(lista)) return undefined;
  const forsta: unknown = lista[0];
  return arObjekt(forsta) ? forsta : undefined;
}

/** Booli's own postcode from an `areas?lat&lng` answer: the area typed
 *  "Postnummer" (the smallest one should there ever be several). */
export function postnummerFranOmraden(svar: unknown): string | undefined {
  const omraden = arObjekt(svar) ? svar["areas"] : undefined;
  if (!Array.isArray(omraden)) return undefined;
  const traffar: { postnummer: string; storlek: number }[] = [];
  for (const a of omraden) {
    const r = OmradeSchema.safeParse(a);
    if (!r.success || !r.data.types.includes("Postnummer")) continue;
    const postnummer = formateraPostnummer(r.data.name);
    if (postnummer !== undefined) {
      traffar.push({ postnummer, storlek: r.data.size ?? Number.POSITIVE_INFINITY });
    }
  }
  traffar.sort((a, b) => a.storlek - b.storlek);
  return traffar[0]?.postnummer;
}

export interface BooliApiTolkning {
  uppgifter: AnnonsUppgifter;
  saknas: AnnonsFalt[];
  /** The object's own id, when it carries one (checked against the asked id). */
  booliId?: number;
}

/** One listing/sold object → form values. Garbage gives `{ uppgifter: {} }`. */
export function tolkaBooliApiObjekt(ratt: unknown, iAr?: number): BooliApiTolkning {
  const u: AnnonsUppgifter = {};
  const tolkad = ApiObjektSchema.safeParse(ratt);
  if (!arObjekt(ratt) || !tolkad.success) {
    return { uppgifter: u, saknas: [...ANNONS_FALT] };
  }
  const o = tolkad.data;
  const plats = o.location ?? undefined;

  const adress = text(plats?.address?.streetAddress);
  if (adress !== undefined) u.adress = adress;

  const postnummer = formateraPostnummer(plats?.address?.postCode);
  if (postnummer !== undefined) u.postnummer = postnummer;

  const ort = text(plats?.region?.municipalityName);
  if (ort !== undefined) u.ort = ort;

  const stadsdel = text(plats?.namedAreas?.[0]);
  if (stadsdel !== undefined) u.stadsdel = stadsdel;

  const listpris = positivt(o.listPrice);
  if (listpris !== undefined && Math.round(listpris) > 0) u.utgangspris = Math.round(listpris);

  const avgift = positivt(o.rent);
  if (avgift !== undefined && Math.round(avgift) > 0) u.manadsavgift = Math.round(avgift);

  const boarea = positivt(o.livingArea);
  if (boarea !== undefined && hogstEnDecimal(boarea) > 0) u.boarea = hogstEnDecimal(boarea);

  const rum = positivt(o.rooms);
  if (rum !== undefined && hogstEnDecimal(rum) > 0) u.antalRum = hogstEnDecimal(rum);

  if (typeof o.floor === "number" && o.floor >= 0) u.vaning = Math.trunc(o.floor);

  if (rimligtByggar(o.constructionYear, iAr)) u.byggar = o.constructionYear;

  const nollArNej = !glestObjekt(o);
  if (sant(o.buildingHasElevator)) u.hiss = "ja";
  else if (nollArNej && falskt(o.buildingHasElevator)) u.hiss = "nej";

  if (sant(o.hasBalcony)) u.balkong = "ja";
  else if (nollArNej && falskt(o.hasBalcony) && !sant(o.hasPatio)) u.balkong = "nej";

  const lat = plats?.position?.latitude;
  const lon = plats?.position?.longitude;
  if (
    typeof lat === "number" &&
    typeof lon === "number" &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  ) {
    u.koordinater = { lat, lon };
  }

  const ut: BooliApiTolkning = {
    uppgifter: u,
    saknas: ANNONS_FALT.filter((f) => u[f] === undefined),
  };
  if (typeof o.booliId === "number") ut.booliId = o.booliId;
  return ut;
}

// ---------------------------------------------------------------------------
// Sales at the flat's address (docs/plans/salt-i-huset.md)
// ---------------------------------------------------------------------------

/** One `sold` row. Only these fields are read: never `apartmentNumber`,
 *  `estimate` or `soldPriceSource`. */
const SaldRadSchema = z.object({
  booliId: tal,
  soldDate: strang,
  soldPrice: tal,
  livingArea: tal,
  rooms: tal,
  floor: tal,
  rent: tal,
  location: z
    .object({
      address: z.object({ streetAddress: strang }).nullable().optional().catch(undefined),
      position: z.object({ latitude: tal, longitude: tal }).nullable().optional().catch(undefined),
    })
    .nullable()
    .optional()
    .catch(undefined),
});

export interface TolkadSaldRad {
  booliId: number | null;
  rad: Omit<TidigareForsaljning, "dennaLagenhet">;
  adress: string | null;
  position: { lat: number; lon: number } | null;
}

/**
 * One `sold` row → a table row. A row without a valid `soldDate`
 * (YYYY-MM-DD) or a positive integer `soldPrice` gives null; `rent` 0 means
 * "not stated" (null). Pure.
 */
export function tolkaSaldRad(ratt: unknown): TolkadSaldRad | null {
  if (!arObjekt(ratt)) return null;
  const t = SaldRadSchema.safeParse(ratt);
  if (!t.success) return null;
  const o = t.data;
  const datum = typeof o.soldDate === "string" ? o.soldDate.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || !Number.isFinite(Date.parse(datum))) return null;
  const pris = positivt(o.soldPrice);
  if (pris === undefined || !Number.isInteger(pris)) return null;
  const boarea = positivt(o.livingArea);
  const rum = positivt(o.rooms);
  const avgift = positivt(o.rent);
  const lat = o.location?.position?.latitude;
  const lon = o.location?.position?.longitude;
  return {
    booliId: typeof o.booliId === "number" ? o.booliId : null,
    rad: {
      saldDatum: datum,
      pris,
      boarea: boarea !== undefined && hogstEnDecimal(boarea) > 0 ? hogstEnDecimal(boarea) : null,
      antalRum: rum !== undefined && hogstEnDecimal(rum) > 0 ? hogstEnDecimal(rum) : null,
      vaning: typeof o.floor === "number" && o.floor >= 0 ? hogstEnDecimal(o.floor) : null,
      avgift: avgift !== undefined && Math.round(avgift) > 0 ? Math.round(avgift) : null,
    },
    adress: text(o.location?.address?.streetAddress) ?? null,
    position:
      typeof lat === "number" &&
      typeof lon === "number" &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180
        ? { lat, lon }
        : null,
  };
}

/** "Östermalmsgatan 30 A" → "östermalmsgatan 30a": case, spacing and the
 *  gap before a house letter don't matter; the number and letter do. */
export function normaliseraAdress(adress: string): string {
  return adress
    .toLocaleLowerCase("sv-SE")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(\d)\s+([a-zåäö])\b/g, "$1$2");
}

/** Same street, number and letter (30 ≠ 30A ≠ 32). */
export function sammaAdress(a: string, b: string): boolean {
  return normaliseraAdress(a) === normaliseraAdress(b);
}

/**
 * The table for one flat: its own sales (`egna`, `sold?residenceId`, marked
 * `dennaLagenhet`) plus every sale in `omrade` (`sold?center&dim`) at exactly
 * `adress`. Sales before `fran` (YYYY-MM-DD) are dropped; a sale in both lists
 * once (booliId, else date + price); newest first; at most MAX_FORSALJNINGAR. Pure.
 */
export function sammanstallForsaljningar(
  egna: readonly unknown[],
  omrade: readonly unknown[],
  adress: string | null,
  fran: string,
): TidigareForsaljning[] {
  const ut: TidigareForsaljning[] = [];
  const idn = new Set<number>();
  const sedda = new Set<string>();
  const lagg = (t: TolkadSaldRad, dennaLagenhet: boolean) => {
    if (t.rad.saldDatum < fran) return;
    if (t.booliId !== null && idn.has(t.booliId)) return;
    const nyckel = `${t.rad.saldDatum}|${t.rad.pris}`;
    if (sedda.has(nyckel)) return;
    if (t.booliId !== null) idn.add(t.booliId);
    sedda.add(nyckel);
    ut.push({ ...t.rad, dennaLagenhet });
  };
  for (const r of egna) {
    const t = tolkaSaldRad(r);
    if (t) lagg(t, true);
  }
  if (adress !== null) {
    for (const r of omrade) {
      const t = tolkaSaldRad(r);
      if (t && t.adress !== null && sammaAdress(t.adress, adress)) lagg(t, false);
    }
  }
  ut.sort((a, b) => (a.saldDatum < b.saldDatum ? 1 : a.saldDatum > b.saldDatum ? -1 : 0));
  return ut.slice(0, MAX_FORSALJNINGAR);
}
