/**
 * Saved items and the profile (v3, docs/PLAN-v3.md §1.3–1.4): saved
 * valuations, saved bolånekalkyler, the account's analysis list, "ta bort från
 * min lista", the GDPR export. Implementations behind `sparaVarderingFn`,
 * `listaSparatFn`, … in `analysFn.ts`.
 *
 * OWNERSHIP IS DECIDED IN ONE PLACE: `kravAgare`.
 * - `kravAgare(kontext)` returns the logged-in principal's id, or throws
 *   `KontoAtkomstError('ej_inloggad')`. Every function here starts with it.
 * - `kravAgare(kontext, rad)` additionally checks that a row fetched from the
 *   store belongs to that principal and throws `KontoAtkomstError('hittades_inte')`
 *   otherwise — the same answer for "does not exist", "is someone else's" and
 *   "is not a uuid", so an id says nothing about other accounts' data.
 * The store methods also filter on `principal_id` inside the statement
 * (`WHERE id = $1 AND principal_id = $2`), so this is the second lock, not the
 * only one. `skyddad` turns the thrown error into a `KontoFel` result.
 *
 * Nothing is ever read from the client except the INPUT: a saved valuation is
 * recomputed here with the same service the price check uses
 * (`hamtaPrisuppskattning`), never taken as a client-sent result; the kalkyl
 * summary comes from an injected function (the calculator's own, built in W6).
 */

import { z } from "zod";
import type { Grade, PrisInput } from "@/types/analysis";
import {
  KalkylSammanfattningSchema,
  KalkylUnderlagSchema,
  tolkaKalkylUnderlag,
  type KalkylSammanfattning,
  type KalkylUnderlag,
} from "@/lib/kalkyl/underlag";
import { PrisInputSchema, PrisuppskattningResultatSchema } from "@/lib/analysis/schema";
import type { Prisdatakalla } from "@/lib/analysis/prisdata";
import {
  MAX_ETIKETT_TECKEN,
  type AnalysPost,
  type HamtaKopguideSvar,
  type HamtaMinaUppgifterSvar,
  type HamtaSparadKalkylSvar,
  type HamtaSparadVarderingSvar,
  type KontoFel,
  type KontoFelKod,
  type ListaSparatSvar,
  type RaderaSparatSvar,
  type SparaKalkylSvar,
  type SparaKopguideSvar,
  type SparaVarderingSvar,
  type SparadKalkyl,
  type SparadKalkylPost,
  type SparadVardering,
  type SparadVarderingPost,
  type TaBortAnalysFranListaSvar,
  type ForberedSparaAnalysSvar,
  type HamtaSparstatusSvar,
  type SparaAnalysSvar,
} from "@/lib/kontoTyper";
import { MAX_KLARA, normaliseraKlara } from "@/lib/kopguide/framsteg";
import { kontoFel } from "./fel";
import type { Kontext, KontextKallor } from "./kontext";
import type {
  AnalysListrad,
  KontoDatabas,
  SparadKalkylRad,
  SparadVarderingListrad,
  SparadVarderingRad,
} from "./kontoPortar";
import { kontrolleraPrisuppskattningskvot } from "./kvot";
import { hamtaPrisuppskattning } from "./prisuppskattning";
import { lasSparaMarke, rensaSparaMarke, sattSparaMarke } from "./sessionCookies";

/** Per account and kind. A safety limit against storage abuse, not a product
 *  fact; change it here. */
export const MAX_SPARADE_PER_TYP = 200;

/** A saved calculator state is a few hundred bytes; this only stops abuse. */
export const MAX_KALKYL_JSON_TECKEN = 20_000;

export interface SparatBeroenden {
  kontext: Kontext;
  db: KontoDatabas;
  /** Overrides the valuation data source (tests). */
  prisdatakalla?: Prisdatakalla;
  nu?: () => Date;
}

