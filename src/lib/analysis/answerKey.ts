/**
 * The answer-key comparison logic (PIPELINE.md step 5): "exact match for
 * figures stated verbatim in the report; ±1% for anything derived."
 * A missing figure (null) always fails — it can't be verified, so it
 * can't pass, regardless of tolerance.
 */

import type { Tristate } from "@/types/analysis";

export type Tolerans = "exakt" | "ungefar";

export interface FieldComparisonResult {
  falt: string;
  forvantat: number;
  faktiskt: number | null;
  godkand: boolean;
  /** Only set when faktiskt is non-null and tolerans is 'ungefar'. */
  avvikelseProcent?: number;
}

export function jamforVarde(
  falt: string,
  faktiskt: number | null,
  forvantat: number,
  tolerans: Tolerans,
): FieldComparisonResult {
  if (faktiskt === null) {
    return { falt, forvantat, faktiskt, godkand: false };
  }

  if (tolerans === "exakt") {
    return { falt, forvantat, faktiskt, godkand: faktiskt === forvantat };
  }

  const avvikelseProcent = Math.abs(((faktiskt - forvantat) / forvantat) * 100);
  return { falt, forvantat, faktiskt, godkand: avvikelseProcent <= 1, avvikelseProcent };
}

export interface TristateComparisonResult {
  falt: string;
  forvantat: Tristate;
  faktiskt: Tristate | undefined;
  godkand: boolean;
}

export interface TecknComparisonResult {
  falt: string;
  forvantatTecken: "negativ" | "positiv";
  faktisktTecken: "negativ" | "positiv" | undefined;
  faktisktVarde: number | null;
  godkand: boolean;
}

/**
 * Compares a figure's SIGN against an answer-key expectation that only
 * states a sign, not a magnitude — the "neg" case (Volontären's sparande):
 * the report prints no number, so there is no number to compare exactly or
 * approximately, only whether the extraction correctly read the sign. A
 * figure that came back with an actual (non-null) value fails this
 * comparison outright — the report gave no magnitude to compare against,
 * so a non-null result is unverifiable against this answer key, not simply
 * "close enough".
 */
export function jamforTecken(
  falt: string,
  faktisktVarde: number | null,
  faktisktTecken: "negativ" | "positiv" | undefined,
  forvantatTecken: "negativ" | "positiv",
): TecknComparisonResult {
  return {
    falt,
    forvantatTecken,
    faktisktTecken,
    faktisktVarde,
    godkand: faktisktVarde === null && faktisktTecken === forvantatTecken,
  };
}

/**
 * Always exact — a tolerance concept doesn't apply to a categorical
 * ja/nej/okant answer. 'okant' is never treated as equal to 'nej': the
 * whole point of Tristate is that unknown and false are different facts,
 * so the comparison must honor that distinction rather than flatten it.
 */
export function jamforTristate(
  falt: string,
  faktiskt: Tristate | undefined,
  forvantat: Tristate,
): TristateComparisonResult {
  return { falt, forvantat, faktiskt, godkand: faktiskt === forvantat };
}

// ---------------------------------------------------------------------------
// Loan answer keys (fixtures/answer-key-lan/<orgnr>.json, round 2026-10-24b)
// ---------------------------------------------------------------------------

/** One loan as the key's author read it from the loan note. */
export interface LanFacit {
  kreditgivare?: string;
  belopp: number;
  ranta: number;
  villkorsandringsdag: string;
  sida?: number;
  tryckt?: string;
}

/** The parts of a loan answer key that are scored. */
export interface LanFacitFil {
  /** "UTKAST" until the owner has checked the key against the PDF. */
  status?: string;
  balansdag?: string;
  totalSkuld?: { belopp: number };
  rantekostnader?: { belopp: number };
  /** The report says, cited, that the förening has no interest-bearing debt:
   *  `lan` is empty and the extraction's total debt must be 0. */
  skuldfri?: boolean;
  lan: LanFacit[];
}

/** The extraction's loan data, structurally (a subset of `Forening`). */
export interface LanFaktiskt {
  balansdag?: string | undefined;
  lan?:
    | Array<{
        kreditgivare?: string | undefined;
        belopp: { value: number | null };
        ranta?: { value: number | null } | undefined;
        villkorsandringsdag?: string | undefined;
      }>
    | undefined;
  rantekostnader?: { value: number | null } | undefined;
  totalSkuld?: { value: number | null } | undefined;
}

