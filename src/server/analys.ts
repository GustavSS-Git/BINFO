/**
 * De publika serverfunktionerna för analysjobb: skapa, läsa status och hämta
 * ett färdigt resultat. Ramverksfria — analysFn.ts lindar in dessa i TanStack
 * `createServerFn`; den här filen vet inget om det.
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
 *
 * KOSTNADSREGELN (ägaren 2026-10-23, se register.ts filkommentar): API-pengar
 * spenderas bara när en användare aktivt begär en analys. Läsningar
 * (`hamtaStatus`, `hamtaResultat`) köar ALDRIG en omkörning: ett lagrat
 * resultat från en äldre version serveras som det är (med en not), ett
 * oläsbart ger ett synligt fel. En omkörning på aktuell version köas bara av
 * `skapaAnalys` (uppladdning) och `skapaAnalysFranRegister` (begäran från
 * registret), när rapporten bara finns på en äldre version — bakom kill
 * switch, spend-tak och den strikta kvoten.
 */

import type { AnalysisResult, ExtractionResult, PropertyInput } from "@/types/analysis";
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
  RegisterLasning,
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
import {
  aterlamnaLosUppladdningskvot,
  aterlamnaUppladdningskvot,
  kontrolleraLosUppladdningskvot,
  kontrolleraUppladdningskvot,
} from "./kvot";
import { medPrincipal } from "./principal";
import { kontrolleraDagligtTak } from "./spend";
import {
  ALDRE_VERSION_SKAL,
  arPagaende,
  foljErsattAv,
  hittaNyareAr,
  hittaPagaendeKorning,
  klassificeraTextlager,
  koaOmkorning,
  kopplaUppladdning,
  nyareArSkal,
  registreraAnvandarAdress,
  SKANNADE_RAPPORTER_AKTIVA,
  MAX_SIDOR_SKANNAD_RAPPORT,
  FOR_MANGA_SKANNADE_SIDOR_MEDDELANDE,
  tillAnalysStage,
  valjLasbarRapport,
  type IdentitetsBeroenden,
  type LasbarRapport,
  PIPELINE_VERSION,
  rapportensPdfSokvag,
  tolkaRapportInnehall,
} from "./register";
import { LISTADE_OMRADEN } from "./registerPublik";

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
 * True when this exact PDF is already analysed and servable at the CURRENT
 * pipeline version (done, and its stored result parses with the running code
 * — the same test `kopplaUppladdning` applies): the upload will be answered
 * from the register at no cost, so today's spend cap has no reason to refuse
 * it. A report stored only at an older version is NOT free: the upload queues
 * a new run. A cheap read; never throws — on any failure the answer is "no"
 * and the normal cap check decides.
 */
