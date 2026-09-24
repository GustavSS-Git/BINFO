import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { hamtaForhandsvisningFn, hamtaStatusFn } from "@/server/analysFn";
import { Card, Button, Badge, PageHeader } from "@/components/ui/binfo";
import {
  AnalysStatusVakt,
  HittadesInte,
  Misslyckad,
  Vantar,
  useAnalysStatusPolling,
  type StatusSvar,
} from "@/components/AnalysStatus";
import { arAnalysHittadesInteFel } from "@/lib/analysStatusCopy";
import type { Forhandsvisning, Severity } from "@/types/analysis";

/**
 * Riktig förhandsvisning för ett skapat analysjobb — landningssidan direkt
 * efter uppladdning (`/analysera`). Väntnings-/fel-/hittades-inte-vyerna
 * kommer från `AnalysStatusVakt` (src/components/AnalysStatus.tsx), delad
 * med `/analys/$analysisId` som redirectar hit för alla icke-klara/okända
 * tillstånd. Den fria innehållet nedan är EXAKT det `Forhandsvisning`
 * (src/types/analysis.ts) bär — betyg, upp till två röda flaggor och
 * datakvalitet — aldrig prisanalys, räntestress eller frågor. CTA:n är en
 * ren länk vidare till den fullständiga rapporten, ingen betalningstext —
 * betalväggen är uppskjuten, inte borttagen.
 */

interface LoaderData {
  status: StatusSvar;
  forhandsvisning: Forhandsvisning | null;
}

export const Route = createFileRoute("/forhandsvisning_/$analysisId")({
  head: () => ({
    meta: [
      { title: "Din analys — Binfo" },
      {
        name: "description",
        content: "Riskbetyg och de viktigaste röda flaggorna, gratis.",
      },
    ],
  }),
  // Samma mönster som /analys/$analysisId's loader (se den routens
  // kommentar för fullständig motivering): hämtar status, och om jobbet
  // redan är klart, förhandsvisningen — server-sidan, innan sidan
  // renderas första gången, så en direktlänk till en klar eller
  // misslyckad analys visar rätt innehåll direkt i SSR-svaret. Kastar
  // aldrig vidare — ett fel här faller tillbaka på samma svenska
  // "hittades inte"-skärm som ett genuint okänt id.
  loader: async ({ params }): Promise<LoaderData> => {
    const { analysisId } = params;
    try {
      const status = await hamtaStatusFn({ data: { analysisId } });
      if (status?.status === "done") {
        try {
          const forhandsvisning = await hamtaForhandsvisningFn({ data: { analysisId } });
          return { status, forhandsvisning };
        } catch (fel) {
          console.error(
            `[forhandsvisning/${analysisId}] status är 'done' men hamtaForhandsvisning kastade i loadern:`,
            fel,
          );
          return { status, forhandsvisning: null };
        }
      }
      return { status, forhandsvisning: null };
    } catch {
      return { status: null, forhandsvisning: null };
    }
  },
  component: ForhandsvisningSida,
});

function ForhandsvisningSida() {
  const { analysisId } = Route.useParams();
  const loaderData = Route.useLoaderData();

  return (
    <AnalysStatusVakt analysisId={analysisId} initialStatus={loaderData.status}>
      {() => <ForhandsvisningInnehall analysisId={analysisId} loaderData={loaderData} />}
    </AnalysStatusVakt>
  );
}

/** Renderas bara när `AnalysStatusVakt` redan konstaterat att jobbet är
 *  klart — hämtar (om den inte redan kom med SSR-svaret) den smala
 *  förhandsvisnings-projektionen och visar den. */
