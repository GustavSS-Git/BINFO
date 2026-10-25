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
  byggarMarkor,
  antagenAndelText,
  arSkannad,
  avgiftsHuvud,
  avvikelseJusteradText,
  BYGGDEL_KALLA_TEXT,
  byggdelNot,
  byggdelRader,
  komponentKalla,
  lanRader,
  PRIS_LABEL_JUSTERAD,
  byggarPrisNotis,
  RANTEKANSLIGHET_RAD,
  referensrantaRad,
  REFI_FASTRAD,
  sparKedja,
  sparKomponent,
  refiKomponent,
  tonForTryck,
  TRYCK_ETIKETT,
  vattenfall,
  type Ton,
  ENERGI_TEXT,
  formatForandringKr,
  komponentRader,
  prisEffektTexter,
  PRISEFFEKT_CAVEAT,
  RAKNA_FAKTORER,
  RAKNA_UTGANGSLAGE_INTRO,
  refinansieringRader,
  formatBudpremieText,
  formatFigureVarde,
  formatSkapadDatum,
  formatVarde,
  SKANNAD_NOTIS,
  varderingsKallaText,
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

export interface PdfVarderingsunderlag {
  omradeText: string;
  /** 'utanfor_lan' only: rendered first in the section, above the estimate. */
  tackningTitel: string | undefined;
  disclaimerText: string | undefined;
  /** 'lan' only: method note shown with the data basis. */
  metodText: string | undefined;
  intervallText: string | undefined;
  metadataText: string;
  kallaText: string;
}

/** Raden "Lägenhetens ungefärliga andel av föreningens lån" (bara full analys). */
export interface PdfAndelAvSkuld {
  text: string;
  pageRef: string | undefined;
  osaker: string | undefined;
}

export interface PdfPrisanalys {
  /** Samma rubrik som webben: "Är priset rimligt?" med pris, annars "Binfos värdering". */
  titel: string;
  /** Båda undefined när köparen inte angett något utgångspris (raderna utelämnas). */
  utgangspris: string | undefined;
  prisPerM2: string | undefined;
  externVardering:
    | {
        value: string;
        leverantor: string;
        isSchablon: boolean;
      }
    | undefined;
  avvikelseText: string | undefined;
  /** Second price row; when present, avvikelseText is moved to it. */
  justeradVardering: PdfJusteradVardering | undefined;
  /** Present only when externVardering kom från Binfos värderingsmodell —
   *  se Prisanalys.varderingsunderlag i src/types/analysis.ts. */
  varderingsunderlag: PdfVarderingsunderlag | undefined;
  /** Kommentar under värderingen; ingår inte i värderingen. Saknas när
   *  föreningens skuld per m² inte gick att läsa ut. */
  andelAvSkuld: PdfAndelAvSkuld | undefined;
  /** Task 5: hur mycket bostäder i området sålts över/under utgångspriset. */
  budpremieText: string | undefined;
  /** Vilket byggår värderingen räknat med, när det inte är det köparen angav. */
  byggarNotis: string | undefined;
  slutsats: string;
  konfidensNiva: string;
  konfidensSkal: string[];
}

/** Andra prisraden (bara när servern räknat fram en justerad värdering). */
export interface PdfJusteradVardering {
  label: string;
  value: string;
  avvikelseText: string | undefined;
  /** Baslinje -> komponenternas prisbidrag -> justerat värde (tomt utan prognos). */
  vattenfall: Array<{ label: string; beloppText: string; ton: Ton; typ: "bas" | "steg" | "slut" }>;
}

/** "Så har vi räknat", alltid helt uppfälld i PDF:en. */
export interface PdfRakning {
  utgangslage: { intro: string; faktorer: string[] } | undefined;
  prognos:
    | {
        rubrik: string;
        /** Stora talet och raden under ("+500 kr/mån", "inom 24 månader"). */
        huvud: { varde: string; under: string; ton: Ton };
        komponenter: Array<{
          label: string;
          vardeText: string;
          forklaring: string;
          pageRef: string | undefined;
          ton: Ton | undefined;
          kalla: string | undefined;
          /** Visas i listan "övriga"; spar- och lånesteg har egna block. */
          ovrig: boolean;
        }>;
        spar:
          | {
              steg: Array<{
                rubrik: string;
                varde: string;
                kalla: string | undefined;
                ton: Ton | undefined;
              }>;
              dampningTag: string | undefined;
              byggdelar: Array<{
                label: string;
                senast: string;
                livslangd: string;
                status: string;
                ton: Ton;
                pageRef: string | undefined;
              }>;
              byggdelNot: string;
              byggdelKalla: string;
            }
          | undefined;
        lan:
          | {
              rader: Array<{
                forfaller: string;
                belopp: string;
                ranta: string;
                fas: string;
                effekt: string;
                effektForening: string | undefined;
              }>;
              varde: string | undefined;
              ton: Ton;
              fastrad: string | undefined;
              referens: string;
            }
          | undefined;
        rantekanslighetRad: string;
        osaker: string | undefined;
        energiText: string;
        prisTexter: string[];
        prisCaveat: string | undefined;
        refinansiering:
          | { rader: Array<{ label: string; value: string }>; antagenAndel: string | undefined }
          | undefined;
      }
    | undefined;
}

