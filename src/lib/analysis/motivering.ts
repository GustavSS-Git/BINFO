import { z } from "zod";
import type { ExtractionResult, Grade } from "@/types/analysis";
import type { AnalysJudgement } from "./analyze";
import { beraknaFastaVarden, type FastaVarden } from "./fastaVarden";
import type { ModelCaller, Utfall } from "./extract";
import {
  buildMotiveringSystemPrompt,
  buildMotiveringUserPrompt,
  type MotiveringsUnderlag,
} from "./prompts";
import {
  parseModelJson,
  kontrolleraStoppgrund,
  type BegarInst,
  type SkapaParams,
  type SvarMeddelande,
} from "./runExtraction";
import type { BetygKlampning } from "./slutfor";
import { kontrolleraSiffror, type SiffraAvvikelse } from "./siffrorKontroll";

/**
 * The grade motivation, made consistent with the final letter and the data
 * (2026-10-23). After the judging answer has been validated and the letter
 * clamped, the free text `betygMotivering` is checked:
 *
 *   - if the letter was clamped, the text argued for another letter;
 *   - if a number in it matches nothing in the data (siffrorKontroll.ts), it
 *     is wrong (the real case: 6 759 091 kr / 87 % where the report says
 *     5 759 091 kr / 74 %).
 *
 * Either triggers ONE small extra model call that rewrites only the
 * motivation for the fixed letter. If that text still fails the number check,
 * or the call fails in ANY way, a deterministic motivation built from the
 * status counts is used instead: the judging call is already paid and must
 * never be thrown away because of this step.
 */

// ---------------------------------------------------------------------------
// Request / answer
// ---------------------------------------------------------------------------

/**
 * The answer schema: strict, non-empty, trimmed. `.trim()` runs before
 * `.min(1)`, so an all-whitespace text is empty.
 */
export const MotiveringSvarSchema = z
  .object({ betygMotivering: z.string().trim().min(1, "betygMotivering får inte vara tom.") })
  .strict();

/**
 * Output cap for the rewrite call. The answer is two to four Swedish sentences
 * in a JSON object (about 150-300 tokens); at effort "low" adaptive thinking
 * stays small, so 4000 leaves roughly 3.5k of headroom for it. The judging
 * call needed 16000 only because medium-effort thinking took ~7k of it. A cut
 * off answer is not fatal here (deterministic fallback), so no larger margin
 * is worth paying for in the pre-flight reservation.
 */
export const MOTIVERING_MAX_TOKENS = 4000;

/** The rewrite request from ready-made prompt texts (one attempt, no prompt cache). */
export function byggMotiveringRequestFranPrompt(
  systemText: string,
  userText: string,
  inst: BegarInst,
): SkapaParams {
  const { model, maxTokens, effort } = inst;
  return {
    model,
    max_tokens: maxTokens,
    system: systemText,
    messages: [{ role: "user" as const, content: userText }],
    ...(effort ? { output_config: { effort } } : {}),
  };
}

/** The rewrite request for a given underlag. */
export function byggMotiveringRequest(underlag: MotiveringsUnderlag, inst: BegarInst): SkapaParams {
  return byggMotiveringRequestFranPrompt(
    buildMotiveringSystemPrompt(),
    buildMotiveringUserPrompt(underlag),
    inst,
  );
}

/** The model's parsed JSON from one rewrite answer; throws on a refusal or cut-off. */
export function raMotiveringssvar(svar: SvarMeddelande, maxTokens: number): unknown {
  kontrolleraStoppgrund(svar, "Motiveringen", maxTokens);
  return parseModelJson(svar.content);
}

/** Validates a parsed rewrite answer (strict Zod). Returns the trimmed text. */
export function valideraMotiveringSvar(raw: unknown): Utfall<string> {
  const parsed = MotiveringSvarSchema.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data.betygMotivering }
    : { ok: false, zodError: parsed.error, raw };
}

/** Reads and validates one rewrite answer. A failed validation is returned, not thrown. */
export function tolkaMotiveringSvar(svar: SvarMeddelande, maxTokens: number): Utfall<string> {
  return valideraMotiveringSvar(raMotiveringssvar(svar, maxTokens));
}

// ---------------------------------------------------------------------------
// Deterministic fallback
// ---------------------------------------------------------------------------

const RAKNEORD = ["inget", "ett", "två", "tre", "fyra", "fem", "sex", "sju"];

function antalOrd(n: number): string {
  return RAKNEORD[n] ?? String(n);
}

function lista(poster: readonly string[]): string {
  return poster.join(", ");
}

/**
 * A motivation that states only facts from the status counts. Used when the
 * model's text cannot be trusted and a rewrite did not fix it.
 * Examples: "Betyget C bygger på föreningens sju nyckeltal: två av dem har
 * status svag (Sparande per m² totalyta, Räntekänslighet) och inget har status kritisk."
 */
