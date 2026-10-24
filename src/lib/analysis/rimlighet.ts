import type { ExtractionResult, Figure, KeyFigureId, Kontrollsummor } from "@/types/analysis";

/**
 * Deterministic sanity checks on an extraction (docs/PLAN-v2.md §1.2 item 5).
 * Pure: no model call, no input mutation. Runs on both the text and the scan
 * path, after tolkaNyckeltal -> harledSkuldfria -> berika.
 *
 * A failing check NEVER hides a figure: it sets `figure.osaker` (plain Swedish,
 * rendered next to an "osäker" marker), adds a line to the confidence `skal`,
 * and lowers the confidence ONE level for the whole run (hog -> medel, medel ->
 * lag, lag stays; never raises). assemble.ts turns every key figure with an
 * `osaker` into a question for the board.
 *
 * Every check is skipped when any of its inputs is missing (null, absent or
 * zero where a division needs it): a missing input is not evidence of a wrong
 * figure. Missing values stay missing.
 *
 * Tolerances below are product choices, not market facts.
 */

// Product tolerance (supervisor, 2026-10-09), not a market fact
const BALANS_TOLERANS = 0.01;
// Product tolerance (supervisor, 2026-10-09), not a market fact.
// Wider than the others because the printed räntekänslighet is rounded (e.g.
// Ängsknarren prints the integer 6 for 90 000 000 / 13 900 000 = 6.47).
const RANTEKANSLIGHET_TOLERANS = 0.15;
// Product tolerance (supervisor, 2026-10-09), not a market fact. Wide on
// purpose: what a report books as "årsavgifter" varies (lokaler, extra
// charges), so this check only exists to catch gross misreads such as tkr vs
// kr. 10 % gave a false alarm on a verified figure (Albohem: 834 kr/m² ×
// 1 205 m² vs 862 812 kr fee income, 16.5 % apart).
const ARSAVGIFT_TOLERANS = 0.25;
// Product tolerance (supervisor, 2026-10-09), not a market fact
const SKULD_TOLERANS = 0.1;
// Product tolerance (round 2026-10-24b), not a market fact. Tighter than the
// others: the loans of the loan note should add up to the debt total almost to
// the krona (rounding, "senast kända" amounts); 2 % still tolerates a tkr
// rounding of each row.
const LANESUMMA_TOLERANS = 0.02;
// Plausibility guards (round 2026-10-24b), not market facts or benchmarks. Only
// meant to catch a misread (tkr/kr, a dropped decimal, a total from another
// column): räntekostnader / räntebärande skuld, and one loan's ränta in percent.
const RANTEKOSTNAD_ANDEL_INTERVALL = [0, 0.1] as const;
const LANERANTA_INTERVALL = [0, 15] as const;
// Plausibility guard (round 2026-10-24c), not a benchmark: the report's
// "investeringsbehov per m²" (kr/m² totalyta/year). Only catches a misread
// (tkr/kr, a total instead of a per-m² figure).
export const INVESTERINGSBEHOV_INTERVALL = [20, 2_000] as const;

/**
 * Plausible range per nyckeltal [low, high], inclusive. Only meant to catch a
 * factor-1000 slip (tkr read as kr or the reverse), a dropped digit or a wrong
 * sign — not to judge the association. Plausibility guard, not a benchmark;
 * derived from the scale of the BENCHMARKS.md thresholds (e.g. årsavgift
 * "kritisk" starts at 1 500 kr/m², skuldsättning at 10 000 kr/m²) with wide
 * margin on both sides.
 */
export const PLAUSIBLA_INTERVALL: Record<KeyFigureId, readonly [number, number]> = {
  // Plausibility guard, not a benchmark
  arsavgift_per_m2_brf_yta: [50, 5_000],
  // Plausibility guard, not a benchmark
  arsavgift_andel_av_rorelseintakter: [0, 100],
  // Plausibility guard, not a benchmark
  skuldsattning_per_m2_totalyta: [0, 60_000],
  // Plausibility guard, not a benchmark
  skuldsattning_per_m2_brf_yta: [0, 60_000],
  // Plausibility guard, not a benchmark
  sparande_per_m2_totalyta: [-5_000, 5_000],
  // Plausibility guard, not a benchmark
  rantekanslighet: [0, 60],
  // Plausibility guard, not a benchmark
  energikostnad_per_m2_totalyta: [0, 1_500],
};

