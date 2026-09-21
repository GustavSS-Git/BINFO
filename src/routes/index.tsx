import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, LinkButton, Badge } from "@/components/ui/binfo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Binfo — vet vad du budar på" },
      {
        name: "description",
        content:
          "Oberoende risk- och priskontroll för bostaden du är på väg att buda på. Ladda upp årsredovisningen och få en analys på minuter.",
      },
      { property: "og:title", content: "Binfo — vet vad du budar på" },
      {
        property: "og:description",
        content: "Oberoende risk- och priskontroll för bostadsköpare i Sverige.",
      },
    ],
  }),
  component: Index,
});

const steg = [
  {
    nr: "01",
    titel: "Ladda upp årsredovisningen",
    text: "PDF:en från mäklaren räcker. Vi läser nyckeltalen åt dig.",
  },
  {
    nr: "02",
    titel: "Få din analys",
    text: "Riskbetyg, röda flaggor, prisrimlighet och räntestress — på några minuter.",
  },
  {
    nr: "03",
    titel: "Fatta beslut",
    text: "Gå in i budgivningen med en egen gräns och rätt frågor till styrelsen.",
  },
];

function Index() {
  return (
    <div className="mx-auto max-w-6xl px-5">
      <section className="py-16 md:py-28">
        <Badge tone="teal">Oberoende beslutsstöd</Badge>
        <h1 className="mt-6 max-w-4xl font-display text-5xl leading-[1.05] tracking-tight text-foreground md:text-7xl">
          Säljaren har en mäklare. Nu har du Binfo.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
          Binfo guidar dig genom köpet, granskar föreningen, kollar priset och räknar ut om du har råd med just den här
          bostaden.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <LinkButton to="/analysera" size="lg">
            Analysera en bostad
          </LinkButton>
          <LinkButton to="/guide" size="lg" variant="secondary">
            Se köpguiden
          </LinkButton>
        </div>
        <p className="mt-8 text-sm text-muted-foreground">
          Oberoende · Inte kopplad till mäklare, bank eller förening. ·{" "}
          <Link to="/exempel" className="font-medium text-primary underline underline-offset-2">
            Se ett exempel på en rapport
          </Link>
        </p>
      </section>
      
  <!-- TRE FRÅGOR FÖRE BUDET -->
  <section class="questions" aria-labelledby="fragor-rubrik">
    <div class="wrap">
      <div class="questions-head">
        <h2 class="section-title" id="fragor-rubrik">Tre frågor du behöver svar på innan du budar.</h2>
        <p class="section-lede">Du hinner sällan mer än en helg mellan visning och budgivning. Binfo svarar på alla tre i samma analys, så att du slipper fylla i samma sak två gånger.</p>
      </div>

      <div class="q-panel">
        <div class="q-grid">
          <article class="q-item" id="foreningen">
            <p class="q-input">Du laddar upp årsredovisningen</p>
            <h3>Är föreningen frisk?</h3>
            <p class="q-body">Vi läser årsredovisningen, förklarar nyckeltalen på vanlig svenska och flaggar det som behöver förklaras, som lån som ska läggas om, lågt sparande eller renoveringar som saknar finansiering. Du får frågorna att ställa till styrelsen.</p>
            <a class="tool-link" href="/analysera">Granska föreningen</a>
          </article>
          <article class="q-item" id="priset">
            <p class="q-input">Du fyller i adress, boarea och pris</p>
            <h3>Är priset rimligt?</h3>
            <p class="q-body">Utgångspriset säger mer om mäklarens strategi än om bostadens värde. Vi jämför med vad liknande bostäder i området har sålts för och visar vilket slutpris som är rimligt.</p>
            <a class="tool-link" href="/analysera">Kolla priset</a>
          </article>
          <article class="q-item" id="kostnaden">
            <p class="q-input">Du fyller i inkomst, lån och kontantinsats</p>
            <h3>Har jag råd med just den här?</h3>
            <p class="q-body">Månadskostnaden med ränta efter avdrag, amortering, avgift och drift. Och vad du har kvar att leva på om räntan stiger, räknat på samma sätt som banken gör.</p>
            <a class="tool-link" href="/bolanekalkyl">Räkna på månadskostnaden</a>
          </article>
        </div>
        <div class="q-synthesis">
          <p><strong>Svaren vägs ihop till en gräns.</strong> Flaggor i föreningen sänker vad bostaden är värd för dig, och din ekonomi sätter taket. Du går in i budgivningen med en siffra du redan har bestämt dig för.</p>
          <a class="btn btn-primary" href="/analysera">Analysera en bostad</a>
        </div>
      </div>
    </div>
  </section>

  <!-- KÖPGUIDEN -->
  <section class="guide" aria-labelledby="guide-rubrik">
    <div class="wrap">
      <div class="guide-head">
        <div>
          <h2 class="section-title" id="guide-rubrik">Och resten av köpet? Köpguiden tar dig hela vägen.</h2>
          <p class="section-lede">Tolv steg från lånelöfte till tillträde, med vad du ska se upp med och vad du gör härnäst. Bocka av det du är klar med. Särskilt värdefull om det är ditt första köp.</p>
        </div>
        <a class="btn btn-secondary" href="/guide">Öppna köpguiden</a>
      </div>

 

      <section className="py-16">
        <Card className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <h2 className="font-display text-2xl text-foreground md:text-3xl">
              Du hinner sällan mer än en helg på dig.
            </h2>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Binfo läser årsredovisningen, jämför priset mot värdering och tidigare försäljningar och visar vad
              avgiften gör om räntan stiger.
            </p>
          </div>
          <LinkButton to="/analysera" size="lg">
            Kom igång
          </LinkButton>
        </Card>
      </section>
    </div>
  );
}
