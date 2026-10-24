/**
 * Savings target ("sparbehov") behind the fee-prognosis component `spargap`
 * (round 2026-10-24c, docs/underhall-referens.md). Pure.
 *
 * Target in kr/m² totalyta per year, first available:
 *  1. `underhallsplan.investeringsbehovPerM2`            (källa investeringsbehov)
 *  2. `underhallsplan.rekommenderadAvsattning` ÷ totalyta (rekommenderad_avsattning)
 *  3. planned costs ÷ years ÷ totalyta                    (planerade_kostnader)
 *     - `planTotal.belopp ÷ planTotal.ar`, else Σ `planeradeKostnader` over the
 *       span min(fran)..max(till) INCLUSIVE (at least 1, at most
 *       PLANKOSTNAD_MAX_AR; if any counted item has no years the span is
 *       PLANKOSTNAD_MAX_AR). Items the narrowed `underhall` component counts
 *       (`horisontPoster`) are excluded so nothing is counted twice; the list
 *       alternative is unusable when nothing is left after the exclusion.
 *  4. the schablon (SPARMAL_SCHABLON_KR_PER_M2) moved within [MIN, MAX] by the
 *     building parts: score = (#eftersatt − #nyligen) ÷ #assessed, target =
 *     300 + (MAX−MIN)/2 × score, rounded to whole kr/m². Hiss only with
 *     `hiss === 'ja'`. Only `genomfordaAtgarder` can make a part 'nyligen'; a
 *     byggår only makes it 'ok' or 'eftersatt'.
 * Plan-based targets count in full (dampning 1), the schablon at
 * SPARMAL_SCHABLON_DAMPNING.
 *
 * Gap = target − sparande (negative = surplus). BRF kr/year = gap × totalyta ×
 * dampning, null when sparande or totalyta is missing. A planned, financed
 * withdrawal (`sparandeUttag`) is NOT an exception any more: with a plan target
 * the plan already contains the withdrawal, with the schablon it is only
 * mentioned in the explanation text (decision 2026-10-24c).
 */
import type {
  Byggdel,
  ByggdelBedomning,
  Figure,
  Forening,
  PageRef,
  PlaneradUnderhallskostnad,
  Sparbehov,
  Tristate,
} from "@/types/analysis";
import {
  BYGGDEL_LIVSLANGD,
  HORISONT_MANADER,
  PLANKOSTNAD_MAX_AR,
  SPARMAL_SCHABLON_DAMPNING,
  SPARMAL_SCHABLON_KR_PER_M2,
  SPARMAL_SCHABLON_MAX,
  SPARMAL_SCHABLON_MIN,
} from "./prognosantaganden";

export interface SparbehovInput {
  forening: Forening;
  /** The flat's building year (buyer input or the report's, decided by the caller). */
  byggar?: number;
  hiss?: Tristate;
  /** YYYY-MM-DD. */
  idag: string;
}

export interface SparbehovResultat {
  sparbehov: Sparbehov;
  /** BRF kr/year (gap × totalyta × dampning, signed); null when sparande or totalyta is missing. */
  krPerAr: number | null;
  /** True for targets 1–3 (the förening's own plan). */
  planBaserad: boolean;
}

const BYGGDELAR: Byggdel[] = ["stambyte", "tak", "fasad", "fonster", "ventilation", "el", "hiss"];

function ar(idag: string): number {
  return Number(idag.slice(0, 4));
}

/** Last calendar year inside the 24-month horizon. */
function horisontSlutAr(idag: string): number {
  const y = Number(idag.slice(0, 4));
  const m = Number(idag.slice(5, 7)) - 1 + HORISONT_MANADER;
  return y + Math.floor(m / 12);
}

/**
 * Planned items the narrowed `underhall` component counts: with an amount,
 * unfinanced or financing unknown, and overlapping idag-year..horizon-end-year
 * (items without any year count, as before). Shared with avgiftsprognos.ts so
 * the two components never disagree.
 */
export function horisontPoster(
  poster: PlaneradUnderhallskostnad[],
  idag: string,
): PlaneradUnderhallskostnad[] {
  const fran = ar(idag);
  const till = horisontSlutAr(idag);
  return poster.filter((p) => {
    if (p.belopp.value === null) return false;
    if (p.finansiering !== "ofinansierad" && p.finansiering !== "okant") return false;
    if (p.fran === undefined && p.till === undefined) return true;
    const lo = p.fran ?? (p.till as number);
    const hi = p.till ?? (p.fran as number);
    return lo <= till && hi >= fran;
  });
}

