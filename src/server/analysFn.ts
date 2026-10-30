/**
 * TanStack Start-bindningen för de fyra analysfunktionerna i `./analys.ts`
 * samt den fristående priskollen i `./prisuppskattning.ts`.
 *
 * Den här filen finns SEPARAT från `analys.ts` med flit: `analys.ts`s
 * vanliga funktioner anropas direkt av `src/server/cli/analysCli.ts` (ett
 * `tsx`-skript), där serverfunktions-runtimen i TanStack Start inte finns —
 * den kräver Vite-transformen/manifestet som bara existerar i en riktig
 * Start-app. Genom att hålla `createServerFn`-inslagningen i den här ~40-
 * radersfilen har den CLI-anropsbara logiken i `analys.ts` noll
 * ramverksberoende.
 *
 * CSRF-skydd för dessa serverfunktioner installeras redan globalt av
 * `src/start.ts` (`createCsrfMiddleware` med `handlerType === "serverFn"`) —
 * inget behövs här för det.
 *
 * VEM SOM FRÅGAR (WS4): varje handler löser FÖRST upp anropets kontext med
 * `losKontext` (./kontext.ts: enhets-cookien `binfo_enhet`, IP-hash).
 * `losKontext` är den ENDA platsen där Supabase Auth senare kopplas in —
 * session → principal. Handlers och implementationer ändras inte då; de ser
 * bara en `Kontext`. De handlers som gör något dyrt eller betalbart
 * (`skapaAnalysFn`, `hamtaResultatFn`, `hamtaPrisuppskattningFn`) får en hel
 * `Anropare` (kontext + kontolager + standardbehörigheten) och skickar den
 * till de ramverksfria implementationerna, som gör behörighets- och
 * kvotkontrollerna (testade där, mot fakes och en neka-policy). Status löser
 * bara upp kontexten (cookien sätts vid första besöket) — ingen kvot, ingen
 * behörighet: den är gratis med flit.
 */

import { createServerFn } from "@tanstack/react-start";
import { sammanfattaKalkyl } from "@/lib/kalkyl/berakna";
import { REGELVERSION } from "@/lib/kalkyl/regler";
import type { PrisInput } from "@/types/analysis";
import {
  skapaAnalys as skapaAnalysImpl,
  skapaAnalysFranRegister as skapaAnalysFranRegisterImpl,
  hamtaStatus as hamtaStatusImpl,
  hamtaResultat as hamtaResultatImpl,
  type SkapaAnalysArgs,
} from "./analys";
import { hamtaReferensranta } from "./referensranta";
import {
  begarAterstallning,
  bekraftaEpost,
  hamtaSession,
  kontextMedSession,
  loggaIn,
  loggaUt,
  raderaKonto,
  registreraKonto,
  sattNyttLosenord,
  skapaKontoBeroenden,
} from "./auth";
import { skapaBehorighet } from "./behorighet";
import { sakertFel, sakertSkapaFel } from "./fel";
import { envFromProcess, type Env } from "./env";
import { hashaIp, losIp, tanstackKontextKallor, type Kontext } from "./kontext";
import type { Anropare } from "./portar";
import { hamtaPrisuppskattning } from "./prisuppskattning";
import { hamtaAnnons } from "./annons/hamta";
import { postnummerInfo } from "./postnummer";
import {
  hamtaForening as hamtaRegisterForening,
  hamtaRegisteranalys as hamtaRegisteranalysImpl,
  hamtaSitemapPoster,
  listaForeningar as listaRegisterForeningar,
  listaOmraden as listaRegisterOmraden,
  type RegisterBeroenden,
} from "./registerPublik";
import type { RegisterListaFraga } from "@/lib/registerVy";
import {
  forberedSparaAnalys,
  hamtaMinaUppgifter,
  hamtaKopguide,
  hamtaSparadKalkyl,
  hamtaSparstatus,
  hamtaSparadVardering,
  listaSparat,
  raderaSparadKalkyl,
  raderaSparadVardering,
  sparaAnalys,
  sparaKalkyl,
  sparaKopguide,
  sparaVardering,
  taBortAnalysFranLista,
  type SparaAnalysBeroenden,
  type SparatBeroenden,
} from "./sparat";
import { skapaLager, skapaRegisterLasning } from "./supabase";
import { skapaKontoDatabas } from "./supabaseKonto";

