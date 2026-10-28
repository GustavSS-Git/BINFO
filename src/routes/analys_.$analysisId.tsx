import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { hamtaResultatFn } from "@/server/analysFn";
import { AnalysRapport } from "@/components/AnalysRapport";
import { SparaAnalysVy } from "@/components/konto/SparaAnalys";
import { useSparaAnalys } from "@/components/konto/useSparaAnalys";
import { sparaAnalys } from "@/lib/senasteAnalyser";
import { parseAnalysSok } from "@/lib/till";

/**
 * Ren loader-route för den fullständiga rapporten — ingen egen
 * pollning. `hamtaResultatFn` kastar `AnalysInteKlarError` för varje status
 * som inte är `done` (inklusive `failed` — se src/server/analys.ts) och
 * `AnalysHittadesInteError` för ett okänt id. Båda, och alla andra fel,
 * gör att loadern redirectar till `/forhandsvisning/$analysisId`, som äger
 * väntnings-/fel-/hittades-inte-skärmarna (delade via
 * src/components/AnalysStatus.tsx). Det gör den här routen säker att länka
 * till eller bokmärka även innan jobbet är klart — den studsar bara vidare
 * till skärmen som vet hur man väntar.
 */
export const Route = createFileRoute("/analys_/$analysisId")({
  head: () => ({
    meta: [
      { title: "Din analys — Binfo" },
      { name: "robots", content: "noindex" },
      {
        name: "description",
        content: "Den fullständiga analysen: nyckeltal, prisbedömning, räntestresstest och frågor.",
      },
    ],
  }),
  // `?spara=analys`: slutför ett väntande "Spara analysen" efter inloggningen.
  validateSearch: parseAnalysSok,
  loader: async ({ params }) => {
    const { analysisId } = params;
    try {
      return await hamtaResultatFn({ data: { analysisId } });
    } catch {
      throw redirect({ to: "/forhandsvisning/$analysisId", params: { analysisId } });
    }
  },
  component: AnalysSida,
});

function AnalysSida() {
  const analys = Route.useLoaderData();
  const { spara } = Route.useSearch();
  const navigate = useNavigate();
  const sparaTillstand = useSparaAnalys({
    analysisId: analys.analysisId,
    spara,
    rensaParam: () =>
      void navigate({
        to: "/analys/$analysisId",
        params: { analysisId: analys.analysisId },
        search: {},
        replace: true,
      }),
  });

  // Uppdaterar historiken (src/lib/senasteAnalyser.ts) med det autentiska,
  // servergenererade `skapad` och föreningens namn — sätts redan vid
  // skapandet (analysera.tsx) utan namn, och kompletteras här. Fångar också
  // en delad rapportlänk som öppnas direkt, utan att ha gått via
  // /analysera.
  useEffect(() => {
    sparaAnalys({
      analysisId: analys.analysisId,
      skapad: analys.skapad,
      foreningsnamn: analys.forening.namn,
    });
  }, [analys.analysisId, analys.skapad, analys.forening.namn]);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-12 sm:px-8 md:py-16">
      <AnalysRapport
        analys={analys}
        lankaFranKalkyl
        sparaSlot={<SparaAnalysVy variant="topp" {...sparaTillstand} />}
        sparaKort={<SparaAnalysVy variant="kort" {...sparaTillstand} />}
      />
    </div>
  );
}