export interface PdfPrognosTabell {
  rader: Array<{ label: string; manadsavgift: string; forandring: string }>;
  kommentar: string;
}

export interface PdfSammanfattning {
  stycken: string[];
  /** Färgmärkning av avgiftsstycket (index 2), när prognosen har tryck. */
  avgiftTryck: { etikett: string; ton: Ton } | undefined;
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
  /** Present for new reports: replaces the stress table (today / expected / +1 / +2 pp). */
  prognosTabell: PdfPrognosTabell | undefined;
}

export interface PdfFraga {
  id: string;
  fraga: string;
  /** "Varför: …" text, shown under the question. */
  varfor: string;
  /** Display line for "Bra svar / varningssignal"; absent when the question has none. */
  svarssignal?: string;
}

/** The model and the deterministic questions already write "Bra svar: … Varningssignal: …";
 *  then the line is its own label. Free text gets the label put in front. */
function svarssignalMedRubrik(text: string): string {
  const t = text.trim();
  return /^(bra svar|varningssignal):/i.test(t) ? t : `Bra svar / varningssignal: ${t}`;
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
  rakning: PdfRakning | undefined;
  sammanfattning: PdfSammanfattning | undefined;
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
  const byggar = byggarMarkor(
    analys.uppgiftsjamforelse?.find((r) => r.falt === "byggar"),
    input.byggar,
  );
  const byggarText = byggar.pdfNotis ? `${byggar.varde} (${byggar.pdfNotis})` : byggar.varde;
  const adressLabel =
    input.adress !== ""
      ? `${input.adress}, ${input.ort}`
      : `Adressen raderad efter 12 månader · ${input.ort}`;
  return [
    ...(input.utgangspris !== undefined
      ? [{ label: "Utgångspris", value: formatVarde(input.utgangspris, "kr") }]
      : []),
    { label: "Boarea", value: formatVarde(input.boarea, "m2") },
    { label: "Månadsavgift", value: `${formatVarde(input.manadsavgift, "kr")}/mån` },
    { label: "Antal rum", value: String(input.antalRum) },
    { label: "Våning", value: input.vaning !== undefined ? String(input.vaning) : "Okänt" },
    { label: "Byggår", value: byggarText },
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

  // The valuation range is not shown (owner: hidden on the web since
  // 2026-10-09, "we don't show the range any more" 2026-10-24), in the PDF either.
  const intervallText: string | undefined = undefined;

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
    metadataText: `${u.antalForsaljningar.toLocaleString("sv-SE")} försäljningar · typiskt fel ±${u.typisktFelProcent.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} % · modell ${u.modellVersion}`,
    kallaText: varderingsKallaText(u.dataperiod),
  };
}

function byggarNotisText(analys: AnalysisResult): string | undefined {
  const n = byggarPrisNotis(analys.uppgiftsjamforelse?.find((r) => r.falt === "byggar"));
  if (!n) return undefined;
  return n.sida ? `${n.text.replace(/\.$/, "")} (${n.sida}).` : n.text;
}

function buildPrisanalys(analys: AnalysisResult): PdfPrisanalys {
  const p = analys.prisanalys;
  const skuld = andelAvSkuldRad(analys);
  const avvikelseText =
    p.avvikelseMotVardering !== undefined && p.justeradVardering === undefined
      ? `Utgångspriset ligger ${Math.abs(p.avvikelseMotVardering).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} % ${
          p.avvikelseMotVardering > 0 ? "över" : "under"
        } (jämfört per m²)`
      : undefined;

  return {
    titel: p.utgangspris ? "Är priset rimligt?" : "Binfos värdering",
    utgangspris: p.utgangspris ? formatFigureVarde(p.utgangspris) : undefined,
    prisPerM2: p.prisPerM2 ? formatFigureVarde(p.prisPerM2) : undefined,
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
    justeradVardering: p.justeradVardering
      ? {
          label: PRIS_LABEL_JUSTERAD,
          vattenfall: analys.avgiftsprognos
            ? (vattenfall(p, analys.avgiftsprognos)?.rader ?? []).map((r) => ({
                label: r.label,
                beloppText: r.beloppText,
                ton: r.ton,
                typ: r.typ,
              }))
            : [],
          value: formatFigureVarde(p.justeradVardering),
          avvikelseText:
            p.avvikelseMotJusteradVardering !== undefined
              ? avvikelseJusteradText(p.avvikelseMotJusteradVardering)
              : undefined,
        }
      : undefined,
    varderingsunderlag: buildVarderingsunderlag(p),
    budpremieText: p.budpremie ? formatBudpremieText(p.budpremie) : undefined,
    byggarNotis: byggarNotisText(analys),
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
    prognosTabell: r.prognosTabell
      ? {
          rader: r.prognosTabell.rader.map((rad) => ({
            label: rad.label,
            manadsavgift: Math.round(rad.manadsavgift).toLocaleString("sv-SE"),
            forandring: rad.id === "idag" ? "–" : formatForandringKr(rad.forandringKr),
          })),
          kommentar: r.prognosTabell.kommentar,
        }
      : undefined,
  };
}

