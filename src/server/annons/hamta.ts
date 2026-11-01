/**
 * "Hämta uppgifter": fetch one Booli listing and normalise it (docs/booli.md,
 * docs/plans/booli-api.md). `hamtaAnnonsFn` in analysFn.ts is a thin binding
 * to `hamtaAnnons`.
 *
 * Order of checks (cheapest and most private first; a refusal stops the rest):
 *   1. input shape `{ url }` → `ogiltig_url`
 *   2. kill switch `ANNONS_HAMTNING=off` → `avstangd`
 *   3. URL check (`kontrolleraAnnonsUrl`) → `fel_doman` / `ogiltig_url`
 *   4. 24 h cache (`annons_cache`): a hit is free (no quota, no fetch)
 *   5. entitlement `hamta_annons`
 *   6. quota `annonshamtning` (20/device, 60/IP per hour)
 *   7. the source (kallor.ts):
 *      - the API on (`BOOLI_API` ≠ off and both keys set) → the Booli API
 *        (booliApi.ts): `/annons/<id>` 1–3 calls, `/bostad/<id>` (residence
 *        id, via the `residenceId` filter, never `listings/{id}`) 1–4 calls;
 *      - the API failed with `nyckel`/`natverk`/`tolkning` or is off → the
 *        listing page (booliSida.ts), ONLY when `ANNONS_SIDHAMTNING=on`
 *        (default off);
 *      - otherwise a buyer-safe message: the API's `hittades_inte` →
 *        `hittades_inte`, no source at all → `avstangd`, else the general
 *        "fyll i manuellt". When no source is on, that is decided before
 *        steps 5–6 (no quota taken for nothing).
 *   8. cache the success (`metod: "api" | "sida"`)
 *
 * Every expected failure is RETURNED as `{ ok: false, errorCode, errorMessage }`
 * with a buyer-safe Swedish text; nothing here throws for an expected case, and
 * an unexpected exception is caught, logged and returned as `natverk`.
 * Logging is `console.warn("[annons] …", {...})` (Cloudflare Workers logs),
 * each line naming its source (`kalla`); an API key Booli refuses logs
 * `booli-api nyckel avvisad` (the signal that the ~3-month key has expired).
 */

import { z } from "zod";
import {
  ANNONS_FALT,
  ANNONS_MEDDELANDE,
  faltStatus,
  type AnnonsFalt,
  type AnnonsFelkod,
  type AnnonsSvar,
} from "@/lib/annons/typer";
import { kontrolleraAnnonsUrl } from "@/lib/annons/url";
import { SAKNAR_BEHORIGHET_MEDDELANDE, SaknarBehorighetError } from "../behorighet";
import { kontrolleraAnnonskvot } from "../kvot";
import { booliApiLeverantor, booliApiNycklar } from "./booliApi";
import { booliSidaLeverantor } from "./booliSida";
import {
  felText,
  logga,
  type AnnonsLeverantor,
  type HamtaAnnonsBeroenden,
  type KontrolleradLank,
  type LeverantorFelkod,
  type LeverantorUtfall,
} from "./kallor";

export type { HamtaAnnonsBeroenden } from "./kallor";
export { ANNONS_KARNFALT } from "./kallor";
export {
  ANNONS_FETCH_TIDSGRANS_MS,
  ANNONS_MAX_KROPP_BYTES,
  BOOLI_FETCH_HEADERS,
} from "./booliSida";

/** A cached answer younger than this is served without fetching. */
export const ANNONS_CACHE_GILTIGHET_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Input and cache schemas
// ---------------------------------------------------------------------------

const IndataSchema = z.object({ url: z.string().max(500) }).strict();

const StatusVardeSchema = z.enum(["hittad", "saknas"]);

const UppgifterSchema = z
  .object({
    adress: z.string().min(1).optional(),
    postnummer: z
      .string()
      .regex(/^\d{3} \d{2}$/)
      .optional(),
    ort: z.string().min(1).optional(),
    utgangspris: z.number().int().positive().optional(),
    manadsavgift: z.number().int().positive().optional(),
    boarea: z.number().positive().optional(),
    antalRum: z.number().positive().optional(),
    vaning: z.number().int().optional(),
    byggar: z.number().int().optional(),
    hiss: z.enum(["ja", "nej"]).optional(),
    balkong: z.enum(["ja", "nej"]).optional(),
    stadsdel: z.string().min(1).optional(),
    forening: z.string().min(1).optional(),
    maklarUrl: z.string().min(1).max(2000).optional(),
    koordinater: z.object({ lat: z.number(), lon: z.number() }).strict().optional(),
  })
  .strict();

