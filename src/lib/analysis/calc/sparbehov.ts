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
 * Sparande = average of up to four years (the current key figure plus
 * `forening.sparandeHistorik`, usable figures only; owner 2026-10-29), rounded
 * to whole kr/m²; history alone is never used (no current year → no basis).
 *
 * Gap = target − sparande (negative = surplus), null when sparande or totalyta
 * is missing. Gap ≤ 0: BRF kr/year = gap × totalyta × dampning (today's rule).
 * Gap > 0 (owner 2026-10-29): the part below zero sparande (underskott, D) is
 * paid by the fee in full; the rest (lanebart, G) is borrowed up to the debt
 * ceiling over the horizon: lanat = min(2G, headroom), headroom = (SKULDTAK −
 * skuld/m²) × area, 0 when the debt is unknown. The fee gets D + (G − lanat/2)
 * + lanat × rate (interest only within the horizon); dampning = 1. A planned, financed
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
  SparFinansiering,
  Tristate,
} from "@/types/analysis";
import {
  PLANMAL_MAX_ANDEL_AV_SCHABLON,
  PLANKOSTNAD_MIN_AR,
  PLANMAL_MIN_ANDEL_AV_SCHABLON,
  BYGGDEL_FORLANGNING_AR,
  BYGGDEL_LIVSLANGD,
  HORISONT_MANADER,
  PLANKOSTNAD_MAX_AR,
  SPARMAL_SCHABLON_DAMPNING,
  SPARMAL_SCHABLON_KR_PER_M2,
  SPARMAL_SCHABLON_MAX,
  SPARMAL_SCHABLON_MIN,
  SKULDTAK_KR_PER_M2,
  BRF_MARGINAL_PROCENT,
  REFERENSRANTA_RESERV,
} from "./prognosantaganden";

export interface SparbehovInput {
  forening: Forening;
  /** The flat's building year (buyer input or the report's, decided by the caller). */
  byggar?: number;
  hiss?: Tristate;
  /** YYYY-MM-DD. */
  idag: string;
  /** Rate on newly borrowed money, % (reference rate + margin, as for refinancing).
   *  Defaults to the reserve reference rate + margin. */
  rantaProcent?: number;
}

