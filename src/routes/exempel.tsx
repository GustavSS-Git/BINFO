import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/ui/binfo";
import { AnalysRapport } from "@/components/AnalysRapport";
import { sampleAnalysis } from "@/data/sampleAnalysis";

/**
 * Statisk exempelrapport — läser `sampleAnalysis` direkt, ingen uppladdning,
 * ingen API-kostnad. Ersätter den gamla `/analys` (borttagen, se PHASE1.md
 * steg 5), som visade samma data men utan att tydliggöra att den var påhittad.
 * Länkas från startsidan; syftet är att visa vad en riktig analys innehåller
 * innan någon laddar upp något.
 */
export const Route = createFileRoute("/exempel")({
  head: () => ({
    meta: [
      { title: `Exempelanalys — ${sampleAnalysis.forening.namn} | Binfo` },
      {
        name: "description",
        content:
          "Se hur en fullständig Binfo-analys ser ut: sju nyckeltal, prisbedömning, räntestresstest och frågor att ställa till styrelsen. Exempeldata, ingen egen uppladdning.",
      },
      {
        property: "og:title",
        content: `Exempelanalys — ${sampleAnalysis.forening.namn} | Binfo`,
      },
      {
        property: "og:description",
        content: "Så här ser en Binfo-analys ut, med exempeldata.",
      },
    ],
  }),
  component: Exempel,
});

function Exempel() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-14">
      <PageHeader eyebrow="Exempelrapport" title="Så här ser en analys ut" />
      <div className="mb-8 rounded-lg border border-primary/20 bg-primary/5 px-5 py-4 text-sm text-foreground">
        Det här är en exempelrapport — en riktig analys av en riktig årsredovisning (Brf Granen
        10-11), men en tidigare körning, inte en ny analys av just den bostad du är intresserad av.
        Vill du analysera din egen bostad?{" "}
        <Link to="/analysera" className="font-medium text-primary underline underline-offset-2">
          Ladda upp en årsredovisning
        </Link>
        .
      </div>
      <AnalysRapport analys={sampleAnalysis} />
    </div>
  );
}