/** The ok-shape of `AnnonsSvar`, for reading the cache (an unparsable row is
 *  ignored, as if there were none). Rows cached before 2026-10-31 have no
 *  `metod` (= the page) and still parse. */
export const OkAnnonsSvarSchema = z
  .object({
    ok: z.literal(true),
    kalla: z.literal("booli"),
    url: z.string().min(1),
    uppgifter: UppgifterSchema,
    status: z
      .object(
        Object.fromEntries(ANNONS_FALT.map((f) => [f, StatusVardeSchema])) as Record<
          AnnonsFalt,
          typeof StatusVardeSchema
        >,
      )
      .strict(),
    postnummerKalla: z.enum(["annons", "geokodning"]).optional(),
    tolkning: z.enum(["struktur", "llm"]),
    metod: z.enum(["api", "sida"]).optional(),
    hamtad: z.string().min(1),
  })
  .strict();

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function felSvar(errorCode: AnnonsFelkod, errorMessage?: string): AnnonsSvar {
  const standard: Record<AnnonsFelkod, string> = {
    fel_doman: ANNONS_MEDDELANDE.fel_doman,
    ogiltig_url: ANNONS_MEDDELANDE.ogiltig_url,
    avstangd: ANNONS_MEDDELANDE.avstangd,
    behorighet: SAKNAR_BEHORIGHET_MEDDELANDE,
    kvot: ANNONS_MEDDELANDE.kvot,
    blockerad: ANNONS_MEDDELANDE.allmant,
    hittades_inte: ANNONS_MEDDELANDE.allmant,
    tolkning: ANNONS_MEDDELANDE.allmant,
    natverk: ANNONS_MEDDELANDE.allmant,
  };
  return { ok: false, errorCode, errorMessage: errorMessage ?? standard[errorCode] };
}

