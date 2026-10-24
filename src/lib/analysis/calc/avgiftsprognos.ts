/**
 * Expected rise in månadsavgift for ONE flat within the horizon (round
 * 2026-10-24b, docs/avgiftsprognos.md). Pure: all assumptions come from
 * `prognosantaganden.ts`.
 *
 * All BRF amounts are kr/year. The flat's kr/month per component =
 * round(BRF kr/year × andel ÷ 12); the total is the sum of the rounded
 * `beraknad` components. A component without the data it needs is
 * `saknar_underlag`: it adds nothing (missing data never changes the point
 * estimate) and is counted so the price range can widen.
 *
 * Decisions where the spec left room:
 * - Underhåll: without any planned cost WITH an amount the component is
 *   always `saknar_underlag` (a missing plan, `finns: nej` and a plan without
 *   amounts all tell us nothing about the next years); only the wording
 *   differs. With amounts that all fall outside the window → beraknad 0.
 * - Lokaler: a lease without `slutdatum` is treated as not ending; ending
 *   leases without arshyra use hyresintakter ÷ number of leases each.
 * - Assumed refinancing (no maturities): the current rate is snittranta, else
 *   the amount-weighted rate of the listed loans, else räntekostnader ÷ skuld.
 *   `totalSpannVidAntagande` is normalised so lag ≤ hog even when the
 *   refinancing is negative.
 */
import type {
  AvgiftsKomponent,
  Avgiftsprognos,
  Figure,
  Forening,
  Kontrollsummor,
  Lan,
  PageRef,
  Referensranta,
  Refinansieringsunderlag,
  RefinansieringsLan,
  Tristate,
  Tryck,
} from "@/types/analysis";
import {
  BRF_MARGINAL_PROCENT,
  DAG_FOR_FORFALLOAR,
  HORISONT_LANG_MANADER,
  HORISONT_MANADER,
  LOKALHYRA_RISKANDEL,
  MAX_RAPPORTALDER_MANADER,
  MAX_RIMLIG_HOJNING_ANDEL,
  REFINANSIERINGSANDEL_UTAN_FORFALL,
  SENARE_FAS_VIKTER,
  TRYCK_GRANS_GUL,
  TRYCK_GRANS_ROD,
  UNDERHALL_FORDELNING_AR,
} from "./prognosantaganden";
import { beraknaSparbehov, horisontPoster } from "./sparbehov";

export interface AvgiftsprognosInput {
  forening: Forening;
  kontrollsummor?: Kontrollsummor;
  /** The flat's fee, kr/month (buyer input). */
  manadsavgift: number;
  boarea: number;
  referensranta: Referensranta;
  /** YYYY-MM-DD, the horizon starts here. */
  idag: string;
  /** The flat's building year; moves the schablon savings target (sparbehov.ts). */
  byggar?: number;
  /** Hiss counts as a building part only when 'ja'. */
  hiss?: Tristate;
}

