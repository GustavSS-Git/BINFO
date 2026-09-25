/**
 * Binfo — analysis contract.
 *
 * THE SINGLE SOURCE OF TRUTH for the shape of an analysis result.
 * Frontend renders this. Backend produces this. Nothing else defines it.
 *
 * Changing this file breaks both sides simultaneously. Treat edits as
 * deliberate schema migrations, not incidental refactors.
 *
 * Design principles, in order of importance:
 *   1. Unknown is not false.       -> Tristate, never boolean | null
 *   2. A guess never looks like a fact. -> every figure carries a ValueSource
 *   3. No number without a citation.    -> extracted figures carry PageRef
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Three-state answer. `okant` is the default for anything the user has not
 *  explicitly answered. It must survive all the way into the analysis, because
 *  "no balcony" and "we don't know about a balcony" price differently. */
export type Tristate = 'ja' | 'nej' | 'okant';

/** Where a number came from. Drives how it renders and how much it is trusted. */
export type ValueSource =
  | 'arsredovisning' // extracted from the annual report — authoritative
  | 'anvandare'      // typed in by the user — authoritative
  | 'berakning'      // derived from other authoritative values
  | 'schablon'       // system estimate — MUST render visually distinct
  | 'extern';        // third-party data (valuation, comparable sales)

/** Location in the source PDF. Required for anything extracted, so the user
 *  can verify the figure themselves. An uncited number is not shippable. */
export interface PageRef {
  page: number;
  /** Short verbatim snippet the figure was read from, for the "show me where"
   *  affordance. Keep under ~15 words. */
  excerpt?: string;
}

/** A number plus everything needed to display and trust it. */
export interface Figure {
  value: number | null;
  unit: 'kr' | 'kr/man' | 'kr/m2' | 'kr/m2/ar' | 'procent' | 'm2' | 'ar' | 'antal' | 'gånger';
  source: ValueSource;
  ref?: PageRef;
  /** Set when source is 'schablon' — how the estimate was produced, shown on hover. */
  schablonBasis?: string;
  /** Plausible range when the value is uncertain. Frontend renders a span. */
  range?: { low: number; high: number };
  /**
   * Sign known even when the amount is not — e.g. the report prints "neg" or
   * "negativ" for sparande. `value` is then null, but the figure is NOT
   * unknown: grading uses the sign. Only set from the report's own text.
   */
  tecken?: 'negativ' | 'positiv';
  /** The value exactly as printed in the report when it was not a plain number (e.g. "neg"). */
  tryckt?: string;
}

export type Status = 'god' | 'acceptabel' | 'svag' | 'kritisk' | 'okant';

/** Overall grade. Deliberately coarse — false precision is worse than none. */
export type Grade = 'A' | 'B' | 'C' | 'D' | 'E';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type PropertyKind = 'bostadsratt' | 'hus';

/** Whether a cost is covered by the monthly fee. Drives the cost model:
 *  `okant` forces the total to render as a range rather than a point. */
export interface FeeInclusion {
  varme: Tristate;
  vatten: Tristate;
  el: Tristate;
  bredband: Tristate;
  tv: Tristate;
}

export interface PropertyInput {
  kind: PropertyKind;

  // Required
  utgangspris: number;
  boarea: number;
  antalRum: number;
  manadsavgift: number;
  /** Percent, e.g. 2.1 */
  andelstal: number;

  // Cooperative identity — required to fetch benchmarks and comparable sales
  // within the same cooperative. Without orgnr the price layer cannot run.
  orgnr: string; // XXXXXX-XXXX
  adress: string;
  postnummer: string;
  ort: string;

  // Optional attributes — Tristate because unknown widens the model's
  // uncertainty rather than being read as absence
  vaning?: number;
  byggar?: number;
  hiss: Tristate;
  balkong: Tristate;

  avgiftInkluderar: FeeInclusion;

  // Household — needed for the cost model's water schablon. Loan-specific
  // household data (antalLantagare, for the ränteavdrag cap) lives on
  // LaneUnderlag instead — see src/lib/analysis/calc/manadskostnad.ts. It is
  // a property of the borrower's loan, not of the apartment, and the
  // client-side mortgage calculator collects it independently of this
  // contract (see the Manadskostnad doc comment below).
  antalPersoner: number;
}

// ---------------------------------------------------------------------------
// The seven statutory key figures (BFNAR 2023:1, mandatory from FY2023)
// ---------------------------------------------------------------------------

export type KeyFigureId =
  | 'arsavgift_per_m2_brf_yta'
  | 'arsavgift_andel_av_rorelseintakter'
  | 'skuldsattning_per_m2_totalyta'
  | 'skuldsattning_per_m2_brf_yta'
  | 'sparande_per_m2_totalyta'
  | 'rantekanslighet'
  | 'energikostnad_per_m2_totalyta';

