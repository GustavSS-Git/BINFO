/**
 * Bolånekalkylens hela beräkning: KalkylUnderlag in, KalkylResultat ut. Ren
 * logik utan React, delad av kalkylsidan, sparade kalkyler och PDF/Excel.
 *
 * Alla regler (bolånetak, amortering, ränteavdrag, skatt, Konsumentverket)
 * kommer från regelregistret (regler.ts). Ränteavdraget beräknas på ETT sätt:
 * per person (räntan delas lika mellan låntagarna) och begränsat av varje
 * persons skatt (beraknaHushallSkatt). Månadssumman "efter ränteavdrag" och
 * "Tillbaka i deklarationen" är därför alltid samma tal. Saknas inkomst går det
 * inte att veta vad skatten räcker till: avdraget räknas då med full sats och
 * resultatet säger det uttryckligen (`ranteavdrag.forutsatterSkatt`).
 *
 * Ett tomt fält är undefined i underlaget och räknas som 0 i summorna, men
 * `fyllt` säger vad som faktiskt är ifyllt så att sidan och exporterna visar
 * streck i stället för siffror som ser ut att betyda något.
 */
import {
  amorteringstakt,
  amorteringsniva,
  type Amorteringsniva,
} from "@/lib/analysis/calc/amortering";
import { beraknaManadskostnad, type LaneUnderlag } from "@/lib/analysis/calc/manadskostnad";
import { ranteavdrag } from "@/lib/analysis/calc/ranteavdrag";
import { rantestressScenario } from "@/lib/analysis/calc/rantestress";
import { schabloner } from "@/lib/analysis/calc/schabloner";
import { kr } from "@/data/mockData";
import { FEE_KEY_BY_COST_ITEM } from "@/lib/analysisView";
import { buildMinimalPropertyInput } from "@/lib/bolanekalkyl";
import { beraknaHushallSkatt, type HushallSkatt } from "@/lib/skatt2026";
import { beraknaLevnadskostnader, type Levnadskostnader } from "@/lib/kalkyl/levnadskostnader";
import { KONSUMENTVERKET_2026, MIN_KONTANTINSATS_ANDEL, tal } from "@/lib/kalkyl/regler";
import {
  type EgenKostnadId,
  type KalkylSammanfattning,
  type KalkylUnderlag,
} from "@/lib/kalkyl/underlag";
import type { CostItemId } from "@/types/analysis";

export const RANTEAVDRAG_FORUTSATTER_SKATT_TEXT =
  "Ränteavdraget är räknat med full avdragssats och förutsätter att ni betalar tillräckligt med skatt. Fyll i inkomst för att se vad skatten räcker till.";

/** De fem drift-posterna, i visningsordning. */
export const DRIFT_POSTER: readonly EgenKostnadId[] = [
  "hushallsel",
  "varme",
  "vatten",
  "bredband",
  "hemforsakring",
];

/** Posterna vars schablon beror på boarean (vatten följer antalet personer). */
const KRAVER_BOAREA: ReadonlySet<EgenKostnadId> = new Set<EgenKostnadId>(["varme"]);

// ---------------------------------------------------------------------------
// Resultattyper
// ---------------------------------------------------------------------------

export interface Fyllt {
  ranta: boolean;
  /** Ränta, pris och kontantinsats: räntekostnaden går att räkna (lånet = pris − kontantinsats). */
  ranteunderlag: boolean;
  /** Ränta, pris och kontantinsats: lånets alla delar. */
  lan: boolean;
  /** Pris och kontantinsats: belåningsgraden går att räkna. */
  belaning: boolean;
  inkomst: boolean;
  avgift: boolean;
  boarea: boolean;
  /** Lån, avgift och boarea: den totala månadskostnaden går att visa. */
  total: boolean;
}