/** Who is asking — the first call in every handler. With
 *  `PROJECT_PUBLISHABLE_KEY` set, a logged-in session resolves to the account
 *  principal (`kontextMedSession` → `losKontext`); without it, behaviour is
 *  the anonymous device principal exactly as before. */
function kontextFor(env: Env): Promise<Kontext> {
  return kontextMedSession(env);
}

/** Session + account store for a saved-item handler. Needs the publishable key. */
async function sparatFor(env: Env): Promise<SparatBeroenden> {
  const b = await skapaKontoBeroenden(env);
  return { kontext: b.kontext, db: b.db };
}

/** Cookie access + session + account store for "Spara analysen" (the marker
 *  cookie needs the same request-bound `kallor`). Needs the publishable key. */
async function sparaAnalysFor(env: Env): Promise<SparaAnalysBeroenden> {
  const b = await skapaKontoBeroenden(env);
  return { kallor: b.kallor, kontext: b.kontext, db: b.db, hemlighet: b.hemlighet };
}

// The policy is built per call, never at module scope: a module-level value
// would keep the server-only `./behorighet` import alive in the client graph
// (this file's handler bodies are stripped from the client, its top level is
// not), which import protection rejects in `npm run dev`.
async function anropareFor(env: Env): Promise<Anropare> {
  return {
    kontext: await kontextFor(env),
    konto: skapaKontoDatabas(env),
    behorighet: skapaBehorighet(),
  };
}

/**
 * Plockar ut och validerar de två fälten `skapaAnalysFn` förväntar sig i
 * FormData: en PDF-fil under `"pdf"`, samt en JSON-sträng under
 * `"propertyInput"`. Kastar ett tydligt fel om något fält saknas eller har
 * fel typ — själva JSON-innehållet (schemaformen) valideras inte här, det
 * gör `skapaAnalysImpl` mot det riktiga Zod-schemat.
 */
function extraheraSkapaAnalysArgs(formData: FormData): {
  pdf: File;
  propertyInputRaw: string;
} {
  const pdf = formData.get("pdf");
  if (!(pdf instanceof File)) {
    throw new Error('FormData saknar fältet "pdf" som en fil.');
  }

  const propertyInputRaw = formData.get("propertyInput");
  if (typeof propertyInputRaw !== "string") {
    throw new Error('FormData saknar fältet "propertyInput" som en JSON-sträng.');
  }

  return { pdf, propertyInputRaw };
}

/** JSON.parse med ett tydligare felmeddelande — schemaformen kontrolleras
 *  inte här (det gör `skapaAnalysImpl`), bara att strängen faktiskt är JSON. */
function tolkaJson(falt: string, rå: string): unknown {
  try {
    return JSON.parse(rå);
  } catch (fel) {
    const orsak = fel instanceof Error ? fel.message : String(fel);
    throw new Error(`Fältet "${falt}" innehöll inte giltig JSON: ${orsak}`);
  }
}

export const skapaAnalysFn = createServerFn({ method: "POST" })
  .inputValidator((data: FormData) => data)
  .handler(async ({ data }) => {
    try {
      const env = envFromProcess();
      const anropare = await anropareFor(env);

      const { pdf, propertyInputRaw } = extraheraSkapaAnalysArgs(data);
      const pdfBytes = new Uint8Array(await pdf.arrayBuffer());
      const propertyInput = tolkaJson("propertyInput", propertyInputRaw);

      const args: SkapaAnalysArgs = { pdfBytes, propertyInput };
      return await skapaAnalysImpl(skapaLager(env), env, args, { anropare });
    } catch (fel) {
      // Inget internt (Supabase, lagring, nätverk) når köparen — se sakertFel.
      return sakertSkapaFel("skapaAnalysFn", fel);
    }
  });