export interface KeyFigure {
  id: KeyFigureId;
  /** Swedish label as it appears to the user. */
  label: string;
  figure: Figure;
  status: Status;
  /** Population value this was judged against. Must cite its own origin. */
  benchmark?: { value: number; label: string; source: string };
  /** One sentence, plain Swedish, no jargon. What this means for the buyer. */
  forklaring: string;
}

/**
 * Räntekänslighet is the load-bearing figure: interest-bearing debt divided by
 * annual fee income, i.e. the percent by which fees must rise per percentage
 * point of rate increase. The stress test consumes this directly — do not
 * model it separately.
 */
export interface Forening {
  namn: string;
  orgnr: string;
  akta: Tristate;                 // äkta vs oäkta — tax consequences for the buyer
  byggar?: Figure;
  antalLagenheter?: Figure;
  totalyta?: Figure;
  rakenskapsar: number;           // which financial year the report covers
  keyFigures: KeyFigure[];        // all seven, even when value is null

  /** What the annual report itself states is covered by the fee, per item.
   *  `okant` when the report doesn't address that item. This is the
   *  report-stated default — PropertyInput.avgiftInkluderar is the
   *  effective value used by calculations, pre-filled from this at
   *  orchestration time and user-overridable from there. Keeping both
   *  means the frontend can always show "enligt rapporten" next to the
   *  user's (possibly overridden) answer, never silently replacing one
   *  with the other. */
  avgiftInkluderarEnligtForening?: FeeInclusion;
  /** Where the report states each item of avgiftInkluderarEnligtForening
   *  (only for items it actually addresses — an 'okant' item has no ref). */
  avgiftInkluderarKallor?: Partial<Record<keyof FeeInclusion, PageRef>>;
  /** Individual metering (IMD) per consumption item, only where the report
   *  says so ('ja'/'nej'); absent = the report doesn't address it. */
  individuellMatning?: Partial<Record<'el' | 'vatten' | 'varme', { matning: Tristate; ref: PageRef }>>;

  /** Counts the report states, each cited like any other extracted figure. */
  antalMedlemmar?: Figure;
  antalHyresratter?: Figure;
  antalLokaler?: Figure;

  lanebok?: {
    totalSkuld: Figure;
    /** Maturity ladder — how much reprices when. Drives stress realism. */
    forfalloprofil?: Array<{ ar: number; belopp: Figure; ranta?: Figure }>;
    snittranta?: Figure;
  };

  underhallsplan?: {
    finns: Tristate;
    senastUppdaterad?: number;
    /** Each planned action cited on its own — a single shared ref on the
     *  whole underhållsplan can't correctly cite items that come from
     *  different pages (e.g. the plan's update date vs. a specific
     *  planned stambyte mentioned elsewhere in the report). `ref` is
     *  optional per item: when the model can't pin an exact page for a
     *  specific action, the item still ships rather than being dropped —
     *  the frontend renders an unreffed item distinctly, the same way it
     *  already must for a `schablon` figure. Absence of ref IS the flag;
     *  no separate "unverified" field. */
    kommandeAtgarder?: Array<{ text: string; ref?: PageRef }>;
    /** Cites the general underhållsplan statement (e.g. "uppdaterad 2024") —
     *  separate from each action's own ref above. */
    ref?: PageRef;
  };

  /** "Väsentliga händelser" and anything after the balance sheet date. Often
   *  where the real risk is disclosed in prose rather than in the figures.
   *  ref is optional for the same reason as kommandeAtgarder above — an
   *  event the model can't precisely cite still ships, flagged by the
   *  missing ref, rather than being silently dropped. */
  vasentligaHandelser?: Array<{ text: string; ref?: PageRef }>;
}

// ---------------------------------------------------------------------------
// Analysis layers 2–4 (the differentiated product)
// ---------------------------------------------------------------------------

export type Severity = 'hog' | 'medel' | 'lag';

export interface RedFlag {
  id: string;
  titel: string;
  /** Plain Swedish. What is wrong and what it costs the buyer. */
  beskrivning: string;
  severity: Severity;
  ref?: PageRef;
  /** Key figures this was derived from — lets the UI link flag to evidence. */
  harledsFran: KeyFigureId[];
}

/** Layer 2 — price context. Reconciles asking price against independent
 *  reference points. Never produces its own valuation model. */
