import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Callout,
  Card,
  Button,
  Badge,
  StatusLabel,
  SectionTitle,
  Tag,
} from "@/components/ui/binfo";
import { PropertySummary } from "@/components/PropertySummary";
import { visasIHuvudanalys } from "@/lib/analysis/benchmarks";
import {
  formatDrivareLabel,
  formatBudpremieText,
  formatDataperiod,
  andelAvSkuldRad,
  arSkannad,
  varderingsTackningText,
  formatFigureVarde,
  formatVarde,
  OMRADESINDELNING_ATTRIBUTION,
  SKANNAD_NOTIS,
  toppRodaFlaggor,
  type AndelAvSkuldRad,
  VARDERINGSDRIVARE_CAVEAT,
} from "@/lib/analysisView";
import { veljRantekanslighetForSok, type BolanekalkylSearch } from "@/lib/bolanekalkyl";
import type {
  AnalysisResult,
  FeeInclusion,
  Figure,
  Fraga,
  PrisanalysUtanForening,
  RantestressScenario,
  Severity,
  Tristate,
} from "@/types/analysis";

/**
 * Rent presentationslager för en färdig `AnalysisResult` — betygskort, de sju
 * nyckeltalen, prisrimlighet, räntestress och frågor att ställa. Ingen egen
 * datahämtning: tar analysen som prop så att både exempelsidan (`/exempel`,
 * som visar `sampleAnalysis`) och den riktiga rapporten
 * (`/analys/$analysisId`) delar exakt samma renderingskod och aldrig kan
 * glida isär.
 */
export function AnalysRapport({ analys }: { analys: AnalysisResult }) {
  const navigate = useNavigate();
  const [pdfStatus, setPdfStatus] = useState<"vilande" | "skapar" | "fel">("vilande");

  // Dynamically imported so @react-pdf/renderer (and the PDF document tree)
  // only ever loads when the user actually clicks the button — it must
  // never enter the page's main bundle or run during SSR (see
  // src/components/pdf/download.tsx).
  const handleDownloadPdf = async () => {
    // Build-time guard: in the SSR build `import.meta.env.SSR` is the literal
    // `true`, so the dynamic import below is dead code and @react-pdf never
    // enters the server bundle. Without it, PDFKit's top-level
    // `new URL(..., import.meta.url)` ended up in a server chunk shared with
    // pdf.js and crashed uploads on Cloudflare Workers ("Invalid URL string")
    // for PDFs whose fonts make pdf.js load that chunk.
    if (import.meta.env.SSR) return;
    setPdfStatus("skapar");
    try {
      const { downloadAnalysPdf } = await import("@/components/pdf/download");
      await downloadAnalysPdf(analys);
      setPdfStatus("vilande");
    } catch (error) {
      console.error("PDF-export misslyckades", error);
      setPdfStatus("fel");
    }
  };

  // Förifyllning av bolånekalkylen: hellre en extern värdering än
  // utgångspriset när den finns (se AnalysisResult.prisanalys), men en
  // uppskattning ('schablon') får aldrig se ut som ett fastställt pris —
  // det flaggas separat så kalkylsidan kan säga "uppskattning" istället för
  // att tyst presentera talet som ett känt pris (se CLAUDE.md).
  const prisFigure = analys.prisanalys.externVardering ?? analys.prisanalys.utgangspris;
  const bolanekalkylSearch: BolanekalkylSearch = {
    manadsavgift: analys.rantestress.nuvarandeManadsavgift.value ?? undefined,
    rantekanslighet: veljRantekanslighetForSok(analys.rantestress.rantekanslighetProcent),
    pris: prisFigure.value ?? undefined,
    boarea: analys.input.boarea,
    prisUppskattning:
      analys.prisanalys.externVardering !== undefined &&
      analys.prisanalys.externVardering.source === "schablon"
        ? true
        : undefined,
  };

  return (
    <>
      <PropertySummary
        input={analys.input}
        foreningNamn={analys.forening.namn}
        skapad={analys.skapad}
      />

      <Card className="mb-6 flex flex-wrap items-center gap-6">
        <div className="flex size-20 items-center justify-center rounded-full border-4 border-primary/20 bg-primary/5 font-display text-3xl text-primary">
          {analys.betyg}
        </div>
        <p className="max-w-xl flex-1 text-sm text-foreground">{analys.betygMotivering}</p>
      </Card>

      <RodaFlaggor analys={analys} />

      <Foreningsekonomi analys={analys} />
      <OvrigInfo analys={analys} />
      <Prisrimlighet prisanalys={analys.prisanalys} skuldrad={andelAvSkuldRad(analys)} />
      <Rantestress analys={analys} />
      <Fragor analys={analys} />

      <div className="mt-10 flex flex-wrap items-center gap-4">
        <Button
          variant="secondary"
          size="lg"
          onClick={handleDownloadPdf}
          disabled={pdfStatus === "skapar"}
        >
          {pdfStatus === "skapar" ? "Skapar PDF…" : "Ladda ner som PDF"}
        </Button>
        <Button
          size="lg"
          onClick={() => navigate({ to: "/bolanekalkyl", search: bolanekalkylSearch })}
        >
          Räkna på månadskostnaden
        </Button>
        {pdfStatus === "fel" ? (
          <p className="text-sm text-danger">
            Det gick inte att skapa PDF:en just nu. Försök igen om en liten stund.
          </p>
        ) : null}
      </div>
    </>
  );
}

