/**
 * Saved items and the profile (v3, docs/PLAN-v3.md §1.3–1.4): saved
 * valuations, saved bolånekalkyler, the account's analysis list, "ta bort från
 * min lista", the GDPR export. Implementations behind `sparaVarderingFn`,
 * `listaSparatFn`, … in `analysFn.ts` (wired by the supervisor, see
 * docs/v3-wiring/W1.md).
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
  type HamtaMinaUppgifterSvar,
  type HamtaSparadKalkylSvar,
  type HamtaSparadVarderingSvar,
  type KontoFel,
  type KontoFelKod,
  type ListaSparatSvar,
  type RaderaSparatSvar,
  type SparaKalkylSvar,
  type SparaVarderingSvar,
  type SparadKalkyl,
  type SparadKalkylPost,
  type SparadVardering,
  type SparadVarderingPost,
  type TaBortAnalysFranListaSvar,
} from "@/lib/kontoTyper";
import { kontoFel } from "./fel";
import type { Kontext } from "./kontext";
import type {
  AnalysListrad,
  KontoDatabas,
  SparadKalkylRad,
  SparadVarderingListrad,
  SparadVarderingRad,
} from "./kontoPortar";
import { kontrolleraPrisuppskattningskvot } from "./kvot";
import { hamtaPrisuppskattning } from "./prisuppskattning";

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
      },
    };
  });
}