export interface DriftRad {
  id: EgenKostnadId;
  namn: string;
  /** Schablonvärdet i kr/mån, eller null när boarean saknas. */
  schablon: number | null;
  /** Värdet som räknas med: eget värde om användaren skrivit över, annars schablonen. */
  belopp: number | null;
  egen: boolean;
  ingarIAvgift: boolean;
  /** Schablonen kan inte räknas utan boarea. */
  saknarBoarea: boolean;
  schablonBasis?: string;
}

export interface Manadssummor {
  /** Efter ränteavdrag: den totala månadskostnaden. */
  netto: number;
  /** Före ränteavdrag. */
  brutto: number;
}

export interface Scenario {
  rantaProcent: number;
  /** Procentenheter som avgiften stressas med via räntekänsligheten. */
  avgiftsstressPp: number;
  /** kr per månad, före ränteavdrag. */
  rantekostnad: number;
  amortering: number;
  /** Positivt tal: ränteavdraget per månad. */
  ranteavdragPerManad: number;
  ranteavdragPerAr: number;
  ranteavdragForloratPerAr: number;
  /** Månadsavgiften efter eventuell stress. */
  manadsavgift: number;
  avgiftsokning: number;
  /** Drift som räknas med (boendeposter som inte ingår i avgiften). */
  drift: number;
  summor: Manadssummor;
  /** Det som faktiskt betalas per månad: ränta före avdrag + amortering + avgift + drift. */
  betalarPerManad: number;
  /** Nettoinkomst − betalarPerManad (inga levnadskostnader). */
  kvarEfterBoende: number;
  andelAvNettoProcent: number;
}

export interface ScenarioRad extends Scenario {
  id: "egen" | "plus1" | "plus2" | "plus3" | "kalkylranta";
  namn: string;
}

export interface KalpRad {
  id: string;
  namn: string;
  belopp: number;
  anmarkning?: string;
}

export interface KalpResultat {
  kalkylrantaProcent: number;
  /** Sant när allt som krävs är ifyllt och hushållet ryms i Konsumentverkets tabell. */
  beraknad: boolean;
  /** Vad som saknas, på svenska ("pris", "bruttoinkomst" …). */
  saknas: string[];
  /** Hushållet är större än Konsumentverkets tabell (7 personer). */
  hushalletForStort: boolean;
  nettoinkomstPerManad: number;
  boendeRader: KalpRad[];
  levnadskostnader: Levnadskostnader | null;
  summaKostnader: number | null;
  /** Nettoinkomst − bankens kalkylerade kostnader. null när den inte går att räkna. */
  kvarAttLevaPa: number | null;
  /** Bara tecknet: plus = kvar att leva på ≥ 0, minus = underskott. Inga andra ord eller gränser. */
  utfall: "plus" | "minus" | null;
  forutsattningar: string[];
}

export interface KalkylResultat {
  fyllt: Fyllt;
  lan: {
    /** Lån = max(0, pris − kontantinsats). */
    lanebelopp: number;
    kontantinsats: number;
    /** Bostadens värde = priset du räknar med. */
    bostadsvarde: number;
    /** Ej avrundad; styr amorteringstakten. */
    belaningsgradProcent: number;
    amorteringstaktProcent: 0 | 1 | 2;
    amorteringsniva: Amorteringsniva;
    skuldkvot: number;
    overBankernasTypiskaTak: boolean;
    /** Minsta tillåtna kontantinsats (kr) enligt bolånetaket. */
    minKontantinsats: number;
    /** Felmeddelande när kontantinsatsen är för liten, annars null. */
    kontantinsatsFel: string | null;
  };
  skatt: {
    hushall: HushallSkatt;
    nettoinkomstPerManad: number;
    bruttoinkomstPerAr: number;
  };
  ranteavdrag: {
    perAr: number;
    perManad: number;
    forloratPerAr: number;
    /** Inkomst saknas: avdraget är räknat med full sats utan att skatten kunnat prövas. */
    forutsatterSkatt: boolean;
    not: string | null;
  };
  /** Alla fem drift-poster, med schablon, eget värde och avgiftsstatus. */
  drift: DriftRad[];
  /** Huvudscenariot: egen ränta + räntestressen på sidans reglage. */
  nu: Scenario;
  /** Egen ränta, +1, +2, +3 procentenheter och kalkylräntan. Tom utan ränta. */
  scenarier: ScenarioRad[];
  kalp: KalpResultat;
}

