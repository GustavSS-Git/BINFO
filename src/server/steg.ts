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
 */

import { runAnalys } from "@/lib/analysis/analyze";
import { assembleraAnalys } from "@/lib/analysis/assemble";
import { errorHasKnownSpend } from "@/lib/analysis/callMetrics";
import { ModellPrisdatakalla } from "@/lib/analysis/prisdata";
import { PROMPT_VERSION } from "@/lib/analysis/prompts";
import {
  runGrounding,
  runStructuredExtraction,
  type AnthropicClientLike,
} from "@/lib/analysis/runExtraction";
import {
  hamtaAnalysFranCache,
  hamtaExtraktionFranCache,
  sparaAnalysICache,
  sparaExtraktionICache,
  type CacheNyckel,
} from "./cache";
import { lasPropertyInputFranRad } from "./lagratInput";
import type { Env } from "./env";
import { tolkaFel, versionskonfliktResultat } from "./fel";
import type { AnalysRad, AnalysStage, Lager } from "./portar";
import {
  reserveraForSteg,
  stamAvSteg,
  UPPSKATTAD_KOSTNAD_BEDOMNING_SEK,
  UPPSKATTAD_KOSTNAD_EXTRAKTION_SEK,
  UPPSKATTAD_KOSTNAD_GRUNDNING_SEK,
} from "./spend";

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
}

export interface KorNastaStegResultat {
  claimed: boolean;
  analysisId?: string;
  stage?: AnalysStage;
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
  reserveratSek: number,
  spentSek: number,
  uppdatering: Partial<AnalysRad>,
): Promise<void> {
  if (reserveratSek > 0) {
    await stamAvSteg(lager.db, reserveratSek, spentSek);
  }
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
  reserveratSek: number,
  error: unknown,
  knownSpentSek = 0,
): Promise<void> {
  const faktisktSpenderatSek = errorHasKnownSpend(error) ? error.spentSek : knownSpentSek;
  if (reserveratSek > 0) {
    await stamAvSteg(lager.db, reserveratSek, faktisktSpenderatSek);
  }
  const { errorCode, message } = tolkaFel(error);
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

    await avslutaMedFramgang(lager, rad, UPPSKATTAD_KOSTNAD_GRUNDNING_SEK, spentSek, {
      stage: "extracting",
      grundtext: result.groundingText,
    });
    // Grundning lyckades och lämnade raden `queued` vid "extracting" — mer
    // arbete kvar direkt, inte nästa cron-tick. Se KorNastaStegOptions.reinvoke.
    trigger(options);
  } catch (error) {
    await avslutaMedFel(lager, rad, UPPSKATTAD_KOSTNAD_GRUNDNING_SEK, error, spentSek);
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
    await avslutaMedFramgang(lager, rad, 0, 0, { stage: "judging", grundtext: null });
    trigger(options); // se kommentaren i korGrundningssteg — cache-träffen är lika "klar direkt".
    return { claimed: true, analysisId: rad.id, stage: rad.stage };
  }

  const reservation = await reserveraForSteg(lager.db, env, UPPSKATTAD_KOSTNAD_EXTRAKTION_SEK);
  if (!reservation.ok) {
    return refuseraOchAterlamna(lager, rad);
  }

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
    await avslutaMedFramgang(lager, rad, UPPSKATTAD_KOSTNAD_EXTRAKTION_SEK, spentSek, {
      stage: "judging",
      grundtext: null,
    });
    trigger(options); // klar vid "judging" — mer arbete kvar direkt.
  } catch (error) {
    await avslutaMedFel(lager, rad, UPPSKATTAD_KOSTNAD_EXTRAKTION_SEK, error, spentSek);
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
  let reserveratSek = 0;

  if (!judgement) {
    const reservation = await reserveraForSteg(lager.db, env, UPPSKATTAD_KOSTNAD_BEDOMNING_SEK);
    if (!reservation.ok) {
      return refuseraOchAterlamna(lager, rad);
    }
    reserveratSek = UPPSKATTAD_KOSTNAD_BEDOMNING_SEK;
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

    await avslutaMedFramgang(lager, rad, reserveratSek, spentSek, {
      stage: "complete",
      status: "done",
      finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    await avslutaMedFel(lager, rad, reserveratSek, error, spentSek);
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
