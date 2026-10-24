/**
 * "Hämta uppgifter": fetch one listing page and normalise it (docs/booli.md).
 * `hamtaAnnonsFn` in analysFn.ts is a thin binding to `hamtaAnnons`.
 *
 * Order of checks (cheapest and most private first; a refusal stops the rest):
 *   1. input shape `{ url }` → `ogiltig_url`
 *   2. kill switch `ANNONS_HAMTNING=off` → `avstangd`
 *   3. URL check (`kontrolleraAnnonsUrl`) → `fel_doman` / `ogiltig_url`
 *   4. 24 h cache (`annons_cache`): a hit is free (no quota, no fetch)
 *   5. entitlement `hamta_annons`
 *   6. quota `annonshamtning` (20/device, 60/IP per hour)
 *   7. ONE fetch: browser header set, 10 s deadline, `redirect: "manual"`
 *      (one redirect, only to another valid listing URL), 3 MB body cap,
 *      never a retry
 *   8. parse (`tolkaBooli`), optional model fallback, postcode fallback
 *      (Nominatim), cache the success
 *
 * Every expected failure is RETURNED as `{ ok: false, errorCode, errorMessage }`
 * with a buyer-safe Swedish text; nothing here throws for an expected case, and
 * an unexpected exception is caught, logged and returned as `natverk`.
 *
 * A Cloudflare challenge is reported as `blockerad`; Binfo never tries to
 * solve or work around one. Logging (`console.warn("[annons] …", {...})`,
 * visible in the Cloudflare Workers logs) is how layout changes get noticed:
 * blocked, not found, network trouble, parse failures, partial results, the
 * model fallback, and any core field missing on an otherwise good parse. The
 * page itself is never logged.
 */

import { z } from "zod";
import {
  ANNONS_FALT,
  ANNONS_MEDDELANDE,
  faltStatus,
  type AnnonsFalt,
  type AnnonsFelkod,
  type AnnonsSvar,
  type AnnonsUppgifter,
} from "@/lib/annons/typer";
import { kontrolleraAnnonsUrl } from "@/lib/annons/url";
import type { AnthropicClientLike } from "@/lib/analysis/runExtraction";
import { SAKNAR_BEHORIGHET_MEDDELANDE, SaknarBehorighetError } from "../behorighet";
import type { Env } from "../env";
import { kontrolleraAnnonskvot } from "../kvot";
import type { Anropare, Databas } from "../portar";
import { reserveraForSteg, stamAvSteg } from "../spend";
import { skapaLager } from "../supabase";
import { tolkaBooli } from "./booli";
import { geokodaPostnummer, type GeokodIndata, type GeokodUtfall } from "./geokod";
import { tolkaAnnonsMedModell, type AnnonsLlmUtfall } from "./llmFallback";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** One overall deadline for the whole fetch (redirect and body included). */
export const ANNONS_FETCH_TIDSGRANS_MS = 10_000;
/** The body is read as a stream and abandoned beyond this. A listing page is
 *  ~140 kB (fixtures/booli). */
export const ANNONS_MAX_KROPP_BYTES = 3 * 1024 * 1024;
/** A cached answer younger than this is served without fetching. */
export const ANNONS_CACHE_GILTIGHET_MS = 24 * 60 * 60 * 1000;

/**
 * The header set of a normal Chrome 130 on macOS, WITHOUT `Accept-Encoding`:
 * the Workers runtime manages compression itself. Booli sits behind Cloudflare
 * bot management, which judges the whole fingerprint; see docs/booli.md
 * ("Blocking") for what was measured (curl and Node fetch are challenged, a
 * local workerd with exactly this set got the real page; the production Worker
 * is verified after deploy). Sent once per request, never varied to dodge a
 * block.
 */
export const BOOLI_FETCH_HEADERS: Readonly<Record<string, string>> = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "accept-language": "sv-SE,sv;q=0.9,en;q=0.8",
  "sec-ch-ua": '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
};

/** The fields present in all six recorded fixtures (docs/booli.md): when one is
 *  missing on an otherwise good parse, the page layout has probably changed. */