async function kanServerasUtanKostnad(lager: Lager, pdfHash: string): Promise<boolean> {
  try {
    const fil = await lager.db.hamtaRapportFil(pdfHash);
    if (!fil) return false;
    const rapport = await foljErsattAv(lager.db, await lager.db.hamtaRapport(fil.rapportId));
    if (rapport === null) return false;
    const lasbar = await valjLasbarRapport(lager.db, rapport);
    return lasbar !== null && !lasbar.aldreVersion;
  } catch (fel) {
    console.warn(
      "[register] Kunde inte slå upp hash-träffen före spend-taket: " +
        (fel instanceof Error ? fel.message : String(fel)),
    );
    return false;
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
 * textlagerkontroll → dagens spend-tak (läsning, ingen reservation; hoppas
 * över för en hash-träff på en klar rapport på AKTUELL version) →
 * uppladdningskvoten → principal → uppladdning → registret
 * (`kopplaUppladdning`, register.ts: hash-träff, lokal identitet, eller en ny
 * rapport; en rapport som bara finns på en äldre version ger en ny körning på
 * aktuell version) → analys-raden (med `principal_id`) → föreningens område
 * (bästa försök) → kvoten tillbaka om analysen serverades direkt ur registret
 * eller anslöt till en rapport som redan analyseras.
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

  // Textlagerkontroll INNAN något laddas upp eller sätts in. Skannade
  // rapporter (textlager 'saknas') stöds sedan WS1 (transkribering, steg.ts);
  // SKANNADE_RAPPORTER_AKTIVA är kvar som nödbroms i koden.
  // .slice() kopierar: extractPdfText detacherar sin input (pdf.js/unpdf),
  // och args.pdfBytes behövs oförändrad för uppladdningen nedan.
  const { pages, totalPages } = await extractPdfText(args.pdfBytes.slice());
  const textlager = klassificeraTextlager(pages);
  if (textlager === "saknas" && !SKANNADE_RAPPORTER_AKTIVA) {
    const { errorCode, message } = tolkaFel(new ScannedPdfError());
    return { ok: false, errorCode, errorMessage: message };
  }
  if (textlager === "saknas" && totalPages > MAX_SIDOR_SKANNAD_RAPPORT) {
    return {
      ok: false,
      errorCode: "scanned_pdf",
      errorMessage: FOR_MANGA_SKANNADE_SIDOR_MEDDELANDE,
    };
  }

  // Dagens spend-tak, i förväg: annars köar analysen tyst till i morgon (se
  // `kontrolleraDagligtTak`). Före kvoten, så ett nekande inte kostar köparen
  // något. Undantag: en hash-träff på en redan klar, kompatibel rapport på
  // aktuell version serveras direkt ur registret och kostar inget — den nekas
  // inte av taket (kill switchen ovan gäller däremot alla).
  if (!(await kanServerasUtanKostnad(lager, pdfHash))) {
    const tak = await kontrolleraDagligtTak(lager.db, env);
    if (!tak.ok) {
      const { errorCode, message } = tolkaSpendSkal(tak.skal ?? "daily_cap");
      return { ok: false, errorCode, errorMessage: message };
    }
  }

  let principalId: string | null = null;
  let kvotTagen = false;
  if (anropare) {
    const kvot = await kontrolleraUppladdningskvot(anropare.konto, anropare.kontext);
    if (!kvot.ok) {
      const { errorCode, message } = tolkaKvot(kvot);
      return { ok: false, errorCode, errorMessage: message };
    }
    kvotTagen = true;
  }

  // Allt efter att kvoten tagits: ett oväntat kast (lagring, databas, ...) får
  // aldrig kosta köparen kvot för en analys som aldrig skapades. Kvoten (även den
  // lösa) lämnas tillbaka och felet kastas vidare — analysFn.ts mappar det till
  // ett köparsäkert svar.
  try {
    if (anropare) {
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

    // Serverad direkt ur registret, eller ansluten till en rapport som redan
    // analyseras: ingen ny kostnad uppstår, så ingen kvot heller.
    if ((koppling.ateranvand || koppling.vantarPaRapport) && koppling.viaHash && anropare) {
      await aterlamnaUppladdningskvot(anropare.konto, anropare.kontext);
    }

    return {
      ok: true,
      analysisId: id,
      ...(koppling.ateranvand ? { ateranvand: true } : {}),
      ...(koppling.vantarPaRapport ? { vantarPaRapport: true } : {}),
    };
  } catch (fel) {
    if (anropare && kvotTagen) {
      await aterlamnaUppladdningskvot(anropare.konto, anropare.kontext, { aven_losa: true });
    }
    throw fel;
  }
}

// ---------------------------------------------------------------------------
// skapaAnalysFranRegister
// ---------------------------------------------------------------------------

export interface SkapaAnalysFranRegisterArgs {
  /** The public register slug of the BRF (`/brf/<slug>`). */
  slug: string;
  propertyInput: unknown;
}

export interface SkapaAnalysFranRegisterBeroenden {
  anropare?: Anropare;
  /** Read port of the public register (production: `skapaRegisterLasning`). */
  lasning: RegisterLasning;
}

const FORENING_SAKNAS_MEDDELANDE =
  "Föreningen finns inte i registret, eller så har den ingen färdig analys ännu. " +
  "Ladda upp årsredovisningen i stället.";

/**
 * A buyer's analysis of one apartment in a BRF that is already in the public
 * register: the apartment details only, no PDF. Creates the same per-user
 * `analys` row an upload creates (linked to a rapport, status derived from
 * it), so status and the full report work unchanged.
 *
 * Two cases, decided by the newest fiscal year's stored report (the public
 * register's pick):
 *   - stored at the CURRENT pipeline version → linked to it, free: no model
 *     call, no spend reservation, the LOOSE upload quota only (the strict
 *     quota caps API spend and this spends none);
 *   - stored only at an OLDER version → this is a user's request for an
 *     analysis, so a new current-version run is queued on the stored PDF
 *     (`koaOmkorning`, or joining one already in progress), behind the daily
 *     spend cap and the STRICT upload quota, as for an upload (the strict
 *     quota is given back when an in-progress run is joined). If the stored
 *     PDF is gone, the old report is linked and served as stored (free).
 *
 * Order: entitlement → BRF resolution (listed + a servable done rapport; the
 * same rules as the public register) → validation → kill switch → (re-run
 * only: stored PDF present? → daily spend cap) → quota → principal → (re-run:
 * queue) → analys row → buyer postnummer registered. Every refusal before the
 * quota leaves no side effects; any throw after it gives the quota back.
 */
export async function skapaAnalysFranRegister(
  lager: Lager,
  env: Env,
  args: SkapaAnalysFranRegisterArgs,
  beroenden: SkapaAnalysFranRegisterBeroenden,
): Promise<SkapaAnalysResultat> {
  const { anropare, lasning } = beroenden;
  if (anropare) {
    const behorighet = await provaBehorighet(anropare, "ladda_upp_analys");
    if (!behorighet.ok) return behorighet;
  }

  const saknas = {
    ok: false as const,
    errorCode: "validation" as const,
    errorMessage: FORENING_SAKNAS_MEDDELANDE,
  };

  // Resolve the BRF by the public register's rules: listed (slug + a listed
  // area) and the newest servable done rapport (current pipeline version first).
  const slug = typeof args.slug === "string" ? args.slug.slice(0, 200) : "";
  const forening = slug ? await lasning.hamtaForeningViaSlug(slug) : null;
  if (
    !forening ||
    forening.slug === null ||
    forening.registeromrade === null ||
    !LISTADE_OMRADEN.includes(forening.registeromrade)
  ) {
    return saknas;
  }
  const klara = await lasning.listaKlaraRapporter(forening.orgnr);
  // Same pick as the BRF page (`enPerAr`): newest fiscal year, and within a
  // year the current pipeline version first (sort is stable).
  const ordnade = [...klara].sort(
    (a, b) =>
      b.rakenskapsar - a.rakenskapsar ||
      Number(b.pipelineVersion === PIPELINE_VERSION) -
        Number(a.pipelineVersion === PIPELINE_VERSION),
  );
  let lasbar: LasbarRapport | null = null;
  for (const kandidat of ordnade) {
    if (!tolkaRapportInnehall(kandidat)) continue;
    const rad = await foljErsattAv(lager.db, await lager.db.hamtaRapport(kandidat.id));
    const valt = rad ? await valjLasbarRapport(lager.db, rad) : null;
    if (valt && valt.rapport.pdfHash !== null) {
      lasbar = valt;
      break;
    }
  }
  if (!lasbar || lasbar.rapport.pdfHash === null) return saknas;
  const valdRapport = lasbar.rapport;
  const pdfHash = lasbar.rapport.pdfHash;

  const parsedInput = PropertyInputSchema.safeParse(args.propertyInput);
  if (!parsedInput.success) {
    return {
      ok: false,
      errorCode: "validation",
      errorMessage:
        "Uppgifterna om bostaden kunde inte tolkas. Kontrollera formuläret och försök igen.",
    };
  }
  // The BRF is the register's, whatever the client sent as orgnr.
  const propertyInput = { ...parsedInput.data, orgnr: forening.orgnr } as PropertyInput;

  if (env.killSwitchPa) {
    const { errorCode, message } = tolkaSpendSkal("kill_switch");
    return { ok: false, errorCode, errorMessage: message };
  }

  // An older-version report is re-run on request, if its stored PDF is still
  // there (read-only check, before any quota). Without it the old report is
  // linked and served as stored.
  const omkorning = lasbar.aldreVersion && (await harLagradPdf(lager, valdRapport));
  if (omkorning) {
    const tak = await kontrolleraDagligtTak(lager.db, env);
    if (!tak.ok) {
      const { errorCode, message } = tolkaSpendSkal(tak.skal ?? "daily_cap");
      return { ok: false, errorCode, errorMessage: message };
    }
  }

  let kvotTagen = false;
  if (anropare) {
    const kvot = omkorning
      ? await kontrolleraUppladdningskvot(anropare.konto, anropare.kontext)
      : await kontrolleraLosUppladdningskvot(anropare.konto, anropare.kontext);
    if (!kvot.ok) {
      const { errorCode, message } = tolkaKvot(kvot);
      return { ok: false, errorCode, errorMessage: message };
    }
    kvotTagen = true;
  }

  try {
    const principalId = anropare
      ? (await medPrincipal(anropare.konto, anropare.kontext)).principalId
      : null;

    let rapportId = valdRapport.id;
    let ateranvand = true;
    let vantarPaRapport = false;
    let nyKostnad = false;
    if (omkorning) {
      const utfall = await koaOmkorning(lager, valdRapport, env.anthropicModel, {
        raknaMisslyckade: false,
      });
      if (utfall.utfall !== "pdf_saknas") {
        const ny = await foljErsattAv(lager.db, await lager.db.hamtaRapport(utfall.rapportId));
        rapportId = ny?.id ?? utfall.rapportId;
        // 'finns': joined a current-version run someone else started — still
        // running, or (a race) just finished.
        ateranvand = utfall.utfall === "finns" && ny?.status === "done";
        vantarPaRapport = utfall.utfall === "finns" && ny !== null && arPagaende(ny);
        nyKostnad = utfall.utfall === "koad";
      }
      // 'pdf_saknas' (the file vanished since the check): the old report is
      // linked as stored — nothing new is paid for.
    }
    const fil = await lager.db.hamtaRapportFil(pdfHash);
    const { id } = await lager.db.skapaAnalys({
      pdfHash,
      pdfPath: fil?.pdfPath ?? `${pdfHash}.pdf`,
      propertyInput,
      model: env.anthropicModel,
      promptVersion: PROMPT_VERSION,
      status: "queued",
      stage: "uploaded",
      rapportId,
      principalId,
    });

    if (propertyInput.postnummer !== "") {
      try {
        await registreraAnvandarAdress(lager.db, forening.orgnr, propertyInput.postnummer);
      } catch (fel) {
        console.warn(
          `[register] Kunde inte registrera område för analys ${id}: ` +
            (fel instanceof Error ? fel.message : String(fel)),
        );
      }
    }

    // Only a newly queued run costs anything: give the strict quota back for
    // joining a run in progress (as for an upload) or for the fallback.
    if (omkorning && !nyKostnad && anropare) {
      await aterlamnaUppladdningskvot(anropare.konto, anropare.kontext);
    }

    return {
      ok: true,
      analysisId: id,
      ...(ateranvand ? { ateranvand: true } : {}),
      ...(vantarPaRapport ? { vantarPaRapport: true } : {}),
    };
  } catch (fel) {
    if (anropare && kvotTagen) {
      if (omkorning) {
        await aterlamnaUppladdningskvot(anropare.konto, anropare.kontext, { aven_losa: true });
      } else {
        await aterlamnaLosUppladdningskvot(anropare.konto, anropare.kontext);
      }
    }
    throw fel;
  }
}

/** The stored bytes of a rapport are still in storage (a re-run is possible). */
async function harLagradPdf(lager: Lager, r: RapportRad): Promise<boolean> {
  const sokvag = await rapportensPdfSokvag(lager.db, r);
  return sokvag !== null && (await lager.filer.finns(sokvag));
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
 * Status för en registerlänkad analys, härledd från rapporten. En läsning
 * köar ALDRIG något (se filkommentaren):
 *   - något läsbart finns (valjLasbarRapport) → done/complete (en äldre
 *     version serveras som den är, med not i resultatet);
 *   - rapporten pågår → dess status och mappade steg;
 *   - inget läsbart och rapporten pågår inte (misslyckad, eller klar men
 *     oläsbar med den körande koden): pågår en nyare körning av samma rapport
 *     på aktuell version (någon laddade upp eller begärde den), visa dess
 *     förlopp — den serveras så fort den är klar;
 *   - annars: misslyckad → dess (köparsäkra) fel; klar men oläsbar → ett
 *     synligt fel (`omkorningOmojligResultat`: ladda upp igen, så körs en ny
 *     analys).
 */
async function hamtaRapportStatus(lager: Lager, rad: AnalysRad): Promise<AnalysStatusSvar> {
  const lankad = await hamtaLankadRapport(lager, rad);
  const lasbar = await valjLasbarRapport(lager.db, lankad);

  if (lasbar) {
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
  if (!arPagaende(lankad)) {
    const nyare = await hittaPagaendeKorning(lager.db, lankad);
    if (nyare) {
      aktuell = nyare;
    } else if (lankad.status === "done") {
      // Klar men oläsbar, och ingen ny körning pågår. Ingen omkörning från en
      // läsning: ett synligt fel som säger vad köparen kan göra.
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
 * parses — exactly as stored (grade included), with a note. Never queues a
 * re-run. A stored result that does not parse is never served
 * (AnalysInteKlarError, which sends the UI back to /forhandsvisning, whose
 * status shows the in-progress newer run or a visible error).
 */
async function hamtaRegisterUnderlag(lager: Lager, rad: AnalysRad): Promise<Underlag> {
  const lankad = await hamtaLankadRapport(lager, rad);
  const lasbar: LasbarRapport | null = await valjLasbarRapport(lager.db, lankad);
  if (!lasbar) throw new AnalysInteKlarError(rad.id, tillAnalysStage(lankad.stage));

  const extraSkal: string[] = [];
  if (lasbar.aldreVersion) extraSkal.push(ALDRE_VERSION_SKAL);
  const nyareAr = await hittaNyareAr(lager.db, lasbar.rapport);
  if (nyareAr !== null) extraSkal.push(nyareArSkal(nyareAr));

  return { ...lasbar.innehall, extraSkal };
}

/** Used by hamtaResultat: row lookup, the right
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
 * `SaknarBehorighetError` kastas (routen skickar då köparen till
 * statussidan /forhandsvisning). Ingen kvot: läsningar kostar inget.
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
