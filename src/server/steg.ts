/**
 * `korNastaSteg` — en enda tick i jobbköns state machine. En
 * `pg_cron`-triggad Edge Function-invokering anropar den här funktionen en
 * gång per tick; den klaimar EXAKT en rad ur `analys` (via
 * `lager.db.klaimaNastaSteg`, se `claim_next_steg` i
 * supabase/migrations/20260913105304_init.sql) och avancerar den ETT steg —
 * ett enda Anthropic-anrop, eller inget alls om en cache-träff gör anropet
 * onödigt.
 *
 * De tre stegen (`uploaded` → `extracting` → `judging` → `complete`) delar
 * ett gemensamt mönster: reservera spend innan ett modellanrop (se
 * `src/server/spend.ts`), gör anropet, stäm av reservationen mot den
 * faktiska kostnaden, och skriv radens nya tillstånd. Ett refuserat
 * spend-tak (kill switch eller dagligt tak) är INTE jobbets fel — raden
 * släpps tillbaka i kön med sitt försök återlämnat (se `slappSteg`), utan
 * att röra felfälten. Ett verkligt fel (ogiltigt modellsvar, saknad PDF,
 * ett monteringsfel) konsumerar ett av radens tre försök och skrivs till
 * `errorCode`/`errorMessage`; vid det tredje misslyckandet blir jobbet
 * permanent `failed`.
 *
 * Steget `judging` gör dessutom en TORR sammanställning
 * (`assembleraAnalys`) innan det markerar jobbet klart — annars skulle ett
 * fel som bara syns vid sammanställning (t.ex. `AssemblyValidationError`)
 * först upptäckas när en köpare faktiskt öppnar resultatet, långt efter att
 * jobbet redan sagt "done". Sedan task 7 (ägarbeslut) kastar
 * `assembleraAnalys` inte längre `SaknarRantekanslighetError` för en genuint
 * saknad räntekänslighet — den degraderas i stället inom `beraknaRantestress`
 * (se rantestress.ts), så den torra sammanställningen kan fortfarande
 * hamna på `AssemblyValidationError`, men inte längre på den koden.
 *
 * VERSIONSVAKT (tillagd efter en live-incident 2026-09-28): webbplatsen
 * (`skapaAnalys`, analys.ts) och den här Edge Function-koden deployas
 * OBEROENDE av varandra. Webbplatsen stämplar varje ny rad med SIN EGEN
 * `PROMPT_VERSION` vid skapandet; den här filen kör SIN EGEN `PROMPT_VERSION`
 * när den senare klaimar och avancerar raden. Låg de på olika versioner
 * (webbplatsen redan på "5", arbetaren fortfarande på "4") körde arbetaren de
 * GAMLA prompterna men skrev resultatet till `extraktion_cache`/`analys_cache`
 * under radens stämplade (NYA) nyckel — och förgiftade cachen: varje senare
 * köpare av samma förening fick den gamla extraktionen tillbaka under den
 * nya versionens nyckel, utan att något fel någonsin syntes. `korNastaSteg`
 * kontrollerar därför `rad.promptVersion` mot den körande kodens
 * `PROMPT_VERSION` OMEDELBART efter klaimningen — före allt annat (spend,
 * cache, modellanrop) — och låter jobbet misslyckas direkt utan omkö vid en
 * mismatch (se `avslutaMedVersionskonflikt` nedan). Ett nytt försök kan inte
 * hjälpa förrän båda sidor är på samma version igen.
 *
 * REGISTRET (v2, se register.ts): jobbet ligger numera på en delad
 * `rapport`-rad, inte på köparens `analys`-rad. Varje tick försöker FÖRST
 * klaima en rapport (`claim_next_rapport_steg`) och faller bara om ingen
 * finns tillbaka på den gamla `analys`-kön — så gamla rader som köades före
 * registret dräneras oförändrat (`claim_next_steg` hoppar sedan migrationen
 * över rader med `rapport_id`). Rapportens state machine:
 *
 *   identifiering ──(träff i registret)──► status 'ersatt' (analys-rader pekas om)
 *        │
 *        ├─(textlager 'saknas')─► transkribering (WS1, parallella 5-sidors chunkar,
 *        │                         sidorna sparas i `sidtext`) ─► grundning (på sidtexten)
 *        ▼
 *   grundning ─► extraktion ─► bedomning ─► klar (status 'done')
 *
 * Samma mönster per steg som ovan (spend-reservation och avstämning,
 * felmappning, tre försök per steg, nollställda försök vid stegbyte,
 * reinvoke), samma versionsvakt — mot `rapport.pipeline_version` och
 * `PIPELINE_VERSION` — och resultaten (grundtext, extraktion, bedömning)
 * skrivs på rapportraden, inte i extraktion_cache/analys_cache (som nu bara
 * läses för legacy-rader).
 */

import { runAnalys, type AnalysJudgement } from "@/lib/analysis/analyze";
import { AssemblyValidationError, assembleraAnalys } from "@/lib/analysis/assemble";
import { KostnadsgransOverskriden } from "@/lib/analysis/costGuard";
import { ModelTruncatedError, ModelValidationError } from "@/lib/analysis/extract";
import { errorHasKnownSpend, type ModelCallMetrics } from "@/lib/analysis/callMetrics";
import { PDFDocument } from "pdf-lib";
import { extractPdfText } from "@/lib/analysis/pdf";
import { sammanfattaSidreferenser } from "@/lib/analysis/sidreferenser";
import { namnLiknar as namnLiknarStandard, type Rapportidentitet } from "@/lib/analysis/identitet";
import { identifieraMedModell as identifieraMedModellStandard } from "@/lib/analysis/identitetModell";
import { ModellPrisdatakalla } from "@/lib/analysis/prisdata";
import { PROMPT_VERSION } from "@/lib/analysis/prompts";
import {
  ModelRefusedError,
  runGrounding,
  runGroundingFranTranskription,
  runStructuredExtraction,
  type AnthropicClientLike,
  type RunGroundingResult,
} from "@/lib/analysis/runExtraction";
import {
  STANDARD_CHUNKSTORLEK,
  TranskriberingMarkorFelError,
  transkribera,
} from "@/lib/analysis/transkribering";
import {
  hamtaAnalysFranCache,
  hamtaExtraktionFranCache,
  sparaAnalysICache,
  sparaExtraktionICache,
  tolkaLagradBedomning,
  tolkaLagradExtraktion,
  type CacheNyckel,
} from "./cache";
import { lasPropertyInputFranRad } from "./lagratInput";
import { loggaStegfel } from "./stegLogg";
import type { Env } from "./env";
import { tolkaFel, versionskonfliktResultat } from "./fel";
import type {
  AnalysRad,
  AnalysStage,
  Databas,
  Lager,
  RapportDelta,
  RapportRad,
  RapportStage,
} from "./portar";
import {
  arGiltigIdentitet,
  ersattRapport,
  hittaRegistertraff,
  PIPELINE_VERSION,
  rapportensPdfSokvag,
  SidtextOfullstandigError,
  TRANSKRIBERING_KALLA,
  registreraAnvandarAdress,
  uppdateraRegisterForOrgnr,
  stegEfterIdentifiering,
  UPPSKATTAD_KOSTNAD_IDENTIFIERING_SEK,
} from "./register";
import {
  reserveraForSteg,
  stamAvSteg,
  UPPSKATTAD_KOSTNAD_BEDOMNING_SEK,
  UPPSKATTAD_KOSTNAD_EXTRAKTION_SEK,
  UPPSKATTAD_KOSTNAD_GRUNDNING_SEK,
  MAX_CHUNKAR_PER_ANROP,
  MAX_TRANSKRIBERING_SEK,
  TRANSKRIBERING_MAX_OUTPUT_TOKENS_PER_CHUNK,
  transkriberingsTak,
  uppskattadKostnadTranskribering,
} from "./spend";

/**
 * One spend reservation of one step attempt, reconciled AT MOST ONCE. The
 * success path reconciles inside `avslutaMedFramgang`/`rapportFramgang`; if the
 * write that follows then fails, the error path reaches the same reservation
 * and must not reconcile it a second time (that would subtract the
 * reservation from the day's total twice and under-count the day's spend).
 */
class Reservation {
  private avstamd = false;
  constructor(readonly belopp: number) {}