function RodaFlaggor({ analys }: { analys: AnalysisResult }) {
  const flaggor = toppRodaFlaggor(analys.rodaFlaggor, 2);

  if (flaggor.length === 0) return null;

  return (
    <div className="mb-6 grid gap-5 md:grid-cols-2">
      {flaggor.map((flagga) => (
        <Card key={flagga.id}>
          <Badge tone={severityTone[flagga.severity]}>{severityLabel[flagga.severity]}</Badge>
          <h3 className="mt-4 text-base font-semibold text-foreground">{flagga.titel}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{flagga.beskrivning}</p>
        </Card>
      ))}
    </div>
  );
}

const severityTone: Record<Severity, "danger" | "warning"> = {
  hog: "danger",
  medel: "warning",
  lag: "warning",
};

const severityLabel: Record<Severity, string> = {
  hog: "Hög risk",
  medel: "Medelrisk",
  lag: "Låg risk",
};

function Foreningsekonomi({ analys }: { analys: AnalysisResult }) {
  const keyFigures = analys.forening.keyFigures.filter(
    (kf) => visasIHuvudanalys(kf.id) && kf.status !== "okant",
  );

  return (
    <section className="mb-10">
      <SectionTitle hint="Viktiga nyckeltal att ha koll på från föreningens årsredovisning">
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
              <StatusLabel status={kf.status} className="mb-3" />
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h3 className="flex items-center gap-3 text-base font-semibold text-foreground">
                  {kf.label}
                  {highlight ? <Badge tone="teal">Viktigast här</Badge> : null}
                </h3>
                <p className="font-display text-2xl text-foreground">
                  {formatFigureVarde(kf.figure)}
                </p>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {kf.forklaring}
                {kf.benchmark ? (
                  <span className="mt-1 block text-xs text-muted-foreground/80">
                    {kf.benchmark.label}: {formatVarde(kf.benchmark.value, kf.figure.unit)}
                  </span>
                ) : null}
              </p>
              {kf.figure.source === "schablon" || kf.figure.ref || kf.figure.osaker ? (
                <div className="mt-2 flex items-center gap-2">
                  {kf.figure.source === "schablon" ? <Tag>Schablon</Tag> : null}
                  {kf.figure.ref ? (
                    <span title={kf.figure.ref.excerpt}>
                      <Tag>s. {kf.figure.ref.page}</Tag>
                    </span>
                  ) : null}
                  <OsakerMarkering figure={kf.figure} />
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
    </section>
  );
}

const AVGIFT_LABEL: Record<keyof FeeInclusion, string> = {
  varme: "Värme",
  vatten: "Vatten",
  el: "El",
  bredband: "Bredband",
  tv: "Tv",
};

/** Display order — matches PropertyInput's AVGIFTSPOSTER order elsewhere in the pipeline. */
const AVGIFT_ORDNING: Array<keyof FeeInclusion> = ["varme", "vatten", "el", "bredband", "tv"];

/** 'okant' (or the whole field being absent) renders as "the report doesn't
 *  say" — never as "nej". Unknown is not false, per CLAUDE.md. */
function avgiftStatusText(status: Tristate | undefined): string {
  if (status === "ja") return "Ingår";
  if (status === "nej") return "Ingår ej";
  return "Framgår inte av årsredovisningen";
}

/**
 * "Övrig info från årsredovisningen" — facts the report states that aren't
 * one of the seven statutory key figures: member/unit counts, what the fee
 * covers (with individual-metering notes), väsentliga händelser and any
 * extraction data-quality caveats. Every one of these is already extracted
 * (see Forening in src/types/analysis.ts) but was never rendered before
 * task 1.5. Hidden entirely when there is nothing at all to show — an empty
 * section would just be noise.
 */
function OvrigInfo({ analys }: { analys: AnalysisResult }) {
  const f = analys.forening;

  const antalPoster = [
    { label: "Antal medlemmar", figure: f.antalMedlemmar },
    { label: "Antal lägenheter", figure: f.antalLagenheter },
    { label: "Varav hyresrätter", figure: f.antalHyresratter },
    { label: "Antal lokaler", figure: f.antalLokaler },
  ].filter(
    (p): p is { label: string; figure: NonNullable<typeof p.figure> } => p.figure !== undefined,
  );

  const avgiftPoster = AVGIFT_ORDNING.map((post) => ({
    post,
    label: AVGIFT_LABEL[post],
    status: f.avgiftInkluderarEnligtForening?.[post],
    ref: f.avgiftInkluderarKallor?.[post],
    matning: post === "bredband" || post === "tv" ? undefined : f.individuellMatning?.[post],
  }));
  const visaAvgiftPoster = f.avgiftInkluderarEnligtForening !== undefined;

  const handelser = f.vasentligaHandelser ?? [];
  const datakvalitetSkal = analys.datakvalitet.extraktionKonfidens.skal ?? [];
  const skannad = arSkannad(analys);

  const harNagot =
    antalPoster.length > 0 ||
    visaAvgiftPoster ||
    handelser.length > 0 ||
    datakvalitetSkal.length > 0 ||
    skannad;

  if (!harNagot) return null;

  return (
    <section className="mb-10">
      <SectionTitle hint="Fakta ur årsredovisningen som inte är ett nyckeltal, men som är bra att känna till.">
        Övrig info från årsredovisningen
      </SectionTitle>

      {antalPoster.length > 0 ? (
        <Card className="mb-4">
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            {antalPoster.map((p) => (
              <div key={p.label}>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{p.label}</p>
                <p className="mt-1 font-display text-xl text-foreground">
                  {formatFigureVarde(p.figure)}
                </p>
                {p.figure.ref ? (
                  <span title={p.figure.ref.excerpt}>
                    <Tag>s. {p.figure.ref.page}</Tag>
                  </span>
                ) : null}
                <OsakerMarkering figure={p.figure} />
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {visaAvgiftPoster ? (
        <Card className="mb-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Vad ingår i avgiften</h3>
          <ul className="divide-y divide-border">
            {avgiftPoster.map((p) => (
              <li
                key={p.post}
                className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0"
              >
                <span className="text-sm font-medium text-foreground">{p.label}</span>
                <span className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {avgiftStatusText(p.status)}
                  </span>
                  {p.matning ? (
                    <Badge tone="teal">
                      {p.matning.matning === "ja"
                        ? "Individuell mätning"
                        : "Ingen individuell mätning"}
                    </Badge>
                  ) : null}
                  {p.ref ? (
                    <span title={p.ref.excerpt}>
                      <Tag>s. {p.ref.page}</Tag>
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {handelser.length > 0 ? (
        <Card className="mb-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Väsentliga händelser</h3>
          <ul className="space-y-2">
            {handelser.map((h, i) => (
              <li key={`handelse-${i}`} className="text-sm text-foreground">
                {h.text}{" "}
                {h.ref ? (
                  <span title={h.ref.excerpt}>
                    <Tag>s. {h.ref.page}</Tag>
                  </span>
                ) : (
                  <span className="text-xs italic text-muted-foreground/70">
                    (ingen exakt sidhänvisning)
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {skannad ? (
        <div className={datakvalitetSkal.length > 0 ? "mb-4" : undefined}>
          <Callout variant="flag" title="Skannad årsredovisning">
            <p>{SKANNAD_NOTIS}</p>
          </Callout>
        </div>
      ) : null}

      {datakvalitetSkal.length > 0 ? (
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-foreground">
            Om extraktionens tillförlitlighet
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {datakvalitetSkal.map((skal, i) => (
              <li key={`skal-${i}`}>{skal}</li>
            ))}
          </ul>
        </Card>
      ) : null}
    </section>
  );
}

/** "Osäker"-markering på en uppgift som rimlighetskontrollerna
 *  (src/lib/analysis/rimlighet.ts) stämplat — orsaken visas vid hovring.
 *  Uppgiften visas ändå; frånvaro betyder bara att ingen kontroll slog till. */
function OsakerMarkering({ figure }: { figure: Pick<Figure, "osaker"> }) {
  if (!figure.osaker) return null;
  return (
    <span title={figure.osaker}>
      <Badge tone="warning">Osäker</Badge>
    </span>
  );
}

/**
 * Värderingssektionen — delas av den fullständiga rapporten ("Är priset
 * rimligt?") och den fristående priskollen (`/vardering`). Tar
 * `PrisanalysUtanForening`: utan utgångspris utelämnas prisraderna och
 * rubriken ändras, i övrigt är renderingen identisk. `skuldrad` finns bara i
 * den fullständiga analysen (se andelAvSkuldRad i analysisView.ts).
 */
export function Prisrimlighet({
  prisanalys: p,
  skuldrad,
}: {
  prisanalys: PrisanalysUtanForening;
  skuldrad?: AndelAvSkuldRad | undefined;
}) {
  const u = p.varderingsunderlag;
  const tackningText = u ? varderingsTackningText(u) : null;
  const varderingslabel =
    p.externVardering?.source === "schablon" ? "Binfos värdering" : "Extern värdering";
  return (
    <section className="mb-10">
      <SectionTitle
        hint={
          p.utgangspris
            ? "Jämförelse mot Binfos värderingsmodell och pris per kvadratmeter."
            : "Binfos uppskattning utifrån lägenhetens egna uppgifter."
        }
      >
        {p.utgangspris ? "Är priset rimligt?" : "Binfos värdering"}
      </SectionTitle>
      {tackningText?.typ === "utanfor_lan" ? (
        <div className="mb-4">
          <Callout variant="flag" title={tackningText.titel ?? "Utanför täckningsområdet"}>
            <p>{tackningText.text}</p>
          </Callout>
        </div>
      ) : null}
      <Card>
        <div className="divide-y divide-border">
          {p.utgangspris ? (
            <div className="flex flex-wrap items-center justify-between gap-2 py-4 first:pt-0 last:pb-0">
              <p className="text-sm font-medium text-foreground">Utgångspris</p>
              <p className="font-display text-xl text-foreground">
                {formatFigureVarde(p.utgangspris)}
              </p>
            </div>
          ) : null}
          {p.prisPerM2 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 py-4 first:pt-0 last:pb-0">
              <p className="text-sm font-medium text-foreground">Pris per kvadratmeter</p>
              <p className="font-display text-xl text-foreground">
                {formatFigureVarde(p.prisPerM2)}
              </p>
            </div>
          ) : null}

          {p.externVardering ? (
            <div className="flex flex-wrap items-center justify-between gap-2 py-4 first:pt-0 last:pb-0">
              <div>
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {varderingslabel}
                  {p.externVardering.source === "schablon" ? <Tag>Estimat</Tag> : null}
                </p>
                {/* Dold rad (ägarens beslut 2026-10-09): leverantören av
                    värderingen visas inte i rapporten. Uppgiften finns kvar i
                    analysdatat och kan tas fram igen genom att ta bort
                    dölj-klassen. */}
                <p className="hidden text-xs text-muted-foreground">
                  {p.externVardering.leverantor}
                </p>
              </div>
              <div className="text-right">
                <p className="font-display text-xl text-foreground">
                  {formatFigureVarde(p.externVardering)}
                </p>
                {p.externVardering.range && u ? (
                  /* Dold rad (ägarens beslut 2026-10-09): spannintervallet
                     visas inte i rapporten. Beräkningen finns kvar i analysdatat
                     och kan tas fram igen genom att ta bort dölj-klassen. */
                  <p className="hidden text-xs text-muted-foreground">
                    Sannolikt mellan {formatVarde(p.externVardering.range.low, "kr")} och{" "}
                    {formatVarde(p.externVardering.range.high, "kr")} ({u.intervallTackningProcent}{" "}
                    %)
                  </p>
                ) : null}
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
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 py-4 first:pt-0 last:pb-0">
              <p className="text-sm font-medium text-foreground">Binfos värdering</p>
              <p className="text-sm text-muted-foreground">
                Inte tillgänglig — postnumret saknas eller är ogiltigt
              </p>
            </div>
          )}

          {skuldrad ? (
            <div className="flex flex-wrap items-center justify-between gap-2 py-4 first:pt-0 last:pb-0">
              <p className="max-w-xl text-sm text-muted-foreground">{skuldrad.text}</p>
              <div className="flex items-center gap-2">
                {skuldrad.ref ? (
                  <span title={skuldrad.ref.excerpt}>
                    <Tag>s. {skuldrad.ref.page}</Tag>
                  </span>
                ) : null}
                {skuldrad.osaker ? (
                  <span title={skuldrad.osaker}>
                    <Badge tone="warning">Osäker</Badge>
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {u ? (
          <div className="mt-6 space-y-3 border-t border-border pt-6">
            <p className="text-sm font-medium text-foreground">
              Område:{" "}
              {u.omrade ??
                (tackningText
                  ? (u.kommun ?? u.prisniva?.region ?? "Okänt")
                  : "Stockholm (postnumret saknas i vår områdesindelning)")}
            </p>
            {u.drivare.length > 0 ? (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Vad påverkar värderingen
                </p>
                <ul className="mt-1 space-y-1 text-sm text-foreground">
                  {u.drivare.map((d) => (
                    <li key={d.label} className="flex items-center justify-between gap-2">
                      <span>{formatDrivareLabel(d, u.omrade)}</span>
                      <span className={d.effektProcent >= 0 ? "text-success" : "text-danger"}>
                        {d.effektProcent >= 0 ? "+" : ""}
                        {d.effektProcent.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} %
                      </span>
                    </li>
                  ))}
                </ul>
                {/* Driveförklaringens förbehållsrad är dold på ägarbegäran
                    2026-10-08. Texten ligger kvar i VARDERINGSDRIVARE_CAVEAT
                    (och i PDF-exporten) och tas fram genom ta bort div:en. */}
                <div className="hidden">
                  <p className="mt-1 text-xs text-muted-foreground">{VARDERINGSDRIVARE_CAVEAT}</p>
                </div>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Bygger på försäljningar i Stockholm {formatDataperiod(u.dataperiod)}
            </p>

            {tackningText?.typ === "lan" ? (
              <p className="text-xs text-muted-foreground">{tackningText.text}</p>
            ) : null}
            <p className="text-xs text-muted-foreground">{OMRADESINDELNING_ATTRIBUTION}</p>
          </div>
        ) : null}

        {p.budpremie ? (
          <p className="mt-3 text-sm text-foreground">{formatBudpremieText(p.budpremie)}</p>
        ) : null}

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

function Rantestress({ analys }: { analys: AnalysisResult }) {
  const r = analys.rantestress;
  const ejBeraknbar = r.rantekanslighetProcent === null;
  const [delta, setDelta] = useState<0 | 1 | 2 | 3>(1);
  // Räntekänslighet saknas i rapporten -> reglaget visas men är låst på +0,
  // och en avgiftsstress kan inte räknas fram (se Rantestress i
  // src/types/analysis.ts). Ett tomt scenarier-fält gör samma sak för +0
  // p.e. hos en skuldfri förening (rantekanslighetProcent === 0) — den ska
  // fortfarande renderas som vanligt, +0 kr.
  const visadDelta = ejBeraknbar ? 0 : delta;
  const scenario: RantestressScenario | undefined = r.scenarier.find(
    (s) => s.okningPe === visadDelta,
  );

  return (
    <section className="mb-10">
      <SectionTitle
        hint={
          ejBeraknbar
            ? "Räntekänslighet saknas i årsredovisningen, så avgiftsstressen kan inte beräknas."
            : "Dra i reglaget för att se hur just den här lägenhetens avgift påverkas."
        }
      >
        Vad händer om räntan stiger?
      </SectionTitle>
      <Card>
        <div className="flex items-baseline justify-between">
          <label htmlFor="stress" className="text-sm font-medium text-foreground">
            Räntehöjning
          </label>
          <span className="font-display text-2xl text-primary">+{visadDelta} p.e.</span>
        </div>
        <input
          id="stress"
          type="range"
          min={0}
          max={3}
          step={1}
          value={visadDelta}
          disabled={ejBeraknbar}
          onChange={(e) => setDelta(Number(e.target.value) as 0 | 1 | 2 | 3)}
          className={`mt-4 w-full accent-primary ${
            ejBeraknbar ? "cursor-not-allowed opacity-60" : ""
          }`}
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
            {ejBeraknbar ? (
              <p className="mt-2 text-sm text-foreground">
                Inte möjligt att räkna då räntekänslighet saknas i rapporten.
              </p>
            ) : (
              <>
                <p className="mt-2 font-display text-3xl text-foreground">
                  {scenario ? formatFigureVarde(scenario.nyManadsavgift) : "Uppgift saknas"}
                </p>
                <p className="text-xs text-muted-foreground">
                  per månad · +
                  {scenario ? formatFigureVarde(scenario.avgiftsokningKrPerManad) : "okänt"}
                </p>
              </>
            )}
          </div>
        </div>
        <p className="mt-5 text-sm text-muted-foreground">{r.kommentar}</p>
      </Card>
    </section>
  );
}

function Fragor({ analys }: { analys: AnalysisResult }) {
  const [checked, setChecked] = useState<string[]>([]);
  const toggle = (k: string) =>
    setChecked((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));

  // Frågor härledda ur analysen.
  const analysFragor = analys.fragor.filter((f) => f.ursprung === "analys");

  const rad = (f: Fraga) => (
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
            checked.includes(f.id) ? "text-muted-foreground line-through" : "text-foreground"
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
      </Card>
    </section>
  );
}