// ---------------------------------------------------------------------------
// Hjälpare
// ---------------------------------------------------------------------------

const heltal = (v: number) => Math.round(v);

interface Data {
  u: KalkylUnderlag;
  pris: number;
  /** Lån = max(0, pris − kontantinsats); 0 tills både pris och kontantinsats är ifyllda. */
  lanebelopp: number;
  kontantinsats: number;
  ranta: number;
  manadsavgift: number;
  boarea: number;
  bruttoinkomster: number[];
  fyllt: Fyllt;
}

function harled(u: KalkylUnderlag): Data {
  const ranta = u.rantaProcent !== undefined;
  const pris = u.pris !== undefined;
  const kont = u.kontantinsats !== undefined;
  const inkomst = u.inkomst1 !== undefined && (u.antalLantagare === 1 || u.inkomst2 !== undefined);
  const avgift = u.manadsavgift !== undefined;
  const boarea = u.boarea !== undefined;
  const belaning = pris && kont;
  const lanDel = belaning && ranta;
  return {
    u,
    pris: u.pris ?? 0,
    lanebelopp: belaning ? Math.max(0, (u.pris ?? 0) - (u.kontantinsats ?? 0)) : 0,
    kontantinsats: u.kontantinsats ?? 0,
    ranta: u.rantaProcent ?? 0,
    manadsavgift: u.manadsavgift ?? 0,
    boarea: u.boarea ?? 0,
    bruttoinkomster:
      u.antalLantagare === 2 ? [u.inkomst1 ?? 0, u.inkomst2 ?? 0] : [u.inkomst1 ?? 0],
    fyllt: {
      ranta,
      ranteunderlag: lanDel,
      lan: lanDel,
      belaning,
      inkomst,
      avgift,
      boarea,
      total: lanDel && avgift && boarea,
    },
  };
}

interface ScenarioMedDetaljer extends Scenario {
  driftRader: DriftRad[];
  hushall: HushallSkatt;
}