  async avstam(db: Databas, faktisktSek: number): Promise<void> {
    if (this.belopp <= 0 || this.avstamd) return;
    await stamAvSteg(db, this.belopp, faktisktSek);
    // Only after the RPC succeeded: a failed reconcile was not applied, so the
    // error path may (and must) try once more.
    this.avstamd = true;
  }
}

export interface KorNastaStegOptions {
  /** Injected for tests; production omits this and each step builds a real
   *  Anthropic client (via runGrounding/runStructuredExtraction/runAnalys's
   *  own `resolveClient`, in runExtraction.ts). */
  client?: AnthropicClientLike;
  /**
   * Fire-and-forget hook: called once a stage succeeds and leaves its row
   * `queued` at a NON-terminal stage (i.e. there is more work to do right
   * away) — see korGrundningssteg/korExtraktionssteg below. Production (the
   * Edge Function, supabase/functions/analys-steg/index.ts) wires this to a
   * POST back to the function's own URL with the same `apikey` header
   * pg_cron uses, so the next stage starts immediately instead of waiting
   * for the next once-a-minute tick. `korNastaSteg` NEVER awaits it and
   * NEVER lets its failure affect the stage that just succeeded — a
   * reinvoke that never fires or never lands is not a correctness problem,
   * only a missed speed-up: the pg_cron tick remains the safety net that
   * picks the row up within the next minute regardless. Never called after
   * a failure, a refused spend reservation, or a stage that reaches
   * "complete" (nothing left to advance).
   */
  reinvoke?: () => void;
  /** Injected for tests; production uses the real model-based identity call
   *  (src/lib/analysis/identitetModell.ts). */
  identifieraMedModell?: typeof identifieraMedModellStandard;
  /** Injected for tests; production uses `namnLiknar` from identitet.ts. */
  namnLiknar?: (a: string, b: string) => boolean;
  /** Injected for tests (the register's dry assembly); production uses
   *  `assembleraAnalys`. */
  monteraAnalys?: typeof assembleraAnalys;
  /** Tests only: `transkribera`'s overall deadline (production: its 110 s default). */
  transkriberingsTidsgransMs?: number;
  /** Tests only: pause before a chunk's one retry after a transient API error
   *  (production: `transkribera`'s 1 s default). */
  transkriberingsFordrojningMs?: number;
}

export interface KorNastaStegResultat {
  claimed: boolean;
  /** Legacy queue: the analys row that was advanced. */
  analysisId?: string;
  stage?: AnalysStage;
  /** Register queue: the rapport that was advanced, and the stage it was
   *  claimed at. */
  rapportId?: string;
  rapportSteg?: RapportStage;
}

/** See `KorNastaStegOptions.reinvoke`'s doc comment — this is just the
 *  one-line "call it if it's there" so every success path reads the same
 *  way instead of repeating the optional-chaining inline. */
function trigger(options: KorNastaStegOptions | undefined): void {
  options?.reinvoke?.();
}

/** Gemensam framgångsväg: stäm av reservationen (om någon gjordes — en
 *  cache-träff reserverade aldrig något), skriv radens nya tillstånd, och
 *  släck eventuella tidigare felfält explicit så en lyckad omkörning inte
 *  lämnar en gammal felrad synlig.
 *
 * Släpper ALLTID leasen och sätter status tillbaka till "queued" som bas
 * (steg 3:s egen uppdatering skriver över status till "done" igen, se
 * spridningsordningen nedan) — annars skulle raden sitta kvar "running" med
 * en aktiv 300s-lease efter ett lyckat steg, och inte gå att klaima igen
 * förrän leasen självmant löpt ut. Det vore precis fel: en lyckad,
 * snabbt avklarad grundning ska kunna plockas upp av nästa cron-tick direkt
 * (nästa minut), inte tvinga fram en väntetid som bara är tänkt som skydd
 * mot ett steg som fortfarande pågår.
 *
 * NOLLSTÄLLER OCKSÅ `attempts` vid varje lyckat stegbyte — upptäckt genom
 * en live-körning mot det riktiga projektet (inte i teorin): `attempts` är
 * en enda räknare som `claim_next_steg` höjer vid VARJE klaim, oavsett
 * vilket av jobbets tre steg det gäller. Utan nollställning delar alla tre
 * steg samma livstidsbudget på 3 klaimningar totalt — ett enda steg som
 * behöver göras om en gång (t.ex. en klaimning vars invokering hann ta
 * längre än gratisplanens 150s väggklocka och kapades, vilket observerades
 * här) förbrukar då redan 2 av jobbets 3 klaimningar, och lämnar näst intill
 * inget kvar åt de återstående stegen — ett jobb kan då bli permanent
 * `failed` (av `binfo_reaper()`, som misstolkar det som upprepat
 * misslyckande) trots att inget enskilt steg någonsin fick tre riktiga
 * försök. Att nollställa `attempts` här ger varje steg sin EGEN budget på
 * tre klaimningar, räknat från det ögonblick steget självt blev aktuellt. */
async function avslutaMedFramgang(
  lager: Lager,
  rad: AnalysRad,
  reservation: Reservation,
  spentSek: number,
  uppdatering: Partial<AnalysRad>,
): Promise<void> {
  await reservation.avstam(lager.db, spentSek);
  await lager.db.uppdateraAnalys(rad.id, {
    status: "queued",
    leaseUntil: null,
    attempts: 0,
    ...uppdatering,
    costSek: rad.costSek + spentSek,
    errorCode: null,
    errorMessage: null,
  });
}

/**
 * Gemensam felväg. Reservationen (om någon gjordes) stäms av mot den
 * FAKTISKA kostnaden när den är känd, inte alltid mot noll.
 *
 * Reviewer finding, nu fixad: ett fel som inträffar EFTER att modellanropet
 * redan kostat något — vanligast `ModelTruncatedError`, som per definition
 * bara kastas efter ett fullständigt, betalt svar (se den klassens egen
 * doc-kommentar i extract.ts), men detsamma gäller ett valideringsfel efter
 * en uttömd retry (två betalda anrop, inte noll) — stämdes tidigare alltid
 * av mot 0 kr, det konservativa antagandet att inget spenderats. Det
 * underskattar dagens faktiska spend mot `MAX_DAILY_SPEND_SEK`-taket, vilket
 * är fel väg för en spend-guard att ha fel i: den ska aldrig kunna släppa
 * igenom MER verkligt spend än den tror den gjort.
 *
 * Två källor till den faktiska kostnaden, i prioritetsordning:
 *   1. `errorHasKnownSpend(error)` — `runGrounding`/`runStructuredExtraction`/
 *      `runAnalys` annoterar SJÄLVA ett fel de kastar med den kostnad de redan
 *      hunnit betala för (se `annotateSpend`, callMetrics.ts). Används när den
 *      finns — den är mest exakt (täcker t.ex. båda anropen i en uttömd retry).
 *   2. `knownSpentSek` — den kostnad ANROPAREN redan kände till INNAN felet
 *      kastades, för fel som inträffar EFTER att modellanropet redan lyckats
 *      och returnerat (t.ex. `sparaExtraktionICache`/`sparaAnalysICache` som
 *      inte når databasen, eller den torra sammanställningens
 *      `AssemblyValidationError` efter en FÄRSK, betald bedömning) — de
 *      felen bär själva ingen spend-annotering (de kommer inte från
 *      pipelinelagret), men stegfunktionen som anropar `avslutaMedFel` vet
 *      redan spentSek från sitt eget lyckade anrop.
 * ALDRIG båda samtidigt (dubbelräkning): är felet självannoterat används
 * ENDAST den annoteringen; annars faller vi tillbaka på `knownSpentSek`
 * (default 0, korrekt för ett fel som kastas FÖRE något anrop alls, t.ex.
 * `KostnadsgransOverskriden`).
 */
