/**
 * Central skatteberäkning för inkomstår 2026 — används av /bolanekalkyl.
 *
 * Antaganden (enligt specifikationen för kalkylen):
 * - Låntagarna är under 66 år, all inkomst är lön.
 * - Folkbokförda i Stockholms kommun, ingen kyrkoavgift.
 * - Inga övriga avdrag, inga kapitalinkomster.
 * - Bostadsrätt: ingen fastighetsavgift.
 * - Ränteavdrag ges endast för bolånet; "andra lån" ger inget avdrag.
 * - Bolåneräntan fördelas lika mellan låntagarna.
 *
 * Alla belopp i kronor per år om inget annat anges.
 */

import { ranteavdrag } from "@/lib/analysis/calc/ranteavdrag";
import { andel, tal } from "@/lib/kalkyl/regler";

// ---------------------------------------------------------------------------
// Konstanter 2026
// ---------------------------------------------------------------------------
// Alla värden och källor finns i regelregistret (src/lib/kalkyl/regler.ts),
// som även PDF- och Excel-exporten läser. Verifierade mot Skatteverket, SCB
// och lagtext 2026-10-13; se respektive post för källa och paragraf.

export const PBB_2026 = tal("skatt_pbb");
export const IBB_2026 = tal("skatt_ibb");
/** Kommunal skatt (kommun + region), Stockholm. */
export const KOMMUNAL_SKATTESATS = andel("skatt_kommunal");
export const BEGRAVNINGSAVGIFT_SATS = andel("skatt_begravning");
export const STATLIG_SKATTESATS = andel("skatt_statlig");
export const SKIKTGRANS = tal("skatt_skiktgrans");
export const PUBLIC_SERVICE_SATS = andel("skatt_publicservice_sats");
export const PUBLIC_SERVICE_MAX = tal("skatt_publicservice_tak");
export const PENSIONSAVGIFT_SATS = andel("skatt_pension_sats");
/** 8,07 × IBB. */
export const PENSIONSAVGIFT_TAK_INKOMST = tal("skatt_pension_tak_inkomst");
export const PENSIONSAVGIFT_GRANS = tal("skatt_pension_nedre_grans");
export const RANTEAVDRAG_BRYTPUNKT = tal("ranteavdrag_tak");
export const RANTEAVDRAG_LAG_SATS = andel("ranteavdrag_sats_lag");
export const RANTEAVDRAG_HOG_SATS = andel("ranteavdrag_sats_hog");

// ---------------------------------------------------------------------------
// Hjälpfunktioner
// ---------------------------------------------------------------------------

const nedHundratal = (v: number) => Math.floor(v / 100) * 100;
const uppHundratal = (v: number) => Math.ceil(v / 100) * 100;
/** Närmaste hundratal där exakt 50 avrundas nedåt. */
const narmasteHundratalHalvaNer = (v: number) => -Math.round(-v / 100) * 100;

/** Fastställd förvärvsinkomst: bruttoinkomst nedåt till helt hundratal. */
export function faststalldForvarvsinkomst(bruttoinkomst: number): number {
  return nedHundratal(Math.max(0, bruttoinkomst));
}

/** Grundavdrag (63 kap. 3 § IL), avrundat uppåt till helt hundratal, aldrig över FFI. */
export function grundavdrag(ffi: number): number {
  const p = PBB_2026;
  const g1 = tal("ga_grans_1");
  const g2 = tal("ga_grans_2");
  const g3 = tal("ga_grans_3");
  const g4 = tal("ga_grans_4");
  const bas = tal("ga_bas");
  const topp = tal("ga_topp");
  let ga: number;
  if (ffi <= g1 * p) ga = bas * p;
  else if (ffi <= g2 * p) ga = bas * p + andel("ga_okning") * (ffi - g1 * p);
  else if (ffi <= g3 * p) ga = topp * p;
  else if (ffi <= g4 * p) ga = topp * p - andel("ga_minskning") * (ffi - g3 * p);
  else ga = tal("ga_lagsta") * p;
  return Math.min(uppHundratal(ga), ffi);
}

