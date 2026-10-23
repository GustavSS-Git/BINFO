import type { ExtractionResult, Grade, PageRef } from "@/types/analysis";
import type { AnalysJudgement } from "./analyze";
import { berikaNyckeltal, implausibelNegativAnmarkning } from "./benchmarks";
import type { Utfall } from "./extract";
import { kontrolleraRimlighet } from "./rimlighet";
import { buildAnalysJudgementSchema, ExtractionResultSchema } from "./schema";
import { verifieraSidreferenser, type Sidreferensfynd } from "./sidreferenser";
import {
  harledSkuldfriaNyckeltal,
  rensaSkuldfriaKonfidensSkal,
  tolkaNyckeltal,
} from "./tolkaVarde";

/**
 * The shared validator (docs/PLAN-v3.md §3.2): everything that happens to a
 * model answer after the model has spoken. Pure, no API call, no I/O. The
 * production worker (runStructuredExtraction, steg.ts), the sequential CLI
 * composition (korExtraktion.ts) and the bulk importer (bulk validera/importera)
 * all call THESE functions, so a result is judged by one set of rules wherever it
 * was produced.
 *
 * Extraction, in order (`slutforExtraktion`):
 *   1. forbehandlaExtraktionsSvar — strip any model-written `osaker` marker, fill
 *      the fee-inclusion posts the model left out with "okant", override
 *      `datakvalitet.pdfSaknarTextlager` and `.kalla` (known deterministically);
 *   2. valideraExtraktion — Zod (ExtractionResultSchema);
 *   3. avstamExtraktion — tolkaNyckeltal (printed text beats the model's number)
 *      -> harledSkuldfriaNyckeltal -> berikaNyckeltal (grading) ->
 *      kontrolleraRimlighet (sanity checks, `osaker`) -> confidence cap for a
 *      scan -> verifieraSidreferenser (page-reference check, `osaker`).
 *
 * Judging (`slutforBedomning`), in order:
 *   1. Zod with the allowed-pages check — a page that does not occur in the
 *      (verified) extraction is invented by definition;
 *   2. the deterministic grade check — the benchmark status counts of the
 *      extraction's key figures (svag / kritisk) decide which letters A-E are
 *      allowed (`tillatnaBetyg`); a model letter outside the set is clamped to
 *      the nearest allowed letter and logged (`klampaBetyg`). A clamp is not a
 *      validation failure and never triggers a retry. `betygMotivering` is left
 *      as the model wrote it here; analyze.ts regenerates it when the letter was
 *      clamped or its numbers do not match the data (`kontrolleraBedomning`
 *      reports the clamp).
 *
 * `slutforAnalys` composes both for a caller that holds both raw answers (the
 * bulk `validera` command, which re-runs every stored result for free).
 * Production runs the two halves in different stages (the judging prompt needs
 * the finished extraction), each through the function here.
 */

/** The skäl line added to the confidence of a scanned report. */
export const SKANNAD_KONFIDENS_SKAL =
  "Årsredovisningen saknade textlager; siffrorna är avlästa från sidbilder.";

export interface ExtraktionsKontext {
  /** Known deterministically (textlager classification), never the model's claim. */
  pdfSaknarTextlager: boolean;
  /** Where the grounding text came from. 'skannad' caps the confidence at 'medel'. */
  kalla: "textlager" | "skannad";
  /**
   * Page texts (1-based page -> text) for `verifieraSidreferenser`: pdf.js text
   * of a text PDF, the stored transcription of a scan. Omitted/empty = the
   * references are not verified (a caller that cannot read the page texts, or a
   * 'trasigt' text layer whose pdf.js text does not reflect what the model saw).
   */
  sidtexter?: ReadonlyMap<number, string> | undefined;
}

/** Removes every `osaker` key anywhere in the model's raw JSON: only the
 *  deterministic checks (rimlighet.ts, sidreferenser.ts) may mark a figure as
 *  uncertain. */
