import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { Card, Callout, Toggle, PageHeader, Badge } from "@/components/ui/binfo";
import { usePropertyType } from "@/lib/propertyType";
import type { PropertyType } from "@/data/mockData";

export const Route = createFileRoute("/guide")({
  head: () => ({
    meta: [
      { title: "Guide: hela bostadsköpet steg för steg — Binfo" },
      {
        name: "description",
        content: "Från lånelöfte till tillträde: varje steg i det svenska bostadsköpet med varningar och tips.",
      },
      { property: "og:title", content: "Guide: hela bostadsköpet steg för steg — Binfo" },
      {
        property: "og:description",
        content: "Interaktiv tidslinje över köpprocessen för bostadsrätt och hus.",
      },
    ],
  }),
  component: Guide,
});

type Steg = {
  id: string;
  titel: string;
  sammanfattning: string;
  beskrivning: string;
  flaggor: string[];
  tips: ReactNode[];
  only?: PropertyType;
};

const steg: Steg[] = [
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
      "Ta lånelöfte från minst två banker och jämför både belopp och räntenivå.",
      "Räkna själv på månadskostnaden — banken säger vad du får låna, inte vad du bör låna.",
      <>
        <a href="/bolanekalkyl" className="font-medium text-primary underline underline-offset-2">
          Räkna på din månadskostnad här
        </a>
      </>,
    ],
  },
  {
    id: "sok",
    titel: "Sök & bevaka objekt",
    sammanfattning: "Lägg upp bevakningar på Hemnet och Booli och lär dig ditt område.",
    beskrivning:
      "Bevaka Hemnet och Booli i de områden du är intresserad av. Sätt upp sparade sökningar med dina kriterier så att du ser objekten tidigt. Följ slutpriserna, inte bara annonserna, så att du vet vad som är en rimlig nivå när rätt bostad dyker upp.",
    flaggor: ["Utgångspriset är ett marknadsföringsverktyg, inte en värdering. Jämför alltid mot faktiska slutpriser."],
    tips: [
      "Bevaka även 'kommande objekt' och sålda objekt i samma förening.",
      "Spara annonsen och objektbeskrivningen. De kan behövas om något visar sig inte stämma.",
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
      "Ta med frågelistan från din Binfo-rapport, och ställ frågor till mäklaren.",
      "Fotografera sådant du vill fråga om senare",
      "Gå på visning två gånger om du kan, gärna vid olika tider på dygnet.",
    ],
  },
  {
    id: "ekonomi",
    titel: "Granska föreningens ekonomi",
    sammanfattning: "Läs årsredovisningen innan du budar — här avgörs framtida avgifter.",
    beskrivning:
      "Årsredovisningen visar föreningens skulder, sparande och hur känslig avgiften är för högre räntor. Nyckeltalen i förvaltningsberättelsen gör det lättare att jämföra med andra föreningar.",
    flaggor: [
      "Lån som ska läggas om snart kan få högre ränta, och då höjs ofta avgiften",
      "Lågt sparande i kombination med stora åtgärder i underhållsplanen, till exempel stambyte, pekar mot avgiftshöjningar eller nya lån",
      "Kontrollera om föreningen äger marken eller har tomträtt. Tomträttsavgälden kan höjas kraftigt när den omförhandlas.",
    ],
    tips: [
      "Be om de två senaste årsredovisningarna så att du ser utvecklingen",
      <>
        Ta hjälp av Binfos analysverktyg som granskar föreningen, ger den ett betyg och flaggar saker du borde veta:{" "}
        <a href="/analysera" className="font-medium text-primary underline underline-offset-2">
          Analysera föreningen här
        </a>
      </>,
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
      "Budgivningen kan gå snabbt. Bestäm din smärtgräns och budstrategi i förväg",
    ],
    tips: [
      "Buda utifrån den totala månadskostnaden du klarar — inte utifrån prislappen.",
      "Testa med ett starkt öppningsbud: lägg ett attraktivt bud tidigt för att signalera allvar och i bästa fall få säljaren att acceptera direkt.",
      "Avvakta och slå till: låt andra driva upp priset initialt och kliv in med ett kraftfullt bud när konkurrensen mattas av.",
      "Buda med mer än pengar: flexibelt tillträdesdatum, snabbt kontrakt eller andra villkor kan göra ditt bud mer attraktivt.",
      "Variera dina budsteg: mindre höjningar när du vill känna av motståndet, större hopp när du vill signalera att du är beredd att gå långt.",
    ],
  },
  {
    id: "vinnande",
    titel: "Vinnande bud & överenskommelse",
    sammanfattning: "Säljaren accepterar ditt bud — men affären är ännu inte klar.",
    beskrivning:
      "Mäklaren bokar kontraktsskrivning, oftast inom några dagar. Fram tills kontraktet är påskrivet kan båda parter dra sig ur utan påföljd.",
    flaggor: ["Ett accepterat bud är inte bindande. Både du och säljaren kan backa fram till signering."],
    tips: ["Be om kontraktsutkastet i förväg så du hinner läsa igenom det i lugn och ro."],
  },
  {
    id: "kontrakt",
    titel: "Kontrakt (upplåtelseavtal/köpekontrakt)",
    sammanfattning: "Här blir affären bindande. Läs varje klausul.",
    beskrivning:
      "Kontraktet reglerar pris, tillträdesdag, vad som ingår, eventuella villkor och friskrivningar. För bostadsrätt skrivs överlåtelseavtal, för hus köpekontrakt.",
    flaggor: [
      "Läs friskrivningsklausuler noga — de flyttar risk från säljaren till dig.",
      "Villkor om lånelöfte eller besiktning måste skrivas in i kontraktet för att gälla.",
    ],
    tips: ["Det är nu affären blir bindande — var helt säker innan du skriver under."],
  },
  {
    id: "handpenning",
    titel: "Handpenning",
    sammanfattning: "Normalt cirka 10 % av priset, några dagar efter kontraktet.",
    beskrivning:
      "Handpenningen betalas till mäklarens klientmedelskonto och hålls där fram till tillträdet, då den räknas av mot köpeskillingen.",
    flaggor: [
      "Det här är riktiga pengar i risk. Hoppar du av affären kan du bli skadeståndsskyldig — se till att finansieringen är säkrad innan du skriver kontrakt, inte efter.",
    ],
    tips: ["Kontrollera att pengarna går till ett klientmedelskonto, aldrig till ett privatkonto."],
  },
  {
    id: "bolan",
    titel: "Ansök om bolån & bind eller ha rörlig ränta",
    sammanfattning: "Nu formaliseras lånet och den faktiska räntan sätts.",
    beskrivning:
      "Banken gör en slutlig kreditprövning och värderar bostaden. Du väljer bindningstid och får ett besked om amorteringskrav utifrån belåningsgrad och skuldkvot.",
    flaggor: [
      "Din slutliga ränta kan skilja sig från nivån i lånelöftet.",
      "Bankens värdering kan bli lägre än priset du betalat — då krävs mer kontantinsats.",
    ],
    tips: [
      "Bestäm bunden eller rörlig ränta utifrån hur mycket svängning din ekonomi tål.",
      "Förhandla — och använd ett konkurrerande erbjudande som hävstång.",
    ],
  },
  {
    id: "medlemskap",
    titel: "Medlemskap i föreningen",
    sammanfattning: "Styrelsen prövar och godkänner dig som medlem.",
    beskrivning:
      "Efter kontraktet ansöker du om medlemskap. Styrelsen prövar ansökan, vanligtvis inom några veckor. Utan medlemskap blir köpet ogiltigt.",
    flaggor: ["Medlemskap kan nekas. Säg inte upp din nuvarande bostad förrän du är godkänd."],
    tips: ["Fråga mäklaren hur lång handläggningstid styrelsen brukar ha."],
    only: "brf",
  },
  {
    id: "lagfart",
    titel: "Lagfart & pantbrev",
    sammanfattning: "Ansök om lagfart hos Lantmäteriet och ordna pantbrev.",
    beskrivning:
      "Lagfart söks inom tre månader från tillträdet och kostar 1,5 % av köpeskillingen i stämpelskatt plus expeditionsavgift. Nya pantbrev kostar 2 % av beloppet.",
    flaggor: ["Stämpelskatt och pantbrevskostnader är stora belopp som ofta glöms bort i kalkylen."],
    tips: ["Kontrollera vilka befintliga pantbrev som redan finns i fastigheten — de kan återanvändas."],
    only: "hus",
  },
  {
    id: "tilltrade",
    titel: "Tillträde & slutbetalning",
    sammanfattning: "Resterande cirka 90 % betalas och du får nycklarna.",
    beskrivning:
      "På tillträdesdagen möts parterna hos banken eller mäklaren. Lånet betalas ut, likvidavräkningen skrivs under och nycklarna överlämnas.",
    flaggor: ["Kontrollera att bostaden är i utlovat skick och tömd innan pengarna går iväg."],
    tips: ["Gör en sista genomgång samma dag, före betalning.", "Läs av el och vatten."],
  },
  {
    id: "efter",
    titel: "Efter tillträde",
    sammanfattning: "Försäkring, flyttanmälan och skatt att hålla koll på.",
    beskrivning:
      "Hemförsäkringen (med bostadsrättstillägg om det behövs) ska gälla från tillträdesdagen. Gör flyttanmälan hos Skatteverket. Vid framtida försäljning betalar du 22 % vinstskatt på vinsten, med möjlighet till uppskov.",
    flaggor: ["Utan giltig försäkring från dag ett står du själv för skador."],
    tips: ["Spara alla kvitton på renoveringar — de kan dras av vid en framtida försäljning."],
  },
];