/**
 * En analys av en lägenhet i en förening som redan finns i det publika
 * registret: bara objektets uppgifter, ingen PDF. Kostar inga API-pengar;
 * bara den lösa uppladdningskvoten tas (se `skapaAnalysFranRegister`).
 * Indata valideras i implementationen, inte här.
 */
export const skapaAnalysFranRegisterFn = createServerFn({ method: "POST" })
  .inputValidator((data: { slug: string; propertyInput: unknown }) => data)
  .handler(async ({ data }) => {
    try {
      const env = envFromProcess();
      const anropare = await anropareFor(env);
      return await skapaAnalysFranRegisterImpl(
        skapaLager(env),
        env,
        { slug: data.slug, propertyInput: data.propertyInput },
        { anropare, lasning: skapaRegisterLasning(env) },
      );
    } catch (fel) {
      return sakertSkapaFel("skapaAnalysFranRegisterFn", fel);
    }
  });

export const hamtaStatusFn = createServerFn({ method: "GET" })
  .inputValidator((data: { analysisId: string }) => data)
  .handler(async ({ data }) => {
    try {
      const env = envFromProcess();
      await kontextFor(env);
      return await hamtaStatusImpl(skapaLager(env), data.analysisId);
    } catch (fel) {
      throw sakertFel("hamtaStatusFn", fel);
    }
  });

export const hamtaResultatFn = createServerFn({ method: "GET" })
  .inputValidator((data: { analysisId: string }) => data)
  .handler(async ({ data }) => {
    try {
      const env = envFromProcess();
      const anropare = await anropareFor(env);
      return await hamtaResultatImpl(skapaLager(env), data.analysisId, anropare, {
        referensranta: () => hamtaReferensranta(anropare.konto),
      });
    } catch (fel) {
      throw sakertFel("hamtaResultatFn", fel);
    }
  });

/**
 * Priskollen (steg 1 på /analysera): Binfos värdering ur formulärets
 * uppgifter, utan PDF. Indata valideras i handlern (PrisInputSchema, se
 * `hamtaPrisuppskattning` i ./prisuppskattning.ts) — `inputValidator` släpper
 * bara igenom okänd data så att ett valideringsfel blir ett köparsäkert
 * svar i stället för ett kastat fel. Kostar inga API-pengar, men är
 * kvotbegränsad (60 per IP och timme) och behörighetskontrollerad — båda i
 * `hamtaPrisuppskattning`, före allt annat.
 */
export const hamtaPrisuppskattningFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const anropare = await anropareFor(envFromProcess());
      return await hamtaPrisuppskattning(data, { anropare });
    } catch (fel) {
      throw sakertFel("hamtaPrisuppskattningFn", fel);
    }
  });

/**
 * "Hämta uppgifter" på /analysera: läser en Booli-annons och returnerar
 * normaliserade fält (src/server/annons/hamta.ts). Startar aldrig någon
 * analys. Alla förväntade fel RETURNERAS (`{ ok: false, errorCode,
 * errorMessage }`, köparsäker text); bara oväntade fel kastas.
 */
export const hamtaAnnonsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const env = envFromProcess();
      const anropare = await anropareFor(env);
      return await hamtaAnnons(data, { anropare, env });
    } catch (fel) {
      throw sakertFel("hamtaAnnonsFn", fel);
    }
  });

/**
 * Områdesraden under postnummerfältet på /analysera: vad värderingens tabeller
 * säger om postnumret (src/server/postnummer.ts). Ren uppslagning, ingen I/O,
 * ingen kontext (sätter inga kakor), ingen kvot.
 */
export const hamtaPostnummerInfoFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      return postnummerInfo(data);
    } catch (fel) {
      throw sakertFel("hamtaPostnummerInfoFn", fel);
    }
  });