function stripOsaker(varde: unknown): void {
  if (Array.isArray(varde)) {
    for (const v of varde) stripOsaker(v);
  } else if (varde !== null && typeof varde === "object") {
    const objekt = varde as Record<string, unknown>;
    delete objekt["osaker"];
    for (const v of Object.values(objekt)) stripOsaker(v);
  }
}

/**
 * The model sometimes lists only SOME of the five fee-inclusion posts in
 * `avgiftInkluderarEnligtForening` although the schema requires all five (measured
 * 2026-10-09: it dropped "varme" and "vatten" on a scanned report and burned a retry).
 * A post the model gave no answer for is unknown by definition, so it becomes "okant" —
 * never "nej" (unknown is not false). Mutates `raw`.
 */
export function fyllIOkandaAvgiftsposter(raw: unknown): void {
  if (raw === null || typeof raw !== "object") return;
  const forening = (raw as { forening?: unknown }).forening;
  if (forening === null || typeof forening !== "object") return;
  const poster = (forening as { avgiftInkluderarEnligtForening?: unknown })
    .avgiftInkluderarEnligtForening;
  if (poster === null || typeof poster !== "object" || Array.isArray(poster)) return;
  const objekt = poster as Record<string, unknown>;
  for (const post of ["varme", "vatten", "el", "bredband", "tv"]) {
    if (objekt[post] === undefined) objekt[post] = "okant";
  }
}

/**
 * Step 1: the model's parsed JSON, cleaned of what the model must not decide
 * (`osaker`), filled where it left a known gap and overridden where the answer
 * is known deterministically. Works on a copy: the input is not modified, so a
 * stored raw answer can be re-validated any number of times.
 */
export function forbehandlaExtraktionsSvar(raw: unknown, ctx: ExtraktionsKontext): unknown {
  if (raw === null || typeof raw !== "object") return raw;
  const kopia = structuredClone(raw) as Record<string, unknown>;
  stripOsaker(kopia);
  fyllIOkandaAvgiftsposter(kopia);
  if ("datakvalitet" in kopia) {
    const dk = kopia["datakvalitet"];
    if (dk !== null && typeof dk === "object") {
      (dk as { pdfSaknarTextlager?: unknown }).pdfSaknarTextlager = ctx.pdfSaknarTextlager;
      (dk as { kalla?: unknown }).kalla = ctx.kalla;
    }
  }
  return kopia;
}

/** Step 2: Zod. Model output is untrusted; this is the single schema check. */
export function valideraExtraktion(raw: unknown): Utfall<ExtractionResult> {
  const parsed = ExtractionResultSchema.safeParse(raw);
  // Zod's inferred optional-field type allows an explicit `undefined`;
  // exactOptionalPropertyTypes doesn't. The runtime shape is Zod-verified —
  // this reconciles the two type systems, nothing more.
  return parsed.success
    ? { ok: true, value: parsed.data as ExtractionResult }
    : { ok: false, zodError: parsed.error, raw };
}

function kapKonfidensForSkannad(extraction: ExtractionResult): ExtractionResult {
  const konfidens = extraction.datakvalitet.extraktionKonfidens;
  const skal = konfidens.skal ?? [];
  return {
    ...extraction,
    datakvalitet: {
      ...extraction.datakvalitet,
      extraktionKonfidens: {
        niva: konfidens.niva === "hog" ? "medel" : konfidens.niva,
        skal: skal.includes(SKANNAD_KONFIDENS_SKAL) ? skal : [...skal, SKANNAD_KONFIDENS_SKAL],
      },
    },
  };
}

export interface AvstamdExtraktion {
  extraction: ExtractionResult;
  /** One finding per checked reference (empty when no page texts were given). */
  sidreferenser: Sidreferensfynd[];
}