const ENHET_TEXT: Record<KeyFigureId, string> = {
  arsavgift_per_m2_brf_yta: "kr/m²",
  arsavgift_andel_av_rorelseintakter: "%",
  skuldsattning_per_m2_totalyta: "kr/m²",
  skuldsattning_per_m2_brf_yta: "kr/m²",
  sparande_per_m2_totalyta: "kr/m²",
  rantekanslighet: "%",
  energikostnad_per_m2_totalyta: "kr/m²",
};

const NYCKELTAL_NAMN: Record<KeyFigureId, string> = {
  arsavgift_per_m2_brf_yta: "Årsavgift per m²",
  arsavgift_andel_av_rorelseintakter: "Årsavgifternas andel av rörelseintäkterna",
  skuldsattning_per_m2_totalyta: "Skuldsättning per m² totalyta",
  skuldsattning_per_m2_brf_yta: "Skuldsättning per m² bostadsrättsyta",
  sparande_per_m2_totalyta: "Sparande per m² totalyta",
  rantekanslighet: "Räntekänsligheten",
  energikostnad_per_m2_totalyta: "Energikostnad per m² totalyta",
};

const fmt = (n: number): string =>
  n.toLocaleString("sv-SE", { maximumFractionDigits: 2 }).replaceAll(String.fromCharCode(160), " ");

function varde(figure: Figure | undefined): number | null {
  return figure && figure.value !== null && Number.isFinite(figure.value) ? figure.value : null;
}

/** |a - b| / |reference| — undefined for a reference of 0 (no relative scale). */
function relativAvvikelse(varden: number, referens: number): number | null {
  if (referens === 0) return null;
  return Math.abs(varden - referens) / Math.abs(referens);
}

interface Fynd {
  anmarkning: string;
  /** Where the `osaker` marker goes, with its text. */
  markera: Array<
    | { typ: "nyckeltal"; id: KeyFigureId; text: string }
    | { typ: "summa"; nyckel: keyof Kontrollsummor; text: string }
    | { typ: "totalSkuld"; text: string }
    | { typ: "rantekostnader"; text: string }
    | { typ: "lanranta"; index: number; text: string }
    | { typ: "investeringsbehov"; text: string }
  >;
}

const procentText = (andel: number): string => `${fmt(Math.round(andel * 1000) / 10)} %`;