export interface Prisanalys {
  utgangspris: Figure;
  prisPerM2: Figure;
  /** Third-party valuation (e.g. Booli). Always attributed, never re-derived. */
  externVardering?: Figure & { leverantor: string };
  /** Sales within the same cooperative — a much tighter comparison than
   *  "similar objects in the area". */
  senasteForsaljningarIForeningen?: Array<{
    datum: string;
    pris: Figure;
    boarea: number;
    prisPerM2: Figure;
  }>;
  omradeMedianPrisPerM2?: Figure;
  /** Signed percent: positive means asking above reference. */
  avvikelseMotVardering?: number;
  avvikelseMotForeningen?: number;
  /** One or two sentences. States the gap and whether it looks justified. */
  slutsats: string;
  konfidens: Konfidens;
  /** What Binfo's own valuation model rests on. Present only when
   *  externVardering comes from that model (source 'schablon', range = the
   *  prediction interval). */
  varderingsunderlag?: Varderingsunderlag;
  /** How far above/below utgångspris comparable homes have sold. */
  budpremie?: Budpremie;
}

/** A calendar period, ISO dates (YYYY-MM-DD). */
export interface Dataperiod {
  fran: string;
  till: string;
}

export interface Varderingsdrivare {
  /** Plain Swedish, e.g. "Ingen hiss". */
  label: string;
  /** Average effect on price, all else equal, in percent (signed). */
  effektProcent: number;
  /** 95 % confidence interval of the effect, in percent. */
  intervallProcent: { low: number; high: number };
  /** 'omrade' only where the data supports an area-specific effect. */
  niva: 'stad' | 'omrade';
}

export interface Varderingsunderlag {
  modellVersion: string;
  /** The area the postnummer maps to; null = no match, Stockholm-wide model. */
  omrade: string | null;
  /** Nominal coverage of externVardering.range, percent (e.g. 90). */
  intervallTackningProcent: number;
  /** Price level the estimate represents (the training period). */
  dataperiod: Dataperiod;
  /** Number of sales the model was trained on. */
  antalForsaljningar: number;
  /** Typical error (MAPE, percent) for this area, or overall. */
  typisktFelProcent: number;
  /** Average effects relevant to this apartment's attributes. */
  drivare: Varderingsdrivare[];
}

export interface Budpremie {
  /** The area the statistic describes; null = Stockholm average (fallback). */
  omrade: string | null;
  /** Signed percent: positive means sold above utgångspris. */
  medianProcent: number;
  medelProcent: number;
  n: number;
  dataperiod: Dataperiod;
}

/** Layer 3 — forward risk, expressed in kronor per month for THIS apartment,
 *  not as an abstract percentage. */
export interface RantestressScenario {
  /** Percentage points added to the current rate. */
  okningPe: 0 | 1 | 2 | 3;
  nyManadsavgift: Figure;
  avgiftsokningKrPerManad: Figure;
  /** Total monthly cost including the mortgage, if loan details were supplied. */
  totalManadskostnad?: Figure;
}

export interface Rantestress {
  /** The statutory key figure this is built on. */
  rantekanslighetProcent: number;
  nuvarandeManadsavgift: Figure;
  scenarier: RantestressScenario[];
  kommentar: string;
}

// ---------------------------------------------------------------------------
// Monthly cost model
// ---------------------------------------------------------------------------

export type CostItemId =
  | 'rantekostnad'
  | 'amortering'
  | 'ranteavdrag'      // negative
  | 'manadsavgift'
  | 'hushallsel'
  | 'varme'
  | 'vatten'
  | 'bredband'
  | 'hemforsakring';

export interface CostItem {
  id: CostItemId;
  label: string;
  figure: Figure;      // source 'schablon' renders visually distinct
  /** True when the user overrode the schablon with their own figure. */
  overriddenByUser: boolean;
  /** True when this item is excluded because the fee covers it. */
  ingarIAvgift: boolean;
}

/**
 * Amortisation, per the rules in force since 1 April 2026:
 *   LTV > 70% -> 2%/yr, 50–70% -> 1%/yr, < 50% -> none.
 *   The skuldkvot-based extra 1% is ABOLISHED. Max statutory rate is 2%.
 *   Skuldkvot is retained as information only — banks apply internal limits
 *   (typically 5–6x) but it must never drive `tillampadAmorteringstakt`.
 */
export interface Amorteringsunderlag {
  belaningsgrad: number;              // percent
  skuldkvot: number;                  // loan / gross annual income
  tillampadAmorteringstakt: 0 | 1 | 2; // percent per year — never 3
  /** Set when skuldkvot exceeds typical bank internal limits. Informational. */
  overBankernasTypiskaTak: boolean;
}

