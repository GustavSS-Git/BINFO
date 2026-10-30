import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Callout,
  Card,
  ChipGroup,
  DataTable,
  Details,
  Field,
  PageHeader,
  Tag,
} from "@/components/ui/binfo";
import { avgiftPoster, kr, kalkylDefaults } from "@/data/mockData";
import { KalkylExport } from "@/components/kalkyl/KalkylExport";
import { KortRubrik, Rad, Remsa, SchablonRad } from "@/components/kalkyl/KalkylDelar";
import { VET_EJ, procentText } from "@/components/kalkyl/kalkylText";
import { ReglerTabell } from "@/components/kalkyl/ReglerTabell";
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
import { tal } from "@/lib/kalkyl/regler";
import { BOAREA_HINT, PERSONER_HINT } from "@/lib/analysis/calc/schabloner";
import {
  BARN_ALDRAR,
  andraAvgift,
  andraFalt,
  sidaFranSokning,
  kalpArAndrad,
  sidaFranUnderlag,
  underlagFranSida,
  type KalkylSida,
} from "@/lib/kalkyl/sida";
import type { AvgiftPostId, EgenKostnadId, KalkylUnderlag } from "@/lib/kalkyl/underlag";
import { cn } from "@/lib/utils";

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

const BARN_ETIKETT: Record<(typeof BARN_ALDRAR)[number], string> = {
  "0-3": "Barn 0–3 år",
  "4-6": "Barn 4–6 år",
  "7-10": "Barn 7–10 år",
  "11-14": "Barn 11–14 år",
  "15-17": "Barn 15–17 år",
};

/** Chipparna för vad som ingår i avgiften, med de namn köparen känner igen. */
const CHIP_ETIKETT: Record<AvgiftPostId, string> = {
  varme: "Värme",
  vatten: "Vatten",
  el: "Hushållsel",
  bredband: "Bredband",
  tv: "Tv",
};

/** Andel utan onödiga decimaler: 10 → "10 %", 12,5 → "12,5 %". */
const andelText = (n: number) => `${procentText(n).replace(/,0$/, "")} %`;

const lank = "font-semibold text-link underline underline-offset-2";

/** Vad `?sparad=<id>` gav: en läsbar kalkyl, eller en förklaring till varför inte. */
type Oppnad =
  | { typ: "ok"; kalkyl: SparadKalkyl; underlag: KalkylUnderlag }
  | { typ: "okantFormat"; kalkyl: SparadKalkyl }
  | { typ: "fel"; meddelande: string };

const AVGIFT_IDS = avgiftPoster.map((p) => p.id);

function Sidhuvud() {
  return (
    <PageHeader
      eyebrow="Bolånekalkyl"
      title="Vad kostar bostaden per månad?"
      lead="Med 2026 års amorteringsregler, ränteavdrag och skatt i Stockholm."
    />
  );
}

const Sidram = ({ children }: { children: React.ReactNode }) => (
  <div className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-8 md:py-16">{children}</div>
);

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
      <Sidram>
        <Sidhuvud />
        <p className="text-muted-foreground" role="status">
          Hämtar den sparade kalkylen…
        </p>
      </Sidram>
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

/** "Pris, avgift och boarea" av det rapporten faktiskt fyllde i. */
function rapportUppgifter(sida: KalkylSida): string[] {
  const ut: string[] = [];
  if (sida.franRapport.pris) ut.push("pris");
  if (sida.franRapport.manadsavgift) ut.push("avgift");
  if (sida.franRapport.boarea) ut.push("boarea");
  if (Object.keys(sida.franRapport.avgift ?? {}).length > 0) ut.push("vad som ingår i avgiften");
  if (sida.rantekanslighetProcent !== undefined) ut.push("föreningens räntekänslighet");
  return ut;
}

const listaText = (delar: string[]) =>
  delar.length <= 1
    ? (delar[0] ?? "")
    : `${delar.slice(0, -1).join(", ")} och ${delar[delar.length - 1]}`;

const KORT_LAGE =
  "has-checked:border-primary has-checked:bg-tint has-checked:font-semibold has-checked:text-primary";