export const ANNONS_KARNFALT: readonly AnnonsFalt[] = [
  "adress",
  "postnummer",
  "ort",
  "boarea",
  "antalRum",
  "vaning",
  "byggar",
];

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface HamtaAnnonsBeroenden {
  anropare: Anropare;
  env: Env;
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Injected in tests. */
  nu?: () => Date;
  /** Overall fetch deadline; default 10 s (tests shorten it). */
  tidsgransMs?: number;
  /** Injected in tests: replaces the Nominatim lookup. */
  geokoda?: (indata: GeokodIndata) => Promise<GeokodUtfall>;
  /** Injected in tests: replaces the WHOLE model fallback (call and spend). */
  llm?: (html: string, url: string) => Promise<AnnonsLlmUtfall>;
  /** Injected in tests: the Anthropic client of the default model fallback. */
  anthropicKlient?: AnthropicClientLike;
  /** Injected in tests: the database holding the daily spend counter that the
   *  default model fallback reserves against (default: the real one). */
  spendDb?: Databas;
}

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
    hiss: z.literal("ja").optional(),
    balkong: z.literal("ja").optional(),
    stadsdel: z.string().min(1).optional(),
    forening: z.string().min(1).optional(),
    maklarUrl: z.string().min(1).max(2000).optional(),
    koordinater: z.object({ lat: z.number(), lon: z.number() }).strict().optional(),
  })
  .strict();

/** The ok-shape of `AnnonsSvar`, for reading the cache (an unparsable row is
 *  ignored, as if there were none). */
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

function felText(fel: unknown): string {
  return fel instanceof Error ? fel.message : String(fel);
}

function logga(handelse: string, detaljer: Record<string, unknown>): void {
  console.warn(`[annons] ${handelse}`, detaljer);
}

function harFormfalt(u: AnnonsUppgifter): boolean {
  return ANNONS_FALT.some((f) => u[f] !== undefined);
}

/** `{...a, ...b}` where b's undefined values never overwrite (exactOptionalPropertyTypes). */
function slaSamman(bas: AnnonsUppgifter, over: AnnonsUppgifter): AnnonsUppgifter {
  const ut: Record<string, unknown> = { ...bas };
  for (const [k, v] of Object.entries(over)) if (v !== undefined) ut[k] = v;
  return ut as AnnonsUppgifter;
}

// ---------------------------------------------------------------------------
// The fetch
// ---------------------------------------------------------------------------

type SidUtfall =
  | { typ: "ok"; html: string; slutUrl: string }
  | { typ: "fel"; kod: "blockerad" | "hittades_inte" | "natverk"; orsak: string };

/** Streams the body, abandoning it beyond `max` bytes. */
async function lasKropp(res: Response, max: number): Promise<string | "for_stor"> {
  const langd = Number(res.headers.get("content-length"));
  if (Number.isFinite(langd) && langd > max) {
    await res.body?.cancel().catch(() => undefined);
    return "for_stor";
  }
  if (!res.body) return "";
  const lasare = res.body.getReader();
  const delar: Uint8Array[] = [];
  let totalt = 0;
  for (;;) {
    const { done, value } = await lasare.read();
    if (done) break;
    totalt += value.byteLength;
    if (totalt > max) {
      await lasare.cancel().catch(() => undefined);
      return "for_stor";
    }
    delar.push(value);
  }
  const alla = new Uint8Array(totalt);
  let pos = 0;
  for (const d of delar) {
    alla.set(d, pos);
    pos += d.byteLength;
  }
  return new TextDecoder("utf-8").decode(alla);
}

/** Maps a non-success response (or a challenge) to the failure to report; null for 2xx. */
function felForSvar(res: Response): SidUtfall | null {
  if (res.headers.get("cf-mitigated") !== null || res.status === 403 || res.status === 503) {
    return { typ: "fel", kod: "blockerad", orsak: `http ${res.status}` };
  }
  if (res.status === 404 || res.status === 410) {
    return { typ: "fel", kod: "hittades_inte", orsak: `http ${res.status}` };
  }
  if (!res.ok) return { typ: "fel", kod: "natverk", orsak: `http ${res.status}` };
  return null;
}

