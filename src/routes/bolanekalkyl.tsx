import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Card, Field, PageHeader, Badge, Toggle, Tag } from "@/components/ui/binfo";
import {
  property,
  kalkylDefaults,
  amorteringsregler,
  ranteavdrag,
  avgiftPerProcentenhet,
  kr,
} from "@/data/mockData";
import type { AvgiftPostId } from "@/data/mockData";
import { useUppgifter, setUppgifter } from "@/lib/uppgifter";
import { schabloner } from "@/data/schabloner";
import type { SchablonId } from "@/data/schabloner";

export const Route = createFileRoute("/bolanekalkyl")({
  head: () => ({
    meta: [
      { title: "Bolånekalkyl med amorteringskrav — Binfo" },
      {
        name: "description",
        content:
          "Räkna ut din totala månadskostnad: ränta, ränteavdrag, amortering enligt 2026 års regler och avgift.",
      },
      { property: "og:title", content: "Bolånekalkyl med amorteringskrav — Binfo" },
      {
        property: "og:description",
        content: "Belåningsgrad, skuldkvot, ränteavdrag och total månadskostnad för objektet.",
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
  const [lantagare, setLantagare] = useState<"1" | "2">(
    String(kalkylDefaults.antalLantagare) as "1" | "2",
  );
  const [delta, setDelta] = useState(0);

  const r = useMemo(() => {
    const lan = num(lanebelopp);
    const kontant = num(kontantinsats);
    const brutto = num(inkomst);
    const bostadsvarde = lan + kontant;
    const belaningsgrad = bostadsvarde > 0 ? lan / bostadsvarde : 0;

    // Amorteringskravet från 1 april 2026: enbart belåningsgrad avgör.
    // Det skärpta kravet kopplat till skuldkvot är slopat. Max 2 %/år.
    let takt = 0;
    if (belaningsgrad > 0.7) takt = 0.02;
    else if (belaningsgrad > 0.5) takt = 0.01;

    const skuldkvot = brutto > 0 ? lan / brutto : 0;

    // Bolånetaket är 90 % → kontantinsatsen måste vara minst 10 %.
    const minKontant = bostadsvarde * amorteringsregler.minKontantinsatsAndel;
    const kontantFel =
      bostadsvarde > 0 && kontant < minKontant - 0.5
        ? `Kontantinsatsen måste vara minst 10 % av bostadens värde (${kr(minKontant)}).`
        : null;

    const effektivRanta = num(ranta) + delta;
    const rantekostnad = (lan * (effektivRanta / 100)) / 12;
    const amortering = (lan * takt) / 12;
    const avgift = property.manadsavgift + avgiftPerProcentenhet * delta;

    // Ränteavdrag: 30 % upp till 100 000 kr per person och år, 21 % däröver.
    const arsranta = rantekostnad * 12;
    const tak = ranteavdrag.takPerPerson * Number(lantagare);
    const avdragAr =
      Math.min(arsranta, tak) * ranteavdrag.lagreSats +
      Math.max(0, arsranta - tak) * ranteavdrag.hogreSats;
    const avdrag = avdragAr / 12;
    const brutto_total = rantekostnad + amortering + avgift;

    return {
      lan,
      bostadsvarde,
      belaningsgrad,
      takt,
      skuldkvot,
      kontantFel,
      effektivRanta,
      rantekostnad,
      amortering,
      avgift,
      avdrag,
      total: brutto_total,
      netto: brutto_total - avdrag,
    };
  }, [lanebelopp, ranta, kontantinsats, inkomst, lantagare, delta]);

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
            <Field
              label="Kontantinsats"
              suffix="kr"
              value={kontantinsats}
              onChange={setKontantinsats}
              error={r.kontantFel}
              hint="Bolånetaket är 90 % — minst 10 % kontantinsats krävs."
            />
            <Field label="Ränta" suffix="%" value={ranta} onChange={setRanta} />
            <Field
              label="Hushållets bruttoinkomst per år"
              suffix="kr"
              value={inkomst}
              onChange={setInkomst}
            />
            <div>
              <span className="mb-1.5 block text-sm font-medium text-foreground">
                Antal låntagare
              </span>
              <Toggle
                value={lantagare}
                onChange={setLantagare}
                options={[
                  { value: "1", label: "1 låntagare" },
                  { value: "2", label: "2 låntagare" },
                ]}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Ränteavdragets tak på 100 000 kr gäller per person och år.
              </p>
            </div>
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
              Total månadskostnad efter ränteavdrag
            </p>
            <p className="mt-2 font-display text-5xl text-foreground">{kr(r.netto)}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Total månadskostnad (brutto): {kr(r.total)}
            </p>
            <div className="mt-6 divide-y divide-border">
              {[
                ["Räntekostnad (före ränteavdrag)", r.rantekostnad, false],
                ["Amortering", r.amortering, false],
                ["Månadsavgift", r.avgift, false],
                ["Ränteavdrag", r.avdrag, true],
              ].map(([label, value, negativ]) => (
                <div key={label as string} className="flex items-center justify-between py-3">
                  <span className="text-sm text-muted-foreground">{label as string}</span>
                  <span
                    className={`text-sm font-medium ${negativ ? "text-success" : "text-foreground"}`}
                  >
                    {negativ ? "− " : ""}
                    {kr(value as number)}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Ränteavdraget betalas ut via deklarationen, inte månadsvis. Din faktiska likviditet
              under året motsvarar därför bruttobeloppet — om du inte jämkar skatten.
            </p>
          </Card>

          <Card>
            <h2 className="text-base font-semibold text-foreground">Amorteringskravet</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Enligt reglerna som gäller från 1 april 2026.
            </p>
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
                    : "Under 50 % → inget krav"}
              </Badge>
              {r.skuldkvot > amorteringsregler.bankernasInternaTak ? (
                <Badge tone="neutral">
                  Över bankernas vanliga interna tak — kan påverka din kreditprövning.
                </Badge>
              ) : null}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Skuldkvoten påverkar inte längre lagkravet — det skärpta amorteringskravet är
              slopat. Bankerna använder den däremot i sin egen kreditprövning, där det interna
              taket vanligtvis ligger på 5–6 × bruttoinkomsten.
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              Bostadens värde beräknas som lånebelopp + kontantinsats ({kr(r.bostadsvarde)}).
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