/**
 * Step 3: the deterministic reconciliation of a schema-valid extraction.
 *
 *   1. tolkaNyckeltal — for any figure whose printed cell was not a plain
 *      number (figure.tryckt set), the deterministic parser's reading of that
 *      verbatim text OVERRIDES whatever number the model itself put in
 *      figure.value. A regex over the report's own text is strictly more
 *      trustworthy than the model's own arithmetic on it.
 *   2. harledSkuldfriaNyckeltal — a provably debt-free association
 *      (lanebok.totalSkuld.value === 0) derives 0 for räntekänslighet and both
 *      skuldsättning/m² figures wherever they are still null. Runs BEFORE
 *      berikaNyckeltal so the derived 0s are graded like any other figure.
 *   3. berikaNyckeltal — the prompt always emits status "okant"; the
 *      judgement is deterministic and benchmark-backed, sign-aware.
 *   Any disagreement (the model's number vs. the printed text, an implausible
 *   negative reading) is recorded in datakvalitet.extraktionKonfidens.skal.
 *   4. kontrolleraRimlighet — cross-checks figures against each other and
 *      plausible ranges; marks `osaker`, never hides or changes a value.
 *   5. A scanned report's figures were read off page images: confidence is
 *      capped at 'medel' and says so.
 *   6. verifieraSidreferenser — every cited page checked against the page
 *      text (when given); see sidreferenser.ts.
 */
export function avstamExtraktion(
  extraction: ExtractionResult,
  ctx: Pick<ExtraktionsKontext, "kalla" | "sidtexter">,
): AvstamdExtraktion {
  const { keyFigures: tolkadeNyckeltal, avvikelser: tolkningsAvvikelser } = tolkaNyckeltal(
    extraction.forening.keyFigures,
  );
  const skuldfriaNyckeltal = harledSkuldfriaNyckeltal(
    extraction.forening.lanebok?.totalSkuld,
    tolkadeNyckeltal,
  );
  const gradeadeNyckeltal = berikaNyckeltal(skuldfriaNyckeltal);
  const implausibelaAnmarkningar = gradeadeNyckeltal
    .map((kf) => implausibelNegativAnmarkning(kf))
    .filter((s): s is string => s !== undefined);
  const anmarkningar = [...tolkningsAvvikelser, ...implausibelaAnmarkningar];

  // The model's own "debt figures missing" note is stale once the debt-free
  // rule has filled them in (see rensaSkuldfriaKonfidensSkal).
  const harleddes = skuldfriaNyckeltal.some((kf, i) => kf !== tolkadeNyckeltal[i]);
  const modellensKonfidens = rensaSkuldfriaKonfidensSkal(
    extraction.datakvalitet.extraktionKonfidens,
    harleddes,
  );

  const extraktionKonfidens =
    anmarkningar.length > 0
      ? {
          // A disagreement between the model and the printed text (or an
          // implausible negative reading) is exactly the kind of thing that
          // should visibly lower confidence — but never RAISE it back to
          // "hog" if something else already lowered it further ("lag").
          niva: modellensKonfidens.niva === "hog" ? ("medel" as const) : modellensKonfidens.niva,
          skal: [...(modellensKonfidens.skal ?? []), ...anmarkningar],
        }
      : modellensKonfidens;

  const enrichedExtraction: ExtractionResult = {
    ...extraction,
    forening: {
      ...extraction.forening,
      keyFigures: gradeadeNyckeltal,
    },
    datakvalitet: {
      ...extraction.datakvalitet,
      extraktionKonfidens,
    },
  };

  const { extraction: kontrollerad } = kontrolleraRimlighet(enrichedExtraction);
  const slutlig = ctx.kalla === "skannad" ? kapKonfidensForSkannad(kontrollerad) : kontrollerad;

  if (!ctx.sidtexter || ctx.sidtexter.size === 0) {
    return { extraction: slutlig, sidreferenser: [] };
  }
  const verifierad = verifieraSidreferenser(slutlig, ctx.sidtexter);
  return { extraction: verifierad.extraction, sidreferenser: verifierad.fynd };
}