/** What `sparaKalkyl` needs from the calculator library (built in W6). */
export interface KalkylBeroenden {
  /** `beraknaKalkyl(...)` reduced to the list-view figures. Must be pure. */
  beraknaSammanfattning: (underlag: KalkylUnderlag) => KalkylSammanfattning;
  /** The rules-registry version the summary was computed with. */
  regelversion: string;
}

// ---------------------------------------------------------------------------
// kravAgare — the one ownership check
// ---------------------------------------------------------------------------

export class KontoAtkomstError extends Error {
  constructor(public readonly felKod: Extract<KontoFelKod, "ej_inloggad" | "hittades_inte">) {
    super(felKod);
    this.name = "KontoAtkomstError";
  }
}

export function kravAgare(kontext: Kontext): string;
export function kravAgare<T extends { principalId: string }>(kontext: Kontext, rad: T | null): T;
export function kravAgare<T extends { principalId: string }>(
  kontext: Kontext,
  ...rad: [] | [T | null]
): string | T {
  if (kontext.konto === undefined || kontext.principalId === null) {
    throw new KontoAtkomstError("ej_inloggad");
  }
  if (rad.length === 0) return kontext.principalId;
  const r = rad[0];
  if (r === null || r === undefined || r.principalId !== kontext.principalId) {
    throw new KontoAtkomstError("hittades_inte");
  }
  return r;
}

