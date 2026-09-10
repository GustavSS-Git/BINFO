import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Card, Field, PageHeader, Badge } from "@/components/ui/binfo";
import { property, kalkylDefaults, avgiftPerProcentenhet, kr } from "@/data/mockData";

export const Route = createFileRoute("/bolanekalkyl")({
  head: () => ({
    meta: [
      { title: "Bolånekalkyl med amorteringskrav — Binfo" },
      {
        name: "description",
        content:
          "Räkna ut din totala månadskostnad: ränta, amortering enligt svenska amorteringskrav och avgift.",
      },
      { property: "og:title", content: "Bolånekalkyl med amorteringskrav — Binfo" },
      {
        property: "og:description",
        content: "Belåningsgrad, skuldkvot och total månadskostnad för objektet du tittar på.",
      },
    ],
  }),
  component: Bolanekalkyl,
});

const num = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(/\s/g, "")));

function Bolanekalkyl() {
  const [lanebelopp, setLanebelopp] = useState(String(kalkylDefaults.lanebelopp));
  const [ranta, setRanta] = useState(String(kalkylDefaults.ranta));
  const [kontantinsats, setKontantinsats] = useState(String(kalkylDefaults.kontantinsats));
  const [inkomst, setInkomst] = useState(String(kalkylDefaults.bruttoinkomst));
  const [delta, setDelta] = useState(0);

  const r = useMemo(() => {
    const lan = num(lanebelopp);
    const kontant = num(kontantinsats);
    const brutto = num(inkomst);
    const bostadsvarde = lan + kontant;
    const belaningsgrad = bostadsvarde > 0 ? lan / bostadsvarde : 0;

    // Svenska amorteringskravet
    let takt = 0;
    if (belaningsgrad > 0.7) takt = 0.02;
    else if (belaningsgrad > 0.5) takt = 0.01;

    const skuldkvot = brutto > 0 ? lan / brutto : 0;
    const skarptKrav = skuldkvot > 4.5;
    if (skarptKrav) takt += 0.01;

    const effektivRanta = num(ranta) + delta;
    const rantekostnad = (lan * (effektivRanta / 100)) / 12;
    const amortering = (lan * takt) / 12;
    const avgift = property.manadsavgift + avgiftPerProcentenhet * delta;

    return {
      lan,
      bostadsvarde,
      belaningsgrad,
      takt,
      skuldkvot,
      skarptKrav,
      effektivRanta,
      rantekostnad,
      amortering,
      avgift,
      total: rantekostnad + amortering + avgift,
    };
  }, [lanebelopp, ranta, kontantinsats, inkomst, delta]);

  return (
    <div className="mx-auto max-w-5xl px-5 py-14">
      <PageHeader
        eyebrow="Bolånekalkyl"
        title="Vad kostar bostaden per månad?"
        lead={`Månadsavgiften hämtas automatiskt från ${property.namn}.`}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card>
          <div className="grid gap-5">
            <Field label="Lånebelopp" suffix="kr" value={lanebelopp} onChange={setLanebelopp} />
            <Field label="Kontantinsats" suffix="kr" value={kontantinsats} onChange={setKontantinsats} />
            <Field label="Ränta" suffix="%" value={ranta} onChange={setRanta} />
            <Field
              label="Hushållets bruttoinkomst per år"
              suffix="kr"
              value={inkomst}
              onChange={setInkomst}
            />
            <div>
              <div className="flex items-baseline justify-between">
                <label htmlFor="stress2" className="text-sm font-medium text-foreground">
                  Räntestress
                </label>
                <span className="text-sm text-primary">
                  +{delta.toFixed(1).replace(".", ",")} p.e.
                </span>
              </div>
              <input
                id="stress2"
                type="range"
                min={0}
                max={3}
                step={0.1}
                value={delta}
                onChange={(e) => setDelta(Number(e.target.value))}
                className="mt-3 w-full accent-primary"
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Höjer både din ränta ({r.effektivRanta.toFixed(2).replace(".", ",")} %) och
                föreningens avgift.
              </p>
            </div>
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Total månadskostnad
            </p>
            <p className="mt-2 font-display text-5xl text-foreground">{kr(r.total)}</p>
            <div className="mt-6 divide-y divide-border">
              {[
                ["Räntekostnad (före ränteavdrag)", r.rantekostnad],
                ["Amortering", r.amortering],
                ["Månadsavgift", r.avgift],
              ].map(([label, value]) => (
                <div key={label as string} className="flex items-center justify-between py-3">
                  <span className="text-sm text-muted-foreground">{label as string}</span>
                  <span className="text-sm font-medium text-foreground">
                    {kr(value as number)}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h2 className="text-base font-semibold text-foreground">Amorteringskravet</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Belåningsgrad</dt>
                <dd className="font-medium text-foreground">
                  {(r.belaningsgrad * 100).toFixed(1).replace(".", ",")} %
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Skuldkvot (lån / bruttoinkomst)</dt>
                <dd className="font-medium text-foreground">
                  {r.skuldkvot.toFixed(2).replace(".", ",")} ×
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Tillämpad amorteringstakt</dt>
                <dd className="font-medium text-foreground">
                  {(r.takt * 100).toFixed(0)} % per år
                </dd>
              </div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge tone={r.belaningsgrad > 0.7 ? "danger" : r.belaningsgrad > 0.5 ? "warning" : "success"}>
                {r.belaningsgrad > 0.7
                  ? "Över 70 % → 2 %"
                  : r.belaningsgrad > 0.5
                    ? "50–70 % → 1 %"
                    : "Under 50 % → inget grundkrav"}
              </Badge>
              {r.skarptKrav ? (
                <Badge tone="warning">Lån över 4,5 × årsinkomst → +1 %</Badge>
              ) : (
                <Badge tone="success">Under 4,5 × årsinkomst</Badge>
              )}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Bostadens värde beräknas som lånebelopp + kontantinsats ({kr(r.bostadsvarde)}).
              Ränteavdrag (30 % upp till 100 000 kr) är inte inräknat.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
