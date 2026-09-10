import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Card, Button, Badge, PageHeader } from "@/components/ui/binfo";
import { PropertySummary } from "@/components/PropertySummary";
import { risk, rodaFlaggor, lastaInsikter } from "@/data/mockData";

export const Route = createFileRoute("/forhandsvisning")({
  head: () => ({
    meta: [
      { title: "Förhandsvisning av analysen — Binfo" },
      {
        name: "description",
        content: "Riskbetyg och två röda flaggor gratis. Lås upp hela analysen för 249 kr.",
      },
      { property: "og:title", content: "Förhandsvisning av analysen — Binfo" },
      {
        property: "og:description",
        content: "Se riskbetyget och de första röda flaggorna för Brf Lindgården.",
      },
    ],
  }),
  component: Forhandsvisning,
});

function Forhandsvisning() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-4xl px-5 py-14">
      <PageHeader eyebrow="Steg 2 av 3" title="Din analys är klar" />
      <PropertySummary />

      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-8">
          <div className="flex size-28 shrink-0 items-center justify-center rounded-full border-4 border-primary/20 bg-primary/5">
            <span className="font-display text-4xl text-primary">{risk.betyg}</span>
          </div>
          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Sammanvägt riskbetyg
            </p>
            <p className="mt-2 max-w-xl text-base text-foreground">{risk.sammanfattning}</p>
          </div>
        </div>
      </Card>

      <div className="mb-6 grid gap-5 md:grid-cols-2">
        {rodaFlaggor.map((f) => (
          <Card key={f.titel}>
            <Badge tone="danger">Röd flagga</Badge>
            <h3 className="mt-4 text-base font-semibold text-foreground">{f.titel}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{f.text}</p>
          </Card>
        ))}
      </div>

      <div className="relative mb-8">
        <div className="grid gap-5 md:grid-cols-2" aria-hidden>
          {lastaInsikter.map((i) => (
            <Card key={i.titel} className="select-none blur-[6px]">
              <h3 className="text-base font-semibold text-foreground">{i.titel}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{i.text}</p>
            </Card>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex items-center gap-2 rounded-full bg-card px-5 py-3 text-sm font-medium text-foreground shadow-[0_2px_10px_rgba(22,32,46,0.12)]">
            <LockIcon /> Fyra insikter är låsta
          </span>
        </div>
      </div>

      {/* TODO(payment): här kopplas riktig betalning in (Stripe/Swish). */}
      <Card className="bg-primary text-primary-foreground">
        <h2 className="font-display text-2xl md:text-3xl">Lås upp hela analysen — 249 kr</h2>
        <p className="mt-3 max-w-xl text-sm text-primary-foreground/80">
          Alla sju nyckeltal med förklaringar, prisbedömning, räntestresstest och sex frågor
          att ställa till styrelsen. Engångsköp för det här objektet.
        </p>
        <Button
          variant="secondary"
          size="lg"
          className="mt-6"
          onClick={() => navigate({ to: "/analys" })}
        >
          Betala 249 kr och lås upp
        </Button>
      </Card>
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 1 1 8 0v3" />
    </svg>
  );
}
