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
 * fel som bara syns vid sammanställning (t.ex. `SaknarRantekanslighetError`)
 * först upptäckas när en köpare faktiskt öppnar resultatet, långt efter att
 * jobbet redan sagt "done".
 */

import Anthropic from "@anthropic-ai/sdk";
import type { AnalysJudgement } from "@/lib/analysis/analyze";
import { analysera } from "@/lib/analysis/analyze";
import { assembleraAnalys } from "@/lib/analysis/assemble";
import { enforceCostLimit, estimateCostSek, SONNET_5_PRISSATTNING } from "@/lib/analysis/costGuard";
import { ModelTruncatedError, type ModelCaller } from "@/lib/analysis/extract";
import { SchablonPrisdatakalla } from "@/lib/analysis/prisdata";
import {
  parseModelJson,
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
import { tolkaFel } from "./fel";
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
   *  Anthropic client (see `resolveClient` below). */
  client?: AnthropicClientLike;
}

export interface KorNastaStegResultat {
  claimed: boolean;
  analysisId?: string;
  stage?: AnalysStage;
}

/**
 * Bygger den riktiga Anthropic-klienten, castad till samma smala form
 * `runExtraction.ts` redan använder — eller returnerar den injicerade
 * testdubbletten oförändrad. Samma mönster som `resolveClient` i
 * `runExtraction.ts`, duplicerat här (inte importerat) eftersom den
 * funktionen inte är exporterad därifrån och det här är den enda andra
 * platsen ett rått `AnthropicClientLike` behöver byggas — `judging`-steget,
 * som (till skillnad från grundning/extraktion) inte går via `runAnalys`.
 */