function scenario(d: Data, rantaProcent: number, avgiftsstressPp: number): ScenarioMedDetaljer {
  const { u } = d;
  const rk = u.rantekanslighetProcent;
  const stressadAvgift =
    rk !== undefined
      ? rantestressScenario(d.manadsavgift, rk, avgiftsstressPp).nyManadsavgift
      : d.manadsavgift;

  const liveInput = buildMinimalPropertyInput({
    boarea: d.boarea,
    antalPersoner: u.antalPersoner,
    manadsavgift: stressadAvgift,
    avgiftInkluderar: u.avgiftInkluderar,
  });
  const bruttoinkomstSumma = d.bruttoinkomster.reduce((a, b) => a + b, 0);
  const lan: LaneUnderlag = {
    lanebelopp: d.lanebelopp,
    // Kontantinsatsen som LaneUnderlag räknar bostadsvärdet med: priset − lånet.
    kontantinsats: Math.max(0, d.pris - d.lanebelopp),
    ranta: rantaProcent,
    bruttoinkomst: bruttoinkomstSumma,
    antalLantagare: u.antalLantagare,
  };

  const arligRanta = d.lanebelopp * (rantaProcent / 100);
  const hushall = beraknaHushallSkatt(d.bruttoinkomster, arligRanta);
  // Skatten kan bara prövas när inkomsten är känd; annars full sats (se filhuvudet).
  const ranteavdragPerAr = d.fyllt.inkomst
    ? hushall.ranteavdragPerAr
    : ranteavdrag(arligRanta, u.antalLantagare);
  const forlorat = d.fyllt.inkomst ? hushall.ranteavdragForloratPerAr : 0;

  const m = beraknaManadskostnad(liveInput, lan, ranteavdragPerAr);

  const finnPost = (id: CostItemId) => {
    const post = m.poster.find((p) => p.id === id);
    if (!post) throw new Error(`Saknar kostnadspost: ${id}`);
    return post;
  };

  const rantekostnad = finnPost("rantekostnad").figure.value ?? 0;
  const amortering = finnPost("amortering").figure.value ?? 0;
  const avdragPerManad = -(finnPost("ranteavdrag").figure.value ?? 0);
  const manadsavgiftPost = finnPost("manadsavgift").figure.value ?? 0;

  const egna = u.egnaKostnader;
  const driftRader: DriftRad[] = DRIFT_POSTER.map((id) => {
    const post = finnPost(id);
    const saknarBoarea = !d.fyllt.boarea && KRAVER_BOAREA.has(id);
    const schablon = saknarBoarea ? null : (post.figure.value ?? 0);
    const eget = egna[id];
    return {
      id,
      namn: post.label,
      schablon,
      belopp: eget ?? schablon,
      egen: eget !== undefined,
      ingarIAvgift: post.ingarIAvgift,
      saknarBoarea,
      ...(post.figure.schablonBasis !== undefined && !saknarBoarea
        ? { schablonBasis: post.figure.schablonBasis }
        : {}),
    };
  });

  // Skriver användaren över en schablon flyttar sig totalen med precis
  // mellanskillnaden, och bara om posten räknas med (täcks den av avgiften
  // påverkar överskrivningen ingenting).
  const overrideDelta = (id: EgenKostnadId): number => {
    const override = egna[id];
    if (override === undefined) return 0;
    const diff = override - (finnPost(id).figure.value ?? 0);
    const nyckel = FEE_KEY_BY_COST_ITEM[id];
    if (!nyckel) return diff; // t.ex. hemförsäkring — alltid med
    return liveInput.avgiftInkluderar[nyckel] === "ja" ? 0 : diff;
  };
  const deltaSumma = DRIFT_POSTER.reduce((acc, id) => acc + overrideDelta(id), 0);
  const brutto = (m.totalBrutto.value ?? 0) + deltaSumma;
  const netto = (m.totalNetto.value ?? 0) + deltaSumma;

  const drift = driftRader
    .filter((p) => !p.ingarIAvgift)
    .reduce((acc, p) => acc + (p.belopp ?? 0), 0);
  const betalarPerManad = rantekostnad + amortering + manadsavgiftPost + drift;
  const nettoPerManad = hushall.nettoinkomstPerManad;

  return {
    rantaProcent,
    avgiftsstressPp,
    rantekostnad,
    amortering,
    ranteavdragPerManad: avdragPerManad,
    ranteavdragPerAr,
    ranteavdragForloratPerAr: forlorat,
    manadsavgift: manadsavgiftPost,
    avgiftsokning: manadsavgiftPost - heltal(d.manadsavgift),
    drift,
    summor: { netto, brutto },
    betalarPerManad,
    kvarEfterBoende: nettoPerManad - betalarPerManad,
    andelAvNettoProcent: nettoPerManad > 0 ? (betalarPerManad / nettoPerManad) * 100 : 0,
    driftRader,
    hushall,
  };
}

function utanDetaljer(s: ScenarioMedDetaljer): Scenario {
  const { driftRader: _rader, hushall: _hushall, ...resten } = s;
  return resten;
}

const SCENARIO_NAMN = {
  egen: "Din ränta",
  plus1: "+1 procentenhet",
  plus2: "+2 procentenheter",
  plus3: "+3 procentenheter",
  kalkylranta: "Bankens kalkylränta",
} as const;

// ---------------------------------------------------------------------------
// KALP
// ---------------------------------------------------------------------------

