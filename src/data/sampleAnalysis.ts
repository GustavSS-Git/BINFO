import type { AnalysisResult } from "@/types/analysis";

/**
 * A real AnalysisResult from the real pipeline: Brf Pontonjären 3 (716420-0599),
 * årsredovisning 2025. The apartment input comes from a real listing on
 * Baltzar von Platens gata 6 (Kungsholmen), supplied by the owner (sent without
 * ort and with värme/vatten "ingår", as the form does since 2026-10-26).
 *
 * Generated 2026-10-26 (PROMPT_VERSION 13, consistency round 2026-10-26) with
 *   EXTRACT_SPARA_UNDERLAG=<underlag.json> ANTHROPIC_MODEL=claude-sonnet-5-5  *     npm run -s extract -- "<Årsredovisning 2025 (1).pdf>" <input.json>
 * then re-assembled for free with scripts/monteraOm.ts <underlag.json>.
 * Model claude-sonnet-5-5, valuation model valuation-v3.1. The fee prognosis is
 * FROZEN at the calculation date below (a live report recomputes it on every
 * read, so loans past that date would show as matured). Regenerate rather than
 * hand-edit. Powers the static example report at src/routes/exempel.tsx.
 */
export const sampleAnalysis: AnalysisResult = {
  schemaVersion: "1.0.0",
  analysisId: "f1b94b65-feef-4efe-85c1-022d3522b202",
  skapad: "2026-10-26T20:21:24.533Z",
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
    vaning: 4,
    byggar: 1931,
    hiss: "ja",
    balkong: "nej",
    avgiftInkluderar: {
      varme: "ja",
      vatten: "ja",
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
        forklaring: "Vad du betalar per kvadratmeter och år i avgift.",
        benchmark: {
          value: 833,
          label: "Snitt Stockholm, årsavgift per m² bostadsrättsyta",
          source:
            "Tröskelvärden fastställda i BENCHMARKS.md (produktbeslut). Referenspunkt: Stockholmssnitt ~833 kr/m²/år (HSB Bostadsrättsbarometer 2025, 762 föreningar, räkenskapsår 2024).",
        },
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
        forklaring: "Hur mycket föreningen har lånat per kvadratmeter bostadsyta.",
        benchmark: {
          value: 7117,
          label: "Riksgenomsnitt, skuldsättning per m² bostadsrättsyta",
          source:
            "Tröskelvärden fastställda i BENCHMARKS.md (produktbeslut). Referenspunkt: riksgenomsnitt ~7 117 kr/m² (2023, Nabo/SCB-härlett).",
        },
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
        status: "acceptabel",
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
        forklaring:
          "Visar hur mycket avgiften skulle behöva höjas om räntan stiger med en procentenhet.",
        benchmark: {
          value: 10.3,
          label: "Riksgenomsnitt, räntekänslighet",
          source:
            "Tröskelvärden fastställda i BENCHMARKS.md (produktbeslut). Referenspunkt: riksgenomsnitt ~10,3 % (2023, Nabo).",
        },
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
        forklaring: "Vad föreningen betalar för energi per kvadratmeter och år.",
        benchmark: {
          value: 203,
          label: "Riksgenomsnitt, energikostnad per m² totalyta",
          source:
            "Tröskelvärden fastställda i BENCHMARKS.md (produktbeslut). Referenspunkt: riksgenomsnitt ~203 kr/m²/år (2023, SCB/Nabo).",
        },
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
          text: "Rensning av ventilations- och imkanaler i samtliga lägenheter och lokalen",
          ref: {
            page: 6,
            excerpt: "Rensning av ventilations- och imkanaler i samtliga lägenheter och lokeln.",
          },
        },
        {
          text: "Balkongbyggnation mot Pontonjärgården (medlemsfinansierat), planerad byggstart januari 2026",
          ref: {
            page: 6,
            excerpt:
              "Balkongbyggnation mot Pontonjärgården(medlemsfinansierat) hos intresserade medlemmar.",
          },
        },
        {
          text: "Planering och installation av fastighetsnära insamling (FNI)",
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
    genomfordaAtgarder: [
      {
        byggdel: "stambyte",
        ar: 2025,
        text: "Köksstambyte avslutat och byte av avloppsstammar i källaren",
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
      forlustsignaler: [
        {
          text: "Föreningens lokal har inte varit uthyrd och det är en utmaning att hitta lokalhyresgäst",
          ref: {
            page: 7,
            excerpt:
              "Utmaning att hitta lokalhyresgäst och därför extrastämma under året med stadgeändring för att möjliggöra",
          },
        },
      ],
    },
    avgiftsandringar: [
      {
        procent: {
          value: 22,
          unit: "procent",
          source: "arsredovisning",
          ref: {
            page: 7,
            excerpt: "Årsavgifterna höjdes med 22 % från och med 1 maj 2025",
          },
        },
        fran: "2025-05-01",
        status: "beslutad",
        text: "Årsavgifterna höjdes med 22 % från 1 maj 2025.",
        ref: {
          page: 7,
          excerpt: "Årsavgifterna höjdes med 22 % från och med 1 maj 2025",
        },
      },
    ],
    vasentligaHandelser: [
      {
        text: "Årsavgifterna höjdes med 22 % från 1 maj 2025 på grund av uteblivna hyresintäkter från lokalen.",
        ref: {
          page: 7,
          excerpt: "Årsavgifterna höjdes med 22 % från och med 1 maj 2025",
        },
      },
      {
        text: "Extra föreningsstämma 2025-03-31 beslutade om stadgeändring för lokaluthyrning.",
        ref: {
          page: 5,
          excerpt: "Extra föreningsstämma hölls 2025-03-31. Stadgeändring lokaluthyrning.",
        },
      },
      {
        text: "Köksstambytet avslutades i mars 2025 och lån om 500 000 kr upptogs i april 2025.",
        ref: {
          page: 7,
          excerpt:
            "I enlighet med fastställd plan upptogs i april 2025 ett lån om 500 000 kr för att täcka",
        },
      },
      {
        text: "Ny mäklare för lokalen: avtalet med Nextor avslutades och nytt avtal slöts med Oruz Commercial.",
        ref: {
          page: 7,
          excerpt:
            "Avtal med mäklare Nextor avslutat 22 oktober 2025. Nytt mäklaravtal slöts med Oruz Commercial.",
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
    "Alla sju nyckeltal är godkända eller ograderade: inget är svagt eller kritiskt. Skulden är låg (3 617 kr per kvadratmeter bostadsyta) och räntekänsligheten är 4,2 %. Det som håller tillbaka betyget är att avgiften nyligen höjdes med 22 % för att lokalen står tom. Avgiftsintäkterna är nästan hela föreningens intäkter (99,7 %), och lokalen kan fortfarande bli en kostnad för föreningen. Fonden för yttre underhåll är också liten jämfört med den årliga avsättningen. Underhållsplanen uppdaterades 2025 och inga stora, ofinansierade åtgärder syns, men byte av undercentralen är bara kartlagt och saknar kostnad.",
  rodaFlaggor: [
    {
      id: "tom-lokal-och-avgiftshojning",
      titel: "Tom lokal och 22 % avgiftshöjning",
      beskrivning:
        "Lokalen gav 0 kr i hyra under året, mot 289 180 kr året före. Föreningen höjde därför årsavgifterna med 22 % från 1 maj 2025. Nästan alla intäkter (99,7 %) kommer nu från medlemmarnas avgifter. Hittas ingen hyresgäst får medlemmarna fortsätta bära bortfallet, och ytterligare höjningar kan inte uteslutas. Hyrs lokalen ut kan trycket på avgiften minska.",
      severity: "medel",
      ref: {
        page: 7,
        excerpt: "Årsavgifterna höjdes med 22 % från och med 1 maj 2025",
      },
      harledsFran: ["arsavgift_andel_av_rorelseintakter", "arsavgift_per_m2_brf_yta"],
    },
    {
      id: "undercentral-utan-kostnad",
      titel: "Byte av undercentral utan kostnadsuppgift",
      beskrivning:
        "Underhållsplanen nämner kartläggning av undercentralen och en plan för byte, men ingen kostnad eller finansiering anges. Fonden för yttre underhåll är 294 000 kr, och årets avsättning är 288 000 kr. Blir bytet dyrt kan pengarna behöva komma från högre avgifter eller nya lån, vilket du som köper då delar på.",
      severity: "medel",
      ref: {
        page: 6,
        excerpt: "Kartläggning av undercentral och plan för byte",
      },
      harledsFran: ["sparande_per_m2_totalyta", "skuldsattning_per_m2_totalyta"],
    },
    {
      id: "refinansiering-berakning",
      titel: "59,0 % av lånen får ny ränta inom 24 månader",
      beskrivning:
        "4 579 091 kr av föreningens lån (59,0 % av skulden på 7 759 091 kr) får ny ränta inom 24 månader från 26 oktober 2026: rörliga lån på 2 926 011 kr, som följer marknaden löpande, och lån på 1 653 080 kr med villkorsändringsdag inom perioden. Räntan går från i snitt 2,51 % till 2,65 %. Lån på 1 180 000 kr (villkorsändringsdag 28 september 2026) har troligen redan fått nya villkor som vi inte känner till; de räknas inte i beräkningen. Vid dagens ränta höjer det avgiften med ca 13 kr/mån enligt Binfos beräkning.",
      severity: "medel",
      ref: {
        page: 18,
        excerpt: "SEB 2026-11-28 2,51 % 683 080 699 760",
      },
      harledsFran: ["rantekanslighet", "skuldsattning_per_m2_totalyta"],
    },
    {
      id: "energikostnad-over-riktvarde",
      titel: "Energikostnaden ligger över riktvärdet",
      beskrivning:
        "Energikostnaden är 238 kr per kvadratmeter, mot riktvärdet 203 kr. Statusen är acceptabel, men kostnaden ingår i avgiften, eftersom värme ingår.",
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
      "Utgångspriset är i linje med modellen: det ligger inom det ungefärliga spannet 4 990 000 – 6 100 000 kr (±10 %) kring värdet med hänsyn till föreningens ekonomi. Värderingen speglar prisläget jan–aug 2026 och är en statistisk skattning — inte en besiktning av just den här lägenheten.",
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
          value: -134109,
          unit: "kr",
          source: "berakning",
        },
        krPerKrManad: 290,
        forklaring:
          "Årsredovisningen pekar på att din avgift kan stiga med cirka 463 kr i månaden inom 24 månader. I Binfos data hänger en högre månadsavgift ihop med ett lägre pris, ungefär 290 kr per krona i månadsavgift för en lägenhet som den här. Det är ett statistiskt samband, inte ett orsakssamband.",
      },
    ],
    justeradVardering: {
      value: 5547498,
      unit: "kr",
      source: "schablon",
      schablonBasis:
        "Binfos värdering justerad för den avgiftshöjning årsredovisningen pekar på, med modellens samband mellan månadsavgift och pris.",
      range: {
        low: 4535092,
        high: 6535931,
      },
    },
    avvikelseMotJusteradVardering: -10,
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
          manadsavgift: 3966,
          forandringKr: 463,
        },
        {
          id: "plus1",
          label: "+1 procentenhet",
          manadsavgift: 4113,
          forandringKr: 610,
        },
        {
          id: "plus2",
          label: "+2 procentenheter",
          manadsavgift: 4260,
          forandringKr: 757,
        },
      ],
      kommentar:
        "Raderna +1 och +2 procentenheter läggs ovanpå den förväntade avgiften och gäller hela skulden via räntekänsligheten.",
    },
  },
  fragor: [
    {
      id: "fraga-lokal-hyresgast",
      fraga:
        "Finns det en hyresgäst eller ett påskrivet hyresavtal för lokalen, och vilken hyra räknar styrelsen med?",
      ursprung: "analys",
      riktadTill: "styrelsen",
      varfor: "Lokalen gav 0 kr i hyra och avgiften höjdes med 22 % för att täcka bortfallet.",
      ref: {
        page: 7,
        excerpt:
          "Utmaning att hitta lokalhyresgäst och därför extrastämma under året med stadgeändring för att möjliggöra",
      },
      svarssignal:
        "Bra svar: ett signerat avtal med en hyra som täcker bortfallet. Varningssignal: att uthyrningen fortfarande bara är på planeringsstadiet.",
    },
    {
      id: "fraga-fler-avgiftshojningar",
      fraga:
        "Har styrelsen beslutat om eller planerar den ytterligare avgiftshöjningar utöver höjningen på 22 %?",
      ursprung: "analys",
      riktadTill: "styrelsen",
      varfor:
        "Avgiften höjdes med 22 % från 1 maj 2025 och intäkterna bärs nästan helt av avgifterna.",
      ref: {
        page: 7,
        excerpt: "Årsavgifterna höjdes med 22 % från och med 1 maj 2025",
      },
      svarssignal:
        "Bra svar: budgeten går ihop utan fler höjningar även om lokalen förblir tom. Varningssignal: att styrelsen räknar med fler höjningar om lokalen inte hyrs ut.",
    },
    {
      id: "fraga-undercentral-kostnad",
      fraga: "Vad beräknas ett byte av undercentralen kosta, och hur ska det finansieras?",
      ursprung: "analys",
      riktadTill: "styrelsen",
      varfor:
        "Underhållsplanen nämner byte av undercentral utan kostnad, och underhållsfonden är 294 000 kr.",
      ref: {
        page: 6,
        excerpt: "Kartläggning av undercentral och plan för byte",
      },
      svarssignal:
        "Bra svar: en kalkyl finns och täcks av fonden och avsättningarna. Varningssignal: att kostnaden är okänd eller att lån eller avgiftshöjning redan är förutsatt.",
    },
    {
      id: "fraga-fond-minskning",
      fraga:
        "Varför minskade fonden för yttre underhåll från 1 780 895 kr till 294 000 kr, och vad användes pengarna till?",
      ursprung: "analys",
      riktadTill: "styrelsen",
      varfor:
        "Fonden är nu 294 000 kr medan årets avsättning är 288 000 kr, och köksstambytet avslutades under året.",
      ref: {
        page: 12,
        excerpt: "Fond för yttre underhåll 294 000 1 780 895",
      },
      svarssignal:
        "Bra svar: fonden användes till det avslutade stambytet enligt plan. Varningssignal: att en del gått till löpande kostnader.",
    },
    {
      id: "fraga-balkonger",
      fraga:
        "Kan balkongbyggnationen mot Pontonjärgården medföra några kostnader eller risker för föreningen, eller bärs allt av de medlemmar som beställer?",
      ursprung: "analys",
      riktadTill: "styrelsen",
      varfor:
        "Balkongerna är markerade som medlemsfinansierade med planerad byggstart i januari 2026.",
      ref: {
        page: 6,
        excerpt:
          "Balkongbyggnation mot Pontonjärgården(medlemsfinansierat) hos intresserade medlemmar.",
      },
      svarssignal:
        "Bra svar: varje beställande medlem står för hela kostnaden och föreningen har inga åtaganden. Varningssignal: att föreningen går i borgen eller förskotterar pengar.",
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
    uppgifterTotalt: 7,
    saknadeFalt: ["avgiftInkluderar.el", "avgiftInkluderar.bredband", "avgiftInkluderar.tv"],
  },
  avgiftsprognos: {
    horisontManader: 24,
    berakningsdatum: "2026-10-26",
    andel: {
      varde: 0.023659700161873864,
      metod: "avgiftsandel",
    },
    komponenter: [
      {
        id: "spargap",
        label: "Sparande mot underhållsbehov",
        status: "beraknad",
        foreningKrPerAr: 228242,
        forklaring:
          "Sparandet är 125 kr/m² mot Binfos mål 321 kr/m² (schablonen 300 kr/m², justerad för byggnadsdelarnas ålder) – ett glapp på 196 kr/m². Vi räknar halva glappet på föreningens totalyta 2 329 m²: 228 242 kr/år. Din andel är 2,37 % (din avgift × 12 ÷ föreningens årsavgifter ≈ 1,78 mkr), alltså ca 450 kr/mån.",
        krPerManad: 450,
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
        foreningKrPerAr: 6510,
        forklaring:
          "Lån på 1 180 000 kr hade villkorsändringsdag 28 september 2026 och har troligen redan fått nya villkor som vi inte känner till; de räknas inte. 4 579 091 kr av lånen ska omsättas inom 24 månader. Räntan går från i snitt 2,51 % till 2,65 % (3-månaders statsskuldväxel 2,07 % plus 0,58 procentenheter), vilket höjer föreningens kostnad med cirka 6 510 kr per år. Din andel är 2,37 % (din avgift × 12 ÷ föreningens årsavgifter ≈ 1,78 mkr), alltså ca 13 kr/mån.",
        krPerManad: 13,
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
      {
        id: "beslutad_hojning",
        label: "Beslutad avgiftshöjning som inte har trätt i kraft",
        status: "ej_aktuell",
        foreningKrPerAr: 0,
        forklaring:
          "Årsredovisningen nämner ingen beslutad eller planerad höjning av årsavgiften som ännu inte gäller.",
        krPerManad: null,
      },
    ],
    totalKrPerManad: 463,
    tryck: "rod",
    sparbehov: {
      malKrPerM2: 321,
      malKalla: "schablon",
      sparandeKrPerM2: 125,
      sparandeRef: {
        page: 8,
        excerpt: "Sparande / kvm totalyta, kr 125 184 229 237",
      },
      glappKrPerM2: 196,
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
          senast: 1931,
          senastKalla: "byggar",
          livslangd: {
            lag: 20,
            hog: 60,
          },
          status: "eftersatt",
        },
        {
          byggdel: "fasad",
          label: "Fasad",
          senast: 1931,
          senastKalla: "byggar",
          livslangd: {
            lag: 20,
            hog: 100,
          },
          status: "ok",
        },
        {
          byggdel: "fonster",
          label: "Fönster",
          senast: 1931,
          senastKalla: "byggar",
          livslangd: {
            lag: 40,
            hog: 60,
          },
          status: "eftersatt",
        },
        {
          byggdel: "ventilation",
          label: "Ventilation",
          senast: 1931,
          senastKalla: "byggar",
          livslangd: {
            lag: 20,
            hog: 100,
          },
          status: "ok",
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
      forfallandeBelopp: 4579091,
      nuvarandeRantaProcent: 2.51,
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
      antalLan: 3,
      lan: [
        {
          belopp: 1180000,
          rantaProcent: 4.49,
          dag: "2026-09-28",
          rorlig: false,
          fas: "forfallit",
          vikt: 0,
          foreningKrPerAr: null,
          ref: {
            page: 18,
            excerpt: "SEB 2026-09-28 4,49 % 1 180 000 1 180 000",
          },
        },
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
      status: "manuellt",
      anvant: 1931,
      text: "Finns inte i årsredovisningen, du angav 1931.",
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
      "Föreningen får betyget B. Ekonomin ser stabil ut, med några punkter att hålla koll på. Viktigast att känna till: Tom lokal och 22 % avgiftshöjning.",
    pris: "Värdet med hänsyn till föreningens ekonomi är ca 5 550 000 kr. Jämförbara lägenheter säljs för ca 5 680 000 kr. Utgångspriset 4 995 000 kr ligger i linje med modellen, inom det ungefärliga spannet 4 990 000 – 6 100 000 kr (±10 %). Bostäder i Kungsholmen har i mitten sålts för 5,4 % över utgångspriset. Ett slutpris på den nivån, ca 5 270 000 kr, skulle ligga i linje med modellen.",
    avgift:
      "Utifrån årsredovisningen väntar vi oss att avgiften höjs med ca 460 kr i månaden under de närmaste två åren, från 3 503 till ungefär 3 970 kr. Störst påverkan: sparande mot underhållsbehov. 59,0 % av lånen (4 579 091 kr) får ny ränta inom 24 månader, vilket vid dagens ränta höjer avgiften med ca 13 kr/mån; lån på 1 180 000 kr har troligen redan fått nya villkor som vi inte känner till. För en del saknas underlag i årsredovisningen, så höjningen kan bli större.",
    slutsats:
      "Sammantaget: betyg B, en värdering på ca 5 550 000 kr och en väntad avgiftshöjning på ca 460 kr i månaden. Det här är underlag, inte ett råd — gå igenom frågorna till styrelsen och mäklaren innan du bestämmer hur mycket du vill bjuda.",
  },
};
