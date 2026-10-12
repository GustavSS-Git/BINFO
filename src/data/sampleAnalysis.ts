import type { AnalysisResult } from "@/types/analysis";

/**
 * A real AnalysisResult from the real pipeline: Brf Pontonjären 3 (716420-0599),
 * årsredovisning 2025. The apartment input comes from a real listing on
 * Baltzar von Platens gata 6 (Kungsholmen), supplied by the owner.
 *
 * Generated 2026-10-12 with
 *   ANTHROPIC_MODEL=claude-sonnet-5-5 node --import tsx src/lib/analysis/cli.ts \
 *     "<Årsredovisning 2025 (1).pdf>" <input.json>
 * model claude-sonnet-5-5, valuation model valuation-v3.1.
 * Regenerate rather than hand-edit. Powers the static example report at
 * src/routes/exempel.tsx.
 */
export const sampleAnalysis: AnalysisResult = {
  schemaVersion: "1.0.0",
  analysisId: "313d800b-b4a3-41dd-a734-fc5f43e951e4",
  skapad: "2026-10-12T16:00:30.193Z",
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
        excerpt: "Föreningen har 39 bostadsrätter om totalt 2 145 kvm",
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
    rakenskapsar: 2025,
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
        forklaring: "Hur mycket föreningen har lånat per kvadratmeter bostadsrättsyta.",
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
        forklaring:
          "Hur mycket avgifterna behöver höjas i procent om räntan går upp en procentenhet.",
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
        forklaring: "Vad el, vatten och värme kostar föreningen per kvadratmeter och år.",
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
          excerpt: "Summa 7 759 091",
        },
      },
      forfalloprofil: [
        {
          ar: 2026,
          belopp: {
            value: 683080,
            unit: "kr",
            source: "arsredovisning",
            ref: {
              page: 18,
              excerpt: "SEB 2026-11-28 2,51 % 683 080",
            },
          },
          ranta: {
            value: 2.51,
            unit: "procent",
            source: "arsredovisning",
            ref: {
              page: 18,
              excerpt: "SEB 2026-11-28 2,51 % 683 080",
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
              excerpt: "SEB 2026-09-28 4,49 % 1 180 000",
            },
          },
          ranta: {
            value: 4.49,
            unit: "procent",
            source: "arsredovisning",
            ref: {
              page: 18,
              excerpt: "SEB 2026-09-28 4,49 % 1 180 000",
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
              excerpt: "SEB 2026-12-28 2,43 % 970 000",
            },
          },
          ranta: {
            value: 2.43,
            unit: "procent",
            source: "arsredovisning",
            ref: {
              page: 18,
              excerpt: "SEB 2026-12-28 2,43 % 970 000",
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
              excerpt: "SEB 2028-10-28 2,98 % 2 000 000",
            },
          },
          ranta: {
            value: 2.98,
            unit: "procent",
            source: "arsredovisning",
            ref: {
              page: 18,
              excerpt: "SEB 2028-10-28 2,98 % 2 000 000",
            },
          },
        },
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
    },
    vasentligaHandelser: [
      {
        text: "Årsavgifterna höjdes med 22 % från 1 maj 2025 på grund av uteblivna hyresintäkter från lokalen.",
        ref: {
          page: 7,
          excerpt: "Årsavgifterna höjdes med 22 % från och med 1 maj 2025",
        },
      },
      {
        text: "Köksstambytet avslutades med godkänd slutbesiktning i mars 2025.",
        ref: {
          page: 7,
          excerpt: "Köksstambytet avslutades med godkänd slutbesiktning i mars 2025.",
        },
      },
      {
        text: "Lån om 500 000 kr upptogs i april 2025 för att täcka kostnader för stambytet.",
        ref: {
          page: 7,
          excerpt: "upptogs i april 2025 ett lån om 500 000 kr",
        },
      },
      {
        text: "Extrastämma med stadgeändring för att möjliggöra bredare uthyrning av lokalen.",
        ref: {
          page: 7,
          excerpt: "extrastämma under året med stadgeändring för att möjliggöra bredare uthyrning.",
        },
      },
      {
        text: "Balkongprojektet har planerad byggstart i januari 2026.",
        ref: {
          page: 7,
          excerpt: "planerad byggstart i januari 2026",
        },
      },
    ],
  },
  betyg: "B",
  betygMotivering:
    "Inget av nyckeltalen har status svag eller kritisk. Skulden är låg jämfört med riktvärdet, sparandet är gott och räntekänsligheten är måttlig. Betyget hålls tillbaka av tre saker som siffrorna inte visar. Cirka 74 % av lånen ska omsättas redan 2026. Föreningen har förlorat hyresintäkter från lokalen och höjde därför avgifterna med 22 %. Underhållsplanen nämner ett byte av undercentralen utan någon kostnad eller finansiering. Underlaget är i övrigt komplett och tillförlitligt.",
  rodaFlaggor: [
    {
      id: "stor-omsattning-2026",
      titel: "Nästan tre fjärdedelar av lånen ska omsättas 2026",
      beskrivning:
        "Av en total skuld på 7 759 091 kr förfaller 5 759 091 kr (cirka 74 %) under 2026, fördelat på fyra lån. Ett av dem på 1 180 000 kr har 4,49 % ränta. De övriga ligger på 2,43–2,53 %, och snitträntan för hela skulden är 3,12 %. Räntekänsligheten är 4,2 %, så varje procentenhet högre ränta kräver cirka 4,2 % högre avgift. Det motsvarar cirka 57 600 kr om året på de lån som förfaller 2026. Om de nya lånen får högre ränta än i dag slår det direkt på din månadsavgift. Skuldnivån är låg, vilket dämpar risken.",
      severity: "medel",
      ref: {
        page: 18,
        excerpt: "SEB 2026-03-28 2,53 % 2 926 011",
      },
      harledsFran: ["rantekanslighet", "skuldsattning_per_m2_totalyta"],
    },
    {
      id: "avgiftshojning-lokal",
      titel: "Avgiften höjdes 22 % när lokalhyran föll bort",
      beskrivning:
        "Avgifterna höjdes med 22 % från 1 maj 2025 på grund av uteblivna hyresintäkter från lokalen. Avgifterna står nu för 99,7 % av föreningens intäkter, mot 81,4 % året innan. Årsavgiften på 861 kr/m² för 2025 innehåller bara åtta månader med den nya nivån, så din faktiska avgift är sannolikt högre än så. Om lokalen förblir outhyrd eller hyrs ut billigare bär medlemmarna hela bristen. Går den att hyra ut kan det i stället sänka trycket på avgiften.",
      severity: "medel",
      ref: {
        page: 7,
        excerpt: "Årsavgifterna höjdes med 22 % från och med 1 maj 2025",
      },
      harledsFran: ["arsavgift_per_m2_brf_yta", "arsavgift_andel_av_rorelseintakter"],
    },
    {
      id: "undercentral-ofinansierad",
      titel: "Byte av undercentral och nya sopkrav saknar kostnad",
      beskrivning:
        "Underhållsplanen anger kartläggning av undercentralen och en plan för byte, samt en lagstadgad insamling av avfall nära fastigheten senast 2027-01-01. Inga kostnader eller finansiering redovisas för någon av dem. Sparandet på 125 kr/m² är gott. Det motsvarar cirka 291 000 kr om året över hela ytan (125 × 2 329 m²), men det är osäkert om det räcker. Det går inte att utesluta lån eller avgiftshöjning längre fram. Köksstambytet är klart, och lånet på 500 000 kr för det är redan upptaget.",
      severity: "lag",
      ref: {
        page: 6,
        excerpt: "Kartläggning av undercentral och plan för byte",
      },
      harledsFran: ["sparande_per_m2_totalyta"],
    },
    {
      id: "energikostnad-aldre-hus",
      titel: "Energikostnaden ligger över riktvärdet i ett hus från 1931",
      beskrivning:
        "Energikostnaden är 238 kr/m² mot riktvärdet 203 kr/m². Skillnaden är 35 kr/m², cirka 81 500 kr om året för hela huset. Byggåret 1931 är sannolikt en del av förklaringen, eftersom äldre hus normalt har högre energikostnad. Du betalar den ändå via avgiften, och kostnaden har stigit varje år i femårsserien i årsredovisningen. Din egen elförbrukning ingår inte i avgiften, men värme och vatten gör det.",
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
  },
  fragor: [
    {
      id: "fraga-omsattning",
      fraga:
        "Vilka räntor har föreningen fått offererade för de lån på 5,76 miljoner kr som förfaller 2026, och vad blir avgiftseffekten om de landar på samma nivå som i dag?",
      ursprung: "analys",
      riktadTill: "styrelsen",
      varfor:
        "Nästan tre fjärdedelar av skulden omsätts under 2026. Svaret visar om en avgiftshöjning är att vänta.",
      ref: {
        page: 18,
        excerpt: "SEB 2026-09-28 4,49 % 1 180 000",
      },
    },
    {
      id: "fraga-lokal",
      fraga: "Är lokalen uthyrd i dag, och vilken hyra per år har den i så fall?",
      ursprung: "analys",
      riktadTill: "styrelsen",
      varfor:
        "Bortfallet av lokalhyran låg bakom avgiftshöjningen på 22 %. Svaret avgör om avgiften kan hålla sig kvar på dagens nivå eller sänkas.",
      ref: {
        page: 7,
        excerpt: "Årsavgifterna höjdes med 22 % från och med 1 maj 2025",
      },
    },
    {
      id: "fraga-aktuell-avgift",
      fraga:
        "Vad är månadsavgiften för just den här lägenheten i dag, och är fler avgiftshöjningar beslutade eller planerade?",
      ursprung: "analys",
      riktadTill: "maklaren",
      varfor:
        "Årsavgiften i årsredovisningen innehåller bara åtta månader med höjningen på 22 %, så din verkliga kostnad är sannolikt högre.",
      ref: {
        page: 8,
        excerpt: "Årsavgift / kvm upplåten bostadsrätt, kr 861 746 717 682",
      },
    },
    {
      id: "fraga-undercentral",
      fraga: "Vad beräknas bytet av undercentralen kosta, och när ska det göras och betalas?",
      ursprung: "analys",
      riktadTill: "styrelsen",
      varfor:
        "Underhållsplanen nämner bytet utan kostnad eller finansiering. En stor utgift kan kräva lån eller högre avgift.",
      ref: {
        page: 6,
        excerpt: "Kartläggning av undercentral och plan för byte",
      },
    },
    {
      id: "fraga-fni",
      fraga:
        "Vad beräknas den lagstadgade insamlingen av avfall nära fastigheten kosta, och är pengarna avsatta?",
      ursprung: "analys",
      riktadTill: "styrelsen",
      varfor:
        "Kravet gäller från 2027-01-01 och kostnaden finns inte redovisad. Den läggs på föreningens ekonomi och därmed på avgiften.",
      ref: {
        page: 6,
        excerpt:
          "Planering och installation av fastighetsnära insamling(FNI). (Krav enligt lag 2027-01-01).",
      },
    },
    {
      id: "saknad-avgift-bredband",
      fraga: "Ingår bredband i månadsavgiften?",
      ursprung: "saknad_uppgift",
      riktadTill: "maklaren",
      varfor: "Om bredband ingår i avgiften eller inte påverkar den faktiska månadskostnaden.",
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
  gratisSektioner: ["betyg", "rodaFlaggor_topp2", "datakvalitet"],
};
