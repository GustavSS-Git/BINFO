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
 * kvotkontrollerna (testade där, mot fakes och en neka-policy). Status och
 * förhandsvisning löser bara upp kontexten (cookien sätts vid första
 * besöket) — ingen kvot, ingen behörighet: de är gratis med flit.
 */

import { createServerFn } from "@tanstack/react-start";
import {
  skapaAnalys as skapaAnalysImpl,
  hamtaStatus as hamtaStatusImpl,
  hamtaResultat as hamtaResultatImpl,
  hamtaForhandsvisning as hamtaForhandsvisningImpl,
  type SkapaAnalysArgs,
} from "./analys";
import { skapaBehorighet } from "./behorighet";
import { envFromProcess, type Env } from "./env";
import { losKontext, tanstackKontextKallor, type Kontext } from "./kontext";
import type { Anropare } from "./portar";
import { hamtaPrisuppskattning } from "./prisuppskattning";
import { skapaLager } from "./supabase";
import { skapaKontoDatabas } from "./supabaseKonto";

/** Production policy (STANDARD_POLICY): today everything is granted. */
/** Who is asking — the first call in every handler. The single insertion
 *  point for Supabase Auth is inside `losKontext`, not here. */
function kontextFor(env: Env): Promise<Kontext> {
  return losKontext({ kallor: tanstackKontextKallor(), hemlighet: env.supabaseSecretKey });
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
    const env = envFromProcess();
    const anropare = await anropareFor(env);

    const { pdf, propertyInputRaw } = extraheraSkapaAnalysArgs(data);
    const pdfBytes = new Uint8Array(await pdf.arrayBuffer());
    const propertyInput = tolkaJson("propertyInput", propertyInputRaw);

    const args: SkapaAnalysArgs = { pdfBytes, propertyInput };
    return skapaAnalysImpl(skapaLager(env), env, args, { anropare });
  });

export const hamtaStatusFn = createServerFn({ method: "GET" })
  .inputValidator((data: { analysisId: string }) => data)
  .handler(async ({ data }) => {
    const env = envFromProcess();
    await kontextFor(env);
    return hamtaStatusImpl(skapaLager(env), data.analysisId);
  });

export const hamtaResultatFn = createServerFn({ method: "GET" })
  .inputValidator((data: { analysisId: string }) => data)
  .handler(async ({ data }) => {
    const env = envFromProcess();
    const anropare = await anropareFor(env);
    return hamtaResultatImpl(skapaLager(env), data.analysisId, anropare);
  });

export const hamtaForhandsvisningFn = createServerFn({ method: "GET" })
  .inputValidator((data: { analysisId: string }) => data)
  .handler(async ({ data }) => {
    const env = envFromProcess();
    await kontextFor(env);
    return hamtaForhandsvisningImpl(skapaLager(env), data.analysisId);
  });

/**
 * Den fristående priskollen (/vardering): Binfos värdering ur formulärets
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
    const anropare = await anropareFor(envFromProcess());
    return hamtaPrisuppskattning(data, { anropare });
  });
