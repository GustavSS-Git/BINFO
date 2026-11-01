/**
 * "Sålda lägenheter på <adress>": the sales at a flat's address from Booli
 * (docs/plans/salt-i-huset.md), the flat's own marked, last 10 years. `hamtaForsaljningarFn` in analysFn.ts is a
 * thin binding to `hamtaForsaljningar`. Shown only, never a valuation input.
 *
 * Order (cheapest first; a refusal stops the rest, every refusal is `{ ok: false }`):
 *   1. input `{ url }`; kill switch `ANNONS_HAMTNING=off`; `kontrolleraAnnonsUrl`
 *      with `typ === "bostad"` only (an `/annons/` id is not a residence id);
 *      the API keys (`booliApiNycklar`: `BOOLI_API=off` or no keys → nothing);
 *   2. 24 h cache in `annons_cache` under `forsaljningarCacheNyckel(id)`: a hit
 *      is free (no quota, no call); a cache failure is logged and ignored;
 *   3. entitlement `hamta_annons` and the listing quota (`kontrolleraAnnonskvot`);
 *   4. `sold?residenceId` (the flat's own sales, via `sokBostad`, which refuses
 *      an answer that does not echo the filter); the flat's address and position
 *      from its newest sale, else from its listing (`listings?residenceId`,
 *      then `upcomingSale=1`); then `sold?center&dim` (BOX_METER around the
 *      position, approximate on most rows) filtered on the exact address.
 *      2–4 calls; a failed box search still shows the flat's own sales;
 *   5. the ok answer is cached (an empty list too). A Booli failure is logged
 *      (`kalla: "booli_api"`; a refused key as `booli-api nyckel avvisad`) and
 *      nothing is cached.
 * Never throws: anything unexpected is logged and returned as `{ ok: false }`.
 */

import { z } from "zod";
import {
  MAX_FORSALJNINGAR,
  forsaljningarCacheNyckel,
  type ForsaljningarSvar,
} from "@/lib/annons/forsaljningar";
import { kontrolleraAnnonsUrl } from "@/lib/annons/url";
import { SaknarBehorighetError } from "../behorighet";
import { kontrolleraAnnonskvot } from "../kvot";
import { FORSALJNINGAR_AR } from "@/lib/annons/forsaljningar";
import {
  anropaBooliApi,
  booliApiNycklar,
  sokBostad,
  type BooliApiBeroenden,
  type BooliApiNycklar,
} from "./booliApi";
import { sammanstallForsaljningar, tolkaBooliApiObjekt, tolkaSaldRad } from "./booliApiTolkning";
import { ANNONS_CACHE_GILTIGHET_MS } from "./hamta";
import { felText, logga, type HamtaAnnonsBeroenden } from "./kallor";

type OkSvar = Extract<ForsaljningarSvar, { ok: true }>;

const INTE: ForsaljningarSvar = { ok: false };
const KALLA = "booli_api";
/** Side of the search box (m). Booli's positions are approximate (Östermalmsgatan
 *  30: 32 sales in a 120 m box, 2026-11-01); the address filter decides. */
const BOX_METER = 200;

const IndataSchema = z.object({ url: z.string().max(500) }).strict();

const ForsaljningSchema = z
  .object({
    saldDatum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    pris: z.number().int().positive(),
    boarea: z.number().positive().nullable(),
    antalRum: z.number().positive().nullable(),
    vaning: z.number().nonnegative().nullable(),
    dennaLagenhet: z.boolean(),
    avgift: z.number().int().positive().nullable(),
  })
  .strict();

/** The ok-shape of `ForsaljningarSvar`, for reading the cache. */
export const OkForsaljningarSvarSchema = z
  .object({
    ok: z.literal(true),
    adress: z.string().min(1).nullable(),
    forsaljningar: z.array(ForsaljningSchema).max(MAX_FORSALJNINGAR),
  })
  .strict();

export async function hamtaForsaljningar(
  data: unknown,
  beroenden: HamtaAnnonsBeroenden,
): Promise<ForsaljningarSvar> {
  try {
    return await kor(data, beroenden);
  } catch (fel) {
    logga("försäljningar: oväntat fel", { kalla: KALLA, orsak: felText(fel) });
    return INTE;
  }
}

async function lasCache(b: HamtaAnnonsBeroenden, nyckel: string, nu: Date): Promise<OkSvar | null> {
  let rad;
  try {
    rad = await b.anropare.konto.lasAnnonsCache(nyckel);
  } catch (fel) {
    logga("försäljningar: cache-läsning misslyckades", { nyckel, orsak: felText(fel) });
    return null;
  }
  if (!rad) return null;
  const alder = nu.getTime() - new Date(rad.hamtad).getTime();
  if (!Number.isFinite(alder) || alder >= ANNONS_CACHE_GILTIGHET_MS) return null;
  const parsed = OkForsaljningarSvarSchema.safeParse(rad.svar);
  if (!parsed.success) {
    logga("försäljningar: cache-rad kunde inte tolkas, ignoreras", { nyckel });
    return null;
  }
  return parsed.data;
}

