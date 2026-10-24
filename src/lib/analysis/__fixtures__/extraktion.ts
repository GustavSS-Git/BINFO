import { berikaNyckeltal } from "../benchmarks";
import type { ExtractionResult, KeyFigure } from "@/types/analysis";

/**
 * A deliberately awkward förening: several weak key figures, one genuinely
 * missing (null -> 'okant'), a big chunk of the loan book repricing next
 * year and a stambyte in the maintenance plan. That combination is exactly
 * what pass 2 exists to reason about — no single figure tells the story.
 *
 * Statuses come from berikaNyckeltal, not hand-written, so the fixture can
 * never drift away from the deterministic grading pass 1 actually applies.
 */
function raaNyckeltal(): KeyFigure[] {
  return [
    {
      id: "arsavgift_per_m2_brf_yta",
      label: "Årsavgift per m² upplåten med bostadsrätt",
      figure: {
        value: 780,
        unit: "kr/m2",
        source: "arsredovisning",
        ref: { page: 8, excerpt: "Årsavgift kr/kvm upplåten med bostadsrätt 780" },
      },
      status: "okant",
      forklaring: "Vad du betalar per kvadratmeter och år i avgift.",
    },
    {
      id: "arsavgift_andel_av_rorelseintakter",
      label: "Årsavgifternas andel av totala rörelseintäkter",
      // Genuinely absent from the report — must stay distinguishable from a bad value.
      figure: { value: null, unit: "procent", source: "berakning" },
      status: "okant",
      forklaring: "Hur stor del av föreningens intäkter som kommer från medlemmarnas avgifter.",
    },
    {
      id: "skuldsattning_per_m2_totalyta",
      label: "Skuldsättning per m² totalyta",
      figure: {
        value: 9800,
        unit: "kr/m2",
        source: "arsredovisning",
        ref: { page: 8, excerpt: "Skuldsättning kr/kvm totalyta 9 800" },
      },
      status: "okant",
      forklaring: "Hur mycket lån föreningen har per kvadratmeter.",
    },
    {
      id: "skuldsattning_per_m2_brf_yta",
      label: "Skuldsättning per m² bostadsrättsyta",
      figure: {
        value: 11200,
        unit: "kr/m2",
        source: "arsredovisning",
        ref: { page: 8, excerpt: "Skuldsättning kr/kvm bostadsrättsyta 11 200" },
      },
      status: "okant",
      forklaring: "Hur mycket lån som ligger bakom varje kvadratmeter du köper.",
    },
    {
      id: "sparande_per_m2_totalyta",
      label: "Sparande per m² totalyta",
      figure: {
        value: 180,
        unit: "kr/m2",
        source: "arsredovisning",
        ref: { page: 8, excerpt: "Sparande kr/kvm totalyta 180" },
      },
      status: "okant",
      forklaring: "Hur mycket föreningen lägger undan till framtida underhåll.",
    },
    {
      id: "rantekanslighet",
      label: "Räntekänslighet",
      figure: {
        value: 9.2,
        unit: "procent",
        source: "arsredovisning",
        ref: { page: 8, excerpt: "Räntekänslighet 9,2 %" },
      },
      status: "okant",
      forklaring: "Så mycket måste avgifterna höjas om räntan stiger en procentenhet.",
    },
    {
      id: "energikostnad_per_m2_totalyta",
      label: "Energikostnad per m² totalyta",
      figure: {
        value: 210,
        unit: "kr/m2",
        source: "arsredovisning",
        ref: { page: 8, excerpt: "Energikostnad kr/kvm totalyta 210" },
      },
      status: "okant",
      forklaring: "Vad föreningens värme och el kostar per kvadratmeter.",
    },
  ];
}