/** Same subset AnalysRapport's Fragor section shows: questions derived from
 *  the analysis, not the auto-generated "we don't know X" ones. */
function buildFragor(analys: AnalysisResult): PdfFraga[] {
  return analys.fragor
    .filter((f) => f.ursprung === "analys")
    .map((f) => ({
      id: f.id,
      fraga: f.fraga,
      varfor: f.varfor,
      ...(f.svarssignal?.trim() ? { svarssignal: svarssignalMedRubrik(f.svarssignal) } : {}),
    }));
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

function buildRakning(analys: AnalysisResult): PdfRakning | undefined {
  const u = analys.prisanalys.varderingsunderlag;
  const pg = analys.avgiftsprognos;
  if (!u && !pg) return undefined;
  const refi = pg?.refinansiering;
  const kedja = pg ? sparKedja(pg, analys.prisanalys) : undefined;
  const sparK = pg ? sparKomponent(pg) : undefined;
  const refiK = pg ? refiKomponent(pg) : undefined;
  const refiRad = pg && refiK ? komponentRader({ ...pg, komponenter: [refiK] })[0] : undefined;
  return {
    utgangslage: u ? { intro: RAKNA_UTGANGSLAGE_INTRO, faktorer: RAKNA_FAKTORER } : undefined,
    prognos: pg
      ? (() => {
          const huvud = avgiftsHuvud(pg);
          const harSpar = kedja !== undefined && sparK !== undefined;
          const harLan = (refi?.lan ?? []).length > 0;
          return {
            rubrik: huvud.varde,
            huvud: { ...huvud, ton: tonForTryck(pg.tryck) },
            komponenter: komponentRader(pg).map((k) => {
              const komp = pg.komponenter.find((x) => x.id === k.id);
              return {
                label: k.label,
                vardeText: k.vardeText,
                forklaring: k.forklaring,
                pageRef: formatPageRef(k.ref),
                ton: komp?.tryck ? tonForTryck(komp.tryck) : undefined,
                kalla: komp ? komponentKalla(komp)?.text : undefined,
                ovrig: !(harSpar && k.id === sparK?.id) && !(harLan && k.id === refiK?.id),
              };
            }),
            spar: kedja
              ? {
                  steg: kedja.steg.map((k) => ({
                    rubrik: k.rubrik,
                    varde: k.varde,
                    kalla: k.kalla,
                    ton: k.ton,
                  })),
                  dampningTag: kedja.dampningTag,
                  byggdelar: byggdelRader(pg.sparbehov ?? {}).map((b) => ({
                    label: b.label,
                    senast: b.senast,
                    livslangd: b.livslangd,
                    status: b.statusEtikett,
                    ton: b.ton,
                    pageRef: formatPageRef(b.ref),
                  })),
                  byggdelNot: byggdelNot(),
                  byggdelKalla: BYGGDEL_KALLA_TEXT,
                }
              : undefined,
            lan:
              refi && harLan
                ? {
                    rader: lanRader(refi, pg.horisontManader, pg.andel?.varde).map((l) => ({
                      forfaller: l.forfaller,
                      belopp: l.belopp,
                      ranta: l.ranta,
                      fas: l.fas,
                      effekt: l.effekt,
                      effektForening: l.effektForening,
                    })),
                    varde: refiRad?.vardeText,
                    ton: tonForTryck(refiK?.tryck),
                    fastrad: lanRader(refi, pg.horisontManader, pg.andel?.varde).some(
                      (l) => l.senare,
                    )
                      ? REFI_FASTRAD
                      : undefined,
                    referens: referensrantaRad(refi),
                  }
                : undefined,
            rantekanslighetRad: RANTEKANSLIGHET_RAD,
            osaker: pg.osaker,
            energiText: ENERGI_TEXT,
            prisTexter: prisEffektTexter(analys.prisanalys),
            prisCaveat:
              (analys.prisanalys.justeringar ?? []).length > 0 ? PRISEFFEKT_CAVEAT : undefined,
            refinansiering: refi
              ? { rader: refinansieringRader(refi), antagenAndel: antagenAndelText(refi) }
              : undefined,
          };
        })()
      : undefined,
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
    rakning: buildRakning(analys),
    sammanfattning: analys.sammanfattning
      ? {
          stycken: [
            analys.sammanfattning.betyg,
            analys.sammanfattning.pris,
            analys.sammanfattning.avgift,
            analys.sammanfattning.slutsats,
          ],
          avgiftTryck: analys.avgiftsprognos?.tryck
            ? {
                etikett: TRYCK_ETIKETT[analys.avgiftsprognos.tryck],
                ton: tonForTryck(analys.avgiftsprognos.tryck),
              }
            : undefined,
        }
      : undefined,
  };
}