export interface AvgiftsprognosResultat {
  prognos: Avgiftsprognos;
  /** BRF debt (kr) that reprices within the horizon; null when unknown. With
   *  missing maturities this is the assumed amount. */
  omsattningsbarSkuld: number | null;
  /** Only when maturities were missing: total kr/month with 0 % and 100 % of
   *  the debt repricing (lag ≤ hog). */
  totalSpannVidAntagande?: { lag: number; hog: number };
  /** Components with status 'saknar_underlag' (each widens the price range). */
  antalSaknadeUnderlag: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function kr(n: number): string {
  return Math.round(Math.abs(n)).toLocaleString("sv-SE");
}

function pct(n: number): string {
  return n.toLocaleString("sv-SE", { maximumFractionDigits: 2 });
}

/** Math.round that never returns -0. */
function avrunda(n: number): number {
  const r = Math.round(n);
  return r === 0 ? 0 : r;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** ISO date + whole months, day clamped to the month's length. */
export function laggTillManader(iso: string, manader: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1;
  const d = Number(iso.slice(8, 10));
  const total = m + manader;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const dagarIManad = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${pad(nm + 1)}-${pad(Math.min(d, dagarIManad))}`;
}

/** Whole months from `fran` to `till` (both YYYY-MM-DD), rounded up. */
function manaderTill(fran: string, till: string): number {
  const m =
    (Number(till.slice(0, 4)) - Number(fran.slice(0, 4))) * 12 +
    (Number(till.slice(5, 7)) - Number(fran.slice(5, 7)));
  return Number(till.slice(8, 10)) > Number(fran.slice(8, 10)) ? m + 1 : m;
}

/** Fee pressure: share of today's fee the rise is. A decrease (or 0) is green;
 *  below TRYCK_GRANS_GUL green, up to and including TRYCK_GRANS_ROD yellow,
 *  above red. null kr/month (or no usable fee for a rise) → undefined. */
export function tryckFor(krPerManad: number | null, manadsavgift: number): Tryck | undefined {
  if (krPerManad === null) return undefined;
  if (krPerManad <= 0) return "gron";
  if (!(manadsavgift > 0)) return undefined;
  const andel = krPerManad / manadsavgift;
  if (andel < TRYCK_GRANS_GUL) return "gron";
  if (andel <= TRYCK_GRANS_ROD) return "gul";
  return "rod";
}

function varde(f: Figure | undefined): number | null {
  return f?.value ?? null;
}

function medRef(ref: PageRef | undefined): { ref: PageRef } | Record<string, never> {
  return ref ? { ref } : {};
}

function komponent(
  k: Omit<AvgiftsKomponent, "krPerManad" | "ref">,
  andel: number | null,
  ref?: PageRef,
): AvgiftsKomponent {
  const krPerManad =
    k.status === "beraknad" && k.foreningKrPerAr !== null && andel !== null
      ? avrunda((k.foreningKrPerAr * andel) / 12)
      : null;
  return { ...k, krPerManad, ...medRef(ref) };
}

// ---------------------------------------------------------------------------
// The flat's share
// ---------------------------------------------------------------------------

function raknaAndel(input: AvgiftsprognosInput): Avgiftsprognos["andel"] {
  const { forening, kontrollsummor, manadsavgift, boarea } = input;
  const rimlig = (v: number): boolean => Number.isFinite(v) && v > 0 && v <= 1;

  const arsavgifter = varde(kontrollsummor?.arsavgifter);
  if (arsavgifter !== null && arsavgifter > 0 && manadsavgift > 0) {
    const a = (manadsavgift * 12) / arsavgifter;
    if (rimlig(a)) return { varde: a, metod: "avgiftsandel" };
  }

  const brfYta = varde(forening.bostadsrattsyta) ?? varde(kontrollsummor?.bostadsrattsyta);
  if (brfYta !== null && brfYta > 0 && boarea > 0) {
    const a = boarea / brfYta;
    if (rimlig(a)) return { varde: a, metod: "ytandel" };
  }

  const skuld = varde(forening.lanebok?.totalSkuld);
  const rk = forening.keyFigures.find((k) => k.id === "rantekanslighet")?.figure.value ?? null;
  if (skuld !== null && skuld > 0 && rk !== null && rk > 0 && manadsavgift > 0) {
    const harleddArsavgifter = skuld / (rk / 100);
    const a = (manadsavgift * 12) / harleddArsavgifter;
    if (rimlig(a)) return { varde: a, metod: "harledd_avgiftsandel" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const MAL_TEXT: Record<string, string> = {
  investeringsbehov: "årsredovisningens investeringsbehov",
  rekommenderad_avsattning: "underhållsplanens rekommenderade avsättning",
  planerade_kostnader: "planerade kostnader i underhållsplanen",
  schablon: "schablon",
};

function sparandegap(
  input: AvgiftsprognosInput,
  andel: number | null,
): {
  komponent: AvgiftsKomponent;
  sparbehov: NonNullable<Avgiftsprognos["sparbehov"]>;
} {
  const { forening } = input;
  const label = "Sparande mot underhållsbehov";
  const r = beraknaSparbehov({
    forening,
    idag: input.idag,
    ...(input.byggar !== undefined ? { byggar: input.byggar } : {}),
    ...(input.hiss !== undefined ? { hiss: input.hiss } : {}),
  });
  const sb = r.sparbehov;
  const ref = sb.sparandeRef;
  if (sb.sparandeKrPerM2 === null) {
    return {
      sparbehov: sb,
      komponent: komponent(
        {
          id: "spargap",
          label,
          status: "saknar_underlag",
          foreningKrPerAr: null,
          forklaring:
            "Årsredovisningen anger inget sparande per kvadratmeter, så vi kan inte jämföra det med behovet.",
        },
        andel,
        ref,
      ),
    };
  }
  if (r.krPerAr === null) {
    return {
      sparbehov: sb,
      komponent: komponent(
        {
          id: "spargap",
          label,
          status: "saknar_underlag",
          foreningKrPerAr: null,
          forklaring: "Föreningens totalyta saknas, så vi kan inte räkna ut glappet i kronor.",
        },
        andel,
        ref,
      ),
    };
  }
  const glapp = sb.glappKrPerM2 as number;
  const uttag =
    !r.planBaserad &&
    forening.sparandeUttag?.planerat === "ja" &&
    forening.sparandeUttag.finansierat === "ja"
      ? " Årsredovisningen beskriver ett planerat, finansierat uttag, vilket inte ändrar schablonen."
      : "";
  const skillnad =
    glapp > 0
      ? `ett glapp på ${kr(glapp)} kr/m²`
      : glapp < 0
        ? `ett överskott på ${kr(glapp)} kr/m²`
        : "ingen skillnad";
  const dampText = sb.dampning < 1 ? `, varav ${pct(sb.dampning * 100)} % räknas med` : "";
  return {
    sparbehov: sb,
    komponent: komponent(
      {
        id: "spargap",
        label,
        status: "beraknad",
        foreningKrPerAr: r.krPerAr,
        forklaring:
          `Behovet är cirka ${kr(sb.malKrPerM2)} kr/m² per år (${MAL_TEXT[sb.malKalla]}), ` +
          `föreningen sparar ${sb.sparandeKrPerM2 < 0 ? "−" : ""}${kr(sb.sparandeKrPerM2)} kr/m², ${skillnad}${dampText}.` +
          uttag,
      },
      andel,
      ref,
    ),
  };
}

interface Lanerad {
  belopp: number;
  ranta: number | null;
  dag?: string;
  rorlig: boolean;
  ref?: PageRef;
}

function laddaLan(forening: Forening): Lanerad[] {
  const lb = forening.lanebok;
  if (!lb) return [];
  if (lb.lan && lb.lan.length > 0) {
    return lb.lan.flatMap((l: Lan) =>
      l.belopp.value === null
        ? []
        : [
            {
              belopp: l.belopp.value,
              ranta: l.ranta?.value ?? null,
              ...(l.villkorsandringsdag ? { dag: l.villkorsandringsdag } : {}),
              rorlig: l.rantetyp === "rorlig",
              ...(l.ref ? { ref: l.ref } : {}),
            },
          ],
    );
  }
  return (lb.forfalloprofil ?? []).flatMap((p) =>
    p.belopp.value === null
      ? []
      : [
          {
            belopp: p.belopp.value,
            ranta: p.ranta?.value ?? null,
            dag: `${p.ar}-${DAG_FOR_FORFALLOAR}`,
            rorlig: false,
            ...(p.belopp.ref ? { ref: p.belopp.ref } : {}),
          },
        ],
  );
}

interface RefinResultat {
  komponent: AvgiftsKomponent;
  omsattningsbarSkuld: number | null;
  underlag?: Refinansieringsunderlag;
  /** Assumed case only: the component's annual association cost when 0 % and
   *  100 % of the debt with unknown timing reprices (for the price range). */
  spannKrPerAr?: { noll: number; hel: number };
  antagen: boolean;
}

function refinansiering(
  input: AvgiftsprognosInput,
  andel: number | null,
  horisontSlut: string,
): RefinResultat {
  const { forening, referensranta } = input;
  const label = "Lån som ska omsättas";
  const lb = forening.lanebok;
  const lan = laddaLan(forening);
  const totalSkuldFigur = lb?.totalSkuld;
  const totalSkuld =
    varde(totalSkuldFigur) ?? (lan.length > 0 ? lan.reduce((s, l) => s + l.belopp, 0) : null);
  const nyRanta = referensranta.procent + BRF_MARGINAL_PROCENT;

  if (totalSkuld === null) {
    return {
      komponent: komponent(
        {
          id: "refinansiering",
          label,
          status: "saknar_underlag",
          foreningKrPerAr: null,
          forklaring: "Årsredovisningen anger inga lån, så vi kan inte räkna på omsättningen.",
        },
        andel,
      ),
      omsattningsbarSkuld: null,
      antagen: false,
    };
  }
  if (varde(totalSkuldFigur) === 0) {
    return {
      komponent: komponent(
        {
          id: "refinansiering",
          label,
          status: "beraknad",
          foreningKrPerAr: 0,
          forklaring: "Föreningen har inga räntebärande lån, så inget lån ska omsättas.",
        },
        andel,
        totalSkuldFigur?.ref,
      ),
      omsattningsbarSkuld: 0,
      antagen: false,
    };
  }

  // A stale report: its loans have most likely been refinanced already.
  const balansdag = forening.balansdag ?? `${forening.rakenskapsar}-12-31`;
  if (laggTillManader(balansdag, MAX_RAPPORTALDER_MANADER) < input.idag) {
    return {
      komponent: komponent(
        {
          id: "refinansiering",
          label,
          status: "saknar_underlag",
          foreningKrPerAr: null,
          forklaring:
            `Årsredovisningen gäller räkenskapsåret som slutade ${balansdag}, mer än ` +
            `${MAX_RAPPORTALDER_MANADER} månader sedan. Lånen har troligen redan omsatts, så vi ` +
            "räknar inte på omsättningen utifrån den.",
        },
        andel,
        totalSkuldFigur?.ref,
      ),
      omsattningsbarSkuld: null,
      antagen: false,
    };
  }

  // Fallback current rate for loans without their own rate.
  const snittranta = varde(lb?.snittranta);
  const rantekostnader = varde(lb?.rantekostnader);
  const harledd =
    rantekostnader !== null && totalSkuld > 0 ? (rantekostnader / totalSkuld) * 100 : null;
  const allmanRanta = snittranta ?? harledd;

  const utanDatum = !lan.some((l) => l.dag !== undefined || l.rorlig);
  if (utanDatum) {
    // Assumed share of the debt reprices; range 0-100 %.
    const viktad = (() => {
      const medRanta = lan.filter((l) => l.ranta !== null);
      const sum = medRanta.reduce((s, l) => s + l.belopp, 0);
      return sum > 0
        ? medRanta.reduce((s, l) => s + l.belopp * (l.ranta as number), 0) / sum
        : null;
    })();
    const nuvarande = snittranta ?? viktad ?? harledd;
    const andelAntagen = REFINANSIERINGSANDEL_UTAN_FORFALL;
    const belopp = avrunda(totalSkuld * andelAntagen);
    const text0 = `Årsredovisningen anger inte när lånen ska omsättas. Vi har antagit att ${pct(andelAntagen * 100)} % av skulden (${kr(belopp)} kr) prissätts om inom ${HORISONT_MANADER} månader.`;
    if (nuvarande === null) {
      return {
        komponent: komponent(
          {
            id: "refinansiering",
            label,
            status: "saknar_underlag",
            foreningKrPerAr: null,
            forklaring: `${text0} Dagens ränta på lånen saknas, så vi kan inte räkna ut vad det kostar.`,
          },
          andel,
          totalSkuldFigur?.ref,
        ),
        omsattningsbarSkuld: belopp,
        antagen: true,
      };
    }
    const helPerAr = (totalSkuld * (nyRanta - nuvarande)) / 100;
    const perAr = avrunda(helPerAr * andelAntagen);
    const underlag: Refinansieringsunderlag = {
      forfallandeBelopp: belopp,
      nuvarandeRantaProcent: Math.round(nuvarande * 100) / 100,
      nyRantaProcent: Math.round(nyRanta * 1000) / 1000,
      referensranta,
      marginalProcent: BRF_MARGINAL_PROCENT,
      antagenAndelProcent: andelAntagen * 100,
      antalLan: lan.length,
    };
    return {
      komponent: komponent(
        {
          id: "refinansiering",
          label,
          status: "beraknad",
          foreningKrPerAr: perAr,
          forklaring:
            `${text0} Räntan går då från ${pct(nuvarande)} % till ${pct(nyRanta)} %, ` +
            `vilket ${perAr < 0 ? "sänker" : "höjer"} föreningens kostnad med cirka ${kr(perAr)} kr per år.`,
        },
        andel,
        totalSkuldFigur?.ref,
      ),
      omsattningsbarSkuld: belopp,
      underlag,
      spannKrPerAr: { noll: 0, hel: avrunda(helPerAr) },
      antagen: true,
    };
  }

  const omsatts = lan.filter((l) => l.rorlig || (l.dag !== undefined && l.dag <= horisontSlut));
  // Later phase (months 25..HORISONT_LANG_MANADER): dated loans only, and only
  // those cheaper than the new rate (a cut that far ahead is never priced).
  const senare = lan.flatMap((l) => {
    if (l.rorlig || l.dag === undefined || l.dag <= horisontSlut) return [];
    const m = manaderTill(input.idag, l.dag);
    if (m > HORISONT_LANG_MANADER) return [];
    const ranta = l.ranta ?? allmanRanta;
    if (ranta === null || ranta >= nyRanta) return [];
    const vikt = SENARE_FAS_VIKTER.find(([till]) => m <= till)?.[1];
    if (vikt === undefined) return [];
    return [{ l, vikt, perAr: (l.belopp * (nyRanta - ranta) * vikt) / 100 }];
  });
  const senarePerAr = senare.reduce((s, x) => s + x.perAr, 0);
  // Debt whose timing is unknown: undated (non-rörlig) loan rows plus any part
  // of the total debt the rows don't cover (beyond a 2 % rounding tolerance).
  // The same assumption as when no maturities exist applies to it.
  const odaterat = lan
    .filter((l) => !l.rorlig && l.dag === undefined)
    .reduce((s, l) => s + l.belopp, 0);
  const lanSumma = lan.reduce((s, l) => s + l.belopp, 0);
  const otackt = totalSkuld - lanSumma > totalSkuld * 0.02 ? totalSkuld - lanSumma : 0;
  const okandTid = odaterat + otackt;
  const okandAntagen = avrunda(okandTid * REFINANSIERINGSANDEL_UTAN_FORFALL);
  const belopp = omsatts.reduce((s, l) => s + l.belopp, 0) + okandAntagen;
  const ref =
    omsatts.find((l) => l.ref)?.ref ?? senare.find((x) => x.l.ref)?.l.ref ?? totalSkuldFigur?.ref;
  if (omsatts.length === 0 && okandTid === 0 && senare.length === 0) {
    return {
      komponent: komponent(
        {
          id: "refinansiering",
          label,
          status: "beraknad",
          foreningKrPerAr: 0,
          forklaring: `Inget lån ska omsättas inom ${HORISONT_MANADER} månader enligt årsredovisningen.`,
        },
        andel,
        ref,
      ),
      omsattningsbarSkuld: 0,
      antagen: false,
    };
  }
  const saknarRanta =
    omsatts.some((l) => (l.ranta ?? allmanRanta) === null) ||
    (okandTid > 0 && allmanRanta === null);
  const viktadNuvarande =
    saknarRanta || belopp === 0
      ? null
      : (omsatts.reduce((s, l) => s + l.belopp * (l.ranta ?? (allmanRanta as number)), 0) +
          okandAntagen * (allmanRanta ?? 0)) /
        belopp;
  const rader: RefinansieringsLan[] = [
    ...omsatts.map((l): RefinansieringsLan => {
      const r = l.ranta ?? allmanRanta;
      return {
        belopp: l.belopp,
        rantaProcent: r,
        ...(l.dag !== undefined ? { dag: l.dag } : {}),
        rorlig: l.rorlig,
        fas: "inom_horisont",
        vikt: 1,
        foreningKrPerAr: r === null ? null : avrunda((l.belopp * (nyRanta - r)) / 100),
        ...(l.ref ? { ref: l.ref } : {}),
      };
    }),
    ...senare.map(({ l, vikt, perAr }): RefinansieringsLan => ({
      belopp: l.belopp,
      rantaProcent: l.ranta ?? allmanRanta,
      ...(l.dag !== undefined ? { dag: l.dag } : {}),
      rorlig: false,
      fas: "senare",
      vikt,
      foreningKrPerAr: avrunda(perAr),
      ...(l.ref ? { ref: l.ref } : {}),
    })),
  ];
  // `forfallandeBelopp`, `nuvarandeRantaProcent` and `antalLan` describe the
  // <= 24-month phase only (UI compatibility); the later phase is in `lan`.
  const underlag: Refinansieringsunderlag = {
    forfallandeBelopp: belopp,
    nuvarandeRantaProcent:
      viktadNuvarande === null ? null : Math.round(viktadNuvarande * 100) / 100,
    nyRantaProcent: Math.round(nyRanta * 1000) / 1000,
    referensranta,
    marginalProcent: BRF_MARGINAL_PROCENT,
    ...(okandTid > 0 ? { antagenAndelProcent: REFINANSIERINGSANDEL_UTAN_FORFALL * 100 } : {}),
    antalLan: omsatts.length,
    lan: rader,
    senareHorisontManader: HORISONT_LANG_MANADER,
  };
  if (saknarRanta) {
    return {
      komponent: komponent(
        {
          id: "refinansiering",
          label,
          status: "saknar_underlag",
          foreningKrPerAr: null,
          forklaring: `${kr(belopp)} kr ska omsättas inom ${HORISONT_MANADER} månader, men räntan på lånen saknas så vi kan inte räkna ut vad det kostar.`,
        },
        andel,
        ref,
      ),
      omsattningsbarSkuld: belopp,
      underlag,
      antagen: false,
    };
  }
  const inomPerAr = omsatts.reduce(
    (s, l) => s + (l.belopp * (nyRanta - (l.ranta ?? (allmanRanta as number)))) / 100,
    0,
  );
  const okandHelPerAr = okandTid > 0 ? (okandTid * (nyRanta - (allmanRanta as number))) / 100 : 0;
  const datadPerAr = inomPerAr + senarePerAr;
  const perAr = avrunda(datadPerAr + okandHelPerAr * REFINANSIERINGSANDEL_UTAN_FORFALL);
  const perArInom = avrunda(inomPerAr + okandHelPerAr * REFINANSIERINGSANDEL_UTAN_FORFALL);
  const okandText =
    okandTid > 0
      ? ` För ${kr(okandTid)} kr av skulden anger årsredovisningen inte när lånen omsätts; där har vi ` +
        `antagit att ${pct(REFINANSIERINGSANDEL_UTAN_FORFALL * 100)} % omsätts inom horisonten.`
      : "";
  const senareText =
    senare.length > 0
      ? ` Dessutom omsätts ${senare.length} ${senare.length === 1 ? "lån" : "lån"} månad ${HORISONT_MANADER + 1}–${HORISONT_LANG_MANADER} till högre ränta; de räknas med minskad vikt och höjer kostnaden med cirka ${kr(senarePerAr)} kr per år.`
      : "";
  const inomText =
    belopp > 0
      ? `${kr(belopp)} kr av lånen ska omsättas inom ${HORISONT_MANADER} månader. ` +
        `Räntan går från i snitt ${pct(underlag.nuvarandeRantaProcent as number)} % till ${pct(nyRanta)} % ` +
        `(${referensranta.namn} ${pct(referensranta.procent)} % plus ${pct(BRF_MARGINAL_PROCENT)} procentenheter), ` +
        `vilket ${perArInom < 0 ? "sänker" : "höjer"} föreningens kostnad med cirka ${kr(perArInom)} kr per år.`
      : `Inget lån ska omsättas inom ${HORISONT_MANADER} månader enligt årsredovisningen.`;
  return {
    komponent: komponent(
      {
        id: "refinansiering",
        label,
        status: "beraknad",
        foreningKrPerAr: perAr,
        forklaring: inomText + okandText + senareText,
      },
      andel,
      ref,
    ),
    omsattningsbarSkuld: belopp,
    underlag,
    antagen: okandTid > 0,
    ...(okandTid > 0
      ? { spannKrPerAr: { noll: avrunda(datadPerAr), hel: avrunda(datadPerAr + okandHelPerAr) } }
      : {}),
  };
}

function underhall(forening: Forening, idag: string, andel: number | null): AvgiftsKomponent {
  const label = "Underhåll utan finansiering";
  const up = forening.underhallsplan;
  const poster = (up?.planeradeKostnader ?? []).filter((p) => p.belopp.value !== null);
  if (poster.length === 0) {
    const forklaring = !up
      ? "Årsredovisningen visar ingen underhållsplan, så vi vet inte vad som väntar."
      : up.finns === "nej"
        ? "Årsredovisningen säger att det inte finns någon underhållsplan, så vi vet inte vad som väntar."
        : (up.kommandeAtgarder?.length ?? 0) > 0
          ? "Årsredovisningen nämner kommande åtgärder men anger inga belopp, så vi kan inte räkna ut vad de kostar."
          : "Årsredovisningen anger inga belopp för kommande underhåll, så vi kan inte räkna ut vad som väntar.";
    return komponent(
      { id: "underhall", label, status: "saknar_underlag", foreningKrPerAr: null, forklaring },
      andel,
      up?.ref,
    );
  }
  // Only items in the 24-month horizon that are unfinanced/unknown; the rest of
  // the plan is in the sparandegap target (sparbehov.ts) so nothing is counted twice.
  const iHorisont = horisontPoster(poster, idag);
  const ofinansierat = iHorisont.reduce((s, p) => s + (p.belopp.value as number), 0);
  const fond = varde(up?.underhallsfond) ?? 0;
  const avsatt = (varde(up?.arligAvsattning) ?? 0) * UNDERHALL_FORDELNING_AR;
  const rest = ofinansierat - fond - avsatt;
  const perAr = rest > 0 ? avrunda(rest / UNDERHALL_FORDELNING_AR) : 0;
  const ref = iHorisont.find((p) => p.ref)?.ref ?? up?.ref;
  return komponent(
    {
      id: "underhall",
      label,
      status: "beraknad",
      foreningKrPerAr: perAr,
      forklaring:
        perAr > 0
          ? `Planerat underhåll på ${kr(ofinansierat)} kr de närmaste ${HORISONT_MANADER} månaderna saknar finansiering. Efter underhållsfond (${kr(fond)} kr) och planerade avsättningar (${kr(avsatt)} kr) återstår ${kr(rest)} kr, fördelat på ${UNDERHALL_FORDELNING_AR} år.`
          : `Det planerade underhållet de närmaste ${HORISONT_MANADER} månaderna verkar täckt av lån, fond, avsättningar eller beslut.`,
    },
    andel,
    ref,
  );
}

function lokaler(
  forening: Forening,
  balansdag: string,
  horisontSlut: string,
  andel: number | null,
): AvgiftsKomponent {
  const label = "Lokalhyror som kan falla bort";
  const lk = forening.lokaler;
  const antal = varde(forening.antalLokaler) ?? 0;
  const hyra = varde(lk?.hyresintakter);
  const kontrakt = lk?.kontrakt ?? [];
  const finnsLokaler = antal > 0 || (hyra ?? 0) > 0 || kontrakt.length > 0;
  if (!finnsLokaler) {
    return komponent(
      {
        id: "lokaler",
        label,
        status: "ej_aktuell",
        foreningKrPerAr: 0,
        forklaring: "Föreningen har inga lokaler som hyrs ut enligt årsredovisningen.",
      },
      andel,
    );
  }
  const ref = lk?.hyresintakter?.ref ?? kontrakt[0]?.ref;
  // Cited zero lokal rent for the year: nothing left that can fall away (the
  // loss, if any, is already in today's accounts and fee).
  if (hyra === 0 && !kontrakt.some((k) => (varde(k.arshyra) ?? 0) > 0)) {
    return komponent(
      {
        id: "lokaler",
        label,
        status: "ej_aktuell",
        foreningKrPerAr: 0,
        forklaring:
          "Lokalerna gav inga hyresintäkter under året, så det finns ingen lokalhyra som kan falla bort.",
      },
      andel,
      ref,
    );
  }
  if (!kontrakt.some((k) => k.slutdatum !== undefined)) {
    return komponent(
      {
        id: "lokaler",
        label,
        status: "saknar_underlag",
        foreningKrPerAr: null,
        forklaring:
          "Föreningen hyr ut lokaler, men årsredovisningen anger inte när hyresavtalen går ut.",
      },
      andel,
      ref,
    );
  }
  const slutar = kontrakt.filter(
    (k) => k.slutdatum !== undefined && k.slutdatum >= balansdag && k.slutdatum <= horisontSlut,
  );
  if (slutar.length === 0) {
    return komponent(
      {
        id: "lokaler",
        label,
        status: "beraknad",
        foreningKrPerAr: 0,
        forklaring: `Inget hyresavtal för lokaler går ut inom ${HORISONT_MANADER} månader enligt årsredovisningen.`,
      },
      andel,
      ref,
    );
  }
  let summa = 0;
  for (const k of slutar) {
    const h = varde(k.arshyra);
    if (h !== null) summa += h;
    else if (hyra !== null) summa += hyra / kontrakt.length;
    else {
      return komponent(
        {
          id: "lokaler",
          label,
          status: "saknar_underlag",
          foreningKrPerAr: null,
          forklaring: `${slutar.length} hyresavtal för lokaler går ut inom ${HORISONT_MANADER} månader, men hyran står inte i årsredovisningen.`,
        },
        andel,
        ref,
      );
    }
  }
  const perAr = avrunda(summa * LOKALHYRA_RISKANDEL);
  return komponent(
    {
      id: "lokaler",
      label,
      status: "beraknad",
      foreningKrPerAr: perAr,
      forklaring:
        `${slutar.length} hyresavtal för lokaler (${kr(summa)} kr i hyra per år) går ut inom ${HORISONT_MANADER} månader. ` +
        `Vi räknar med att ${pct(LOKALHYRA_RISKANDEL * 100)} % av hyran kan falla bort, cirka ${kr(perAr)} kr per år.`,
    },
    andel,
    ref,
  );
}

function energi(forening: Forening, andel: number | null): AvgiftsKomponent {
  const label = "Energiprojekt utan finansiering";
  const projekt = forening.energiprojekt ?? [];
  if (projekt.length === 0) {
    return komponent(
      {
        id: "energi",
        label,
        status: "ej_aktuell",
        foreningKrPerAr: 0,
        forklaring: "Årsredovisningen nämner inga energiprojekt.",
      },
      andel,
    );
  }
  const ref = projekt.find((p) => p.ref)?.ref;
  const osakra = projekt.filter(
    (p) => p.finansierat === "okant" || (p.finansierat === "nej" && varde(p.belopp) === null),
  );
  if (osakra.length > 0) {
    return komponent(
      {
        id: "energi",
        label,
        status: "saknar_underlag",
        foreningKrPerAr: null,
        forklaring:
          "Årsredovisningen nämner energiprojekt, men inte hur de betalas eller vad de kostar.",
      },
      andel,
      ref,
    );
  }
  const summa = projekt
    .filter((p) => p.finansierat === "nej")
    .reduce((s, p) => s + (varde(p.belopp) as number), 0);
  const perAr = avrunda(summa / UNDERHALL_FORDELNING_AR);
  return komponent(
    {
      id: "energi",
      label,
      status: "beraknad",
      foreningKrPerAr: perAr,
      forklaring:
        summa > 0
          ? `Energiprojekt för ${kr(summa)} kr saknar finansiering, fördelat på ${UNDERHALL_FORDELNING_AR} år.`
          : "Energiprojekten som nämns är finansierade.",
    },
    andel,
    ref,
  );
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export function beraknaAvgiftsprognos(input: AvgiftsprognosInput): AvgiftsprognosResultat {
  const { forening, manadsavgift, idag } = input;
  const horisontSlut = laggTillManader(idag, HORISONT_MANADER);
  const balansdag = forening.balansdag ?? `${forening.rakenskapsar}-12-31`;
  const andelObj = raknaAndel(input);
  const andel = andelObj?.varde ?? null;

  const refin = refinansiering(input, andel, horisontSlut);
  const gap = sparandegap(input, andel);
  const komponenter: AvgiftsKomponent[] = [
    gap.komponent,
    refin.komponent,
    underhall(forening, idag, andel),
    lokaler(forening, balansdag, horisontSlut, andel),
    energi(forening, andel),
  ].map((k) => {
    const t = k.status === "beraknad" ? tryckFor(k.krPerManad, manadsavgift) : undefined;
    return t ? { ...k, tryck: t } : k;
  });

  const total =
    andel === null
      ? null
      : komponenter.reduce(
          (s, k) => (k.status === "beraknad" && k.krPerManad !== null ? s + k.krPerManad : s),
          0,
        );

  let totalSpannVidAntagande: { lag: number; hog: number } | undefined;
  if (
    refin.antagen &&
    refin.spannKrPerAr !== undefined &&
    refin.komponent.status === "beraknad" &&
    total !== null &&
    andel !== null
  ) {
    const utanRefin = total - (refin.komponent.krPerManad ?? 0);
    const noll = utanRefin + avrunda((refin.spannKrPerAr.noll * andel) / 12);
    const hel = utanRefin + avrunda((refin.spannKrPerAr.hel * andel) / 12);
    totalSpannVidAntagande = { lag: Math.min(noll, hel), hog: Math.max(noll, hel) };
  }

  const prognos: Avgiftsprognos = {
    horisontManader: HORISONT_MANADER,
    berakningsdatum: idag,
    andel: andelObj,
    komponenter,
    totalKrPerManad: total,
    ...(tryckFor(total, manadsavgift) ? { tryck: tryckFor(total, manadsavgift) as Tryck } : {}),
    sparbehov: gap.sparbehov,
    ...(refin.underlag ? { refinansiering: refin.underlag } : {}),
    ...(total !== null && total > MAX_RIMLIG_HOJNING_ANDEL * manadsavgift
      ? {
          osaker:
            `Den väntade höjningen (${kr(total)} kr i månaden) är mer än ${pct(MAX_RIMLIG_HOJNING_ANDEL * 100)} % av dagens avgift. ` +
            "Det kan bero på att något i årsredovisningen är feltolkat, så siffran är osäker.",
        }
      : {}),
  };

  return {
    prognos,
    omsattningsbarSkuld: refin.omsattningsbarSkuld,
    ...(totalSpannVidAntagande ? { totalSpannVidAntagande } : {}),
    antalSaknadeUnderlag: komponenter.filter((k) => k.status === "saknar_underlag").length,
  };
}
