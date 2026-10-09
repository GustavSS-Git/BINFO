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
 *
 * VEM SOM FRÅGAR (WS4, `Anropare` i portar.ts): `analysFn.ts` löser upp
 * en `Anropare` (kontext + kontolager + behörighet) för varje anrop och
 * skickar den hit. `skapaAnalys` kontrollerar då behörighet, kvot och
 * principal; `hamtaResultat` kontrollerar behörigheten `full_rapport`.
 * Utan `anropare` (operatörens CLI, `npm run analys`, och registertesterna)
 * görs inga kontokontroller — en köpare når aldrig den vägen, eftersom
 * analysFn.ts alltid skickar med en.
 *
 * REGISTRET (v2, se register.ts): en ny analys-rad pekar på en delad
 * `rapport` (`rapport_id`) och allt — status, steg, extraktion, bedömning —
 * härleds därifrån. Rader utan `rapport_id` (skapade före registret) läses
 * exakt som förut, från extraktion_cache/analys_cache.
 */

import type {
  AnalysisResult,
  ExtractionResult,
  Forhandsvisning,
  PropertyInput,
} from "@/types/analysis";
import { PropertyInputSchema } from "@/lib/analysis/schema";
import { PROMPT_VERSION } from "@/lib/analysis/prompts";
import { extractPdfText } from "@/lib/analysis/pdf";
import { ScannedPdfError } from "@/lib/analysis/runExtraction";
import { assembleraAnalys } from "@/lib/analysis/assemble";
import { ModellPrisdatakalla } from "@/lib/analysis/prisdata";
import type { AnalysJudgement } from "@/lib/analysis/analyze";
import {
  identifieraLokalt as identifieraLokaltStandard,
  namnLiknar as namnLiknarStandard,
} from "@/lib/analysis/identitet";
import type { Env } from "./env";
import type {
  AnalysErrorCode,
  Anropare,
  AnalysRad,
  AnalysStage,
  AnalysStatus,
  Lager,
  RapportRad,
  RapportStage,
  Textlager,
} from "./portar";
import { lasPropertyInputFranRad } from "./lagratInput";
import { hamtaAnalysFranCache, hamtaExtraktionFranCache } from "./cache";
import {
  omkorningOmojligResultat,
  tolkaFel,
  tolkaKvot,
  tolkaRapportFel,
  tolkaSpendSkal,
} from "./fel";
import { SaknarBehorighetError, type Formaga } from "./behorighet";
import { DAG_SEK, kontrolleraUppladdningskvot, kvotNyckel } from "./kvot";
import { medPrincipal } from "./principal";
import { kontrolleraDagligtTak } from "./spend";
import {
  ALDRE_VERSION_SKAL,
  arPagaende,
  foljErsattAv,
  hittaNyareAr,
  hittaOmkorning,
  klassificeraTextlager,
  koaOmkorning,
  kopplaUppladdning,
  nyareArSkal,
  registreraAnvandarAdress,
  SKANNADE_RAPPORTER_AKTIVA,
  tillAnalysStage,
  valjLasbarRapport,
  type IdentitetsBeroenden,
  type LasbarRapport,
} from "./register";

// ---------------------------------------------------------------------------
// skapaAnalys
// ---------------------------------------------------------------------------

export type SkapaAnalysResultat =
  | {
      ok: true;
      analysisId: string;
      /** Linked to an already finished report in the register — the result
       *  is available immediately, at no cost. */
      ateranvand?: boolean;
      /** Linked to a report someone else's upload is already analysing —
       *  "Rapporten analyseras redan — din analys blir klar samtidigt." */
      vantarPaRapport?: boolean;
    }
  | { ok: false; errorCode: AnalysErrorCode; errorMessage: string };

export interface SkapaAnalysArgs {
  pdfBytes: Uint8Array;
  propertyInput: unknown;
}

/** Identity functions: injected for tests; production uses
 *  src/lib/analysis/identitet.ts. `anropare`: the requester — always set by
 *  analysFn.ts; omitted only by the operator CLI and tests that exercise the
 *  register alone (no entitlement, quota or principal then). */
export type SkapaAnalysBeroenden = Partial<IdentitetsBeroenden> & { anropare?: Anropare };

/** `kravBehorighet` as a result instead of a throw: a refusal becomes the
 *  buyer-safe `behorighet` code (fel.ts); anything else (a policy rule that
 *  throws) propagates — fail closed. */
