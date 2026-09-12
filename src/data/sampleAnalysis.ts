import type { AnalysisResult } from "@/types/analysis";

/**
 * A real AnalysisResult, produced by running an actual annual report
 * (Brf Granen 10-11) through the actual extraction + analysis pipeline —
 * not hand-invented. Used to wire the UI to the real contract shape while
 * the pipeline isn't yet exposed over an API.
 *
 * NOTE: this file may also be created independently by another agent
 * wiring src/routes/analys.tsx in parallel. If both versions exist when
 * branches merge, a human reconciles them — expected, not an error.
 */
export const sampleAnalysis: AnalysisResult = {
  schemaVersion: "1.0.0",
  analysisId: "7915057b-5cbc-479e-8e0a-985db3b2ed37",
  skapad: "2026-09-12T16:26:31.734Z",

  input: {
    kind: "bostadsratt",
    utgangspris: 3_200_000,
    boarea: 54,
    antalRum: 2,
    manadsavgift: 3_800,
    andelstal: 1.8,
    orgnr: "769616-0253",
    adress: "Granstigen 10",
    postnummer: "123 45",
    ort: "Stockholm",
    hiss: "okant",
    balkong: "ja",
    avgiftInkluderar: {
      varme: "okant",
      vatten: "okant",
      el: "okant",
      bredband: "okant",
      tv: "okant",
    },
    antalPersoner: 2,
    antalLantagare: 2,
  },

  forening: {
    namn: "Brf Granen 10-11",
    orgnr: "769616-0253",
    akta: "ja",
    byggar: {
      value: 1935,
      unit: "ar",
      source: "arsredovisning",
      ref: { page: 4, excerpt: "Värdeåret är 1935." },
    },
    antalLagenheter: {
      value: 49,
      unit: "antal",
      source: "arsredovisning",
      ref: { page: 4, excerpt: "Föreningen har 49 bostadsrätter om totalt 2 690 kvm" },
    },
    totalyta: {
      value: 3_040,
      unit: "m2",
      source: "arsredovisning",
      ref: { page: 4, excerpt: "Byggnadernas totalyta är 3 040 kvm." },
    },
    rakenskapsar: 2025,
    keyFigures: [
      {
        id: "arsavgift_per_m2_brf_yta",
        label: "Årsavgift per m² upplåten med bostadsrätt",
        figure: {
          value: 1_006,
          unit: "kr/m2",
          source: "arsredovisning",
          ref: { page: 9, excerpt: "Årsavgift / kvm upplåten bostadsrätt, kr 1 006" },
        },
        status: "svag",
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
        label: "Årsavgifternas andel av totala rörelseintäkter",
        figure: {
          value: 80.1,
          unit: "procent",
          source: "arsredovisning",
          ref: { page: 9, excerpt: "Årsavgifternas andel av totala rörelseintäkter (%) 80,1" },
        },
        status: "okant",
        forklaring: "Hur stor del av föreningens intäkter som kommer från medlemmarnas avgifter.",
      },
      {
        id: "skuldsattning_per_m2_totalyta",
        label: "Skuldsättning per m² totalyta",
        figure: {
          value: 7_955,
          unit: "kr/m2",
          source: "arsredovisning",
          ref: { page: 9, excerpt: "Skuldsättning / kvm totalyta, kr 7 955" },
        },
        status: "svag",
        forklaring: "Hur mycket föreningen har lånat per kvadratmeter av hela byggnadens yta.",
      },
      {
        id: "skuldsattning_per_m2_brf_yta",
        label: "Skuldsättning per m² upplåten med bostadsrätt",
        figure: {
          value: 8_990,
          unit: "kr/m2",
          source: "arsredovisning",
          ref: { page: 9, excerpt: "Skuldsättning / kvm upplåten bostadsrätt, kr 8 990" },
        },
        status: "svag",
        forklaring: "Hur mycket föreningen har lånat per kvadratmeter bostadsrättsyta.",
        benchmark: {
          value: 7_117,
          label: "Riksgenomsnitt, skuldsättning per m² bostadsrättsyta",
          source:
            "Tröskelvärden fastställda i BENCHMARKS.md (produktbeslut). Referenspunkt: riksgenomsnitt ~7 117 kr/m² (2023, Nabo/SCB-härlett).",
        },
      },
      {
        id: "sparande_per_m2_totalyta",
        label: "Sparande per m² totalyta",
        figure: {
          value: 145,
          unit: "kr/m2",
          source: "arsredovisning",
          ref: { page: 9, excerpt: "Sparande / kvm totalyta, kr 145" },
        },
        status: "god",
        forklaring: "Hur mycket pengar per kvadratmeter föreningen sparar till framtida underhåll.",
      },
      {
        id: "rantekanslighet",
        label: "Räntekänslighet",
        figure: {
          value: 9.09,
          unit: "procent",
          source: "arsredovisning",
          ref: { page: 9, excerpt: "Räntekänslighet (%) 9,09" },
        },
        status: "svag",
        forklaring: "Hur mycket avgiften skulle behöva höjas om räntan ökar med en procentenhet.",
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
          value: 301,
          unit: "kr/m2",
          source: "arsredovisning",
          ref: { page: 9, excerpt: "Energikostnad / kvm totalyta, kr 301" },
        },
        status: "svag",
        forklaring: "Hur mycket föreningen betalar per kvadratmeter för el, vatten och värme.",
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
      el: "ja",
      bredband: "ja",
      tv: "ja",
    },
    lanebok: {
      totalSkuld: {
        value: 24_182_000,
        unit: "kr",
        source: "arsredovisning",
        ref: { page: 20, excerpt: "Summa 24 182 000" },
      },
      forfalloprofil: [
        {
          ar: 2028,
          belopp: {
            value: 8_942_000,
            unit: "kr",
            source: "arsredovisning",
            ref: { page: 20, excerpt: "Swedbank 2028-09-28 2,66 % 8 942 000" },
          },
          ranta: {
            value: 2.66,
            unit: "procent",
            source: "arsredovisning",
            ref: { page: 20, excerpt: "Swedbank 2028-09-28 2,66 % 8 942 000" },
          },
        },
        {
          ar: 2027,
          belopp: {
            value: 8_000_000,
            unit: "kr",
            source: "arsredovisning",
            ref: { page: 20, excerpt: "SBAB 2027-07-14 4,22 % 8 000 000" },
          },
          ranta: {
            value: 4.22,
            unit: "procent",
            source: "arsredovisning",
            ref: { page: 20, excerpt: "SBAB 2027-07-14 4,22 % 8 000 000" },
          },
        },
        {
          ar: 2026,
          belopp: {
            value: 2_499_000,
            unit: "kr",
            source: "arsredovisning",
            ref: { page: 20, excerpt: "Swedbank Hypotek AB 2026-10-23 3,77 % 2 499 000" },
          },
          ranta: {
            value: 3.77,
            unit: "procent",
            source: "arsredovisning",
            ref: { page: 20, excerpt: "Swedbank Hypotek AB 2026-10-23 3,77 % 2 499 000" },
          },
        },
        {
          ar: 2026,
          belopp: {
            value: 3_900_000,
            unit: "kr",
            source: "arsredovisning",
            ref: { page: 20, excerpt: "Swedbank 2026-09-25 4,14 % 3 900 000" },
          },
          ranta: {
            value: 4.14,
            unit: "procent",
            source: "arsredovisning",
            ref: { page: 20, excerpt: "Swedbank 2026-09-25 4,14 % 3 900 000" },
          },
        },
        {
          ar: 2027,
          belopp: {
            value: 841_000,
            unit: "kr",
            source: "arsredovisning",
            ref: { page: 20, excerpt: "Swedbank 2027-03-25 4,27 % 841 000" },
          },
          ranta: {
            value: 4.27,
            unit: "procent",
            source: "arsredovisning",
            ref: { page: 20, excerpt: "Swedbank 2027-03-25 4,27 % 841 000" },
          },
        },
      ],
      snittranta: {
        value: 3.44,
        unit: "procent",
        source: "arsredovisning",
        ref: { page: 9, excerpt: "Genomsnittlig skuldränta (%) 3,44" },
      },
    },
    underhallsplan: {
      finns: "ja",
      senastUppdaterad: 2025,
      kommandeAtgarder: [
        {
          text: "Uppdatering av belysning i trapphusen",
          ref: { page: 5, excerpt: "Uppdatering av belysning i trapphusen" },
        },
        { text: "Förstudie avlopp", ref: { page: 5, excerpt: "Förstudie avlopp" } },
        {
          text: "Installation avgasare och filter till värmecentral",
          ref: { page: 5, excerpt: "Installation avgasare och filter till värmecentral" },
        },
        {
          text: "OVK, kanalrensning, stamspolning och Radonmätning",
          ref: { page: 5, excerpt: "OVK, kanalrensning, stamspolning och Radonmätning" },
        },
        { text: "Dränering", ref: { page: 5, excerpt: "Dränering" } },
        {
          text: "Renovering ytskikt i källare",
          ref: { page: 5, excerpt: "Renovering ytskikt i källare" },
        },
        { text: "Ny fjärrvarmecentral", ref: { page: 5, excerpt: "Ny fjärrvarmecentral" } },
        {
          text: "Renovering balkong inkl. räcke",
          ref: { page: 5, excerpt: "Renovering balkong inkl. räcke" },
        },
      ],
      ref: {
        page: 5,
        excerpt:
          "Föreningen har en aktuell underhållsplan som upprättades 2025 och sträcker sig fram till 2075.",
      },
    },
    vasentligaHandelser: [
      {
        text: "Föreningen har lagt om ett lån på 8 942 000 kr från SEB till Swedbank med ränta 2,66 %, bunden på 3 år.",
        ref: {
          page: 7,
          excerpt:
            "Vi har lagt om ett av våra större lån (8.942.000 SEK) och flyttat det från SEB till Swedbank",
        },
      },
      {
        text: "Årsavgifterna justerades med 3 % från 2025-01-01.",
        ref: {
          page: 7,
          excerpt: "Enligt styrelsens beslut justerades årsavgifterna 2025-01-01 med 3%",
        },
      },
      {
        text: "Styrelsen har anlitat en ny revisor, Kvadrat Revision AB.",
        ref: {
          page: 7,
          excerpt: "Styrelsen har hittat en ny revisor för föreningen (Kvadrat Revision AB)",
        },
      },
      {
        text: "Två fuktskador, en äldre och en ny, håller på att hanteras.",
        ref: {
          page: 8,
          excerpt: "Två fuktskador, en gammal sedan förra året, och en ny, håller på att hanteras.",
        },
      },
      {
        text: "Föreningens styrelserum har gjorts om till en övernattningslägenhet med fyra sovplatser, som tas i bruk 2026.",
        ref: {
          page: 8,
          excerpt:
            "Föreningens styrelserum har gjorts om för att även fungera som en övernattningslägenhet",
        },
      },
      {
        text: "Avgiften höjdes med 2 % från 1 januari 2026 och tre lån till kommer att läggas om under 2026.",
        ref: {
          page: 20,
          excerpt:
            "Avgiften höjdes med 2% från den 1 januari 2026. ... Tre lån till kommer att läggas om 2026.",
        },
      },
    ],
  },

  betyg: "D",
  betygMotivering:
    "Sparandet till underhåll är kritiskt lågt (145 kr/m² mot riktvärdet 300 kr/m²) samtidigt som underhållsplanen listar flera stora och kostsamma åtgärder (ny fjärrvärmecentral, balkongrenovering, dränering, förstudie avlopp) utan att rapporten anger hur de ska finansieras. Räntekänsligheten är svag (9,09 %) och förstärks av att ungefär 63 % av föreningens lån (15,24 av 24,18 miljoner kr) förfaller redan 2026-2027, till räntor som redan idag ligger över snitträntan. Skuldsättningen är acceptabel men energikostnaden är svag. Kombinationen av kritiskt sparande och stora ofinansierade åtgärder pekar mot betydande avgiftshöjningar framöver.",

  rodaFlaggor: [
    {
      id: "kritiskt-lagt-sparande-mot-stora-atgarder",
      titel: "För lågt sparande jämfört med planerade underhållsåtgärder",
      beskrivning:
        "Föreningen sparar bara 145 kr per kvadratmeter och år till underhåll, knappt hälften av riktvärdet 300 kr/m². Samtidigt listar underhållsplanen flera stora poster som ny fjärrvärmecentral, balkongrenovering, dränering och förstudie avlopp, utan att rapporten anger hur dessa ska finansieras. Om pengarna inte finns avsatta måste de tas via avgiftshöjning eller nya lån, vilket direkt höjer din boendekostnad.",
      severity: "hog",
      ref: { page: 5, excerpt: "Uppdatering av belysning i trapphusen" },
      harledsFran: ["sparande_per_m2_totalyta"],
    },
    {
      id: "hog-rantekanslighet-och-lan-forfaller-snart",
      titel: "Hög räntekänslighet och stor andel lån förfaller inom 1-2 år",
      beskrivning:
        "Avgiften skulle behöva höjas med 9,09 % om räntan stiger med en procentenhet. Av föreningens totala skuld på 24,18 miljoner kr förfaller cirka 15,24 miljoner kr (ungefär 63 %) redan 2026-2027, till nuvarande räntor mellan 3,77 och 4,27 %, vilket redan ligger över föreningens snittränta på 3,44 %. Blir räntan högre vid omläggningen slår det snabbt igenom på din avgift.",
      severity: "hog",
      ref: { page: 20, excerpt: "Tre lån till kommer att läggas om 2026." },
      harledsFran: ["rantekanslighet", "skuldsattning_per_m2_totalyta"],
    },
    {
      id: "hog-energikostnad",
      titel: "Energikostnaden ligger över riktvärdet",
      beskrivning:
        "Föreningen betalar 301 kr per kvadratmeter i energikostnad, vilket är över riktvärdet 200 kr/m². Det är en löpande driftskostnad som belastar föreningens ekonomi och indirekt din avgift, särskilt i en byggnad från 1935 där energieffektivisering kan bli aktuell.",
      severity: "medel",
      ref: { page: 9, excerpt: "Energikostnad / kvm totalyta, kr 301" },
      harledsFran: ["energikostnad_per_m2_totalyta"],
    },
    {
      id: "fuktskador-ospecificerad-kostnad",
      titel: "Två fuktskador hanteras utan angiven kostnad",
      beskrivning:
        "Rapporten nämner två fuktskador, en äldre och en ny, som håller på att hanteras, men anger ingen kostnad eller finansiering. Tillsammans med det redan kritiskt låga sparandet är det osäkert hur dessa skador påverkar föreningens ekonomi och din framtida avgift.",
      severity: "medel",
      ref: {
        page: 8,
        excerpt: "Två fuktskador, en gammal sedan förra året, och en ny, håller på att hanteras.",
      },
      harledsFran: ["sparande_per_m2_totalyta"],
    },
  ],

  prisanalys: {
    utgangspris: { value: 3_200_000, unit: "kr", source: "anvandare" },
    prisPerM2: { value: 59_259, unit: "kr/m2", source: "berakning" },
    externVardering: {
      value: 4_320_000,
      unit: "kr",
      source: "schablon",
      schablonBasis:
        "Schablon: boarean multiplicerad med en platt 80 000 kr/m². Det är inte en riktig värdering — ingen oberoende värderingskälla är ansluten, och talet är inte justerat för läge, skick, våning eller byggår.",
      leverantor: "Schablon — platt 80 000 kr/m², ej verklig värderingskälla",
    },
    senasteForsaljningarIForeningen: [],
    avvikelseMotVardering: -25.9,
    slutsats:
      "Utgångspriset ligger 25,9 % under en schablonvärdering. Schablonen är ett platt kvadratmeterpris, inte en bedömning av just den här lägenheten — ingen oberoende priskälla är ansluten, så priset är ännu inte avstämt mot vare sig en riktig värdering eller jämförbara försäljningar.",
    konfidens: {
      niva: "lag",
      skal: [
        "Utgångspriset är endast jämfört med en schablon — ett platt kvadratmeterpris som inte tar hänsyn till läge, skick eller våning. Ingen oberoende priskälla är ansluten.",
      ],
    },
  },

  rantestress: {
    rantekanslighetProcent: 9.09,
    nuvarandeManadsavgift: { value: 3_800, unit: "kr", source: "anvandare" },
    scenarier: [
      {
        okningPe: 0,
        nyManadsavgift: { value: 3_800, unit: "kr", source: "berakning" },
        avgiftsokningKrPerManad: { value: 0, unit: "kr", source: "berakning" },
      },
      {
        okningPe: 1,
        nyManadsavgift: { value: 4_145, unit: "kr", source: "berakning" },
        avgiftsokningKrPerManad: { value: 345, unit: "kr", source: "berakning" },
      },
      {
        okningPe: 2,
        nyManadsavgift: { value: 4_491, unit: "kr", source: "berakning" },
        avgiftsokningKrPerManad: { value: 691, unit: "kr", source: "berakning" },
      },
      {
        okningPe: 3,
        nyManadsavgift: { value: 4_836, unit: "kr", source: "berakning" },
        avgiftsokningKrPerManad: { value: 1_036, unit: "kr", source: "berakning" },
      },
    ],
    kommentar:
      "Varje procentenhet högre ränta för föreningen motsvarar ungefär 345 kr mer i månaden för den här lägenheten. Stiger räntan tre procentenheter blir avgiften 4 836 kr i månaden, 1 036 kr mer än i dag.",
  },

  manadskostnad: {
    poster: [
      {
        id: "rantekostnad",
        label: "Räntekostnad",
        figure: { value: 7_680, unit: "kr", source: "berakning" },
        overriddenByUser: false,
        ingarIAvgift: false,
      },
      {
        id: "amortering",
        label: "Amortering",
        figure: { value: 4_267, unit: "kr", source: "berakning" },
        overriddenByUser: false,
        ingarIAvgift: false,
      },
      {
        id: "ranteavdrag",
        label: "Ränteavdrag",
        figure: { value: -2_304, unit: "kr", source: "berakning" },
        overriddenByUser: false,
        ingarIAvgift: false,
      },
      {
        id: "manadsavgift",
        label: "Månadsavgift",
        figure: { value: 3_800, unit: "kr", source: "anvandare" },
        overriddenByUser: false,
        ingarIAvgift: false,
      },
      {
        id: "hushallsel",
        label: "Hushållsel",
        figure: {
          value: 682,
          unit: "kr/man",
          source: "schablon",
          schablonBasis: "250 kr + 8 kr/m² × 54 m² boarea",
        },
        overriddenByUser: false,
        ingarIAvgift: false,
      },
      {
        id: "varme",
        label: "Värme",
        figure: {
          value: 936,
          unit: "kr/man",
          source: "schablon",
          schablonBasis: "180 kr + 14 kr/m² × 54 m² boarea",
        },
        overriddenByUser: false,
        ingarIAvgift: false,
      },
      {
        id: "vatten",
        label: "Vatten",
        figure: {
          value: 240,
          unit: "kr/man",
          source: "schablon",
          schablonBasis: "120 kr × 2 person(er)",
        },
        overriddenByUser: false,
        ingarIAvgift: false,
      },
      {
        id: "bredband",
        label: "Bredband",
        figure: { value: 349, unit: "kr/man", source: "schablon", schablonBasis: "Platt belopp" },
        overriddenByUser: false,
        ingarIAvgift: false,
      },
      {
        id: "hemforsakring",
        label: "Hemförsäkring inkl. bostadsrättstillägg",
        figure: {
          value: 282,
          unit: "kr/man",
          source: "schablon",
          schablonBasis: "120 kr + 3 kr/m² × 54 m² boarea",
        },
        overriddenByUser: false,
        ingarIAvgift: false,
      },
    ],
    totalBrutto: { value: 16_029, unit: "kr", source: "berakning" },
    totalNetto: { value: 13_725, unit: "kr", source: "berakning" },
    totalSpann: { low: 13_725, high: 15_932 },
    amortering: {
      belaningsgrad: 80,
      skuldkvot: 2.844,
      tillampadAmorteringstakt: 2,
      overBankernasTypiskaTak: false,
    },
    ranteavdragPerAr: { value: 27_648, unit: "kr", source: "berakning" },
  },

  fragor: [
    {
      id: "fraga-finansiering-underhallsatgarder",
      fraga:
        "Hur ska de stora underhållsåtgärderna (ny fjärrvärmecentral, balkongrenovering, dränering, avloppsförstudie) finansieras givet att sparandet ligger under riktvärdet?",
      ursprung: "analys",
      riktadTill: "styrelsen",
      varfor:
        "Köparen behöver veta om avgiften kommer höjas eller om nya lån tas för att täcka underhållsplanen innan budet läggs.",
      ref: { page: 5, excerpt: "Ny fjärrvärmecentral" },
    },
    {
      id: "fraga-ranta-vid-omlaggning-2026",
      fraga:
        "Vilken räntenivå förväntas de tre lån som ska läggas om under 2026 få, och hur mycket bedöms det påverka årsavgiften?",
      ursprung: "analys",
      riktadTill: "styrelsen",
      varfor:
        "En stor del av lånestocken förfaller snart och en högre ränta vid omläggning slår direkt igenom på avgiften enligt räntekänsligheten på 9,09 %.",
      ref: { page: 20, excerpt: "Tre lån till kommer att läggas om 2026." },
    },
    {
      id: "fraga-kostnad-fuktskador",
      fraga:
        "Vad är den uppskattade kostnaden för de två fuktskadorna, och täcks de av föreningens försäkring?",
      ursprung: "analys",
      riktadTill: "styrelsen",
      varfor:
        "Ospecificerade skador kan bli en oväntad utgift som belastar det redan låga sparandet och därmed din avgift.",
      ref: {
        page: 8,
        excerpt: "Två fuktskador, en gammal sedan förra året, och en ny, håller på att hanteras.",
      },
    },
    {
      id: "fraga-forstudie-avlopp-resultat",
      fraga:
        "Vad indikerar förstudien om avloppet, och pekar den mot ett kommande stambyte inom de närmaste åren?",
      ursprung: "analys",
      riktadTill: "styrelsen",
      varfor:
        "Ett stambyte är en av de största kostnader en bostadsrättsförening kan möta, och byggnaden är från 1935 vilket gör frågan särskilt relevant.",
      ref: { page: 5, excerpt: "Förstudie avlopp" },
    },
    {
      id: "saknad-hiss",
      fraga: "Finns det hiss i huset?",
      ursprung: "saknad_uppgift",
      riktadTill: "maklaren",
      varfor: "Uppgiften om hiss saknas — det påverkar både värdet och tillgängligheten.",
    },
  ],

  datakvalitet: {
    pdfSaknarTextlager: false,
    extraktionKonfidens: { niva: "hog", skal: [] },
    uppgifterKanda: 1,
    uppgifterTotalt: 9,
    saknadeFalt: [
      "hiss",
      "avgiftInkluderar.varme",
      "avgiftInkluderar.vatten",
      "avgiftInkluderar.el",
      "avgiftInkluderar.bredband",
      "avgiftInkluderar.tv",
      "vaning",
      "byggar",
    ],
  },

  gratisSektioner: ["betyg", "rodaFlaggor_topp2", "datakvalitet"],
};