/** Steps 1-3 on one raw model answer. */
export function slutforExtraktion(
  raw: unknown,
  ctx: ExtraktionsKontext,
): Utfall<AvstamdExtraktion> {
  const validerad = valideraExtraktion(forbehandlaExtraktionsSvar(raw, ctx));
  if (!validerad.ok) return { ok: false, zodError: validerad.zodError, raw };
  return { ok: true, value: avstamExtraktion(validerad.value, ctx) };
}

// ---------------------------------------------------------------------------
// Judging
// ---------------------------------------------------------------------------

function samlaSidor(varde: unknown, sidor: Set<number>): void {
  if (Array.isArray(varde)) {
    for (const post of varde) samlaSidor(post, sidor);
    return;
  }
  if (varde === null || typeof varde !== "object") return;
  for (const [nyckel, undervarde] of Object.entries(varde)) {
    if (
      nyckel === "ref" &&
      undervarde !== null &&
      typeof undervarde === "object" &&
      typeof (undervarde as PageRef).page === "number"
    ) {
      sidor.add((undervarde as PageRef).page);
    }
    samlaSidor(undervarde, sidor);
  }
}

/**
 * Every page number that actually occurs in the extraction. Walks the whole
 * structure rather than enumerating the known ref sites: missing one would
 * mean rejecting a legitimate citation, and the contract may grow more
 * optional refs (it already has several) without this needing an edit.
 */
export function tillatnaSidor(extraction: ExtractionResult): Set<number> {
  const sidor = new Set<number>();
  samlaSidor(extraction, sidor);
  return sidor;
}

const BETYGSORDNING: readonly Grade[] = ["A", "B", "C", "D", "E"];

export interface StatusAntal {
  svag: number;
  kritisk: number;
}

/** Number of key figures graded svag / kritisk (benchmarks.ts sets `status`). */
export function raknaStatusar(extraction: ExtractionResult): StatusAntal {
  let svag = 0;
  let kritisk = 0;
  for (const kf of extraction.forening.keyFigures) {
    if (kf.status === "svag") svag++;
    else if (kf.status === "kritisk") kritisk++;
  }
  return { svag, kritisk };
}

/**
 * Which letters the risk grade may take, from the benchmark status counts
 * (owner decision 2026-10-23, new analyses only):
 *   0 svag, 0 kritisk  -> A, B, C
 *   1 svag, 0 kritisk  -> B, C
 *   >=2 svag, 0 kritisk -> C only
 *   >=1 kritisk        -> C, D, E (the number of svag does not matter)
 * The owner's "C only for a large unfinanced project or thin data" is NOT
 * deterministic and not enforced here; the rubric in prompts.ts (BETYGSSKALA)
 * must stay consistent with these bands.
 */
export function tillatnaBetyg({ svag, kritisk }: StatusAntal): readonly Grade[] {
  if (kritisk >= 1) return ["C", "D", "E"];
  if (svag >= 2) return ["C"];
  if (svag === 1) return ["B", "C"];
  return ["A", "B", "C"];
}

/**
 * The allowed letter nearest to `betyg` in the order A<B<C<D<E. The allowed
 * sets are contiguous, so there is never a tie. A letter already allowed is
 * returned as is.
 */
export function klampaBetyg(betyg: Grade, tillatna: readonly Grade[]): Grade {
  if (tillatna.includes(betyg)) return betyg;
  const index = (g: Grade) => BETYGSORDNING.indexOf(g);
  let narmast: Grade | undefined;
  for (const g of tillatna) {
    if (
      narmast === undefined ||
      Math.abs(index(g) - index(betyg)) < Math.abs(index(narmast) - index(betyg))
    ) {
      narmast = g;
    }
  }
  return narmast ?? betyg;
}

export type BetygLogg = (...args: unknown[]) => void;

