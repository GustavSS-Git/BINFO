/**
 * Pure data mapping from AnalysisResult to the PDF's content — no react-pdf
 * import here on purpose, so this stays trivially unit-testable and mirrors
 * exactly the sections AnalysRapport.tsx renders on screen (same filters,
 * same ordering), per the task brief: "everything AnalysRapport renders,
 * flattened". AnalysPdfDocument.tsx turns this into JSX; it should not need
 * to re-decide what belongs on the report.
 */
import { visasIHuvudanalys } from "@/lib/analysis/benchmarks";
import {
  andelAvSkuldRad,
  arSkannad,
  formatDrivareLabel,
  formatBudpremieText,
  formatDataperiod,
  formatFigureVarde,
  formatSkapadDatum,
  formatVarde,
  OMRADESINDELNING_ATTRIBUTION,
  SKANNAD_NOTIS,
  varderingsTackningText,
} from "@/lib/analysisView";
import type {
  AnalysisResult,
  FeeInclusion,
  PageRef,
  Severity,
  Status,
  Tristate,
} from "@/types/analysis";

export const SEVERITY_LABEL: Record<Severity, string> = {
  hog: "Hög risk",
  medel: "Medelrisk",
  lag: "Låg risk",
};

export const STATUS_LABEL: Record<Status, string> = {
  god: "God",
  acceptabel: "Acceptabel",
  svag: "Svag",
  kritisk: "Kritisk",
  okant: "Okänt",
};

const KONFIDENS_LABEL: Record<"hog" | "medel" | "lag", string> = {
  hog: "Hög",
  medel: "Medel",
  lag: "Låg",
};

function formatPageRef(ref: PageRef | undefined): string | undefined {
  return ref ? `s. ${ref.page}` : undefined;
}

export interface PdfSummaryRow {
  label: string;
  value: string;
}

// Several fields below are typed `T | undefined` rather than `T?` —
// exactOptionalPropertyTypes (see tsconfig.json) forbids assigning an
// explicit `undefined` to a `?:` field; several source values here (e.g. a
// Figure's optional `ref`) are genuinely absent rather than omitted, so the
// mapping functions below need to write `undefined` explicitly. Same
// convention as BolanekalkylSearch in src/lib/bolanekalkyl.ts.

export interface PdfRedFlag {
  id: string;
  titel: string;
  beskrivning: string;
  severity: Severity;
  severityLabel: string;
  pageRef: string | undefined;
}

export interface PdfKeyFigure {
  id: string;
  label: string;
  valueText: string;
  status: Status;
  statusLabel: string;
  benchmarkText: string | undefined;
  forklaring: string;
  pageRef: string | undefined;
  isSchablon: boolean;
  /** Skäl från rimlighetskontrollerna; visas som "Osäker: …" i PDF:en. */
  osaker: string | undefined;
}

export interface PdfVarderingsdrivare {
  label: string;
  effektProcentText: string;
  positiv: boolean;
}

export interface PdfVarderingsunderlag {
  omradeText: string;
  /** 'utanfor_lan' only: rendered first in the section, above the estimate. */
  tackningTitel: string | undefined;
  disclaimerText: string | undefined;
  /** 'lan' only: method note shown with the data basis. */
  metodText: string | undefined;
  intervallText: string | undefined;
  drivare: PdfVarderingsdrivare[];
  dataBasisText: string;
  attributionText: string;
}

/** Raden "Lägenhetens ungefärliga andel av föreningens lån" (bara full analys). */
export interface PdfAndelAvSkuld {
  text: string;
  pageRef: string | undefined;
  osaker: string | undefined;
}

export interface PdfPrisanalys {
  utgangspris: string;
  prisPerM2: string;
  externVardering:
    | {
        value: string;
        leverantor: string;
        isSchablon: boolean;
      }
    | undefined;
  avvikelseText: string | undefined;
  /** Present only when externVardering kom från Binfos värderingsmodell —
   *  se Prisanalys.varderingsunderlag i src/types/analysis.ts. */
  varderingsunderlag: PdfVarderingsunderlag | undefined;
  /** Kommentar under värderingen; ingår inte i värderingen. Saknas när
   *  föreningens skuld per m² inte gick att läsa ut. */
  andelAvSkuld: PdfAndelAvSkuld | undefined;
  /** Task 5: hur mycket bostäder i området sålts över/under utgångspriset. */
  budpremieText: string | undefined;
  slutsats: string;
  konfidensNiva: string;
  konfidensSkal: string[];
}

