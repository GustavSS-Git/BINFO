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
          En oberoende risk- och priskontroll för bostaden du är på väg att buda på.
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
          Oberoende · Inte kopplad till mäklare eller bank. ·{" "}
          <Link to="/exempel" className="font-medium text-primary underline underline-offset-2">
            Se ett exempel på en rapport
          </Link>
        </p>
      </section>

      <section className="grid gap-5 pb-10 md:grid-cols-3">
        {steg.map((s) => (
          <Card key={s.nr}>
            <p className="font-display text-3xl text-primary">{s.nr}</p>
            <h2 className="mt-4 text-base font-semibold text-foreground">{s.titel}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{s.text}</p>
          </Card>
        ))}
      </section>

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
