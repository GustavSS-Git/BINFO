import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Card, Field, PageHeader, Badge, Toggle, Tag } from "@/components/ui/binfo";
import { kr, amorteringsregler } from "@/data/mockData";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import { useUppgifter, setUppgifter } from "@/lib/uppgifter";
import { beraknaManadskostnad, type LaneUnderlag } from "@/lib/analysis/calc/manadskostnad";
import { rantestressScenario } from "@/lib/analysis/calc/rantestress";
import { costItemOsaker, FEE_KEY_BY_COST_ITEM } from "@/lib/analysisView";
import type { CostItemId, PropertyInput } from "@/types/analysis";

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

/** Kalkylens startvärden — 80 % belåning av det verkliga objektets
 *  utgångspris, så att förvalen känns rimliga ihop med resten av sidan.
 *  Ränta och bruttoinkomst har ingen motsvarighet i kontraktet (personliga
 *  antaganden om köparens egen lånesituation, inte föreningens), så de
 *  förblir generiska startgissningar precis som i mockdatan tidigare. */
const LANEBELOPP_DEFAULT = Math.round(sampleAnalysis.input.utgangspris * 0.8);
const KONTANTINSATS_DEFAULT = sampleAnalysis.input.utgangspris - LANEBELOPP_DEFAULT;
const RANTA_DEFAULT = 3.6;
const BRUTTOINKOMST_DEFAULT = 900_000;

/** De fem schablonbaserade kostnadsposterna som användaren kan skriva över
 *  inline. Ränta/amortering/ränteavdrag/avgift kommer alltid från
 *  beräkningen och är inte redigerbara här. */
const SCHABLON_POST_IDS: CostItemId[] = [
  "hushallsel",
  "varme",
  "vatten",
  "bredband",
  "hemforsakring",
];