export interface PdfRantestressRad {
  okningPe: 0 | 1 | 2 | 3;
  nyManadsavgift: string;
  avgiftsokning: string;
  /** Present only when the analysis had loan details to compute a full
   *  monthly cost, not just the fee (see RantestressScenario). */
  totalManadskostnad?: string;
}

export interface PdfRantestress {
  nuvarandeManadsavgift: string;
  /** Empty when rantekanslighetProcent is null — the report doesn't state
   *  räntekänslighet, so no stress scenarios could be computed. */
  rader: PdfRantestressRad[];
  kommentar: string;
  /** True when rantekanslighetProcent is null. Drives the "not possible to
   *  compute" note instead of the scenario table. */
  ejBeraknbar: boolean;
}

export interface PdfFraga {
  id: string;
  fraga: string;
}

/** One "antal"-figure row — antal medlemmar/lägenheter/hyresrätter/lokaler. */
export interface PdfOvrigInfoAntal {
  label: string;
  valueText: string;
  pageRef: string | undefined;
  osaker: string | undefined;
}

/** One fee-inclusion row — mirrors AnalysRapport.tsx's avgiftPoster shape. */
export interface PdfOvrigInfoAvgiftPost {
  post: keyof FeeInclusion;
  label: string;
  statusText: string;
  matningText: string | undefined;
  pageRef: string | undefined;
}

export interface PdfOvrigInfoHandelse {
  text: string;
  pageRef: string | undefined;
}

/**
 * Task 1.5's "Övrig info från årsredovisningen" — mirrors AnalysRapport.tsx's
 * OvrigInfo section exactly (same fields, same "Framgår inte av
 * årsredovisningen" wording for an unaddressed fee item, same "no exact
 * page" note for an unreffed väsentlig händelse). `undefined` (not an empty
 * object) when there is nothing at all to show, so AnalysPdfDocument.tsx can
 * skip the whole section the same way the screen report hides it.
 */
export interface PdfOvrigInfo {
  antal: PdfOvrigInfoAntal[];
  avgiftPoster: PdfOvrigInfoAvgiftPost[];
  handelser: PdfOvrigInfoHandelse[];
  datakvalitetSkal: string[];
  /** Satt när årsredovisningen var skannad (datakvalitet.kalla). */
  skannadNotis: string | undefined;
}

export interface PdfViewModel {
  foreningNamn: string;
  skapadLabel: string;
  summary: PdfSummaryRow[];
  betyg: string;
  betygMotivering: string;
  rodaFlaggor: PdfRedFlag[];
  keyFigures: PdfKeyFigure[];
  ovrigInfo: PdfOvrigInfo | undefined;
  prisanalys: PdfPrisanalys;
  rantestress: PdfRantestress;
  fragor: PdfFraga[];
}

const SEVERITY_RANK: Record<Severity, number> = { hog: 0, medel: 1, lag: 2 };

/** All red flags, most severe first — same ranking as toppRodaFlaggor in
 *  analysisView.ts, but keeping every flag rather than just the top two:
 *  the free/teaser view truncates, the PDF (a paid artefact) should not. */
