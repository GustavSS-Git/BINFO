import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Card, Button, Badge, PageHeader } from "@/components/ui/binfo";
import { PropertySummary } from "@/components/PropertySummary";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import { toppRodaFlaggor } from "@/lib/analysisView";
import type { Severity } from "@/types/analysis";

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
        content: `Se riskbetyget och de första röda flaggorna för ${sampleAnalysis.forening.namn}.`,
      },
    ],
  }),
  component: Forhandsvisning,
});

const ANTAL_GRATIS_FLAGGOR = 2;

/** Badge-ton per allvarlighetsgrad — 'lag' delar ton med 'medel' eftersom
 *  Badge inte har en egen neutral-men-uppmärksammad ton. */
const severityTone: Record<Severity, "danger" | "warning"> = {
  hog: "danger",
  medel: "warning",
  lag: "warning",
};

const severityLabel: Record<Severity, string> = {
  hog: "Hög risk",
  medel: "Medelrisk",
  lag: "Låg risk",
};

/**
 * Fyra insikter som ligger bakom betalväggen. Rubrikerna beskriver vad som
 * faktiskt är låst i den riktiga analysen (prisanalys, räntestress, frågor,
 * fullständig nyckeltalsgenomgång) snarare än de tidigare mockade
 * exempelmeningarna, som beskrev mock-only-innehåll utan motsvarighet i
 * kontraktet.
 */
function lastaInsikter() {
  return [
    {
      titel: "Prisbedömning",
      text: "Hur utgångspriset ställer sig mot en värdering och jämförbara försäljningar — och om det är rimligt att lägga bud.",
    },
    {
      titel: "Räntestresstest",
      text: "Vad som händer med din månadsavgift och totala boendekostnad om räntan stiger 1–3 procentenheter.",
    },
    {
      titel: "Frågor att ställa styrelsen",
      text: `${sampleAnalysis.fragor.length} skräddarsydda frågor baserade på det som sticker ut i just den här årsredovisningen.`,
    },
    {
      titel: "Fullständig nyckeltalsgenomgång",
      text: "Alla sju lagstadgade nyckeltal, förklarade i vanlig svenska och jämförda mot riktvärden.",
    },
  ];
}

function Forhandsvisning() {
  const navigate = useNavigate();

  const visarToppFlaggor = sampleAnalysis.gratisSektioner.includes("rodaFlaggor_topp2");
  // Rankade efter allvarlighetsgrad (hög → medel → låg) så att de två
  // viktigaste flaggorna visas gratis, inte bara de två första i listan.
  const gratisFlaggor = visarToppFlaggor
    ? toppRodaFlaggor(sampleAnalysis.rodaFlaggor, ANTAL_GRATIS_FLAGGOR)
    : [];
  const visarDatakvalitet = sampleAnalysis.gratisSektioner.includes("datakvalitet");

  return (
    <div className="mx-auto max-w-4xl px-5 py-14">
      <PageHeader eyebrow="Steg 2 av 3" title="Din analys är klar" />
      <PropertySummary />

      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-8">
          <div className="flex size-28 shrink-0 items-center justify-center rounded-full border-4 border-primary/20 bg-primary/5">
            <span className="font-display text-4xl text-primary">{sampleAnalysis.betyg}</span>
          </div>
          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Sammanvägt riskbetyg
            </p>
            <p className="mt-2 max-w-xl text-base text-foreground">
              {sampleAnalysis.betygMotivering}
            </p>
          </div>
        </div>
      </Card>

      {visarDatakvalitet ? <Datakvalitetsrad /> : null}

      <div className="mb-6 grid gap-5 md:grid-cols-2">
        {gratisFlaggor.map((f) => (
          <Card key={f.id}>
            <Badge tone={severityTone[f.severity]}>{severityLabel[f.severity]}</Badge>
            <h3 className="mt-4 text-base font-semibold text-foreground">{f.titel}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{f.beskrivning}</p>
          </Card>
        ))}
      </div>

      <div className="relative mb-8">
        <div className="grid gap-5 md:grid-cols-2" aria-hidden>
          {lastaInsikter().map((i) => (
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
          Alla sju nyckeltal med förklaringar, prisbedömning, räntestresstest och{" "}
          {sampleAnalysis.fragor.length} frågor att ställa till styrelsen. Engångsköp för det här
          objektet.
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

/** Minimal, gratis visning av datakvalitet — en rad plus en stapel, samma
 *  mönster som säkerhetsmätaren i den fullständiga analysen, men utan
 *  interaktion (paywall-skärmen ska inte länka vidare till formuläret). */
function Datakvalitetsrad() {
  const { uppgifterKanda, uppgifterTotalt } = sampleAnalysis.datakvalitet;
  const andel = uppgifterTotalt > 0 ? uppgifterKanda / uppgifterTotalt : 1;
  return (
    <div className="mb-6 rounded-lg border border-border bg-card/60 px-5 py-4">
      <span className="text-sm text-muted-foreground">
        Analysens säkerhet: {uppgifterKanda} av {uppgifterTotalt} uppgifter kända
      </span>
      <div className="mt-3 h-1 w-full rounded-full bg-secondary">
        <div
          className="h-1 rounded-full bg-primary transition-[width]"
          style={{ width: `${Math.round(andel * 100)}%` }}
        />
      </div>
    </div>
  );
}

function LockIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 1 1 8 0v3" />
    </svg>
  );
}
