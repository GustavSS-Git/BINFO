import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/ui/binfo";
import { AnalysRapport } from "@/components/AnalysRapport";
import { sampleAnalysis } from "@/data/sampleAnalysis";

export const Route = createFileRoute("/analys")({
  head: () => ({
    meta: [
      { title: `Fullständig analys — ${sampleAnalysis.forening.namn} | Binfo` },
      {
        name: "description",
        content:
          "Sju nyckeltal, prisbedömning, räntestresstest och frågor att ställa till styrelsen.",
      },
      {
        property: "og:title",
        content: `Fullständig analys — ${sampleAnalysis.forening.namn} | Binfo`,
      },
      {
        property: "og:description",
        content: "Hela riskanalysen för lägenheten: ekonomi, pris, räntestress och frågor.",
      },
    ],
  }),
  component: FullAnalys,
});

function FullAnalys() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-14">
      <PageHeader eyebrow="Steg 3 av 3 · Upplåst" title="Fullständig analys" />
      <AnalysRapport analys={sampleAnalysis} />
    </div>
  );
}
