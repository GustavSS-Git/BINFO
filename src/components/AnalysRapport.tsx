import { useState, type ReactNode } from "react";
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
  formatBudpremieText,
  andelAvSkuldRad,
  arSkannad,
  varderingsKallaText,
  varderingsTackningText,
  formatFigureVarde,
  formatVarde,
  bolanekalkylPris,
  SKANNAD_NOTIS,
  toppRodaFlaggor,
  type AndelAvSkuldRad,
  antagenAndelText,
  avgiftsHuvud,
  avvikelseJusteradText,
  BYGGDEL_KALLA_TEXT,
  byggdelNot,
  byggdelRader,
  ENERGI_TEXT,
  formatForandringKr,
  komponentKalla,
  komponentRader,
  lanRader,
  prisEffektTexter,
  PRIS_LABEL_BAS,
  PRIS_LABEL_JUSTERAD,
  PRISEFFEKT_CAVEAT,
  RAKNA_FAKTORER,
  RAKNA_PROGNOS_RUBRIK,
  RAKNA_REFINANSIERING_RUBRIK,
  RAKNA_UTGANGSLAGE_INTRO,
  RAKNA_UTGANGSLAGE_KORT,
  RAKNA_UTGANGSLAGE_RUBRIK,
  RANTEKANSLIGHET_RAD,
  referensrantaRad,
  refinansieringRader,
  refiKomponent,
  REFI_FASTRAD,
  sparKedja,
  sparKomponent,
  TON_BG,
  TON_TEXT,
  tonForTryck,
  TRYCK_ETIKETT,
  TRYCK_TON,
  vattenfall,
  type Ton,
  type VattenfallRad,
} from "@/lib/analysisView";
import { veljRantekanslighetForSok, type BolanekalkylSearch } from "@/lib/bolanekalkyl";
import type {
  AnalysisResult,
  Avgiftsprognos,
  FeeInclusion,
  Figure,
  Fraga,
  PrisanalysUtanForening,
  RantestressScenario,
  Sammanfattning,
  Severity,
  Tristate,
  Tryck,
} from "@/types/analysis";

/**
 * Rent presentationslager för en färdig `AnalysisResult` — betygskort, de sju
 * nyckeltalen, prisrimlighet, räntestress och frågor att ställa. Ingen egen
 * datahämtning: tar analysen som prop så att både exempelsidan (`/exempel`,
 * som visar `sampleAnalysis`) och den riktiga rapporten
 * (`/analys/$analysisId`) delar exakt samma renderingskod och aldrig kan
 * glida isär.
 */