async function provaBehorighet(
  anropare: Anropare,
  formaga: Formaga,
): Promise<{ ok: true } | { ok: false; errorCode: AnalysErrorCode; errorMessage: string }> {
  try {
    await anropare.behorighet.kravBehorighet(anropare.kontext, formaga);
    return { ok: true };
  } catch (fel) {
    if (!(fel instanceof SaknarBehorighetError)) throw fel;
    const { errorCode, message } = tolkaFel(fel);
    return { ok: false, errorCode, errorMessage: message };
  }
}

/**
 * Gives back the upload quota `kontrolleraUppladdningskvot` took (the device
 * key, and the IP key when there is an IP). Used when the upload turned out
 * to cost nothing: served instantly from the register. Best effort — the
 * buyer's analysis already exists, so a failed refund is logged, never
 * thrown.
 */
async function aterlamnaUppladdningskvot(anropare: Anropare): Promise<void> {
  const { kontext, konto } = anropare;
  try {
    await konto.aterlamnaKvot(kvotNyckel("uppladdning", "enhet", kontext.enhetId), DAG_SEK);
    if (kontext.ipHash !== null) {
      await konto.aterlamnaKvot(kvotNyckel("uppladdning", "ip", kontext.ipHash), DAG_SEK);
    }
  } catch (fel) {
    console.warn(
      "[kvot] Kunde inte återlämna uppladdningskvot: " +
        (fel instanceof Error ? fel.message : String(fel)),
    );
  }
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
 * Skapar ett analysjobb. Ordningen på kontrollerna nedan är medveten:
 * behörighet (`ladda_upp_analys`) → validering → hash (på ORIGINALA byten,
 * innan något annat rör dem) → magic bytes → storlek → kill switch →
 * textlagerkontroll → dagens spend-tak (läsning, ingen reservation) →
 * uppladdningskvoten → principal → uppladdning → registret
 * (`kopplaUppladdning`, register.ts: hash-träff, lokal identitet, eller en ny
 * rapport) → analys-raden (med `principal_id`) → föreningens område (bästa
 * försök) → kvoten tillbaka om analysen serverades direkt ur registret.
 *
 * Varje nekande före uppladdningen lämnar noll sidoeffekter: ingen fil,
 * ingen rad, ingen principal — och ingen förbrukad kvot, eftersom kvoten tas
 * sist av kontrollerna (efter spend-taket, som bara läser).
 */
export async function skapaAnalys(
  lager: Lager,
  env: Env,
  args: SkapaAnalysArgs,
  beroenden: SkapaAnalysBeroenden = {},
): Promise<SkapaAnalysResultat> {
  const { anropare } = beroenden;
  if (anropare) {
    const behorighet = await provaBehorighet(anropare, "ladda_upp_analys");
    if (!behorighet.ok) return behorighet;
  }

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

  // Textlagerkontroll INNAN något laddas upp eller sätts in — en skannad PDF
  // ska lämna noll sidoeffekter så länge skannade rapporter inte stöds.
  // .slice() kopierar: extractPdfText detacherar sin input (pdf.js/unpdf),
  // och args.pdfBytes behövs oförändrad för uppladdningen nedan.
  const { pages, totalPages } = await extractPdfText(args.pdfBytes.slice());
  const textlager = klassificeraTextlager(pages);
  if (textlager === "saknas" && !SKANNADE_RAPPORTER_AKTIVA) {
    const { errorCode, message } = tolkaFel(new ScannedPdfError());
    return { ok: false, errorCode, errorMessage: message };
  }

  // Dagens spend-tak, i förväg: annars köar analysen tyst till i morgon (se
  // `kontrolleraDagligtTak`). Före kvoten, så ett nekande inte kostar köparen
  // något.
  const tak = await kontrolleraDagligtTak(lager.db, env);
  if (!tak.ok) {
    const { errorCode, message } = tolkaSpendSkal(tak.skal ?? "daily_cap");
    return { ok: false, errorCode, errorMessage: message };
  }

  let principalId: string | null = null;
  if (anropare) {
    const kvot = await kontrolleraUppladdningskvot(anropare.konto, anropare.kontext);
    if (!kvot.ok) {
      const { errorCode, message } = tolkaKvot(kvot);
      return { ok: false, errorCode, errorMessage: message };
    }
    // Principalen skapas först här — vid den första dyra handlingen, aldrig
    // vid ett sidbesök (se principal.ts).
    principalId = (await medPrincipal(anropare.konto, anropare.kontext)).principalId;
  }

  // Alltid ladda upp, även vid en träff i registret — innehållsadresserad
  // lagring tolererar en dubblett, och en PDF som en äldre retention-regel
  // raderat återställs på köpet (registret behåller PDF:er).
  const pdfPath = `${pdfHash}.pdf`;
  await lager.filer.laggUpp(pdfPath, args.pdfBytes);

  const koppling = await kopplaUppladdning(
    lager,
    {
      pdfHash,
      pdfPath,
      sidor: pages,
      antalSidor: totalPages,
      bytes: args.pdfBytes.byteLength,
      textlager,
      model: env.anthropicModel,
    },
    {
      identifieraLokalt: beroenden.identifieraLokalt ?? identifieraLokaltStandard,
      namnLiknar: beroenden.namnLiknar ?? namnLiknarStandard,
    },
  );

  // Radens egna status/stage används inte för en registerlänkad rad (allt
  // härleds från rapporten, se hamtaStatus) — de sätts bara till sina
  // startvärden för att uppfylla kolumnernas not null.
  const { id } = await lager.db.skapaAnalys({
    pdfHash,
    pdfPath,
    propertyInput,
    model: env.anthropicModel,
    promptVersion: PROMPT_VERSION,
    status: "queued",
    stage: "uploaded",
    rapportId: koppling.rapportId,
    principalId,
  });

  if (koppling.orgnr !== null && propertyInput.postnummer !== "") {
    try {
      await registreraAnvandarAdress(lager.db, koppling.orgnr, propertyInput.postnummer);
    } catch (fel) {
      // Bästa försök: en köpares analys får aldrig falla på områdesregistret.
      console.warn(
        `[register] Kunde inte registrera område för analys ${id}: ` +
          (fel instanceof Error ? fel.message : String(fel)),
      );
    }
  }

  // Serverad direkt ur registret: noll kostnad, så ingen kvot heller.
  if (koppling.ateranvand && anropare) await aterlamnaUppladdningskvot(anropare);

  return {
    ok: true,
    analysisId: id,
    ...(koppling.ateranvand ? { ateranvand: true } : {}),
    ...(koppling.vantarPaRapport ? { vantarPaRapport: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// hamtaStatus
// ---------------------------------------------------------------------------

export interface AnalysStatusSvar {
  status: AnalysStatus;
  /** For a register-linked analysis: the rapport's stage mapped onto this
   *  legacy union (see `tillAnalysStage` in register.ts); the real one is
   *  `rapportSteg`. */
  stage: AnalysStage;
  errorCode?: AnalysErrorCode;
  errorMessage?: string;
  /** Register-linked analyses only (all four fields). */
  textlager?: Textlager;
  /** The report was already analysed when this analysis was created. */
  ateranvand?: boolean;
  /** Waiting on a report another upload started. */
  vantarPaRapport?: boolean;
  rapportSteg?: RapportStage;
}

/**
 * Status för en registerlänkad analys, härledd från rapporten:
 *   - något läsbart finns (valjLasbarRapport) → done/complete (en äldre
 *     version köar en lat omkörning, samma som läsvägen);
 *   - rapporten pågår → dess status och mappade steg;
 *   - rapporten är klar men oläsbar med den körande koden → omkörningens
 *     förlopp (köas här om ingen finns), eller ett synligt fel om PDF:en
 *     saknas;
 *   - misslyckad → dess (köparsäkra) fel.
 */
async function hamtaRapportStatus(lager: Lager, rad: AnalysRad): Promise<AnalysStatusSvar> {
  const lankad = await hamtaLankadRapport(lager, rad);
  const lasbar = await valjLasbarRapport(lager.db, lankad);

  if (lasbar) {
    if (lasbar.aldreVersion) await koaOmkorningSakert(lager, lasbar.rapport);
    const ateranvand =
      lasbar.rapport.finishedAt !== null &&
      Date.parse(lasbar.rapport.finishedAt) <= Date.parse(rad.createdAt);
    return {
      status: "done",
      stage: "complete",
      textlager: lasbar.rapport.textlager,
      ateranvand,
      vantarPaRapport: false,
      rapportSteg: lasbar.rapport.stage,
    };
  }

  let aktuell: RapportRad = lankad;
  if (!arPagaende(lankad) && lankad.status !== "done") {
    // Misslyckad (t.ex. ogiltigförklarad) — men pågår en nyare körning av
    // samma rapport (någon laddade upp den igen), visa dess förlopp: den
    // serveras av läsvägen så fort den är klar.
    const nyare = await foljErsattAv(lager.db, await hittaOmkorning(lager.db, lankad));
    if (nyare && arPagaende(nyare)) aktuell = nyare;
  }
  if (lankad.status === "done") {
    // Klar men oläsbar (inkompatibel) — följ omkörningen i stället.
    const utfall = await koaOmkorningSakert(lager, lankad);
    if (utfall === "pdf_saknas") {
      const { errorCode, message } = omkorningOmojligResultat();
      return {
        status: "failed",
        stage: tillAnalysStage(lankad.stage),
        errorCode,
        errorMessage: message,
        textlager: lankad.textlager,
        ateranvand: false,
        vantarPaRapport: false,
        rapportSteg: lankad.stage,
      };
    }
    aktuell = (await foljErsattAv(lager.db, await hittaOmkorning(lager.db, lankad))) ?? lankad;
  }

  const bas = {
    stage: tillAnalysStage(aktuell.stage),
    textlager: aktuell.textlager,
    ateranvand: false,
    rapportSteg: aktuell.stage,
  };

  if (arPagaende(aktuell)) {
    const [forsta] = await lager.db.hamtaAnalyserForRapport(aktuell.id, 1);
    return {
      ...bas,
      status: aktuell.status === "running" ? "running" : "queued",
      vantarPaRapport: forsta !== undefined && forsta.id !== rad.id,
    };
  }

  // failed, or an 'ersatt' row whose target is missing (should not happen).
  const { errorCode, message } = tolkaRapportFel(aktuell.errorCode, aktuell.errorMessage);
  return { ...bas, status: "failed", vantarPaRapport: false, errorCode, errorMessage: message };
}

export async function hamtaStatus(
  lager: Lager,
  analysisId: string,
): Promise<AnalysStatusSvar | null> {
  const rad = await lager.db.hamtaAnalys(analysisId);
  if (!rad) return null;
  if (rad.rapportId !== null) return hamtaRapportStatus(lager, rad);

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

/** The rapport a register-linked analys reads from, after following
 *  `ersatt_av`. A missing one is an inconsistency, not a user state. */
async function hamtaLankadRapport(lager: Lager, rad: AnalysRad): Promise<RapportRad> {
  const rapportId = rad.rapportId;
  if (rapportId === null) throw new Error(`Analys ${rad.id} är inte länkad till registret.`);
  const lankad = await foljErsattAv(lager.db, await lager.db.hamtaRapport(rapportId));
  if (!lankad) {
    throw new Error(`Internt inkonsistent tillstånd: analys ${rad.id} pekar på en saknad rapport.`);
  }
  return lankad;
}

/**
 * Lazy re-run, never allowed to break a read: a failure is logged and the
 * read goes on. Re-runs use the source rapport's own model — the read paths
 * have no Env (analysFn.ts's signatures are fixed), and the model is not part
 * of the version key anyway.
 */
async function koaOmkorningSakert(
  lager: Lager,
  kalla: RapportRad,
): Promise<"koad" | "finns" | "pdf_saknas" | "fel"> {
  try {
    return (await koaOmkorning(lager, kalla, kalla.model)).utfall;
  } catch (fel) {
    console.error(`[register] Kunde inte köa omkörning av rapport ${kalla.id}:`, fel);
    return "fel";
  }
}

interface Underlag {
  extraction: ExtractionResult;
  judgement: AnalysJudgement;
  /** Extra confidence notes for the buyer (register reads only). */
  extraSkal: string[];
}

/** Legacy read: exactly the pre-register cache path. */
async function hamtaLegacyUnderlag(lager: Lager, rad: AnalysRad): Promise<Underlag> {
  if (rad.status !== "done") {
    throw new AnalysInteKlarError(rad.id, rad.stage);
  }

  const nyckel = { pdfHash: rad.pdfHash, model: rad.model, promptVersion: rad.promptVersion };
  const [extraction, judgement] = await Promise.all([
    hamtaExtraktionFranCache(lager.db, nyckel),
    hamtaAnalysFranCache(lager.db, nyckel),
  ]);

  if (extraction === null || judgement === null) {
    throw new Error(
      `Internt inkonsistent tillstånd: analys ${rad.id} är markerad 'done' men saknar ` +
        `${extraction === null ? "extraktion" : "analys"} i cachen (pdf_hash=${rad.pdfHash}, ` +
        `model=${rad.model}, prompt_version=${rad.promptVersion}).`,
    );
  }
  return { extraction, judgement, extraSkal: [] };
}

/**
 * Register read (see register.ts's file comment): the newest done rapport at
 * the current version for the same report; else the linked one if it still
 * parses — with a note and a lazy re-run; a stored result that does not parse
 * is never served: a re-run is queued and the buyer waits
 * (AnalysInteKlarError, which sends the UI back to the polling preview).
 */
async function hamtaRegisterUnderlag(lager: Lager, rad: AnalysRad): Promise<Underlag> {
  const lankad = await hamtaLankadRapport(lager, rad);
  const lasbar: LasbarRapport | null = await valjLasbarRapport(lager.db, lankad);
  if (!lasbar) {
    if (lankad.status === "done") await koaOmkorningSakert(lager, lankad);
    throw new AnalysInteKlarError(rad.id, tillAnalysStage(lankad.stage));
  }

  const extraSkal: string[] = [];
  if (lasbar.aldreVersion) {
    extraSkal.push(ALDRE_VERSION_SKAL);
    await koaOmkorningSakert(lager, lasbar.rapport);
  }
  const nyareAr = await hittaNyareAr(lager.db, lasbar.rapport);
  if (nyareAr !== null) extraSkal.push(nyareArSkal(nyareAr));

  return { ...lasbar.innehall, extraSkal };
}

/** Shared by hamtaResultat and hamtaForhandsvisning: row lookup, the right
 *  read path, assembly, and the register's extra notes. `kontrolleraRad`
 *  runs once the row is resolved and before any read work (the entitlement
 *  check of hamtaResultat). */
async function monteraResultat(
  lager: Lager,
  analysisId: string,
  kontrolleraRad?: (rad: AnalysRad) => Promise<void>,
): Promise<AnalysisResult> {
  const rad = await lager.db.hamtaAnalys(analysisId);
  if (!rad) {
    throw new AnalysHittadesInteError(analysisId);
  }
  if (kontrolleraRad) await kontrolleraRad(rad);
  const underlag =
    rad.rapportId === null
      ? await hamtaLegacyUnderlag(lager, rad)
      : await hamtaRegisterUnderlag(lager, rad);

  const input = lasPropertyInputFranRad(rad);
  const prisdatakalla = new ModellPrisdatakalla();

  const resultat = await assembleraAnalys({
    extraction: underlag.extraction,
    input,
    prisdatakalla,
    analys: underlag.judgement,
    analysisId: rad.id,
    skapad: rad.createdAt,
  });
  return medExtraSkal(resultat, underlag.extraSkal);
}

/** Appends notes to datakvalitet.extraktionKonfidens.skal without mutating
 *  the assembled object. No-op (same object) when there are none, so legacy
 *  reads stay byte-identical. */
function medExtraSkal(resultat: AnalysisResult, extraSkal: readonly string[]): AnalysisResult {
  if (extraSkal.length === 0) return resultat;
  const konfidens = resultat.datakvalitet.extraktionKonfidens;
  return {
    ...resultat,
    datakvalitet: {
      ...resultat.datakvalitet,
      extraktionKonfidens: { ...konfidens, skal: [...(konfidens.skal ?? []), ...extraSkal] },
    },
  };
}

/**
 * Hämtar ett färdigt AnalysisResult. Monterar om det på varje anrop
 * (assembleraAnalys) i stället för att lagra det färdiga JSON:et — se
 * assemble.ts/cache.ts. Idempotent så länge `analysisId`/`skapad` alltid
 * kommer från raden, aldrig genereras på nytt av assembleraAnalys.
 *
 * Med `anropare` (alltid från analysFn.ts) kontrolleras behörigheten
 * `full_rapport` så fort raden är uppslagen — med radens `rapportId`, den
 * nyckel ett framtida köp per analys hänger på. Nekad →
 * `SaknarBehorighetError` kastas (routen skickar då köparen till den
 * kostnadsfria förhandsvisningen). Ingen kvot: läsningar kostar inget.
 */
export async function hamtaResultat(
  lager: Lager,
  analysisId: string,
  anropare?: Anropare,
): Promise<AnalysisResult> {
  if (!anropare) return monteraResultat(lager, analysisId);
  return monteraResultat(lager, analysisId, (rad) =>
    anropare.behorighet.kravBehorighet(
      anropare.kontext,
      "full_rapport",
      rad.rapportId !== null ? { rapportId: rad.rapportId } : {},
    ),
  );
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
  const fullResultat = await monteraResultat(lager, analysisId);

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
