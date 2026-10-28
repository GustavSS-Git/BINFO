import { createFileRoute, Link } from "@tanstack/react-router";
import { AnalysRapport } from "@/components/AnalysRapport";
import { sampleAnalysis } from "@/data/sampleAnalysis";

/**
 * Statisk exempelrapport — läser `sampleAnalysis` direkt, ingen uppladdning,
 * ingen API-kostnad. Ersätter den gamla statiska `/analys` (borttagen), som
 * visade samma data men utan att tydliggöra att den var påhittad.
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
    <>
      <div className="border-b border-notice-border bg-notice">
        <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-3 text-sm text-notice-text sm:px-8">
          <strong>Exempelrapport.</strong>
          <span>
            En riktig analys av en riktig årsredovisning, men inte av den bostad du tittar på.
          </span>
          <Link to="/analysera" className="font-semibold text-notice-text underline">
            Analysera din egen
          </Link>
        </div>
      </div>
      <div className="mx-auto w-full max-w-[1200px] px-4 py-12 sm:px-8 md:py-16">
        <AnalysRapport analys={sampleAnalysis} />
      </div>
    </>
  );
}