function bedomaByggdelar(
  forening: Forening,
  byggar: number | undefined,
  hiss: Tristate | undefined,
  idag: string,
): { delar: ByggdelBedomning[]; score: number } {
  const nu = ar(idag);
  const delar: ByggdelBedomning[] = [];
  for (const byggdel of BYGGDELAR) {
    if (byggdel === "hiss" && hiss !== "ja") continue;
    const { label, lag, hog } = BYGGDEL_LIVSLANGD[byggdel];
    const atgarder = (forening.genomfordaAtgarder ?? []).filter((a) => a.byggdel === byggdel);
    const senaste = atgarder.reduce<(typeof atgarder)[number] | null>(
      (best, a) => (best === null || a.ar > best.ar ? a : best),
      null,
    );
    let senast: number | undefined;
    let senastKalla: ByggdelBedomning["senastKalla"] = "okand";
    let ref: PageRef | undefined;
    if (senaste) {
      senast = senaste.ar;
      senastKalla = "atgard";
      ref = senaste.ref;
    } else if (byggar !== undefined) {
      senast = byggar;
      senastKalla = "byggar";
    }
    let status: ByggdelBedomning["status"] = "okant";
    if (senast !== undefined) {
      const alder = nu - senast;
      status =
        senastKalla === "atgard" && alder < lag / 2 ? "nyligen" : alder > hog ? "eftersatt" : "ok";
    }
    delar.push({
      byggdel,
      label,
      ...(senast !== undefined ? { senast } : {}),
      senastKalla,
      livslangd: { lag, hog },
      status,
      ...(ref ? { ref } : {}),
    });
  }
  const bedomda = delar.filter((d) => d.status !== "okant");
  const score =
    bedomda.length === 0
      ? 0
      : (bedomda.filter((d) => d.status === "eftersatt").length -
          bedomda.filter((d) => d.status === "nyligen").length) /
        bedomda.length;
  return { delar, score };
}

function positivt(f: Figure | undefined): number | null {
  // A figure the sanity checks marked osäker is not used as a target.
  return f?.value !== null && f?.value !== undefined && f.value > 0 && !f.osaker ? f.value : null;
}

export function beraknaSparbehov(input: SparbehovInput): SparbehovResultat {
  const { forening, idag } = input;
  const up = forening.underhallsplan;
  const totalyta = (() => {
    const t = forening.totalyta?.value ?? null;
    return t !== null && t > 0 ? t : null;
  })();

  let mal: number | null = null;
  let malKalla: Sparbehov["malKalla"] = "schablon";
  let malRef: PageRef | undefined;
  let byggdelar: ByggdelBedomning[] | undefined;
  let dampning = 1;

  const inv = positivt(up?.investeringsbehovPerM2);
  const rek = positivt(up?.rekommenderadAvsattning);
  if (inv !== null) {
    mal = inv;
    malKalla = "investeringsbehov";
    malRef = up?.investeringsbehovPerM2?.ref;
  } else if (rek !== null && totalyta !== null) {
    mal = rek / totalyta;
    malKalla = "rekommenderad_avsattning";
    malRef = up?.rekommenderadAvsattning?.ref;
  } else if (totalyta !== null) {
    const total = positivt(up?.planTotal?.belopp);
    const arTotal = up?.planTotal?.ar;
    if (total !== null && arTotal !== undefined && arTotal > 0) {
      mal = total / arTotal / totalyta;
      malKalla = "planerade_kostnader";
      malRef = up?.planTotal?.belopp.ref;
    } else {
      const raknade = horisontPoster(up?.planeradeKostnader ?? [], idag);
      const kvar = (up?.planeradeKostnader ?? []).filter(
        (p) => p.belopp.value !== null && !raknade.includes(p),
      );
      const summa = kvar.reduce((s, p) => s + (p.belopp.value as number), 0);
      if (kvar.length > 0 && summa > 0) {
        let span = PLANKOSTNAD_MAX_AR;
        if (kvar.every((p) => p.fran !== undefined || p.till !== undefined)) {
          const lo = Math.min(...kvar.map((p) => (p.fran ?? p.till) as number));
          const hi = Math.max(...kvar.map((p) => (p.till ?? p.fran) as number));
          span = Math.min(PLANKOSTNAD_MAX_AR, Math.max(1, hi - lo + 1));
        }
        mal = summa / span / totalyta;
        malKalla = "planerade_kostnader";
        malRef = kvar.find((p) => p.ref)?.ref;
      }
    }
  }
  if (mal === null) {
    const { delar, score } = bedomaByggdelar(forening, input.byggar, input.hiss, idag);
    const halv = (SPARMAL_SCHABLON_MAX - SPARMAL_SCHABLON_MIN) / 2;
    mal = Math.min(
      SPARMAL_SCHABLON_MAX,
      Math.max(SPARMAL_SCHABLON_MIN, SPARMAL_SCHABLON_KR_PER_M2 + halv * score),
    );
    malKalla = "schablon";
    byggdelar = delar;
    dampning = SPARMAL_SCHABLON_DAMPNING;
  }
  mal = Math.round(mal);

  const sf = forening.keyFigures.find((k) => k.id === "sparande_per_m2_totalyta")?.figure;
  const sparandeVarde = sf?.value ?? null;
  const glapp = sparandeVarde === null ? null : mal - sparandeVarde;
  const krPerAr =
    glapp === null || totalyta === null
      ? null
      : (() => {
          const r = Math.round(glapp * totalyta * dampning);
          return r === 0 ? 0 : r;
        })();

  const sparbehov: Sparbehov = {
    malKrPerM2: mal,
    malKalla,
    ...(malRef ? { malRef } : {}),
    sparandeKrPerM2: sparandeVarde,
    ...(sf?.ref ? { sparandeRef: sf.ref } : {}),
    glappKrPerM2: glapp,
    totalyta,
    dampning,
    ...(byggdelar ? { byggdelar } : {}),
  };
  return { sparbehov, krPerAr, planBaserad: malKalla !== "schablon" };
}
