/**
 * Köpguidens steg som data (redesign v4, steg 3c). Texten kommer från
 * designunderlaget (Kopguide.dc.html); stegens id är desamma som tidigare i
 * `src/routes/kopguide.tsx` och används som nycklar i sparat framsteg
 * (localStorage och `kopguide_framsteg`), så de får inte döpas om.
 * `lagfart` finns bara i (dolda) husläget.
 */

import type { PropertyType } from "@/data/mockData";

export interface KopguideTips {
  text: string;
  /** Intern länk som visas efter texten. */
  lank?: { label: string; to: "/bolanekalkyl" | "/analysera" };
}

export interface KopguideSteg {
  id: string;
  titel: string;
  sammanfattning: string;
  beskrivning: string;
  flaggor: string[];
  tips: KopguideTips[];
  only?: PropertyType;
}

export interface KopguideFas {
  id: string;
  titel: string;
  /** Stegen hör till fasen via id, inte via position i `KOPGUIDE_STEG`. */
  stegIds: readonly string[];
}

export const KOPGUIDE_STEG: readonly KopguideSteg[] = [
  {
    id: "lanelofte",
    titel: "Förberedelse & lånelöfte",
    sammanfattning: "Skaffa lånelöfte innan du går på din första visning.",
    beskrivning:
      "Banken bedömer din inkomst, dina skulder och din kontantinsats och ger ett besked om hur mycket du får låna. Lånelöftet gäller normalt tre till sex månader och är din budgetram i budgivningen.",
    flaggor: [
      "Ett lånelöfte är inget löfte i juridisk mening — det kan dras tillbaka om din ekonomi, bostadens värde eller bankens bedömning ändras.",
      "Sedan 1 april 2026 är bolånetaket 90 %. Kontantinsatsen måste alltså vara minst 10 % av priset.",
    ],
    tips: [
      { text: "Ta lånelöfte från minst två banker och jämför både belopp och räntenivå." },
      {
        text: "Räkna själv på månadskostnaden — banken säger vad du får låna, inte vad du bör låna.",
      },
      { text: "", lank: { label: "Räkna på din månadskostnad här", to: "/bolanekalkyl" } },
    ],
  },
  {
    id: "sok",
    titel: "Sök & bevaka objekt",
    sammanfattning: "Lägg upp bevakningar på Hemnet och Booli och lär dig ditt område.",
    beskrivning:
      "Bevaka Hemnet och Booli i de områden du är intresserad av. Sätt upp sparade sökningar med dina kriterier så att du ser objekten tidigt. Följ slutpriserna, inte bara annonserna, så att du vet vad som är en rimlig nivå när rätt bostad dyker upp.",
    flaggor: [
      "Utgångspriset är ett marknadsföringsverktyg, inte en värdering. Jämför alltid mot faktiska slutpriser.",
    ],
    tips: [
      { text: "Bevaka även ”kommande objekt” och sålda objekt i samma förening." },
      {
        text: "Spara annonsen och objektbeskrivningen. De kan behövas om något visar sig inte stämma.",
      },
    ],
  },
  {
    id: "visning",
    titel: "Visning",
    sammanfattning: "Titta på lägenheten — men lika mycket på huset och trapphuset.",
    beskrivning:
      "Gå igenom lägenheten noggrant och titta även på de gemensamma utrymmena: trapphus, tvättstuga, källare, fasad och fönster. Fråga mäklaren om planerade renoveringar, avgiftshöjningar och stambyte.",
    flaggor: [
      "Mäklaren är säljarens ombud och betalas av säljaren — inte din rådgivare.",
      "Som köpare har du undersökningsplikt. Det du kunde ha upptäckt får du sällan klaga på i efterhand.",
    ],
    tips: [
      { text: "Ta med frågelistan från din Binfo-rapport, och ställ frågor till mäklaren." },
      { text: "Fotografera sådant du vill fråga om senare." },
      { text: "Gå på visning två gånger om du kan, gärna vid olika tider på dygnet." },
    ],
  },
  {
    id: "ekonomi",
    titel: "Granska föreningens ekonomi",
    sammanfattning: "Läs årsredovisningen innan du budar — här avgörs framtida avgifter.",
    beskrivning:
      "Årsredovisningen visar föreningens skulder, sparande och hur känslig avgiften är för högre räntor. Nyckeltalen i förvaltningsberättelsen gör det lättare att jämföra med andra föreningar.",
    flaggor: [
      "Lån som ska läggas om snart kan få högre ränta, och då höjs ofta avgiften.",
      "Lågt sparande i kombination med stora åtgärder i underhållsplanen, till exempel stambyte, pekar mot avgiftshöjningar eller nya lån.",
      "Kontrollera om föreningen äger marken eller har tomträtt. Tomträttsavgälden kan höjas kraftigt när den omförhandlas.",
    ],
    tips: [
      { text: "Be om de två senaste årsredovisningarna så att du ser utvecklingen." },
      {
        text: "Ta hjälp av Binfos analysverktyg som granskar föreningen, ger den ett betyg och flaggar saker du borde veta: ",
        lank: { label: "Analysera föreningen här", to: "/analysera" },
      },
    ],
  },
  {
    id: "budgivning",
    titel: "Budgivning",
    sammanfattning: "Öppen budgivning där mäklaren förmedlar buden — inget är bindande.",
    beskrivning:
      "Mäklaren tar emot buden och förmedlar dem till säljaren och de andra budgivarna, oftast via sms. Säljaren väljer fritt vem hen säljer till och behöver inte välja det högsta budet. Efter avslutad affär har du rätt att se budlistan.",
    flaggor: [
      "Inget bud är bindande, varken för dig eller för säljaren. Affären blir bindande först när båda har skrivit under avtalet.",
      "Budgivningen kan gå snabbt. Bestäm din smärtgräns och budstrategi i förväg.",
    ],
    tips: [
      { text: "Buda utifrån den totala månadskostnaden du klarar — inte utifrån prislappen." },
      {
        text: "Testa med ett starkt öppningsbud: lägg ett attraktivt bud tidigt för att signalera allvar och i bästa fall få säljaren att acceptera direkt.",
      },
      {
        text: "Avvakta och slå till: låt andra driva upp priset initialt och kliv in med ett kraftfullt bud när konkurrensen mattas av.",
      },
      {
        text: "Buda med mer än pengar: flexibelt tillträdesdatum, snabbt kontrakt eller andra villkor kan göra ditt bud mer attraktivt.",
      },
      {
        text: "Variera dina budsteg: mindre höjningar när du vill känna av motståndet, större hopp när du vill signalera att du är beredd att gå långt.",
      },
    ],
  },
  {
    id: "vinnande",
    titel: "Vinnande bud & överenskommelse",
    sammanfattning: "Säljaren accepterar ditt bud — men affären är ännu inte klar.",
    beskrivning:
      "När säljaren väljer ditt bud bokas en kontraktsskrivning, ofta inom några dagar. Fram till dess kan både du och säljaren fortfarande ändra er.",
    flaggor: [
      "Ett ja per telefon eller sms är inte bindande. Säljaren kan välja en annan köpare fram till att avtalet är undertecknat.",
    ],
    tips: [
      { text: "Be om kontraktsutkastet i förväg så du hinner läsa igenom det i lugn och ro." },
      { text: "Kontakta banken direkt och berätta att ditt bud har accepterats." },
    ],
  },
  {
    id: "kontrakt",
    titel: "Kontrakt/Överlåtelseavtal",
    sammanfattning: "Här blir affären bindande. Läs varje klausul.",
    beskrivning:
      "Köpet av en bostadsrätt måste göras skriftligt i ett överlåtelseavtal som både du och säljaren skriver under. Avtalet anger bland annat pris, tillträdesdag och handpenning.",
    flaggor: [
      "Läs friskrivningsklausuler noga — de flyttar risk från säljaren till dig.",
      "Villkor du vill ha, till exempel att köpet bara gäller om du får lån, måste stå i avtalet. De går inte att lägga till i efterhand.",
      "Det finns ingen ångerrätt vid bostadsköp.",
    ],
    tips: [
      {
        text: "Kontrollera att tillträdesdagen fungerar med din nuvarande bostad och med bankens handläggning.",
      },
      {
        text: "Fråga vad som följer med i köpet om något är oklart, till exempel vitvaror eller garderob.",
      },
    ],
  },
  {
    id: "handpenning",
    titel: "Handpenning",
    sammanfattning: "Normalt cirka 10 % av priset, några dagar efter kontraktet.",
    beskrivning:
      "Handpenningen betalas oftast till mäklarens klientmedelskonto några dagar efter att avtalet skrivits under och räknas av från köpeskillingen på tillträdesdagen.",
    flaggor: [
      "Drar du dig ur efter att avtalet är underskrivet kan du bli skyldig att betala skadestånd till säljaren, och handpenningen står på spel.",
    ],
    tips: [
      {
        text: "Se till att pengarna finns tillgängliga i tid. Att sälja fonder eller flytta sparpengar kan ta några dagar.",
      },
      {
        text: "Kontrollera att pengarna går till ett klientmedelskonto, aldrig till ett privatkonto.",
      },
    ],
  },
  {
    id: "bolan",
    titel: "Ansök om bolån & bind eller ha rörlig ränta",
    sammanfattning: "Nu formaliseras lånet och den faktiska räntan sätts.",
    beskrivning:
      "Banken gör en slutlig bedömning av dig, bostaden och föreningen innan lånet betalas ut. Du väljer rörlig ränta, bunden ränta eller en blandning, samt väljer bindningstid och får ett besked om amorteringskrav utifrån belåningsgrad och skuldkvot.",
    flaggor: [
      "Lånelöftet blir inte automatiskt ett lån. Banken kan säga nej om bostaden eller föreningen inte håller måttet, alternativt ändra villkoren.",
      "Bankens värdering kan dessutom bli lägre än priset du betalat — då krävs mer kontantinsats.",
    ],
    tips: [
      { text: "Förhandla räntan. Listräntan är sällan den du behöver betala." },
      { text: "Jämför erbjudanden från flera banker, inte bara den som gav lånelöftet." },
      {
        text: "Tänk på att den rörliga räntan kan stiga och öka dina ränteutgifter och månadskostnader — undersök vad du har råd med.",
      },
      { text: "", lank: { label: "Räkna på din månadskostnad här", to: "/bolanekalkyl" } },
    ],
  },
  {
    id: "medlemskap",
    titel: "Medlemskap i föreningen",
    sammanfattning: "Styrelsen prövar och godkänner dig som medlem.",
    beskrivning:
      "Efter kontraktet ansöker du om medlemskap. Styrelsen prövar ansökan enligt stadgarna och bostadsrättslagen, vanligtvis inom några veckor.",
    flaggor: [
      "Nekas du medlemskap blir köpet ogiltigt.",
      "Köper ni tillsammans ska ni båda ansöka om medlemskap.",
    ],
    tips: [{ text: "Skicka in ansökan i god tid före tillträdet." }],
  },
  {
    id: "lagfart",
    titel: "Lagfart & pantbrev",
    sammanfattning: "Ansök om lagfart hos Lantmäteriet och ordna pantbrev.",
    beskrivning:
      "Lagfart söks inom tre månader från tillträdet och kostar 1,5 % av köpeskillingen i stämpelskatt plus expeditionsavgift. Nya pantbrev kostar 2 % av beloppet.",
    flaggor: [
      "Stämpelskatt och pantbrevskostnader är stora belopp som ofta glöms bort i kalkylen.",
    ],
    tips: [
      {
        text: "Kontrollera vilka befintliga pantbrev som redan finns i fastigheten — de kan återanvändas.",
      },
    ],
    only: "hus",
  },
  {
    id: "tilltrade",
    titel: "Tillträde & slutbetalning",
    sammanfattning: "Resten av köpeskillingen betalas och du får nycklarna.",
    beskrivning:
      "På tillträdesdagen möts parterna hos banken eller mäklaren. Lånet betalas ut, likvidavräkningen skrivs under och nycklarna överlämnas.",
    flaggor: ["Kontrollera att bostaden är i utlovat skick och tömd innan pengarna går iväg."],
    tips: [
      { text: "Gör en sista genomgång samma dag, före betalning." },
      { text: "Läs av el och vatten." },
    ],
  },
  {
    id: "efter",
    titel: "Efter tillträde",
    sammanfattning: "Försäkring, flyttanmälan och skatt att hålla koll på.",
    beskrivning:
      "Teckna hemförsäkring (och bostadsrättstillägg om det behövs) från tillträdesdagen och gör flyttanmälan till Skatteverket. Ränteavdraget får du via deklarationen.",
    flaggor: [
      "Utan giltig försäkring från dag ett står du själv för skador.",
      "Ränteavdraget kommer först med skatteåterbäringen. Vill du ha effekten varje månad kan du ansöka om jämkning hos Skatteverket.",
    ],
    tips: [
      {
        text: "Spara alla kvitton på renoveringar — de kan dras av vid en eventuell vinst vid framtida försäljning och på så sätt minska skatten.",
      },
    ],
  },
];

export const KOPGUIDE_FASER: readonly KopguideFas[] = [
  {
    id: "fore",
    titel: "Före budgivningen",
    stegIds: ["lanelofte", "sok", "visning", "ekonomi"],
  },
  {
    id: "affaren",
    titel: "Affären",
    stegIds: ["budgivning", "vinnande", "kontrakt", "handpenning"],
  },
  {
    id: "tilltrade",
    titel: "Fram till och efter tillträdet",
    stegIds: ["bolan", "medlemskap", "lagfart", "tilltrade", "efter"],
  },
];