async function avslutaMedFel(
  lager: Lager,
  rad: AnalysRad,
  reservation: Reservation,
  error: unknown,
  knownSpentSek = 0,
): Promise<void> {
  const faktisktSpenderatSek = errorHasKnownSpend(error) ? error.spentSek : knownSpentSek;
  await reservation.avstam(lager.db, faktisktSpenderatSek);
  const { errorCode, message } = tolkaFel(error);
  loggaStegfel(`analys ${rad.id} steg ${rad.stage}`, errorCode, error);
  if (rad.attempts < 3) {
    // Släpp tillbaka till kön UTAN att återlämna försöket — det är genuint
    // konsumerat. Felet skrivs ändå transient så ett UI/en människa kan se
    // senaste anledningen, trots att jobbet kommer försöka igen.
    await lager.db.slappSteg(rad.id, false);
    await lager.db.uppdateraAnalys(rad.id, {
      errorCode,
      errorMessage: message,
      costSek: rad.costSek + faktisktSpenderatSek,
    });
  } else {
    await lager.db.uppdateraAnalys(rad.id, {
      status: "failed",
      errorCode,
      errorMessage: message,
      costSek: rad.costSek + faktisktSpenderatSek,
      finishedAt: new Date().toISOString(),
    });
  }
}

/** Se filkommentarens "VERSIONSVAKT"-stycke. Körs INNAN allt annat för en
 *  klaimad rad vars stämplade `promptVersion` inte matchar den körande
 *  kodens `PROMPT_VERSION` — ingen spend-reservation, inget modellanrop och
 *  ingen cache-läsning/skrivning har hunnit ske när den här funktionen
 *  anropas. Jobbet avslutas direkt som permanent `failed`, MEDVETET utan
 *  `slappSteg`/omkö (samma mönster som `avslutaMedFel`s uttömda-försök-gren):
 *  ett nytt försök kan inte lyckas förrän de två sidorna delar version igen,
 *  så att köa om det bara vore att gissa på samma sätt en gång till. De två
 *  versionssträngarna loggas bara till serverns egen konsol (Edge
 *  Function-loggen) — ALDRIG till `errorMessage`, som en köpare ser
 *  ordagrant (samma köparsäkerhets-invariant som `tolkaFel`, se fel.ts). */
async function avslutaMedVersionskonflikt(lager: Lager, rad: AnalysRad): Promise<void> {
  console.error(
    `[versionskonflikt] Rad ${rad.id} stämplad promptVersion="${rad.promptVersion}" men ` +
      `körande kod har PROMPT_VERSION="${PROMPT_VERSION}" — avbryter utan cache-skrivning.`,
  );
  const { errorCode, message } = versionskonfliktResultat();
  await lager.db.uppdateraAnalys(rad.id, {
    status: "failed",
    errorCode,
    errorMessage: message,
    finishedAt: new Date().toISOString(),
  });
}

/** En refuserad reservation (kill switch eller dagligt tak) är inte jobbets
 *  fel — släpp tillbaka det med försöket återlämnat, rör aldrig felfälten. */
async function refuseraOchAterlamna(lager: Lager, rad: AnalysRad): Promise<KorNastaStegResultat> {
  await lager.db.slappSteg(rad.id, true);
  return { claimed: true, analysisId: rad.id, stage: rad.stage };
}

/** Steg 1 — grundning (pass 1, anrop 1: hela PDF:en, citations). */
async function korGrundningssteg(
  lager: Lager,
  env: Env,
  rad: AnalysRad,
  options: KorNastaStegOptions | undefined,
): Promise<KorNastaStegResultat> {
  const reservation = await reserveraForSteg(lager.db, env, UPPSKATTAD_KOSTNAD_GRUNDNING_SEK);
  if (!reservation.ok) {
    return refuseraOchAterlamna(lager, rad);
  }
  const res = new Reservation(UPPSKATTAD_KOSTNAD_GRUNDNING_SEK);

  // Hålls i funktionens ytterscope (inte inuti try) så catch-blocket känner
  // till den redan spenderade kostnaden även om felet kommer EFTER ett lyckat
  // (betalt) `runGrounding`-anrop — t.ex. om `avslutaMedFramgang` själv skulle
  // fela på vägen till databasen. Se `avslutaMedFel`s doc-kommentar.
  let spentSek = 0;
  try {
    if (rad.pdfPath === null) {
      throw new Error("Jobbet saknar en lagrad PDF-sökväg.");
    }
    const pdfBytes = await lager.filer.hamta(rad.pdfPath);
    // exactOptionalPropertyTypes: "client" bara med i objektet när den
    // faktiskt finns — att sätta den explicit till undefined är inte samma
    // sak som att utelämna den, för RunExtractionOptions. "effort" behöver
    // inte samma spread-trick — env.effortGrounding är alltid satt (default
    // "medium" i lasEnv), aldrig `undefined`.
    const result = await runGrounding(pdfBytes, {
      model: rad.model,
      maxCostSek: env.maxCostPerAnalysisSek,
      effort: env.effortGrounding,
      ...(options?.client ? { client: options.client } : {}),
    });
    spentSek = result.spentSek;

    await avslutaMedFramgang(lager, rad, res, spentSek, {
      stage: "extracting",
      grundtext: result.groundingText,
    });
    // Grundning lyckades och lämnade raden `queued` vid "extracting" — mer
    // arbete kvar direkt, inte nästa cron-tick. Se KorNastaStegOptions.reinvoke.
    trigger(options);
  } catch (error) {
    await avslutaMedFel(lager, rad, res, error, spentSek);
  }

  return { claimed: true, analysisId: rad.id, stage: rad.stage };
}

/** Steg 2 — strukturerad extraktion (pass 1, anrop 2: text only). Cachead
 *  per (pdfHash, model, promptVersion) — andra köparen på samma förening
 *  kostar 0 kr. */
async function korExtraktionssteg(
  lager: Lager,
  env: Env,
  rad: AnalysRad,
  nyckel: CacheNyckel,
  options: KorNastaStegOptions | undefined,
): Promise<KorNastaStegResultat> {
  const cachad = await hamtaExtraktionFranCache(lager.db, nyckel);
  if (cachad) {
    await avslutaMedFramgang(lager, rad, new Reservation(0), 0, {
      stage: "judging",
      grundtext: null,
    });
    trigger(options); // se kommentaren i korGrundningssteg — cache-träffen är lika "klar direkt".
    return { claimed: true, analysisId: rad.id, stage: rad.stage };
  }

  const reservation = await reserveraForSteg(lager.db, env, UPPSKATTAD_KOSTNAD_EXTRAKTION_SEK);
  if (!reservation.ok) {
    return refuseraOchAterlamna(lager, rad);
  }
  const res = new Reservation(UPPSKATTAD_KOSTNAD_EXTRAKTION_SEK);

  // Se korGrundningssteg — samma anledning till att spentSek lever utanför try.
  let spentSek = 0;
  try {
    // rad.grundtext ska aldrig vara null här (steg 1 sätter det alltid innan
    // det avancerar hit) — men om raden ändå är inkonsistent, skicka en tom
    // sträng och låt modellanropet misslyckas naturligt snarare än att
    // specialfalla här.
    const result = await runStructuredExtraction(rad.grundtext ?? "", {
      model: rad.model,
      maxCostSek: env.maxCostPerAnalysisSek,
      pdfSaknarTextlager: false,
      effort: env.effortExtraction,
      ...(options?.client ? { client: options.client } : {}),
    });
    spentSek = result.spentSek;

    // Om det här steget (cache-skrivning) skulle fela: extraktionen redan
    // BETALADES för av runStructuredExtraction ovan — spentSek är redan känd
    // och skickas med till avslutaMedFel, inte 0 kr.
    await sparaExtraktionICache(lager.db, nyckel, result.extraction, spentSek);
    await avslutaMedFramgang(lager, rad, res, spentSek, {
      stage: "judging",
      grundtext: null,
    });
    trigger(options); // klar vid "judging" — mer arbete kvar direkt.
  } catch (error) {
    await avslutaMedFel(lager, rad, res, error, spentSek);
  }

  return { claimed: true, analysisId: rad.id, stage: rad.stage };
}

/** Steg 3 — bedömning (pass 2), följt av en TORR sammanställning som aldrig
 *  skrivs någonstans — dess enda syfte är att låta ett monteringsfel
 *  upptäckas nu, som ett jobbfel, i stället för senare som ett tyst
 *  500-fel när en köpare öppnar resultatet. (Sedan task 7 är en genuint
 *  saknad räntekänslighet inte längre ett sådant fel — se ovan.) */
