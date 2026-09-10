import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Card, Button, Badge, StatusDot, SectionTitle, PageHeader, LinkButton } from "@/components/ui/binfo";
import { PropertySummary } from "@/components/PropertySummary";
import {
  nyckeltal,
  prisjamforelse,
  fragorAttStalla,
  property,
  risk,
  avgiftPerProcentenhet,
  kr,
} from "@/data/mockData";

export const Route = createFileRoute("/analys")({
  head: () => ({
    meta: [
      { title: "Fullständig analys — Brf Lindgården | Binfo" },
      {
        name: "description",
        content:
          "Sju nyckeltal, prisbedömning, räntestresstest och frågor att ställa till styrelsen.",
      },
      { property: "og:title", content: "Fullständig analys — Brf Lindgården | Binfo" },
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
      <PropertySummary />

      <Card className="mb-6 flex flex-wrap items-center gap-6">
        <div className="flex size-20 items-center justify-center rounded-full border-4 border-primary/20 bg-primary/5 font-display text-3xl text-primary">
          {risk.betyg}
        </div>
        <p className="max-w-xl flex-1 text-sm text-foreground">{risk.sammanfattning}</p>
      </Card>

      <Foreningsekonomi />
      <Prisrimlighet />
      <Rantestress />
      <Fragor />

      <div className="mt-10 flex flex-wrap gap-4">
        {/* TODO(export): PDF-generering kopplas in här. */}
        <Button variant="secondary" size="lg">
          Ladda ner som PDF
        </Button>
        <LinkButton to="/bolanekalkyl" size="lg">
          Räkna på månadskostnaden
        </LinkButton>
      </div>
    </div>
  );
}

function Foreningsekonomi() {
  return (
    <section className="mb-10">
      <SectionTitle hint="De sju nyckeltal som föreningen enligt lag ska redovisa — översatta till vanlig svenska.">
        Föreningens ekonomi
      </SectionTitle>
      <div className="space-y-3">
        {nyckeltal.map((n) => (
          <Card
            key={n.namn}
            className={n.highlight ? "border-primary/40 bg-primary/[0.04] p-5 md:p-6" : "p-5 md:p-6"}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="flex items-center gap-3 text-base font-semibold text-foreground">
                <StatusDot status={n.status} />
                {n.namn}
                {n.highlight ? <Badge tone="teal">Viktigast här</Badge> : null}
              </h3>
              <p className="font-display text-2xl text-foreground">{n.varde}</p>
            </div>
            <p className="mt-2 pl-[22px] text-sm text-muted-foreground">{n.forklaring}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}

function Prisrimlighet() {
  const { utgangspris, boolivardering, senasteForsaljning, verdikt } = prisjamforelse;
  const diffVardering = ((utgangspris - boolivardering) / boolivardering) * 100;
  const jamforPris = (senasteForsaljning.pris / senasteForsaljning.boarea) * property.boarea;
  const diffSenaste = ((utgangspris - jamforPris) / jamforPris) * 100;

  const rader = [
    { label: "Utgångspris", value: kr(utgangspris), diff: null as number | null },
    { label: "Boolis värdering", value: kr(boolivardering), diff: diffVardering },
    {
      label: `Senaste försäljningen i föreningen (${senasteForsaljning.datum})`,
      value: kr(senasteForsaljning.pris),
      diff: diffSenaste,
      note: senasteForsaljning.beskrivning,
    },
  ];

  return (
    <section className="mb-10">
      <SectionTitle hint="Jämförelse mot värdering och faktisk affär i samma hus.">
        Är priset rimligt?
      </SectionTitle>
      <Card>
        <div className="divide-y divide-border">
          {rader.map((r) => (
            <div key={r.label} className="flex flex-wrap items-center justify-between gap-2 py-4 first:pt-0 last:pb-0">
              <div>
                <p className="text-sm font-medium text-foreground">{r.label}</p>
                {r.note ? <p className="text-xs text-muted-foreground">{r.note}</p> : null}
              </div>
              <div className="text-right">
                <p className="font-display text-xl text-foreground">{r.value}</p>
                {r.diff !== null ? (
                  <p
                    className={`text-xs ${r.diff > 0 ? "text-danger" : "text-success"}`}
                  >
                    Utgångspriset ligger {Math.abs(r.diff).toFixed(1).replace(".", ",")} %{" "}
                    {r.diff > 0 ? "över" : "under"} (jämfört per m²)
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-6 rounded-xl bg-secondary p-4 text-sm text-foreground">{verdikt}</p>
      </Card>
    </section>
  );
}

function Rantestress() {
  const [delta, setDelta] = useState(1);
  const stressad = property.manadsavgift + avgiftPerProcentenhet * delta;
  const okning = ((stressad - property.manadsavgift) / property.manadsavgift) * 100;

  return (
    <section className="mb-10">
      <SectionTitle hint="Dra i reglaget för att se hur just den här lägenhetens avgift påverkas.">
        Vad händer om räntan stiger?
      </SectionTitle>
      <Card>
        <div className="flex items-baseline justify-between">
          <label htmlFor="stress" className="text-sm font-medium text-foreground">
            Räntehöjning
          </label>
          <span className="font-display text-2xl text-primary">
            +{delta.toFixed(1).replace(".", ",")} p.e.
          </span>
        </div>
        <input
          id="stress"
          type="range"
          min={0}
          max={3}
          step={0.1}
          value={delta}
          onChange={(e) => setDelta(Number(e.target.value))}
          className="mt-4 w-full accent-primary"
        />
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Dagens avgift</p>
            <p className="mt-2 font-display text-3xl text-foreground">
              {kr(property.manadsavgift)}
            </p>
            <p className="text-xs text-muted-foreground">per månad</p>
          </div>
          <div className="rounded-xl border border-primary/30 bg-primary/[0.05] p-5">
            <p className="text-xs uppercase tracking-wide text-primary">Stressad avgift</p>
            <p className="mt-2 font-display text-3xl text-foreground">{kr(stressad)}</p>
            <p className="text-xs text-muted-foreground">
              per månad · +{okning.toFixed(1).replace(".", ",")} %
            </p>
          </div>
        </div>
        <p className="mt-5 text-sm text-muted-foreground">
          Beräknat på din andel av föreningens skuld ({kr(8_500 * property.boarea)}) vid full
          genomslagseffekt. Snitträntan i dag är{" "}
          {property.snittranta.toString().replace(".", ",")} %.
        </p>
      </Card>
    </section>
  );
}

function Fragor() {
  const [checked, setChecked] = useState<number[]>([]);
  const toggle = (i: number) =>
    setChecked((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]));

  return (
    <section>
      <SectionTitle hint="Ta med listan till visningen. Svaren avgör om riskbetyget bör justeras.">
        Frågor att ställa
      </SectionTitle>
      <Card>
        <ul className="space-y-3">
          {fragorAttStalla.map((f, i) => (
            <li key={f}>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl p-3 hover:bg-secondary">
                <input
                  type="checkbox"
                  checked={checked.includes(i)}
                  onChange={() => toggle(i)}
                  className="mt-0.5 size-4 accent-[var(--primary)]"
                />
                <span
                  className={`text-sm ${checked.includes(i) ? "text-muted-foreground line-through" : "text-foreground"}`}
                >
                  {f}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
