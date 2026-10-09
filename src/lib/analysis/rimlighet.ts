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

  if (fynd.length === 0) return { extraction, anmarkningar: [] };

  const anmarkningar = fynd.map((f) => f.anmarkning);

  // First marker wins per figure; further reasons still reach the skäl list.
  const nyckeltalOsaker = new Map<KeyFigureId, string>();
  const summaOsaker = new Map<keyof Kontrollsummor, string>();
  for (const f of fynd) {
    for (const m of f.markera) {
      if (m.typ === "nyckeltal") {
        if (!nyckeltalOsaker.has(m.id)) nyckeltalOsaker.set(m.id, m.text);
      } else if (!summaOsaker.has(m.nyckel)) {
        summaOsaker.set(m.nyckel, m.text);
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

  const konfidens = extraction.datakvalitet.extraktionKonfidens;
  const nedsatt = {
    niva: konfidens.niva === "hog" ? ("medel" as const) : ("lag" as const),
    skal: [...(konfidens.skal ?? []), ...anmarkningar],
  };

  return {
    extraction: {
      ...extraction,
      forening: { ...extraction.forening, keyFigures },
      datakvalitet: { ...extraction.datakvalitet, extraktionKonfidens: nedsatt },
      ...(nyaSummor ? { kontrollsummor: nyaSummor } : {}),
    },
    anmarkningar,
  };
}
