/**
 * De publika serverfunktionerna för analysjobb: skapa, läsa status, hämta
 * ett färdigt resultat, och hämta den smala förhandsvisningen. Ramverksfria
 * — en senare uppgift lindar in dessa i TanStack `createServerFn`; den här
 * filen vet inget om det.
 *
 * `skapaAnalys` gör bara det som krävs INNAN ett jobb kan köa: validering,
 * hash, magic-bytes/storlek, kill switch, skann-kontroll, dedupe-koll mot
 * cacherna, uppladdning och radskapande. Den anropar aldrig modellen själv
 * — det gör "tick"-steget (utanför den här uppgiftens scope) senare.
 *
 * `hamtaResultat` monterar om AnalysisResult på varje läsning, aldrig lagrar
 * det färdiga JSON:et — se assemble.ts/cache.ts filkommentarer för varför
 * (ett ändrat benchmark-tröskelvärde ska omgradera varje tidigare analys
 * gratis).
 *
 * `hamtaForhandsvisning` gör samma radslagning och återmontering som
 * `hamtaResultat`, men smalnar av resultatet till `Forhandsvisning` innan
 * det returneras — se den typens kontraktskommentar i
 * src/types/analysis.ts för varför detta är en egen funktion och inte en
 * flagga på hamtaResultat.
 */

import type { AnalysisResult, Forhandsvisning, PropertyInput } from "@/types/analysis";
import { PropertyInputSchema } from "@/lib/analysis/schema";
import { PROMPT_VERSION } from "@/lib/analysis/prompts";
import { extractPdfText } from "@/lib/analysis/pdf";
import { ScannedPdfError } from "@/lib/analysis/runExtraction";
import { assembleraAnalys } from "@/lib/analysis/assemble";
import { ModellPrisdatakalla } from "@/lib/analysis/prisdata";
import type { Env } from "./env";
import type { AnalysErrorCode, AnalysStage, AnalysStatus, Lager } from "./portar";
import { lasPropertyInputFranRad } from "./lagratInput";
import { hamtaAnalysFranCache, hamtaExtraktionFranCache } from "./cache";
import { tolkaFel, tolkaSpendSkal } from "./fel";

// ---------------------------------------------------------------------------
// skapaAnalys
// ---------------------------------------------------------------------------

export type SkapaAnalysResultat =
  | { ok: true; analysisId: string }
  | { ok: false; errorCode: AnalysErrorCode; errorMessage: string };

export interface SkapaAnalysArgs {
  pdfBytes: Uint8Array;
  propertyInput: unknown;
}

const MAX_PDF_STORLEK_BYTES = 25 * 1024 * 1024;
// "%PDF" — de fyra inledande byten en giltig PDF-fil alltid börjar med.
const PDF_MAGIC_BYTES = [0x25, 0x50, 0x44, 0x46];

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function harPdfMagicBytes(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC_BYTES.length) return false;
  return PDF_MAGIC_BYTES.every((b, i) => bytes[i] === b);
}

/**
 * Skapar ett analysjobb. Ordningen på kontrollerna nedan är medveten (se
 * uppgiftens spec): validering → hash (på ORIGINALA byten, innan något
 * annat rör dem) → magic bytes → storlek → kill switch → skann-kontroll
 * (INNAN någon uppladdning eller radskapande) → dedupe-koll → uppladdning
 * → radskapande.
 */