async function hamtaSida(
  kanonisk: string,
  doFetch: typeof fetch,
  tidsgransMs: number,
): Promise<SidUtfall> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), tidsgransMs);
  const hamta = (url: string) =>
    doFetch(url, {
      method: "GET",
      headers: BOOLI_FETCH_HEADERS,
      redirect: "manual",
      signal: ctrl.signal,
    });

  try {
    let url = kanonisk;
    let res = await hamta(url);

    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel().catch(() => undefined);
      const plats = res.headers.get("location");
      if (!plats) return { typ: "fel", kod: "natverk", orsak: `http ${res.status} utan Location` };
      let mal: string;
      try {
        mal = new URL(plats, url).href;
      } catch {
        return { typ: "fel", kod: "hittades_inte", orsak: "omdirigering till ogiltig adress" };
      }
      const kontroll = kontrolleraAnnonsUrl(mal);
      if (!kontroll.ok) {
        return {
          typ: "fel",
          kod: "hittades_inte",
          orsak: `omdirigering till annan sida (${kontroll.errorCode})`,
        };
      }
      url = kontroll.url;
      res = await hamta(url);
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel().catch(() => undefined);
        return { typ: "fel", kod: "natverk", orsak: "mer än en omdirigering" };
      }
    }

    const fel = felForSvar(res);
    if (fel) {
      await res.body?.cancel().catch(() => undefined);
      return fel;
    }
    const html = await lasKropp(res, ANNONS_MAX_KROPP_BYTES);
    if (html === "for_stor") {
      return { typ: "fel", kod: "natverk", orsak: "sidan är större än 3 MB" };
    }
    return { typ: "ok", html, slutUrl: url };
  } catch (fel) {
    return {
      typ: "fel",
      kod: "natverk",
      orsak: ctrl.signal.aborted ? `timeout efter ${tidsgransMs} ms` : felText(fel),
    };
  } finally {
    clearTimeout(timer);
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
// Model fallback (default wiring)
// ---------------------------------------------------------------------------

function standardLlm(
  b: HamtaAnnonsBeroenden,
): (html: string, url: string) => Promise<AnnonsLlmUtfall> {
  return async (html, url) => {
    const db = b.spendDb ?? skapaLager(b.env).db;
    return tolkaAnnonsMedModell(html, url, {
      apiKey: b.env.anthropicApiKey,
      ...(b.anthropicKlient ? { client: b.anthropicKlient } : {}),
      ...(b.nu ? { nu: b.nu } : {}),
      spend: {
        reservera: async (sek) => (await reserveraForSteg(db, b.env, sek)).ok,
        avstam: (reserverat, faktiskt) => stamAvSteg(db, reserverat, faktiskt),
      },
    });
  };
}

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
  const url = kontroll.url;

  // 4. Cache: a fresh hit costs neither quota nor a request.
  const cachad = await lasCache(b, url, nu());
  if (cachad) return cachad;

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

  // 7. One fetch.
  const sida = await hamtaSida(url, b.fetch ?? fetch, b.tidsgransMs ?? ANNONS_FETCH_TIDSGRANS_MS);
  if (sida.typ === "fel") {
    logga(
      sida.kod === "blockerad"
        ? "blockerad"
        : sida.kod === "hittades_inte"
          ? "hittades inte"
          : "nätverk",
      {
        url,
        orsak: sida.orsak,
      },
    );
    return felSvar(sida.kod);
  }

  // 8. Parse (+ model fallback, + postcode fallback).
  let uppgifter: AnnonsUppgifter;
  let tolkning: "struktur" | "llm" = "struktur";
  try {
    const t = tolkaBooli(sida.html, sida.slutUrl);
    if (t.typ === "blockerad") {
      logga("blockerad", { url, orsak: "utmaningssida (challenge) i svaret" });
      return felSvar("blockerad");
    }
    if (t.typ === "ok") {
      uppgifter = t.uppgifter;
    } else {
      logga("tolkning misslyckades", { url, orsak: t.orsak });
      const fran = await tolkaMedModell(b, sida.html, url, t.delvis);
      if (fran) {
        uppgifter = fran.uppgifter;
        tolkning = fran.tolkning;
      } else if (harFormfalt(t.delvis)) {
        logga("delvis resultat", {
          url,
          orsak: t.orsak,
          fält: ANNONS_FALT.filter((f) => t.delvis[f] !== undefined),
        });
        uppgifter = t.delvis;
      } else {
        return felSvar("tolkning");
      }
    }
  } catch (fel) {
    logga("tolkning misslyckades", { url, orsak: `undantag: ${felText(fel)}` });
    return felSvar("tolkning");
  }

  const saknasKarn = ANNONS_KARNFALT.filter((f) => uppgifter[f] === undefined);
  if (saknasKarn.length > 0) {
    logga("kärnfält saknas, sidans layout kan ha ändrats", { url, saknas: saknasKarn, tolkning });
  }

  let postnummerKalla: "annons" | "geokodning" | undefined =
    uppgifter.postnummer !== undefined ? "annons" : undefined;
  if (uppgifter.postnummer === undefined) {
    const geo = await (
      b.geokoda ?? ((i) => geokodaPostnummer(i, b.fetch ? { fetch: b.fetch } : {}))
    )({
      koordinater: uppgifter.koordinater,
      adress: uppgifter.adress,
      ort: uppgifter.ort,
    });
    if (geo.postnummer !== null) {
      uppgifter = { ...uppgifter, postnummer: geo.postnummer };
      postnummerKalla = "geokodning";
    } else {
      logga("geokodning gav inget postnummer", { url, orsak: geo.orsak });
    }
  }

  // 9. The answer, and the cache (a success only; a failed write never fails it).
  const svar: Extract<AnnonsSvar, { ok: true }> = {
    ok: true,
    kalla: "booli",
    url,
    uppgifter,
    status: faltStatus(uppgifter),
    ...(postnummerKalla ? { postnummerKalla } : {}),
    tolkning,
    hamtad: nu().toISOString(),
  };
  if (OkAnnonsSvarSchema.safeParse(svar).success) {
    try {
      await b.anropare.konto.skrivAnnonsCache(url, svar);
    } catch (fel) {
      logga("cache-skrivning misslyckades", { url, orsak: felText(fel) });
    }
  } else {
    logga("svaret följer inte cacheschemat, cachas inte", { url });
  }
  return svar;
}

