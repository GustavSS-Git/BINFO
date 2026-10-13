import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { hamtaResultatFn } from "@/server/analysFn";
import { AnalysRapport } from "@/components/AnalysRapport";
import { PageHeader } from "@/components/ui/binfo";
import { sparaAnalys } from "@/lib/senasteAnalyser";

/**
 * Ren loader-route för den fullständiga, betalda rapporten — ingen egen
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
    <div className="mx-auto max-w-4xl px-5 py-14">
      <PageHeader eyebrow="Klar" title="Din analys" />
      <AnalysRapport analys={analys} />
    </div>
  );
}
