/**
 * Pure data mapping from AnalysisResult to the PDF's content — no react-pdf
 * import here on purpose, so this stays trivially unit-testable and mirrors
 * exactly the sections AnalysRapport.tsx renders on screen (same filters,
 * same ordering), per the task brief: "everything AnalysRapport renders,
 * flattened". AnalysPdfDocument.tsx turns this into JSX; it should not need
 * to re-decide what belongs on the report.
 */
import { visasIHuvudanalys } from "@/lib/analysis/benchmarks";
import { formatFigureVarde, formatSkapadDatum, formatVarde } from "@/lib/analysisView";
import type { AnalysisResult, PageRef, Severity, Status } from "@/types/analysis";

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
  rader: PdfRantestressRad[];
  kommentar: string;
}

export interface PdfFraga {
  id: string;
  fraga: string;
}

export interface PdfViewModel {
  foreningNamn: string;
  skapadLabel: string;
  summary: PdfSummaryRow[];
  betyg: string;
  betygMotivering: string;
  rodaFlaggor: PdfRedFlag[];
  keyFigures: PdfKeyFigure[];
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
      : `Adressen raderad efter 30 dagar · ${input.ort}`;
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
    }));
}

function buildPrisanalys(analys: AnalysisResult): PdfPrisanalys {
  const p = analys.prisanalys;
  const avvikelseText =
    p.avvikelseMotVardering !== undefined
      ? `Utgångspriset ligger ${Math.abs(p.avvikelseMotVardering).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} % ${
          p.avvikelseMotVardering > 0 ? "över" : "under"
        } (jämfört per m²)`
      : undefined;

  return {
    utgangspris: formatFigureVarde(p.utgangspris),
    prisPerM2: formatFigureVarde(p.prisPerM2),
    externVardering: p.externVardering
      ? {
          value: formatFigureVarde(p.externVardering),
          leverantor: p.externVardering.leverantor,
          isSchablon: p.externVardering.source === "schablon",
        }
      : undefined,
    avvikelseText,
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
  };
}

/** Same subset AnalysRapport's Fragor section shows: questions derived from
 *  the analysis, not the auto-generated "we don't know X" ones. */
function buildFragor(analys: AnalysisResult): PdfFraga[] {
  return analys.fragor
    .filter((f) => f.ursprung === "analys")
    .map((f) => ({ id: f.id, fraga: f.fraga }));
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
    prisanalys: buildPrisanalys(analys),
    rantestress: buildRantestress(analys),
    fragor: buildFragor(analys),
  };
}
