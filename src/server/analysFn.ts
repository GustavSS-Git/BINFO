/**
 * TanStack Start-bindningen för de tre analysfunktionerna i `./analys.ts`.
 *
 * Den här filen finns SEPARAT från `analys.ts` med flit: `analys.ts`s tre
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
 */

import { createServerFn } from "@tanstack/react-start";
import {
  skapaAnalys as skapaAnalysImpl,
  hamtaStatus as hamtaStatusImpl,
  hamtaResultat as hamtaResultatImpl,
  type SkapaAnalysArgs,
} from "./analys";
import { envFromProcess } from "./env";
import { skapaLager } from "./supabase";

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
    const { pdf, propertyInputRaw } = extraheraSkapaAnalysArgs(data);

    const pdfBytes = new Uint8Array(await pdf.arrayBuffer());
    const propertyInput = tolkaJson("propertyInput", propertyInputRaw);

    const args: SkapaAnalysArgs = { pdfBytes, propertyInput };
    const env = envFromProcess();
    return skapaAnalysImpl(skapaLager(env), env, args);
  });

export const hamtaStatusFn = createServerFn({ method: "GET" })
  .inputValidator((data: { analysisId: string }) => data)
  .handler(async ({ data }) => {
    return hamtaStatusImpl(skapaLager(envFromProcess()), data.analysisId);
  });

export const hamtaResultatFn = createServerFn({ method: "GET" })
  .inputValidator((data: { analysisId: string }) => data)
  .handler(async ({ data }) => {
    return hamtaResultatImpl(skapaLager(envFromProcess()), data.analysisId);
  });