/** What the deterministic grade check did to the model's letter. */
export interface BetygKlampning {
  modellensBetyg: Grade;
  nyttBetyg: Grade;
  tillatna: readonly Grade[];
  antal: StatusAntal;
}

/** A validated judgement, plus the clamp that was applied to its letter (null
 *  when the model's letter was inside the allowed set). */
export interface KontrolleradBedomning {
  judgement: AnalysJudgement;
  klampning: BetygKlampning | null;
}

/**
 * The judging answer, validated against the extraction it was written for: an
 * invented KeyFigureId, a page number that is not in the extraction or a
 * 'saknad_uppgift' question fails. `extraction` must be the finished (verified)
 * extraction the judging prompt was built from.
 *
 * Then the grade is checked deterministically (`tillatnaBetyg`): a letter
 * outside the allowed set is clamped and reported through `logga` (default
 * console.warn) and in the returned `klampning`. A clamp is NOT a failure — the
 * result stays ok, so extractWithRetry never re-rolls because of it. The
 * `betygMotivering` is left as the model wrote it (it argued for the unclamped
 * letter): the caller (analyze.ts) decides whether to regenerate it.
 */
export function kontrolleraBedomning(
  extraction: ExtractionResult,
  raw: unknown,
  logga: BetygLogg = console.warn,
): Utfall<KontrolleradBedomning> {
  const parsed = buildAnalysJudgementSchema(tillatnaSidor(extraction)).safeParse(raw);
  // Same reconciliation of Zod's optional types as valideraExtraktion.
  if (!parsed.success) return { ok: false, zodError: parsed.error, raw };
  const bedomning = parsed.data as AnalysJudgement;

  const antal = raknaStatusar(extraction);
  const tillatna = tillatnaBetyg(antal);
  const nyttBetyg = klampaBetyg(bedomning.betyg, tillatna);
  if (nyttBetyg === bedomning.betyg) {
    return { ok: true, value: { judgement: bedomning, klampning: null } };
  }
  logga("[slutfor] Betyg utanför tillåtet intervall, justerat", {
    modellensBetyg: bedomning.betyg,
    nyttBetyg,
    ...antal,
    forening: extraction.forening.namn,
    orgnr: extraction.forening.orgnr,
  });
  return {
    ok: true,
    value: {
      judgement: { ...bedomning, betyg: nyttBetyg },
      klampning: { modellensBetyg: bedomning.betyg, nyttBetyg, tillatna, antal },
    },
  };
}

/** `kontrolleraBedomning` without the clamp metadata (bulk `validera`, tests). */
export function slutforBedomning(
  extraction: ExtractionResult,
  raw: unknown,
  logga: BetygLogg = console.warn,
): Utfall<AnalysJudgement> {
  const r = kontrolleraBedomning(extraction, raw, logga);
  return r.ok ? { ok: true, value: r.value.judgement } : r;
}

export interface SlutfordAnalys {
  extraction: ExtractionResult;
  sidreferenser: Sidreferensfynd[];
  judgement: AnalysJudgement;
}

/**
 * Both halves for a caller that holds both raw answers (bulk `validera`). The
 * judging answer is checked against the extraction AFTER verification, as in
 * production.
 */
export function slutforAnalys(
  extractionRaw: unknown,
  judgementRaw: unknown,
  ctx: ExtraktionsKontext,
): Utfall<SlutfordAnalys> & { steg?: "extraktion" | "bedomning" } {
  const e = slutforExtraktion(extractionRaw, ctx);
  if (!e.ok) return { ...e, steg: "extraktion" };
  const b = slutforBedomning(e.value.extraction, judgementRaw);
  if (!b.ok) return { ...b, steg: "bedomning" };
  return {
    ok: true,
    value: {
      extraction: e.value.extraction,
      sidreferenser: e.value.sidreferenser,
      judgement: b.value,
    },
  };
}