function Guide() {
  const [typ, setTyp] = usePropertyType();
  const [open, setOpen] = useState<string | null>("lanelofte");
  const [klara, setKlara] = useState<string[]>([]);

  const synliga = useMemo(() => steg.filter((s) => !s.only || s.only === typ), [typ]);
  const antalKlara = klara.filter((id) => synliga.some((s) => s.id === id)).length;
  const progress = Math.round((antalKlara / synliga.length) * 100);

  const toggleKlar = (id: string) => setKlara((k) => (k.includes(id) ? k.filter((x) => x !== id) : [...k, id]));

  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <PageHeader
        eyebrow="Guide"
        title="Hela bostadsköpet, steg för steg"
        lead="Klicka på ett steg för att se varningar och tips. Bocka av det du är klar med."
      />

      <div className="mb-10 flex flex-wrap items-center justify-between gap-4">
        {/* Bostadstypvalet är grafiskt dolt tills vidare — fokus är bostadsrätter.
            State, funktioner och hus-stegen ligger kvar oförändrade. */}
        <div className="hidden">
          <Toggle
            value={typ}
            onChange={setTyp}
            options={[
              { value: "brf", label: "Bostadsrätt" },
              { value: "hus", label: "Hus" },
            ]}
          />
        </div>
        <Badge tone="teal">
          {antalKlara} av {synliga.length} steg klara
        </Badge>
      </div>

      <div className="mb-10 h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
      </div>

      <ol className="relative space-y-4 border-l border-border pl-6 md:pl-8">
        {synliga.map((s, i) => {
          const isOpen = open === s.id;
          const klar = klara.includes(s.id);
          return (
            <li key={s.id} className="relative">
              <span
                className={`absolute -left-[31px] top-6 size-3.5 rounded-full border-2 md:-left-[39px] ${
                  klar
                    ? "border-primary bg-primary"
                    : isOpen
                      ? "border-primary bg-background"
                      : "border-border bg-background"
                }`}
                aria-hidden
              />
              <Card className="p-5 md:p-6">
                <div className="flex items-start justify-between gap-4">
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : s.id)}
                    aria-expanded={isOpen}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Steg {i + 1}</p>
                    <h2 className="mt-1 font-display text-xl text-foreground">{s.titel}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{s.sammanfattning}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleKlar(s.id)}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      klar
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {klar ? "Klar" : "Markera klar"}
                  </button>
                </div>

                {isOpen ? (
                  <div className="mt-5 space-y-4 border-t border-border pt-5">
                    <p className="text-sm text-foreground">{s.beskrivning}</p>
                    {s.flaggor.length ? (
                      <Callout variant="flag" title="Viktiga flaggor">
                        <ul className="list-disc space-y-1 pl-4">
                          {s.flaggor.map((f) => (
                            <li key={f}>{f}</li>
                          ))}
                        </ul>
                      </Callout>
                    ) : null}
                    {s.tips.length ? (
                      <Callout variant="tip" title="Tips">
                        <ul className="list-disc space-y-1 pl-4">
                          {s.tips.map((t, i) => (
                            <li key={i}>{t}</li>
                          ))}
                        </ul>
                      </Callout>
                    ) : null}
                  </div>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