async function korBedomningssteg(
  lager: Lager,
  env: Env,
  rad: AnalysRad,
  nyckel: CacheNyckel,
  options: KorNastaStegOptions | undefined,
): Promise<KorNastaStegResultat> {
  let judgement = await hamtaAnalysFranCache(lager.db, nyckel);
  let res = new Reservation(0);

  if (!judgement) {
    const reservation = await reserveraForSteg(lager.db, env, UPPSKATTAD_KOSTNAD_BEDOMNING_SEK);
    if (!reservation.ok) {
      return refuseraOchAterlamna(lager, rad);
    }
    res = new Reservation(UPPSKATTAD_KOSTNAD_BEDOMNING_SEK);
  }

  let spentSek = 0;
  try {
    // Steg 2 skriver alltid extraktionen till cachen INNAN det avancerar
    // till "judging" — den måste alltså finnas här. Om den ändå saknas är
    // det en inkonsistent rad, inte ett förväntat läge.
    const extraction = await hamtaExtraktionFranCache(lager.db, nyckel);
    if (!extraction) {
      throw new Error("Extraktion saknas i cachen för ett jobb i steget 'judging'.");
    }

    if (!judgement) {
      // Går via runAnalys (analyze.ts) i stället för att duplicera
      // anropsloopen härifrån — samma injicerbara klient
      // (runGrounding/runStructuredExtraction i runExtraction.ts har redan
      // det mönstret), och samma spend-annotering på ett kastat fel
      // (annotateSpend/errorHasKnownSpend, callMetrics.ts) utan att skriva
      // om den logiken en tredje gång.
      const result = await runAnalys(extraction, {
        apiKey: env.anthropicApiKey,
        model: rad.model,
        maxCostSek: env.maxCostPerAnalysisSek,
        effort: env.effortJudging,
        ...(options?.client ? { client: options.client } : {}),
      });
      judgement = result.analys;
      spentSek = result.spentSek;
      // Om cache-skrivningen nedan, eller den torra sammanställningen som
      // följer, skulle fela: bedömningen redan BETALADES för av runAnalys
      // ovan — spentSek är redan känd (satt just ovan) och skickas med till
      // avslutaMedFel i catch-blocket, inte 0 kr. Gäller t.ex.
      // AssemblyValidationError som upptäcks av den torra sammanställningen
      // EFTER en färsk, betald bedömning.
      await sparaAnalysICache(lager.db, nyckel, judgement, spentSek);
    }

    // Torr sammanställning — resultatet kastas, det enda syftet är att låta
    // AssemblyValidationError propagera hit (sedan task 7 degraderar
    // beraknaRantestress i stället för att kasta SaknarRantekanslighetError —
    // se rantestress.ts och assemble.ts:s filkommentar).
    // Samma normalisering som läsvägen (hamtaResultat/hamtaForhandsvisning):
    // en rad köad före en kontraktsändring får inte fastna här bara för att
    // dess lagrade input bär en numera borttagen nyckel.
    const input = lasPropertyInputFranRad(rad);
    const prisdatakalla = new ModellPrisdatakalla();
    await assembleraAnalys({
      extraction,
      input,
      prisdatakalla,
      analys: judgement,
      analysisId: rad.id,
      skapad: rad.createdAt,
    });

    await avslutaMedFramgang(lager, rad, res, spentSek, {
      stage: "complete",
      status: "done",
      finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    await avslutaMedFel(lager, rad, res, error, spentSek);
  }

  return { claimed: true, analysisId: rad.id, stage: rad.stage };
}

/**
 * Klaimar exakt en jobbrad och avancerar den ETT steg. Se filkommentaren för
 * hela state machine. Returnerar `{ claimed: false }` utan att kasta när
 * inget jobb är klaimbart.
 */
export async function korNastaSteg(
  lager: Lager,
  env: Env,
  options?: KorNastaStegOptions,
): Promise<KorNastaStegResultat> {
  // Registret först; den gamla kön bara när ingen rapport är klaimbar (se
  // filkommentaren, "REGISTRET").
  const rapport = await lager.db.klaimaNastaRapportSteg();
  if (rapport) {
    return korRapportSteg(lager, env, rapport, options);
  }

  const rad = await lager.db.klaimaNastaSteg();
  if (!rad) {
    return { claimed: false };
  }

  // VERSIONSVAKT — se filkommentaren och avslutaMedVersionskonflikt ovan.
  // Måste ske FÖRE nyckel/switch: nyckel härleds från rad.promptVersion, och
  // varje gren av switchen nedan kan läsa eller skriva en cache keyed på den.
  if (rad.promptVersion !== PROMPT_VERSION) {
    await avslutaMedVersionskonflikt(lager, rad);
    return { claimed: true, analysisId: rad.id, stage: rad.stage };
  }

  const nyckel: CacheNyckel = {
    pdfHash: rad.pdfHash,
    model: rad.model,
    promptVersion: rad.promptVersion,
  };

  switch (rad.stage) {
    case "uploaded":
      return korGrundningssteg(lager, env, rad, options);
    case "extracting":
      return korExtraktionssteg(lager, env, rad, nyckel, options);
    case "judging":
      return korBedomningssteg(lager, env, rad, nyckel, options);
    case "complete":
    default:
      // "complete" ska aldrig vara klaimbar — claim_next_steg's
      // `stage <> 'complete'`-filter (och den partiella indexen i
      // portar.ts/migrationen) utesluter den redan. Om vi ändå hamnar här
      // är det en bugg i klaim-frågan, inte något det här steget ska
      // försöka reparera.
      return { claimed: true, analysisId: rad.id, stage: rad.stage };
  }
}

// ===========================================================================
// Registrets kö: ett steg för en `rapport`-rad. Se filkommentaren
// ("REGISTRET") för state machine; varje funktion nedan speglar sin
// legacy-motsvarighet ovan, men läser och skriver rapportraden.
//
// LEASADE SKRIVNINGAR: varje skrivning workern gör på en klaimad rapport går
// via `uppdateraLeasadRapport` — den gäller bara medan raden fortfarande är
// 'running' under just den lease workern klaimade den med. Har någon annan
// ändrat raden under tiden (en administratör ogiltigförklarade den, reapern
// fällde den, eller leasen gick ut och en annan tick klaimade om den) släpps
// stegets resultat i stället för att skriva över ett avslutat tillstånd.
// Spend stäms ändå alltid av mot det som faktiskt betalats.
// ===========================================================================

function rapportResultat(r: RapportRad): KorNastaStegResultat {
  return { claimed: true, rapportId: r.id, rapportSteg: r.stage };
}

interface KandSpend {
  spentSek: number;
  calls: readonly ModelCallMetrics[];
}

const INGEN_SPEND: KandSpend = { spentSek: 0, calls: [] };

/** Rapportens kostnad och prompt-cache-tokens efter `spend` — summeras från
 *  anropens egna metrics (cache_read_input_tokens / cache_creation_input_tokens). */
function kostnadsDelta(r: RapportRad, spend: KandSpend): RapportDelta {
  return {
    costSek: r.costSek + spend.spentSek,
    cacheReadTokens:
      r.cacheReadTokens + spend.calls.reduce((s, c) => s + c.cacheReadInputTokens, 0),
    cacheWriteTokens:
      r.cacheWriteTokens + spend.calls.reduce((s, c) => s + c.cacheCreationInputTokens, 0),
  };
}

/** Leasad skrivning (se sektionskommentaren). False = raden ändrades av någon
 *  annan; det loggas och stegets resultat släpps. */
async function skrivLeasad(lager: Lager, r: RapportRad, delta: RapportDelta): Promise<boolean> {
  const skrivet = await lager.db.uppdateraLeasadRapport(r.id, r.leaseUntil, delta);
  if (!skrivet) {
    console.warn(
      `[register] Rapport ${r.id} ändrades av någon annan medan steget '${r.stage}' kördes ` +
        "(ogiltigförklarad, reapad eller omklaimad) — stegets resultat skrivs inte.",
    );
  }
  return skrivet;
}

/** Se `avslutaMedFramgang` — samma regler (släpp leasen, köa, nollställ
 *  försöken, släck gamla felfält), för en rapport. False = raden ändrades
 *  under steget; anroparen ska då inte trigga nästa steg. */
async function rapportFramgang(
  lager: Lager,
  r: RapportRad,
  reservation: Reservation,
  spend: KandSpend,
  delta: RapportDelta,
): Promise<boolean> {
  await reservation.avstam(lager.db, spend.spentSek);
  return skrivLeasad(lager, r, {
    status: "queued",
    leaseUntil: null,
    attempts: 0,
    ...delta,
    ...kostnadsDelta(r, spend),
    errorCode: null,
    errorMessage: null,
  });
}

/** Se `avslutaMedFel` — samma regler för en rapport. `redanBokford` = stegets
 *  kostnad står redan på raden (bedömningen sparas före den torra
 *  sammanställningen), så den läggs inte på en gång till. `terminal` = felet är
 *  deterministiskt: ett nytt försök skulle ge samma svar (och betala igen), så
 *  rapporten blir `failed` direkt i stället för att köas om. */
async function rapportFel(
  lager: Lager,
  r: RapportRad,
  reservation: Reservation,
  error: unknown,
  kand: KandSpend = INGEN_SPEND,
  redanBokford = false,
  terminal = false,
): Promise<void> {
  const faktiskt: KandSpend = errorHasKnownSpend(error)
    ? { spentSek: error.spentSek, calls: error.calls }
    : kand;
  await reservation.avstam(lager.db, faktiskt.spentSek);
  const { errorCode, message } = tolkaFel(error);
  loggaStegfel(`rapport ${r.id} steg ${r.stage} försök ${r.attempts}`, errorCode, error);
  const kostnad = redanBokford ? {} : kostnadsDelta(r, faktiskt);
  if (r.attempts < 3 && !terminal) {
    // Tillbaka i kön utan att återlämna försöket (samma som slapp_rapport_steg
    // med p_ateranvand_forsok = false, men leasad).
    await skrivLeasad(lager, r, {
      status: "queued",
      leaseUntil: null,
      errorCode,
      errorMessage: message,
      ...kostnad,
    });
  } else {
    await skrivLeasad(lager, r, {
      status: "failed",
      leaseUntil: null,
      errorCode,
      errorMessage: message,
      ...kostnad,
      finishedAt: new Date().toISOString(),
    });
  }
}

/** Ett nekat spend-tak är inte rapportens fel: tillbaka i kön med försöket
 *  återlämnat, felfälten orörda. */
async function refuseraRapport(lager: Lager, r: RapportRad): Promise<KorNastaStegResultat> {
  await skrivLeasad(lager, r, {
    status: "queued",
    leaseUntil: null,
    attempts: Math.max(r.attempts - 1, 0),
  });
  return rapportResultat(r);
}

/** Versionsvakten för registret — se `avslutaMedVersionskonflikt`. En rapport
 *  som misslyckas frigör sina unika platser (indexen gäller bara levande
 *  rader), så nästa uppladdning kan registrera om den. */
async function rapportVersionskonflikt(lager: Lager, r: RapportRad): Promise<void> {
  console.error(
    `[versionskonflikt] Rapport ${r.id} har pipeline_version="${r.pipelineVersion}" men ` +
      `körande kod har PIPELINE_VERSION="${PIPELINE_VERSION}" — avbryter utan att köra.`,
  );
  const { errorCode, message } = versionskonfliktResultat();
  await skrivLeasad(lager, r, {
    status: "failed",
    leaseUntil: null,
    errorCode,
    errorMessage: message,
    finishedAt: new Date().toISOString(),
  });
}

async function lasRapportPdf(lager: Lager, r: RapportRad): Promise<Uint8Array> {
  const sokvag = await rapportensPdfSokvag(lager.db, r);
  if (sokvag === null) {
    throw new Error(`Rapport ${r.id} saknar en lagrad PDF (pdf_hash är null).`);
  }
  return lager.filer.hamta(sokvag);
}

/** Bästa-försök: en köpares postnummer → forening_adress för föreningen.
 *  Får aldrig fälla ett steg. */
async function registreraAdresserForRapport(
  lager: Lager,
  rapportId: string,
  orgnr: string,
): Promise<void> {
  try {
    for (const analys of await lager.db.hamtaAnalyserForRapport(rapportId, 50)) {
      const postnummer = (analys.propertyInput as { postnummer?: unknown }).postnummer;
      if (typeof postnummer === "string" && postnummer !== "") {
        await registreraAnvandarAdress(lager.db, orgnr, postnummer);
      }
    }
    // A new buyer postnummer can change the fallback area (see register.ts).
    await uppdateraRegisterForOrgnr(lager.db, orgnr);
  } catch (fel) {
    console.warn(
      `[register] Kunde inte registrera adresser för rapport ${rapportId}: ` +
        (fel instanceof Error ? fel.message : String(fel)),
    );
  }
}

type IdentitetsUtfall = { typ: "ersatt"; malId: string } | { typ: "satt" } | { typ: "utan" };

/**
 * Efter modellens identitet, med samma namnregel som uppladdningen:
 *   - träff (båda namnen kända och lika) → ersätt med den befintliga;
 *   - namnkonflikt → fortsätt utan identitet;
 *   - kandidat men ett namn okänt → slå INTE ihop; behåll rapporten och sätt
 *     identiteten bara om platsen är ledig (den är det inte — kandidaten
 *     håller den — så i praktiken: utan identitet);
 *   - miss → ta platsen (krock = någon hann före → slå upp igen).
 */
async function kopplaIdentitet(
  lager: Lager,
  r: RapportRad,
  identitet: Rapportidentitet,
  namnLiknar: (a: string, b: string) => boolean,
): Promise<IdentitetsUtfall> {
  const { db } = lager;
  const uppslag = { namnLiknar, uteslutId: r.id, tillatAldreVersion: false };
  const traff = await hittaRegistertraff(db, identitet, uppslag);
  if (traff.typ === "traff") return { typ: "ersatt", malId: traff.rapport.id };
  if (traff.typ === "namnkonflikt") {
    console.warn(
      `[identifiering] Rapport ${r.id}: namnet "${identitet.namn}" stämmer inte med föreningen ` +
        `${identitet.orgnr} i registret — fortsätter utan identitet.`,
    );
    return { typ: "utan" };
  }
  if (traff.typ === "miss") await db.registreraForening(identitet.orgnr, identitet.namn);
  if (await db.sattRapportIdentitet(r.id, identitet.orgnr, identitet.rakenskapsar, r.leaseUntil)) {
    return { typ: "satt" };
  }
  if (traff.typ === "namnOkant") return { typ: "utan" };
  const igen = await hittaRegistertraff(db, identitet, uppslag);
  return igen.typ === "traff" ? { typ: "ersatt", malId: igen.rapport.id } : { typ: "utan" };
}

/**
 * Deterministiska utfall av identitetsanropet — ett nytt försök ger samma
 * svar, så de sväljs och rapporten fortsätter utan identitet direkt: ett
 * ogiltigt eller avklippt svar (ModelValidationError, ModelTruncatedError —
 * det senare ett komplett, betalt svar mot ett fast tokentak), kostnadsspärren
 * och en vägran. Allt annat — Anthropics APIError/APIConnectionError (429,
 * 5xx, 529 overloaded), nätverksfel och okända fel — räknas som transient och
 * kastas vidare till den vanliga tre-försöks-logiken.
 */
function arDeterministisktIdentitetsfel(fel: unknown): boolean {
  return (
    fel instanceof ModelValidationError ||
    fel instanceof ModelTruncatedError ||
    fel instanceof KostnadsgransOverskriden ||
    fel instanceof ModelRefusedError
  );
}

/**
 * Steg 0 — identifiering (rapporter vars identitet inte gick att läsa lokalt
 * vid uppladdningen). Ett billigt modellanrop på sida 1–3. Identiteten fäller
 * ALDRIG jobbet: ett deterministiskt utfall (se ovan) fortsätter direkt utan
 * identitet; ett transient fel prövas om (tre försök, som varje steg) och
 * fortsätter utan identitet först när försöken är slut. En rapport utan
 * identitet kan bara återanvändas via sin hash.
 */
async function korIdentifiering(
  lager: Lager,
  env: Env,
  r: RapportRad,
  options: KorNastaStegOptions | undefined,
): Promise<KorNastaStegResultat> {
  const reservation = await reserveraForSteg(lager.db, env, UPPSKATTAD_KOSTNAD_IDENTIFIERING_SEK);
  if (!reservation.ok) return refuseraRapport(lager, r);
  const res = new Reservation(UPPSKATTAD_KOSTNAD_IDENTIFIERING_SEK);

  let spend: KandSpend = INGEN_SPEND;
  try {
    const pdfBytes = await lasRapportPdf(lager, r);

    let identitet: Rapportidentitet | null = null;
    try {
      const identifiera = options?.identifieraMedModell ?? identifieraMedModellStandard;
      const svar = await identifiera(pdfBytes, {
        apiKey: env.anthropicApiKey,
        maxCostSek: env.maxCostPerAnalysisSek,
        ...(options?.client ? { client: options.client } : {}),
      });
      spend = { spentSek: svar.spentSek, calls: svar.calls };
      if (svar.identitet && arGiltigIdentitet(svar.identitet)) identitet = svar.identitet;
    } catch (fel) {
      if (errorHasKnownSpend(fel)) spend = { spentSek: fel.spentSek, calls: fel.calls };
      const transient = !arDeterministisktIdentitetsfel(fel);
      // Transient och försök kvar: till den vanliga felvägen (omförsök).
      if (transient && r.attempts < 3) throw fel;
      console.warn(
        `[identifiering] Rapport ${r.id}: identitetsanropet misslyckades` +
          (transient ? " för tredje gången" : " deterministiskt") +
          ` — fortsätter utan identitet: ${fel instanceof Error ? fel.message : String(fel)}`,
      );
    }

    let utfall: IdentitetsUtfall = { typ: "utan" };
    if (identitet) {
      utfall = await kopplaIdentitet(
        lager,
        r,
        identitet,
        options?.namnLiknar ?? namnLiknarStandard,
      );
    }

    if (utfall.typ === "ersatt") {
      const ersatt = await ersattRapport(lager.db, r, utfall.malId, {
        attempts: 0,
        ...kostnadsDelta(r, spend),
      });
      try {
        await res.avstam(lager.db, spend.spentSek);
      } catch (fel) {
        // Raden är redan avslutad — en misslyckad avstämning får inte leda in
        // i felvägen (som skulle avstämma en gång till).
        console.error(`[spend] Avstämning efter ersättning av rapport ${r.id} misslyckades:`, fel);
      }
      if (ersatt && identitet) {
        await registreraAdresserForRapport(lager, utfall.malId, identitet.orgnr);
      }
      return rapportResultat(r);
    }

    const skrivet = await rapportFramgang(lager, r, res, spend, {
      stage: stegEfterIdentifiering(r.textlager),
    });
    if (!skrivet) return rapportResultat(r);
    if (utfall.typ === "satt" && identitet) {
      await registreraAdresserForRapport(lager, r.id, identitet.orgnr);
    }
    trigger(options);
  } catch (error) {
    await rapportFel(lager, r, res, error, spend);
  }
  return rapportResultat(r);
}

/** Antal sidor i rapportens PDF: den räknade siffran från uppladdningen
 *  (`rapport_fil.sidor`), annars räknas de ur bytes (PDF:en hämtas då, eller
 *  återanvänds om anroparen redan har den). Grunden för uppskattningen och för
 *  täckningskontrollen före grundningen — själva uppdelningen gör `transkribera`. */
async function antalSidorForRapport(
  lager: Lager,
  r: RapportRad,
  pdfBytes?: Uint8Array,
): Promise<number> {
  const fil = r.pdfHash === null ? null : await lager.db.hamtaRapportFil(r.pdfHash);
  if (fil?.sidor && fil.sidor > 0) return fil.sidor;
  const bytes = pdfBytes ?? (await lasRapportPdf(lager, r));
  return (await PDFDocument.load(bytes.slice())).getPageCount();
}

/** Vad som återstår att transkribera: de chunkar (`STANDARD_CHUNKSTORLEK` sidor)
 *  som har minst en sida utan sparad text — samma uppdelning som `transkribera`
 *  gör, som hoppar över en chunk först när ALLA dess sidor finns — och hur många
 *  sidor utan text varje sådan chunk har. Ordnade efter sida. */
function aterstaendeTranskribering(
  antalSidor: number,
  klara: ReadonlyMap<number, string>,
): { chunkar: number; saknadeSidorPerChunk: number[] } {
  const saknadeSidorPerChunk: number[] = [];
  for (let fran = 1; fran <= antalSidor; fran += STANDARD_CHUNKSTORLEK) {
    let saknas = 0;
    for (let n = fran; n < Math.min(antalSidor + 1, fran + STANDARD_CHUNKSTORLEK); n++) {
      if (!klara.has(n)) saknas++;
    }
    if (saknas > 0) saknadeSidorPerChunk.push(saknas);
  }
  return { chunkar: saknadeSidorPerChunk.length, saknadeSidorPerChunk };
}

/**
 * En rapport utan egen sidtext hämtar sidorna från den NYASTE andra rapporten
 * med samma bytes (`pdf_hash`) som har sidor skrivna med den nuvarande
 * transkriptionsprompten (`TRANSKRIBERING_KALLA`) — en versionshöjd omkörning,
 * eller en ny uppladdning efter ett misslyckande, ska inte betala för samma
 * sidor två gånger. Kopieras till den egna rapporten, så resten av steget (och
 * grundningen) bara ser egen sidtext. Returnerar de sidor rapporten nu har.
 */
async function ateranvandTranskription(
  lager: Lager,
  r: RapportRad,
  antalSidor: number,
): Promise<Map<number, string>> {
  if (r.pdfHash === null) return new Map();
  for (const donator of await lager.db.listaRapporter({ pdfHash: r.pdfHash })) {
    if (donator.id === r.id) continue;
    const sidor = (await lager.db.hamtaSidtext(donator.id, TRANSKRIBERING_KALLA)).filter(
      (s) => s.sida >= 1 && s.sida <= antalSidor,
    );
    if (sidor.length === 0) continue;
    await lager.db.sparaSidtext(r.id, sidor, TRANSKRIBERING_KALLA);
    return new Map(sidor.map((s) => [s.sida, s.text]));
  }
  return new Map();
}

/** Fel som ett nytt försök inte kan rätta till (och skulle betala för igen):
 *  ett avkortat svar (samma tak ger samma avkortning), felaktiga sidmarkörer
 *  även efter chunkens eget omförsök, och en förhandskontroll som inte ryms
 *  under det som återstår av stegets tak. Övergående API-fel och tidsgränsen
 *  är INTE terminala — de går den vanliga tre-försöks-vägen. */
function arTerminaltTranskriberingsfel(error: unknown): boolean {
  return (
    error instanceof ModelTruncatedError ||
    error instanceof TranskriberingMarkorFelError ||
    error instanceof KostnadsgransOverskriden ||
    // A refusal on the same pages repeats; retrying only pays again.
    error instanceof ModelRefusedError
  );
}

/**
 * Steg 0b — transkribering av en skannad rapport (textlager 'saknas', WS1,
 * docs/PLAN-v2.md §1.9). `transkribera` delar PDF:en i 5-sidors chunkar och kör
 * dem parallellt (ett modellanrop per chunk) — högst `MAX_CHUNKAR_PER_ANROP` (3)
 * per Edge-invokering, p.g.a. den hårda CPU-gränsen på 2 s; en 34-sidig skanning
 * tar tre invokeringar (3 + 3 + 1 chunkar), där den första lämnar steget kvar i
 * 'transkribering' och reinvokar;
 * varje färdig chunk sparas i `sidtext` direkt, så ett omförsök efter ett fel
 * bara gör de chunkar som saknas — och bara de reserveras och betalas. Har
 * rapporten ingen egen sidtext kopieras först en annan rapports (samma bytes,
 * samma prompt-version) — se `ateranvandTranskription`.
 *
 * Spend: reservationen är REALISTISK (0,15 kr/sida × sidor kvar, se spend.ts) och
 * stäms av mot den faktiska kostnaden. Budgeten till `transkribera` är det som
 * återstår av stegets hårda tak (`MAX_TRANSKRIBERING_SEK`, 15 kr) efter det
 * rapporten redan kostat över alla invokeringar och försök: förhandskontrollen
 * där summerar värsta fallet för invokeringens parallella chunkar, räknat ur
 * varje chunks verkliga `countTokens`. Tidsgräns: `transkribera` avbryter efter 110 s och sparar det
 * som hunnit bli klart.
 *
 * Ett misslyckande går den vanliga vägen (tre försök, verklig spend bokförd via
 * felets annotering) — utom de deterministiska (`arTerminaltTranskriberingsfel`),
 * som failar rapporten direkt. Sidorna sparas utan lease-vakt (se `sparaSidtext`
 * i portar.ts); rapportens tillstånd skrivs bara via de leasade skrivningarna.
 */
async function korTranskribering(
  lager: Lager,
  env: Env,
  r: RapportRad,
  options: KorNastaStegOptions | undefined,
): Promise<KorNastaStegResultat> {
  let res = new Reservation(0);
  let spend: KandSpend = INGEN_SPEND;
  try {
    const pdfBytes = await lasRapportPdf(lager, r);
    const antalSidor = await antalSidorForRapport(lager, r, pdfBytes);
    let klara = new Map(
      (await lager.db.hamtaSidtext(r.id, TRANSKRIBERING_KALLA)).map((s) => [s.sida, s.text]),
    );
    if (klara.size === 0) klara = await ateranvandTranskription(lager, r, antalSidor);
    const kvar = aterstaendeTranskribering(antalSidor, klara);
    // Högst MAX_CHUNKAR_PER_ANROP chunkar per invokering (CPU-tak); resten tas av
    // nästa invokering. Reservationen gäller bara invokeringens egna sidor.
    const dennaOmgang = kvar.saknadeSidorPerChunk.slice(0, MAX_CHUNKAR_PER_ANROP);
    const sidorDennaOmgang = dennaOmgang.reduce((summa, n) => summa + n, 0);

    const tak = transkriberingsTak(r.costSek);
    if (sidorDennaOmgang > 0) {
      if (tak <= 0) throw new KostnadsgransOverskriden(r.costSek, MAX_TRANSKRIBERING_SEK);
      const belopp = uppskattadKostnadTranskribering(sidorDennaOmgang);
      const reservation = await reserveraForSteg(lager.db, env, belopp);
      if (!reservation.ok) return refuseraRapport(lager, r);
      res = new Reservation(belopp);
    }

    const resultat = await transkribera(pdfBytes, {
      model: r.model,
      maxCostSek: tak,
      effort: env.effortGrounding,
      apiKey: env.anthropicApiKey,
      maxOutputTokensPerChunk: TRANSKRIBERING_MAX_OUTPUT_TOKENS_PER_CHUNK,
      maxChunkar: MAX_CHUNKAR_PER_ANROP,
      redanKlara: klara,
      sparaSidor: (sidor) => lager.db.sparaSidtext(r.id, sidor, TRANSKRIBERING_KALLA),
      ...(options?.client ? { client: options.client } : {}),
      ...(options?.transkriberingsTidsgransMs !== undefined
        ? { deadlineMs: options.transkriberingsTidsgransMs }
        : {}),
      ...(options?.transkriberingsFordrojningMs !== undefined
        ? { omforsokFordrojningMs: options.transkriberingsFordrojningMs }
        : {}),
    });
    spend = { spentSek: resultat.spentSek, calls: resultat.calls };
    // Chunkar kvar: stegbytet uteblir. Framsteg gjordes (sidorna är sparade, spenden
    // avstämd och bokförd), så försöken nollställs, leasen släpps och nästa invokering
    // tar de chunkar som saknas. Först när alla sidor finns går rapporten till grundning.
    const skrivet = await rapportFramgang(lager, r, res, spend, {
      stage: resultat.kvarChunkar > 0 ? "transkribering" : "grundning",
    });
    if (skrivet) trigger(options);
  } catch (error) {
    await rapportFel(lager, r, res, error, spend, false, arTerminaltTranskriberingsfel(error));
  }
  return rapportResultat(r);
}

/**
 * Steg 1 — grundning. Skannad rapport (textlager 'saknas'): på den sparade
 * transkriptionen (`sidtext`, i sidordning) med `runGroundingFranTranskription`.
 * Allt annat — 'ok' och 'trasigt' — på rapportens egen PDF (via rapport_fil) med
 * `runGrounding`: ett trasigt textlager stannar medvetet på den vanliga vägen
 * (uppmätt bättre än skannvägen, docs/PLAN-v2.md §1.9).
 */
async function korRapportGrundning(
  lager: Lager,
  env: Env,
  r: RapportRad,
  options: KorNastaStegOptions | undefined,
): Promise<KorNastaStegResultat> {
  const reservation = await reserveraForSteg(lager.db, env, UPPSKATTAD_KOSTNAD_GRUNDNING_SEK);
  if (!reservation.ok) return refuseraRapport(lager, r);
  const res = new Reservation(UPPSKATTAD_KOSTNAD_GRUNDNING_SEK);

  let spend: KandSpend = INGEN_SPEND;
  try {
    const grundningsval = {
      model: r.model,
      maxCostSek: env.maxCostPerAnalysisSek,
      effort: env.effortGrounding,
      ...(options?.client ? { client: options.client } : {}),
    };
    let result: RunGroundingResult;
    if (r.textlager === "saknas") {
      // Bara sidor med den nuvarande transkriptionsprompt-versionen räknas, och de
      // måste täcka HELA rapporten: grundning på partiell text tappar siffror tyst.
      // hamtaSidtext är sorterad på sida. Ingen sparad text alls är samma sak som
      // saknade sidor (terminalt, scanned_pdf i fel.ts).
      const sidtext = await lager.db.hamtaSidtext(r.id, TRANSKRIBERING_KALLA);
      const antalSidor = await antalSidorForRapport(lager, r);
      const finns = new Set(sidtext.map((s) => s.sida));
      let saknade = 0;
      for (let n = 1; n <= antalSidor; n++) if (!finns.has(n)) saknade++;
      if (saknade > 0) throw new SidtextOfullstandigError(saknade, antalSidor);
      result = await runGroundingFranTranskription(sidtext, {
        ...grundningsval,
        apiKey: env.anthropicApiKey,
      });
    } else {
      result = await runGrounding(await lasRapportPdf(lager, r), grundningsval);
    }
    spend = { spentSek: result.spentSek, calls: result.calls };
    const skrivet = await rapportFramgang(lager, r, res, spend, {
      stage: "extraktion",
      grundtext: result.groundingText,
    });
    if (skrivet) trigger(options);
  } catch (error) {
    await rapportFel(lager, r, res, error, spend, false, error instanceof SidtextOfullstandigError);
  }
  return rapportResultat(r);
}

/** En rapport som fortfarande saknar identitet efter identifieringen får den
 *  från sin egen extraktion, om orgnr klarar Luhn, namnregeln tillåter och
 *  platsen är ledig. Bästa försök: en krock eller ett fel lämnar den bara utan
 *  identitet — stegets resultat är redan sparat. */
async function forsokIdentitetFranExtraktion(
  lager: Lager,
  r: RapportRad,
  identitet: Rapportidentitet,
  namnLiknar: (a: string, b: string) => boolean,
): Promise<void> {
  if (!arGiltigIdentitet(identitet)) return;
  try {
    const forening = await lager.db.hamtaForening(identitet.orgnr);
    if (forening?.namn && identitet.namn && !namnLiknar(forening.namn, identitet.namn)) return;
    await lager.db.registreraForening(identitet.orgnr, identitet.namn);
    if (await lager.db.sattRapportIdentitet(r.id, identitet.orgnr, identitet.rakenskapsar)) {
      await registreraAdresserForRapport(lager, r.id, identitet.orgnr);
    }
  } catch (fel) {
    console.warn(
      `[register] Rapport ${r.id}: kunde inte sätta identitet från extraktionen: ` +
        (fel instanceof Error ? fel.message : String(fel)),
    );
  }
}

/**
 * Sidtexterna som extraktionens sidhänvisningar kontrolleras mot
 * (sidreferenser.ts): den sparade transkriptionen för en skanning, pdf.js-text
 * för en PDF med textlager. Inget för ett 'trasigt' textlager — där läste
 * modellen sidbilden, inte den trasiga texten, så en kontroll mot texten skulle
 * markera allt som osäkert. Hämtas FÖRE modellanropet: ett fel här kostar inget.
 */
async function hamtaSidtexterForKontroll(
  lager: Lager,
  r: RapportRad,
): Promise<Map<number, string> | undefined> {
  if (r.textlager === "trasigt") return undefined;
  if (r.textlager === "saknas") {
    const sidor = await lager.db.hamtaSidtext(r.id, TRANSKRIBERING_KALLA);
    return sidor.length > 0 ? new Map(sidor.map((s) => [s.sida, s.text])) : undefined;
  }
  // pdf.js detaches the buffer it is given — hand it a copy.
  const { pages } = await extractPdfText((await lasRapportPdf(lager, r)).slice());
  return new Map(pages.map((text, i) => [i + 1, text]));
}

/** Steg 2 — strukturerad extraktion. Resultatet sparas på rapportraden i
 *  samma (leasade) uppdatering som stegbytet. */
async function korRapportExtraktion(
  lager: Lager,
  env: Env,
  r: RapportRad,
  options: KorNastaStegOptions | undefined,
): Promise<KorNastaStegResultat> {
  const reservation = await reserveraForSteg(lager.db, env, UPPSKATTAD_KOSTNAD_EXTRAKTION_SEK);
  if (!reservation.ok) return refuseraRapport(lager, r);
  const res = new Reservation(UPPSKATTAD_KOSTNAD_EXTRAKTION_SEK);

  let spend: KandSpend = INGEN_SPEND;
  try {
    // Samma regel som grundningen: bara 'saknas' tog skannvägen. Då är texten
    // avläst ur sidbilder: datakvalitet.kalla = 'skannad', konfidensen kapas vid
    // 'medel' (runStructuredExtraction).
    const skannad = r.textlager === "saknas";
    const sidtexter = await hamtaSidtexterForKontroll(lager, r);
    const result = await runStructuredExtraction(r.grundtext ?? "", {
      model: r.model,
      maxCostSek: env.maxCostPerAnalysisSek,
      pdfSaknarTextlager: skannad,
      kalla: skannad ? "skannad" : "textlager",
      effort: env.effortExtraction,
      ...(sidtexter ? { sidtexter } : {}),
      ...(options?.client ? { client: options.client } : {}),
    });
    spend = { spentSek: result.spentSek, calls: result.calls };
    const sidref = sammanfattaSidreferenser(result.sidreferenser ?? []);
    if (sidref.korrigerade > 0 || sidref.saknas > 0) {
      console.info(
        `[sidreferenser] Rapport ${r.id}: ${sidref.ok}/${sidref.kontrollerade} stämde, ` +
          `${sidref.korrigerade} sidnummer korrigerades, ${sidref.saknas} kunde inte styrkas.`,
      );
    }
    const skrivet = await rapportFramgang(lager, r, res, spend, {
      stage: "bedomning",
      grundtext: null,
      extraction: result.extraction,
    });
    if (!skrivet) return rapportResultat(r);
    if (r.orgnr === null) {
      const { orgnr, rakenskapsar, namn } = result.extraction.forening;
      await forsokIdentitetFranExtraktion(
        lager,
        r,
        { orgnr, rakenskapsar, namn: namn.trim() === "" ? null : namn },
        options?.namnLiknar ?? namnLiknarStandard,
      );
    }
    trigger(options);
  } catch (error) {
    await rapportFel(lager, r, res, error, spend);
  }
  return rapportResultat(r);
}

/**
 * Steg 3 — bedömning, sedan en TORR sammanställning (se korBedomningssteg).
 * Den torra sammanställningen behöver en köpares PropertyInput; den tar den
 * äldsta länkade analys-raden. En rapport utan länkad analys (en lat
 * omkörning eller `npm run register -- rerun`, vars köpare fortfarande pekar
 * på den gamla rapporten) hoppar över den — dess resultat sammanställs ändå
 * vid varje läsning. Bedömningen sparas på raden direkt efter modellanropet,
 * så ett senare fel aldrig betalar för den två gånger.
 *
 * Ett AssemblyValidationError från den torra sammanställningen fäller INTE
 * den delade rapporten: det kan bero på just den köparens input, och andra
 * köpare ska inte förlora en betald, giltig extraktion + bedömning för det.
 * Rapporten blir klar, felet loggas, och syns per läsning för den köparen
 * (som ett fel från hamtaResultat, aldrig som en tyst tom analys).
 */
async function korRapportBedomning(
  lager: Lager,
  env: Env,
  r: RapportRad,
  options: KorNastaStegOptions | undefined,
): Promise<KorNastaStegResultat> {
  let judgement: AnalysJudgement | null = tolkaLagradBedomning(r.judgement);
  let res = new Reservation(0);
  if (!judgement) {
    const reservation = await reserveraForSteg(lager.db, env, UPPSKATTAD_KOSTNAD_BEDOMNING_SEK);
    if (!reservation.ok) return refuseraRapport(lager, r);
    res = new Reservation(UPPSKATTAD_KOSTNAD_BEDOMNING_SEK);
  }

  let spend: KandSpend = INGEN_SPEND;
  let rad = r;
  let bokford = false;
  try {
    const extraction = tolkaLagradExtraktion(r.extraction);
    if (!extraction) {
      throw new Error(
        `Rapport ${r.id} i steget 'bedomning' saknar en extraktion som matchar schemat.`,
      );
    }

    if (!judgement) {
      const result = await runAnalys(extraction, {
        apiKey: env.anthropicApiKey,
        model: r.model,
        maxCostSek: env.maxCostPerAnalysisSek,
        effort: env.effortJudging,
        ...(options?.client ? { client: options.client } : {}),
      });
      judgement = result.analys;
      spend = { spentSek: result.spentSek, calls: result.calls };
      const kostnad = kostnadsDelta(r, spend);
      if (!(await skrivLeasad(lager, r, { judgement, ...kostnad }))) {
        await res.avstam(lager.db, spend.spentSek);
        return rapportResultat(r);
      }
      rad = { ...r, ...kostnad, judgement };
      bokford = true;
    }

    const [forsta] = await lager.db.hamtaAnalyserForRapport(r.id, 1);
    if (forsta) {
      const montera = options?.monteraAnalys ?? assembleraAnalys;
      try {
        await montera({
          extraction,
          input: lasPropertyInputFranRad(forsta),
          prisdatakalla: new ModellPrisdatakalla(),
          analys: judgement,
          analysisId: forsta.id,
          skapad: forsta.createdAt,
        });
      } catch (fel) {
        if (!(fel instanceof AssemblyValidationError)) throw fel;
        console.error(
          `[register] Rapport ${r.id}: den torra sammanställningen för analys ${forsta.id} ` +
            "misslyckades — rapporten markeras ändå klar (felet syns vid läsning för den köparen):",
          fel,
        );
      }
    }

    await res.avstam(lager.db, spend.spentSek);
    const klar = await skrivLeasad(lager, rad, {
      status: "done",
      stage: "klar",
      leaseUntil: null,
      attempts: 0,
      errorCode: null,
      errorMessage: null,
      finishedAt: new Date().toISOString(),
    });
    if (klar) {
      // The identity may have been set from the extraction after `r` was claimed.
      const farsk = await lager.db.hamtaRapport(r.id);
      if (farsk?.orgnr) await uppdateraRegisterForOrgnr(lager.db, farsk.orgnr);
    }
  } catch (error) {
    await rapportFel(lager, rad, res, error, spend, bokford);
  }
  return rapportResultat(r);
}

async function korRapportSteg(
  lager: Lager,
  env: Env,
  r: RapportRad,
  options: KorNastaStegOptions | undefined,
): Promise<KorNastaStegResultat> {
  // VERSIONSVAKT — före allt annat, se filkommentaren.
  if (r.pipelineVersion !== PIPELINE_VERSION) {
    await rapportVersionskonflikt(lager, r);
    return rapportResultat(r);
  }

  switch (r.stage) {
    case "identifiering":
      return korIdentifiering(lager, env, r, options);
    case "transkribering":
      return korTranskribering(lager, env, r, options);
    case "grundning":
      return korRapportGrundning(lager, env, r, options);
    case "extraktion":
      return korRapportExtraktion(lager, env, r, options);
    case "bedomning":
      return korRapportBedomning(lager, env, r, options);
    case "klar":
    default:
      // Aldrig klaimbar (`stage <> 'klar'` i claim_next_rapport_steg).
      return rapportResultat(r);
  }
}