function Bolanekalkyl() {
  const [lanebelopp, setLanebelopp] = useState(String(LANEBELOPP_DEFAULT));
  const [ranta, setRanta] = useState(String(RANTA_DEFAULT));
  const [kontantinsats, setKontantinsats] = useState(String(KONTANTINSATS_DEFAULT));
  const [inkomst, setInkomst] = useState(String(BRUTTOINKOMST_DEFAULT));
  const [lantagare, setLantagare] = useState<"1" | "2">(
    String(sampleAnalysis.input.antalLantagare) as "1" | "2",
  );
  const [delta, setDelta] = useState(0);
  const uppgifter = useUppgifter();
  // Egna värden som ersätter schablonerna när användaren redigerar en rad.
  const [egna, setEgna] = useState<Partial<Record<CostItemId, number>>>({});

  // Objektets grunddata kommer från den riktiga analysen. Det enda som
  // överlagras live är det som skärmens egna kontroller styr: vad avgiften
  // täcker (Tristate-fälten från /analysera), antal personer (vattenschablonen)
  // och antal låntagare (ränteavdragets tak).
  const input: PropertyInput = useMemo(
    () => ({
      ...sampleAnalysis.input,
      avgiftInkluderar: {
        varme: uppgifter.ingar.varme,
        vatten: uppgifter.ingar.vatten,
        el: uppgifter.ingar.el,
        bredband: uppgifter.ingar.bredband,
        tv: uppgifter.ingar.tv,
      },
      antalPersoner: uppgifter.antalPersoner,
      antalLantagare: Number(lantagare) as 1 | 2,
    }),
    [uppgifter, lantagare],
  );

  // Räntestressen har två ben: köparens egen lånränta (rakt påslag) och
  // föreningens avgift (via räntekänsligheten — det riktiga, sourcade
  // nyckeltalet, inte en gissad kronorsumma per procentenhet).
  const stressadAvgift = rantestressScenario(
    input.manadsavgift,
    sampleAnalysis.rantestress.rantekanslighetProcent,
    delta,
  ).nyManadsavgift;

  const liveInput: PropertyInput = useMemo(
    () => ({ ...input, manadsavgift: stressadAvgift }),
    [input, stressadAvgift],
  );

  const lan: LaneUnderlag = useMemo(
    () => ({
      lanebelopp: num(lanebelopp),
      kontantinsats: num(kontantinsats),
      ranta: num(ranta) + delta,
      bruttoinkomst: num(inkomst),
    }),
    [lanebelopp, kontantinsats, ranta, delta, inkomst],
  );

  const m = useMemo(() => beraknaManadskostnad(liveInput, lan), [liveInput, lan]);

  const bostadsvarde = lan.lanebelopp + lan.kontantinsats;
  const minKontant = bostadsvarde * amorteringsregler.minKontantinsatsAndel;
  const kontantFel =
    bostadsvarde > 0 && lan.kontantinsats < minKontant - 0.5
      ? `Kontantinsatsen måste vara minst 10 % av bostadens värde (${kr(minKontant)}).`
      : null;

  const finnPost = (id: CostItemId) => {
    const post = m.poster.find((p) => p.id === id);
    if (!post) throw new Error(`Saknar kostnadspost: ${id}`);
    return post;
  };

  const rantekostnad = finnPost("rantekostnad").figure.value ?? 0;
  const amortering = finnPost("amortering").figure.value ?? 0;
  const avdragPerManad = -(finnPost("ranteavdrag").figure.value ?? 0);
  const manadsavgiftPost = finnPost("manadsavgift").figure.value ?? 0;

  const boendeSchablonPoster = SCHABLON_POST_IDS.map((id) => finnPost(id)).filter(
    (p) => !p.ingarIAvgift,
  );

  // Skriver användaren över en schablon flyttar sig totalen med precis
  // mellanskillnaden — och bara i de scenarier posten faktiskt räknas med i
  // (täcks den av avgiften påverkar överskrivningen ingenting; är det
  // okänt om den gör det påverkas bara det "sämsta fallet"-spannet).
  const overrideDelta = (id: CostItemId): { low: number; high: number } => {
    const override = egna[id];
    if (override === undefined) return { low: 0, high: 0 };
    const original = finnPost(id).figure.value ?? 0;
    const diff = override - original;
    const nyckel = FEE_KEY_BY_COST_ITEM[id];
    if (!nyckel) return { low: diff, high: diff }; // t.ex. hemförsäkring — alltid med
    const status = liveInput.avgiftInkluderar[nyckel];
    if (status === "ja") return { low: 0, high: 0 };
    if (status === "nej") return { low: diff, high: diff };
    return { low: 0, high: diff }; // okänt — lågt scenario antar att avgiften täcker det
  };

  const deltaSumma = SCHABLON_POST_IDS.reduce(
    (acc, id) => {
      const d = overrideDelta(id);
      return { low: acc.low + d.low, high: acc.high + d.high };
    },
    { low: 0, high: 0 },
  );

  const baseSpread = m.totalSpann ? m.totalSpann.high - m.totalSpann.low : 0;
  const extraSpread = deltaSumma.high - deltaSumma.low;
  const harSpann = baseSpread + extraSpread > 0;

  const bruttoLag = (m.totalBrutto.value ?? 0) + deltaSumma.low;
  const nettoLag = (m.totalNetto.value ?? 0) + deltaSumma.low;
  const bruttoHog = bruttoLag + baseSpread + extraSpread;
  const nettoHog = nettoLag + baseSpread + extraSpread;

  return (
    <div className="mx-auto max-w-5xl px-5 py-14">
      <PageHeader
        eyebrow="Bolånekalkyl"
        title="Vad kostar bostaden per månad?"
        lead={`Månadsavgiften hämtas automatiskt från ${sampleAnalysis.forening.namn}.`}
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
              error={kontantFel}
              hint="Bolånetaket är 90 % — minst 10 % kontantinsats krävs."
            />
            <Field label="Ränta" suffix="%" value={ranta} onChange={setRanta} />
            <Field
              label="Antal personer i hushållet"
              value={String(uppgifter.antalPersoner)}
              onChange={(v) => setUppgifter({ antalPersoner: Math.max(1, Number(v) || 1) })}
              hint="Styr schablonen för vattenkostnad."
            />
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
                Höjer både din ränta ({lan.ranta.toFixed(2).replace(".", ",")} %) och föreningens
                avgift.
              </p>
            </div>
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Lånekostnad
              </p>
              <div className="mt-3 divide-y divide-border">
                <Rad label="Räntekostnad" value={rantekostnad} />
                <Rad label="Amortering" value={amortering} />
                <Rad label="Ränteavdrag" value={avdragPerManad} negativ />
              </div>
            </div>

            <div className="mt-8">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Boendekostnad
              </p>
              <div className="mt-3 divide-y divide-border">
                <Rad label="Månadsavgift" note="från årsredovisningen" value={manadsavgiftPost} />
                {boendeSchablonPoster.map((p) => (
                  <SchablonRad
                    key={p.id}
                    label={p.label}
                    value={egna[p.id] ?? p.figure.value ?? 0}
                    egen={egna[p.id] !== undefined}
                    osaker={costItemOsaker(p.id, liveInput.avgiftInkluderar)}
                    onChange={(v) => setEgna((e) => ({ ...e, [p.id]: v }))}
                  />
                ))}
              </div>
            </div>

            <div className="mt-8 border-t border-border pt-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Total månadskostnad
              </p>
              {harSpann ? (
                <>
                  <p className="mt-2 font-display text-4xl text-foreground">
                    {Math.round(nettoLag).toLocaleString("sv-SE")} – {kr(nettoHog)}/mån
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Beroende på vad som ingår i avgiften.
                  </p>
                </>
              ) : (
                <p className="mt-2 font-display text-5xl text-foreground">{kr(nettoLag)}</p>
              )}
              <p className="mt-2 text-sm text-muted-foreground">
                Efter ränteavdrag. Brutto:{" "}
                {harSpann
                  ? `${Math.round(bruttoLag).toLocaleString("sv-SE")} – ${kr(bruttoHog)}`
                  : kr(bruttoLag)}
              </p>
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
                  {m.amortering.belaningsgrad.toFixed(1).replace(".", ",")} %
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Skuldkvot (lån / bruttoinkomst)</dt>
                <dd className="font-medium text-foreground">
                  {m.amortering.skuldkvot.toFixed(2).replace(".", ",")} ×
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Tillämpad amorteringstakt</dt>
                <dd className="font-medium text-foreground">
                  {m.amortering.tillampadAmorteringstakt} % per år
                </dd>
              </div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge
                tone={
                  m.amortering.belaningsgrad > 70
                    ? "danger"
                    : m.amortering.belaningsgrad > 50
                      ? "warning"
                      : "success"
                }
              >
                {m.amortering.belaningsgrad > 70
                  ? "Över 70 % → 2 %"
                  : m.amortering.belaningsgrad > 50
                    ? "50–70 % → 1 %"
                    : "Under 50 % → inget krav"}
              </Badge>
              {m.amortering.overBankernasTypiskaTak ? (
                <Badge tone="neutral">
                  Över bankernas vanliga interna tak — kan påverka din kreditprövning.
                </Badge>
              ) : null}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Skuldkvoten påverkar inte längre lagkravet — det skärpta amorteringskravet är slopat.
              Bankerna använder den däremot i sin egen kreditprövning, där det interna taket
              vanligtvis ligger på 5–6 × bruttoinkomsten.
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              Bostadens värde beräknas som lånebelopp + kontantinsats ({kr(bostadsvarde)}).
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Rad({
  label,
  value,
  note,
  negativ,
}: {
  label: string;
  value: number;
  note?: string;
  negativ?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <span className="text-sm text-muted-foreground">
        {label}
        {note ? <span className="ml-2 text-xs text-muted-foreground/80">({note})</span> : null}
      </span>
      <span className={`text-sm font-medium ${negativ ? "text-success" : "text-foreground"}`}>
        {negativ ? "− " : ""}
        {kr(value)}
      </span>
    </div>
  );
}

/** Schablonrad — visuellt tydligt åtskild från kända belopp, och redigerbar. */
function SchablonRad({
  label,
  value,
  egen,
  osaker,
  onChange,
}: {
  label: string;
  value: number;
  egen: boolean;
  osaker: boolean;
  onChange: (v: number) => void;
}) {
  const [redigerar, setRedigerar] = useState(false);
  const [utkast, setUtkast] = useState(String(Math.round(value)));

  const spara = () => {
    const n = Number(utkast.replace(/\s/g, ""));
    if (!Number.isNaN(n) && n >= 0) onChange(n);
    setRedigerar(false);
  };

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 py-3 pl-3 ${
        egen ? "border-l-2 border-border" : "border-l-2 border-dashed border-muted-foreground/40"
      }`}
    >
      <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {label}
        <Tag>{egen ? "ditt värde" : "schablon"}</Tag>
        {osaker ? (
          <span className="text-xs text-muted-foreground/80">okänt om det ingår i avgiften</span>
        ) : null}
      </span>
      {redigerar ? (
        <span className="flex items-center gap-2">
          <input
            autoFocus
            value={utkast}
            onChange={(e) => setUtkast(e.target.value)}
            onBlur={spara}
            onKeyDown={(e) => e.key === "Enter" && spara()}
            className="w-24 rounded-lg border border-input bg-background px-2 py-1 text-right text-sm text-foreground outline-none focus:border-primary"
          />
          <span className="text-sm text-muted-foreground">kr</span>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => {
            setUtkast(String(Math.round(value)));
            setRedigerar(true);
          }}
          className={`text-sm ${
            egen
              ? "font-medium text-foreground"
              : "font-normal text-muted-foreground underline decoration-dashed underline-offset-4"
          }`}
        >
          {kr(value)}
        </button>
      )}
    </div>
  );
}
