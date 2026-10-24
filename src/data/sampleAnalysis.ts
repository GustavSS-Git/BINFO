import type { AnalysisResult } from "@/types/analysis";

/**
 * A real AnalysisResult from the real pipeline: Brf Pontonjären 3 (716420-0599),
 * årsredovisning 2025. The apartment input comes from a real listing on
 * Baltzar von Platens gata 6 (Kungsholmen), supplied by the owner.
 *
 * Generated 2026-10-24 (PROMPT_VERSION 10, sustainable-fee round 2026-10-24c) with
 *   EXTRACT_SPARA_UNDERLAG=<underlag.json> ANTHROPIC_MODEL=claude-sonnet-5-5 \
 *     npm run -s extract -- "<Årsredovisning 2025 (1).pdf>" <input.json>
 * then re-assembled for free with scripts/monteraOm.ts <underlag.json>.
 * Model claude-sonnet-5-5, valuation model valuation-v3.1, reference rate SSVX
 * 3M 2,068 % (2026-10-23). The fee prognosis is FROZEN at 2026-10-24 here (a
 * live report recomputes it on every read). Regenerate rather than hand-edit.
 * Powers the static example report at src/routes/exempel.tsx.
 */
export const sampleAnalysis: AnalysisResult = {
  schemaVersion: "1.0.0",
  analysisId: "60bd5f2a-0f89-44c2-9b85-d0eb1bafb4ae",
  skapad: "2026-10-24T17:17:42.252Z",
  input: {
    kind: "bostadsratt",
    utgangspris: 4995000,
    boarea: 48,
    antalRum: 2,
    manadsavgift: 3503,
    andelstal: 0,
    orgnr: "",
    adress: "Baltzar von Platens gata 6",
    postnummer: "112 42",
    ort: "Kungsholmen",
    vaning: 4,
    byggar: 1931,
    hiss: "ja",
    balkong: "nej",
    avgiftInkluderar: {
      varme: "okant",
      vatten: "okant",
      el: "okant",
      bredband: "okant",
      tv: "okant",
    },
    antalPersoner: 2,
  },
  forening: {
    namn: "Brf Pontonjären 3",
    orgnr: "716420-0599",
    akta: "ja",
    byggar: {
      value: 1931,
      unit: "ar",
      source: "arsredovisning",
      ref: {
        page: 4,
        excerpt: "Värdeåret är 1931.",
      },
    },
    antalLagenheter: {
      value: 39,
      unit: "antal",
      source: "arsredovisning",
      ref: {
        page: 4,
        excerpt: "Föreningen har 39 bostadsrätter om totalt 2 145 kvm och 2 lokaler om 184 kvm.",
      },
    },
    totalyta: {
      value: 2329,
      unit: "m2",
      source: "arsredovisning",
      ref: {
        page: 4,
        excerpt: "Byggnadernas totalyta är 2 329 kvm.",
      },
    },
    bostadsrattsyta: {
      value: 2145,
      unit: "m2",
      source: "arsredovisning",
      ref: {
        page: 4,
        excerpt: "39 bostadsrätter om totalt 2 145 kvm",
      },
    },
    rakenskapsar: 2025,
    balansdag: "2025-12-31",
    keyFigures: [
      {
        id: "arsavgift_per_m2_brf_yta",
        label: "Årsavgift per m² upplåten med bostadsrätt",
        figure: {
          value: 861,
          unit: "kr/m2",
          source: "arsredovisning",
          ref: {
            page: 8,
            excerpt: "Årsavgift / kvm upplåten bostadsrätt, kr 861 746 717 682",
          },
        },
        status: "acceptabel",
        benchmark: {
          value: 833,
          label: "Snitt Stockholm, årsavgift per m² bostadsrättsyta",
          source:
            "Tröskelvärden fastställda i BENCHMARKS.md (produktbeslut). Referenspunkt: Stockholmssnitt ~833 kr/m²/år (HSB Bostadsrättsbarometer 2025, 762 föreningar, räkenskapsår 2024).",
        },
        forklaring: "Vad du betalar per kvadratmeter och år i avgift.",
      },
      {
        id: "arsavgift_andel_av_rorelseintakter",
        label: "Årsavgifternas andel av rörelseintäkterna",
        figure: {
          value: 99.7,
          unit: "procent",
          source: "arsredovisning",
          ref: {
            page: 8,
            excerpt: "Årsavgifternas andel av totala rörelseintäkter (%) 99,7 81,4 83,8 85,0",
          },
        },
        status: "okant",
        forklaring: "Hur stor del av föreningens intäkter som kommer från medlemmarnas avgifter.",
      },
      {
        id: "skuldsattning_per_m2_totalyta",
        label: "Skuldsättning per m² totalyta",
        figure: {
          value: 3332,
          unit: "kr/m2",
          source: "arsredovisning",
          ref: {
            page: 8,
            excerpt: "Skuldsättning / kvm totalyta, kr 3 332 3 147 2 335 2 598",
          },
        },
        status: "acceptabel",
        forklaring: "Hur mycket föreningen har lånat per kvadratmeter totalyta.",
      },
      {
        id: "skuldsattning_per_m2_brf_yta",
        label: "Skuldsättning per m² upplåten med bostadsrätt",
        figure: {
          value: 3617,
          unit: "kr/m2",
          source: "arsredovisning",
          ref: {
            page: 8,
            excerpt: "Skuldsättning / kvm upplåten bostadsrätt, kr 3 617 3 417 2 535 2 821",
          },
        },
        status: "acceptabel",
        benchmark: {
          value: 7117,
          label: "Riksgenomsnitt, skuldsättning per m² bostadsrättsyta",
          source:
            "Tröskelvärden fastställda i BENCHMARKS.md (produktbeslut). Referenspunkt: riksgenomsnitt ~7 117 kr/m² (2023, Nabo/SCB-härlett).",
        },
        forklaring: "Hur mycket föreningen har lånat per kvadratmeter bostadsyta.",
      },
      {
        id: "sparande_per_m2_totalyta",
        label: "Sparande per m² totalyta",
        figure: {
          value: 125,
          unit: "kr/m2",
          source: "arsredovisning",
          ref: {
            page: 8,
            excerpt: "Sparande / kvm totalyta, kr 125 184 229 237",
          },
        },
        status: "god",
        forklaring: "Hur mycket föreningen sparar per kvadratmeter totalyta och år.",
      },
      {
        id: "rantekanslighet",
        label: "Räntekänslighet",
        figure: {
          value: 4.2,
          unit: "procent",
          source: "arsredovisning",
          ref: {
            page: 8,
            excerpt: "Räntekänslighet (%) 4,20 4,58 3,53 4,14",
          },
        },
        status: "acceptabel",
        benchmark: {
          value: 10.3,
          label: "Riksgenomsnitt, räntekänslighet",
          source:
            "Tröskelvärden fastställda i BENCHMARKS.md (produktbeslut). Referenspunkt: riksgenomsnitt ~10,3 % (2023, Nabo).",
        },
        forklaring: "Hur mycket avgiften skulle behöva höjas om räntan steg en procentenhet.",
      },
      {
        id: "energikostnad_per_m2_totalyta",
        label: "Energikostnad per m² totalyta",
        figure: {
          value: 238,
          unit: "kr/m2",
          source: "arsredovisning",
          ref: {
            page: 8,
            excerpt: "Energikostnad / kvm totalyta, kr 238 231 208 196",
          },
        },
        status: "acceptabel",
        benchmark: {
          value: 203,
          label: "Riksgenomsnitt, energikostnad per m² totalyta",
          source:
            "Tröskelvärden fastställda i BENCHMARKS.md (produktbeslut). Referenspunkt: riksgenomsnitt ~203 kr/m²/år (2023, SCB/Nabo).",
        },
        forklaring: "Vad föreningen betalar för el, värme och vatten per kvadratmeter och år.",
      },
    ],
    avgiftInkluderarEnligtForening: {
      varme: "ja",
      vatten: "ja",
      el: "nej",
      bredband: "okant",
      tv: "ja",
    },
    avgiftInkluderarKallor: {
      varme: {
        page: 14,
        excerpt: "I årsavgiften ingår kostnader för kabel-tv, vatten och värme.",
      },
      vatten: {
        page: 14,
        excerpt: "I årsavgiften ingår kostnader för kabel-tv, vatten och värme.",
      },
      el: {
        page: 8,
        excerpt: "Kostnader för medlemmarnas elförbrukning ingår inte i årsavgiften.",
      },
      tv: {
        page: 14,
        excerpt: "I årsavgiften ingår kostnader för kabel-tv, vatten och värme.",
      },
    },
    antalMedlemmar: {
      value: 49,
      unit: "antal",
      source: "arsredovisning",
      ref: {
        page: 7,
        excerpt: "Vid räkenskapsårets slut fanns det 49 medlemmar i föreningen.",
      },
    },
    antalLokaler: {
      value: 2,
      unit: "antal",
      source: "arsredovisning",
      ref: {
        page: 4,
        excerpt: "2 lokaler om 184 kvm",
      },
    },
    lanebok: {
      totalSkuld: {
        value: 7759091,
        unit: "kr",
        source: "arsredovisning",
        ref: {
          page: 18,
          excerpt: "Summa 7 759 091 7 329 735",
        },
      },
      forfalloprofil: [
        {
          ar: 2026,
          belopp: {
            value: 2926011,
            unit: "kr",
            source: "arsredovisning",
            ref: {
              page: 18,
              excerpt: "SEB 2026-03-28 2,53 % 2 926 011",
            },
          },
          ranta: {
            value: 2.53,
            unit: "procent",
            source: "arsredovisning",
            ref: {
              page: 18,
              excerpt: "SEB 2026-03-28 2,53 % 2 926 011",
            },
          },
        },
        {
          ar: 2026,
          belopp: {
            value: 1180000,
            unit: "kr",
            source: "arsredovisning",
            ref: {
              page: 18,
              excerpt: "SEB 2026-09-28 4,49 % 1 180 000 1 180 000",
            },
          },
          ranta: {
            value: 4.49,
            unit: "procent",
            source: "arsredovisning",
            ref: {
              page: 18,
              excerpt: "SEB 2026-09-28 4,49 % 1 180 000 1 180 000",
            },
          },
        },
        {
          ar: 2026,
          belopp: {
            value: 683080,
            unit: "kr",
            source: "arsredovisning",
            ref: {
              page: 18,
              excerpt: "SEB 2026-11-28 2,51 % 683 080 699 760",
            },
          },
          ranta: {
            value: 2.51,
            unit: "procent",
            source: "arsredovisning",
            ref: {
              page: 18,
              excerpt: "SEB 2026-11-28 2,51 % 683 080 699 760",
            },
          },
        },
        {
          ar: 2026,
          belopp: {
            value: 970000,
            unit: "kr",
            source: "arsredovisning",
            ref: {
              page: 18,
              excerpt: "SEB 2026-12-28 2,43 % 970 000 1 010 000",
            },
          },
          ranta: {
            value: 2.43,
            unit: "procent",
            source: "arsredovisning",
            ref: {
              page: 18,
              excerpt: "SEB 2026-12-28 2,43 % 970 000 1 010 000",
            },
          },
        },
        {
          ar: 2028,
          belopp: {
            value: 2000000,
            unit: "kr",
            source: "arsredovisning",
            ref: {
              page: 18,
              excerpt: "SEB 2028-10-28 2,98 % 2 000 000 2 000 000",
            },
          },
          ranta: {
            value: 2.98,
            unit: "procent",
            source: "arsredovisning",
            ref: {
              page: 18,
              excerpt: "SEB 2028-10-28 2,98 % 2 000 000 2 000 000",
            },
          },
        },
      ],
      snittranta: {
        value: 3.12,
        unit: "procent",
        source: "arsredovisning",
        ref: {
          page: 8,
          excerpt: "Genomsnittlig skuldränta (%) 3,12 2,83 3,13 1,23",
        },
      },
      lan: [
        {
          kreditgivare: "SEB",
          belopp: {
            value: 683080,
            unit: "kr",
            source: "arsredovisning",
            ref: {
              page: 18,
              excerpt: "SEB 2026-11-28 2,51 % 683 080 699 760",
            },
          },
          ranta: {
            value: 2.51,
            unit: "procent",
            source: "arsredovisning",
            ref: {
              page: 18,
              excerpt: "SEB 2026-11-28 2,51 % 683 080 699 760",
            },
          },
          villkorsandringsdag: "2026-11-28",
          rantetyp: "okant",
          ref: {
            page: 18,
            excerpt: "SEB 2026-11-28 2,51 % 683 080 699 760",
          },
        },
        {
          kreditgivare: "SEB",
          belopp: {
            value: 1180000,
            unit: "kr",
            source: "arsredovisning",
            ref: {
              page: 18,
              excerpt: "SEB 2026-09-28 4,49 % 1 180 000 1 180 000",
            },
          },
          ranta: {
            value: 4.49,
            unit: "procent",
            source: "arsredovisning",
            ref: {
              page: 18,
              excerpt: "SEB 2026-09-28 4,49 % 1 180 000 1 180 000",
            },
          },
          villkorsandringsdag: "2026-09-28",
          rantetyp: "okant",
          ref: {
            page: 18,
            excerpt: "SEB 2026-09-28 4,49 % 1 180 000 1 180 000",
          },
        },
        {
          kreditgivare: "SEB",
          belopp: {
            value: 970000,
            unit: "kr",
            source: "arsredovisning",
            ref: {
              page: 18,
              excerpt: "SEB 2026-12-28 2,43 % 970 000 1 010 000",
            },
          },
          ranta: {
            value: 2.43,
            unit: "procent",
            source: "arsredovisning",
            ref: {
              page: 18,
              excerpt: "SEB 2026-12-28 2,43 % 970 000 1 010 000",
            },
          },
          villkorsandringsdag: "2026-12-28",
          rantetyp: "okant",
          ref: {
            page: 18,
            excerpt: "SEB 2026-12-28 2,43 % 970 000 1 010 000",
          },
        },
        {
          kreditgivare: "SEB",
          belopp: {
            value: 2000000,
            unit: "kr",
            source: "arsredovisning",
            ref: {
              page: 18,
              excerpt: "SEB 2028-10-28 2,98 % 2 000 000 2 000 000",
            },
          },
          ranta: {
            value: 2.98,
            unit: "procent",
            source: "arsredovisning",
            ref: {
              page: 18,
              excerpt: "SEB 2028-10-28 2,98 % 2 000 000 2 000 000",
            },
          },
          villkorsandringsdag: "2028-10-28",
          rantetyp: "okant",
          ref: {
            page: 18,
            excerpt: "SEB 2028-10-28 2,98 % 2 000 000 2 000 000",
          },
        },
        {
          kreditgivare: "SEB",
          belopp: {
            value: 2926011,
            unit: "kr",
            source: "arsredovisning",
            ref: {
              page: 18,
              excerpt: "SEB 2026-03-28 2,53 % 2 926 011",
            },
          },
          ranta: {
            value: 2.53,
            unit: "procent",
            source: "arsredovisning",
            ref: {
              page: 18,
              excerpt: "SEB 2026-03-28 2,53 % 2 926 011",
            },
          },
          villkorsandringsdag: "2026-03-28",
          rantetyp: "rorlig",
          ref: {
            page: 18,
            excerpt: "SEB 2026-03-28 2,53 % 2 926 011",
          },
        },
      ],
      rantekostnader: {
        value: 235636,
        unit: "kr",
        source: "arsredovisning",
        ref: {
          page: 10,
          excerpt: "Räntekostnader och liknande resultatposter 11 -235 636 -181 390",
        },
      },
    },
    underhallsplan: {
      finns: "ja",
      senastUppdaterad: 2025,
      kommandeAtgarder: [
        {
          text: "Rensning av ventilations- och imkanaler i samtliga lägenheter och lokaler",
          ref: {
            page: 6,
            excerpt: "Rensning av ventilations- och imkanaler i samtliga lägenheter och lokeln.",
          },
        },
        {
          text: "Balkongbyggnation mot Pontonjärgården (medlemsfinansierat)",
          ref: {
            page: 6,
            excerpt:
              "Balkongbyggnation mot Pontonjärgården(medlemsfinansierat) hos intresserade medlemmar.",
          },
        },
        {
          text: "Planering och installation av fastighetsnära insamling (krav enligt lag 2027-01-01)",
          ref: {
            page: 6,
            excerpt:
              "Planering och installation av fastighetsnära insamling(FNI). (Krav enligt lag 2027-01-01).",
          },
        },
        {
          text: "Planering och utbyggnad av cykelställ",
          ref: {
            page: 6,
            excerpt: "Planering och utbyggnad av cykelställ på Baltzer von Platens Gata.",
          },
        },
        {
          text: "Kartläggning av undercentral och plan för byte",
          ref: {
            page: 6,
            excerpt: "Kartläggning av undercentral och plan för byte",
          },
        },
        {
          text: "OVK-besiktning",
          ref: {
            page: 6,
            excerpt: "OVK-besiktning",
          },
        },
      ],
      ref: {
        page: 5,
        excerpt: "Underhållsplanen uppdaterades 2025.",
      },
      underhallsfond: {
        value: 294000,
        unit: "kr",
        source: "arsredovisning",
        ref: {
          page: 12,
          excerpt: "Fond för yttre underhåll 294 000 1 780 895",
        },
      },
    },
    genomfordaAtgarder: [
      {
        byggdel: "stambyte",
        ar: 1998,
        text: "Stambyte i del av fastigheten",
        ref: {
          page: 6,
          excerpt: "Stambyte i del av fastigheten",
        },
      },
      {
        byggdel: "tak",
        ar: 1999,
        text: "Takomläggning",
        ref: {
          page: 6,
          excerpt: "Takomläggning",
        },
      },
      {
        byggdel: "fasad",
        ar: 1999,
        text: "Fasadrenovering etapp 1",
        ref: {
          page: 6,
          excerpt: "Fasadrenovering etapp 1",
        },
      },
      {
        byggdel: "ventilation",
        ar: 2001,
        text: "Installation av frånluftventilation",
        ref: {
          page: 6,
          excerpt: "Installation av frånluftventilation och renovering av öppna spisar",
        },
      },
      {
        byggdel: "fasad",
        ar: 2005,
        text: "Fasadrenovering etapp 2",
        ref: {
          page: 6,
          excerpt: "Fasadrenovering etapp 2",
        },
      },
      {
        byggdel: "fonster",
        ar: 2012,
        text: "Fönsterrenovering fas 1",
        ref: {
          page: 6,
          excerpt: "Fönsterrenovering fas 1",
        },
      },
      {
        byggdel: "fonster",
        ar: 2013,
        text: "Fönsterrenovering fas 2",
        ref: {
          page: 6,
          excerpt: "Fönsterrenovering fas 2",
        },
      },
      {
        byggdel: "stambyte",
        ar: 2017,
        text: "Stambyte i del av fastigheten",
        ref: {
          page: 6,
          excerpt: "Stambyte i del av fastigheten",
        },
      },
      {
        byggdel: "stambyte",
        ar: 2025,
        text: "Köksstambyte",
        ref: {
          page: 7,
          excerpt: "Köksstambytet avslutades med godkänd slutbesiktning i mars 2025.",
        },
      },
    ],
    lokaler: {
      hyresintakter: {
        value: 0,
        unit: "kr",
        source: "arsredovisning",
        ref: {
          page: 15,
          excerpt: "Hyresintäkter, lokaler 0 289 180",
        },
      },
    },
    vasentligaHandelser: [
      {
        text: "Årsavgifterna höjdes med 22 % från 1 maj 2025 på grund av uteblivna hyresintäkter då lokalen inte varit uthyrd.",
        ref: {
          page: 7,
          excerpt: "Årsavgifterna höjdes med 22 % från och med 1 maj 2025",
        },
      },
      {
        text: "I april 2025 upptogs ett lån om 500 000 kr för att täcka återstående kostnader för genomfört stambyte.",
        ref: {
          page: 7,
          excerpt: "upptogs i april 2025 ett lån om 500 000 kr",
        },
      },
      {
        text: "Extrastämma hölls med stadgeändring för att möjliggöra bredare uthyrning av lokalen.",
        ref: {
          page: 7,
          excerpt: "extrastämma under året med stadgeändring för att möjliggöra bredare uthyrning",
        },
      },
      {
        text: "Planeringen av balkongprojektet är färdig, med planerad byggstart i januari 2026.",
        ref: {
          page: 7,
          excerpt: "planerad byggstart i januari 2026",
        },
      },
      {
        text: "Förstudie för eventuell vindskonvertering har genomförts.",
        ref: {
          page: 7,
          excerpt: "Förstudie för eventuell vindskonvertering genomförd.",
        },
      },
    ],
    fastighetsbeteckningar: [
      {
        beteckning: "Pontonjären 3",
        ref: {
          page: 4,
          excerpt: "Pontonjären 3 1996 Stockholm",
        },
      },
    ],
  },
  betyg: "B",
  betygMotivering:
    "Inget av nyckeltalen är svagt eller kritiskt. Skuldsättningen är låg (3 332 kr/m² totalyta), sparandet är gott (125 kr/m²) och räntekänsligheten är 4,2 %, alltså måttlig. Betyget stannar på B för att 74 % av lånen förfaller redan 2026, för att avgiften nyss höjdes 22 % och nästan hela intäkten nu är avgifter (99,7 %) sedan lokalintäkterna föll bort, och för att huset är från 1931 med en undercentral som ska kartläggas inför byte utan att underhållsfonden (294 000 kr) är stor.",
  rodaFlaggor: [
    {
      id: "lan-forfaller-2026",
      titel: "Tre fjärdedelar av lånen ska omsättas 2026",
      beskrivning:
        "5 759 091 kr, 74 % av föreningens lån, förfaller 2026. Ett av lånen på 1 180 000 kr har redan 4,49 % ränta, medan övriga ligger på 2,43–2,53 %. Genomsnittsräntan är 3,12 %. Om lånen med lägre ränta omsätts till dyrare villkor ökar räntekostnaden (235 636 kr senaste året) och avgiften kan behöva höjas. Räntekänsligheten på 4,2 % visar att varje procentenhets ränteökning motsvarar cirka 4,2 % högre avgift.",
      severity: "medel",
      ref: {
        page: 18,
        excerpt: "SEB 2026-03-28 2,53 % 2 926 011",
      },
      harledsFran: ["rantekanslighet", "skuldsattning_per_m2_totalyta"],
    },
    {
      id: "avgiftshojning-lokal-outhyrd",
      titel: "Avgiften höjdes 22 % och lokalen står tom",
      beskrivning:
        "Årsavgiften höjdes 22 % från 1 maj 2025 eftersom lokalen inte varit uthyrd. Lokalhyran gav 0 kr, mot 289 180 kr året före. Avgifterna står nu för 99,7 % av intäkterna, så föreningen har ingen buffert om något annat går fel. Avgiften är 861 kr/m², något över Stockholmssnittet 833 kr/m². Eftersom höjningen gäller bara från maj slår den fullt ut först i nästa års siffror, och blir lokalen inte uthyrd kan ytterligare höjning bli aktuell.",
      severity: "medel",
      ref: {
        page: 7,
        excerpt: "Årsavgifterna höjdes med 22 % från och med 1 maj 2025",
      },
      harledsFran: ["arsavgift_per_m2_brf_yta", "arsavgift_andel_av_rorelseintakter"],
    },
    {
      id: "undercentral-och-liten-fond",
      titel: "Undercentral ska bytas, fonden är liten",
      beskrivning:
        "Underhållsplanen nämner kartläggning av undercentralen och plan för byte, och dessutom krävs fastighetsnära insamling enligt lag från 2027-01-01. Fonden för yttre underhåll är 294 000 kr, ned från 1 780 895 kr året före. Kostnaden för bytet anges inte. Betalas det inte ur sparandet (125 kr/m² totalyta) kan det bli lån eller högre avgift för dig som köper.",
      severity: "medel",
      ref: {
        page: 6,
        excerpt: "Kartläggning av undercentral och plan för byte",
      },
      harledsFran: ["sparande_per_m2_totalyta", "skuldsattning_per_m2_totalyta"],
    },
    {
      id: "energikostnad-aldre-hus",
      titel: "Energikostnaden ligger över riktvärdet",
      beskrivning:
        "Energikostnaden är 238 kr/m² mot riktvärdet 203 kr/m². Huset är från 1931, och byggåret är sannolikt en del av förklaringen. Kostnaden betalas ändå via avgiften, och värme ingår i den, så stigande energipriser slår direkt på föreningens ekonomi och därmed på din avgift.",
      severity: "lag",
      ref: {
        page: 8,
        excerpt: "Energikostnad / kvm totalyta, kr 238 231 208 196",
      },
      harledsFran: ["energikostnad_per_m2_totalyta"],
    },
  ],
  prisanalys: {
    utgangspris: {
      value: 4995000,
      unit: "kr",
      source: "anvandare",
    },
    prisPerM2: {
      value: 104063,
      unit: "kr/m2",
      source: "berakning",
    },
    externVardering: {
      value: 5681607,
      unit: "kr",
      source: "schablon",
      schablonBasis:
        "Binfos värderingsmodell (valuation-v3.1): en statistisk skattning för Kungsholmen, byggd på 4991 försäljningar i Stockholm jan–aug 2026. Typiskt fel ±7,6 %. Det är en statistisk skattning, inte en besiktning av just den här lägenheten.",
      range: {
        low: 4839649,
        high: 6670040,
      },
      leverantor: "Binfo värderingsmodell valuation-v3.1",
    },
    senasteForsaljningarIForeningen: [],
    avvikelseMotVardering: -12.1,
    slutsats:
      "Utgångspriset ligger 12,1 % under Binfos värderingsmodell för Kungsholmen och ligger inom modellens 90-procentiga intervall. Värderingen speglar prisläget jan–aug 2026 och är en statistisk skattning — inte en besiktning av just den här lägenheten.",
    konfidens: {
      niva: "medel",
      skal: [
        "Värderingen är en statistisk modell (typiskt fel ±7,6 %), inte en besiktning av lägenheten.",
      ],
    },
    varderingsunderlag: {
      modellVersion: "valuation-v3.1",
      omrade: "Kungsholmen",
      intervallTackningProcent: 90,
      dataperiod: {
        fran: "2026-01-01",
        till: "2026-08-31",
      },
      antalForsaljningar: 4991,
      typisktFelProcent: 7.643696205775945,
      drivare: [
        {
          label: "Ett rum till",
          effektProcent: 4.4,
          intervallProcent: {
            low: 3,
            high: 5.7,
          },
          niva: "stad",
        },
        {
          label: "En våning högre",
          effektProcent: 1.6,
          intervallProcent: {
            low: 1.3,
            high: 2,
          },
          niva: "stad",
        },
        {
          label: "10 kr/m² högre månadsavgift",
          effektProcent: -2.4,
          intervallProcent: {
            low: -2.8,
            high: -2.1,
          },
          niva: "stad",
        },
      ],
      tackning: "stockholm",
      kommun: "Stockholm",
    },
    budpremie: {
      omrade: "Kungsholmen",
      medianProcent: 5.43,
      medelProcent: 6.52,
      n: 495,
      dataperiod: {
        fran: "2026-01-01",
        till: "2026-08-31",
      },
    },
    andelAvForeningensSkuld: {
      value: 173616,
      unit: "kr",
      source: "berakning",
      ref: {
        page: 8,
        excerpt: "Skuldsättning / kvm upplåten bostadsrätt, kr 3 617 3 417 2 535 2 821",
      },
    },
    justeringar: [
      {
        id: "forvantad_avgiftshojning",
        label: "Föreningens ekonomi",
        belopp: {
          value: -107750,
          unit: "kr",
          source: "berakning",
        },
        krPerKrManad: 290,
        forklaring:
          "Årsredovisningen pekar på att din avgift kan stiga med cirka 372 kr i månaden inom 24 månader. I Binfos data hänger en högre månadsavgift ihop med ett lägre pris, ungefär 290 kr per krona i månadsavgift för en lägenhet som den här. Det är ett statistiskt samband, inte ett orsakssamband.",
      },
    ],
    justeradVardering: {
      value: 5573857,
      unit: "kr",
      source: "schablon",
      schablonBasis:
        "Binfos värdering justerad för den avgiftshöjning årsredovisningen pekar på, med modellens samband mellan månadsavgift och pris.",
      range: {
        low: 4561451,
        high: 6562290,
      },
    },
    avvikelseMotJusteradVardering: -10.4,
    breddningsskal: [
      "Spannet är bredare nedåt, med 3 % av värderingen, eftersom årsredovisningen saknar underlag för: underhåll utan finansiering. Det ändrar inte det beräknade värdet.",
    ],
  },
  rantestress: {
    rantekanslighetProcent: 4.2,
    nuvarandeManadsavgift: {
      value: 3503,
      unit: "kr",
      source: "anvandare",
    },
    scenarier: [
      {
        okningPe: 0,
        nyManadsavgift: {
          value: 3503,
          unit: "kr",
          source: "berakning",
        },
        avgiftsokningKrPerManad: {
          value: 0,
          unit: "kr",
          source: "berakning",
        },
      },
      {
        okningPe: 1,
        nyManadsavgift: {
          value: 3650,
          unit: "kr",
          source: "berakning",
        },
        avgiftsokningKrPerManad: {
          value: 147,
          unit: "kr",
          source: "berakning",
        },
      },
      {
        okningPe: 2,
        nyManadsavgift: {
          value: 3797,
          unit: "kr",
          source: "berakning",
        },
        avgiftsokningKrPerManad: {
          value: 294,
          unit: "kr",
          source: "berakning",
        },
      },
      {
        okningPe: 3,
        nyManadsavgift: {
          value: 3944,
          unit: "kr",
          source: "berakning",
        },
        avgiftsokningKrPerManad: {
          value: 441,
          unit: "kr",
          source: "berakning",
        },
      },
    ],
    kommentar:
      "Varje procentenhet högre ränta för föreningen motsvarar ungefär 147 kr mer i månaden för den här lägenheten. Stiger räntan tre procentenheter blir avgiften 3 944 kr i månaden, 441 kr mer än i dag.",
    prognosTabell: {
      rader: [
        {
          id: "idag",
          label: "Dagens avgift",
          manadsavgift: 3503,
          forandringKr: 0,
        },
        {
          id: "forvantad",
          label: "Förväntad avgift (oförändrad ränta)",
          manadsavgift: 3875,
          forandringKr: 372,
        },
        {
          id: "plus1",
          label: "+1 procentenhet",
          manadsavgift: 3989,
          forandringKr: 486,
        },
        {
          id: "plus2",
          label: "+2 procentenheter",
          manadsavgift: 4102,
          forandringKr: 599,
        },
      ],
      kommentar:
        "Raderna +1 och +2 procentenheter gäller bara den del av skulden som prissätts om inom 24 månader, 5 759 091 kr, och läggs ovanpå den förväntade avgiften.",
    },
  },
  fragor: [
    {
      id: "fraga-omsattning-2026",
      fraga:
        "Vilka räntor har styrelsen fått offert på för lånen på 5 759 091 kr som förfaller 2026, och vad blir avgiften om de landar på dagens nivå?",
      ursprung: "analys",
      riktadTill: "styrelsen",
      varfor:
        "74 % av lånen förfaller 2026 och ett av dem har redan 4,49 % ränta medan andra ligger på 2,43–2,53 %.",
      ref: {
        page: 18,
        excerpt: "SEB 2026-09-28 4,49 % 1 180 000 1 180 000",
      },
      svarssignal:
        "Bra svar: styrelsen har offerter och har räknat in dem i budgeten utan ny avgiftshöjning. Varningssignal: att inget är undersökt eller att ytterligare höjning är sannolik.",
    },
    {
      id: "fraga-ny-avgiftshojning",
      fraga:
        "Är någon ytterligare avgiftshöjning beslutad eller planerad, och vad förutsätter budgeten för lokalens hyra 2026?",
      ursprung: "analys",
      riktadTill: "styrelsen",
      varfor:
        "Avgiften höjdes 22 % från 1 maj 2025 eftersom lokalen stod outhyrd och hyresintäkterna var 0 kr.",
      ref: {
        page: 7,
        excerpt: "Årsavgifterna höjdes med 22 % från och med 1 maj 2025",
      },
      svarssignal:
        "Bra svar: budgeten klarar sig utan lokalhyra och ingen höjning är planerad. Varningssignal: att budgeten räknar med hyra från en lokal som ännu inte har någon hyresgäst.",
    },
    {
      id: "fraga-lokal-uthyrning",
      fraga:
        "Finns det en hyresgäst eller ett avtal för lokalen efter stadgeändringen, och när börjar hyran i så fall komma in?",
      ursprung: "analys",
      riktadTill: "styrelsen",
      varfor:
        "Extrastämman ändrade stadgarna för bredare uthyrning, men lokalintäkterna föll från 289 180 kr till 0 kr.",
      ref: {
        page: 7,
        excerpt: "extrastämma under året med stadgeändring för att möjliggöra bredare uthyrning",
      },
    },
    {
      id: "fraga-undercentral-kostnad",
      fraga:
        "Vad beräknas bytet av undercentralen kosta, när ska det göras och hur ska det betalas?",
      ursprung: "analys",
      riktadTill: "styrelsen",
      varfor:
        "Underhållsplanen nämner byte av undercentral, men fonden för yttre underhåll är bara 294 000 kr.",
      ref: {
        page: 6,
        excerpt: "Kartläggning av undercentral och plan för byte",
      },
      svarssignal:
        "Bra svar: en kostnadsuppskattning finns och finansieringen är avsatt. Varningssignal: att kostnaden är okänd eller att lån är enda lösningen.",
    },
    {
      id: "fraga-fni-vindskonvertering",
      fraga:
        "Vad kostar fastighetsnära insamling, och vad kan en eventuell vindskonvertering betyda för föreningens ekonomi och mina avgifter?",
      ursprung: "analys",
      riktadTill: "styrelsen",
      varfor:
        "Insamlingen är lagkrav från 2027-01-01 och en förstudie för vindskonvertering är genomförd, men inga kostnader redovisas.",
      ref: {
        page: 7,
        excerpt: "Förstudie för eventuell vindskonvertering genomförd.",
      },
    },
    {
      id: "saknad-avgift-bredband",
      fraga: "Ingår bredband i månadsavgiften?",
      ursprung: "saknad_uppgift",
      riktadTill: "maklaren",
      varfor:
        "Om bredband ingår i avgiften eller inte påverkar din faktiska månadskostnad: ingår det inte, tillkommer det på din egen räkning och avgiften är inte jämförbar med andra lägenheters.",
      svarssignal:
        "Bra svar: ett tydligt ja eller nej som går att få skriftligt. Varningssignal: ett vagt svar eller att ingen vet.",
    },
  ],
  datakvalitet: {
    pdfSaknarTextlager: false,
    extraktionKonfidens: {
      niva: "hog",
      skal: [],
    },
    kalla: "textlager",
    uppgifterKanda: 4,
    uppgifterTotalt: 9,
    saknadeFalt: [
      "avgiftInkluderar.varme",
      "avgiftInkluderar.vatten",
      "avgiftInkluderar.el",
      "avgiftInkluderar.bredband",
      "avgiftInkluderar.tv",
    ],
  },
  avgiftsprognos: {
    horisontManader: 24,
    berakningsdatum: "2026-10-24",
    andel: {
      varde: 0.023659700161873864,
      metod: "avgiftsandel",
    },
    komponenter: [
      {
        id: "spargap",
        label: "Sparande mot underhållsbehov",
        status: "beraknad",
        foreningKrPerAr: 203788,
        forklaring:
          "Behovet är cirka 300 kr/m² per år (schablon), föreningen sparar 125 kr/m², ett glapp på 175 kr/m², varav 50 % räknas med.",
        krPerManad: 402,
        ref: {
          page: 8,
          excerpt: "Sparande / kvm totalyta, kr 125 184 229 237",
        },
        tryck: "rod",
      },
      {
        id: "refinansiering",
        label: "Lån som ska omsättas",
        status: "beraknad",
        foreningKrPerAr: -15226,
        forklaring:
          "5 759 091 kr av lånen ska omsättas inom 24 månader. Räntan går från i snitt 2,91 % till 2,65 % (3-månaders statsskuldväxel 2,07 % plus 0,58 procentenheter), vilket sänker föreningens kostnad med cirka 15 226 kr per år.",
        krPerManad: -30,
        ref: {
          page: 18,
          excerpt: "SEB 2026-11-28 2,51 % 683 080 699 760",
        },
        tryck: "gron",
      },
      {
        id: "underhall",
        label: "Underhåll utan finansiering",
        status: "saknar_underlag",
        foreningKrPerAr: null,
        forklaring:
          "Årsredovisningen nämner kommande åtgärder men anger inga belopp, så vi kan inte räkna ut vad de kostar.",
        krPerManad: null,
        ref: {
          page: 5,
          excerpt: "Underhållsplanen uppdaterades 2025.",
        },
      },
      {
        id: "lokaler",
        label: "Lokalhyror som kan falla bort",
        status: "ej_aktuell",
        foreningKrPerAr: 0,
        forklaring:
          "Lokalerna gav inga hyresintäkter under året, så det finns ingen lokalhyra som kan falla bort.",
        krPerManad: null,
        ref: {
          page: 15,
          excerpt: "Hyresintäkter, lokaler 0 289 180",
        },
      },
      {
        id: "energi",
        label: "Energiprojekt utan finansiering",
        status: "ej_aktuell",
        foreningKrPerAr: 0,
        forklaring: "Årsredovisningen nämner inga energiprojekt.",
        krPerManad: null,
      },
    ],
    totalKrPerManad: 372,
    tryck: "rod",
    sparbehov: {
      malKrPerM2: 300,
      malKalla: "schablon",
      sparandeKrPerM2: 125,
      sparandeRef: {
        page: 8,
        excerpt: "Sparande / kvm totalyta, kr 125 184 229 237",
      },
      glappKrPerM2: 175,
      totalyta: 2329,
      dampning: 0.5,
      byggdelar: [
        {
          byggdel: "stambyte",
          label: "Stambyte",
          senast: 2025,
          senastKalla: "atgard",
          livslangd: {
            lag: 40,
            hog: 60,
          },
          status: "nyligen",
          ref: {
            page: 7,
            excerpt: "Köksstambytet avslutades med godkänd slutbesiktning i mars 2025.",
          },
        },
        {
          byggdel: "tak",
          label: "Tak",
          senast: 1999,
          senastKalla: "atgard",
          livslangd: {
            lag: 20,
            hog: 60,
          },
          status: "ok",
          ref: {
            page: 6,
            excerpt: "Takomläggning",
          },
        },
        {
          byggdel: "fasad",
          label: "Fasad",
          senast: 2005,
          senastKalla: "atgard",
          livslangd: {
            lag: 20,
            hog: 100,
          },
          status: "ok",
          ref: {
            page: 6,
            excerpt: "Fasadrenovering etapp 2",
          },
        },
        {
          byggdel: "fonster",
          label: "Fönster",
          senast: 2013,
          senastKalla: "atgard",
          livslangd: {
            lag: 40,
            hog: 60,
          },
          status: "nyligen",
          ref: {
            page: 6,
            excerpt: "Fönsterrenovering fas 2",
          },
        },
        {
          byggdel: "ventilation",
          label: "Ventilation",
          senast: 2001,
          senastKalla: "atgard",
          livslangd: {
            lag: 20,
            hog: 100,
          },
          status: "ok",
          ref: {
            page: 6,
            excerpt: "Installation av frånluftventilation och renovering av öppna spisar",
          },
        },
        {
          byggdel: "el",
          label: "El",
          senast: 1931,
          senastKalla: "byggar",
          livslangd: {
            lag: 45,
            hog: 50,
          },
          status: "eftersatt",
        },
        {
          byggdel: "hiss",
          label: "Hiss",
          senast: 1931,
          senastKalla: "byggar",
          livslangd: {
            lag: 20,
            hog: 40,
          },
          status: "eftersatt",
        },
      ],
    },
    refinansiering: {
      forfallandeBelopp: 5759091,
      nuvarandeRantaProcent: 2.91,
      nyRantaProcent: 2.648,
      referensranta: {
        namn: "3-månaders statsskuldväxel",
        serie: "SETB3MBENCH",
        datum: "2026-10-23",
        procent: 2.068,
        kalla: "Sveriges riksbank",
        reserv: false,
      },
      marginalProcent: 0.58,
      antalLan: 4,
      lan: [
        {
          belopp: 683080,
          rantaProcent: 2.51,
          dag: "2026-11-28",
          rorlig: false,
          fas: "inom_horisont",
          vikt: 1,
          foreningKrPerAr: 943,
          ref: {
            page: 18,
            excerpt: "SEB 2026-11-28 2,51 % 683 080 699 760",
          },
        },
        {
          belopp: 1180000,
          rantaProcent: 4.49,
          dag: "2026-09-28",
          rorlig: false,
          fas: "inom_horisont",
          vikt: 1,
          foreningKrPerAr: -21736,
          ref: {
            page: 18,
            excerpt: "SEB 2026-09-28 4,49 % 1 180 000 1 180 000",
          },
        },
        {
          belopp: 970000,
          rantaProcent: 2.43,
          dag: "2026-12-28",
          rorlig: false,
          fas: "inom_horisont",
          vikt: 1,
          foreningKrPerAr: 2115,
          ref: {
            page: 18,
            excerpt: "SEB 2026-12-28 2,43 % 970 000 1 010 000",
          },
        },
        {
          belopp: 2926011,
          rantaProcent: 2.53,
          dag: "2026-03-28",
          rorlig: true,
          fas: "inom_horisont",
          vikt: 1,
          foreningKrPerAr: 3453,
          ref: {
            page: 18,
            excerpt: "SEB 2026-03-28 2,53 % 2 926 011",
          },
        },
      ],
      senareHorisontManader: 60,
    },
  },
  uppgiftsjamforelse: [
    {
      falt: "byggar",
      label: "Byggår",
      anvandare: 1931,
      rapport: 1931,
      status: "bekraftat",
      anvant: 1931,
      text: "Du angav 1931 och årsredovisningen anger samma år.",
      ref: {
        page: 4,
        excerpt: "Värdeåret är 1931.",
      },
    },
    {
      falt: "antalLagenheter",
      label: "Antal lägenheter",
      rapport: 39,
      status: "endast_rapport",
      anvant: 39,
      text: "Enligt årsredovisningen: 39.",
      ref: {
        page: 4,
        excerpt: "Föreningen har 39 bostadsrätter om totalt 2 145 kvm och 2 lokaler om 184 kvm.",
      },
    },
    {
      falt: "totalyta",
      label: "Total yta",
      rapport: 2329,
      status: "endast_rapport",
      anvant: 2329,
      text: "Enligt årsredovisningen: 2 329,0 m².",
      ref: {
        page: 4,
        excerpt: "Byggnadernas totalyta är 2 329 kvm.",
      },
    },
    {
      falt: "bostadsrattsyta",
      label: "Bostadsrättsyta",
      rapport: 2145,
      status: "endast_rapport",
      anvant: 2145,
      text: "Enligt årsredovisningen: 2 145,0 m².",
      ref: {
        page: 4,
        excerpt: "39 bostadsrätter om totalt 2 145 kvm",
      },
    },
    {
      falt: "totalSkuld",
      label: "Föreningens skuld",
      rapport: 7759091,
      status: "endast_rapport",
      anvant: 7759091,
      text: "Enligt årsredovisningen: 7 759 091 kr.",
      ref: {
        page: 18,
        excerpt: "Summa 7 759 091 7 329 735",
      },
    },
  ],
  gratisSektioner: ["betyg", "rodaFlaggor_topp2", "datakvalitet"],
  sammanfattning: {
    betyg:
      "Föreningen får betyget B. Ekonomin ser stabil ut, med några punkter att hålla koll på. Viktigast att känna till: Tre fjärdedelar av lånen ska omsättas 2026.",
    pris: "Värdet med hänsyn till föreningens ekonomi är ca 5 570 000 kr. Jämförbara lägenheter säljs för ca 5 680 000 kr. Utgångspriset 4 995 000 kr ligger 10,4 % under värderingen. Bostäder i Kungsholmen har i mitten sålts för 5,4 % över utgångspriset. Ett slutpris på den nivån, ca 5 270 000 kr, skulle ligga 5,5 % under Binfos värdering, så priset kan vara attraktivt även efter en vanlig budgivning.",
    avgift:
      "Utifrån årsredovisningen väntar vi oss att avgiften höjs med ca 370 kr i månaden under de närmaste två åren, från 3 503 till ungefär 3 880 kr. Störst påverkan: sparande mot underhållsbehov. För en del saknas underlag i årsredovisningen, så höjningen kan bli större.",
    slutsats:
      "Sammantaget: betyg B, en värdering på ca 5 570 000 kr och en väntad avgiftshöjning på ca 370 kr i månaden. Det här är underlag, inte ett råd — gå igenom frågorna till styrelsen och mäklaren innan du bestämmer hur mycket du vill bjuda.",
  },
};