function ForhandsvisningInnehall({ analysisId, loaderData }: { analysisId: string; loaderData: LoaderData }) {
  const navigate = useNavigate();

  // Samma statuspollning som grinden ovan redan startade — TanStack Query
  // dedupar på queryKey, så det här är inget extra nätverksanrop. Behövs
  // bara för att avgöra `enabled` här nedan (grinden garanterar redan att vi
  // är i 'done'-läge när den här komponenten monteras).
  const statusQuery = useAnalysStatusPolling(analysisId, loaderData.status);
  const klar = statusQuery.data?.status === "done";

  const forhandsvisningQuery = useQuery({
    queryKey: ["forhandsvisning", analysisId],
    queryFn: () => hamtaForhandsvisningFn({ data: { analysisId } }),
    enabled: klar,
    initialData: klar ? (loaderData.forhandsvisning ?? undefined) : undefined,
    // En klar förhandsvisning ändras inte under sessionen.
    staleTime: Infinity,
    // Ett okänt id ("hittades inte") är permanent och ska aldrig retryas;
    // andra fel (nätverk, tillfälligt serverfel) får några försök.
    retry: (antalForsok, fel) => !arAnalysHittadesInteFel(fel) && antalForsok < 2,
  });

  if (forhandsvisningQuery.data === undefined) {
    if (forhandsvisningQuery.isError) {
      if (arAnalysHittadesInteFel(forhandsvisningQuery.error)) {
        return <HittadesInte />;
      }
      return <Misslyckad errorCode="unknown" />;
    }
    return <Vantar text="Hämtar förhandsvisningen…" />;
  }

  const forhandsvisning = forhandsvisningQuery.data;
  const visarToppFlaggor = forhandsvisning.gratisSektioner.includes("rodaFlaggor_topp2");

  return (
    <div className="mx-auto max-w-4xl px-5 py-14">
      <PageHeader eyebrow="Steg 2 av 3" title={forhandsvisning.forening.namn} />

      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-8">
          <div className="flex size-28 shrink-0 items-center justify-center rounded-full border-4 border-primary/20 bg-primary/5">
            <span className="font-display text-4xl text-primary">{forhandsvisning.betyg}</span>
          </div>
          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sammanvägt riskbetyg</p>
            <p className="mt-2 max-w-xl text-base text-foreground">{forhandsvisning.betygMotivering}</p>
          </div>
        </div>
      </Card>

      {visarToppFlaggor && forhandsvisning.rodaFlaggor.length > 0 ? (
        <div className="mb-6 grid gap-5 md:grid-cols-2">
          {forhandsvisning.rodaFlaggor.map((f) => (
            <Card key={f.id}>
              <Badge tone={severityTone[f.severity]}>{severityLabel[f.severity]}</Badge>
              <h3 className="mt-4 text-base font-semibold text-foreground">{f.titel}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.beskrivning}</p>
            </Card>
          ))}
        </div>
      ) : null}

      <div className="relative mb-8">
        <div className="grid gap-5 md:grid-cols-2" aria-hidden>
          {LASTA_INSIKTER.map((i) => (
            <Card key={i.titel} className="select-none blur-[6px]">
              <h3 className="text-base font-semibold text-foreground">{i.titel}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{i.text}</p>
            </Card>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex items-center gap-2 rounded-full bg-card px-5 py-3 text-sm font-medium text-foreground shadow-[0_2px_10px_rgba(22,32,46,0.12)]">
            <LockIcon /> Fyra insikter till i den fullständiga analysen
          </span>
        </div>
      </div>

      <Card className="bg-primary text-primary-foreground">
        <h2 className="font-display text-2xl md:text-3xl">Se hela analysen</h2>
        <p className="mt-3 max-w-xl text-sm text-primary-foreground/80">
          Viktiga nyckeltal med förklaringar, prisbedömning, räntestresstest och frågor att ställa till styrelsen.
        </p>
        <Button
          variant="secondary"
          size="lg"
          className="mt-6"
          onClick={() => navigate({ to: "/analys/$analysisId", params: { analysisId } })}
        >
          Se hela analysen
        </Button>
      </Card>
    </div>
  );
}

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

/** Fyra insikter som ligger bortom den fria förhandsvisningen. Samma
 *  marknadsföringstext som den statiska /forhandsvisning-sidan — inte
 *  knuten till något kontraktsfält. */
const LASTA_INSIKTER = [
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
    text: "Skräddarsydda frågor baserade på det som sticker ut i just den här årsredovisningen.",
  },
  {
    titel: "Fullständig nyckeltalsgenomgång",
    text: "Alla sju lagstadgade nyckeltal, förklarade i vanlig svenska och jämförda mot riktvärden.",
  },
];

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 1 1 8 0v3" />
    </svg>
  );
}
