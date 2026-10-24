import type { AnalysisResult } from "@/types/analysis";

/**
 * A real AnalysisResult from the real pipeline: Brf Pontonjären 3 (716420-0599),
 * årsredovisning 2025. The apartment input comes from a real listing on
 * Baltzar von Platens gata 6 (Kungsholmen), supplied by the owner.
 *
 * Generated 2026-10-24 (PROMPT_VERSION 9, fee prognosis round) with
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
  analysisId: "5458820d-cb63-4b53-adc2-969f135c7789",
  skapad: "2026-10-24T11:59:04.883Z",
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
        excerpt: "Byggnadernas totalyta är 2 329",
      },
    },
    bostadsrattsyta: {
      value: 2145,
      unit: "m2",
      source: "arsredovisning",
      ref: {
        page: 4,
        excerpt: "Föreningen har 39 bostadsrätter om totalt 2 145 kvm",
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
            excerpt: "rörelseintäkter (%) 99,7 81,4 83,8 85,0",
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
        forklaring: "Hur mycket föreningen lånat per kvadratmeter totalyta.",
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
            excerpt: "3 617 3 417 2 535 2 821",
          },
        },
        status: "acceptabel",
        benchmark: {
          value: 7117,
          label: "Riksgenomsnitt, skuldsättning per m² bostadsrättsyta",
          source:
            "Tröskelvärden fastställda i BENCHMARKS.md (produktbeslut). Referenspunkt: riksgenomsnitt ~7 117 kr/m² (2023, Nabo/SCB-härlett).",
        },
        forklaring: "Hur mycket föreningen lånat per kvadratmeter bostadsrättsyta.",
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
        forklaring: "Hur mycket avgifterna behöver höjas om räntan stiger med en procentenhet.",
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
        forklaring: "Vad föreningen betalar för energi per kvadratmeter och år.",
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
        excerpt: "Föreningen har 39 bostadsrätter om totalt 2 145 kvm och 2 lokaler om 184 kvm.",
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
          text: "Balkongbyggnation (medlemsfinansierat), planerad byggstart januari 2026",
          ref: {
            page: 7,
            excerpt:
              "planering av balkongprojektet har färdigställts, med planerad byggstart i januari 2026.",
          },
        },
        {
          text: "Planering och installation av fastighetsnära insamling (FNI), lagkrav 2027-01-01",
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
      arligAvsattning: {
        value: 288000,
        unit: "kr",
        source: "arsredovisning",
        ref: {
          page: 9,
          excerpt: "Reservering fond för yttre underhåll 288 000",
        },
      },
    },
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
        text: "Extra föreningsstämma med stadgeändring för att möjliggöra bredare lokaluthyrning.",
        ref: {
          page: 5,
          excerpt: "Extra föreningsstämma hölls 2025-03-31. Stadgeändring lokaluthyrning.",
        },
      },
      {
        text: "Köksstambytet avslutades med godkänd slutbesiktning i mars 2025, samt kompletterande åtgärder.",
        ref: {
          page: 7,
          excerpt: "Köksstambytet avslutades med godkänd slutbesiktning i mars 2025.",
        },
      },
      {
        text: "Lån om 500 000 kr upptogs i april 2025 för att täcka återstående kostnader för stambyte.",
        ref: {
          page: 7,
          excerpt: "upptogs i april 2025 ett lån om 500 000 kr",
        },
      },
      {
        text: "Förlusten förklaras av stambytet och bytet av bottenavloppet samt ökade driftskostnader.",
        ref: {
          page: 8,
          excerpt: "Förlusten förklaras i huvudsak av stambytet och bytet av bottenavloppet",
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
    "Inget av nyckeltalen är svagt eller kritiskt, och sparandet är bra (status god). Räntekänsligheten är låg: 4,2 % avgiftshöjning per procentenhets ränteökning. Betyget stannar på B i stället för A av tre skäl: 74 % av lånen förfaller redan 2026, avgiften höjdes nyligen med 22 % och föreningen saknar hyresintäkter från lokalerna. Dessutom är fonden för yttre underhåll mycket mindre än året före, och det står oklart hur de kommande åtgärderna ska finansieras.",
  rodaFlaggor: [
    {
      id: "lan-omsattning-2026",
      titel: "Nästan tre fjärdedelar av lånen ska omsättas 2026",
      beskrivning:
        "Lån på 5 759 091 kr, 74 % av skulden, förfaller under 2026. De flesta av dem ligger på 2,43–2,53 % och ett på 4,49 %. Föreningens snittränta är 3,12 %. Om de nya lånen får högre ränta än de gamla slår det igenom på avgiften. Räntekänsligheten på 4,2 % betyder att varje procentenhet högre ränta kräver cirka 4,2 % högre avgift. Skulden är låg per kvadratmeter, så risken är hanterbar, men den finns.",
      severity: "medel",
      ref: {
        page: 18,
        excerpt: "SEB 2026-03-28 2,53 % 2 926 011",
      },
      harledsFran: ["rantekanslighet", "skuldsattning_per_m2_totalyta"],
    },
    {
      id: "avgiftshojning-lokal-tom",
      titel: "Avgiften höjdes 22 % och lokalerna ger ingen hyra",
      beskrivning:
        "Årsavgifterna höjdes med 22 % från 1 maj 2025 eftersom lokalen stod outhyrd. Hyresintäkterna från lokalerna är 0 kr, mot 289 180 kr året före. Nästan hela intäkten, 99,7 %, kommer nu från medlemmarnas avgifter. Blir lokalerna inte uthyrda finns risken att avgiften behöver höjas igen. Går de att hyra ut kan det i stället ge utrymme.",
      severity: "medel",
      ref: {
        page: 7,
        excerpt: "Årsavgifterna höjdes med 22 % från och med 1 maj 2025",
      },
      harledsFran: ["arsavgift_andel_av_rorelseintakter", "arsavgift_per_m2_brf_yta"],
    },
    {
      id: "underhallsfond-minskat",
      titel: "Fonden för yttre underhåll har krympt kraftigt",
      beskrivning:
        "Fonden är 294 000 kr, mot 1 780 895 kr året före. Stambytet är slutfört, så minskningen hänger sannolikt ihop med det. Samtidigt väntar flera åtgärder: undercentral, fastighetsnära insamling med lagkrav 2027 och cykelställ. Rapporten anger inte vad de kostar eller hur de ska betalas. Huset är byggt 1931. Finansieras åtgärderna med nya lån eller höjd avgift märker du det i plånboken.",
      severity: "medel",
      ref: {
        page: 12,
        excerpt: "Fond för yttre underhåll 294 000 1 780 895",
      },
      harledsFran: ["sparande_per_m2_totalyta", "skuldsattning_per_m2_totalyta"],
    },
    {
      id: "energikostnad-aldre-hus",
      titel: "Energikostnaden är högre än riktvärdet",
      beskrivning:
        "Energikostnaden är 238 kr/m² och år, mot riktvärdet 203 kr/m². Huset är från 1931, och det är sannolikt en del av förklaringen. Du betalar ändå kostnaden via avgiften, eftersom värme ingår. Kostnaden har stigit varje år i femårsöversikten.",
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
        excerpt: "3 617 3 417 2 535 2 821",
      },
    },
    justeringar: [
      {
        id: "forvantad_avgiftshojning",
        label: "Väntad avgiftshöjning",
        belopp: {
          value: 8690,
          unit: "kr",
          source: "berakning",
        },
        krPerKrManad: 290,
        forklaring:
          "Årsredovisningen pekar på att din avgift kan sjunka med cirka 30 kr i månaden inom 24 månader. I Binfos data hänger en högre månadsavgift ihop med ett lägre pris, ungefär 290 kr per krona i månadsavgift för en lägenhet som den här. Det är ett statistiskt samband, inte ett orsakssamband.",
      },
    ],
    justeradVardering: {
      value: 5690297,
      unit: "kr",
      source: "schablon",
      schablonBasis:
        "Binfos värdering justerad för den avgiftshöjning årsredovisningen pekar på, med modellens samband mellan månadsavgift och pris.",
      range: {
        low: 4677891,
        high: 6678730,
      },
    },
    avvikelseMotJusteradVardering: -12.2,
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
          manadsavgift: 3473,
          forandringKr: -30,
        },
        {
          id: "plus1",
          label: "+1 procentenhet",
          manadsavgift: 3587,
          forandringKr: 84,
        },
        {
          id: "plus2",
          label: "+2 procentenheter",
          manadsavgift: 3700,
          forandringKr: 197,
        },
      ],
      kommentar:
        "Raderna +1 och +2 procentenheter gäller bara den del av skulden som prissätts om inom 24 månader, 5 759 091 kr, och läggs ovanpå den förväntade avgiften.",
    },
  },
  fragor: [
    {
      id: "fraga-omsattning-ranta",
      fraga:
        "Vilken ränta har styrelsen fått i offert för de lån på 5 759 091 kr som förfaller 2026, och har de räknat på vad det betyder för avgiften?",
      ursprung: "analys",
      riktadTill: "styrelsen",
      varfor: "74 % av lånen förfaller 2026, och snitträntan är 3,12 %.",
      ref: {
        page: 18,
        excerpt: "SEB 2026-03-28 2,53 % 2 926 011",
      },
      svarssignal:
        "Bra svar: styrelsen har offerter och har räknat på avgiften med dagens ränta. Varningssignal: att styrelsen inte vet vad de nya lånen kommer att kosta.",
    },
    {
      id: "fraga-fler-avgiftshojningar",
      fraga:
        "Finns det beslut eller planer på ytterligare avgiftshöjningar efter höjningen på 22 % i maj 2025?",
      ursprung: "analys",
      riktadTill: "styrelsen",
      varfor:
        "Avgiften höjdes med 22 % från 1 maj 2025, och hyresintäkterna från lokalerna är 0 kr.",
      ref: {
        page: 7,
        excerpt: "Årsavgifterna höjdes med 22 % från och med 1 maj 2025",
      },
      svarssignal:
        "Bra svar: styrelsen bedömer att nuvarande avgift räcker och kan visa en budget. Varningssignal: att höjningen beskrivs som en första etapp eller att budgeten saknas.",
    },
    {
      id: "fraga-lokaler-uthyrning",
      fraga:
        "Finns det en hyresgäst eller ett avtal på plats för de två lokalerna, och vilken hyra räknar styrelsen med?",
      ursprung: "analys",
      riktadTill: "styrelsen",
      varfor:
        "Lokalerna gav 0 kr i hyra, mot 289 180 kr året före, och det var skälet till avgiftshöjningen.",
      ref: {
        page: 15,
        excerpt: "Hyresintäkter, lokaler 0 289 180",
      },
      svarssignal:
        "Bra svar: ett tecknat avtal eller konkreta intressenter. Varningssignal: att lokalerna har stått tomma länge utan intressenter.",
    },
    {
      id: "fraga-kostnad-atgarder",
      fraga:
        "Vad beräknas undercentralsbytet och fastighetsnära insamlingen kosta, och hur ska de betalas?",
      ursprung: "analys",
      riktadTill: "styrelsen",
      varfor:
        "Fonden för yttre underhåll har minskat från 1 780 895 kr till 294 000 kr, medan flera åtgärder väntar.",
      ref: {
        page: 6,
        excerpt: "Kartläggning av undercentral och plan för byte",
      },
      svarssignal:
        "Bra svar: kostnaderna är kalkylerade och täcks av avsättningar eller beslutad finansiering. Varningssignal: att styrelsen räknar med nya lån eller avgiftshöjning utan att ha beslutat om det.",
    },
    {
      id: "fraga-balkongprojekt",
      fraga:
        "Vad kostar balkongprojektet den som köper lägenheten, och påverkar det avgiften eller föreningens lån?",
      ursprung: "analys",
      riktadTill: "maklaren",
      varfor: "Balkongbyggnationen är medlemsfinansierad med planerad byggstart i januari 2026.",
      ref: {
        page: 7,
        excerpt:
          "planering av balkongprojektet har färdigställts, med planerad byggstart i januari 2026.",
      },
      svarssignal:
        "Bra svar: kostnaden per lägenhet är känd och påverkar inte föreningens lån. Varningssignal: att köparen kan få en extra kostnad som inte syns i avgiften.",
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
        label: "Sparandet täcker inte kostnaderna",
        status: "ej_aktuell",
        foreningKrPerAr: 0,
        forklaring: "Föreningens sparande är inte negativt, så det finns inget glapp att täcka.",
        krPerManad: null,
        ref: {
          page: 8,
          excerpt: "Sparande / kvm totalyta, kr 125 184 229 237",
        },
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
    totalKrPerManad: -30,
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
        excerpt: "Byggnadernas totalyta är 2 329",
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
        excerpt: "Föreningen har 39 bostadsrätter om totalt 2 145 kvm",
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
      "Föreningen får betyget B. Ekonomin ser stabil ut, med några punkter att hålla koll på. Viktigast att känna till: Nästan tre fjärdedelar av lånen ska omsättas 2026.",
    pris: "Binfos värdering är ca 5 690 000 kr efter justering för den väntade avgiftshöjningen (ca 5 680 000 kr före justering). Utgångspriset 4 995 000 kr ligger 12,2 % under värderingen. Bostäder i Kungsholmen har i mitten sålts för 5,4 % över utgångspriset. Ett slutpris på den nivån, ca 5 270 000 kr, skulle ligga 7,5 % under Binfos värdering, så priset kan vara attraktivt även efter en vanlig budgivning.",
    avgift:
      "Utifrån årsredovisningen väntar vi oss att avgiften sänks med ca 30 kr i månaden under de närmaste två åren, från 3 503 till ungefär 3 470 kr. Störst påverkan: lån som ska omsättas. För en del saknas underlag i årsredovisningen, så avgiften kan bli högre än så.",
    slutsats:
      "Sammantaget: betyg B, en värdering på ca 5 690 000 kr och en väntad avgiftssänkning på ca 30 kr i månaden. Det här är underlag, inte ett råd — gå igenom frågorna till styrelsen och mäklaren innan du bestämmer hur mycket du vill bjuda.",
  },
};