export function AnalysRapport({
  analys,
  sparaSlot,
}: {
  analys: AnalysisResult;
  /** Optional content right under the grade card (the "Spara analysen" row on
   *  /forhandsvisning and /analys). Absent everywhere else (/exempel). */
  sparaSlot?: ReactNode;
}) {
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
  const bolanekalkylSearch: BolanekalkylSearch = {
    manadsavgift: analys.rantestress.nuvarandeManadsavgift.value ?? undefined,
    rantekanslighet: veljRantekanslighetForSok(analys.rantestress.rantekanslighetProcent),
    pris: bolanekalkylPris(analys.prisanalys),
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
        byggarJamforelse={analys.uppgiftsjamforelse?.find((r) => r.falt === "byggar")}
      />

      <Betygskort betyg={analys.betyg} motivering={analys.betygMotivering} />

      {sparaSlot}

      <RodaFlaggor analys={analys} />

      <Foreningsekonomi analys={analys} />
      <OvrigInfo analys={analys} />
      <Prisrimlighet
        prisanalys={analys.prisanalys}
        skuldrad={andelAvSkuldRad(analys)}
        avgiftsprognos={analys.avgiftsprognos}
      />
      <Rantestress analys={analys} />
      <Fragor analys={analys} />
      <SammanfattningSektion
        sammanfattning={analys.sammanfattning}
        tryck={analys.avgiftsprognos?.tryck}
      />

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

/**
 * Betygskortet, RodaFlaggor, Foreningsekonomi, OvrigInfo och Fragor nedan är
 * exporterade så att den publika BRF-sidan (`/brf/$slug`) kan visa de
 * BRF-nivåsektioner som inte kräver köparens uppgifter. De tar bara de fält de
 * faktiskt läser (`Pick<…>`), så en sida utan `prisanalys`/`input` kan rendera
 * dem. Själva renderingen är oförändrad.
 */
export function Betygskort({ betyg, motivering }: { betyg: string; motivering: string }) {
  return (
    <Card className="mb-6 flex flex-wrap items-center gap-6">
      <div className="flex size-20 items-center justify-center rounded-full border-4 border-primary/20 bg-primary/5 font-display text-3xl text-primary">
        {betyg}
      </div>
      <div className="max-w-xl flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Sammanvägt riskbetyg
        </p>
        <p className="mt-2 text-sm text-foreground">{motivering}</p>
      </div>
    </Card>
  );
}

export function RodaFlaggor({ analys }: { analys: Pick<AnalysisResult, "rodaFlaggor"> }) {
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

export function Foreningsekonomi({ analys }: { analys: Pick<AnalysisResult, "forening"> }) {
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
export function OvrigInfo({
  analys,
}: {
  analys: {
    forening: AnalysisResult["forening"];
    datakvalitet: Pick<AnalysisResult["datakvalitet"], "extraktionKonfidens" | "kalla">;
  };
}) {
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
 * rimligt?") och priskollen (steg 1 på `/analysera`). Tar
 * `PrisanalysUtanForening`: utan utgångspris utelämnas prisraderna och
 * rubriken ändras, i övrigt är renderingen identisk. `skuldrad` finns bara i
 * den fullständiga analysen (se andelAvSkuldRad i analysisView.ts).
 */
export function Prisrimlighet({
  prisanalys: p,
  skuldrad,
  avgiftsprognos,
}: {
  prisanalys: PrisanalysUtanForening;
  skuldrad?: AndelAvSkuldRad | undefined;
  /** Bara i den fullständiga analysen (och bara när servern räknat fram den). */
  avgiftsprognos?: Avgiftsprognos | undefined;
}) {
  const u = p.varderingsunderlag;
  const tackningText = u ? varderingsTackningText(u) : null;
  const varderingslabel =
    p.externVardering?.source === "schablon" ? PRIS_LABEL_BAS : "Extern värdering";
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
                {p.avvikelseMotVardering !== undefined && p.justeradVardering === undefined ? (
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

          {p.justeradVardering ? (
            <div className="flex flex-wrap items-center justify-between gap-2 py-4 first:pt-0 last:pb-0">
              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                {PRIS_LABEL_JUSTERAD}
                <Tag>Estimat</Tag>
              </p>
              <div className="text-right">
                <p className="font-display text-xl text-foreground">
                  {formatFigureVarde(p.justeradVardering)}
                </p>
                {p.avvikelseMotJusteradVardering !== undefined ? (
                  <p
                    className={`text-xs ${p.avvikelseMotJusteradVardering > 0 ? "text-danger" : "text-success"}`}
                  >
                    {avvikelseJusteradText(p.avvikelseMotJusteradVardering)}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {p.justeradVardering && avgiftsprognos ? (
            <PrisVattenfall prisanalys={p} prognos={avgiftsprognos} />
          ) : null}

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
            {tackningText?.typ === "lan" ? (
              <p className="text-xs text-muted-foreground">{tackningText.text}</p>
            ) : null}
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

      {u || avgiftsprognos ? (
        <details className="mt-4 rounded-lg border border-border bg-secondary/40">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">
            Så har vi räknat
          </summary>
          <div className="space-y-6 border-t border-border px-4 pb-4 pt-3">
            {u ? (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">
                  {RAKNA_UTGANGSLAGE_RUBRIK}
                </h3>
                <p className="text-sm text-muted-foreground">{RAKNA_UTGANGSLAGE_KORT}</p>
                <VisaMer>
                  <p className="text-sm text-muted-foreground">{RAKNA_UTGANGSLAGE_INTRO}</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {RAKNA_FAKTORER.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {varderingsKallaText(u.dataperiod)}
                  </p>
                </VisaMer>
              </div>
            ) : null}
            {avgiftsprognos ? <RaknaPrognos prognos={avgiftsprognos} prisanalys={p} /> : null}
          </div>
        </details>
      ) : null}
    </section>
  );
}

/** Liten färgprick för avgiftstryck (samma toner som nyckeltalens status). */
function Prick({ ton, etikett }: { ton: Ton; etikett?: string }) {
  return (
    <>
      <span
        data-ton={ton}
        className={`inline-block size-2.5 shrink-0 rounded-full ${TON_BG[ton]}`}
        aria-hidden
      />
      {etikett ? <span className="sr-only">{etikett}</span> : null}
    </>
  );
}

/** "Visa mer": inbyggd <details>, stängd från start (fungerar utan JS och i SSR). */
function VisaMer({ children, etikett = "Visa mer" }: { children: ReactNode; etikett?: string }) {
  return (
    <details className="group">
      <summary className="cursor-pointer text-xs font-medium text-primary">{etikett}</summary>
      <div className="mt-2 space-y-2">{children}</div>
    </details>
  );
}

function KallaTagg({ text }: { text: string }) {
  return <Tag>{text}</Tag>;
}

/** Stapeldiagram från "vad jämförbara säljs för" till det justerade värdet. */
function PrisVattenfall({
  prisanalys,
  prognos,
}: {
  prisanalys: PrisanalysUtanForening;
  prognos: Avgiftsprognos;
}) {
  const v = vattenfall(prisanalys, prognos);
  if (!v) return null;
  return (
    <div className="py-4 first:pt-0 last:pb-0" data-slot="pris-vattenfall">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Så påverkar föreningens ekonomi priset
      </p>
      <ul className="space-y-2">
        {v.rader.map((r: VattenfallRad) => (
          <li key={r.id} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3">
            <span className="text-xs text-foreground">{r.label}</span>
            <span className="relative h-3 rounded bg-secondary" aria-hidden>
              <span
                data-ton={r.ton}
                className={`absolute inset-y-0 rounded ${r.typ === "steg" ? TON_BG[r.ton] : "bg-foreground/60"}`}
                style={{ left: `${r.vansterPct}%`, width: `${r.breddPct}%` }}
              />
            </span>
            <span
              className={`text-right text-xs font-medium ${r.typ === "steg" ? TON_TEXT[r.ton] : "text-foreground"}`}
            >
              {r.beloppText}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Skalan är utzoomad kring värdena.
        {v.proportionell ? " Delbeloppen är fördelade efter komponenternas kr/mån." : ""}
      </p>
    </div>
  );
}

/** Sparandekedjan: behov → sparar → glapp → avgift → pris, plus en stapel. */
function SparSteg({
  prognos,
  prisanalys,
}: {
  prognos: Avgiftsprognos;
  prisanalys: PrisanalysUtanForening;
}) {
  const kedja = sparKedja(prognos, prisanalys);
  const sb = prognos.sparbehov;
  if (!kedja || !sb) return null;
  const komp = sparKomponent(prognos);
  const byggdelar = byggdelRader(sb);
  return (
    <div className="space-y-3" data-slot="spar-steg">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-foreground">Sparande till underhåll</h4>
        {komp?.tryck ? (
          <Prick ton={TRYCK_TON[komp.tryck]} etikett={TRYCK_ETIKETT[komp.tryck]} />
        ) : null}
        {kedja.dampningTag ? <Tag>{kedja.dampningTag}</Tag> : null}
      </div>
      <ol className="flex flex-wrap items-stretch gap-2">
        {kedja.steg.map((k, i) => (
          <li key={k.id} className="flex items-center gap-2">
            {i > 0 ? (
              <span className="text-muted-foreground" aria-hidden>
                →
              </span>
            ) : null}
            <div className="rounded-xl border border-border bg-card px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {k.rubrik}
              </p>
              <p className={`font-display text-lg ${k.ton ? TON_TEXT[k.ton] : "text-foreground"}`}>
                {k.varde}
              </p>
              {k.kalla ? <KallaTagg text={k.kalla} /> : null}
            </div>
          </li>
        ))}
      </ol>
      <div className="space-y-1" aria-hidden>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="w-12">Behov</span>
          <span className="h-2 flex-1 rounded bg-secondary">
            <span
              className="block h-2 rounded bg-foreground/50"
              style={{ width: `${kedja.behovPct}%` }}
            />
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="w-12">Sparar</span>
          <span className="h-2 flex-1 rounded bg-secondary">
            <span
              data-ton={kedja.sparTon}
              className={`block h-2 rounded ${TON_BG[kedja.sparTon]}`}
              style={{ width: `${kedja.sparPct ?? 0}%` }}
            />
          </span>
        </div>
      </div>
      {byggdelar.length > 0 ? (
        <VisaMer etikett="Visa byggdelarna">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left uppercase tracking-wide text-muted-foreground">
                <th className="pb-1 font-medium">Byggdel</th>
                <th className="pb-1 font-medium">Senast</th>
                <th className="pb-1 font-medium">Normalt</th>
                <th className="pb-1 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {byggdelar.map((b) => (
                <tr key={b.key}>
                  <td className="py-1.5 text-foreground">{b.label}</td>
                  <td className="py-1.5 text-muted-foreground">
                    {b.senast}{" "}
                    {b.ref ? (
                      <span title={b.ref.excerpt}>
                        <Tag>s. {b.ref.page}</Tag>
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1.5 text-muted-foreground">{b.livslangd}</td>
                  <td className="py-1.5 text-right">
                    <Badge tone={b.ton === "neutral" ? "neutral" : b.ton}>{b.statusEtikett}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">{byggdelNot()}</p>
          <p className="text-[11px] text-muted-foreground">{BYGGDEL_KALLA_TEXT}</p>
        </VisaMer>
      ) : null}
    </div>
  );
}

/** Refinansieringssteget: stort tal, lånelista och försiktighetsraden. */
function RefiSteg({ prognos }: { prognos: Avgiftsprognos }) {
  const r = prognos.refinansiering;
  const komp = refiKomponent(prognos);
  if (!r && !komp) return null;
  const rader = r ? lanRader(r, prognos.horisontManader, prognos.andel?.varde) : [];
  const antagen = r ? antagenAndelText(r) : undefined;
  const vard = komp ? komponentRader({ ...prognos, komponenter: [komp] })[0] : undefined;
  return (
    <div className="space-y-3" data-slot="refi-steg">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-foreground">Lån som omsätts</h4>
          {komp?.tryck ? (
            <Prick ton={TRYCK_TON[komp.tryck]} etikett={TRYCK_ETIKETT[komp.tryck]} />
          ) : null}
        </div>
        {vard ? (
          <span
            className={`font-display text-xl ${vard.dimmad ? "text-muted-foreground" : TON_TEXT[tonForTryck(komp?.tryck)]}`}
          >
            {vard.vardeText}
          </span>
        ) : null}
      </div>
      {rader.length > 0 ? (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left uppercase tracking-wide text-muted-foreground">
              <th className="pb-1 font-medium">Förfaller</th>
              <th className="pb-1 text-right font-medium">Belopp</th>
              <th className="pb-1 pr-3 text-right font-medium">Ränta</th>
              <th className="pb-1 pl-3 font-medium">Period</th>
              <th className="pb-1 text-right font-medium">Effekt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rader.map((l) => (
              <tr key={l.key} data-fas={l.senare ? "senare" : "inom"}>
                <td className="py-1.5 text-foreground">{l.forfaller}</td>
                <td className="py-1.5 text-right text-foreground">{l.belopp}</td>
                <td className="py-1.5 pr-3 text-right text-muted-foreground">{l.ranta}</td>
                <td className="py-1.5 pl-3 text-muted-foreground">{l.fas}</td>
                <td className="py-1.5 text-right text-foreground">
                  {l.effekt}
                  {l.effektForening ? (
                    <span className="block text-[11px] text-muted-foreground">
                      {l.effektForening} (föreningen)
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {r && rader.some((l) => l.senare) ? (
        <p className="text-xs text-muted-foreground">{REFI_FASTRAD}</p>
      ) : null}
      {r ? <p className="text-[11px] text-muted-foreground">{referensrantaRad(r)}</p> : null}
      {komp?.ref ? (
        <span title={komp.ref.excerpt}>
          <Tag>Årsredovisning s. {komp.ref.page}</Tag>
        </span>
      ) : null}
      <VisaMer etikett="Visa hela uträkningen">
        {komp ? <p className="text-xs text-muted-foreground">{komp.forklaring}</p> : null}
        {r ? (
          <ul className="space-y-1 text-xs text-foreground">
            {refinansieringRader(r).map((rad) => (
              <li key={rad.label}>
                <span className="text-muted-foreground">{rad.label}:</span> {rad.value}
              </li>
            ))}
          </ul>
        ) : null}
        {antagen ? <p className="text-xs text-muted-foreground">{antagen}</p> : null}
      </VisaMer>
    </div>
  );
}

/** Del 2: den väntade avgiftsutvecklingen, visuellt först och text sedan. */
function RaknaPrognos({
  prognos,
  prisanalys,
}: {
  prognos: Avgiftsprognos;
  prisanalys: PrisanalysUtanForening;
}) {
  const huvud = avgiftsHuvud(prognos);
  const spar = sparKomponent(prognos);
  const refi = refiKomponent(prognos);
  const harSparSteg = prognos.sparbehov !== undefined && spar !== undefined;
  const ovriga = komponentRader(prognos).filter(
    (k) => !(harSparSteg && k.id === spar?.id) && k.id !== refi?.id,
  );
  const prisTexter = prisEffektTexter(prisanalys);
  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {RAKNA_PROGNOS_RUBRIK}
            {prognos.tryck ? (
              <Prick ton={TRYCK_TON[prognos.tryck]} etikett={TRYCK_ETIKETT[prognos.tryck]} />
            ) : null}
          </h3>
          <div className="text-right">
            <p
              data-ton={tonForTryck(prognos.tryck)}
              className={`font-display text-2xl ${TON_TEXT[tonForTryck(prognos.tryck)]}`}
            >
              {huvud.varde}
            </p>
            <p className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
              {huvud.under} <Tag>Uppskattning</Tag>
            </p>
          </div>
        </div>
        {prognos.tryck ? (
          <p className="text-xs text-muted-foreground">{TRYCK_ETIKETT[prognos.tryck]}</p>
        ) : null}
        {prognos.osaker ? <p className="text-xs text-muted-foreground">{prognos.osaker}</p> : null}

        {harSparSteg ? <SparSteg prognos={prognos} prisanalys={prisanalys} /> : null}
        <RefiSteg prognos={prognos} />

        {ovriga.length > 0 ? (
          <ul className="divide-y divide-border">
            {ovriga.map((k) => {
              const komp = prognos.komponenter.find((x) => x.id === k.id);
              const kalla = komp ? komponentKalla(komp) : undefined;
              return (
                <li
                  key={k.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {komp?.tryck ? (
                      <Prick ton={TRYCK_TON[komp.tryck]} etikett={TRYCK_ETIKETT[komp.tryck]} />
                    ) : null}
                    {k.label}
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className={`text-sm ${k.dimmad ? "text-muted-foreground" : "text-foreground"}`}
                    >
                      {k.vardeText}
                    </span>
                    {kalla ? (
                      <span title={komp?.ref?.excerpt}>
                        <KallaTagg text={kalla.text} />
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
        {ovriga.length > 0 ? (
          <VisaMer etikett="Visa mer om övriga delar">
            <ul className="space-y-1 text-xs text-muted-foreground">
              {ovriga.map((k) => (
                <li key={k.id}>
                  <span className="font-medium text-foreground">{k.label}:</span> {k.forklaring}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">{ENERGI_TEXT}</p>
          </VisaMer>
        ) : null}
        {prisTexter.length > 0 ? (
          <VisaMer etikett="Så räknas avgiften om till pris">
            {prisTexter.map((t) => (
              <p key={t} className="text-xs text-foreground">
                {t}
              </p>
            ))}
            <p className="text-xs text-muted-foreground">{PRISEFFEKT_CAVEAT}</p>
          </VisaMer>
        ) : null}
        <p className="text-xs text-muted-foreground">{RANTEKANSLIGHET_RAD}</p>
      </div>
    </>
  );
}

/** Slutsammanfattningen, sist i rapporten (före sparalternativen). */
function SammanfattningSektion({
  sammanfattning,
  tryck,
}: {
  sammanfattning: Sammanfattning | undefined;
  tryck?: Tryck | undefined;
}) {
  if (!sammanfattning) return null;
  return (
    <section className="mt-10">
      <SectionTitle>Sammanfattning</SectionTitle>
      <Card>
        <div className="space-y-3 text-sm text-foreground">
          <p>{sammanfattning.betyg}</p>
          <p>{sammanfattning.pris}</p>
          <p>
            {tryck ? (
              <span className="mr-2 align-middle">
                <Badge tone={TRYCK_TON[tryck]}>{TRYCK_ETIKETT[tryck]}</Badge>
              </span>
            ) : null}
            {sammanfattning.avgift}
          </p>
          <p>{sammanfattning.slutsats}</p>
        </div>
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

  // Ny rapport: tabell med väntad avgift och räntescenarier istället för reglaget.
  // Gamla lagrade resultat saknar prognosTabell och behåller reglaget nedan.
  if (r.prognosTabell) {
    return (
      <section className="mb-10">
        <SectionTitle hint="Dagens avgift, den väntade avgiften och två räntescenarier för lånen som omsätts.">
          Vad händer om räntan stiger?
        </SectionTitle>
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2 font-medium" />
                <th className="pb-2 text-right font-medium">Månadsavgift kr/mån</th>
                <th className="pb-2 text-right font-medium">Förändring mot i dag kr/mån</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {r.prognosTabell.rader.map((rad) => (
                <tr key={rad.id}>
                  <td className="py-2 text-foreground">
                    <span className="inline-flex items-center gap-2">
                      {rad.id === "forvantad" && analys.avgiftsprognos?.tryck ? (
                        <Prick
                          ton={TRYCK_TON[analys.avgiftsprognos.tryck]}
                          etikett={TRYCK_ETIKETT[analys.avgiftsprognos.tryck]}
                        />
                      ) : null}
                      {rad.label}
                    </span>
                  </td>
                  <td className="py-2 text-right text-foreground">
                    {Math.round(rad.manadsavgift).toLocaleString("sv-SE")}
                  </td>
                  <td className="py-2 text-right text-foreground">
                    {rad.id === "idag" ? "–" : formatForandringKr(rad.forandringKr)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-5 text-sm text-muted-foreground">{r.prognosTabell.kommentar}</p>
        </Card>
      </section>
    );
  }

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

/** Modellen och de deterministiska frågorna skriver redan "Bra svar: … Varningssignal: …";
 *  då är raden sin egen rubrik. Annars (fritext) sätts rubriken framför. */
function svarssignalMedRubrik(text: string): string {
  return /^(bra svar|varningssignal):/i.test(text.trim())
    ? text.trim()
    : `Bra svar / varningssignal: ${text.trim()}`;
}

export function Fragor({ analys }: { analys: Pick<AnalysisResult, "fragor"> }) {
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
        <span className="flex flex-col gap-1">
          <span
            className={`text-sm ${
              checked.includes(f.id) ? "text-muted-foreground line-through" : "text-foreground"
            }`}
          >
            {f.fraga}
          </span>
          <span className="text-xs italic text-muted-foreground">Varför: {f.varfor}</span>
          {f.svarssignal ? (
            <span className="text-xs text-muted-foreground">
              {svarssignalMedRubrik(f.svarssignal)}
            </span>
          ) : null}
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
