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
