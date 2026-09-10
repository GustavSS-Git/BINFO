import { Card, Badge } from "@/components/ui/binfo";
import { property, kr } from "@/data/mockData";

/** Liten sammanfattning av objektet — visas överst på rapport- och kalkylskärmar. */
export function PropertySummary() {
  const rows = [
    ["Utgångspris", kr(property.utgangspris)],
    ["Boarea", `${property.boarea} m²`],
    ["Månadsavgift", `${kr(property.manadsavgift)}/mån`],
    ["Våning", `${property.vaning} av ${property.vaningarTotalt}`],
    ["Andelstal", `${property.andelstal.toString().replace(".", ",")} %`],
    ["Byggår", String(property.byggar)],
  ];
  return (
    <Card className="mb-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl text-foreground">{property.namn}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {property.adress}, {property.ort} · {property.rum}
          </p>
        </div>
        <Badge tone="teal">Analyserad 10 sep 2026</Badge>
      </div>
      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-6 md:grid-cols-6">
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