/** A source failure as the buyer's error code (all show "fyll i manuellt"). */
function felkodFor(kod: LeverantorFelkod): AnnonsFelkod {
  switch (kod) {
    case "nyckel":
    case "ej_tillganglig":
      return "natverk";
    default:
      return kod;
  }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

async function lasCache(
  b: HamtaAnnonsBeroenden,
  url: string,
  nu: Date,
): Promise<Extract<AnnonsSvar, { ok: true }> | null> {
  let rad;
  try {
    rad = await b.anropare.konto.lasAnnonsCache(url);
  } catch (fel) {
    logga("cache-lasning misslyckades", { url, orsak: felText(fel) });
    return null;
  }
  if (!rad) return null;
  const alder = nu.getTime() - new Date(rad.hamtad).getTime();
  if (!Number.isFinite(alder) || alder >= ANNONS_CACHE_GILTIGHET_MS) return null;
  const parsed = OkAnnonsSvarSchema.safeParse(rad.svar);
  if (!parsed.success) {
    logga("cache-rad kunde inte tolkas, ignoreras", { url });
    return null;
  }
  return parsed.data as Extract<AnnonsSvar, { ok: true }>;
}

// ---------------------------------------------------------------------------
// Choice of source
// ---------------------------------------------------------------------------

interface Kallval {
  /** Tried first; null when the API can't serve this link. */
  api: AnnonsLeverantor | null;
  /** The page source when `ANNONS_SIDHAMTNING=on`, else null. */
  sida: AnnonsLeverantor | null;
}

function valjKallor(lank: KontrolleradLank, b: HamtaAnnonsBeroenden): Kallval {
  return {
    api: booliApiNycklar(b.env) !== null ? booliApiLeverantor : null,
    sida: b.env.annonsSidhamtning === true ? booliSidaLeverantor : null,
  };
}

/** The API failures after which the page may still be tried. */
const SIDAN_EFTER_API: ReadonlySet<LeverantorFelkod> = new Set([
  "nyckel",
  "natverk",
  "tolkning",
  "ej_tillganglig",
]);

// ---------------------------------------------------------------------------
// hamtaAnnons
// ---------------------------------------------------------------------------

export async function hamtaAnnons(
  data: unknown,
  beroenden: HamtaAnnonsBeroenden,
): Promise<AnnonsSvar> {
  try {
    return await kor(data, beroenden);
  } catch (fel) {
    // Never reaches the buyer: anything unexpected is a plain "fill in manually".
    logga("oväntat fel", { orsak: felText(fel) });
    return felSvar("natverk");
  }
}

async function kor(data: unknown, b: HamtaAnnonsBeroenden): Promise<AnnonsSvar> {
  const nu = b.nu ?? (() => new Date());

  // 1. Input shape.
  const indata = IndataSchema.safeParse(data);
  if (!indata.success) return felSvar("ogiltig_url");

  // 2. Kill switch (default on).
  if (b.env.annonsHamtningAvstangd === true) return felSvar("avstangd");

  // 3. URL check: nothing but a Booli listing URL is ever fetched.
  const kontroll = kontrolleraAnnonsUrl(indata.data.url);
  if (!kontroll.ok) return felSvar(kontroll.errorCode);
  const lank: KontrolleradLank = { url: kontroll.url, typ: kontroll.typ, id: kontroll.id };
  const url = lank.url;

  // 4. Cache: a fresh hit costs neither quota nor a request. NOTE: it is served
  //    before the entitlement check; if `hamta_annons` is ever restricted,
  //    move this below step 5.
  const cachad = await lasCache(b, url, nu());
  if (cachad) return cachad;

  // No source can serve this link: say so without taking quota.
  const kallor = valjKallor(lank, b);
  if (kallor.api === null && kallor.sida === null) {
    logga("ingen källa för länken", {
      url,
      typ: lank.typ,
      api: booliApiNycklar(b.env) !== null,
      sida: false,
    });
    return felSvar("avstangd");
  }

  // 5. Entitlement.
  try {
    await b.anropare.behorighet.kravBehorighet(b.anropare.kontext, "hamta_annons");
  } catch (fel) {
    if (!(fel instanceof SaknarBehorighetError)) throw fel;
    return felSvar("behorighet");
  }

  // 6. Quota.
  const kvot = await kontrolleraAnnonskvot(b.anropare.konto, b.anropare.kontext);
  if (!kvot.ok) return felSvar("kvot", kvot.message);

  // 7. The source(s).
  let kalla: AnnonsLeverantor | null = null;
  let utfall: LeverantorUtfall | null = null;
  if (kallor.api) {
    kalla = kallor.api;
    utfall = await kallor.api.hamta(lank, b);
    if (utfall.typ === "fel") {
      if (kallor.sida === null || !SIDAN_EFTER_API.has(utfall.kod)) {
        return felSvar(felkodFor(utfall.kod));
      }
      logga("api misslyckades, provar sidan", { url, kalla: kallor.api.namn, kod: utfall.kod });
      kalla = null;
      utfall = null;
    }
  }
  if (utfall === null && kallor.sida) {
    kalla = kallor.sida;
    utfall = await kallor.sida.hamta(lank, b);
  }
  if (utfall === null || kalla === null) return felSvar("natverk");
  if (utfall.typ === "fel") return felSvar(felkodFor(utfall.kod));

  // 8. The answer, and the cache (a success only; a failed write never fails it).
  const svar: Extract<AnnonsSvar, { ok: true }> = {
    ok: true,
    kalla: "booli",
    url,
    uppgifter: utfall.uppgifter,
    status: faltStatus(utfall.uppgifter),
    ...(utfall.postnummerKalla ? { postnummerKalla: utfall.postnummerKalla } : {}),
    tolkning: utfall.tolkning,
    metod: kalla.metod,
    hamtad: nu().toISOString(),
  };
  if (OkAnnonsSvarSchema.safeParse(svar).success) {
    try {
      await b.anropare.konto.skrivAnnonsCache(url, svar);
    } catch (fel) {
      logga("cache-skrivning misslyckades", { url, orsak: felText(fel) });
    }
  } else {
    logga("svaret följer inte cacheschemat, cachas inte", { url, kalla: kalla.namn });
  }
  return svar;
}
