import { sampleAnalysis } from "@/data/sampleAnalysis";
import type { AnalysisResult } from "@/types/analysis";

/** Testdata only: the sample analysis as a result made BEFORE round
 *  2026-10-24b (every new field stripped) — "old stored results". */
export function analysUtanPrognos(): AnalysisResult {
  const {
    avgiftsprognos: _a,
    uppgiftsjamforelse: _u,
    sammanfattning: _s,
    ...resten
  } = sampleAnalysis;
  const {
    justeringar: _j,
    justeradVardering: _jv,
    avvikelseMotJusteradVardering: _ajv,
    breddningsskal: _b,
    ...prisanalys
  } = sampleAnalysis.prisanalys;
  const { prognosTabell: _p, ...rantestress } = sampleAnalysis.rantestress;
  return { ...resten, prisanalys, rantestress };
}

/** Testdata only: the sample analysis plus every round-2026-10-24b field. */
export function analysMedPrognos(): AnalysisResult {
  const sampleAnalysis = analysUtanPrognos();
  const bas = sampleAnalysis.prisanalys.externVardering;
  if (!bas) throw new Error("sampleAnalysis saknar externVardering");
  return {
    ...sampleAnalysis,
    prisanalys: {
      ...sampleAnalysis.prisanalys,
      justeringar: [
        {
          id: "forvantad_avgiftshojning",
          label: "Väntad avgiftshöjning",
          belopp: { value: -150_000, unit: "kr", source: "schablon" },
          krPerKrManad: 300,
          forklaring: "Avgiften väntas stiga, vilket brukar hänga ihop med ett lägre pris.",
        },
      ],
      justeradVardering: { ...bas, value: (bas.value ?? 0) - 150_000 },
      avvikelseMotJusteradVardering: 3.2,
      breddningsskal: ["Underhållsplanens belopp saknas, så den lägre gränsen sänks med 3 %."],
    },
    rantestress: {
      ...sampleAnalysis.rantestress,
      prognosTabell: {
        rader: [
          { id: "idag", label: "Idag", manadsavgift: 4_000, forandringKr: 0 },
          { id: "forvantad", label: "Väntad", manadsavgift: 4_500, forandringKr: 500 },
          { id: "plus1", label: "Väntad + 1 p.e.", manadsavgift: 4_600, forandringKr: 600 },
          { id: "plus2", label: "Väntad + 2 p.e.", manadsavgift: 4_700, forandringKr: 700 },
        ],
        kommentar: "TABELLKOMMENTAR",
      },
    },
    avgiftsprognos: {
      horisontManader: 24,
      berakningsdatum: "2026-10-24",
      andel: { varde: 0.001, metod: "avgiftsandel" },
      komponenter: [
        {
          id: "refinansiering",
          label: "Lån som omsätts",
          status: "beraknad",
          foreningKrPerAr: 100_000,
          krPerManad: 500,
          forklaring: "Räntan på lånen som förfaller väntas stiga.",
          ref: { page: 8, excerpt: "Lånenotens utdrag" },
        },
        {
          id: "underhall",
          label: "Underhåll",
          status: "saknar_underlag",
          foreningKrPerAr: null,
          krPerManad: null,
          forklaring: "Planen anger inga belopp.",
        },
        {
          id: "lokaler",
          label: "Lokaler",
          status: "ej_aktuell",
          foreningKrPerAr: null,
          krPerManad: null,
          forklaring: "Inga lokalhyresavtal löper ut.",
        },
      ],
      totalKrPerManad: 500,
      refinansiering: {
        forfallandeBelopp: 12_000_000,
        nuvarandeRantaProcent: 2.5,
        nyRantaProcent: 3.1,
        referensranta: {
          namn: "3-månaders statsskuldväxel",
          serie: "SETB3MBENCH",
          datum: "2026-10-23",
          procent: 2.0,
          kalla: "Riksbanken",
          reserv: false,
        },
        marginalProcent: 1.1,
        antagenAndelProcent: 50,
        antalLan: 3,
      },
    },
    uppgiftsjamforelse: [
      {
        falt: "byggar",
        label: "Byggår",
        anvandare: 1962,
        rapport: 1958,
        status: "avviker",
        anvant: 1958,
        text: "Du angav 1962, årsredovisningen anger 1958, vi använder 1958.",
        ref: { page: 3, excerpt: "Byggår 1958" },
      },
      {
        falt: "totalyta",
        label: "Totalyta",
        status: "manuellt",
        anvant: null,
        text: "Totalytan fanns inte i årsredovisningen.",
      },
    ],
    sammanfattning: {
      betyg: "SUMBETYG",
      pris: "SUMPRIS",
      avgift: "SUMAVGIFT",
      slutsats: "SUMSLUTSATS",
    },
  };
}

/** Testdata only: round 2026-10-24c shape — schablon target with building parts,
 *  loans in both phases, fee pressure colours and a price split per component. */
