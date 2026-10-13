import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  Callout,
  Card,
  Field,
  PageHeader,
  Badge,
  Toggle,
  Tag,
  TristateChoice,
} from "@/components/ui/binfo";
import { avgiftPoster, kr, kalkylDefaults } from "@/data/mockData";
import { KalkylExport } from "@/components/kalkyl/KalkylExport";
import { FelRuta, InfoRuta } from "@/components/konto/AuthSida";
import { SparaKnapp } from "@/components/konto/SparaKnapp";
import {
  sparaKalkylAnrop,
  useAterstallKalkylUtkast,
  useSparaKalkyl,
  useSparadKalkyl,
} from "@/components/konto/useSparaKalkyl";
import { formatSkapadDatum } from "@/lib/analysisView";
import { MAX_ETIKETT_TECKEN, type SparadKalkyl } from "@/lib/kontoTyper";
import { SPARAT_KEY } from "@/lib/session";
import { inloggningsSok } from "@/lib/till";
import { useUppgifter, setUppgifter, setIngar } from "@/lib/uppgifter";
import { parseBolanekalkylSearch, type BolanekalkylSearch } from "@/lib/bolanekalkyl";
import { beraknaKalkyl } from "@/lib/kalkyl/berakna";
import { tolkaTal } from "@/lib/kalkyl/indata";
import { REGLER, STATUS_ETIKETT, tal, type Regel } from "@/lib/kalkyl/regler";
import {
  BARN_ALDRAR,
  sidaFranSokning,
  sidaFranUnderlag,
  underlagFranSida,
  type KalkylSida,
} from "@/lib/kalkyl/sida";
import type { EgenKostnadId, KalkylUnderlag } from "@/lib/kalkyl/underlag";

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
  // Fristående kalkyl — fungerar med noll sökparametrar. `manadsavgift` är
  // en bekvämlighet vid länk från en färdig analys;
  // `rantekanslighet` detsamma för räntestressen. Ett skräpvärde faller
  // tillbaka till "inget värde" istället för att krascha sidan.
  validateSearch: parseBolanekalkylSearch,
  component: Bolanekalkyl,
});

/** Grått exempel i ett tomt fält, i stället för ett ifyllt värde. Exemplen är
 *  samma siffror som tidigare låg i fälten (kalkylDefaults i
 *  src/data/mockData.ts) — köparen ser en rimlig storleksordning utan att en
 *  påhittad siffra räknas med i totalen. */
const exempel = (n: number) => `t.ex. ${n.toLocaleString("sv-SE")}`;

/** Utskriften för ett beräknat värde vars indata är tomma. */
const VET_EJ = "—";

const procentText = (n: number, decimaler = 1) => n.toFixed(decimaler).replace(".", ",");

const BARN_ETIKETT: Record<(typeof BARN_ALDRAR)[number], string> = {
  "0-3": "Barn 0–3 år",
  "4-6": "Barn 4–6 år",
  "7-10": "Barn 7–10 år",
  "11-14": "Barn 11–14 år",
  "15-17": "Barn 15–17 år",
};

const RUBRIK = "text-xs font-semibold uppercase tracking-wide text-muted-foreground";

/** Vad `?sparad=<id>` gav: en läsbar kalkyl, eller en förklaring till varför inte. */
type Oppnad =
  | { typ: "ok"; kalkyl: SparadKalkyl; underlag: KalkylUnderlag }
  | { typ: "okantFormat"; kalkyl: SparadKalkyl }
  | { typ: "fel"; meddelande: string };

const AVGIFT_IDS = avgiftPoster.map((p) => p.id);

function Bolanekalkyl() {
  const search: BolanekalkylSearch = Route.useSearch();
  const sparad = useSparadKalkyl(search.sparad);
  const navigateTillLogin = useNavigate();

  // Utloggad: logga in och kom tillbaka till samma sparade kalkyl.
  useEffect(() => {
    if (search.sparad !== undefined && sparad.ejInloggad) {
      void navigateTillLogin({
        to: "/konto/logga-in",
        search: inloggningsSok(
          `/bolanekalkyl?sparad=${encodeURIComponent(search.sparad)}`,
          undefined,
        ),
      });
    }
  }, [search.sparad, sparad.ejInloggad, navigateTillLogin]);

  if (search.sparad !== undefined && (sparad.laddar || sparad.ejInloggad)) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-14">
        <PageHeader
          eyebrow="Bolånekalkyl"
          title="Vad kostar bostaden per månad?"
          lead="Räkna ut din totala månadskostnad direkt i webbläsaren"
        />
        <p className="text-sm text-muted-foreground">Hämtar den sparade kalkylen…</p>
      </div>
    );
  }

  let oppnad: Oppnad | undefined;
  if (search.sparad !== undefined) {
    if (sparad.kalkyl !== null && sparad.underlag !== null) {
      oppnad = { typ: "ok", kalkyl: sparad.kalkyl, underlag: sparad.underlag };
    } else if (sparad.kalkyl !== null) {
      oppnad = { typ: "okantFormat", kalkyl: sparad.kalkyl };
    } else {
      oppnad = {
        typ: "fel",
        meddelande: sparad.hittadesInte
          ? "Kalkylen hittades inte. Den kan ha raderats."
          : (sparad.fel ?? "Kalkylen kunde inte hämtas."),
      };
    }
  }
  return <Kalkyl key={search.sparad ?? "ny"} search={search} oppnad={oppnad} />;
}

