/**
 * "Tidigare försäljningar": a flat's earlier sales from Booli
 * (docs/plans/salt-i-huset.md). `hamtaForsaljningarFn` in analysFn.ts is a
 * thin binding to `hamtaForsaljningar`. Shown only, never a valuation input.
 *
 * Order (cheapest first; a refusal stops the rest, every refusal is `{ ok: false }`):
 *   1. input `{ url }`; kill switch `ANNONS_HAMTNING=off`; `kontrolleraAnnonsUrl`
 *      with `typ === "bostad"` only (an `/annons/` id is not a residence id);
 *      the API keys (`booliApiNycklar`: `BOOLI_API=off` or no keys → nothing);
 *   2. 24 h cache in `annons_cache` under `forsaljningarCacheNyckel(id)`: a hit
 *      is free (no quota, no call); a cache failure is logged and ignored;
 *   3. entitlement `hamta_annons` and the listing quota (`kontrolleraAnnonskvot`);
 *   4. ONE call `sold?residenceId=<id>&sort=soldDate&direction=desc&limit=50`
 *      through `sokBostad` (refuses an answer that does not echo the filter);
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
import { booliApiNycklar, sokBostad, type BooliApiBeroenden } from "./booliApi";
import { tolkaTidigareForsaljningar } from "./booliApiTolkning";
import { ANNONS_CACHE_GILTIGHET_MS } from "./hamta";
import { felText, logga, type HamtaAnnonsBeroenden } from "./kallor";

type OkSvar = Extract<ForsaljningarSvar, { ok: true }>;

const INTE: ForsaljningarSvar = { ok: false };
const KALLA = "booli_api";

const IndataSchema = z.object({ url: z.string().max(500) }).strict();

const ForsaljningSchema = z
  .object({
    saldDatum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    pris: z.number().int().positive(),
    boarea: z.number().positive().nullable(),
    antalRum: z.number().positive().nullable(),
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

  // 4. One call.
  const api: BooliApiBeroenden = {
    ...(b.fetch ? { fetch: b.fetch } : {}),
    ...(b.nu ? { nu: b.nu } : {}),
    ...(b.unik ? { unik: b.unik } : {}),
    ...(b.apiTidsgransMs !== undefined ? { tidsgransMs: b.apiTidsgransMs } : {}),
  };
  const sok = await sokBostad("sold", id, { sort: "soldDate", direction: "desc" }, nycklar, api);
  if (sok.typ === "fel") {
    const handelse =
      sok.kod === "nyckel"
        ? "booli-api nyckel avvisad"
        : `försäljningar: ${sok.kod === "tolkning" ? "tolkning misslyckades" : sok.kod === "hittades_inte" ? "hittades inte" : "nätverk"}`;
    logga(handelse, { url: kontroll.url, kalla: KALLA, orsak: sok.orsak });
    return INTE;
  }

  // 5. Answer + cache.
  const tolkat = tolkaTidigareForsaljningar(sok.objekt);
  const svar: OkSvar = { ok: true, adress: tolkat.adress, forsaljningar: tolkat.forsaljningar };
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