export function analysMedSparbehov(): AnalysisResult {
  const a = analysMedPrognos();
  const pg = a.avgiftsprognos;
  const refi = pg?.refinansiering;
  if (!pg || !refi) throw new Error("analysMedPrognos saknar prognos");
  const bas = a.prisanalys.externVardering;
  if (!bas) throw new Error("sampleAnalysis saknar externVardering");
  return {
    ...a,
    prisanalys: {
      ...a.prisanalys,
      justeradVardering: { ...bas, value: (bas.value ?? 0) - 240_000 },
      justeringar: [
        {
          id: "forvantad_avgiftshojning",
          label: "Väntad avgiftshöjning",
          belopp: { value: -240_000, unit: "kr", source: "schablon" },
          krPerKrManad: 300,
          forklaring: "Avgiften väntas stiga, vilket brukar hänga ihop med ett lägre pris.",
        },
      ],
    },
    avgiftsprognos: {
      ...pg,
      tryck: "gul",
      totalKrPerManad: 800,
      komponenter: [
        {
          id: "spargap",
          label: "Sparande mot behov",
          status: "beraknad",
          foreningKrPerAr: 96_000,
          krPerManad: 300,
          forklaring: "SPARFORKLARING: föreningen sparar mindre än schablonbehovet.",
          tryck: "gul",
        },
        {
          id: "refinansiering",
          label: "Lån som omsätts",
          status: "beraknad",
          foreningKrPerAr: 125_000,
          krPerManad: 500,
          forklaring: "REFIFORKLARING: räntan på lånen som förfaller väntas stiga.",
          ref: { page: 8, excerpt: "Lånenotens utdrag" },
          tryck: "rod",
        },
        {
          id: "underhall",
          label: "Underhåll",
          status: "saknar_underlag",
          foreningKrPerAr: null,
          krPerManad: null,
          forklaring: "Planen anger inga belopp.",
        },
        {
          id: "lokaler",
          label: "Lokaler",
          status: "ej_aktuell",
          foreningKrPerAr: null,
          krPerManad: null,
          forklaring: "Inga lokalhyresavtal löper ut.",
        },
      ],
      sparbehov: {
        malKrPerM2: 310,
        malKalla: "schablon",
        sparandeKrPerM2: 120,
        sparandeRef: { page: 5, excerpt: "Sparande 120 kr/m²" },
        glappKrPerM2: 190,
        totalyta: 4_000,
        dampning: 0.5,
        byggdelar: [
          {
            byggdel: "stambyte",
            label: "Stambyte",
            senast: 1958,
            senastKalla: "byggar",
            livslangd: { lag: 40, hog: 60 },
            status: "eftersatt",
            ref: { page: 3, excerpt: "Byggår 1958" },
          },
          {
            byggdel: "tak",
            label: "Tak",
            senast: 2019,
            senastKalla: "atgard",
            livslangd: { lag: 20, hog: 60 },
            status: "nyligen",
            ref: { page: 6, excerpt: "Takbyte 2019" },
          },
          {
            byggdel: "fasad",
            label: "Fasad",
            senast: 1995,
            senastKalla: "atgard",
            livslangd: { lag: 20, hog: 100 },
            status: "ok",
          },
          {
            byggdel: "hiss",
            label: "Hiss",
            senastKalla: "okand",
            livslangd: { lag: 20, hog: 40 },
            status: "okant",
          },
        ],
      },
      refinansiering: {
        ...refi,
        senareHorisontManader: 60,
        lan: [
          {
            belopp: 6_000_000,
            rantaProcent: 2.5,
            dag: "2027-03-01",
            rorlig: false,
            fas: "inom_horisont",
            vikt: 1,
            foreningKrPerAr: 36_000,
            ref: { page: 8, excerpt: "Lån 1" },
          },
          {
            belopp: 2_000_000,
            rantaProcent: 1.9,
            rorlig: true,
            fas: "inom_horisont",
            vikt: 1,
            foreningKrPerAr: 24_000,
          },
          {
            belopp: 4_000_000,
            rantaProcent: 1.2,
            dag: "2029-06-01",
            rorlig: false,
            fas: "senare",
            vikt: 0.5,
            foreningKrPerAr: 38_000,
          },
        ],
      },
    },
    sammanfattning: {
      betyg: "SUMBETYG",
      pris: "SUMPRIS",
      avgift: "SUMAVGIFT",
      slutsats: "SUMSLUTSATS",
    },
  };
}

/** Testdata only: plan-based target (full weight), surplus-free, green pressure. */
export function analysMedPlanMal(): AnalysisResult {
  const a = analysMedSparbehov();
  const pg = a.avgiftsprognos;
  if (!pg?.sparbehov) throw new Error("saknar sparbehov");
  const { byggdelar: _b, ...sb } = pg.sparbehov;
  return {
    ...a,
    avgiftsprognos: {
      ...pg,
      tryck: "gron",
      sparbehov: {
        ...sb,
        malKrPerM2: 280,
        malKalla: "investeringsbehov",
        malRef: { page: 12, excerpt: "Investeringsbehov 280 kr/m²" },
        glappKrPerM2: 160,
        dampning: 1,
      },
    },
  };
}