export function fallbackMotivering(betyg: Grade, fasta: FastaVarden): string {
  const svaga = fasta.nyckeltal.filter((n) => n.status === "svag").map((n) => n.label);
  const kritiska = fasta.nyckeltal.filter((n) => n.status === "kritisk").map((n) => n.label);
  const totalt = antalOrd(fasta.nyckeltal.length);
  const inledning = `Betyget ${betyg} bygger på föreningens ${totalt} nyckeltal:`;

  if (svaga.length === 0 && kritiska.length === 0) {
    return `${inledning} inget av dem har status svag eller kritisk.`;
  }
  const kritiskDel =
    kritiska.length > 0
      ? `${antalOrd(kritiska.length)} har status kritisk (${lista(kritiska)})`
      : "inget har status kritisk";
  const svagDel =
    svaga.length > 0
      ? `${antalOrd(svaga.length)} har status svag (${lista(svaga)})`
      : "inget har status svag";
  // Lead with the more serious status; "av dem" once, on the first clause.
  const [forst, sist] = kritiska.length > 0 ? [kritiskDel, svagDel] : [svagDel, kritiskDel];
  const forstMedAvDem = forst.replace(/^(\S+) har/, "$1 av dem har");
  return `${inledning} ${forstMedAvDem} och ${sist}.`;
}

// ---------------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------------

export type MotiveringsLogg = (...args: unknown[]) => void;

export interface SakraMotiveringInst {
  extraction: ExtractionResult;
  /** The validated judgement with the letter already clamped. */
  judgement: AnalysJudgement;
  /** What the clamp did to the letter, or null when it was inside the band. */
  klampning: BetygKlampning | null;
  /** Injected model call for the rewrite: (system, user) -> parsed JSON. */
  callMotivering: ModelCaller;
  fasta?: FastaVarden;
  logga?: MotiveringsLogg;
}

function beskrivAvvikelser(avvikelser: readonly SiffraAvvikelse[]): string[] {
  return avvikelser.map((a) => a.text);
}

/**
 * Returns the judgement with a `betygMotivering` that fits the final letter and
 * the data. Never throws because of the rewrite (an error from `callMotivering`
 * of any kind — validation, truncation, refusal, cost limit, network — is
 * logged and replaced by the deterministic fallback).
 */
export async function sakraMotivering(inst: SakraMotiveringInst): Promise<AnalysJudgement> {
  const { extraction, judgement, klampning, callMotivering } = inst;
  const logga = inst.logga ?? console.warn;
  const fasta = inst.fasta ?? beraknaFastaVarden(extraction);

  const avvikelser = kontrolleraSiffror(judgement.betygMotivering, extraction, fasta);
  if (klampning === null && avvikelser.length === 0) return judgement;

  const orsaker = {
    klampadFran: klampning?.modellensBetyg,
    avvikandeSiffror: beskrivAvvikelser(avvikelser),
  };
  logga("[motivering] Betygsmotiveringen skrivs om", {
    betyg: judgement.betyg,
    ...orsaker,
    forening: extraction.forening.namn,
    orgnr: extraction.forening.orgnr,
  });

  const fallback = (skal: string, extra?: unknown): AnalysJudgement => {
    logga("[motivering] Använder reservmotivering", {
      skal,
      ...(extra !== undefined ? { extra } : {}),
      betyg: judgement.betyg,
      forening: extraction.forening.namn,
      orgnr: extraction.forening.orgnr,
    });
    return { ...judgement, betygMotivering: fallbackMotivering(judgement.betyg, fasta) };
  };

  try {
    const underlag: MotiveringsUnderlag = {
      betyg: judgement.betyg,
      klampadFran: orsaker.klampadFran,
      avvikandeSiffror: orsaker.avvikandeSiffror,
      fasta,
      rodaFlaggor: judgement.rodaFlaggor.map((f) => ({
        titel: f.titel,
        beskrivning: f.beskrivning,
        severity: f.severity,
      })),
      tidigareMotivering: judgement.betygMotivering,
    };
    const raw = await callMotivering(
      buildMotiveringSystemPrompt(),
      buildMotiveringUserPrompt(underlag),
    );
    const svar = valideraMotiveringSvar(raw);
    if (!svar.ok) return fallback("ogiltigt svar", svar.zodError.issues);

    const kvar = kontrolleraSiffror(svar.value, extraction, fasta);
    if (kvar.length > 0) return fallback("tal stämmer fortfarande inte", beskrivAvvikelser(kvar));
    return { ...judgement, betygMotivering: svar.value };
  } catch (error) {
    return fallback("anropet misslyckades", error instanceof Error ? error.message : String(error));
  }
}