async function kor(data: unknown, b: HamtaAnnonsBeroenden): Promise<ForsaljningarSvar> {
  const nu = b.nu ?? (() => new Date());

  // 1. Input, kill switch, link type, keys.
  const indata = IndataSchema.safeParse(data);
  if (!indata.success) return INTE;
  if (b.env.annonsHamtningAvstangd === true) return INTE;
  const kontroll = kontrolleraAnnonsUrl(indata.data.url);
  if (!kontroll.ok || kontroll.typ !== "bostad") return INTE;
  const id = kontroll.id;
  const nycklar = booliApiNycklar(b.env);
  if (nycklar === null) return INTE;

  // 2. Cache (free).
  const nyckel = forsaljningarCacheNyckel(id);
  const cachad = await lasCache(b, nyckel, nu());
  if (cachad) return cachad;

  // 3. Entitlement and quota.
  try {
    await b.anropare.behorighet.kravBehorighet(b.anropare.kontext, "hamta_annons");
  } catch (fel) {
    if (!(fel instanceof SaknarBehorighetError)) throw fel;
    return INTE;
  }
  const kvot = await kontrolleraAnnonskvot(b.anropare.konto, b.anropare.kontext);
  if (!kvot.ok) return INTE;

  // 4. The flat's own sales, its address, the building's sales.
  const api: BooliApiBeroenden = {
    ...(b.fetch ? { fetch: b.fetch } : {}),
    ...(b.nu ? { nu: b.nu } : {}),
    ...(b.unik ? { unik: b.unik } : {}),
    ...(b.apiTidsgransMs !== undefined ? { tidsgransMs: b.apiTidsgransMs } : {}),
  };
  const sok = await sokBostad("sold", id, { sort: "soldDate", direction: "desc" }, nycklar, api);
  if (sok.typ === "fel") {
    loggaFel(sok.kod, sok.orsak, kontroll.url);
    return INTE;
  }
  const egna = sok.objekt;
  const plats = (await platsForBostad(egna, id, nycklar, api)) ?? null;
  const fran = franDatum(nu());
  let omrade: unknown[] = [];
  if (plats?.position) {
    const box = await anropaBooliApi(
      "sold",
      {
        center: `${plats.position.lat},${plats.position.lon}`,
        dim: `${BOX_METER},${BOX_METER}`,
        objectType: "Lägenhet",
        minSoldDate: fran.replaceAll("-", ""),
        sort: "soldDate",
        direction: "desc",
        limit: "1000",
      },
      nycklar,
      api,
    );
    const lista = box.typ === "ok" ? (box.data as { sold?: unknown } | null)?.sold : undefined;
    if (Array.isArray(lista)) omrade = lista;
    else
      loggaFel(
        box.typ === "fel" ? box.kod : "tolkning",
        box.typ === "fel" ? box.orsak : "sold?center: oväntad form",
        kontroll.url,
      );
  }

  // 5. Answer + cache.
  const adress = plats?.adress ?? null;
  const svar: OkSvar = {
    ok: true,
    adress,
    forsaljningar: sammanstallForsaljningar(egna, omrade, adress, fran),
  };
  if (OkForsaljningarSvarSchema.safeParse(svar).success) {
    try {
      await b.anropare.konto.skrivAnnonsCache(nyckel, svar);
    } catch (fel) {
      logga("försäljningar: cache-skrivning misslyckades", { nyckel, orsak: felText(fel) });
    }
  } else {
    logga("försäljningar: svaret följer inte cacheschemat, cachas inte", { nyckel, kalla: KALLA });
  }
  return svar;
}

function loggaFel(kod: string, orsak: string, url: string): void {
  const handelse =
    kod === "nyckel"
      ? "booli-api nyckel avvisad"
      : `försäljningar: ${kod === "tolkning" ? "tolkning misslyckades" : kod === "hittades_inte" ? "hittades inte" : "nätverk"}`;
  logga(handelse, { url, kalla: KALLA, orsak });
}

/** Today minus FORSALJNINGAR_AR years, "YYYY-MM-DD" (UTC). */
export function franDatum(nu: Date): string {
  const d = new Date(nu.getTime());
  d.setUTCFullYear(d.getUTCFullYear() - FORSALJNINGAR_AR);
  return d.toISOString().slice(0, 10);
}

interface Plats {
  adress: string | null;
  position: { lat: number; lon: number } | null;
}

/** The flat's address and position: its newest sale, else its listing
 *  (active, then kommande). Null when Booli has neither. */
async function platsForBostad(
  egna: readonly unknown[],
  id: string,
  nycklar: BooliApiNycklar,
  api: BooliApiBeroenden,
): Promise<Plats | null> {
  for (const r of egna) {
    const t = tolkaSaldRad(r);
    if (t && t.adress !== null && t.position !== null)
      return { adress: t.adress, position: t.position };
  }
  for (const extra of [{}, { upcomingSale: "1" }]) {
    const sok = await sokBostad("listings", id, extra, nycklar, api);
    if (sok.typ === "fel") return null;
    for (const o of sok.objekt) {
      const u = tolkaBooliApiObjekt(o).uppgifter;
      if (u.adress !== undefined) {
        return {
          adress: u.adress,
          position: u.koordinater ? { lat: u.koordinater.lat, lon: u.koordinater.lon } : null,
        };
      }
    }
  }
  return null;
}
