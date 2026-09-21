import { Card, Badge } from "@/components/ui/binfo";
import { kr } from "@/data/mockData";
import { formatSkapadDatum } from "@/lib/analysisView";
import type { PropertyInput } from "@/types/analysis";

/**
 * Liten sammanfattning av objektet — visas överst på rapportskärmar. Kräver
 * sina props explicit (inget prop-löst fallback-läge) så att ingen call-site
 * av misstag kan råka rendera exempeldata i tron att det är en ofarlig
 * placeholder — se AnalysRapport.tsx för den enda call-siten.
 */
export function PropertySummary({
  input,
  foreningNamn,
  skapad,
}: {
  input: PropertyInput;
  foreningNamn: string;
  skapad: string;
}) {
  const rows = [
    ["Utgångspris", kr(input.utgangspris)],
    ["Boarea", `${input.boarea.toFixed(1).replace(".", ",")} m²`],
    ["Månadsavgift", `${kr(input.manadsavgift)}/mån`],
    // Kontraktet har ingen "våning X av N" — bara en enskild våning, om känd.
    ["Våning", input.vaning !== undefined ? String(input.vaning) : "Okänt"],
    ["Byggår", input.byggar !== undefined ? String(input.byggar) : "Okänt"],
  ];
  return (
    <Card className="mb-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl text-foreground">{foreningNamn}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {input.adress}, {input.ort} · {input.antalRum} rum
          </p>
        </div>
        <Badge tone="teal">Analyserad {formatSkapadDatum(skapad)}</Badge>
      </div>
      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-6 md:grid-cols-5">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-sm font-medium text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