function Kalkyl({ search, oppnad }: { search: BolanekalkylSearch; oppnad: Oppnad | undefined }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const uppgifter = useUppgifter();
  // Spara-knappen beror på inloggningsläget, som servern inte känner till vid första
  // renderingen: visa den först efter mount så att hydreringen stämmer.
  const [monterad, setMonterad] = useState(false);
  useEffect(() => setMonterad(true), []);

  // Sidans fält som text. Förifylld vid länk från en färdig analys
  // (?pris=…&manadsavgift=…&boarea=…): kalkylen har inget eget pris-fält, så
  // priset delas upp i minsta kontantinsats (bolånetaket) och lån på resten.
  // Läses bara vid mount. Avgiftsposterna (vad som ingår) delas med övriga
  // sidor via uppgifter-butiken och läggs på vid varje beräkning.
  const [sida, setSida] = useState<KalkylSida>(() =>
    oppnad?.typ === "ok" ? sidaFranUnderlag(oppnad.underlag) : sidaFranSokning(search),
  );
  // Namn på kalkylen och id på den sparade raden som Spara uppdaterar (om någon).
  const [etikett, setEtikett] = useState(
    oppnad?.typ === "ok" || oppnad?.typ === "okantFormat" ? (oppnad.kalkyl.etikett ?? "") : "",
  );
  const [sparadId, setSparadId] = useState<string | undefined>(
    oppnad?.typ === "ok" ? oppnad.kalkyl.id : undefined,
  );
  const [manadsavgiftFranAnalys] = useState(search.manadsavgift !== undefined);
  const [prisFranAnalys] = useState(search.pris !== undefined);
  const [prisUppskattningFranAnalys] = useState(search.prisUppskattning === true);
  const [boareaFranAnalys] = useState(search.boarea !== undefined);

  const sat = <K extends keyof KalkylSida>(nyckel: K, varde: KalkylSida[K]) =>
    setSida((s) => ({ ...s, [nyckel]: varde }));

  // Boareans schabloner (el/värme/försäkring) kräver boarea. Den hämtas inte
  // längre från den delade butiken, vars förvalda 58 m² inte går att skilja
  // från ett ifyllt värde; ett tomt fält betyder "behöver fyllas i".
  useEffect(() => {
    if (search.boarea !== undefined) {
      setUppgifter({ boarea: search.boarea });
    }
    // En öppnad sparad kalkyl bär sina "vad ingår i avgiften"-svar med sig.
    if (oppnad?.typ === "ok") {
      for (const id of AVGIFT_IDS) setIngar(id, oppnad.underlag.avgiftInkluderar[id]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Fyller i hela sidan från ett underlag (öppnad kalkyl eller återställt utkast). */
  const sattAllaFalt = (u: KalkylUnderlag) => {
    setSida(sidaFranUnderlag(u));
    for (const id of AVGIFT_IDS) setIngar(id, u.avgiftInkluderar[id]);
  };

  const { underlag, fel } = useMemo(
    () => underlagFranSida({ ...sida, avgiftInkluderar: { ...uppgifter.ingar } }),
    [sida, uppgifter.ingar],
  );
  const r = useMemo(() => beraknaKalkyl(underlag), [underlag]);
  const { fyllt } = r;
  const harRantekanslighet = underlag.rantekanslighetProcent !== undefined;
  const harTotal = fyllt.total;
  const harInkomst = fyllt.inkomst;
  const lantagare = sida.antalLantagare;
  const nu = r.nu;
  const summor = nu.summor;
  const harSpann = summor.harSpann;

  const boendeSchablonPoster = r.drift.filter((p) => !p.ingarIAvgift);

  /** Sparar via servern och minns raden, så att nästa Spara uppdaterar den i stället för att
   *  skapa en dubblett. */
  const sparaAnrop: typeof sparaKalkylAnrop = async (indata) => {
    const svar = await sparaKalkylAnrop(indata);
    if (svar.ok) {
      setSparadId(svar.kalkyl.id);
      void qc.invalidateQueries({ queryKey: SPARAT_KEY });
      void qc.invalidateQueries({ queryKey: ["sparad-kalkyl"] });
    }
    return svar;
  };
  const etikettText = etikett.trim();
  const sparaStatus = useAterstallKalkylUtkast({
    spara: search.spara,
    aterstall: (u, e) => {
      sattAllaFalt(u);
      setEtikett(e);
      return sparaAnrop({ underlag: u, ...(e.trim() !== "" ? { etikett: e.trim() } : {}) });
    },
    rensaParam: () =>
      void navigate({
        to: "/bolanekalkyl",
        search: { ...search, spara: undefined },
        replace: true,
      }),
  });
  const sparaBas = {
    underlag,
    ...(etikettText !== "" ? { etikett: etikettText } : {}),
    anrop: sparaAnrop,
  };
  const sparaUppdatera = useSparaKalkyl({
    ...sparaBas,
    ...(sparadId !== undefined ? { id: sparadId } : {}),
  });
  const sparaNy = useSparaKalkyl(sparaBas);
  // Återställ knapparnas "Sparad"-läge när något ändras.
  const sparaNyckel = JSON.stringify([underlag, etikettText]);

  return (
    <div className="mx-auto max-w-5xl px-5 py-14">
      <PageHeader
        eyebrow="Bolånekalkyl"
        title="Vad kostar bostaden per månad?"
        lead="Räkna ut din totala månadskostnad direkt i webbläsaren"
      />

      {oppnad?.typ === "ok" ? (
        <div className="mb-6">
          <Callout variant="tip" title="Öppnad från ditt konto">
            <p>
              Öppnad från ditt konto:{" "}
              {oppnad.kalkyl.etikett ?? formatSkapadDatum(oppnad.kalkyl.uppdaterad)}. Spara
              uppdaterar den här kalkylen; du kan också spara den som en ny.
            </p>
          </Callout>
        </div>
      ) : null}
      {oppnad?.typ === "okantFormat" ? (
        <div className="mb-6">
          <Callout variant="flag" title="Kalkylen kan inte öppnas">
            <p>
              Den sparade kalkylen har ett format som inte längre stöds, så uppgifterna kan inte
              fyllas i. Du kan fortfarande räkna på en ny kalkyl här.{" "}
              <Link to="/konto" className="font-medium text-primary underline underline-offset-2">
                Till Mitt konto
              </Link>
            </p>
          </Callout>
        </div>
      ) : null}
      {oppnad?.typ === "fel" ? (
        <div className="mb-6">
          <Callout variant="flag" title="Kalkylen kan inte öppnas">
            <p>
              {oppnad.meddelande} Du kan fortfarande räkna på en ny kalkyl här.{" "}
              <Link to="/konto" className="font-medium text-primary underline underline-offset-2">
                Till Mitt konto
              </Link>
            </p>
          </Callout>
        </div>
      ) : null}
      {sparaStatus.typ === "kraver_inloggning" ? (
        <div className="mb-6">
          <Callout variant="tip" title="Logga in för att spara">
            <p>
              Du behöver vara inloggad för att slutföra sparandet.{" "}
              <Link
                to="/konto/logga-in"
                search={inloggningsSok("/bolanekalkyl", "kalkyl")}
                className="font-medium text-primary underline underline-offset-2"
              >
                Logga in
              </Link>
            </p>
          </Callout>
        </div>
      ) : null}
      {sparaStatus.typ === "saknas" ? (
        <div className="mb-6">
          <Callout variant="tip" title="Utkastet finns inte kvar">
            <p>
              Uppgifterna du fyllde i före inloggningen hittades inte (de sparas högst ett dygn, och
              bara i den här webbläsaren). Fyll i dem igen och tryck på Spara.
            </p>
          </Callout>
        </div>
      ) : null}
      {sparaStatus.typ === "sparar" ? (
        <div className="mb-6">
          <InfoRuta>
            <p>Sparar din kalkyl…</p>
          </InfoRuta>
        </div>
      ) : null}
      {sparaStatus.typ === "sparad" ? (
        <div className="mb-6">
          <InfoRuta>
            <p className="font-medium">Din kalkyl är sparad i ditt konto.</p>
            <p>
              <Link to="/konto" className="font-medium text-primary underline underline-offset-2">
                Se den i Mitt konto
              </Link>
            </p>
          </InfoRuta>
        </div>
      ) : null}
      {sparaStatus.typ === "fel" ? (
        <div className="mb-6">
          <FelRuta>Kalkylen kunde inte sparas: {sparaStatus.meddelande}</FelRuta>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card>
          <div className="grid gap-5">
            <Field
              id="kalkyl-lanebelopp"
              label="Lånebelopp"
              suffix="kr"
              type="text"
              inputMode="decimal"
              value={sida.lanebelopp}
              onChange={(v) => sat("lanebelopp", v)}
              placeholder={exempel(kalkylDefaults.lanebelopp)}
              error={fel.lanebelopp ?? null}
              {...(prisFranAnalys
                ? {
                    hint: prisUppskattningFranAnalys
                      ? "Förifyllt utifrån en uppskattning av priset i din analys, med minsta kontantinsats (10 %) — ändra om beloppet inte stämmer."
                      : "Förifyllt utifrån priset i din analys, med minsta kontantinsats (10 %) — ändra om beloppet inte stämmer.",
                  }
                : {})}
            />
            <Field
              id="kalkyl-kontantinsats"
              label="Kontantinsats"
              suffix="kr"
              type="text"
              inputMode="decimal"
              value={sida.kontantinsats}
              onChange={(v) => sat("kontantinsats", v)}
              placeholder={exempel(kalkylDefaults.kontantinsats)}
              error={fel.kontantinsats ?? r.lan.kontantinsatsFel}
              hint={`Bolånetaket är ${tal("bolanetak")} % — minst ${100 - tal("bolanetak")} % kontantinsats krävs.`}
            />
            <Field
              id="kalkyl-ranta"
              label="Ränta"
              suffix="%"
              type="text"
              inputMode="decimal"
              value={sida.ranta}
              onChange={(v) => sat("ranta", v)}
              placeholder={exempel(kalkylDefaults.ranta)}
              error={fel.ranta ?? null}
            />
            <Field
              id="kalkyl-manadsavgift"
              label="Månadsavgift"
              suffix="kr"
              type="text"
              inputMode="decimal"
              value={sida.manadsavgift}
              onChange={(v) => sat("manadsavgift", v)}
              placeholder="t.ex. 3 240"
              error={fel.manadsavgift ?? null}
              hint={
                manadsavgiftFranAnalys
                  ? "Förifylld från din analys — ändra om avgiften har uppdaterats."
                  : "Från föreningens senaste årsredovisning eller objektsbeskrivning."
              }
            />
            <details className="rounded-lg border border-border bg-secondary/40">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">
                Vad ingår i avgiften?
              </summary>
              <div className="border-t border-border px-4 pb-4 pt-3">
                <p className="mb-3 text-xs text-muted-foreground">
                  Vet du inte? Låt stå på ”Vet ej” — då visar vi totalen som ett spann.
                </p>
                <div className="space-y-3">
                  {avgiftPoster.map((post) => (
                    <div
                      key={post.id}
                      className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3 last:border-0 last:pb-0"
                    >
                      <span className="text-sm text-foreground">{post.label}</span>
                      <TristateChoice
                        value={uppgifter.ingar[post.id]}
                        onChange={(value) => setIngar(post.id, value)}
                        labels={{ ja: "Ingår", nej: "Ingår ej" }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </details>
            <Field
              id="kalkyl-boarea"
              label="Boarea"
              suffix="m²"
              type="text"
              inputMode="decimal"
              value={sida.boarea}
              onChange={(v) => sat("boarea", v)}
              placeholder="t.ex. 58"
              error={fel.boarea ?? null}
              hint="Styr schablonerna för el, värme och hemförsäkring. Utan boarea kan vi inte räkna ut totalen."
            />
            <Field
              id="kalkyl-antal-personer"
              label="Antal personer i hushållet"
              type="text"
              inputMode="numeric"
              value={sida.antalPersoner}
              onChange={(v) => sat("antalPersoner", v)}
              placeholder={String(underlag.antalPersoner)}
              error={fel.antalPersoner ?? null}
              hint="Styr schablonen för vattenkostnad. Lämna tomt för antal vuxna + barn."
            />
            <div>
              <span className="mb-1.5 block text-sm font-medium text-foreground">
                Antal låntagare
              </span>
              <Toggle
                value={lantagare}
                onChange={(v) => sat("antalLantagare", v)}
                options={[
                  { value: "1", label: "1 låntagare" },
                  { value: "2", label: "2 låntagare" },
                ]}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Ränteavdragets tak på {tal("ranteavdrag_tak").toLocaleString("sv-SE")} kr gäller per
                person och år.
              </p>
            </div>
            <Field
              id="kalkyl-inkomst1"
              label="Låntagare 1: bruttoinkomst per år"
              suffix="kr/år"
              type="text"
              inputMode="decimal"
              value={sida.inkomst1}
              onChange={(v) => sat("inkomst1", v)}
              placeholder={exempel(kalkylDefaults.bruttoinkomst / kalkylDefaults.antalLantagare)}
              error={fel.inkomst1 ?? null}
              hint="Lön före skatt per år, inklusive fasta tillägg."
            />
            {lantagare === "2" ? (
              <Field
                id="kalkyl-inkomst2"
                label="Låntagare 2: bruttoinkomst per år"
                suffix="kr/år"
                type="text"
                inputMode="decimal"
                value={sida.inkomst2}
                onChange={(v) => sat("inkomst2", v)}
                placeholder={exempel(kalkylDefaults.bruttoinkomst / kalkylDefaults.antalLantagare)}
                error={fel.inkomst2 ?? null}
                hint="Lön före skatt per år, inklusive fasta tillägg."
              />
            ) : null}
            <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-foreground">Hushållets nettoinkomst</span>
                <span className="text-sm font-medium text-foreground">
                  {harInkomst ? `${kr(r.skatt.nettoinkomstPerManad)}/mån` : VET_EJ}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Uträknad efter skatt i Stockholm 2026, utan ränteavdrag.
              </p>
            </div>
            <div>
              <div className="flex items-baseline justify-between">
                <label htmlFor="stress2" className="text-sm font-medium text-foreground">
                  Räntestress
                </label>
                <span className="text-sm text-primary">
                  +{sida.rantestressPp.toFixed(1).replace(".", ",")} p.e.
                </span>
              </div>
              <input
                id="stress2"
                type="range"
                min={0}
                max={3}
                step={0.1}
                value={sida.rantestressPp}
                onChange={(e) => sat("rantestressPp", Number(e.target.value))}
                className="mt-3 w-full accent-primary"
              />
              <p className="mt-2 text-xs text-muted-foreground">
                {fyllt.ranta
                  ? `Höjer din ränta (${procentText(nu.rantaProcent, 2)} %)`
                  : "Höjer din ränta"}
                {harRantekanslighet ? " och föreningens avgift." : "."}
              </p>
              {!harRantekanslighet ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Vi vet inte hur känslig den här föreningens avgift är för räntehöjningar — det
                  kräver en uppladdad årsredovisning för att räkna med i totalen.
                </p>
              ) : null}
            </div>

            <div className="border-t border-border pt-6">
              <p className={RUBRIK}>Bankens kalkyl (KALP)</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Banken räknar med en högre ränta och schablonmässiga levnadskostnader för hushållet.
              </p>
              <div className="mt-4 grid gap-5">
                <Field
                  id="kalkyl-antal-vuxna"
                  label="Antal vuxna i hushållet"
                  type="text"
                  inputMode="numeric"
                  value={sida.antalVuxna}
                  onChange={(v) => sat("antalVuxna", v)}
                  placeholder={String(underlag.antalVuxna)}
                  error={fel.antalVuxna ?? null}
                  hint="Lämna tomt för samma antal som låntagare."
                />
                <div className="grid grid-cols-2 gap-4">
                  {BARN_ALDRAR.map((alder) => (
                    <Field
                      key={alder}
                      id={`kalkyl-barn-${alder}`}
                      label={BARN_ETIKETT[alder]}
                      suffix="st"
                      type="text"
                      inputMode="numeric"
                      value={sida.barn[alder]}
                      onChange={(v) => sat("barn", { ...sida.barn, [alder]: v })}
                      placeholder="0"
                      error={fel[`barn:${alder}`] ?? null}
                    />
                  ))}
                </div>
                <Field
                  id="kalkyl-kalkylranta"
                  label="Kalkylränta"
                  suffix="%"
                  type="text"
                  inputMode="decimal"
                  value={sida.kalkylranta}
                  onChange={(v) => sat("kalkylranta", v)}
                  error={fel.kalkylranta ?? null}
                  hint="Ett antagande, inte en regel: varje bank sätter sin egen kalkylränta. Förvalt är 7 %."
                />
              </div>
            </div>
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <div>
              <p className={RUBRIK}>Lånekostnad</p>
              <div className="mt-3 divide-y divide-border">
                <Rad label="Räntekostnad" value={nu.rantekostnad} okant={!fyllt.ranteunderlag} />
                <Rad label="Amortering" value={nu.amortering} okant={!fyllt.lan} />
                <Rad
                  label="Ränteavdrag"
                  value={nu.ranteavdragPerManad}
                  negativ
                  okant={!fyllt.lan}
                  {...(r.ranteavdrag.forutsatterSkatt ? { note: "förutsätter skatt" } : {})}
                />
              </div>
            </div>

            <div className="mt-8">
              <p className={RUBRIK}>Boendekostnad</p>
              {boareaFranAnalys && fyllt.boarea ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Schablonerna nedan räknar med boarean från din analys ({sida.boarea} m²).
                </p>
              ) : null}
              <div className="mt-3 divide-y divide-border">
                <Rad
                  label="Månadsavgift"
                  value={nu.manadsavgift}
                  okant={!fyllt.avgift}
                  {...(manadsavgiftFranAnalys ? { note: "från din analys" } : {})}
                />
                {boendeSchablonPoster.map((p) => (
                  <SchablonRad
                    key={p.id}
                    label={p.namn}
                    value={p.belopp}
                    egen={p.egen}
                    osaker={p.osaker}
                    onChange={(v) =>
                      sat("egnaKostnader", {
                        ...sida.egnaKostnader,
                        [p.id satisfies EgenKostnadId]: v,
                      })
                    }
                  />
                ))}
              </div>
              {!fyllt.boarea ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Fyll i boarea till vänster för att räkna ut schablonerna.
                </p>
              ) : null}
            </div>

            <div className="mt-8 border-t border-border pt-6">
              <p className={RUBRIK}>Total månadskostnad</p>
              {harTotal ? (
                harSpann ? (
                  <>
                    <p className="mt-2 font-display text-4xl text-foreground">
                      {Math.round(summor.nettoLag).toLocaleString("sv-SE")} – {kr(summor.nettoHog)}
                      /mån
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Beroende på vad som ingår i avgiften.
                    </p>
                  </>
                ) : (
                  <p className="mt-2 font-display text-5xl text-foreground">
                    {kr(summor.nettoLag)}
                  </p>
                )
              ) : (
                <p className="mt-2 font-display text-5xl text-muted-foreground">{VET_EJ}</p>
              )}
              <p className="mt-1 text-sm text-muted-foreground">
                {harTotal
                  ? "i snitt över året, efter ränteavdrag"
                  : "Fyll i uppgifterna till vänster."}
              </p>
              {harTotal ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Brutto:{" "}
                  {harSpann
                    ? `${Math.round(summor.bruttoLag).toLocaleString("sv-SE")} – ${kr(summor.bruttoHog)}`
                    : kr(summor.bruttoLag)}
                </p>
              ) : null}
              {harTotal && r.ranteavdrag.not ? (
                <p className="mt-2 text-xs text-muted-foreground">{r.ranteavdrag.not}</p>
              ) : null}
            </div>

            <div className="mt-8 border-t border-border pt-6">
              <div className="divide-y divide-border">
                <Rad
                  label="Det här betalar ni varje månad"
                  value={nu.betalarPerManad}
                  okant={!harTotal}
                />
                <div className="flex items-center justify-between gap-3 py-3">
                  <span className="text-sm text-muted-foreground">Andel av nettoinkomsten</span>
                  <span className="text-sm font-medium text-foreground">
                    {harTotal && harInkomst ? `${procentText(nu.andelAvNettoProcent)} %` : VET_EJ}
                  </span>
                </div>
              </div>
              <div className="mt-4">
                <p className="text-sm text-muted-foreground">Kvar att leva på per månad</p>
                <p
                  className={`mt-1 font-display text-4xl ${
                    !harTotal || !harInkomst
                      ? "text-muted-foreground"
                      : nu.kvarEfterBoende < 0
                        ? "text-destructive"
                        : "text-foreground"
                  }`}
                >
                  {harTotal && harInkomst ? (
                    <>
                      {nu.kvarEfterBoende < 0 ? "−" : ""}
                      {kr(Math.abs(nu.kvarEfterBoende))}
                    </>
                  ) : (
                    VET_EJ
                  )}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Efter boendekostnaderna ovan, före mat och övriga levnadskostnader.
                </p>
              </div>
              <div className="mt-6 border-t border-border pt-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-muted-foreground">Tillbaka i deklarationen</span>
                  <span className="text-sm font-medium text-foreground">
                    {fyllt.lan ? `${kr(r.ranteavdrag.perAr)}/år` : VET_EJ}
                  </span>
                </div>
                {fyllt.lan ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    motsvarar {kr(r.ranteavdrag.perAr / 12)}/mån
                  </p>
                ) : null}
                {fyllt.lan && r.ranteavdrag.not ? (
                  <p className="mt-1 text-xs text-muted-foreground">{r.ranteavdrag.not}</p>
                ) : null}
                <p className="mt-2 text-xs text-muted-foreground">
                  Ränteavdraget betalas ut som skatteåterbäring året efter, vanligtvis mellan april
                  och juni. Vill ni ha det varje månad i stället kan ni ansöka om jämkning hos
                  Skatteverket.
                </p>
                {r.ranteavdrag.forloratPerAr > 0 ? (
                  <div className="mt-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
                    <p className="text-xs text-foreground">
                      {kr(r.ranteavdrag.forloratPerAr)} av ränteavdraget kan inte utnyttjas eftersom
                      skatten inte räcker till.
                    </p>
                    {lantagare === "2" ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Den som betalar räntan får avdraget. Betalar den med högre inkomst en större
                        del av räntan kan ni få tillbaka mer.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
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
                  {fyllt.lan ? `${procentText(r.lan.belaningsgradProcent)} %` : VET_EJ}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Skuldkvot (lån / bruttoinkomst)</dt>
                <dd className="font-medium text-foreground">
                  {fyllt.lan && harInkomst ? `${procentText(r.lan.skuldkvot, 2)} ×` : VET_EJ}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Tillämpad amorteringstakt</dt>
                <dd className="font-medium text-foreground">
                  {fyllt.lan ? `${r.lan.amorteringstaktProcent} % per år` : VET_EJ}
                </dd>
              </div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              {fyllt.lan ? (
                <>
                  <Badge
                    tone={
                      r.lan.amorteringsniva === "over70"
                        ? "danger"
                        : r.lan.amorteringsniva === "over50till70"
                          ? "warning"
                          : "success"
                    }
                  >
                    {r.lan.amorteringsniva === "over70"
                      ? `Över ${tal("amortering_troskel_hog")} % → ${tal("amortering_takt_hog")} %`
                      : r.lan.amorteringsniva === "over50till70"
                        ? `Över ${tal("amortering_troskel_lag")} % till ${tal("amortering_troskel_hog")} % → ${tal("amortering_takt_mellan")} %`
                        : `Högst ${tal("amortering_troskel_lag")} % → inget krav`}
                  </Badge>
                  {r.lan.overBankernasTypiskaTak && harInkomst ? (
                    <Badge tone="neutral">
                      Över bankernas vanliga interna tak — kan påverka din kreditprövning.
                    </Badge>
                  ) : null}
                </>
              ) : null}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Skuldkvoten påverkar inte längre lagkravet — det skärpta amorteringskravet är slopat.
              Bankerna använder den däremot i sin egen kreditprövning, där det interna taket
              vanligtvis ligger på 5–6 × bruttoinkomsten.
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              Bostadens värde beräknas som lånebelopp + kontantinsats
              {fyllt.lan ? ` (${kr(r.lan.bostadsvarde)}).` : "."}
            </p>
          </Card>

          <Card>
            <h2 className="text-base font-semibold text-foreground">Om räntan ändras</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Total månadskostnad efter ränteavdrag.
              {harRantekanslighet
                ? " Avgiften räknas upp med föreningens räntekänslighet."
                : " Bara din egen ränta stressas: avgiftens känslighet är okänd."}
            </p>
            {fyllt.ranta ? (
              <div className="mt-3 divide-y divide-border">
                {r.scenarier.map((s) => (
                  <div key={s.id} className="py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm text-muted-foreground">
                        {s.namn} ({procentText(s.rantaProcent)} %)
                      </span>
                      <span className="text-sm font-medium text-foreground">
                        {harTotal
                          ? s.summor.harSpann
                            ? `${Math.round(s.summor.nettoLag).toLocaleString("sv-SE")} – ${kr(s.summor.nettoHog)}`
                            : kr(s.summor.nettoLag)
                          : VET_EJ}
                      </span>
                    </div>
                    {harTotal ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Ränta {kr(s.rantekostnad)} · avgift {kr(s.manadsavgift)}
                        {s.avgiftsokning > 0 ? ` (+${kr(s.avgiftsokning)})` : ""}
                        {harInkomst ? ` · kvar efter boendet ${kr(s.kvarEfterBoende)}` : ""}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                Fyll i ränta till vänster för att se scenarierna.
              </p>
            )}
          </Card>

          <Card>
            <h2 className="text-base font-semibold text-foreground">
              Kvar att leva på enligt bankens kalkyl
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Nettoinkomst minus ränta vid kalkylräntan ({procentText(r.kalp.kalkylrantaProcent)}{" "}
              %), amortering, avgift, värme och Konsumentverkets levnadskostnader för hushållet.
            </p>
            {r.kalp.beraknad && r.kalp.kvarAttLevaPa !== null ? (
              <>
                <div className="mt-3 divide-y divide-border">
                  {r.kalp.boendeRader.map((rad) => (
                    <Rad
                      key={rad.id}
                      label={rad.namn}
                      value={rad.belopp}
                      {...(rad.anmarkning !== undefined ? { note: rad.anmarkning } : {})}
                    />
                  ))}
                  <Rad
                    label="Levnadskostnader (Konsumentverket 2026)"
                    value={r.kalp.levnadskostnader?.summa ?? 0}
                  />
                  <Rad label="Hushållets nettoinkomst" value={r.kalp.nettoinkomstPerManad} />
                </div>
                <div className="mt-4">
                  <p className="text-sm text-muted-foreground">
                    {r.kalp.utfall === "minus" ? "Underskott per månad" : "Överskott per månad"}
                  </p>
                  <p
                    className={`mt-1 font-display text-4xl ${
                      r.kalp.utfall === "minus" ? "text-destructive" : "text-foreground"
                    }`}
                  >
                    {r.kalp.kvarAttLevaPa < 0 ? "−" : ""}
                    {kr(Math.abs(r.kalp.kvarAttLevaPa))}
                  </p>
                </div>
                <details className="mt-4 rounded-lg border border-border bg-secondary/40">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">
                    Så räknas levnadskostnaderna
                  </summary>
                  <div className="border-t border-border px-4 pb-4 pt-3">
                    <div className="divide-y divide-border">
                      {r.kalp.levnadskostnader?.rader.map((rad) => (
                        <div
                          key={rad.id}
                          className="flex items-center justify-between gap-3 py-2 text-xs"
                        >
                          <span className="text-muted-foreground">
                            {rad.namn}
                            {rad.ingarIAvgift ? " (ingår i avgiften)" : ""}
                          </span>
                          <span className="font-medium text-foreground">
                            {rad.belopp < 0 ? "− " : ""}
                            {kr(Math.abs(rad.belopp))}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </details>
              </>
            ) : r.kalp.hushalletForStort ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Konsumentverkets tabell gäller hushåll upp till 7 personer, så vi kan inte räkna ut
                bankens kalkyl för ett större hushåll.
              </p>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                Fyll i {r.kalp.saknas.join(", ")} för att räkna ut bankens kalkyl.
              </p>
            )}
            <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {r.kalp.forutsattningar.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </Card>

          <Card>
            <details>
              <summary className="cursor-pointer text-sm font-medium text-foreground">
                Regler och antaganden som kalkylen använder
              </summary>
              <div className="mt-3 divide-y divide-border">
                {REGLER.filter((x) => !x.id.startsWith("kv_")).map((x) => (
                  <RegelRad key={x.id} regel={x} />
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Konsumentverkets alla tabellvärden finns i{" "}
                <a
                  className="underline"
                  href="https://publikationer.konsumentverket.se/downloads/kostnadsberakningar-hushallskostnader-2026-sv-kov_tga_32d.pdf"
                >
                  Hushållskostnader 2026
                </a>
                .
              </p>
            </details>
          </Card>

          <div data-slot="kalkyl-atgarder">
            <KalkylExport
              underlag={underlag}
              {...(etikettText !== "" ? { etikett: etikettText } : {})}
            />
            <div className="mt-6 space-y-4">
              <div className="max-w-sm">
                <Field
                  id="kalkyl-namn"
                  label="Namn på kalkylen"
                  optional
                  type="text"
                  placeholder="Till exempel adressen"
                  value={etikett}
                  onChange={(v) => setEtikett(v.slice(0, MAX_ETIKETT_TECKEN))}
                />
              </div>
              <div className="flex flex-wrap items-start gap-3">
                {monterad ? (
                  <SparaKnapp
                    key={`uppdatera-${sparaNyckel}`}
                    {...sparaUppdatera}
                    etikettKnapp={sparadId !== undefined ? "Spara ändringarna" : "Spara kalkylen"}
                    till="/bolanekalkyl"
                  />
                ) : null}
                {monterad && sparadId !== undefined ? (
                  <SparaKnapp
                    key={`ny-${sparaNyckel}`}
                    {...sparaNy}
                    etikettKnapp="Spara som ny kalkyl"
                    till="/bolanekalkyl"
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RegelRad({ regel }: { regel: Regel }) {
  return (
    <div className="py-3 text-xs">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-foreground">{regel.namn}</span>
        <span className="font-medium text-foreground">
          {typeof regel.varde === "number" ? regel.varde.toLocaleString("sv-SE") : regel.varde}
          {typeof regel.varde === "number" ? ` ${regel.enhet}` : ""}
        </span>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
        <Tag>{STATUS_ETIKETT[regel.status]}</Tag>
        {regel.kalla.url !== null ? (
          <a className="underline" href={regel.kalla.url}>
            {regel.kalla.titel}
          </a>
        ) : (
          <span>{regel.kalla.titel}</span>
        )}
        {regel.referens ? <span>{regel.referens}</span> : null}
        <span>
          gäller från {regel.gallerFran}
          {regel.verifierad !== null ? `, kontrollerad ${regel.verifierad}` : ", ej kontrollerad"}
        </span>
      </p>
      {regel.anmarkning ? <p className="mt-1 text-muted-foreground">{regel.anmarkning}</p> : null}
    </div>
  );
}

function Rad({
  label,
  value,
  note,
  negativ,
  okant,
}: {
  label: string;
  value: number;
  note?: string;
  negativ?: boolean;
  okant?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <span className="text-sm text-muted-foreground">
        {label}
        {note ? <span className="ml-2 text-xs text-muted-foreground/80">({note})</span> : null}
      </span>
      <span
        className={`text-sm font-medium ${
          okant ? "text-muted-foreground" : negativ ? "text-success" : "text-foreground"
        }`}
      >
        {okant ? VET_EJ : `${negativ ? "− " : ""}${kr(value)}`}
      </span>
    </div>
  );
}

/** Schablonrad — visuellt tydligt åtskild från kända belopp, och redigerbar.
 *  `value` är null när schablonen kräver boarea som inte är ifylld. */
function SchablonRad({
  label,
  value,
  egen,
  osaker,
  onChange,
}: {
  label: string;
  value: number | null;
  egen: boolean;
  osaker: boolean;
  onChange: (v: number) => void;
}) {
  const [redigerar, setRedigerar] = useState(false);
  const [utkast, setUtkast] = useState(String(Math.round(value ?? 0)));

  const spara = () => {
    const t = tolkaTal(utkast);
    if (t.art === "tal") onChange(t.varde);
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
      {value === null && !egen ? (
        <span className="text-sm text-muted-foreground">{VET_EJ}</span>
      ) : redigerar ? (
        <span className="flex items-center gap-2">
          <input
            autoFocus
            inputMode="decimal"
            aria-label={`${label}, kr per månad`}
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
            setUtkast(String(Math.round(value ?? 0)));
            setRedigerar(true);
          }}
          className={`text-sm ${
            egen
              ? "font-medium text-foreground"
              : "font-normal text-muted-foreground underline decoration-dashed underline-offset-4"
          }`}
        >
          {kr(value ?? 0)}
        </button>
      )}
    </div>
  );
}