export interface LanPoang {
  falt: string;
  godkand: boolean;
  forvantat: string;
  faktiskt: string;
}

const visa = (v: string | number | null | undefined): string =>
  v === null || v === undefined ? "saknas" : String(v);

/**
 * Scores the extracted loans against a loan answer key: balance date, number of
 * loans, Σ belopp (exact), räntekostnader (exact), and per expected loan its
 * belopp, villkorsändringsdag and ränta. A loan is paired with the unused
 * extracted loan of the same belopp (the one with the same date first); an
 * unpaired loan fails all three of its fields. Missing = fail, as everywhere.
 */
export function poangsattLan(facit: LanFacitFil, faktiskt: LanFaktiskt): LanPoang[] {
  const poang: LanPoang[] = [];
  const ut = faktiskt.lan ?? [];

  if (facit.balansdag !== undefined) {
    poang.push({
      falt: "balansdag",
      godkand: faktiskt.balansdag === facit.balansdag,
      forvantat: facit.balansdag,
      faktiskt: visa(faktiskt.balansdag),
    });
  }
  poang.push({
    falt: "lan.antal",
    godkand: ut.length === facit.lan.length,
    forvantat: String(facit.lan.length),
    faktiskt: String(ut.length),
  });
  const forvantadSumma = facit.lan.reduce((s, l) => s + l.belopp, 0);
  const faktiskSumma = ut.reduce((s, l) => s + (l.belopp.value ?? 0), 0);
  poang.push({
    falt: "lan.summa",
    godkand: (ut.length > 0 || facit.lan.length === 0) && faktiskSumma === forvantadSumma,
    forvantat: String(forvantadSumma),
    faktiskt: ut.length > 0 ? String(faktiskSumma) : facit.lan.length === 0 ? "0" : "saknas",
  });
  if (facit.skuldfri) {
    const v = faktiskt.totalSkuld?.value ?? null;
    poang.push({
      falt: "lanebok.totalSkuld",
      godkand: v === 0,
      forvantat: "0 (skuldfri)",
      faktiskt: visa(v),
    });
  }
  if (facit.rantekostnader !== undefined) {
    const v = faktiskt.rantekostnader?.value ?? null;
    poang.push({
      falt: "lanebok.rantekostnader",
      godkand: v === facit.rantekostnader.belopp,
      forvantat: String(facit.rantekostnader.belopp),
      faktiskt: visa(v),
    });
  }

  const anvanda = new Set<number>();
  for (const forvantat of facit.lan) {
    const kandidater = ut
      .map((l, i) => ({ l, i }))
      .filter(({ l, i }) => !anvanda.has(i) && l.belopp.value === forvantat.belopp);
    const par =
      kandidater.find(({ l }) => l.villkorsandringsdag === forvantat.villkorsandringsdag) ??
      kandidater[0];
    if (par) anvanda.add(par.i);
    const namn = `lan ${forvantat.kreditgivare ?? "?"} ${forvantat.belopp}`;
    poang.push({
      falt: `${namn}: belopp`,
      godkand: par !== undefined,
      forvantat: String(forvantat.belopp),
      faktiskt: par ? String(par.l.belopp.value) : "saknas",
    });
    poang.push({
      falt: `${namn}: villkorsandringsdag`,
      godkand: par?.l.villkorsandringsdag === forvantat.villkorsandringsdag,
      forvantat: forvantat.villkorsandringsdag,
      faktiskt: visa(par?.l.villkorsandringsdag),
    });
    poang.push({
      falt: `${namn}: ranta`,
      godkand: par?.l.ranta?.value === forvantat.ranta,
      forvantat: String(forvantat.ranta),
      faktiskt: visa(par?.l.ranta?.value),
    });
  }
  return poang;
}

// ---------------------------------------------------------------------------
// Maintenance answer keys (fixtures/answer-key-underhall/<orgnr>.json, round
// 2026-10-24c): renovations already done + the plan's investment need
// ---------------------------------------------------------------------------

export interface UnderhallAtgardFacit {
  byggdel: string;
  ar: number;
  /** Replacement or life extension (owner 2026-10-30); scored when set. */
  omfattning?: "byte" | "forlangning";
  sida?: number;
  tryckt?: string;
}

