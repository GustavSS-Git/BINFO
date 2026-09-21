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

      <section className="py-12" aria-labelledby="fragor-rubrik">
        <h2 id="fragor-rubrik" className="font-display text-3xl text-foreground md:text-4xl">
          Tre frågor du behöver svar på innan du budar.
        </h2>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          <Card>
            <h3 className="mt-2 font-display text-xl text-foreground">Är föreningen frisk?</h3>
            <p className="mt-3 text-sm text-muted-foreground">
              Vi läser årsredovisningen, förklarar nyckeltalen på vanlig svenska, flaggar det som behöver förklaras, och
              tar fram frågor att ställa till styrelsen.
            </p>
            <Link to="/analysera" className="mt-4 inline-block font-medium text-primary underline underline-offset-2">
              Granska föreningen
            </Link>
          </Card>

          <Card>
            <h3 className="mt-2 font-display text-xl text-foreground">Är priset rimligt?</h3>
            <p className="mt-3 text-sm text-muted-foreground">
              Utgångspriset säger mer om mäklarens strategi än om bostadens värde. Vi jämför med vad liknande bostäder i
              området har sålts för och visar vilket slutpris som är rimligt.
            </p>
            <Link to="/analysera" className="mt-4 inline-block font-medium text-primary underline underline-offset-2">
              Kolla priset
            </Link>
          </Card>

          <Card>
            <h3 className="mt-2 font-display text-xl text-foreground">Har jag råd med just den här?</h3>
            <p className="mt-3 text-sm text-muted-foreground">
              Månadskostnaden med ränta efter avdrag, amortering, avgift och drift. Och hur mycket du har kvar i
              plånboken om räntan stiger.
            </p>
            <a href="/bolanekalkyl" className="mt-4 inline-block font-medium text-primary underline underline-offset-2">
              Räkna på månadskostnaden
            </a>
          </Card>
        </div>

        <!-- 
          <Card className="mt-6 flex flex-wrap items-center justify-between gap-6">
          <p className="max-w-2xl text-sm text-muted-foreground">
            <strong className="text-foreground">Svaren vägs ihop till en gräns.</strong> Flaggor i föreningen sänker vad
            bostaden är värd för dig, och din ekonomi sätter taket. Du går in i budgivningen med en siffra du redan har
            bestämt dig för.
          </p>
          <LinkButton to="/analysera">Analysera en bostad</LinkButton>
        </Card>
          -->
      </section>

      <section className="py-12" aria-labelledby="guide-rubrik">
        <Card className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <h2 id="guide-rubrik" className="font-display text-2xl text-foreground md:text-3xl">
              Och resten av köpet? Köpguiden tar dig hela vägen.
            </h2>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Tolv steg från lånelöfte till tillträde, med vad du ska se upp med och vad du gör härnäst. 
            </p>
          </div>
          <LinkButton to="/guide" variant="secondary">
            Öppna köpguiden
          </LinkButton>
        </Card>
      </section>
    </div>
  );
}