// ---------------------------------------------------------------------------
// Konton (v3): inloggning, sparade objekt och GDPR. Kontofel RETURNERAS som
// `{ ok: false, felKod, meddelande }` (svensk text ur fel.ts); bara oväntade
// fel kastas, via sakertFel. Typerna för svaren finns i src/lib/kontoTyper.ts.
// ---------------------------------------------------------------------------

export const hamtaSessionFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    return hamtaSession(await kontextFor(envFromProcess()));
  } catch (fel) {
    throw sakertFel("hamtaSessionFn", fel);
  }
});

export const registreraKontoFn = createServerFn({ method: "POST" })
  .inputValidator((data: { epost: string; losenord: string }) => data)
  .handler(async ({ data }) => {
    try {
      return await registreraKonto(await skapaKontoBeroenden(envFromProcess()), data);
    } catch (fel) {
      throw sakertFel("registreraKontoFn", fel);
    }
  });

export const loggaInFn = createServerFn({ method: "POST" })
  .inputValidator((data: { epost: string; losenord: string }) => data)
  .handler(async ({ data }) => {
    try {
      return await loggaIn(await skapaKontoBeroenden(envFromProcess()), data);
    } catch (fel) {
      throw sakertFel("loggaInFn", fel);
    }
  });

export const loggaUtFn = createServerFn({ method: "POST" }).handler(async () => {
  try {
    return await loggaUt(await skapaKontoBeroenden(envFromProcess()));
  } catch (fel) {
    throw sakertFel("loggaUtFn", fel);
  }
});

export const begarAterstallningFn = createServerFn({ method: "POST" })
  .inputValidator((data: { epost: string }) => data)
  .handler(async ({ data }) => {
    try {
      return await begarAterstallning(await skapaKontoBeroenden(envFromProcess()), data);
    } catch (fel) {
      throw sakertFel("begarAterstallningFn", fel);
    }
  });

/** Called from client code after hydration (never a loader): mail scanners
 *  that open the link must not burn the one-time token. */
export const bekraftaEpostFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { tokenHash: string; typ: "signup" | "recovery" | "email_change" }) => data,
  )
  .handler(async ({ data }) => {
    try {
      return await bekraftaEpost(await skapaKontoBeroenden(envFromProcess()), data);
    } catch (fel) {
      throw sakertFel("bekraftaEpostFn", fel);
    }
  });

export const sattNyttLosenordFn = createServerFn({ method: "POST" })
  .inputValidator((data: { losenord: string; nuvarandeLosenord?: string }) => data)
  .handler(async ({ data }) => {
    try {
      return await sattNyttLosenord(await skapaKontoBeroenden(envFromProcess()), data);
    } catch (fel) {
      throw sakertFel("sattNyttLosenordFn", fel);
    }
  });

export const raderaKontoFn = createServerFn({ method: "POST" })
  .inputValidator((data: { losenord: string }) => data)
  .handler(async ({ data }) => {
    try {
      return await raderaKonto(await skapaKontoBeroenden(envFromProcess()), data);
    } catch (fel) {
      throw sakertFel("raderaKontoFn", fel);
    }
  });

export const sparaVarderingFn = createServerFn({ method: "POST" })
  .inputValidator((data: { prisInput: PrisInput; etikett?: string }) => data)
  .handler(async ({ data }) => {
    try {
      return await sparaVardering(await sparatFor(envFromProcess()), data);
    } catch (fel) {
      throw sakertFel("sparaVarderingFn", fel);
    }
  });

export const listaSparatFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    return await listaSparat(await sparatFor(envFromProcess()));
  } catch (fel) {
    throw sakertFel("listaSparatFn", fel);
  }
});

export const hamtaSparadVarderingFn = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    try {
      return await hamtaSparadVardering(await sparatFor(envFromProcess()), data);
    } catch (fel) {
      throw sakertFel("hamtaSparadVarderingFn", fel);
    }
  });

export const raderaSparadVarderingFn = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    try {
      return await raderaSparadVardering(await sparatFor(envFromProcess()), data);
    } catch (fel) {
      throw sakertFel("raderaSparadVarderingFn", fel);
    }
  });