function beraknaKalp(
  d: Data,
  nettoPerManad: number,
  amorteringstaktProcent: 0 | 1 | 2,
): KalpResultat {
  const { u } = d;
  const saknas: string[] = [];
  if (u.pris === undefined) saknas.push("pris");
  if (u.kontantinsats === undefined) saknas.push("kontantinsats");
  if (u.manadsavgift === undefined) saknas.push("månadsavgift");
  if (!d.fyllt.inkomst) saknas.push("bruttoinkomst");
  if (u.boarea === undefined) saknas.push("boarea");

  const ia = u.avgiftInkluderar;
  const levnad = beraknaLevnadskostnader(u.antalVuxna, u.barn, {
    elIngarIAvgift: ia.el === "ja",
    vattenIngarIAvgift: ia.vatten === "ja",
  });
  const hushalletForStort = levnad === null;

  const forutsattningar: string[] = [
    "Levnadskostnader enligt Konsumentverkets Hushållskostnader 2026: all mat lagas hemma och alla vuxna räknas som 25–50 år.",
    "Av Binfos driftschabloner räknas bara värme med. Konsumentverkets levnadskostnader omfattar redan hushållsel, vatten, internet och hemförsäkring.",
  ];
  if (ia.varme === "ja") {
    forutsattningar.push("Värme ingår i avgiften och räknas därför inte med.");
  } else {
    forutsattningar.push(
      "Värme räknas med (Binfos uppskattning) eftersom du angett att den inte ingår i avgiften.",
    );
  }
  if (hushalletForStort) {
    forutsattningar.push(
      `Konsumentverkets tabell gäller hushåll upp till ${KONSUMENTVERKET_2026.maxPersoner} personer, så KALP kan inte räknas för ett större hushåll.`,
    );
  }

  const kalkylranta = u.kalkylrantaProcent;
  const beraknad = saknas.length === 0 && levnad !== null;

  const boendeRader: KalpRad[] = [];
  let kvar: number | null = null;
  let summa: number | null = null;
  if (beraknad) {
    const ranteRad = heltal((d.lanebelopp * (kalkylranta / 100)) / 12);
    const amorteringRad = heltal((d.lanebelopp * (amorteringstaktProcent / 100)) / 12);
    const avgiftRad = heltal(d.manadsavgift);
    boendeRader.push(
      {
        id: "ranta",
        namn: `Ränta vid kalkylräntan ${String(kalkylranta).replace(".", ",")} %`,
        belopp: ranteRad,
      },
      { id: "amortering", namn: "Amortering", belopp: amorteringRad },
      { id: "avgift", namn: "Månadsavgift", belopp: avgiftRad },
    );
    let varme = 0;
    if (ia.varme === "nej") {
      const eget = u.egnaKostnader.varme;
      varme = eget ?? schabloner(d.boarea, u.antalPersoner).varme.value ?? 0;
      boendeRader.push({
        id: "varme",
        namn: "Värme",
        belopp: varme,
        anmarkning: eget !== undefined ? "ditt värde" : "schablon",
      });
    }
    const boende = ranteRad + amorteringRad + avgiftRad + varme;
    summa = boende + levnad.summa;
    kvar = heltal(nettoPerManad - summa);
  }

  return {
    kalkylrantaProcent: kalkylranta,
    beraknad,
    saknas,
    hushalletForStort,
    nettoinkomstPerManad: nettoPerManad,
    boendeRader,
    levnadskostnader: levnad,
    summaKostnader: summa,
    kvarAttLevaPa: kvar,
    utfall: kvar === null ? null : kvar >= 0 ? "plus" : "minus",
    forutsattningar,
  };
}

// ---------------------------------------------------------------------------
// Huvudfunktionerna
// ---------------------------------------------------------------------------