/** Jobbskatteavdrag (67 kap. 7 § IL) före begränsning mot kvarvarande kommunal skatt. */
export function jobbskatteavdragBerakning(ai: number, ga: number): number {
  const p = PBB_2026;
  const g1 = tal("jsa_grans_1");
  const g2 = tal("jsa_grans_2");
  const g3 = tal("jsa_grans_3");
  let underlag: number;
  if (ai <= g1 * p) underlag = ai - ga;
  else if (ai <= g2 * p) underlag = g1 * p + andel("jsa_sats_2") * (ai - g1 * p) - ga;
  else if (ai <= g3 * p) underlag = tal("jsa_bas_3") * p + andel("jsa_sats_3") * (ai - g2 * p) - ga;
  else underlag = tal("jsa_tak") * p - ga;
  return Math.max(0, underlag * KOMMUNAL_SKATTESATS);
}

/** Skattereduktion för förvärvsinkomster (67 kap. 46–47 §§ IL). */
export function skattereduktionForvarvsinkomst(bfi: number): number {
  const nedre = tal("sf_nedre");
  const ovre = tal("sf_ovre");
  if (bfi <= nedre) return 0;
  if (bfi <= ovre) return andel("sf_sats") * (bfi - nedre);
  return tal("sf_max");
}

/**
 * Beräknat ränteavdrag för en person: 30 % upp till 100 000 kr ränta per år,
 * 21 % på överskjutande del. Taket gäller per person, inte per hushåll. Den
 * enda formeln för ränteavdrag i koden: calc/ranteavdrag.ts.
 */
export function beraknatRanteavdrag(rantaPerAr: number): number {
  return ranteavdrag(Math.max(0, rantaPerAr), 1);
}

// ---------------------------------------------------------------------------
// Per låntagare
// ---------------------------------------------------------------------------

export interface PersonSkatt {
  ffi: number;
  grundavdrag: number;
  bfi: number;
  kommunalSkatt: number;
  statligSkatt: number;
  begravningsavgift: number;
  publicServiceAvgift: number;
  pensionsavgift: number;
  reduktionPensionsavgift: number;
  jobbskatteavdrag: number;
  reduktionForvarvsinkomst: number;
  /** Summa skatt och avgifter före ränteavdrag. */
  slutligSkattUtanRanteavdrag: number;
  nettoinkomstPerAr: number;
  nettoinkomstPerManad: number;
  beraknatRanteavdragPerAr: number;
  faktisktRanteavdragPerAr: number;
  ranteavdragForloratPerAr: number;
}