/**
 * The optional model fallback (flag + key). Returns the merged values
 * (structured `delvis` values win over the model's) or null when it is off,
 * refused, failed or produced nothing usable.
 */
async function tolkaMedModell(
  b: HamtaAnnonsBeroenden,
  html: string,
  url: string,
  delvis: AnnonsUppgifter,
): Promise<{ uppgifter: AnnonsUppgifter; tolkning: "llm" } | null> {
  if (b.env.annonsLlmFallback !== true || !b.env.anthropicApiKey) return null;

  let utfall: AnnonsLlmUtfall;
  try {
    utfall = await (b.llm ?? standardLlm(b))(html, url);
  } catch (fel) {
    logga("llm-fallback", { url, utfall: "undantag", orsak: felText(fel) });
    return null;
  }
  logga("llm-fallback", {
    url,
    utfall: utfall.typ === "ok" ? "ok" : utfall.orsak,
    ...(utfall.typ === "ingen" && utfall.detalj ? { detalj: utfall.detalj } : {}),
    kostnadSek: Number(utfall.kostnadSek.toFixed(4)),
    ...(utfall.anrop
      ? {
          model: utfall.anrop.model,
          inputTokens: utfall.anrop.inputTokens,
          outputTokens: utfall.anrop.outputTokens,
          latencyMs: Math.round(utfall.anrop.latencyMs),
        }
      : {}),
  });
  if (utfall.typ !== "ok") return null;
  const sammanslagen = slaSamman(utfall.uppgifter, delvis);
  return harFormfalt(sammanslagen) ? { uppgifter: sammanslagen, tolkning: "llm" } : null;
}