/**
 * The monthly cost model. NOT part of AnalysisResult — since Phase 1 Step 0,
 * loan data is never sent to the server or persisted, so this is computed
 * entirely client-side by the standalone /bolanekalkyl calculator
 * (src/lib/analysis/calc/manadskostnad.ts's beraknaManadskostnad), ephemeral
 * to the buyer's browser session. The type (and its Zod mirror,
 * ManadskostnadSchema) is kept because the calculator and its tests still
 * need the shape — only the field that once lived on AnalysisResult is gone.
 */
export interface Manadskostnad {
  poster: CostItem[];
  /** Before interest deduction. */
  totalBrutto: Figure;
  /** After interest deduction — the headline number. */
  totalNetto: Figure;
  /** Present when any FeeInclusion is 'okant'. Frontend shows a span. */
  totalSpann?: { low: number; high: number };
  amortering: Amorteringsunderlag;
  /** 30% up to SEK 100k of interest per person per year, 21% above. */
  ranteavdragPerAr: Figure;
}

// ---------------------------------------------------------------------------
// Layer 4 — action
// ---------------------------------------------------------------------------

export interface Fraga {
  id: string;
  fraga: string;
  /** 'analys' = derived from something concerning in the accounts.
   *  'saknad_uppgift' = auto-generated from a Tristate left at 'okant'.
   *  These render in separate groups. */
  ursprung: 'analys' | 'saknad_uppgift';
  riktadTill: 'styrelsen' | 'maklaren' | 'banken';
  varfor: string;
  ref?: PageRef;
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

export interface Konfidens {
  niva: 'hog' | 'medel' | 'lag';
  /** Why confidence is reduced. Shown to the user verbatim. */
  skal?: string[];
}

export interface Datakvalitet {
  uppgifterKanda: number;
  uppgifterTotalt: number;
  /** Field names still at 'okant' — the UI scrolls to these. */
  saknadeFalt: string[];
  /** True when the PDF had no text layer (scanned). Must fail loudly, never
   *  silently return an empty analysis. */
  pdfSaknarTextlager: boolean;
  extraktionKonfidens: Konfidens;
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export interface AnalysisResult {
  /** Bump on any breaking change to this contract. */
  schemaVersion: '1.0.0';
  analysisId: string;
  skapad: string; // ISO 8601

  input: PropertyInput;
  forening: Forening;

  betyg: Grade;
  betygMotivering: string;

  rodaFlaggor: RedFlag[];
  prisanalys: Prisanalys;
  rantestress: Rantestress;
  fragor: Fraga[];

  datakvalitet: Datakvalitet;

  /** Which parts are visible before payment. Everything else is blurred.
   *  The free tier must be genuinely useful and visibly incomplete. */
  gratisSektioner: Array<'betyg' | 'rodaFlaggor_topp2' | 'datakvalitet'>;
}

/**
 * The narrow, preview-only projection of AnalysisResult that
 * `hamtaForhandsvisning` (src/server/analys.ts) hands to `/forhandsvisning`.
 *
 * Carries EXACTLY the sections `gratisSektioner` already names as free
 * ('betyg', 'rodaFlaggor_topp2', 'datakvalitet'), plus the minimum identity
 * the preview screen needs to render a heading. It exists so gating can be
 * server-side from day one (the paywall is deferred, not removed): even
 * while everything is free, the preview route never reads
 * from the same full-object endpoint as the paid report, so turning payment
 * on later means adding a check to `/analys/$id`'s loader, not re-plumbing
 * `/forhandsvisning`'s data source.
 *
 * MUST NEVER grow to include a priced section — `prisanalys`, `rantestress`,
 * `fragor`, the full `forening`, `input`, or all of `rodaFlaggor`. Widening
 * this interface is a pricing decision, not a type convenience: it is the
 * one change that would silently hand out paid content through the "free"
 * path. If a task seems to want more fields here, stop and ask first.
 */
export interface Forhandsvisning {
  schemaVersion: AnalysisResult["schemaVersion"];
  analysisId: string;
  skapad: string; // ISO 8601

  forening: Pick<Forening, "namn">;

  betyg: Grade;
  betygMotivering: string;

  /** At most two — the highest-severity flags, never the full list. */
  rodaFlaggor: RedFlag[];

  datakvalitet: Datakvalitet;

  gratisSektioner: AnalysisResult["gratisSektioner"];
}

/** Extraction output only — the raw read of the PDF, before any judgement is
 *  applied. Keeping this separate is what makes extraction independently
 *  testable against a manual answer key. */
export interface ExtractionResult {
  schemaVersion: '1.0.0';
  forening: Forening;
  datakvalitet: Pick<
    Datakvalitet,
    'pdfSaknarTextlager' | 'extraktionKonfidens' | 'saknadeFalt'
  >;
}