export interface UnderhallFacitFil {
  /** "UTKAST" until the owner has checked the key against the PDF. */
  status?: string;
  /** Renovations the extraction must find (byggdel + year). */
  genomfordaAtgarder: UnderhallAtgardFacit[];
  /** Borderline items that may be extracted without penalty (not required). */
  tillatnaExtra?: UnderhallAtgardFacit[];
  /** null = the report states none: the extraction must not produce one. */
  investeringsbehovPerM2?: { belopp: number } | null;
  rekommenderadAvsattning?: { belopp: number } | null;
  planTotal?: { belopp: number; ar: number } | null;
}

/** The extraction's maintenance data, structurally (a subset of `Forening`). */
export interface UnderhallFaktiskt {
  genomfordaAtgarder?:
    Array<{ byggdel: string; ar: number; omfattning?: string | undefined }> | undefined;
  underhallsplan?:
    | {
        investeringsbehovPerM2?: { value: number | null } | undefined;
        rekommenderadAvsattning?: { value: number | null } | undefined;
        planTotal?: { belopp: { value: number | null }; ar: number } | undefined;
      }
    | undefined;
}

/**
 * Scores the maintenance fields: every expected renovation found (byggdel +
 * year, exact) and, when the key says, whether it is a replacement or a life
 * extension, no extracted renovation outside expected + tillatnaExtra
 * (precision), and per stated figure its value, or null when the key says the
 * report states none (a hallucinated figure fails). Missing = fail.
 */
export function poangsattUnderhall(
  facit: UnderhallFacitFil,
  faktiskt: UnderhallFaktiskt,
): LanPoang[] {
  const poang: LanPoang[] = [];
  const ut = faktiskt.genomfordaAtgarder ?? [];
  const nyckel = (a: { byggdel: string; ar: number }): string => `${a.byggdel} ${a.ar}`;
  const forvantade = new Set(facit.genomfordaAtgarder.map(nyckel));
  const tillatna = new Set([...forvantade, ...(facit.tillatnaExtra ?? []).map(nyckel)]);
  const funna = new Set(ut.map(nyckel));

  for (const a of facit.genomfordaAtgarder) {
    poang.push({
      falt: `atgard ${nyckel(a)}`,
      godkand: funna.has(nyckel(a)),
      forvantat: nyckel(a),
      faktiskt: funna.has(nyckel(a)) ? nyckel(a) : "saknas",
    });
    // Replacement vs life extension: an extracted item without omfattning is a
    // replacement (older extractions); a missing item fails this field too.
    if (a.omfattning) {
      const hittad = ut.find((u) => nyckel(u) === nyckel(a));
      const fick = hittad ? (hittad.omfattning ?? "byte") : "saknas";
      poang.push({
        falt: `atgard ${nyckel(a)} omfattning`,
        godkand: fick === a.omfattning,
        forvantat: a.omfattning,
        faktiskt: fick,
      });
    }
  }
  const overskott = [...funna].filter((n) => !tillatna.has(n));
  poang.push({
    falt: "atgarder.ovriga",
    godkand: overskott.length === 0,
    forvantat: "inga andra än facit",
    faktiskt: overskott.length === 0 ? "inga" : overskott.join(", "),
  });

  const plan = faktiskt.underhallsplan;
  const figurer: Array<[string, { belopp: number } | null | undefined, number | null | undefined]> =
    [
      ["investeringsbehovPerM2", facit.investeringsbehovPerM2, plan?.investeringsbehovPerM2?.value],
      [
        "rekommenderadAvsattning",
        facit.rekommenderadAvsattning,
        plan?.rekommenderadAvsattning?.value,
      ],
    ];
  for (const [namn, forvantat, fick] of figurer) {
    if (forvantat === undefined) continue;
    const faktisktVarde = fick ?? null;
    poang.push({
      falt: namn,
      godkand: forvantat === null ? faktisktVarde === null : faktisktVarde === forvantat.belopp,
      forvantat: forvantat === null ? "ingen" : String(forvantat.belopp),
      faktiskt: visa(faktisktVarde ?? undefined),
    });
  }
  if (facit.planTotal !== undefined) {
    const f = plan?.planTotal;
    const forvantat = facit.planTotal;
    poang.push({
      falt: "planTotal",
      godkand:
        forvantat === null
          ? f === undefined
          : f !== undefined && f.belopp.value === forvantat.belopp && f.ar === forvantat.ar,
      forvantat: forvantat === null ? "ingen" : `${forvantat.belopp} kr / ${forvantat.ar} år`,
      faktiskt: f === undefined ? "saknas" : `${visa(f.belopp.value)} kr / ${f.ar} år`,
    });
  }
  return poang;
}