export function beraknaPersonSkatt(bruttoinkomst: number, bolanerantaPerAr = 0): PersonSkatt {
  const ffi = faststalldForvarvsinkomst(bruttoinkomst);
  const ga = grundavdrag(ffi);
  const bfi = Math.max(0, ffi - ga);

  const kommunalSkatt = Math.floor(bfi * KOMMUNAL_SKATTESATS);
  const begravningsavgift = Math.floor(bfi * BEGRAVNINGSAVGIFT_SATS);
  const statligSkatt = Math.floor(Math.max(0, bfi - SKIKTGRANS) * STATLIG_SKATTESATS);
  const publicServiceAvgift = Math.min(Math.floor(bfi * PUBLIC_SERVICE_SATS), PUBLIC_SERVICE_MAX);
  const pensionsavgift =
    ffi < PENSIONSAVGIFT_GRANS
      ? 0
      : narmasteHundratalHalvaNer(PENSIONSAVGIFT_SATS * Math.min(ffi, PENSIONSAVGIFT_TAK_INKOMST));

  // Reduktionerna tillämpas i fastställd ordning och får aldrig minska
  // begravningsavgift, public service-avgift eller pensionsavgift.
  let kvarKommunal = kommunalSkatt;
  let kvarStatlig = statligSkatt;

  // 1. Reduktion för allmän pensionsavgift — kommunal först, sedan statlig.
  const motKommunal = Math.min(pensionsavgift, kvarKommunal);
  kvarKommunal -= motKommunal;
  const motStatlig = Math.min(pensionsavgift - motKommunal, kvarStatlig);
  kvarStatlig -= motStatlig;
  const reduktionPensionsavgift = motKommunal + motStatlig;

  // 2. Jobbskatteavdrag — endast mot kvarvarande kommunal skatt.
  const jobbskatteavdrag = Math.min(jobbskatteavdragBerakning(ffi, ga), kvarKommunal);
  kvarKommunal -= jobbskatteavdrag;

  // 3. Skattereduktion för förvärvsinkomst — endast mot kommunal skatt.
  const reduktionForvarvsinkomst = Math.min(skattereduktionForvarvsinkomst(bfi), kvarKommunal);
  kvarKommunal -= reduktionForvarvsinkomst;

  // 4. Ränteavdrag — begränsas av kvarvarande kommunal + statlig skatt.
  const beraknat = Math.round(beraknatRanteavdrag(bolanerantaPerAr));
  // Skattereduktion anges i hela krontal, öretal faller bort (67 kap. 1 § IL).
  const utrymme = Math.floor(kvarKommunal + kvarStatlig);
  const faktiskt = Math.min(beraknat, utrymme);
  const forlorat = beraknat - faktiskt;

  const slutligSkattUtanRanteavdrag =
    kommunalSkatt +
    statligSkatt +
    begravningsavgift +
    publicServiceAvgift +
    pensionsavgift -
    reduktionPensionsavgift -
    jobbskatteavdrag -
    reduktionForvarvsinkomst;

  const nettoinkomstPerAr = bruttoinkomst - slutligSkattUtanRanteavdrag;

  return {
    ffi,
    grundavdrag: ga,
    bfi,
    kommunalSkatt,
    statligSkatt,
    begravningsavgift,
    publicServiceAvgift,
    pensionsavgift,
    reduktionPensionsavgift,
    jobbskatteavdrag,
    reduktionForvarvsinkomst,
    slutligSkattUtanRanteavdrag,
    nettoinkomstPerAr,
    nettoinkomstPerManad: nettoinkomstPerAr / 12,
    beraknatRanteavdragPerAr: beraknat,
    faktisktRanteavdragPerAr: faktiskt,
    ranteavdragForloratPerAr: forlorat,
  };
}

// ---------------------------------------------------------------------------
// Hushåll
// ---------------------------------------------------------------------------

export interface HushallSkatt {
  personer: PersonSkatt[];
  nettoinkomstPerManad: number;
  slutligSkattUtanRanteavdragPerAr: number;
  ranteavdragPerAr: number;
  ranteavdragForloratPerAr: number;
}

/**
 * Hela hushållet. `bruttoinkomster` innehåller bara de aktiva låntagarna.
 * Den årliga bolåneräntan fördelas lika mellan dem innan respektive persons
 * ränteavdrag beräknas — outnyttjat avdrag flyttas aldrig mellan personer.
 */
export function beraknaHushallSkatt(
  bruttoinkomster: number[],
  bolanerantaPerAr: number,
): HushallSkatt {
  const antal = Math.max(1, bruttoinkomster.length);
  const rantaPerPerson = Math.max(0, bolanerantaPerAr) / antal;
  const personer = bruttoinkomster.map((b) => beraknaPersonSkatt(b, rantaPerPerson));
  const summa = (f: (p: PersonSkatt) => number) => personer.reduce((a, p) => a + f(p), 0);
  return {
    personer,
    nettoinkomstPerManad: summa((p) => p.nettoinkomstPerManad),
    slutligSkattUtanRanteavdragPerAr: summa((p) => p.slutligSkattUtanRanteavdrag),
    ranteavdragPerAr: summa((p) => p.faktisktRanteavdragPerAr),
    ranteavdragForloratPerAr: summa((p) => p.ranteavdragForloratPerAr),
  };
}