export async function skapaAnalys(
  lager: Lager,
  env: Env,
  args: SkapaAnalysArgs,
): Promise<SkapaAnalysResultat> {
  const parsedInput = PropertyInputSchema.safeParse(args.propertyInput);
  if (!parsedInput.success) {
    return {
      ok: false,
      errorCode: "validation",
      errorMessage:
        "Uppgifterna om bostaden kunde inte tolkas. Kontrollera formuläret och försök igen.",
    };
  }
  // Zods inferrade typ för optionella fält (vaning/byggar) tillåter explicit
  // `undefined`; exactOptionalPropertyTypes gör det inte. Formen är redan
  // verifierad av Zod ovan — detta förenar bara de två typsystemen, samma
  // mönster som cli.ts och cache.ts använder.
  const propertyInput = parsedInput.data as PropertyInput;

  // Hasha ORIGINALA byten innan något annat (t.ex. extractPdfText, som
  // detacherar sin input) rör dem. new Uint8Array(...) kopierar in i en
  // ArrayBuffer-backad array — args.pdfBytes typas Uint8Array<ArrayBufferLike>
  // (kan i teorin bära en SharedArrayBuffer), vilket subtle.digest's
  // BufferSource-typ inte accepterar direkt.
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(args.pdfBytes));
  const pdfHash = toHex(digest);

  if (!harPdfMagicBytes(args.pdfBytes)) {
    return { ok: false, errorCode: "validation", errorMessage: "Filen verkar inte vara en PDF." };
  }

  if (args.pdfBytes.byteLength > MAX_PDF_STORLEK_BYTES) {
    return {
      ok: false,
      errorCode: "validation",
      errorMessage: "Filen är för stor (max 25 MB).",
    };
  }

  if (env.killSwitchPa) {
    const { errorCode, message } = tolkaSpendSkal("kill_switch");
    return { ok: false, errorCode, errorMessage: message };
  }

  // Skann-kontroll INNAN något laddas upp eller sätts in — en skannad PDF
  // ska lämna noll sidoeffekter. .slice() kopierar: extractPdfText detacherar
  // sin input (pdf.js/unpdf), och args.pdfBytes behövs oförändrad för
  // uppladdningen nedan.
  const { pdfSaknarTextlager } = await extractPdfText(args.pdfBytes.slice());
  if (pdfSaknarTextlager) {
    const { errorCode, message } = tolkaFel(new ScannedPdfError());
    return { ok: false, errorCode, errorMessage: message };
  }

  const nyckel = { pdfHash, model: env.anthropicModel, promptVersion: PROMPT_VERSION };
  const [cachedExtraktion, cachedAnalys] = await Promise.all([
    hamtaExtraktionFranCache(lager.db, nyckel),
    hamtaAnalysFranCache(lager.db, nyckel),
  ]);

  // Alltid försöka ladda upp, oavsett dedupe-utfall — innehållsadresserad
  // lagring tolererar en dubblett, och pdf_path ska alltid vara satt för
  // retention-bokföringen.
  await lager.filer.laggUpp(`${pdfHash}.pdf`, args.pdfBytes);

  let status: AnalysStatus;
  let stage: AnalysStage;
  if (cachedExtraktion !== null && cachedAnalys !== null) {
    status = "done";
    stage = "complete";
  } else if (cachedExtraktion !== null) {
    status = "queued";
    stage = "judging";
  } else {
    status = "queued";
    stage = "uploaded";
  }

  const { id } = await lager.db.skapaAnalys({
    pdfHash,
    pdfPath: `${pdfHash}.pdf`,
    propertyInput,
    model: env.anthropicModel,
    promptVersion: PROMPT_VERSION,
    status,
    stage,
  });

  return { ok: true, analysisId: id };
}

// ---------------------------------------------------------------------------
// hamtaStatus
// ---------------------------------------------------------------------------

export interface AnalysStatusSvar {
  status: AnalysStatus;
  stage: AnalysStage;
  errorCode?: AnalysErrorCode;
  errorMessage?: string;
}

export async function hamtaStatus(
  lager: Lager,
  analysisId: string,
): Promise<AnalysStatusSvar | null> {
  const rad = await lager.db.hamtaAnalys(analysisId);
  if (!rad) return null;

  return {
    status: rad.status,
    stage: rad.stage,
    ...(rad.errorCode ? { errorCode: rad.errorCode } : {}),
    ...(rad.errorMessage ? { errorMessage: rad.errorMessage } : {}),
  };
}

// ---------------------------------------------------------------------------
// hamtaResultat
// ---------------------------------------------------------------------------

export class AnalysHittadesInteError extends Error {
  constructor(analysisId: string) {
    super(`Ingen analys hittades med id ${analysisId}.`);
    this.name = "AnalysHittadesInteError";
  }
}

export class AnalysInteKlarError extends Error {
  constructor(analysisId: string, stage: AnalysStage) {
    super(
      `Analysen ${analysisId} är inte klar än (steg: ${stage}). Försök igen om en liten stund.`,
    );
    this.name = "AnalysInteKlarError";
  }
}

/**
 * Hämtar ett färdigt AnalysisResult. Monterar om det på varje anrop
 * (assembleraAnalys) i stället för att lagra det färdiga JSON:et — se
 * assemble.ts/cache.ts. Idempotent så länge `analysisId`/`skapad` alltid
 * kommer från raden, aldrig genereras på nytt av assembleraAnalys.
 */
export async function hamtaResultat(lager: Lager, analysisId: string): Promise<AnalysisResult> {
  const rad = await lager.db.hamtaAnalys(analysisId);
  if (!rad) {
    throw new AnalysHittadesInteError(analysisId);
  }
  if (rad.status !== "done") {
    throw new AnalysInteKlarError(analysisId, rad.stage);
  }

  const nyckel = { pdfHash: rad.pdfHash, model: rad.model, promptVersion: rad.promptVersion };
  const [extraction, judgement] = await Promise.all([
    hamtaExtraktionFranCache(lager.db, nyckel),
    hamtaAnalysFranCache(lager.db, nyckel),
  ]);

  if (extraction === null || judgement === null) {
    throw new Error(
      `Internt inkonsistent tillstånd: analys ${analysisId} är markerad 'done' men saknar ` +
        `${extraction === null ? "extraktion" : "analys"} i cachen (pdf_hash=${rad.pdfHash}, ` +
        `model=${rad.model}, prompt_version=${rad.promptVersion}).`,
    );
  }

  const input = lasPropertyInputFranRad(rad);
  const prisdatakalla = new ModellPrisdatakalla();

  return assembleraAnalys({
    extraction,
    input,
    prisdatakalla,
    analys: judgement,
    analysisId: rad.id,
    skapad: rad.createdAt,
  });
}