export interface SparbehovResultat {
  sparbehov: Sparbehov;
  /** BRF kr/year (gap × totalyta × dampning, signed); null when sparande or totalyta is missing. */
  krPerAr: number | null;
  /** True for targets 1–3 (the förening's own plan). */
  planBaserad: boolean;
  /** Totalyta derived as total debt ÷ skuldsättning per m² totalyta (the report states no area). */
  totalytaHarledd: boolean;
  /** A plan-based target that was too low to trust (see PLANMAL_MIN_ANDEL_AV_SCHABLON). */
  forkastatPlanmal?: { malKrPerM2: number; malKalla: Sparbehov["malKalla"] };
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
    const forlangsAr = BYGGDEL_FORLANGNING_AR[byggdel];
    const atgarder = (forening.genomfordaAtgarder ?? []).filter((a) => a.byggdel === byggdel);
    // A life-extending renovation (owner 2026-10-30) never sets the age; a part
    // without an extension figure counts every action as a replacement.
    const arForlangning = (a: (typeof atgarder)[number]): boolean =>
      a.omfattning === "forlangning" && forlangsAr !== undefined;
    const senastAv = (lista: typeof atgarder) =>
      lista.reduce<(typeof atgarder)[number] | null>(
        (best, a) => (best === null || a.ar > best.ar ? a : best),
        null,
      );
    const senaste = senastAv(atgarder.filter((a) => !arForlangning(a)));
    let senast: number | undefined;
    let senastKalla: ByggdelBedomning["senastKalla"] = "okand";
    let ref: PageRef | undefined;
    if (senaste) {
      senast = senaste.ar;
      senastKalla = "atgard";
      ref = senaste.ref;
    } else if (byggar !== undefined && forening.genomfordaAtgarder !== undefined) {
      // Only an extraction that looked for past renovations (PROMPT_VERSION
      // ≥ 10, field present even if empty) can say "never mentioned"; an
      // older one leaves the part unknown.
      senast = byggar;
      senastKalla = "byggar";
    }
    // Only an extension after the last replacement (or the byggår) counts.
    const forl = senastAv(
      atgarder.filter((a) => arForlangning(a) && (senast === undefined || a.ar > senast)),
    );
    const forlangning =
      forl && forlangsAr !== undefined
        ? { ar: forl.ar, tillAr: forl.ar + forlangsAr, ref: forl.ref }
        : undefined;
    const haller = forlangning !== undefined && nu <= forlangning.tillAr;
    let status: ByggdelBedomning["status"] = "okant";
    if (senast !== undefined) {
      const alder = nu - senast;
      status =
        senastKalla === "atgard" && alder < lag / 2
          ? "nyligen"
          : alder > hog && !haller
            ? "eftersatt"
            : "ok";
    } else if (haller) {
      status = "ok";
    }
    delar.push({
      byggdel,
      label,
      ...(senast !== undefined ? { senast } : {}),
      senastKalla,
      livslangd: { lag, hog },
      status,
      ...(ref ? { ref } : {}),
      ...(forlangning ? { forlangning } : {}),
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

function ok(f: Figure | undefined): number | null {
  return f?.value !== null && f?.value !== undefined && f.value >= 0 && !f.osaker ? f.value : null;
}

/** Splits a positive gap into deficit (fee) and borrowable part (interest only). */
function beraknaFinansiering(a: {
  forening: Forening;
  mal: number;
  sparande: number;
  totalyta: number;
  rantaProcent: number;
}): SparFinansiering {
  const { forening, mal, sparande, totalyta, rantaProcent } = a;
  const underskottKrPerM2 = Math.max(0, -sparande);
  const lanebartKrPerM2 = Math.max(0, mal - Math.max(sparande, 0));
  const D = underskottKrPerM2 * totalyta;
  const G = lanebartKrPerM2 * totalyta;
  const kf = (id: string) => forening.keyFigures.find((k) => k.id === id)?.figure;
  let skuld: number | null = null;
  let skuldBas: SparFinansiering["skuldBas"] = null;
  let yta: number | null = null;
  const perTotal = ok(kf("skuldsattning_per_m2_totalyta"));
  if (perTotal !== null) {
    skuld = perTotal;
    skuldBas = "totalyta";
    yta = totalyta;
  } else {
    const perBrf = ok(kf("skuldsattning_per_m2_brf_yta"));
    const brfYta = ok(forening.bostadsrattsyta);
    if (perBrf !== null && brfYta !== null && brfYta > 0) {
      skuld = perBrf;
      skuldBas = "bostadsrattsyta";
      yta = brfYta;
    }
  }
  const headroom =
    skuld !== null && yta !== null ? Math.max(0, SKULDTAK_KR_PER_M2 - skuld) * yta : 0;
  const lanatKr = Math.min(G * 2, headroom);
  return {
    underskottKrPerM2,
    lanebartKrPerM2,
    skuldKrPerM2: skuld,
    skuldBas,
    takKrPerM2: SKULDTAK_KR_PER_M2,
    lanatKr: Math.round(lanatKr),
    rantaProcent,
    krPerArUnderskott: Math.round(D),
    krPerArOlanat: Math.round(G - lanatKr / 2),
    krPerArRanta: Math.round((lanatKr * rantaProcent) / 100),
  };
}

export function beraknaSparbehov(input: SparbehovInput): SparbehovResultat {
  const { forening, idag } = input;
  const up = forening.underhallsplan;
  const angivenTotalyta = (() => {
    const t = forening.totalyta?.value ?? null;
    return t !== null && t > 0 ? t : null;
  })();
  // No stated totalyta: derive it from the two figures the report does state.
  const harleddTotalyta = (() => {
    if (angivenTotalyta !== null) return null;
    const skuld = forening.lanebok?.totalSkuld?.value ?? null;
    const perM2 =
      forening.keyFigures.find((k) => k.id === "skuldsattning_per_m2_totalyta")?.figure.value ??
      null;
    if (skuld === null || skuld <= 0 || perM2 === null || perM2 <= 0) return null;
    const yta = Math.round(skuld / perM2);
    // A misread (tkr vs kr) can give an absurd area; below 100 m² is no BRF.
    return Number.isFinite(yta) && yta >= 100 ? yta : null;
  })();
  const totalyta = angivenTotalyta ?? harleddTotalyta;

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
        (p) => p.belopp.value !== null && !p.belopp.osaker && !raknade.includes(p),
      );
      const summa = kvar.reduce((s, p) => s + (p.belopp.value as number), 0);
      if (kvar.length > 0 && summa > 0) {
        let span = PLANKOSTNAD_MAX_AR;
        if (kvar.every((p) => p.fran !== undefined || p.till !== undefined)) {
          const lo = Math.min(...kvar.map((p) => (p.fran ?? p.till) as number));
          const hi = Math.max(...kvar.map((p) => (p.till ?? p.fran) as number));
          span = Math.min(PLANKOSTNAD_MAX_AR, Math.max(PLANKOSTNAD_MIN_AR, hi - lo + 1));
        }
        mal = summa / span / totalyta;
        malKalla = "planerade_kostnader";
        malRef = kvar.find((p) => p.ref)?.ref;
      }
    }
  }
  let forkastatPlanmal: SparbehovResultat["forkastatPlanmal"];
  if (
    mal !== null &&
    (mal < PLANMAL_MIN_ANDEL_AV_SCHABLON * SPARMAL_SCHABLON_KR_PER_M2 ||
      mal > PLANMAL_MAX_ANDEL_AV_SCHABLON * SPARMAL_SCHABLON_KR_PER_M2)
  ) {
    forkastatPlanmal = { malKrPerM2: Math.round(mal), malKalla };
    mal = null;
    malKalla = "schablon";
    malRef = undefined;
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
  const nuVarde = sf?.value ?? null;
  // Average of up to four years; history is only added to an existing current year.
  const historik =
    nuVarde === null
      ? []
      : (forening.sparandeHistorik ?? [])
          .filter((h) => h.figure.value !== null && !h.figure.osaker)
          .slice(0, 3);
  const sparandeAr: NonNullable<Sparbehov["sparandeAr"]> =
    nuVarde === null || historik.length === 0
      ? []
      : [
          { ar: forening.rakenskapsar, krPerM2: nuVarde, ...(sf?.ref ? { ref: sf.ref } : {}) },
          ...historik.map((h) => ({
            ar: h.ar,
            krPerM2: h.figure.value as number,
            ...(h.figure.ref ? { ref: h.figure.ref } : {}),
          })),
        ];
  const sparandeVarde =
    sparandeAr.length > 0
      ? Math.round(sparandeAr.reduce((s, a) => s + a.krPerM2, 0) / sparandeAr.length) || 0
      : nuVarde;
  const glapp = sparandeVarde === null ? null : mal - sparandeVarde;

  let finansiering: SparFinansiering | undefined;
  let krPerAr: number | null;
  if (glapp === null || totalyta === null) {
    krPerAr = null;
  } else if (glapp > 0 && sparandeVarde !== null) {
    dampning = 1;
    finansiering = beraknaFinansiering({
      forening,
      mal,
      sparande: sparandeVarde,
      totalyta,
      rantaProcent: input.rantaProcent ?? REFERENSRANTA_RESERV.procent + BRF_MARGINAL_PROCENT,
    });
    krPerAr = Math.round(
      finansiering.krPerArUnderskott + finansiering.krPerArOlanat + finansiering.krPerArRanta,
    );
  } else {
    const r = Math.round(glapp * totalyta * dampning);
    krPerAr = r === 0 ? 0 : r;
  }

  const sparbehov: Sparbehov = {
    malKrPerM2: mal,
    malKalla,
    ...(malRef ? { malRef } : {}),
    sparandeKrPerM2: sparandeVarde,
    ...(sf?.ref ? { sparandeRef: sf.ref } : {}),
    ...(sparandeAr.length > 0 ? { sparandeAr } : {}),
    glappKrPerM2: glapp,
    totalyta,
    dampning,
    ...(finansiering ? { finansiering } : {}),
    ...(byggdelar ? { byggdelar } : {}),
  };
  return {
    sparbehov,
    krPerAr,
    planBaserad: malKalla !== "schablon",
    totalytaHarledd: harleddTotalyta !== null,
    ...(forkastatPlanmal ? { forkastatPlanmal } : {}),
  };
}
