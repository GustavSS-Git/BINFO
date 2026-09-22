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

// ---------------------------------------------------------------------------
// Konstanter 2026
// ---------------------------------------------------------------------------

export const PBB_2026 = 59_200;
export const IBB_2026 = 83_400;
/** Kommunal skatt (kommun + region), Stockholm. */
export const KOMMUNAL_SKATTESATS = 0.3055;
export const BEGRAVNINGSAVGIFT_SATS = 0.0007;
export const STATLIG_SKATTESATS = 0.2;
export const SKIKTGRANS = 643_000;
export const PUBLIC_SERVICE_SATS = 0.01;
export const PUBLIC_SERVICE_MAX = 1_184;
export const PENSIONSAVGIFT_SATS = 0.07;
/** 8,07 × IBB. */
export const PENSIONSAVGIFT_TAK_INKOMST = 673_038;
export const PENSIONSAVGIFT_GRANS = 25_042;
export const RANTEAVDRAG_BRYTPUNKT = 100_000;
export const RANTEAVDRAG_LAG_SATS = 0.3;
export const RANTEAVDRAG_HOG_SATS = 0.21;

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

/** Grundavdrag, avrundat uppåt till helt hundratal, aldrig över FFI. */
export function grundavdrag(ffi: number): number {
  const p = PBB_2026;
  let ga: number;
  if (ffi <= 0.99 * p) ga = 0.423 * p;
  else if (ffi <= 2.72 * p) ga = 0.423 * p + 0.2 * (ffi - 0.99 * p);
  else if (ffi <= 3.11 * p) ga = 0.77 * p;
  else if (ffi <= 7.88 * p) ga = 0.77 * p - 0.1 * (ffi - 3.11 * p);
  else ga = 0.293 * p;
  return Math.min(uppHundratal(ga), ffi);
}

/** Jobbskatteavdrag före begränsning mot kvarvarande kommunal skatt. */
export function jobbskatteavdragBerakning(ai: number, ga: number): number {
  const p = PBB_2026;
  let underlag: number;
  if (ai <= 0.91 * p) underlag = ai - ga;
  else if (ai <= 3.24 * p) underlag = 0.91 * p + 0.3874 * (ai - 0.91 * p) - ga;
  else if (ai <= 8.08 * p) underlag = 1.813 * p + 0.251 * (ai - 3.24 * p) - ga;
  else underlag = 3.027 * p - ga;
  return Math.max(0, underlag * KOMMUNAL_SKATTESATS);
}

/** Skattereduktion för förvärvsinkomst. */
export function skattereduktionForvarvsinkomst(bfi: number): number {
  if (bfi <= 40_000) return 0;
  if (bfi <= 240_000) return 0.0075 * (bfi - 40_000);
  return 1_500;
}

/**
 * Beräknat ränteavdrag för en person: 30 % upp till 100 000 kr ränta per år,
 * 21 % på överskjutande del. Taket gäller per person, inte per hushåll.
 */
export function beraknatRanteavdrag(rantaPerAr: number): number {
  const ranta = Math.max(0, rantaPerAr);
  const inom = Math.min(ranta, RANTEAVDRAG_BRYTPUNKT);
  const over = Math.max(0, ranta - RANTEAVDRAG_BRYTPUNKT);
  return inom * RANTEAVDRAG_LAG_SATS + over * RANTEAVDRAG_HOG_SATS;
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
  const utrymme = kvarKommunal + kvarStatlig;
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