function allRedFlagsBySeverity(flaggor: AnalysisResult["rodaFlaggor"]): PdfRedFlag[] {
  return flaggor
    .map((flagga, index) => ({ flagga, index }))
    .sort((a, b) => {
      const diff = SEVERITY_RANK[a.flagga.severity] - SEVERITY_RANK[b.flagga.severity];
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map(({ flagga }) => ({
      id: flagga.id,
      titel: flagga.titel,
      beskrivning: flagga.beskrivning,
      severity: flagga.severity,
      severityLabel: SEVERITY_LABEL[flagga.severity],
      pageRef: formatPageRef(flagga.ref),
    }));
}

function buildSummary(analys: AnalysisResult): PdfSummaryRow[] {
  const { input } = analys;
  const adressLabel =
    input.adress !== ""
      ? `${input.adress}, ${input.ort}`
      : `Adressen raderad efter 12 månader · ${input.ort}`;
  return [
    { label: "Utgångspris", value: formatVarde(input.utgangspris, "kr") },
    { label: "Boarea", value: formatVarde(input.boarea, "m2") },
    { label: "Månadsavgift", value: `${formatVarde(input.manadsavgift, "kr")}/mån` },
    { label: "Antal rum", value: String(input.antalRum) },
    { label: "Våning", value: input.vaning !== undefined ? String(input.vaning) : "Okänt" },
    { label: "Byggår", value: input.byggar !== undefined ? String(input.byggar) : "Okänt" },
    { label: "Adress", value: adressLabel },
  ];
}

/** Same filter AnalysRapport's Foreningsekonomi section applies: only the
 *  key figures the product surfaces in the main analysis, and only when a
 *  status was actually judged (not 'okant'). */
function buildKeyFigures(analys: AnalysisResult): PdfKeyFigure[] {
  return analys.forening.keyFigures
    .filter((kf) => visasIHuvudanalys(kf.id) && kf.status !== "okant")
    .map((kf) => ({
      id: kf.id,
      label: kf.label,
      valueText: formatFigureVarde(kf.figure),
      status: kf.status,
      statusLabel: STATUS_LABEL[kf.status],
      benchmarkText: kf.benchmark
        ? `${kf.benchmark.label}: ${formatVarde(kf.benchmark.value, kf.figure.unit)}`
        : undefined,
      forklaring: kf.forklaring,
      pageRef: formatPageRef(kf.figure.ref),
      isSchablon: kf.figure.source === "schablon",
      osaker: kf.figure.osaker,
    }));
}

/** Mirrors AnalysRapport.tsx's Prisrimlighet-sektion, se dess filkommentar
 *  om varderingsunderlagets fält. */
function buildVarderingsunderlag(
  p: AnalysisResult["prisanalys"],
): PdfVarderingsunderlag | undefined {
  const u = p.varderingsunderlag;
  if (!u) return undefined;

  const intervallText =
    p.externVardering?.range !== undefined
      ? `Sannolikt mellan ${formatVarde(p.externVardering.range.low, "kr")} och ` +
        `${formatVarde(p.externVardering.range.high, "kr")} (${u.intervallTackningProcent} %)`
      : undefined;

  const tackning = varderingsTackningText(u);
  return {
    omradeText:
      u.omrade ??
      (tackning
        ? (u.kommun ?? u.prisniva?.region ?? "Okänt")
        : "Stockholm (postnumret saknas i vår områdesindelning)"),
    tackningTitel: tackning?.typ === "utanfor_lan" ? tackning.titel : undefined,
    disclaimerText: tackning?.typ === "utanfor_lan" ? tackning.text : undefined,
    metodText: tackning?.typ === "lan" ? tackning.text : undefined,
    intervallText,
    drivare: u.drivare.map((d) => ({
      label: formatDrivareLabel(d, u.omrade),
      effektProcentText: `${d.effektProcent >= 0 ? "+" : ""}${d.effektProcent.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} %`,
      positiv: d.effektProcent >= 0,
    })),
    dataBasisText:
      `Bygger på ${u.antalForsaljningar.toLocaleString("sv-SE")} försäljningar i Stockholm ` +
      `${formatDataperiod(u.dataperiod)} · typiskt fel ±${u.typisktFelProcent.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} % · modell ${u.modellVersion}`,
    attributionText: OMRADESINDELNING_ATTRIBUTION,
  };
}

function buildPrisanalys(analys: AnalysisResult): PdfPrisanalys {
  const p = analys.prisanalys;
  const skuld = andelAvSkuldRad(analys);
  const avvikelseText =
    p.avvikelseMotVardering !== undefined
      ? `Utgångspriset ligger ${Math.abs(p.avvikelseMotVardering).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} % ${
          p.avvikelseMotVardering > 0 ? "över" : "under"
        } (jämfört per m²)`
      : undefined;

  return {
    utgangspris: formatFigureVarde(p.utgangspris),
    prisPerM2: formatFigureVarde(p.prisPerM2),
    andelAvSkuld: skuld
      ? { text: skuld.text, pageRef: formatPageRef(skuld.ref), osaker: skuld.osaker }
      : undefined,
    externVardering: p.externVardering
      ? {
          value: formatFigureVarde(p.externVardering),
          leverantor: p.externVardering.leverantor,
          isSchablon: p.externVardering.source === "schablon",
        }
      : undefined,
    avvikelseText,
    varderingsunderlag: buildVarderingsunderlag(p),
    budpremieText: p.budpremie ? formatBudpremieText(p.budpremie) : undefined,
    slutsats: p.slutsats,
    konfidensNiva: KONFIDENS_LABEL[p.konfidens.niva],
    // Same condition AnalysRapport uses to show the "why" behind low confidence.
    konfidensSkal: p.konfidens.niva === "lag" ? (p.konfidens.skal ?? []) : [],
  };
}

/** Every scenario, not just the one a screen-only slider currently shows. */
function buildRantestress(analys: AnalysisResult): PdfRantestress {
  const r = analys.rantestress;
  return {
    nuvarandeManadsavgift: formatFigureVarde(r.nuvarandeManadsavgift),
    rader: [...r.scenarier]
      .sort((a, b) => a.okningPe - b.okningPe)
      .map((s) => ({
        okningPe: s.okningPe,
        nyManadsavgift: formatFigureVarde(s.nyManadsavgift),
        avgiftsokning: formatFigureVarde(s.avgiftsokningKrPerManad),
        ...(s.totalManadskostnad
          ? { totalManadskostnad: formatFigureVarde(s.totalManadskostnad) }
          : {}),
      })),
    kommentar: r.kommentar,
    ejBeraknbar: r.rantekanslighetProcent === null,
  };
}

/** Same subset AnalysRapport's Fragor section shows: questions derived from
 *  the analysis, not the auto-generated "we don't know X" ones. */
function buildFragor(analys: AnalysisResult): PdfFraga[] {
  return analys.fragor
    .filter((f) => f.ursprung === "analys")
    .map((f) => ({ id: f.id, fraga: f.fraga }));
}

const AVGIFT_LABEL: Record<keyof FeeInclusion, string> = {
  varme: "Värme",
  vatten: "Vatten",
  el: "El",
  bredband: "Bredband",
  tv: "Tv",
};

const AVGIFT_ORDNING: Array<keyof FeeInclusion> = ["varme", "vatten", "el", "bredband", "tv"];

/** 'okant' (or the whole field being absent) renders as "the report doesn't
 *  say" — never as "nej". Unknown is not false, per CLAUDE.md. Mirrors
 *  AnalysRapport.tsx's avgiftStatusText exactly. */
function avgiftStatusText(status: Tristate | undefined): string {
  if (status === "ja") return "Ingår";
  if (status === "nej") return "Ingår ej";
  return "Framgår inte av årsredovisningen";
}

/** Mirrors AnalysRapport.tsx's OvrigInfo section — see PdfOvrigInfo's doc
 *  comment. Returns undefined (not an empty object) when there is nothing
 *  at all to show. */
function buildOvrigInfo(analys: AnalysisResult): PdfOvrigInfo | undefined {
  const f = analys.forening;

  const antal = [
    { label: "Antal medlemmar", figure: f.antalMedlemmar },
    { label: "Antal lägenheter", figure: f.antalLagenheter },
    { label: "Varav hyresrätter", figure: f.antalHyresratter },
    { label: "Antal lokaler", figure: f.antalLokaler },
  ]
    .filter(
      (p): p is { label: string; figure: NonNullable<typeof p.figure> } => p.figure !== undefined,
    )
    .map((p) => ({
      label: p.label,
      valueText: formatFigureVarde(p.figure),
      pageRef: formatPageRef(p.figure.ref),
      osaker: p.figure.osaker,
    }));

  const visaAvgiftPoster = f.avgiftInkluderarEnligtForening !== undefined;
  const avgiftPoster: PdfOvrigInfoAvgiftPost[] = visaAvgiftPoster
    ? AVGIFT_ORDNING.map((post) => {
        const matning =
          post === "bredband" || post === "tv" ? undefined : f.individuellMatning?.[post];
        return {
          post,
          label: AVGIFT_LABEL[post],
          statusText: avgiftStatusText(f.avgiftInkluderarEnligtForening?.[post]),
          matningText: matning
            ? matning.matning === "ja"
              ? "Individuell mätning"
              : "Ingen individuell mätning"
            : undefined,
          pageRef: formatPageRef(f.avgiftInkluderarKallor?.[post]),
        };
      })
    : [];

  const handelser: PdfOvrigInfoHandelse[] = (f.vasentligaHandelser ?? []).map((h) => ({
    text: h.text,
    pageRef: formatPageRef(h.ref),
  }));

  const datakvalitetSkal = analys.datakvalitet.extraktionKonfidens.skal ?? [];

  const skannad = arSkannad(analys);

  const harNagot =
    antal.length > 0 ||
    avgiftPoster.length > 0 ||
    handelser.length > 0 ||
    datakvalitetSkal.length > 0 ||
    skannad;
  if (!harNagot) return undefined;

  return {
    antal,
    avgiftPoster,
    handelser,
    datakvalitetSkal,
    skannadNotis: skannad ? SKANNAD_NOTIS : undefined,
  };
}

export function buildPdfViewModel(analys: AnalysisResult): PdfViewModel {
  return {
    foreningNamn: analys.forening.namn,
    skapadLabel: formatSkapadDatum(analys.skapad),
    summary: buildSummary(analys),
    betyg: analys.betyg,
    betygMotivering: analys.betygMotivering,
    rodaFlaggor: allRedFlagsBySeverity(analys.rodaFlaggor),
    keyFigures: buildKeyFigures(analys),
    ovrigInfo: buildOvrigInfo(analys),
    prisanalys: buildPrisanalys(analys),
    rantestress: buildRantestress(analys),
    fragor: buildFragor(analys),
  };
}