export const extraktion: ExtractionResult = {
  schemaVersion: "1.0.0",
  forening: {
    namn: "Brf Kastanjen",
    orgnr: "769612-3456",
    akta: "ja",
    byggar: {
      value: 1962,
      unit: "ar",
      source: "arsredovisning",
      ref: { page: 3, excerpt: "Byggnaden uppfördes 1962" },
    },
    antalLagenheter: {
      value: 48,
      unit: "antal",
      source: "arsredovisning",
      ref: { page: 3, excerpt: "föreningen omfattar 48 lägenheter" },
    },
    totalyta: {
      value: 5300,
      unit: "m2",
      source: "arsredovisning",
      ref: { page: 3, excerpt: "Total yta 5 300 kvm varav lokaler 150 kvm" },
    },
    bostadsrattsyta: {
      value: 4640,
      unit: "m2",
      source: "arsredovisning",
      ref: { page: 3, excerpt: "Bostadsrättsarea 4 640 kvm" },
    },
    rakenskapsar: 2025,
    balansdag: "2025-12-31",
    keyFigures: berikaNyckeltal(raaNyckeltal()),
    lanebok: {
      totalSkuld: {
        value: 52000000,
        unit: "kr",
        source: "arsredovisning",
        ref: { page: 12, excerpt: "Summa långfristiga skulder 52 000 000" },
      },
      forfalloprofil: [
        {
          ar: 2026,
          belopp: {
            value: 31000000,
            unit: "kr",
            source: "arsredovisning",
            ref: { page: 12, excerpt: "SBAB 1,1 % 2026-03-01 31 000 000" },
          },
          ranta: {
            value: 1.1,
            unit: "procent",
            source: "arsredovisning",
            ref: { page: 12, excerpt: "SBAB 1,1 % 2026-03-01 31 000 000" },
          },
        },
        {
          ar: 2029,
          belopp: {
            value: 21000000,
            unit: "kr",
            source: "arsredovisning",
            ref: { page: 12, excerpt: "Swedbank 3,4 % 2029-09-30 21 000 000" },
          },
        },
      ],
      lan: [
        {
          kreditgivare: "SBAB",
          belopp: {
            value: 31000000,
            unit: "kr",
            source: "arsredovisning",
            ref: { page: 12, excerpt: "SBAB 1,1 % 2026-03-01 31 000 000" },
          },
          ranta: {
            value: 1.1,
            unit: "procent",
            source: "arsredovisning",
            ref: { page: 12, excerpt: "SBAB 1,1 % 2026-03-01 31 000 000" },
          },
          villkorsandringsdag: "2026-03-01",
          rantetyp: "rorlig",
          ref: { page: 12, excerpt: "SBAB 1,1 % 2026-03-01 31 000 000" },
        },
        {
          kreditgivare: "Swedbank",
          belopp: {
            value: 21000000,
            unit: "kr",
            source: "arsredovisning",
            ref: { page: 12, excerpt: "Swedbank 3,4 % 2029-09-30 21 000 000" },
          },
          ranta: {
            value: 3.4,
            unit: "procent",
            source: "arsredovisning",
            ref: { page: 12, excerpt: "Swedbank 3,4 % 2029-09-30 21 000 000" },
          },
          villkorsandringsdag: "2029-09-30",
          rantetyp: "okant",
          ref: { page: 12, excerpt: "Swedbank 3,4 % 2029-09-30 21 000 000" },
        },
      ],
      snittranta: { value: 1.98, unit: "procent", source: "berakning" },
    },
    underhallsplan: {
      finns: "ja",
      senastUppdaterad: 2021,
      kommandeAtgarder: [
        {
          text: "Stambyte planerat 2028",
          ref: { page: 6, excerpt: "Stambyte beräknas till 2028" },
        },
        { text: "Fasadrenovering under utredning" },
      ],
      ref: { page: 6, excerpt: "Underhållsplanen uppdaterades 2021" },
    },
    vasentligaHandelser: [
      {
        text: "Styrelsen har beslutat om en avgiftshöjning på 12 % från januari 2026.",
        ref: { page: 4, excerpt: "höja årsavgifterna med 12 % från 2026-01-01" },
      },
    ],
  },
  datakvalitet: {
    pdfSaknarTextlager: false,
    extraktionKonfidens: {
      niva: "medel",
      skal: ["Årsavgifternas andel av rörelseintäkter saknas."],
    },
    saknadeFalt: ["arsavgift_andel_av_rorelseintakter"],
  },
};
