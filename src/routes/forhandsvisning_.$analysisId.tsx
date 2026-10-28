import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { hamtaResultatFn, hamtaStatusFn } from "@/server/analysFn";
import { AnalysRapport } from "@/components/AnalysRapport";
import { SparaAnalysVy } from "@/components/konto/SparaAnalys";
import { useSparaAnalys } from "@/components/konto/useSparaAnalys";
import { Callout } from "@/components/ui/binfo";
import {
  AnalysStatusVakt,
  HittadesInte,
  Misslyckad,
  Vantar,
  useAnalysStatusPolling,
  type StatusSvar,
} from "@/components/AnalysStatus";
import { arAnalysHittadesInteFel } from "@/lib/analysStatusCopy";
import { klarNotis } from "@/lib/analysStatusVy";
import { sparaAnalys } from "@/lib/senasteAnalyser";
import { parseAnalysSok } from "@/lib/till";
import type { AnalysisResult } from "@/types/analysis";

/**
 * Landningssidan direkt efter uppladdning (`/analysera`): väntar in jobbet och
 * visar sedan hela analysen på plats (samma innehåll som `/analys/$analysisId`).
 * Väntnings-/fel-/hittades-inte-vyerna kommer från `AnalysStatusVakt`
 * (src/components/AnalysStatus.tsx), delad med `/analys/$analysisId` som
 * redirectar hit för alla icke-klara/okända tillstånd. Resultatet renderas
 * inline i stället för att redirecta tillbaka: `/analys` skickar hit vid varje
 * fel, så en klar men oläsbar analys skulle annars loopa.
 */

interface LoaderData {
  status: StatusSvar;
  resultat: AnalysisResult | null;
}

export const Route = createFileRoute("/forhandsvisning_/$analysisId")({
  head: () => ({
    meta: [
      { title: "Din analys — Binfo" },
      { name: "robots", content: "noindex" },
      {
        name: "description",
        content: "Din analys: riskbetyg, nyckeltal, prisbedömning, räntestresstest och frågor.",
      },
    ],
  }),
  // `?spara=analys`: slutför ett väntande "Spara analysen" efter inloggningen.
  validateSearch: parseAnalysSok,
  // Samma mönster som /analys/$analysisId's loader (se den routens
  // kommentar för fullständig motivering): hämtar status, och om jobbet
  // redan är klart, hela resultatet — server-sidan, innan sidan
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
          const resultat = await hamtaResultatFn({ data: { analysisId } });
          return { status, resultat };
        } catch (fel) {
          console.error(
            `[forhandsvisning/${analysisId}] status är 'done' men hamtaResultat kastade i loadern:`,
            fel,
          );
          return { status, resultat: null };
        }
      }
      return { status, resultat: null };
    } catch {
      return { status: null, resultat: null };
    }
  },
  component: ForhandsvisningSida,
});

function ForhandsvisningSida() {
  const { analysisId } = Route.useParams();
  const loaderData = Route.useLoaderData();

  return (
    <AnalysStatusVakt analysisId={analysisId} initialStatus={loaderData.status}>
      {() => <KlarInnehall analysisId={analysisId} loaderData={loaderData} />}
    </AnalysStatusVakt>
  );
}

/** Renderas bara när `AnalysStatusVakt` redan konstaterat att jobbet är
 *  klart — hämtar (om det inte redan kom med SSR-svaret) hela resultatet och
 *  visar det. */
function KlarInnehall({ analysisId, loaderData }: { analysisId: string; loaderData: LoaderData }) {
  // Samma statuspollning som grinden ovan redan startade — TanStack Query
  // dedupar på queryKey, så det här är inget extra nätverksanrop. Behövs
  // bara för att avgöra `enabled` här nedan (grinden garanterar redan att vi
  // är i 'done'-läge när den här komponenten monteras).
  const statusQuery = useAnalysStatusPolling(analysisId, loaderData.status);
  const klar = statusQuery.data?.status === "done";
  const aterAnvandNotis = statusQuery.data ? klarNotis(statusQuery.data) : undefined;

  const { spara } = Route.useSearch();
  const navigate = useNavigate();
  const sparaTillstand = useSparaAnalys({
    analysisId,
    spara,
    rensaParam: () =>
      void navigate({
        to: "/forhandsvisning/$analysisId",
        params: { analysisId },
        search: {},
        replace: true,
      }),
  });

  const resultatQuery = useQuery({
    queryKey: ["resultat", analysisId],
    queryFn: () => hamtaResultatFn({ data: { analysisId } }),
    enabled: klar,
    initialData: klar ? (loaderData.resultat ?? undefined) : undefined,
    // Ett klart resultat ändras inte under sessionen.
    staleTime: Infinity,
    // Ett okänt id ("hittades inte") är permanent och ska aldrig retryas;
    // andra fel (nätverk, tillfälligt serverfel) får några försök.
    retry: (antalForsok, fel) => !arAnalysHittadesInteFel(fel) && antalForsok < 2,
  });

  // Kommer man hit direkt via en delad länk (nytt id, ny enhet) ska den
  // fortfarande dyka upp i "Dina senaste analyser" på /analysera — därför
  // sparas den här också, inte bara vid skapandet. Måste stå FÖRE de tidiga
  // returnerna nedan: annars kallas hooken olika många gånger mellan
  // renderingar (regeln om hooks) beroende på om datan hunnit laddas.
  const analys = resultatQuery.data;
  useEffect(() => {
    if (!analys) return;
    sparaAnalys({ analysisId, skapad: analys.skapad, foreningsnamn: analys.forening.namn });
  }, [analysisId, analys]);

  if (analys === undefined) {
    if (resultatQuery.isError) {
      if (arAnalysHittadesInteFel(resultatQuery.error)) {
        return <HittadesInte />;
      }
      return <Misslyckad errorCode="unknown" />;
    }
    return <Vantar text="Hämtar analysen…" />;
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-8 md:py-14">
      {aterAnvandNotis ? (
        <div className="mb-6">
          <Callout variant="tip" title={aterAnvandNotis.titel}>
            <p>{aterAnvandNotis.text}</p>
          </Callout>
        </div>
      ) : null}

      <AnalysRapport
        analys={analys}
        sparaSlot={<SparaAnalysVy variant="topp" {...sparaTillstand} />}
      />
      <SparaAnalysVy variant="kort" {...sparaTillstand} />
    </div>
  );
}