/** Runs `fn`, turning a `KontoAtkomstError` into its `KontoFel` result. */
async function skyddad<T>(fn: () => Promise<T>): Promise<T | KontoFel> {
  try {
    return await fn();
  } catch (fel) {
    if (fel instanceof KontoAtkomstError) return kontoFel(fel.felKod);
    throw fel;
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function arObjekt(data: unknown): Record<string, unknown> {
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
}

const IdSchema = z.string().uuid();

/** Trimmed, ≤ 120 characters, no control characters; empty → null. */
const EtikettSchema = z
  .string()
  .trim()
  .max(MAX_ETIKETT_TECKEN)
  // eslint-disable-next-line no-control-regex
  .refine((s) => !/[\u0000-\u001f\u007f]/.test(s))
  .transform((s) => (s === "" ? null : s));

function tolkaId(varde: unknown): string {
  const r = IdSchema.safeParse(varde);
  if (!r.success) throw new KontoAtkomstError("hittades_inte");
  return r.data;
}

// ---------------------------------------------------------------------------
// Reading stored rows (never trusted: parsed with the CURRENT schemas)
// ---------------------------------------------------------------------------

/** Zod's output types optional fields as `T | undefined`; build a PrisInput
 *  without undefined keys (exactOptionalPropertyTypes). */
function tolkaPrisInput(raw: unknown): PrisInput | null {
  const r = PrisInputSchema.safeParse(raw);
  if (!r.success) return null;
  const d = r.data;
  return {
    boarea: d.boarea,
    antalRum: d.antalRum,
    manadsavgift: d.manadsavgift,
    postnummer: d.postnummer,
    ...(d.vaning !== undefined ? { vaning: d.vaning } : {}),
    ...(d.byggar !== undefined ? { byggar: d.byggar } : {}),
    hiss: d.hiss,
    balkong: d.balkong,
    ...(d.utgangspris !== undefined ? { utgangspris: d.utgangspris } : {}),
  };
}

const ExternVarderingSchema = z
  .object({
    value: z.number().finite().nullable(),
    range: z.object({ low: z.number().finite(), high: z.number().finite() }).optional(),
  })
  .passthrough();

function tillVarderingPost(r: SparadVarderingListrad): SparadVarderingPost {
  const v = ExternVarderingSchema.safeParse(r.externVardering);
  return {
    id: r.id,
    etikett: r.etikett,
    skapad: r.skapad,
    modellVersion: r.modellVersion,
    input: tolkaPrisInput(r.input),
    vardering: v.success ? v.data.value : null,
    intervall:
      v.success && v.data.range ? { low: v.data.range.low, high: v.data.range.high } : null,
  };
}

function tillVardering(r: SparadVarderingRad): SparadVardering {
  const resultat = PrisuppskattningResultatSchema.safeParse(r.resultat);
  return {
    id: r.id,
    etikett: r.etikett,
    skapad: r.skapad,
    modellVersion: r.modellVersion,
    input: tolkaPrisInput(r.input),
    // The schema's output differs from the contract type only in how it
    // spells optional keys; it is the contract's own mirror (schema.ts).
    resultat: resultat.success ? (resultat.data as unknown as SparadVardering["resultat"]) : null,
  };
}

function tillKalkylPost(r: SparadKalkylRad): SparadKalkylPost {
  const s = KalkylSammanfattningSchema.safeParse(r.sammanfattning);
  return {
    id: r.id,
    etikett: r.etikett,
    skapad: r.skapad,
    uppdaterad: r.uppdaterad,
    regelversion: r.regelversion,
    sammanfattning: s.success ? s.data : null,
  };
}

function tillKalkyl(r: SparadKalkylRad): SparadKalkyl {
  return { ...tillKalkylPost(r), underlag: tolkaKalkylUnderlag(r.input) };
}

const BETYG: readonly Grade[] = ["A", "B", "C", "D", "E"];

function tillAnalysPost(r: AnalysListrad): AnalysPost {
  const status =
    r.status === "done" ? "klar" : r.status === "failed" ? "misslyckad" : ("pagar" as const);
  const betyg = BETYG.find((g) => g === r.betyg) ?? null;
  return {
    analysisId: r.analysId,
    skapad: r.skapad,
    status,
    foreningNamn: r.foreningNamn,
    orgnr: r.orgnr,
    rakenskapsar: r.rakenskapsar,
    betyg: status === "klar" ? betyg : null,
    adress: r.adress,
    utgangspris: r.utgangspris,
  };
}

// ---------------------------------------------------------------------------
// Valuations
// ---------------------------------------------------------------------------

/**
 * Saves a valuation. `data` = `{ prisInput, etikett? }`. The result snapshot is
 * computed HERE from `prisInput` by the price-check service; the client never
 * supplies one. Counts against the price-check quota (60/hour per network) and
 * the per-account cap.
 */
export async function sparaVardering(
  b: SparatBeroenden,
  data: unknown,
): Promise<SparaVarderingSvar> {
  return skyddad<SparaVarderingSvar>(async () => {
    const principalId = kravAgare(b.kontext);
    const rad = arObjekt(data);

    const etikett = EtikettSchema.optional().safeParse(rad["etikett"]);
    if (!etikett.success) return kontoFel("ogiltig_indata");

    const kvot = await kontrolleraPrisuppskattningskvot(b.db, b.kontext);
    if (!kvot.ok) return kontoFel("kvot");

    if ((await b.db.raknaSparadeVarderingar(principalId)) >= MAX_SPARADE_PER_TYP) {
      return kontoFel("for_manga_sparade");
    }

    const svar = await hamtaPrisuppskattning(rad["prisInput"], {
      ...(b.prisdatakalla ? { prisdatakalla: b.prisdatakalla } : {}),
      ...(b.nu ? { nu: b.nu() } : {}),
    });
    if (!svar.ok) {
      return { ok: false, felKod: "ogiltig_indata", meddelande: svar.errorMessage } as KontoFel;
    }
    const { resultat } = svar;

    const sparad = await b.db.skapaSparadVardering({
      principalId,
      etikett: etikett.data ?? null,
      input: resultat.input,
      resultat,
      modellVersion: resultat.prisanalys.varderingsunderlag?.modellVersion ?? "saknas",
    });
    return { ok: true, vardering: tillVardering(sparad) };
  });
}

export async function hamtaSparadVardering(
  b: SparatBeroenden,
  data: unknown,
): Promise<HamtaSparadVarderingSvar> {
  return skyddad<HamtaSparadVarderingSvar>(async () => {
    const principalId = kravAgare(b.kontext);
    const id = tolkaId(arObjekt(data)["id"]);
    const rad = kravAgare(b.kontext, await b.db.hamtaSparadVardering(id, principalId));
    return { ok: true, vardering: tillVardering(rad) };
  });
}

export async function raderaSparadVardering(
  b: SparatBeroenden,
  data: unknown,
): Promise<RaderaSparatSvar> {
  return skyddad<RaderaSparatSvar>(async () => {
    const principalId = kravAgare(b.kontext);
    const id = tolkaId(arObjekt(data)["id"]);
    // Fetch first so the ownership decision is `kravAgare`'s, then delete with
    // the owner in the statement as well.
    kravAgare(b.kontext, await b.db.hamtaSparadVardering(id, principalId));
    if (!(await b.db.raderaSparadVardering(id, principalId))) {
      return kontoFel("hittades_inte");
    }
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Kalkyler
// ---------------------------------------------------------------------------

/**
 * Saves a bolånekalkyl, or updates one when `id` is given. `data` =
 * `{ underlag, etikett?, id? }`. `underlag` must parse with
 * `KalkylUnderlagSchema` (strict, versioned); the summary is computed by the
 * injected `beraknaSammanfattning` and validated before it is stored. On
 * update an absent `etikett` keeps the current label.
 */
export async function sparaKalkyl(
  b: SparatBeroenden,
  data: unknown,
  kb: KalkylBeroenden,
): Promise<SparaKalkylSvar> {
  return skyddad<SparaKalkylSvar>(async () => {
    const principalId = kravAgare(b.kontext);
    const rad = arObjekt(data);

    const underlag = KalkylUnderlagSchema.safeParse(rad["underlag"]);
    if (!underlag.success) return kontoFel("ogiltig_indata");
    if (JSON.stringify(underlag.data).length > MAX_KALKYL_JSON_TECKEN) {
      return kontoFel("ogiltig_indata");
    }
    const etikett = EtikettSchema.optional().safeParse(rad["etikett"]);
    if (!etikett.success) return kontoFel("ogiltig_indata");

    const sammanfattning = KalkylSammanfattningSchema.safeParse(
      kb.beraknaSammanfattning(underlag.data),
    );
    if (!sammanfattning.success) {
      // A calculator bug, not the user's input: visible failure.
      throw new Error("sparaKalkyl: beraknaSammanfattning gav en ogiltig sammanfattning");
    }

    if (rad["id"] !== undefined && rad["id"] !== null) {
      const id = tolkaId(rad["id"]);
      const befintlig = kravAgare(b.kontext, await b.db.hamtaSparadKalkyl(id, principalId));
      const uppdaterad = await b.db.uppdateraSparadKalkyl(id, principalId, {
        etikett: etikett.data === undefined ? befintlig.etikett : etikett.data,
        input: underlag.data,
        sammanfattning: sammanfattning.data,
        regelversion: kb.regelversion,
      });
      if (uppdaterad === null) return kontoFel("hittades_inte");
      return { ok: true, kalkyl: tillKalkyl(uppdaterad) };
    }

    if ((await b.db.raknaSparadeKalkyler(principalId)) >= MAX_SPARADE_PER_TYP) {
      return kontoFel("for_manga_sparade");
    }
    const ny = await b.db.skapaSparadKalkyl({
      principalId,
      etikett: etikett.data ?? null,
      input: underlag.data,
      sammanfattning: sammanfattning.data,
      regelversion: kb.regelversion,
    });
    return { ok: true, kalkyl: tillKalkyl(ny) };
  });
}

export async function hamtaSparadKalkyl(
  b: SparatBeroenden,
  data: unknown,
): Promise<HamtaSparadKalkylSvar> {
  return skyddad<HamtaSparadKalkylSvar>(async () => {
    const principalId = kravAgare(b.kontext);
    const id = tolkaId(arObjekt(data)["id"]);
    const rad = kravAgare(b.kontext, await b.db.hamtaSparadKalkyl(id, principalId));
    return { ok: true, kalkyl: tillKalkyl(rad) };
  });
}

export async function raderaSparadKalkyl(
  b: SparatBeroenden,
  data: unknown,
): Promise<RaderaSparatSvar> {
  return skyddad<RaderaSparatSvar>(async () => {
    const principalId = kravAgare(b.kontext);
    const id = tolkaId(arObjekt(data)["id"]);
    kravAgare(b.kontext, await b.db.hamtaSparadKalkyl(id, principalId));
    if (!(await b.db.raderaSparadKalkyl(id, principalId))) return kontoFel("hittades_inte");
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// The profile: lists, "ta bort från min lista", GDPR export
// ---------------------------------------------------------------------------

/** The account's analyses, saved valuations and saved kalkyler, newest first. */
export async function listaSparat(b: SparatBeroenden): Promise<ListaSparatSvar> {
  return skyddad<ListaSparatSvar>(async () => {
    const principalId = kravAgare(b.kontext);
    const [analyser, varderingar, kalkyler] = await Promise.all([
      b.db.listaAnalyser(principalId),
      b.db.listaSparadeVarderingar(principalId),
      b.db.listaSparadeKalkyler(principalId),
    ]);
    return {
      ok: true,
      analyser: analyser.map(tillAnalysPost),
      varderingar: varderingar.map(tillVarderingPost),
      kalkyler: kalkyler.map(tillKalkylPost),
    };
  });
}

/**
 * "Ta bort från min lista": deletes the account's OWN `analys` row through
 * `radera_analys`. The rapport, its PDF and the register are never touched;
 * the analysis URL then answers "hittades inte". `data` = `{ analysisId }`.
 */
export async function taBortAnalysFranLista(
  b: SparatBeroenden,
  data: unknown,
): Promise<TaBortAnalysFranListaSvar> {
  return skyddad<TaBortAnalysFranListaSvar>(async () => {
    const principalId = kravAgare(b.kontext);
    const analysisId = tolkaId(arObjekt(data)["analysisId"]);
    const r = await b.db.raderaAnalysFranLista(principalId, analysisId);
    if (!r.borttagen) return kontoFel("hittades_inte");
    if (r.pdfBlevForlorad) {
      // No v2 upload can reach this (every PDF has a rapport_fil row); a
      // legacy row could. PDFs are deleted through the Storage API, never by
      // SQL, and nothing here has a storage client: leave it for the owner.
      console.warn(`[sparat] analys ${analysisId} var sista referensen till sin PDF.`);
    }
    return { ok: true };
  });
}

/** GDPR "Ladda ner mina uppgifter": everything stored about the account. */
export async function hamtaMinaUppgifter(b: SparatBeroenden): Promise<HamtaMinaUppgifterSvar> {
  return skyddad<HamtaMinaUppgifterSvar>(async () => {
    const principalId = kravAgare(b.kontext);
    const exp = await b.db.exporteraPrincipal(principalId);
    if (exp === null) return kontoFel("hittades_inte");
    const epost = b.kontext.konto?.epost ?? "";
    return {
      ok: true,
      uppgifter: {
        exporterad: (b.nu ? b.nu() : new Date()).toISOString(),
        konto: { epost, principalId },
        principaler: exp.principaler,
        analyser: exp.analyser.map((a) => ({
          id: a.id,
          createdAt: a.createdAt,
          rapportId: a.rapportId,
          propertyInput: a.propertyInput,
        })),
        sparadeVarderingar: exp.sparadeVarderingar,
        sparadeKalkyler: exp.sparadeKalkyler,
        kopguide: exp.kopguide,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Köpguidens framsteg (redesign v4, steg 3c)
// ---------------------------------------------------------------------------

const KopguideIndataSchema = z.object({
  klara: z.array(z.string().max(40)).max(MAX_KLARA),
});

/** The account's ticked-off köpguide steps (empty list when none saved). */
export async function hamtaKopguide(b: SparatBeroenden): Promise<HamtaKopguideSvar> {
  return skyddad<HamtaKopguideSvar>(async () => {
    const principalId = kravAgare(b.kontext);
    const klara = (await b.db.lasKopguide(principalId)) ?? [];
    return { ok: true, klara: normaliseraKlara(klara) };
  });
}

/** Replaces the account's progress. `data` = `{ klara: string[] }`; unknown
 *  step ids are dropped, a malformed body is `ogiltig_indata`. */
export async function sparaKopguide(b: SparatBeroenden, data: unknown): Promise<SparaKopguideSvar> {
  return skyddad<SparaKopguideSvar>(async () => {
    const principalId = kravAgare(b.kontext);
    const tolkad = KopguideIndataSchema.safeParse(arObjekt(data));
    if (!tolkad.success) return kontoFel("ogiltig_indata");
    const klara = normaliseraKlara(tolkad.data.klara);
    await b.db.skrivKopguide(principalId, klara);
    return { ok: true, klara };
  });
}

// ---------------------------------------------------------------------------
// "Spara analysen": a logged-out analysis into the account (owner 2026-10-24)
// ---------------------------------------------------------------------------
//
// An analysis made logged out is stored under the browser's device principal
// (`binfo_enhet` → `analys.principal_id`); that is the only ownership proof.
// - Password login already moves it: `loggaIn` merges the device principal
//   into the account (`sakerstall_konto_principal`).
// - A new account confirmed by e-mail link does NOT merge (`bekraftaEpost`:
//   a link proves nothing about the browser) and rotates `binfo_enhet`. For
//   that case `forberedSparaAnalys` checks, while still logged out, that the
//   analysis is this browser's and sets a signed httpOnly marker
//   `{analysisId, devicePrincipalId, exp}` (`binfo_spara`, 7 days). After the
//   login `sparaAnalys` verifies it and moves exactly that one `analys` row
//   (compare-and-set). No re-run, no rapport touched, no API call.
// Every refusal is the same `kan_inte_sparas`, so an id says nothing about
// whose analysis it is.

export interface SparaAnalysBeroenden {
  /** The request's cookie access (the one `kontext` was resolved with). */
  kallor: KontextKallor;
  kontext: Kontext;
  db: KontoDatabas;
  /** PROJECT_SECRET_KEY: the root of the marker key. */
  hemlighet: string;
  nuMs?: () => number;
}

function tolkaAnalysId(data: unknown): string | null {
  const r = IdSchema.safeParse(arObjekt(data)["analysisId"]);
  return r.success ? r.data : null;
}

/** True iff `principalId` is this request's own, unmerged device principal.
 *  Reads only (`hamtaPrincipal`): a plain visit never creates a principal. */
async function arDennaEnhet(b: SparaAnalysBeroenden, principalId: string): Promise<boolean> {
  const p = await b.db.hamtaPrincipal(principalId);
  return (
    p !== null &&
    p.typ === "anonym" &&
    p.sammanslagenTill === null &&
    p.enhetId !== null &&
    p.enhetId === b.kontext.enhetId
  );
}

/** A still-anonymous, unmerged principal (the marker's device principal). */
async function arFriEnhetsprincipal(
  b: SparaAnalysBeroenden,
  principalId: string,
): Promise<boolean> {
  const p = await b.db.hamtaPrincipal(principalId);
  return p !== null && p.typ === "anonym" && p.sammanslagenTill === null;
}

/** The marker if it is valid for exactly this analysis and the analysis is
 *  still on the marker's device principal. */
async function giltigtMarkeFor(
  b: SparaAnalysBeroenden,
  analysisId: string,
  agare: string,
): Promise<boolean> {
  const marke = await lasSparaMarke(b.kallor, b.hemlighet, b.nuMs?.());
  return (
    marke !== null &&
    marke.analysisId === analysisId &&
    marke.enhetsPrincipalId === agare &&
    (await arFriEnhetsprincipal(b, agare))
  );
}

/** What the analysis page shows: saved / can be saved / nothing. */
export async function hamtaSparstatus(
  b: SparaAnalysBeroenden,
  data: unknown,
): Promise<HamtaSparstatusSvar> {
  const analysisId = tolkaAnalysId(data);
  if (analysisId === null) return { status: "ingen" };
  const rad = await b.db.hamtaAnalysAgare(analysisId);
  const agare = rad?.principalId ?? null;
  if (agare === null) return { status: "ingen" };

  const inloggad = b.kontext.konto !== undefined && b.kontext.principalId !== null;
  if (inloggad) {
    if (agare === b.kontext.principalId) return { status: "sparad" };
    return (await giltigtMarkeFor(b, analysisId, agare))
      ? { status: "kan_sparas" }
      : { status: "ingen" };
  }
  return (await arDennaEnhet(b, agare)) ? { status: "kan_sparas" } : { status: "ingen" };
}

/** Logged out, on "Spara analysen": check the analysis is this browser's,
 *  then set the pending-save marker. Logged in and already the owner → ok. */
export async function forberedSparaAnalys(
  b: SparaAnalysBeroenden,
  data: unknown,
): Promise<ForberedSparaAnalysSvar> {
  const analysisId = tolkaAnalysId(data);
  if (analysisId === null) return kontoFel("kan_inte_sparas");
  const agare = (await b.db.hamtaAnalysAgare(analysisId))?.principalId ?? null;
  if (agare === null) return kontoFel("kan_inte_sparas");
  if (b.kontext.konto !== undefined && agare === b.kontext.principalId) return { ok: true };
  if (!(await arDennaEnhet(b, agare))) return kontoFel("kan_inte_sparas");
  await sattSparaMarke(b.kallor, b.hemlighet, { analysisId, enhetsPrincipalId: agare }, b.nuMs?.());
  return { ok: true };
}

/**
 * Logged in: puts the analysis in the account. Already the account's → ok
 * (idempotent; covers the password-login merge). Otherwise only with a valid
 * marker for exactly this analysis whose device principal still owns it: then
 * that one `analys` row moves to the account (compare-and-set). The marker is
 * cleared after a successful save.
 */
export async function sparaAnalys(
  b: SparaAnalysBeroenden,
  data: unknown,
): Promise<SparaAnalysSvar> {
  return skyddad<SparaAnalysSvar>(async () => {
    const konto = kravAgare(b.kontext);
    const analysisId = tolkaAnalysId(data);
    if (analysisId === null) return kontoFel("kan_inte_sparas");
    const agare = (await b.db.hamtaAnalysAgare(analysisId))?.principalId ?? null;
    if (agare === null) return kontoFel("kan_inte_sparas");

    if (agare !== konto) {
      if (!(await giltigtMarkeFor(b, analysisId, agare))) return kontoFel("kan_inte_sparas");
      if (!(await b.db.flyttaAnalys(analysisId, agare, konto))) {
        // Lost a race: fine if the other request saved it to this account.
        const nu = (await b.db.hamtaAnalysAgare(analysisId))?.principalId ?? null;
        if (nu !== konto) return kontoFel("kan_inte_sparas");
      }
    }
    const marke = await lasSparaMarke(b.kallor, b.hemlighet, b.nuMs?.());
    if (marke !== null && marke.analysisId === analysisId) rensaSparaMarke(b.kallor);
    return { ok: true };
  });
}
