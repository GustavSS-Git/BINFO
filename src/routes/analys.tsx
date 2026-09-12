import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Card,
  Button,
  Badge,
  StatusDot,
  SectionTitle,
  PageHeader,
  LinkButton,
  Tag,
} from "@/components/ui/binfo";
import { PropertySummary } from "@/components/PropertySummary";
import { kr } from "@/data/mockData";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import { visasIHuvudanalys } from "@/lib/analysis/benchmarks";
import { formatFigureVarde, formatVarde } from "@/lib/analysisView";
import type { Fraga, RantestressScenario } from "@/types/analysis";

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
      <Sakerhetsmatare />
      <PropertySummary />

      <Card className="mb-6 flex flex-wrap items-center gap-6">
        <div className="flex size-20 items-center justify-center rounded-full border-4 border-primary/20 bg-primary/5 font-display text-3xl text-primary">
          {sampleAnalysis.betyg}
        </div>
        <p className="max-w-xl flex-1 text-sm text-foreground">{sampleAnalysis.betygMotivering}</p>
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
  const keyFigures = sampleAnalysis.forening.keyFigures.filter((kf) => visasIHuvudanalys(kf.id));

  return (
    <section className="mb-10">
      <SectionTitle hint="De sju nyckeltal som föreningen enligt lag ska redovisa — översatta till vanlig svenska.">
        Föreningens ekonomi
      </SectionTitle>
      <div className="space-y-3">
        {keyFigures.map((kf) => {
          const highlight = kf.id === "rantekanslighet";
          return (
            <Card
              key={kf.id}
              className={
                highlight ? "border-primary/40 bg-primary/[0.04] p-5 md:p-6" : "p-5 md:p-6"
              }
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h3 className="flex items-center gap-3 text-base font-semibold text-foreground">
                  <StatusDot status={kf.status} />
                  {kf.label}
                  {highlight ? <Badge tone="teal">Viktigast här</Badge> : null}
                </h3>
                <p className="font-display text-2xl text-foreground">
                  {formatFigureVarde(kf.figure)}
                </p>
              </div>
              <p className="mt-2 pl-[22px] text-sm text-muted-foreground">
                {kf.forklaring}
                {kf.benchmark ? (
                  <span className="mt-1 block text-xs text-muted-foreground/80">
                    {kf.benchmark.label}: {formatVarde(kf.benchmark.value, kf.figure.unit)}
                  </span>
                ) : null}
              </p>
              {kf.figure.source === "schablon" || kf.figure.ref ? (
                <div className="mt-2 flex items-center gap-2 pl-[22px]">
                  {kf.figure.source === "schablon" ? <Tag>Schablon</Tag> : null}
                  {kf.figure.ref ? (
                    <span title={kf.figure.ref.excerpt}>
                      <Tag>s. {kf.figure.ref.page}</Tag>
                    </span>
                  ) : null}
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function Prisrimlighet() {
  const p = sampleAnalysis.prisanalys;
  const forsaljningar = p.senasteForsaljningarIForeningen ?? [];

  return (
    <section className="mb-10">
      <SectionTitle hint="Jämförelse mot värdering och faktisk affär i samma hus.">
        Är priset rimligt?
      </SectionTitle>
      <Card>
        <div className="divide-y divide-border">
          <div className="flex flex-wrap items-center justify-between gap-2 py-4 first:pt-0 last:pb-0">
            <p className="text-sm font-medium text-foreground">Utgångspris</p>
            <p className="font-display text-xl text-foreground">
              {formatFigureVarde(p.utgangspris)}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 py-4 first:pt-0 last:pb-0">
            <p className="text-sm font-medium text-foreground">Pris per kvadratmeter</p>
            <p className="font-display text-xl text-foreground">{formatFigureVarde(p.prisPerM2)}</p>
          </div>

          {p.externVardering ? (
            <div className="flex flex-wrap items-center justify-between gap-2 py-4 first:pt-0 last:pb-0">
              <div>
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  Extern värdering
                  {p.externVardering.source === "schablon" ? <Tag>Schablon</Tag> : null}
                </p>
                <p className="text-xs text-muted-foreground">{p.externVardering.leverantor}</p>
              </div>
              <div className="text-right">
                <p className="font-display text-xl text-foreground">
                  {formatFigureVarde(p.externVardering)}
                </p>
                {p.avvikelseMotVardering !== undefined ? (
                  <p
                    className={`text-xs ${p.avvikelseMotVardering > 0 ? "text-danger" : "text-success"}`}
                  >
                    Utgångspriset ligger{" "}
                    {Math.abs(p.avvikelseMotVardering).toLocaleString("sv-SE", {
                      maximumFractionDigits: 1,
                    })}{" "}
                    % {p.avvikelseMotVardering > 0 ? "över" : "under"} (jämfört per m²)
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="py-4 first:pt-0 last:pb-0">
            <p className="text-sm font-medium text-foreground">Försäljningar i föreningen</p>
            {forsaljningar.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Inga kända försäljningar i föreningen.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {forsaljningar.map((f) => (
                  <li
                    key={f.datum}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <span className="text-muted-foreground">
                      {f.datum} ·{" "}
                      {f.boarea.toLocaleString("sv-SE", {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })}{" "}
                      m²
                    </span>
                    <span className="font-display text-foreground">
                      {formatFigureVarde(f.pris)} ({formatFigureVarde(f.prisPerM2)})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <p className="mt-6 rounded-xl bg-secondary p-4 text-sm text-foreground">{p.slutsats}</p>

        {p.konfidens.niva === "lag" && p.konfidens.skal && p.konfidens.skal.length > 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Låg tillförlitlighet: {p.konfidens.skal.join(" ")}
          </p>
        ) : null}
      </Card>
    </section>
  );
}

function Rantestress() {
  const r = sampleAnalysis.rantestress;
  const [delta, setDelta] = useState<0 | 1 | 2 | 3>(1);
  const scenario: RantestressScenario | undefined = r.scenarier.find((s) => s.okningPe === delta);

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
          <span className="font-display text-2xl text-primary">+{delta} p.e.</span>
        </div>
        <input
          id="stress"
          type="range"
          min={0}
          max={3}
          step={1}
          value={delta}
          onChange={(e) => setDelta(Number(e.target.value) as 0 | 1 | 2 | 3)}
          className="mt-4 w-full accent-primary"
        />
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Dagens avgift</p>
            <p className="mt-2 font-display text-3xl text-foreground">
              {formatFigureVarde(r.nuvarandeManadsavgift)}
            </p>
            <p className="text-xs text-muted-foreground">per månad</p>
          </div>
          <div className="rounded-xl border border-primary/30 bg-primary/[0.05] p-5">
            <p className="text-xs uppercase tracking-wide text-primary">Stressad avgift</p>
            <p className="mt-2 font-display text-3xl text-foreground">
              {scenario ? formatFigureVarde(scenario.nyManadsavgift) : "Uppgift saknas"}
            </p>
            <p className="text-xs text-muted-foreground">
              per månad · +
              {scenario ? formatFigureVarde(scenario.avgiftsokningKrPerManad) : "okänt"}
            </p>
          </div>
        </div>
        <p className="mt-5 text-sm text-muted-foreground">{r.kommentar}</p>
      </Card>
    </section>
  );
}

/** Analysens säkerhet — hur många av de osäkra uppgifterna som är kända. */
function Sakerhetsmatare() {
  const d = sampleAnalysis.datakvalitet;
  const andel = d.uppgifterTotalt > 0 ? d.uppgifterKanda / d.uppgifterTotalt : 1;

  return (
    <Link
      to="/analysera"
      hash="vet-ej"
      className="mb-6 block rounded-lg border border-border bg-card/60 px-5 py-4 transition-colors hover:bg-secondary"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm text-muted-foreground">
          Analysens säkerhet: {d.uppgifterKanda} av {d.uppgifterTotalt} uppgifter kända
        </span>
        <span className="text-xs text-muted-foreground/80">
          {d.saknadeFalt.length > 0
            ? "Klicka för att fylla i det som saknas"
            : "Alla uppgifter ifyllda"}
        </span>
      </div>
      <div className="mt-3 h-1 w-full rounded-full bg-secondary">
        <div
          className="h-1 rounded-full bg-primary transition-[width]"
          style={{ width: `${Math.round(andel * 100)}%` }}
        />
      </div>
    </Link>
  );
}

function Fragor() {
  const [checked, setChecked] = useState<string[]>([]);
  const toggle = (k: string) =>
    setChecked((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));

  // Frågor härledda ur analysen respektive auto-genererade av fält på "okänt".
  const analysFragor = sampleAnalysis.fragor.filter((f) => f.ursprung === "analys");
  const saknadeFragor = sampleAnalysis.fragor.filter((f) => f.ursprung === "saknad_uppgift");

  const rad = (f: Fraga, auto = false) => (
    <li key={f.id}>
      <label className="flex cursor-pointer items-start gap-3 rounded-xl p-3 hover:bg-secondary">
        <input
          type="checkbox"
          checked={checked.includes(f.id)}
          onChange={() => toggle(f.id)}
          className="mt-0.5 size-4 accent-[var(--primary)]"
        />
        <span
          className={`text-sm ${
            checked.includes(f.id)
              ? "text-muted-foreground line-through"
              : auto
                ? "text-muted-foreground"
                : "text-foreground"
          }`}
        >
          {f.fraga}
        </span>
      </label>
    </li>
  );

  return (
    <section>
      <SectionTitle hint="Ta med listan till visningen. Svaren avgör om riskbetyget bör justeras.">
        Frågor att ställa
      </SectionTitle>
      <Card>
        <ul className="space-y-3">{analysFragor.map((f) => rad(f))}</ul>

        {saknadeFragor.length > 0 ? (
          <div className="mt-8 rounded-lg border border-dashed border-border p-4">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-sm font-semibold text-foreground">Uppgifter som saknas</h3>
              <Tag>auto</Tag>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Genererade av fält som står på ”Vet ej”. Svaren gör analysen säkrare.
            </p>
            <ul className="mt-3 space-y-2">{saknadeFragor.map((f) => rad(f, true))}</ul>
          </div>
        ) : null}
      </Card>
    </section>
  );
}
