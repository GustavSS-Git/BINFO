/**
 * The listing-page source (`booliSidaLeverantor`): ONE GET of the Booli page,
 * the structured parser (`tolkaBooli`, booli.ts), the optional model fallback
 * (`ANNONS_LLM_FALLBACK=on`) and the Nominatim postcode fallback. Moved here
 * from hamta.ts unchanged (2026-10-31); hamta.ts uses it only when
 * `ANNONS_SIDHAMTNING=on` (the page is Cloudflare-challenged in production).
 *
 *   - browser header set, 10 s deadline, `redirect: "manual"` (one redirect,
 *     only to another valid listing URL), 3 MB body cap, never a retry;
 *   - a Cloudflare challenge is `blockerad`; Binfo never tries to solve or
 *     work around one;
 *   - logs (`[annons] …`, `kalla: "booli_sida"`) blocked, not found, network
 *     trouble, parse failures, partial results, the model fallback, and any
 *     core field missing on an otherwise good parse. The page itself is never
 *     logged.
 */

import { ANNONS_FALT, type AnnonsUppgifter } from "@/lib/annons/typer";
import { kontrolleraAnnonsUrl } from "@/lib/annons/url";
import { reserveraForSteg, stamAvSteg } from "../spend";
import { skapaLager } from "../supabase";
import { tolkaBooli } from "./booli";
import { geokodaPostnummer } from "./geokod";
import {
  ANNONS_KARNFALT,
  felText,
  harFormfalt,
  logga,
  type AnnonsLeverantor,
  type HamtaAnnonsBeroenden,
  type LeverantorUtfall,
} from "./kallor";
import { tolkaAnnonsMedModell, type AnnonsLlmUtfall } from "./llmFallback";

const KALLA = "booli_sida";

/** One overall deadline for the whole fetch (redirect and body included). */
export const ANNONS_FETCH_TIDSGRANS_MS = 10_000;
/** The body is read as a stream and abandoned beyond this. A listing page is
 *  ~140 kB (fixtures/booli). */
export const ANNONS_MAX_KROPP_BYTES = 3 * 1024 * 1024;

/**
 * The header set of a normal Chrome 130 on macOS, WITHOUT `Accept-Encoding`:
 * the Workers runtime manages compression itself. Booli sits behind Cloudflare
 * bot management, which judges the whole fingerprint; see docs/booli.md
 * ("Blocking") for what was measured (curl and Node fetch are challenged, a
 * local workerd with exactly this set got the real page; the production Worker
 * is challenged). Sent once per request, never varied to dodge a block.
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
    logga("llm-fallback", { url, kalla: KALLA, utfall: "undantag", orsak: felText(fel) });
    return null;
  }
  logga("llm-fallback", {
    url,
    kalla: KALLA,
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

// ---------------------------------------------------------------------------
// The source
// ---------------------------------------------------------------------------

export const booliSidaLeverantor: AnnonsLeverantor = {
  namn: "booli_sida",
  metod: "sida",
  async hamta(lank, b): Promise<LeverantorUtfall> {
    const url = lank.url;

    // One fetch.
    const sida = await hamtaSida(url, b.fetch ?? fetch, b.tidsgransMs ?? ANNONS_FETCH_TIDSGRANS_MS);
    if (sida.typ === "fel") {
      logga(
        sida.kod === "blockerad"
          ? "blockerad"
          : sida.kod === "hittades_inte"
            ? "hittades inte"
            : "nätverk",
        { url, kalla: KALLA, orsak: sida.orsak },
      );
      return { typ: "fel", kod: sida.kod, orsak: sida.orsak };
    }

    // Parse (+ model fallback, + postcode fallback).
    let uppgifter: AnnonsUppgifter;
    let tolkning: "struktur" | "llm" = "struktur";
    try {
      const t = tolkaBooli(sida.html, sida.slutUrl);
      if (t.typ === "blockerad") {
        const orsak = "utmaningssida (challenge) i svaret";
        logga("blockerad", { url, kalla: KALLA, orsak });
        return { typ: "fel", kod: "blockerad", orsak };
      }
      if (t.typ === "ok") {
        uppgifter = t.uppgifter;
      } else {
        logga("tolkning misslyckades", { url, kalla: KALLA, orsak: t.orsak });
        const fran = await tolkaMedModell(b, sida.html, url, t.delvis);
        if (fran) {
          uppgifter = fran.uppgifter;
          tolkning = fran.tolkning;
        } else if (harFormfalt(t.delvis)) {
          logga("delvis resultat", {
            url,
            kalla: KALLA,
            orsak: t.orsak,
            fält: ANNONS_FALT.filter((f) => t.delvis[f] !== undefined),
          });
          uppgifter = t.delvis;
        } else {
          return { typ: "fel", kod: "tolkning", orsak: t.orsak };
        }
      }
    } catch (fel) {
      const orsak = `undantag: ${felText(fel)}`;
      logga("tolkning misslyckades", { url, kalla: KALLA, orsak });
      return { typ: "fel", kod: "tolkning", orsak };
    }

    const saknasKarn = ANNONS_KARNFALT.filter((f) => uppgifter[f] === undefined);
    if (saknasKarn.length > 0) {
      logga("kärnfält saknas, sidans layout kan ha ändrats", {
        url,
        kalla: KALLA,
        saknas: saknasKarn,
        tolkning,
      });
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
        logga("geokodning gav inget postnummer", { url, kalla: KALLA, orsak: geo.orsak });
      }
    }

    return { typ: "ok", uppgifter, tolkning, ...(postnummerKalla ? { postnummerKalla } : {}) };
  },
};
