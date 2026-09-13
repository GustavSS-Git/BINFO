import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { hamtaResultatFn, hamtaStatusFn } from "@/server/analysFn";
import { AnalysRapport } from "@/components/AnalysRapport";
import { Card, LinkButton, PageHeader } from "@/components/ui/binfo";
import {
  arAnalysHittadesInteFel,
  FELKOD_INNEHALL,
  STEG_TEXT,
  stegAndel,
  type AnalysErrorCode,
  type AnalysStage,
} from "@/lib/analysStatusCopy";
import type { AnalysisResult } from "@/types/analysis";

/** Formen `hamtaStatusFn` faktiskt svarar med — härledd av funktionens egen
 *  returtyp i stället för att importeras från src/server/portar.ts, som
 *  klientkod inte får nå (se @/lib/analysStatusCopy för samma resonemang). */
type StatusSvar = Awaited<ReturnType<typeof hamtaStatusFn>>;

/**
 * Pollningsintervall medan jobbet varken är klart eller misslyckat. Några
 * sekunder, inte snabbare — varje pollning är en riktig tur-och-retur till
 * servern, och ett jobb tar 195–326 sekunder totalt (PHASE1.md), så det
 * finns inget att vinna på tätare pollning.
 */
const POLLNINGSINTERVALL_MS = 5000;

interface LoaderData {
  status: StatusSvar;
  analys: AnalysisResult | null;
}

export const Route = createFileRoute("/analys_/$analysisId")({
  head: () => ({
    meta: [
      { title: "Din analys — Binfo" },
      {
        name: "description",
        content: "Följ analysens status och se den fullständiga rapporten när den är klar.",
      },
    ],
  }),
  // Hämtar status (och, om jobbet redan är klart, hela resultatet) server-
  // sidan innan sidan renderas första gången. Det gör att en direktlänk till
  // en klar eller misslyckad analys visar rätt innehåll direkt i den första
  // HTML-responsen, i stället för att alltid börja på en tom väntskärm som
  // sedan fylls i klientsidan. `AnalysStatusSida` nedan tar sedan över med
  // egen pollning (useQuery) för att hålla vyn levande utan omladdning.
  //
  // Kastar ALDRIG vidare — ett nätverks-/serverfel här ska aldrig trigga
  // routerns generiska, engelska ErrorComponent (se __root.tsx); i stället
  // faller vi tillbaka på samma svenska "hittades inte"-skärm som ett
  // genuint okänt id, vilket är en säker (om något missvisande i sällsynta
  // fall) reaktion snarare än en läckt felsida.
  loader: async ({ params }): Promise<LoaderData> => {
    const { analysisId } = params;
    try {
      const status = await hamtaStatusFn({ data: { analysisId } });
      if (status?.status === "done") {
        try {
          const analys = await hamtaResultatFn({ data: { analysisId } });
          return { status, analys };
        } catch (fel) {
          // Lämna analys tom: komponentens egen resultatQuery nedan gör om
          // anropet klientsidan och visar felet där. Men LOGGA det här —
          // aldrig svälj tyst. Det här fångade en riktig produktionsbugg: en
          // rad markerad 'done' vars lagrade property_input bar ett numera
          // borttaget fält fick assembleraAnalys att kasta, och utan loggen
          // syntes det bara som en evig "Hämtar rapporten…"-skärm i SSR-
          // svaret, med orsaken osynlig. Ett fel på en 'done'-rad är per
          // definition inte det "osannolika race" den här grenen först var
          // tänkt för — det är ett läsfel som någon behöver få syn på.
          console.error(
            `[analys/${analysisId}] status är 'done' men hamtaResultat kastade i loadern:`,
            fel,
          );
          return { status, analys: null };
        }
      }
      return { status, analys: null };
    } catch {
      return { status: null, analys: null };
    }
  },
  component: AnalysStatusSida,
});