export function beraknaKalkyl(u: KalkylUnderlag): KalkylResultat {
  const d = harled(u);
  const nu = scenario(d, d.ranta + u.rantestressPp, u.rantestressPp);

  const bostadsvarde = d.pris;
  const belaningsgradProcent = bostadsvarde > 0 ? (d.lanebelopp / bostadsvarde) * 100 : 0;
  const bruttoSumma = d.bruttoinkomster.reduce((a, b) => a + b, 0);
  const skuldkvot = bruttoSumma > 0 ? d.lanebelopp / bruttoSumma : 0;
  const takt = amorteringstakt(belaningsgradProcent);

  const minKontantinsats = bostadsvarde * MIN_KONTANTINSATS_ANDEL;
  const kontantinsatsFel =
    u.pris === undefined || u.kontantinsats === undefined
      ? null
      : d.kontantinsats > bostadsvarde
        ? `Kontantinsatsen kan inte vara större än priset (${kr(bostadsvarde)}).`
        : bostadsvarde > 0 && d.kontantinsats < minKontantinsats - 0.5
          ? `Kontantinsatsen måste vara minst ${Math.round(MIN_KONTANTINSATS_ANDEL * 100)} % av priset (${kr(minKontantinsats)}).`
          : null;
  const { driftRader, hushall: hushallSkatt } = nu;
  const nettoPerManad = hushallSkatt.nettoinkomstPerManad;

  const scenarier: ScenarioRad[] = [];
  if (d.fyllt.ranta) {
    const steg: Array<{ id: ScenarioRad["id"]; pp: number }> = [
      { id: "egen", pp: 0 },
      { id: "plus1", pp: 1 },
      { id: "plus2", pp: 2 },
      { id: "plus3", pp: 3 },
    ];
    for (const { id, pp } of steg) {
      scenarier.push({
        ...utanDetaljer(scenario(d, d.ranta + pp, pp)),
        id,
        namn: SCENARIO_NAMN[id],
      });
    }
    // Avgiften stressas bara upp mot kalkylräntan, aldrig ned om den ligger under din ränta.
    const ppKalkylranta = Math.max(0, u.kalkylrantaProcent - d.ranta);
    scenarier.push({
      ...utanDetaljer(scenario(d, u.kalkylrantaProcent, ppKalkylranta)),
      id: "kalkylranta",
      namn: SCENARIO_NAMN.kalkylranta,
    });
  }

  return {
    fyllt: d.fyllt,
    lan: {
      lanebelopp: d.lanebelopp,
      kontantinsats: d.kontantinsats,
      bostadsvarde,
      belaningsgradProcent,
      amorteringstaktProcent: takt,
      amorteringsniva: amorteringsniva(belaningsgradProcent),
      skuldkvot: Math.round(skuldkvot * 1000) / 1000,
      overBankernasTypiskaTak: skuldkvot > tal("skuldkvot_bankstak"),
      minKontantinsats,
      kontantinsatsFel,
    },
    skatt: {
      hushall: hushallSkatt,
      nettoinkomstPerManad: nettoPerManad,
      bruttoinkomstPerAr: bruttoSumma,
    },
    ranteavdrag: {
      perAr: nu.ranteavdragPerAr,
      perManad: nu.ranteavdragPerManad,
      forloratPerAr: nu.ranteavdragForloratPerAr,
      forutsatterSkatt: !d.fyllt.inkomst,
      not: d.fyllt.inkomst ? null : RANTEAVDRAG_FORUTSATTER_SKATT_TEXT,
    },
    drift: driftRader,
    nu: utanDetaljer(nu),
    scenarier,
    kalp: beraknaKalp(d, nettoPerManad, takt),
  };
}

/** Nyckeltal för listvyer och filnamn. null = går inte att räkna med de uppgifter som finns. */
export function sammanfattaKalkyl(u: KalkylUnderlag): KalkylSammanfattning {
  const r = beraknaKalkyl(u);
  return {
    totalPerManad: r.fyllt.total ? r.nu.summor.netto : null,
    belaningsgradProcent: r.fyllt.belaning
      ? Math.round(r.lan.belaningsgradProcent * 10) / 10
      : null,
    amorteringstaktProcent: r.fyllt.belaning ? r.lan.amorteringstaktProcent : null,
    kvarAttLevaPaKalp: r.kalp.kvarAttLevaPa,
  };
}