// ---------------------------------------------------------------------------
// hamtaForhandsvisning
// ---------------------------------------------------------------------------

/** Antal röda flaggor /forhandsvisning visar gratis. Speglar
 *  ANTAL_GRATIS_FLAGGOR i src/routes/forhandsvisning.tsx (UI-zonen, rörs
 *  inte av den här uppgiften) — samma tal, definierat här separat eftersom
 *  routen inte får importera från src/server/ förutom via analysFn. */
const ANTAL_GRATIS_RODA_FLAGGOR = 2;

/**
 * Väljer de N mest allvarliga röda flaggorna, stabilt (samma severity
 * behåller sin ursprungliga, backend-tilldelade ordning). Samma logik som
 * `toppRodaFlaggor` i src/lib/analysisView.ts — kopierad hit i stället för
 * importerad, eftersom analysisView.ts räknas som UI-zonens presentationslager
 * (eslint.config.js listar den bland src/routes|components|data för
 * import-restriktionen mot @/server) och dessutom importerar
 * @/data/mockData, som aldrig ska nå server-bundlen.
 */
function toppRodaFlaggorForServer(
  flaggor: AnalysisResult["rodaFlaggor"],
  antal: number,
): AnalysisResult["rodaFlaggor"] {
  const severityRank: Record<AnalysisResult["rodaFlaggor"][number]["severity"], number> = {
    hog: 0,
    medel: 1,
    lag: 2,
  };
  return flaggor
    .map((flagga, index) => ({ flagga, index }))
    .sort((a, b) => {
      const diff = severityRank[a.flagga.severity] - severityRank[b.flagga.severity];
      return diff !== 0 ? diff : a.index - b.index;
    })
    .slice(0, antal)
    .map((entry) => entry.flagga);
}

/**
 * Hämtar den smala, förhandsvisnings-endast projektionen av ett färdigt
 * AnalysisResult — bara de sektioner `gratisSektioner` redan namnger som
 * gratis, plus minimal identitet. Se Forhandsvisning-kontraktets
 * dokumentationskommentar i src/types/analysis.ts för VARFÖR den här
 * funktionen finns separat från hamtaResultat: betalväggen ska vara
 * serverstyrd redan innan betalning finns, så förhandsvisningen läser
 * aldrig ur samma fullständiga objekt som den betalda rapporten.
 *
 * Samma radslagning, samma fel och samma återmontering (assembleraAnalys)
 * som hamtaResultat — bara den avslutande smalningen till Forhandsvisning
 * skiljer sig. Smalningen är explicit fält-för-fält, aldrig en spridning
 * med borttagna nycklar och aldrig en typecast — en cast skulle låta ett
 * framtida kontraktsfält läcka ut tyst.
 */
export async function hamtaForhandsvisning(
  lager: Lager,
  analysisId: string,
): Promise<Forhandsvisning> {
  const rad = await lager.db.hamtaAnalys(analysisId);
  if (!rad) {
    throw new AnalysHittadesInteError(analysisId);
  }
  if (rad.status !== "done") {
    throw new AnalysInteKlarError(analysisId, rad.stage);
  }

  const nyckel = { pdfHash: rad.pdfHash, model: rad.model, promptVersion: rad.promptVersion };
  const [extraction, judgement] = await Promise.all([
    hamtaExtraktionFranCache(lager.db, nyckel),
    hamtaAnalysFranCache(lager.db, nyckel),
  ]);

  if (extraction === null || judgement === null) {
    throw new Error(
      `Internt inkonsistent tillstånd: analys ${analysisId} är markerad 'done' men saknar ` +
        `${extraction === null ? "extraktion" : "analys"} i cachen (pdf_hash=${rad.pdfHash}, ` +
        `model=${rad.model}, prompt_version=${rad.promptVersion}).`,
    );
  }

  const input = lasPropertyInputFranRad(rad);
  const prisdatakalla = new ModellPrisdatakalla();

  const fullResultat = await assembleraAnalys({
    extraction,
    input,
    prisdatakalla,
    analys: judgement,
    analysisId: rad.id,
    skapad: rad.createdAt,
  });

  return {
    schemaVersion: fullResultat.schemaVersion,
    analysisId: fullResultat.analysisId,
    skapad: fullResultat.skapad,
    forening: { namn: fullResultat.forening.namn },
    betyg: fullResultat.betyg,
    betygMotivering: fullResultat.betygMotivering,
    rodaFlaggor: toppRodaFlaggorForServer(fullResultat.rodaFlaggor, ANTAL_GRATIS_RODA_FLAGGOR),
    datakvalitet: fullResultat.datakvalitet,
    gratisSektioner: fullResultat.gratisSektioner,
  };
}