function AnalysStatusSida() {
  const { analysisId } = Route.useParams();
  const loaderData = Route.useLoaderData();

  const statusQuery = useQuery({
    queryKey: ["analys-status", analysisId],
    queryFn: () => hamtaStatusFn({ data: { analysisId } }),
    initialData: loaderData.status,
    // Sluta polla så fort jobbet är i ett slutgiltigt tillstånd. Returnerar
    // `false` (inte 0) för att stänga av — TanStack Querys egen mekanism,
    // inte ett handskrivet setInterval, så uppstädning vid unmount sköts av
    // biblioteket: ingen timer kan bli kvar och ingen state kan sättas efter
    // att komponenten är borta.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || data.status === "done" || data.status === "failed") return false;
      return POLLNINGSINTERVALL_MS;
    },
  });

  const status = statusQuery.data;
  const klar = status?.status === "done";

  const resultatQuery = useQuery({
    queryKey: ["analys-resultat", analysisId],
    queryFn: () => hamtaResultatFn({ data: { analysisId } }),
    enabled: klar,
    initialData: klar ? (loaderData.analys ?? undefined) : undefined,
    // En klar analys ändras inte under sessionen — ingen anledning att
    // hämta om den bara för att komponenten monteras igen.
    staleTime: Infinity,
    // Ett okänt id ("hittades inte") är permanent och ska aldrig retryas;
    // andra fel (nätverk, tillfälligt serverfel) får några försök.
    retry: (antalForsok, fel) => !arAnalysHittadesInteFel(fel) && antalForsok < 2,
  });

  // I praktiken alltid definierad — loadern levererar redan `status` (kan
  // vara `null`, aldrig `undefined`) innan komponenten ens monteras. Kvar
  // som ett explicit, ofarligt fall snarare än en implicit tom skärm.
  if (status === undefined) {
    return <Vantar text="Kontrollerar status…" />;
  }

  if (status === null) {
    return <HittadesInte />;
  }

  if (status.status === "failed") {
    return <Misslyckad errorCode={status.errorCode} errorMessage={status.errorMessage} />;
  }

  if (!klar) {
    return <Pagar stage={status.stage} />;
  }

  // Explicit `=== undefined`-koll (i stället för `.isPending`/`.isSuccess`)
  // så att TypeScript faktiskt smalnar av `resultatQuery.data` till
  // `AnalysisResult` i grenen nedan — `initialData` kan här statiskt vara
  // `undefined` (innan loadern hunnit hämta resultatet), vilket gör att
  // biblioteket inte kan garantera ett alltid-definierat värde i typerna.
  if (resultatQuery.data === undefined) {
    if (resultatQuery.isError) {
      if (arAnalysHittadesInteFel(resultatQuery.error)) {
        return <HittadesInte />;
      }
      return <Misslyckad errorCode="unknown" />;
    }
    return <Vantar text="Hämtar rapporten…" />;
  }

  return (
    <div className="mx-auto max-w-4xl px-5 py-14">
      <PageHeader eyebrow="Klar" title="Din analys" />
      <AnalysRapport analys={resultatQuery.data} />
    </div>
  );
}

function Vantar({ text }: { text: string }) {
  return (
    <div className="mx-auto max-w-2xl px-5 py-14">
      <PageHeader eyebrow="Ett ögonblick" title={text} />
    </div>
  );
}

/** Väntskärmen medan jobbet pollas — det steg som faktiskt pågår, ett
 *  ärligt tidsspann, och en enkel förloppsstapel. Aldrig ett löfte om att
 *  det snart är klart. */
function Pagar({ stage }: { stage: AnalysStage }) {
  const andelProcent = Math.round(stegAndel(stage) * 100);

  return (
    <div className="mx-auto max-w-2xl px-5 py-14">
      <PageHeader eyebrow="Analyserar" title="Din analys pågår" />
      <Card>
        <p className="text-base font-medium text-foreground">{STEG_TEXT[stage]}</p>
        <div className="mt-4 h-1.5 w-full rounded-full bg-secondary">
          <div
            className="h-1.5 rounded-full bg-primary transition-[width]"
            style={{ width: `${andelProcent}%` }}
          />
        </div>
        <p className="mt-6 text-sm text-muted-foreground">
          Det här tar normalt <strong className="font-medium text-foreground">3–5 minuter</strong> —
          vi läser hela årsredovisningen och räknar på alla sju nyckeltal. Du kan gärna lämna den
          här fliken öppen; sidan uppdateras automatiskt så fort analysen är klar.
        </p>
      </Card>
    </div>
  );
}

function Misslyckad({
  errorCode,
  errorMessage,
}: {
  errorCode?: AnalysErrorCode | undefined;
  errorMessage?: string | undefined;
}) {
  const kod = errorCode ?? "unknown";
  const innehall = FELKOD_INNEHALL[kod];

  return (
    <div className="mx-auto max-w-2xl px-5 py-14">
      <PageHeader eyebrow="Analysen kunde inte slutföras" title={innehall.rubrik} />
      <Card>
        <p className="text-sm text-foreground">{errorMessage ?? innehall.forklaring}</p>
        {errorMessage ? (
          <p className="mt-4 text-sm text-muted-foreground">{innehall.forklaring}</p>
        ) : null}
        <p className="mt-4 text-sm font-medium text-foreground">{innehall.atgard}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <LinkButton to="/analysera" size="lg">
            Till formuläret
          </LinkButton>
        </div>
      </Card>
    </div>
  );
}

function HittadesInte() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-14">
      <PageHeader eyebrow="Hittades inte" title="Vi hittar ingen analys med det här id:t" />
      <Card>
        <p className="text-sm text-muted-foreground">
          Länken kan vara felstavad, eller så finns analysen inte längre. Ladda upp årsredovisningen
          på nytt för att starta en ny analys.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <LinkButton to="/analysera" size="lg">
            Starta en ny analys
          </LinkButton>
        </div>
      </Card>
    </div>
  );
}