export function kontrolleraRimlighet(extraction: ExtractionResult): {
  extraction: ExtractionResult;
  anmarkningar: string[];
} {
  const fynd: Fynd[] = [];
  const summor = extraction.kontrollsummor;
  const nyckeltalVarde = (id: KeyFigureId): number | null =>
    varde(extraction.forening.keyFigures.find((k) => k.id === id)?.figure);

  // 1. Balance sheet: assets = equity + liabilities.
  const tillgangar = varde(summor?.summaTillgangar);
  const egetKapitalOchSkulder = varde(summor?.summaEgetKapitalOchSkulder);
  if (tillgangar !== null && egetKapitalOchSkulder !== null) {
    const avvikelse = relativAvvikelse(egetKapitalOchSkulder, tillgangar);
    if (avvikelse !== null && avvikelse > BALANS_TOLERANS) {
      const text =
        `Balansräkningen går inte ihop: summa tillgångar ${fmt(tillgangar)} kr mot summa eget kapital ` +
        `och skulder ${fmt(egetKapitalOchSkulder)} kr (skillnad ${procentText(avvikelse)}, ` +
        `högst ${procentText(BALANS_TOLERANS)} väntat).`;
      fynd.push({
        anmarkning: text,
        markera: [
          { typ: "summa", nyckel: "summaTillgangar", text },
          { typ: "summa", nyckel: "summaEgetKapitalOchSkulder", text },
        ],
      });
    }
  }

  const skuld =
    varde(summor?.rantebarandeSkulder) ?? varde(extraction.forening.lanebok?.totalSkuld);
  const arsavgifter = varde(summor?.arsavgifter);
  const bostadsrattsyta = varde(summor?.bostadsrattsyta);

  // 2. Räntekänslighet = interest-bearing debt / annual fees (a ratio, printed as a percent number).
  const rantekanslighet = nyckeltalVarde("rantekanslighet");
  if (rantekanslighet !== null && skuld !== null && arsavgifter !== null && arsavgifter > 0) {
    const forvantad = skuld / arsavgifter;
    const avvikelse = relativAvvikelse(rantekanslighet, forvantad);
    // forvantad 0 (debt-free): only an exact 0 is consistent.
    const avviker =
      avvikelse === null ? rantekanslighet !== 0 : avvikelse > RANTEKANSLIGHET_TOLERANS;
    if (avviker) {
      const text =
        `Räntekänsligheten ${fmt(rantekanslighet)} % stämmer inte med räntebärande skulder ` +
        `(${fmt(skuld)} kr) delat med årsavgifter (${fmt(arsavgifter)} kr), som ger ${fmt(forvantad)} %.`;
      fynd.push({ anmarkning: text, markera: [{ typ: "nyckeltal", id: "rantekanslighet", text }] });
    }
  }

  // 3. Årsavgift/m² x bostadsrättsyta ~ årsavgifter.
  const arsavgiftPerM2 = nyckeltalVarde("arsavgift_per_m2_brf_yta");
  if (arsavgiftPerM2 !== null && bostadsrattsyta !== null && arsavgifter !== null) {
    const produkt = arsavgiftPerM2 * bostadsrattsyta;
    const avvikelse = relativAvvikelse(produkt, arsavgifter);
    if (avvikelse !== null && avvikelse > ARSAVGIFT_TOLERANS) {
      const text =
        `Årsavgift per m² (${fmt(arsavgiftPerM2)} kr) gånger bostadsrättsytan (${fmt(bostadsrattsyta)} m²) ` +
        `blir ${fmt(Math.round(produkt))} kr, men årsavgifterna är ${fmt(arsavgifter)} kr ` +
        `(skillnad ${procentText(avvikelse)}).`;
      fynd.push({
        anmarkning: text,
        markera: [{ typ: "nyckeltal", id: "arsavgift_per_m2_brf_yta", text }],
      });
    }
  }

  // 4. Skuldsättning/m² bostadsrättsyta x bostadsrättsyta ~ räntebärande skulder.
  // Skipped when the basis may be ambiguous: a report that prints only one debt-per-m²
  // figure ("Lån per kvm bostadsyta") is filed under brf_yta with totalyta null, and
  // its area basis need not be the bostadsrättsyta.
  const skuldPerM2Brf = nyckeltalVarde("skuldsattning_per_m2_brf_yta");
  const skuldPerM2Total = nyckeltalVarde("skuldsattning_per_m2_totalyta");
  if (
    skuldPerM2Brf !== null &&
    skuldPerM2Total !== null &&
    bostadsrattsyta !== null &&
    skuld !== null
  ) {
    const produkt = skuldPerM2Brf * bostadsrattsyta;
    const avvikelse = relativAvvikelse(produkt, skuld);
    const avviker = avvikelse === null ? produkt !== 0 : avvikelse > SKULD_TOLERANS;
    if (avviker) {
      const text =
        `Skuldsättning per m² bostadsrättsyta (${fmt(skuldPerM2Brf)} kr) gånger bostadsrättsytan ` +
        `(${fmt(bostadsrattsyta)} m²) blir ${fmt(Math.round(produkt))} kr, men de räntebärande ` +
        `skulderna är ${fmt(skuld)} kr.`;
      fynd.push({
        anmarkning: text,
        markera: [{ typ: "nyckeltal", id: "skuldsattning_per_m2_brf_yta", text }],
      });
    }
  }

  // 5. Plausible ranges (tkr vs kr).
  for (const kf of extraction.forening.keyFigures) {
    const v = varde(kf.figure);
    if (v === null) continue;
    const [lag, hog] = PLAUSIBLA_INTERVALL[kf.id];
    if (v < lag || v > hog) {
      const enhet = ENHET_TEXT[kf.id];
      const text =
        `${NYCKELTAL_NAMN[kf.id]} ${fmt(v)} ${enhet} ligger utanför det rimliga intervallet ` +
        `${fmt(lag)}–${fmt(hog)} ${enhet}. Det kan vara fel enhet (tkr eller kr) eller en felläst siffra.`;
      fynd.push({ anmarkning: text, markera: [{ typ: "nyckeltal", id: kf.id, text }] });
    }
  }

  // 6. The loan note (round 2026-10-24b): Σ loans ~ total debt, räntekostnader
  // ~ a plausible share of the debt, each loan's rate in a plausible range.
  const lanebok = extraction.forening.lanebok;
  const lan = lanebok?.lan ?? [];
  const lanebelopp = lan.map((l) => varde(l.belopp));
  if (lan.length > 0 && lanebelopp.every((b): b is number => b !== null)) {
    const summa = lanebelopp.reduce((s, b) => s + b, 0);
    const total = varde(lanebok?.totalSkuld) ?? skuld;
    if (total !== null) {
      const avvikelse = relativAvvikelse(summa, total);
      const avviker = avvikelse === null ? summa !== 0 : avvikelse > LANESUMMA_TOLERANS;
      if (avviker) {
        const text =
          `Lånen i lånenoten blir tillsammans ${fmt(summa)} kr, men räntebärande skulder är ` +
          `${fmt(total)} kr${avvikelse === null ? "" : ` (skillnad ${procentText(avvikelse)}, högst ${procentText(LANESUMMA_TOLERANS)} väntat)`}.`;
        fynd.push({ anmarkning: text, markera: [{ typ: "totalSkuld", text }] });
      }
    }
  }
  const rantekostnader = varde(lanebok?.rantekostnader);
  if (rantekostnader !== null && skuld !== null && skuld > 0) {
    const andel = rantekostnader / skuld;
    const [lag, hog] = RANTEKOSTNAD_ANDEL_INTERVALL;
    if (andel < lag || andel > hog) {
      const text =
        `Räntekostnaderna ${fmt(rantekostnader)} kr är ${procentText(andel)} av de räntebärande ` +
        `skulderna (${fmt(skuld)} kr), utanför det rimliga intervallet ${procentText(lag)}–${procentText(hog)}. ` +
        "Det kan vara fel enhet eller en felläst siffra.";
      fynd.push({ anmarkning: text, markera: [{ typ: "rantekostnader", text }] });
    }
  }
  lan.forEach((l, index) => {
    const r = varde(l.ranta);
    if (r === null) return;
    const [lag, hog] = LANERANTA_INTERVALL;
    if (r < lag || r > hog) {
      const text =
        `Räntan ${fmt(r)} % för lånet${l.kreditgivare ? ` hos ${l.kreditgivare}` : ""} ligger utanför det ` +
        `rimliga intervallet ${fmt(lag)}–${fmt(hog)} %. Det kan vara en felläst siffra.`;
      fynd.push({ anmarkning: text, markera: [{ typ: "lanranta", index, text }] });
    }
  });

  // 7. Investeringsbehov per m² (PROMPT_VERSION 10): plausible magnitude.
  const investeringsbehov = varde(extraction.forening.underhallsplan?.investeringsbehovPerM2);
  if (investeringsbehov !== null) {
    const [lag, hog] = INVESTERINGSBEHOV_INTERVALL;
    if (investeringsbehov < lag || investeringsbehov > hog) {
      const text =
        `Investeringsbehovet ${fmt(investeringsbehov)} kr/m² ligger utanför det rimliga intervallet ` +
        `${fmt(lag)}–${fmt(hog)} kr/m². Det kan vara fel enhet eller en felläst siffra.`;
      fynd.push({ anmarkning: text, markera: [{ typ: "investeringsbehov", text }] });
    }
  }

  if (fynd.length === 0) return { extraction, anmarkningar: [] };

  const anmarkningar = fynd.map((f) => f.anmarkning);

  // First marker wins per figure; further reasons still reach the skäl list.
  const nyckeltalOsaker = new Map<KeyFigureId, string>();
  const summaOsaker = new Map<keyof Kontrollsummor, string>();
  let totalSkuldOsaker: string | undefined;
  let rantekostnaderOsaker: string | undefined;
  const lanrantaOsaker = new Map<number, string>();
  let investeringsbehovOsaker: string | undefined;
  for (const f of fynd) {
    for (const m of f.markera) {
      if (m.typ === "nyckeltal") {
        if (!nyckeltalOsaker.has(m.id)) nyckeltalOsaker.set(m.id, m.text);
      } else if (m.typ === "summa") {
        if (!summaOsaker.has(m.nyckel)) summaOsaker.set(m.nyckel, m.text);
      } else if (m.typ === "totalSkuld") {
        totalSkuldOsaker ??= m.text;
      } else if (m.typ === "rantekostnader") {
        rantekostnaderOsaker ??= m.text;
      } else if (m.typ === "investeringsbehov") {
        investeringsbehovOsaker ??= m.text;
      } else if (!lanrantaOsaker.has(m.index)) {
        lanrantaOsaker.set(m.index, m.text);
      }
    }
  }

  const keyFigures = extraction.forening.keyFigures.map((kf) => {
    const text = nyckeltalOsaker.get(kf.id);
    return text === undefined ? kf : { ...kf, figure: { ...kf.figure, osaker: text } };
  });

  let nyaSummor: Kontrollsummor | undefined;
  if (summor) {
    nyaSummor = { ...summor };
    for (const [nyckel, text] of summaOsaker) {
      const f = nyaSummor[nyckel];
      if (f) nyaSummor[nyckel] = { ...f, osaker: text };
    }
  }

  let nyLanebok = extraction.forening.lanebok;
  if (nyLanebok) {
    nyLanebok = { ...nyLanebok };
    if (totalSkuldOsaker !== undefined) {
      nyLanebok.totalSkuld = { ...nyLanebok.totalSkuld, osaker: totalSkuldOsaker };
    }
    if (rantekostnaderOsaker !== undefined && nyLanebok.rantekostnader) {
      nyLanebok.rantekostnader = { ...nyLanebok.rantekostnader, osaker: rantekostnaderOsaker };
    }
    if (lanrantaOsaker.size > 0 && nyLanebok.lan) {
      nyLanebok.lan = nyLanebok.lan.map((l, i) => {
        const text = lanrantaOsaker.get(i);
        return text === undefined || !l.ranta ? l : { ...l, ranta: { ...l.ranta, osaker: text } };
      });
    }
  }

  let nyUnderhallsplan = extraction.forening.underhallsplan;
  if (
    investeringsbehovOsaker !== undefined &&
    nyUnderhallsplan &&
    nyUnderhallsplan.investeringsbehovPerM2
  ) {
    nyUnderhallsplan = {
      ...nyUnderhallsplan,
      investeringsbehovPerM2: {
        ...nyUnderhallsplan.investeringsbehovPerM2,
        osaker: investeringsbehovOsaker,
      },
    };
  }

  const konfidens = extraction.datakvalitet.extraktionKonfidens;
  const nedsatt = {
    niva: konfidens.niva === "hog" ? ("medel" as const) : ("lag" as const),
    skal: [...(konfidens.skal ?? []), ...anmarkningar],
  };

  return {
    extraction: {
      ...extraction,
      forening: {
        ...extraction.forening,
        keyFigures,
        ...(nyLanebok ? { lanebok: nyLanebok } : {}),
        ...(nyUnderhallsplan ? { underhallsplan: nyUnderhallsplan } : {}),
      },
      datakvalitet: { ...extraction.datakvalitet, extraktionKonfidens: nedsatt },
      ...(nyaSummor ? { kontrollsummor: nyaSummor } : {}),
    },
    anmarkningar,
  };
}