export const hamtaSparadKalkylFn = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    try {
      return await hamtaSparadKalkyl(await sparatFor(envFromProcess()), data);
    } catch (fel) {
      throw sakertFel("hamtaSparadKalkylFn", fel);
    }
  });

export const raderaSparadKalkylFn = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    try {
      return await raderaSparadKalkyl(await sparatFor(envFromProcess()), data);
    } catch (fel) {
      throw sakertFel("raderaSparadKalkylFn", fel);
    }
  });

export const taBortAnalysFranListaFn = createServerFn({ method: "POST" })
  .inputValidator((data: { analysisId: string }) => data)
  .handler(async ({ data }) => {
    try {
      return await taBortAnalysFranLista(await sparatFor(envFromProcess()), data);
    } catch (fel) {
      throw sakertFel("taBortAnalysFranListaFn", fel);
    }
  });

/**
 * "Spara analysen" on /forhandsvisning and /analys (see `hamtaSparstatus`,
 * `forberedSparaAnalys`, `sparaAnalys` in ./sparat.ts). The pages are noindex
 * and not cached, so resolving the kontext (and setting the device cookie)
 * is fine. Without accounts configured, status is simply `ingen`.
 */
export const hamtaSparstatusFn = createServerFn({ method: "GET" })
  .inputValidator((data: { analysisId: string }) => data)
  .handler(async ({ data }) => {
    try {
      const env = envFromProcess();
      if (env.supabasePublishableKey === undefined) {
        await kontextFor(env);
        return { status: "ingen" as const };
      }
      return await hamtaSparstatus(await sparaAnalysFor(env), data);
    } catch (fel) {
      throw sakertFel("hamtaSparstatusFn", fel);
    }
  });

export const forberedSparaAnalysFn = createServerFn({ method: "POST" })
  .inputValidator((data: { analysisId: string }) => data)
  .handler(async ({ data }) => {
    try {
      return await forberedSparaAnalys(await sparaAnalysFor(envFromProcess()), data);
    } catch (fel) {
      throw sakertFel("forberedSparaAnalysFn", fel);
    }
  });

export const sparaAnalysFn = createServerFn({ method: "POST" })
  .inputValidator((data: { analysisId: string }) => data)
  .handler(async ({ data }) => {
    try {
      return await sparaAnalys(await sparaAnalysFor(envFromProcess()), data);
    } catch (fel) {
      throw sakertFel("sparaAnalysFn", fel);
    }
  });

/** GDPR export, returned as a ready-made JSON document (the client offers it
 *  as a download), so free-form stored inputs never cross the typed
 *  server-function boundary as `unknown`. */
export const hamtaMinaUppgifterFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const svar = await hamtaMinaUppgifter(await sparatFor(envFromProcess()));
    if (!svar.ok) return svar;
    return { ok: true as const, json: JSON.stringify(svar.uppgifter, null, 2) };
  } catch (fel) {
    throw sakertFel("hamtaMinaUppgifterFn", fel);
  }
});

/** `underlag` is validated by `KalkylUnderlagSchema` in `sparaKalkyl`;
 *  `unknown` here on purpose, so a malformed draft becomes `ogiltig_indata`
 *  rather than a thrown error. Pass `id` to update an existing kalkyl. The
 *  list-view summary is computed server-side with the calculator library. */
export const sparaKalkylFn = createServerFn({ method: "POST" })
  .inputValidator((data: { underlag: unknown; etikett?: string; id?: string }) => data)
  .handler(async ({ data }) => {
    try {
      return await sparaKalkyl(await sparatFor(envFromProcess()), data, {
        beraknaSammanfattning: sammanfattaKalkyl,
        regelversion: REGELVERSION,
      });
    } catch (fel) {
      throw sakertFel("sparaKalkylFn", fel);
    }
  });