function resolveClient(
  client: AnthropicClientLike | undefined,
  apiKey: string,
): AnthropicClientLike {
  if (client) return client;
  return new Anthropic({ apiKey }) as unknown as AnthropicClientLike;
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
 * Gemensam felväg. Reservationen (om någon gjordes) stäms av till noll —
 * det konservativa antagandet att inget faktiskt spenderades. Ett fel som
 * inträffar EFTER att modellanropet redan kostat något (men innan resten av
 * steget lyckades) skulle egentligen behöva stämmas av mot den delsumman;
 * det är en känd, medveten förenkling här (se uppgiftens instruktion) —
 * felfallet är sällsynt nog, och den ekonomiska avvikelsen liten nog, att
 * det inte är värt komplexiteten att spåra en delvis spenderad summa genom
 * varje felväg.
 */
async function avslutaMedFel(
  lager: Lager,
  rad: AnalysRad,
  reserveratSek: number,
  error: unknown,
): Promise<void> {
  if (reserveratSek > 0) {
    await stamAvSteg(lager.db, reserveratSek, 0);
  }
  const { errorCode, message } = tolkaFel(error);
  if (rad.attempts < 3) {
    // Släpp tillbaka till kön UTAN att återlämna försöket — det är genuint
    // konsumerat. Felet skrivs ändå transient så ett UI/en människa kan se
    // senaste anledningen, trots att jobbet kommer försöka igen.
    await lager.db.slappSteg(rad.id, false);
    await lager.db.uppdateraAnalys(rad.id, { errorCode, errorMessage: message });
  } else {
    await lager.db.uppdateraAnalys(rad.id, {
      status: "failed",
      errorCode,
      errorMessage: message,
      finishedAt: new Date().toISOString(),
    });
  }
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

  try {
    if (rad.pdfPath === null) {
      throw new Error("Jobbet saknar en lagrad PDF-sökväg.");
    }
    const pdfBytes = await lager.filer.hamta(rad.pdfPath);
    // exactOptionalPropertyTypes: "client" bara med i objektet när den
    // faktiskt finns — att sätta den explicit till undefined är inte samma
    // sak som att utelämna den, för RunExtractionOptions.
    const { groundingText, spentSek } = await runGrounding(pdfBytes, {
      model: rad.model,
      maxCostSek: env.maxCostPerAnalysisSek,
      ...(options?.client ? { client: options.client } : {}),
    });

    await avslutaMedFramgang(lager, rad, UPPSKATTAD_KOSTNAD_GRUNDNING_SEK, spentSek, {
      stage: "extracting",
      grundtext: groundingText,
    });
  } catch (error) {
    await avslutaMedFel(lager, rad, UPPSKATTAD_KOSTNAD_GRUNDNING_SEK, error);
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
    return { claimed: true, analysisId: rad.id, stage: rad.stage };
  }

  const reservation = await reserveraForSteg(lager.db, env, UPPSKATTAD_KOSTNAD_EXTRAKTION_SEK);
  if (!reservation.ok) {
    return refuseraOchAterlamna(lager, rad);
  }

  try {
    // rad.grundtext ska aldrig vara null här (steg 1 sätter det alltid innan
    // det avancerar hit) — men om raden ändå är inkonsistent, skicka en tom
    // sträng och låt modellanropet misslyckas naturligt snarare än att
    // specialfalla här.
    const { extraction, spentSek } = await runStructuredExtraction(rad.grundtext ?? "", {
      model: rad.model,
      maxCostSek: env.maxCostPerAnalysisSek,
      pdfSaknarTextlager: false,
      ...(options?.client ? { client: options.client } : {}),
    });

    await sparaExtraktionICache(lager.db, nyckel, extraction, spentSek);
    await avslutaMedFramgang(lager, rad, UPPSKATTAD_KOSTNAD_EXTRAKTION_SEK, spentSek, {
      stage: "judging",
      grundtext: null,
    });
  } catch (error) {
    await avslutaMedFel(lager, rad, UPPSKATTAD_KOSTNAD_EXTRAKTION_SEK, error);
  }

  return { claimed: true, analysisId: rad.id, stage: rad.stage };
}

/** Steg 3 — bedömning (pass 2), följt av en TORR sammanställning som aldrig
 *  skrivs någonstans — dess enda syfte är att låta ett monterings- eller
 *  räntekänslighetsfel upptäckas nu, som ett jobbfel, i stället för senare
 *  som ett tyst 500-fel när en köpare öppnar resultatet. */
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
      const client = resolveClient(options?.client, env.anthropicApiKey);
      const maxOutputTokens = 16000; // Matchar RunAnalysOptions default i analyze.ts.

      const callModel: ModelCaller = async (system, user) => {
        const messages = [{ role: "user" as const, content: user }];
        const count = await client.messages.countTokens({ model: rad.model, system, messages });
        enforceCostLimit(
          count.input_tokens,
          maxOutputTokens,
          env.maxCostPerAnalysisSek - spentSek,
          SONNET_5_PRISSATTNING,
        );

        const response = await client.messages.create({
          model: rad.model,
          max_tokens: maxOutputTokens,
          system,
          messages,
        });
        spentSek += estimateCostSek(
          response.usage.input_tokens,
          response.usage.output_tokens,
          SONNET_5_PRISSATTNING,
        );

        // Diagnose a cut-off response immediately — see ModelTruncatedError.
        if (response.stop_reason === "max_tokens") {
          throw new ModelTruncatedError("Bedömningen", maxOutputTokens);
        }

        return parseModelJson(response.content);
      };

      judgement = await analysera(extraction, callModel);
      await sparaAnalysICache(lager.db, nyckel, judgement, spentSek);
    }

    // Torr sammanställning — resultatet kastas, det enda syftet är att låta
    // AssemblyValidationError/SaknarRantekanslighetError propagera hit.
    // Samma normalisering som läsvägen (hamtaResultat/hamtaForhandsvisning):
    // en rad köad före en kontraktsändring får inte fastna här bara för att
    // dess lagrade input bär en numera borttagen nyckel.
    const input = lasPropertyInputFranRad(rad);
    const prisdatakalla = new SchablonPrisdatakalla({ boarea: input.boarea });
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
    await avslutaMedFel(lager, rad, reserveratSek, error);
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