function Kalkyl({ search, oppnad }: { search: BolanekalkylSearch; oppnad: Oppnad | undefined }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const uppgifter = useUppgifter();
  // Spara-knappen beror på inloggningsläget, som servern inte känner till vid första
  // renderingen: visa den först efter mount så att hydreringen stämmer.
  const [monterad, setMonterad] = useState(false);
  useEffect(() => setMonterad(true), []);

  // Sidans fält som text. Förifylld vid länk från en färdig analys
  // (?pris=…&manadsavgift=…&boarea=…&ingar=…&ingarEj=…): priset fyller prisfältet,
  // kontantinsatsen förifylls med minsta tillåtna (10 %), och förifyllda värden märks
  // "Från rapporten" (märket försvinner när fältet ändras). Läses bara vid mount. Avgiftsposterna (vad som ingår) delas med övriga
  // sidor via uppgifter-butiken och läggs på vid varje beräkning.
  const [sida, setSida] = useState<KalkylSida>(() =>
    oppnad?.typ === "ok" ? sidaFranUnderlag(oppnad.underlag) : sidaFranSokning(search),
  );
  // Remsan "Ifyllt från rapporten" avgörs en gång vid mount (märkena försvinner vid redigering).
  const [rapportRemsa] = useState(() => (oppnad?.typ === "ok" ? [] : rapportUppgifter(sida)));
  const [analysId] = useState(() => sida.kalla?.analysisId);
  // Namn på kalkylen och id på den sparade raden som Spara uppdaterar (om någon).
  const [etikett, setEtikett] = useState(
    oppnad?.typ === "ok" || oppnad?.typ === "okantFormat" ? (oppnad.kalkyl.etikett ?? "") : "",
  );
  const [sparadId, setSparadId] = useState<string | undefined>(
    oppnad?.typ === "ok" ? oppnad.kalkyl.id : undefined,
  );
  const [prisUppskattningFranAnalys] = useState(search.prisUppskattning === true);

  const sat = <K extends keyof KalkylSida>(nyckel: K, varde: KalkylSida[K]) =>
    setSida((s) => andraFalt(s, nyckel, varde));
  const franRapport = sida.franRapport;

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
    // Länk från en rapport: det rapporten säger ingår/inte ingår läggs i den delade butiken.
    for (const id of AVGIFT_IDS) {
      if (sida.franRapport.avgift?.[id] === true) setIngar(id, sida.avgiftInkluderar[id]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Fyller i hela sidan från ett underlag (öppnad kalkyl eller återställt utkast). */
  const sattAllaFalt = (u: KalkylUnderlag) => {
    setSida(sidaFranUnderlag(u));
    for (const id of AVGIFT_IDS) setIngar(id, u.avgiftInkluderar[id]);
  };

  // Vad som ingår i avgiften: poster som rapporten angav (märkta "Från rapporten") gäller
  // direkt; övriga kommer från den delade butiken. Att slå om en chip rensar märket.
  const ingar = useMemo(() => {
    const ut = { ...uppgifter.ingar };
    for (const id of AVGIFT_IDS) {
      if (sida.franRapport.avgift?.[id] === true) ut[id] = sida.avgiftInkluderar[id];
    }
    return ut;
  }, [uppgifter.ingar, sida.franRapport.avgift, sida.avgiftInkluderar]);

  const { underlag, fel } = useMemo(
    () => underlagFranSida({ ...sida, avgiftInkluderar: ingar }),
    [sida, ingar],
  );
  const r = useMemo(() => beraknaKalkyl(underlag), [underlag]);
  // KALP-delen är stängd som standard, men öppen så snart någon uppgift avviker från förvalet
  // (skrivs in, eller kommer med en öppnad/återställd kalkyl), så att ingens siffror göms.
  const kalpAndrad = kalpArAndrad(underlag);
  const { fyllt } = r;
  const harRantekanslighet = underlag.rantekanslighetProcent !== undefined;
  const harTotal = fyllt.total;
  const harInkomst = fyllt.inkomst;
  const lantagare = sida.antalLantagare;
  const nu = r.nu;
  const summor = nu.summor;
  const stressad = sida.rantestressPp > 0;
  const rsText = `+${procentText(sida.rantestressPp)} p.e.`;

  const insatsAndel =
    underlag.pris !== undefined && underlag.pris > 0 && underlag.kontantinsats !== undefined
      ? (underlag.kontantinsats / underlag.pris) * 100
      : null;
  const minInsatsProcent = 100 - tal("bolanetak");

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

  const minus = harTotal && harInkomst && nu.kvarEfterBoende < 0;
  const avgiftsokningPerPe = r.scenarier.find((s) => s.id === "plus1")?.avgiftsokning;
  const rantekanslighetText =
    harRantekanslighet && underlag.rantekanslighetProcent !== undefined
      ? avgiftsokningPerPe !== undefined && fyllt.avgift
        ? `Avgiften stiger ${kr(avgiftsokningPerPe)}/mån per procentenhet enligt rapporten.`
        : `Avgiften stiger ${procentText(underlag.rantekanslighetProcent)} % per procentenhet enligt rapporten.`
      : "Vi vet inte hur känslig föreningens avgift är, så bara din egen ränta räknas om.";

  return (
    <Sidram>
      <Sidhuvud />

      {rapportRemsa.length > 0 ? (
        <Remsa
          lank={
            analysId !== undefined ? (
              <Link to="/analys/$analysisId" params={{ analysisId: analysId }} className={lank}>
                Till rapporten
              </Link>
            ) : undefined
          }
        >
          <strong className="text-primary">Ifyllt från rapporten.</strong>{" "}
          {`${listaText(rapportRemsa).replace(/^./, (c) => c.toUpperCase())}.`}
        </Remsa>
      ) : null}
      {oppnad?.typ === "ok" ? (
        <Remsa>
          <strong className="text-primary">Öppnad från ditt konto:</strong>{" "}
          {oppnad.kalkyl.etikett ?? formatSkapadDatum(oppnad.kalkyl.uppdaterad)}. Spara uppdaterar
          den här kalkylen; du kan också spara den som en ny.
        </Remsa>
      ) : null}
      {oppnad?.typ === "okantFormat" ? (
        <div className="mb-6">
          <Callout variant="flag" title="Kalkylen kan inte öppnas">
            <p>
              Den sparade kalkylen har ett format som inte längre stöds, så uppgifterna kan inte
              fyllas i. Du kan fortfarande räkna på en ny kalkyl här.{" "}
              <Link to="/konto" className={lank}>
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
              <Link to="/konto" className={lank}>
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
                className={lank}
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
        <div className="mb-6" role="status">
          <Callout variant="info" title="Sparar din kalkyl…">
            <p>Det tar en liten stund.</p>
          </Callout>
        </div>
      ) : null}
      {sparaStatus.typ === "sparad" ? (
        <div className="mb-6" role="status">
          <Callout variant="tip" title="Din kalkyl är sparad i ditt konto.">
            <p>
              <Link to="/konto" className={lank}>
                Se den i Mitt konto
              </Link>
            </p>
          </Callout>
        </div>
      ) : null}
      {sparaStatus.typ === "fel" ? (
        <div className="mb-6" role="alert">
          <Callout variant="flag" title="Kalkylen kunde inte sparas">
            <p>{sparaStatus.meddelande}</p>
          </Callout>
        </div>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <form
          noValidate
          onSubmit={(e) => e.preventDefault()}
          aria-label="Uppgifter till kalkylen"
          className="space-y-6"
        >
          <Card>
            <KortRubrik>Lånet</KortRubrik>
            <div className="grid gap-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  id="kalkyl-pris"
                  label="Pris du räknar med"
                  suffix="kr"
                  type="text"
                  inputMode="decimal"
                  value={sida.pris}
                  onChange={(v) => sat("pris", v)}
                  placeholder={exempel(kalkylDefaults.lanebelopp + kalkylDefaults.kontantinsats)}
                  error={fel.pris ?? null}
                  {...(franRapport.pris === true
                    ? {
                        badge: <Badge tone="teal">Från rapporten</Badge>,
                        hint: prisUppskattningFranAnalys
                          ? "Binfos uppskattning av priset enligt rapporten"
                          : "Binfos värdering enligt rapporten",
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
                  error={fel.kontantinsats ?? null}
                  hint={
                    insatsAndel !== null
                      ? `${andelText(insatsAndel)} av priset · minst ${minInsatsProcent} % krävs`
                      : `Minst ${minInsatsProcent} % av priset krävs`
                  }
                />
              </div>
              {r.lan.kontantinsatsFel !== null && fel.kontantinsats === undefined ? (
                <p
                  role="alert"
                  className="m-0 rounded-sm bg-danger-tint px-3.5 py-3 text-[15px] text-danger-text"
                >
                  {r.lan.kontantinsatsFel} Bolånetaket är {tal("bolanetak")} %.
                </p>
              ) : null}
              <div className="grid items-start gap-x-6 gap-y-3 sm:grid-cols-[minmax(0,200px)_1fr]">
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
                <p className="m-0 text-[15px] text-text-2 sm:pt-8" data-slot="kalkyl-lan">
                  {fyllt.belaning ? (
                    <>
                      Lån: <strong className="text-foreground">{kr(r.lan.lanebelopp)}</strong> ·
                      Belåningsgrad:{" "}
                      <strong className="text-foreground">
                        {procentText(r.lan.belaningsgradProcent)} %
                      </strong>{" "}
                      · amortering {r.lan.amorteringstaktProcent} % per år
                    </>
                  ) : (
                    "Fyll i pris och kontantinsats för att se lånet, belåningsgraden och amorteringen."
                  )}
                </p>
              </div>
              <div className="border-t border-divider pt-5">
                <div className="flex items-baseline justify-between gap-3">
                  <label htmlFor="kalkyl-rantestress" className="text-sm font-semibold">
                    Räntestress
                  </label>
                  <strong className="text-[15px] text-link" aria-hidden="true">
                    {rsText}
                  </strong>
                </div>
                <input
                  id="kalkyl-rantestress"
                  type="range"
                  min={0}
                  max={3}
                  step={0.1}
                  value={sida.rantestressPp}
                  aria-valuetext={`${rsText.replace("p.e.", "procentenheter")}`}
                  onChange={(e) => sat("rantestressPp", Number(e.target.value))}
                  className="mt-3 h-6 w-full accent-primary"
                />
                <div
                  aria-hidden="true"
                  className="mt-1 flex justify-between text-[13px] text-muted-foreground"
                >
                  <span>+0</span>
                  <span>+1</span>
                  <span>+2</span>
                  <span>+3 p.e.</span>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  {fyllt.ranta
                    ? `Höjer din ränta (${procentText(r.nu.rantaProcent - sida.rantestressPp, 2)} %)`
                    : "Höjer din ränta"}
                  {harRantekanslighet
                    ? " och föreningens avgift enligt rapportens räntekänslighet."
                    : ". Vi vet inte hur känslig den här föreningens avgift är för räntehöjningar, så bara din egen ränta räknas om."}
                </p>
              </div>
            </div>
          </Card>

          <Card>
            <KortRubrik>Bostaden</KortRubrik>
            <div className="grid gap-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  id="kalkyl-manadsavgift"
                  label="Månadsavgift"
                  suffix="kr/mån"
                  type="text"
                  inputMode="decimal"
                  value={sida.manadsavgift}
                  onChange={(v) => sat("manadsavgift", v)}
                  placeholder="t.ex. 3 240"
                  error={fel.manadsavgift ?? null}
                  {...(franRapport.manadsavgift === true
                    ? { badge: <Badge tone="teal">Från rapporten</Badge> }
                    : {})}
                />
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
                  hint={BOAREA_HINT}
                  {...(franRapport.boarea === true
                    ? { badge: <Badge tone="teal">Från rapporten</Badge> }
                    : {})}
                />
              </div>
              <Field
                id="kalkyl-antal-personer"
                label="Personer i hushållet"
                suffix="st"
                type="text"
                inputMode="numeric"
                value={sida.antalPersoner}
                onChange={(v) => sat("antalPersoner", v)}
                placeholder={String(underlag.antalPersoner)}
                error={fel.antalPersoner ?? null}
                hint={PERSONER_HINT}
              />
              <fieldset className="m-0 min-w-0 border-0 p-0">
                <legend className="mb-2.5 flex flex-wrap items-center gap-1.5 p-0 text-sm font-semibold text-foreground">
                  Ingår i avgiften
                  {Object.keys(franRapport.avgift ?? {}).length > 0 ? (
                    <Badge tone="teal">Från rapporten</Badge>
                  ) : null}
                </legend>
                <ChipGroup
                  options={avgiftPoster.map((p) => ({ value: p.id, label: CHIP_ETIKETT[p.id] }))}
                  values={AVGIFT_IDS.filter((id) => ingar[id] === "ja")}
                  onToggle={(v) => {
                    const id = v as AvgiftPostId;
                    const nytt = ingar[id] === "ja" ? "nej" : "ja";
                    setIngar(id, nytt);
                    setSida((s) => andraAvgift(s, id, nytt));
                  }}
                />
                <p className="mt-3 text-sm text-muted-foreground">
                  Klicka för att ändra. Det som inte ingår räknar vi med som en uppskattning i
                  månadskostnaden. Står i objektsbeskrivningen eller årsredovisningen.
                </p>
              </fieldset>
            </div>
          </Card>

          <Card>
            <KortRubrik>Hushållet</KortRubrik>
            <div className="grid gap-5">
              <fieldset className="m-0 min-w-0 border-0 p-0">
                <legend className="mb-2.5 p-0 text-sm font-semibold text-foreground">
                  Antal låntagare
                </legend>
                <div className="flex gap-2">
                  {(["1", "2"] as const).map((n) => (
                    <label
                      key={n}
                      className={cn(
                        "flex min-h-11 w-24 cursor-pointer items-center justify-center gap-2 rounded-sm border border-input bg-card px-2 text-[15px] font-medium text-text-2",
                        KORT_LAGE,
                      )}
                    >
                      <input
                        type="radio"
                        name="kalkyl-lantagare"
                        value={n}
                        checked={lantagare === n}
                        onChange={() => sat("antalLantagare", n)}
                        className="m-0 accent-primary"
                      />
                      {n}
                    </label>
                  ))}
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  Ränteavdragets tak på {tal("ranteavdrag_tak").toLocaleString("sv-SE")} kr gäller
                  per person och år.
                </p>
              </fieldset>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  id="kalkyl-inkomst1"
                  label="Bruttoinkomst, låntagare 1"
                  suffix="kr/år"
                  type="text"
                  inputMode="decimal"
                  value={sida.inkomst1}
                  onChange={(v) => sat("inkomst1", v)}
                  placeholder={exempel(
                    kalkylDefaults.bruttoinkomst / kalkylDefaults.antalLantagare,
                  )}
                  error={fel.inkomst1 ?? null}
                  hint="Lön före skatt, inklusive fasta tillägg"
                />
                {lantagare === "2" ? (
                  <Field
                    id="kalkyl-inkomst2"
                    label="Bruttoinkomst, låntagare 2"
                    suffix="kr/år"
                    type="text"
                    inputMode="decimal"
                    value={sida.inkomst2}
                    onChange={(v) => sat("inkomst2", v)}
                    placeholder={exempel(
                      kalkylDefaults.bruttoinkomst / kalkylDefaults.antalLantagare,
                    )}
                    error={fel.inkomst2 ?? null}
                    hint="Lön före skatt, inklusive fasta tillägg"
                  />
                ) : null}
              </div>
              <p className="m-0 text-sm text-muted-foreground">
                Nettoinkomsten räknas ut med 2026 års skatteregler för Stockholm.
              </p>
            </div>
          </Card>

          <Details
            summary="Klarar ni bankens kalkyl?"
            meta="kalkylränta, barn, levnadskostnader"
            defaultOpen={kalpAndrad}
          >
            <div data-slot="kalkyl-kalp" className="space-y-5">
              <p className="m-0">
                Banken räknar med en högre ränta och Konsumentverkets levnadskostnader för att se om
                lånet går ihop. Varje bank sätter sin egen kalkylränta; förvalt är{" "}
                {tal("kalkylranta_standard")} %.
              </p>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  id="kalkyl-kalkylranta"
                  label="Kalkylränta"
                  suffix="%"
                  type="text"
                  inputMode="decimal"
                  value={sida.kalkylranta}
                  onChange={(v) => sat("kalkylranta", v)}
                  error={fel.kalkylranta ?? null}
                  hint="Ett antagande, inte en regel"
                />
                <Field
                  id="kalkyl-antal-vuxna"
                  label="Vuxna i hushållet"
                  suffix="st"
                  type="text"
                  inputMode="numeric"
                  value={sida.antalVuxna}
                  onChange={(v) => sat("antalVuxna", v)}
                  placeholder={String(underlag.antalVuxna)}
                  error={fel.antalVuxna ?? null}
                  hint="Tomt = samma som antal låntagare"
                />
              </div>
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
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
              {r.kalp.beraknad && r.kalp.kvarAttLevaPa !== null ? (
                <>
                  <dl className="m-0 text-[15px]">
                    <Rad label="Hushållets nettoinkomst" varde={kr(r.kalp.nettoinkomstPerManad)} />
                    <Rad
                      label={`Boendet vid kalkylräntan ${procentText(r.kalp.kalkylrantaProcent)} %`}
                      note="Ränta, amortering, avgift och värme om den inte ingår"
                      varde={kr(r.kalp.boendeRader.reduce((a, rad) => a + rad.belopp, 0))}
                    />
                    <Rad
                      label="Levnadskostnader (Konsumentverket 2026)"
                      varde={kr(r.kalp.levnadskostnader?.summa ?? 0)}
                    />
                    <Rad
                      label={
                        r.kalp.utfall === "minus" ? "Underskott per månad" : "Överskott per månad"
                      }
                      varde={`${r.kalp.kvarAttLevaPa < 0 ? "−" : ""}${kr(Math.abs(r.kalp.kvarAttLevaPa))}`}
                      ton={r.kalp.utfall === "minus" ? "negativ" : "positiv"}
                    />
                  </dl>
                  <Details summary="Så räknas levnadskostnaderna">
                    <dl className="m-0">
                      {r.kalp.boendeRader.map((rad) => (
                        <Rad
                          key={rad.id}
                          label={rad.namn}
                          varde={kr(rad.belopp)}
                          {...(rad.anmarkning !== undefined ? { note: rad.anmarkning } : {})}
                        />
                      ))}
                      {r.kalp.levnadskostnader?.rader.map((rad) => (
                        <Rad
                          key={rad.id}
                          label={rad.namn}
                          note={rad.ingarIAvgift ? "ingår i avgiften" : undefined}
                          varde={`${rad.belopp < 0 ? "− " : ""}${kr(Math.abs(rad.belopp))}`}
                        />
                      ))}
                    </dl>
                  </Details>
                </>
              ) : r.kalp.hushalletForStort ? (
                <p className="m-0">
                  Konsumentverkets tabell gäller hushåll upp till 7 personer, så vi kan inte räkna
                  ut bankens kalkyl för ett större hushåll.
                </p>
              ) : (
                <p className="m-0">
                  Fyll i {r.kalp.saknas.join(", ")} för att räkna ut bankens kalkyl.
                </p>
              )}
              <ul className="m-0 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {r.kalp.forutsattningar.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          </Details>
        </form>

        <aside aria-label="Resultat" className="lg:sticky lg:top-6">
          <Card className="border-2 border-primary">
            <p className="m-0 text-sm font-semibold text-text-2">Total månadskostnad</p>
            <p
              data-slot="kalkyl-total"
              className={cn(
                "m-0 mt-1 font-display text-[44px] font-semibold leading-none",
                harTotal ? "text-primary" : "text-muted-foreground",
              )}
            >
              {harTotal ? kr(summor.netto) : VET_EJ}
            </p>
            <p className="mt-3 text-[15px] text-text-2">
              {!harTotal
                ? "Fyll i uppgifterna till vänster."
                : nu.amortering > 0
                  ? `varav amortering ${kr(nu.amortering)}, som är sparande. Utan den: ${kr(summor.netto - nu.amortering)}.`
                  : "Ingen amortering krävs vid den här belåningsgraden."}
            </p>
            {stressad ? (
              <p className="mt-2">
                <Tag tone="warning">Med räntestress {rsText}</Tag>
              </p>
            ) : null}

            <dl className="m-0 mt-5 border-t border-divider text-[15px]">
              <Rad
                label="Ränta"
                varde={fyllt.ranteunderlag ? kr(nu.rantekostnad) : VET_EJ}
                ton={fyllt.ranteunderlag ? "normal" : "dampad"}
                {...(stressad && fyllt.ranteunderlag
                  ? { note: `Räknat med ${procentText(nu.rantaProcent, 2)} % ränta` }
                  : {})}
              />
              <Rad
                label="Ränteavdrag"
                varde={fyllt.lan ? `− ${kr(nu.ranteavdragPerManad)}` : VET_EJ}
                ton={fyllt.lan ? "positiv" : "dampad"}
                note={
                  r.ranteavdrag.forutsatterSkatt
                    ? "Betalas ut i deklarationen. Förutsätter att ni betalar tillräckligt med skatt."
                    : "Betalas ut i deklarationen"
                }
              />
              <Rad
                label="Amortering"
                varde={fyllt.lan ? kr(nu.amortering) : VET_EJ}
                ton={fyllt.lan ? "normal" : "dampad"}
              />
              <Rad
                label="Månadsavgift"
                varde={fyllt.avgift ? kr(nu.manadsavgift) : VET_EJ}
                ton={fyllt.avgift ? "normal" : "dampad"}
                {...(stressad && nu.avgiftsokning > 0
                  ? { note: `Inklusive ${kr(nu.avgiftsokning)} på grund av räntestressen` }
                  : {})}
              />
              {r.drift.map((p) =>
                p.ingarIAvgift ? (
                  <Rad
                    key={p.id}
                    label={p.namn}
                    note="Ingår i avgiften"
                    varde={kr(0)}
                    ton="dampad"
                  />
                ) : (
                  <SchablonRad
                    key={p.id}
                    label={p.namn}
                    note={
                      p.schablonBasis === undefined
                        ? undefined
                        : p.schablonBasis.startsWith("Binfos uppskattning")
                          ? p.schablonBasis
                          : `Uppskattning, ${p.schablonBasis}`
                    }
                    value={p.belopp}
                    egen={p.egen}
                    onChange={(v) =>
                      sat("egnaKostnader", {
                        ...sida.egnaKostnader,
                        [p.id satisfies EgenKostnadId]: v,
                      })
                    }
                    onNollstall={() => {
                      const { [p.id]: _bort, ...resten } = sida.egnaKostnader;
                      sat("egnaKostnader", resten);
                    }}
                  />
                ),
              )}
              <Rad
                label="Det här betalar ni varje månad"
                note="Före ränteavdraget, som kommer tillbaka i deklarationen"
                varde={harTotal ? kr(nu.betalarPerManad) : VET_EJ}
                ton={harTotal ? "normal" : "dampad"}
              />
            </dl>
            {!fyllt.boarea ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Fyll i boarea för att räkna ut uppskattningarna.
              </p>
            ) : null}

            {harInkomst ? (
              <div className="mt-5 rounded-lg bg-background p-4">
                <dl className="m-0 text-[15px]">
                  <Rad
                    label="Hushållets nettoinkomst"
                    varde={`${kr(r.skatt.nettoinkomstPerManad)}/mån`}
                  />
                  <Rad
                    label="Andel av nettoinkomsten"
                    varde={harTotal ? `${procentText(nu.andelAvNettoProcent)} %` : VET_EJ}
                    ton={harTotal ? "normal" : "dampad"}
                  />
                  <Rad
                    label="Kvar att leva på per månad"
                    varde={
                      harTotal ? `${minus ? "−" : ""}${kr(Math.abs(nu.kvarEfterBoende))}` : VET_EJ
                    }
                    ton={!harTotal ? "dampad" : minus ? "negativ" : "normal"}
                  />
                  <Rad
                    label="Skuldkvot (lån / bruttoinkomst)"
                    varde={fyllt.lan ? `${procentText(r.lan.skuldkvot, 2)} ×` : VET_EJ}
                    ton={fyllt.lan ? "normal" : "dampad"}
                  />
                </dl>
                <p className="mt-3 text-[13px] text-muted-foreground">
                  Kvar att leva på är före mat och övriga levnadskostnader. Ränteavdraget,{" "}
                  {kr(r.ranteavdrag.perAr)} per år (motsvarar {kr(r.ranteavdrag.perManad)}/mån),
                  betalas ut i deklarationen året efter, vanligtvis mellan april och juni.
                </p>
                {r.ranteavdrag.forloratPerAr > 0 ? (
                  <p className="mt-2 text-[13px] text-muted-foreground">
                    {kr(r.ranteavdrag.forloratPerAr)} av ränteavdraget kan inte utnyttjas eftersom
                    skatten inte räcker till.
                    {lantagare === "2"
                      ? " Den som betalar räntan får avdraget. Betalar den med högre inkomst en större del av räntan kan ni få tillbaka mer."
                      : ""}
                  </p>
                ) : null}
                <p className="mt-2 text-[13px] text-muted-foreground">
                  Skuldkvoten styr inte amorteringskravet. Banker använder den i sin egen
                  kreditprövning, där det interna taket vanligtvis ligger på 5–6 × bruttoinkomsten.
                  {fyllt.lan && r.lan.overBankernasTypiskaTak
                    ? " Din skuldkvot ligger över det, vilket kan påverka kreditprövningen."
                    : ""}
                </p>
              </div>
            ) : (
              <p className="mt-5 text-sm text-text-2">
                Fyll i bruttoinkomst för att se nettoinkomst, andel av lönen och kvar att leva på.
              </p>
            )}
          </Card>
        </aside>
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-display text-[22px] font-semibold leading-tight text-primary">
            Om räntan stiger
          </h2>
          <p className="m-0 mb-4 text-[15px] text-text-2">
            Både din ränta och föreningens. {rantekanslighetText}
          </p>
          {fyllt.ranta ? (
            <DataTable minWidth={300}>
              <thead>
                <tr>
                  <th scope="col">Din ränta</th>
                  <th scope="col">Avgift</th>
                  <th scope="col" className="!text-right">
                    Totalt per månad
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.scenarier.map((s) => (
                  <tr key={s.id} className={s.id === "kalkylranta" ? "bg-background" : undefined}>
                    <th scope="row" className="text-[15px]">
                      {procentText(s.rantaProcent, 2)} %
                      <span className="mt-0.5 block text-[13px] font-normal text-muted-foreground">
                        {s.id === "kalkylranta" ? "Bankens kalkylränta" : s.namn}
                      </span>
                    </th>
                    <td className="text-[15px]">
                      {fyllt.avgift ? kr(s.manadsavgift) : VET_EJ}
                      {fyllt.avgift && s.avgiftsokning > 0 ? (
                        <span className="mt-0.5 block text-[13px] text-muted-foreground">
                          +{kr(s.avgiftsokning)}
                        </span>
                      ) : null}
                    </td>
                    <td className="text-right text-[15px] font-semibold">
                      {harTotal ? kr(s.summor.netto) : VET_EJ}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <p className="m-0 text-[15px] text-text-2">Fyll i ränta ovan för att se scenarierna.</p>
          )}
          <p className="mt-3 text-[13px] text-muted-foreground">
            Total månadskostnad efter ränteavdrag. Raden med bankens kalkylränta visar vad banken
            räknar med i sin prövning, inte vad du betalar idag.
          </p>
        </Card>

        <div data-slot="kalkyl-atgarder" className="space-y-5">
          <KalkylExport
            underlag={underlag}
            {...(etikettText !== "" ? { etikett: etikettText } : {})}
          />
          <Card>
            <div className="space-y-4">
              <Field
                id="kalkyl-namn"
                label="Namn på kalkylen"
                type="text"
                placeholder="Till exempel adressen"
                value={etikett}
                onChange={(v) => setEtikett(v.slice(0, MAX_ETIKETT_TECKEN))}
              />
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
          </Card>
        </div>
      </div>

      <div className="mt-10">
        <ReglerTabell />
      </div>
    </Sidram>
  );
}