/** Köpguidens avbockade steg för det inloggade kontot (redesign v4). */
export const hamtaKopguideFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    return await hamtaKopguide(await sparatFor(envFromProcess()));
  } catch (fel) {
    throw sakertFel("hamtaKopguideFn", fel);
  }
});

export const sparaKopguideFn = createServerFn({ method: "POST" })
  .inputValidator((data: { klara: string[] }) => data)
  .handler(async ({ data }) => {
    try {
      return await sparaKopguide(await sparatFor(envFromProcess()), data);
    } catch (fel) {
      throw sakertFel("sparaKopguideFn", fel);
    }
  });

// ---------------------------------------------------------------------------
// Det publika BRF-registret (v3, docs/PLAN-v3.md §2): läsfunktioner utan
// konto och utan cookie (en cachebar sida får aldrig sätta enhets-cookien),
// begränsade till 300 läsningar per IP och timme. Svaren är enbart
// BRF-nivå — se ./registerPublik.ts.
// ---------------------------------------------------------------------------

/** Reads for the public register: the read port plus the per-IP limit. Built
 *  per call, never at module scope (see the note above `anropareFor`). */
async function registerFor(env: Env): Promise<RegisterBeroenden> {
  const ip = losIp(tanstackKontextKallor());
  return {
    lasning: skapaRegisterLasning(env),
    kvot: {
      konto: skapaKontoDatabas(env),
      ipHash: ip === null ? null : await hashaIp(ip, env.supabaseSecretKey),
    },
  };
}

export const hamtaRegisterOmradenFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    return await listaRegisterOmraden(await registerFor(envFromProcess()));
  } catch (fel) {
    throw sakertFel("hamtaRegisterOmradenFn", fel);
  }
});

/** One area's table, or (without `omrade`) the cross-area search on /brf. */
export const hamtaRegisterOmradeFn = createServerFn({ method: "GET" })
  .inputValidator((data: RegisterListaFraga) => data)
  .handler(async ({ data }) => {
    try {
      return await listaRegisterForeningar(await registerFor(envFromProcess()), data);
    } catch (fel) {
      throw sakertFel("hamtaRegisterOmradeFn", fel);
    }
  });

export const hamtaRegisterForeningFn = createServerFn({ method: "GET" })
  .inputValidator((data: { slug: string }) => data)
  .handler(async ({ data }) => {
    try {
      return await hamtaRegisterForening(
        await registerFor(envFromProcess()),
        String(data.slug).slice(0, 200),
      );
    } catch (fel) {
      throw sakertFel("hamtaRegisterForeningFn", fel);
    }
  });

/**
 * The stored full BRF-level analysis of one fiscal year (`/brf/$slug/analys/$ar`).
 * Unlike the cacheable register reads above, this one resolves the caller's
 * kontext first (it may set the device cookie — the page is `no-store`), so
 * the `se_registeranalys` entitlement can be checked before any read work
 * (granted to all today; an account/payment gate is one policy line in
 * ./behorighet.ts). The same per-IP register limit applies. `slug` is cut like
 * `hamtaRegisterForeningFn`'s; a non-integer or out-of-range `ar` answers
 * `saknas` (checked in `hamtaRegisteranalys`).
 */
export const hamtaRegisterAnalysFn = createServerFn({ method: "GET" })
  .inputValidator((data: { slug: string; ar: number }) => data)
  .handler(async ({ data }) => {
    try {
      const env = envFromProcess();
      const anropare = await anropareFor(env);
      return await hamtaRegisteranalysImpl(
        await registerFor(env),
        String(data.slug).slice(0, 200),
        Number(data.ar),
        anropare,
      );
    } catch (fel) {
      throw sakertFel("hamtaRegisterAnalysFn", fel);
    }
  });

/** For /sitemap.xml: path + lastmod of every public register page. Not
 *  rate-limited (a crawler fetches it rarely and the route is edge-cached). */
export const hamtaSitemapDataFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    return await hamtaSitemapPoster(skapaRegisterLasning(envFromProcess()));
  } catch (fel) {
    throw sakertFel("hamtaSitemapDataFn", fel);
  }
});
