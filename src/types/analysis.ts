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
export type Tristate = "ja" | "nej" | "okant";

/** Where a number came from. Drives how it renders and how much it is trusted. */
export type ValueSource =
  | "arsredovisning" // extracted from the annual report — authoritative
  | "anvandare" // typed in by the user — authoritative
  | "berakning" // derived from other authoritative values
  | "schablon" // system estimate — MUST render visually distinct
  | "extern"; // third-party data (valuation, comparable sales)

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
  unit: "kr" | "kr/man" | "kr/m2" | "kr/m2/ar" | "procent" | "m2" | "ar" | "antal" | "gånger";
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
  tecken?: "negativ" | "positiv";
  /** The value exactly as printed in the report when it was not a plain number (e.g. "neg"). */
  tryckt?: string;
  /**
   * Set when a deterministic sanity check (src/lib/analysis/rimlighet.ts) found
   * this figure inconsistent with other figures in the same report — plain
   * Swedish, shown next to an "osäker" marker. The figure is still shown, never
   * hidden; absence means no check failed, not that the figure was verified.
   */
  osaker?: string;
}

export type Status = "god" | "acceptabel" | "svag" | "kritisk" | "okant";

/** Overall grade. Deliberately coarse — false precision is worse than none. */
export type Grade = "A" | "B" | "C" | "D" | "E";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type PropertyKind = "bostadsratt" | "hus";

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

  /** Optional (owner decision): without it the report shows Binfo's valuation
   *  but no price comparison. Omitted entirely when not given. */
  utgangspris?: number;

  // Required
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
  /** Optional since 2026-10-26 (owner: the form asks only adress +
   *  postnummer). Still filled by a listing fetch (Booli) for its geocoder. */
  ort?: string;

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

  /** Where the form's values came from, when the buyer fetched them from a
   *  listing (owner decision 2026-10-24). Omitted when typed by hand. Buyer
   *  data: blanked by the 12-month retention like the address. */
  kalla?: AnnonsKalla;
}

/** Form fields a listing fetch can fill (src/lib/annons/). */
export type AnnonsFalt =
  | "adress"
  | "postnummer"
  | "ort"
  | "utgangspris"
  | "manadsavgift"
  | "boarea"
  | "antalRum"
  | "vaning"
  | "byggar"
  | "hiss"
  | "balkong";

export interface AnnonsKalla {
  typ: "booli";
  /** Canonical listing URL, https://www.booli.se/(bostad|annons)/<id>. */
  url: string;
  /** The broker's listing page ("Läs mer hos mäklaren"); stored, never fetched. */
  maklarUrl?: string;
  /** BRF name as the listing states it. */
  forening?: string;
  /** ISO timestamp of the fetch. */
  hamtad: string;
  /** Fields still holding the fetched value when the analysis was created
   *  (fetched and not edited by the buyer). */
  oandradeFalt: AnnonsFalt[];
}

// ---------------------------------------------------------------------------
// The seven statutory key figures (BFNAR 2023:1, mandatory from FY2023)
// ---------------------------------------------------------------------------

export type KeyFigureId =
  | "arsavgift_per_m2_brf_yta"
  | "arsavgift_andel_av_rorelseintakter"
  | "skuldsattning_per_m2_totalyta"
  | "skuldsattning_per_m2_brf_yta"
  | "sparande_per_m2_totalyta"
  | "rantekanslighet"
  | "energikostnad_per_m2_totalyta";

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
  akta: Tristate; // äkta vs oäkta — tax consequences for the buyer
  byggar?: Figure;
  antalLagenheter?: Figure;
  totalyta?: Figure;
  /** Area let as bostadsrätt, m² (round 2026-10-24b; before that only in
   *  ExtractionResult.kontrollsummor). Basis for the flat's share fallback. */
  bostadsrattsyta?: Figure;
  rakenskapsar: number; // which financial year the report covers
  /** Balance-sheet date, YYYY-MM-DD (räkenskapsårets sista dag). Absent on
   *  extractions before PROMPT_VERSION 9: read as `${rakenskapsar}-12-31`. */
  balansdag?: string;
  keyFigures: KeyFigure[]; // all seven, even when value is null

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
  individuellMatning?: Partial<
    Record<"el" | "vatten" | "varme", { matning: Tristate; ref: PageRef }>
  >;

  /** Counts the report states, each cited like any other extracted figure. */
  antalMedlemmar?: Figure;
  antalHyresratter?: Figure;
  antalLokaler?: Figure;

  lanebok?: {
    totalSkuld: Figure;
    /** Maturity ladder — how much reprices when. Drives stress realism. */
    forfalloprofil?: Array<{ ar: number; belopp: Figure; ranta?: Figure }>;
    snittranta?: Figure;
    /** Each loan as the loan note lists it (PROMPT_VERSION 9). When present,
     *  `forfalloprofil` is derived from it deterministically. */
    lan?: Lan[];
    /** Räntekostnader for the fiscal year, kr (resultaträkningen / not). */
    rantekostnader?: Figure;
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
    /** Planned costs WITH an amount, as the report states them (PROMPT_VERSION 9). */
    planeradeKostnader?: PlaneradUnderhallskostnad[];
    /** Fund for yttre underhåll at the balance-sheet date, kr. */
    underhallsfond?: Figure;
    /** Planned yearly allocation to the fund, kr/year. */
    arligAvsattning?: Figure;
    /** The report's "investeringsbehov per m²" (average yearly need of the
     *  long-term plan, kr/m² totalyta/year), when stated (PROMPT_VERSION 10). */
    investeringsbehovPerM2?: Figure;
    /** What the plan says SHOULD be set aside per year (kr/year), when the
     *  report states it separately from the actual allocation. */
    rekommenderadAvsattning?: Figure;
    /** A stated plan total, e.g. "underhållsplanen visar 45 Mkr de kommande 30 åren". */
    planTotal?: { belopp: Figure; ar: number };
  };

  /** Major renovations already done, with the year (PROMPT_VERSION 10). Only
   *  the tracked building parts; every item cited. */
  genomfordaAtgarder?: Array<{ byggdel: Byggdel; ar: number; text: string; ref: PageRef }>;

  /** Whether the report says a negative sparande is a planned withdrawal, and
   *  whether it is financed (e.g. from the fund or a decided loan). Absent =
   *  the report doesn't address it. */
  sparandeUttag?: { planerat: Tristate; finansierat: Tristate; text?: string; ref?: PageRef };

  /** Sparande per m² totalyta for the EARLIER fiscal years in the
   *  flerårsöversikt (not the current year, which is the key figure), each
   *  cited; at most three (PROMPT_VERSION 14, owner 2026-10-29). */
  sparandeHistorik?: Array<{ ar: number; figure: Figure }>;

  /** Commercial premises the association lets out (PROMPT_VERSION 9). */
  lokaler?: {
    /** Rental income from lokaler for the fiscal year, kr. */
    hyresintakter?: Figure;
    /** Leases with a stated end date. Every item cited. */
    kontrakt?: Array<{
      text?: string;
      arshyra?: Figure;
      slutdatum?: string;
      ref: PageRef;
      /** The report says this lease is extended/renewed or a new tenant has
       *  signed (PROMPT_VERSION 12). Present → the lease is not at risk. */
      fornyelse?: { text: string; nyttSlutdatum?: string; ref: PageRef };
    }>;
    /** Statements that lokal rent will fall away (lease terminated, tenant
     *  leaving, vacant premises, tenant insolvent, rent dispute or reduction)
     *  (PROMPT_VERSION 11). A lease end date alone is NOT a signal. Only these
     *  feed the 'lokaler' fee component (owner 2026-10-25). */
    forlustsignaler?: Array<{ text: string; arshyra?: Figure; ref: PageRef }>;
  };

  /** Decided or announced changes of the bostäder's årsavgift (older
   *  föreningar call it "hyra"), never lokal rents (PROMPT_VERSION 11). */
  avgiftsandringar?: Avgiftsandring[];

  /** Energy projects the report names (solceller, bergvärme, …). */
  energiprojekt?: Array<{ text: string; belopp?: Figure; finansierat: Tristate; ref?: PageRef }>;

  /** "Väsentliga händelser" and anything after the balance sheet date. Often
   *  where the real risk is disclosed in prose rather than in the figures.
   *  ref is optional for the same reason as kommandeAtgarder above — an
   *  event the model can't precisely cite still ships, flagged by the
   *  missing ref, rather than being silently dropped. */
  vasentligaHandelser?: Array<{ text: string; ref?: PageRef }>;

  /** The association's own street addresses as the report states them
   *  (förvaltningsberättelse, "Fastigheten …"). BRF-level data: it places the
   *  association in the public register's area, never the buyer's flat.
   *  Every item is cited with an excerpt — no citation, no item. Optional so
   *  results stored before PROMPT_VERSION 7 still parse. */
  adresser?: Array<{ gatuadress: string; postnummer?: string; ort?: string; ref: PageRef }>;
  /** Fastighetsbeteckningar the association owns or holds in tomträtt, as
   *  stated in the report (e.g. "Pontonjären 3"). Cited like `adresser`. */
  fastighetsbeteckningar?: Array<{ beteckning: string; ref: PageRef }>;
}

/** Building parts whose age moves the schablon savings target
 *  (docs/underhall-referens.md). */
export type Byggdel = "stambyte" | "tak" | "fasad" | "fonster" | "ventilation" | "el" | "hiss";

/** A change of the årsavgift the report states (PROMPT_VERSION 11). */
export interface Avgiftsandring {
  /** Signed percent: +25 = höjning med 25 %. */
  procent: Figure;
  /** First day the new fee applies, YYYY-MM-DD ("från 1 maj 2024" →
   *  2024-05-01, "från 2025" → 2025-01-01). Absent when not stated. */
  fran?: string;
  status: "beslutad" | "planerad";
  text: string;
  ref: PageRef;
}

/** One loan from the loan note. Cited with an excerpt like any extracted item. */
export interface Lan {
  kreditgivare?: string;
  belopp: Figure;
  ranta?: Figure;
  /** Villkorsändringsdag / konverteringsdag / förfallodag, YYYY-MM-DD. */
  villkorsandringsdag?: string;
  /** 'rorlig' when the report says so, or (deterministically) when the reset
   *  date is within 3 months of the balance date. */
  rantetyp: "rorlig" | "bunden" | "okant";
  ref: PageRef;
}

export interface PlaneradUnderhallskostnad {
  text: string;
  /** Year span the cost falls in, when stated. */
  fran?: number;
  till?: number;
  belopp: Figure;
  /** How the report says it is paid for; 'beslutad' = decided and financed
   *  without saying how; 'okant' = not stated. */
  finansiering: "lan" | "fond" | "beslutad" | "ofinansierad" | "okant";
  ref?: PageRef;
}

// ---------------------------------------------------------------------------
// Analysis layers 2–4 (the differentiated product)
// ---------------------------------------------------------------------------

export type Severity = "hog" | "medel" | "lag";

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
  /** Absent when the buyer gave no asking price. */
  utgangspris?: Figure;
  prisPerM2?: Figure;
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
  /**
   * Full analysis only (owner decision 2026-10-09): the apartment's approximate
   * share of the association's interest-bearing debt = skuldsättning per m²
   * bostadsrättsyta (extracted, cited) × boarea. `source: 'berakning'`, `ref`
   * points at the nyckeltal page. A comment beside the valuation — it is NEVER
   * subtracted from or otherwise applied to `externVardering`. Absent when the
   * debt figure is missing; 0 for a cited debt-free association.
   */
  andelAvForeningensSkuld?: Figure;
  /**
   * Full analysis only (round 2026-10-24b): adjustments applied on top of the
   * model's baseline (`externVardering`). Today the only one is the expected
   * fee rise; the list leaves room for e.g. sales in the förening later. The
   * grade never appears here.
   */
  justeringar?: Prisjustering[];
  /** Baseline + Σ justeringar, with the range shifted and widened for missing
   *  data (low end only). `source: 'schablon'` — it is still an estimate. */
  justeradVardering?: Figure;
  /** Signed percent: utgångspris vs justeradVardering (positive = above). */
  avvikelseMotJusteradVardering?: number;
  /** Why the adjusted range is wider than the baseline's, plain Swedish. */
  breddningsskal?: string[];
}

export interface Prisjustering {
  id: "forvantad_avgiftshojning";
  label: string;
  /** Signed kr added to the baseline (negative lowers the price). */
  belopp: Figure;
  /** Kronor of price per kr/month of fee for this flat (positive number). */
  krPerKrManad?: number;
  forklaring: string;
}

/** The valuation-relevant subset of PropertyInput — all the standalone price
 *  check (step 1 on `/analysera`) asks for. No PDF, no BRF data. */
export type PrisInput = Pick<
  PropertyInput,
  "boarea" | "antalRum" | "manadsavgift" | "postnummer" | "vaning" | "byggar" | "hiss" | "balkong"
> & {
  /** Optional in the price check: without it there is no deviation figure. */
  utgangspris?: number;
};

/** Prisanalys as the standalone price check produces it — the same fields the
 *  full analysis shows, minus the ones that need an asking price or BRF data. */
export type PrisanalysUtanForening = Omit<Prisanalys, "andelAvForeningensSkuld">;

/** Result of the standalone price check (`price_estimate` service). Stateless —
 *  never stored server-side. The full analysis embeds the same valuation in
 *  `AnalysisResult.prisanalys`, computed by the same service. */
export interface PrisuppskattningResultat {
  schemaVersion: "1.0.0";
  skapad: string; // ISO 8601
  input: PrisInput;
  prisanalys: PrisanalysUtanForening;
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
  niva: "stad" | "omrade";
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
  /** Which valuation method applies to the postnummer. Absent on analyses
   *  made before regional coverage existed — read absent as 'stockholm'. */
  tackning?: VarderingsTackning;
  /** The kommun the postnummer maps to; null = could not be resolved. */
  kommun?: string | null;
  /** The local price baseline the estimate is scaled to. Present only for
   *  'lan' (kommun average) and 'utanfor_lan' (national average). */
  prisniva?: Prisniva;
}

/**
 * 'stockholm'   — Stockholms kommun: the area-level model trained on its sales.
 * 'lan'         — elsewhere in Stockholms län: general relationships × the
 *                 kommun's average kr/m².
 * 'utanfor_lan' — outside Stockholms län: general relationships × the national
 *                 average kr/m², shown with a disclaimer first.
 */
export type VarderingsTackning = "stockholm" | "lan" | "utanfor_lan";

/** A published average price level used as a local baseline. */
export interface Prisniva {
  /** e.g. "Nacka" or "Riket". */
  region: string;
  krPerM2: number;
  period: Dataperiod;
  /** Publisher and publication, shown as the citation. */
  kalla: string;
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

/** One row of the fee table (round 2026-10-24b). */
export interface AvgiftstabellRad {
  id: "idag" | "forvantad" | "plus1" | "plus2";
  label: string;
  manadsavgift: number;
  /** kr/month versus today's fee. */
  forandringKr: number;
}

export interface Rantestress {
  /** The statutory key figure this is built on. null when the report does not
   *  state it (and the association is not provably debt-free): the stress
   *  cannot be computed, `scenarier` is then empty and `kommentar` says why.
   *  The rest of the analysis still completes. */
  rantekanslighetProcent: number | null;
  nuvarandeManadsavgift: Figure;
  scenarier: RantestressScenario[];
  kommentar: string;
  /** Today / expected / expected + the räntekänslighet scenario increment for
   *  +1 / +2 pp (the same kr/month as the web slider, 2026-10-25). Rows +1/+2
   *  are absent when räntekänslighet is null. */
  prognosTabell?: { rader: AvgiftstabellRad[]; kommentar: string };
}

// ---------------------------------------------------------------------------
// Expected fee rise (round 2026-10-24b) — see docs/avgiftsprognos.md
// ---------------------------------------------------------------------------

export type AvgiftsKomponentId =
  | "spargap"
  | "refinansiering"
  | "underhall"
  | "lokaler"
  | "energi"
  /** A decided årsavgift rise that has not taken effect yet (2026-10-25). */
  | "beslutad_hojning";

export interface AvgiftsKomponent {
  id: AvgiftsKomponentId;
  label: string;
  /** 'saknar_underlag' adds nothing to the estimate but widens the price range. */
  status: "beraknad" | "saknar_underlag" | "ej_aktuell";
  /** The association's extra cost (or lost income), kr/year, signed. */
  foreningKrPerAr: number | null;
  /** This flat's share, kr/month, signed. */
  krPerManad: number | null;
  forklaring: string;
  ref?: PageRef;
  /** Pressure on the fee: |krPerManad| ÷ today's fee; a decrease is 'gron'. */
  tryck?: Tryck;
}

/** Fee pressure colour (round 2026-10-24c): green < 2 %, yellow 2–10 %,
 *  red > 10 % of today's fee; thresholds in prognosantaganden.ts. */
export type Tryck = "gron" | "gul" | "rod";

/** The savings target behind the 'spargap' component (round 2026-10-24c). */
export interface Sparbehov {
  /** Target savings, kr/m² totalyta/year. */
  malKrPerM2: number;
  malKalla: "investeringsbehov" | "rekommenderad_avsattning" | "planerade_kostnader" | "schablon";
  malRef?: PageRef;
  /** The sparande per m² totalyta the gap uses: since 2026-10-29 the average
   *  of up to four years (`sparandeAr`), else the latest year; null when missing. */
  sparandeKrPerM2: number | null;
  sparandeRef?: PageRef;
  /** The years behind `sparandeKrPerM2`, latest first (absent before 2026-10-29). */
  sparandeAr?: Array<{ ar: number; krPerM2: number; ref?: PageRef }>;
  /** Target − sparande, kr/m²/year; negative = surplus. */
  glappKrPerM2: number | null;
  totalyta: number | null;
  /** Share of the gap that counts. Before 2026-10-29: 1 with the förening's own
   *  plan, 0.5 with the schablon. Since then always 1: `finansiering` decides
   *  how much of the gap reaches the fee. */
  dampning: number;
  /** How the gap is paid within the horizon (since 2026-10-29). */
  finansiering?: SparFinansiering;
  /** Only with the schablon target: the parts that moved it. */
  byggdelar?: ByggdelBedomning[];
}

/**
 * How the förening pays its savings gap within the horizon (owner 2026-10-29).
 * The gap below zero sparande (an operating deficit) is paid by the fee. The
 * rest (from max(sparande, 0) up to the target) is borrowed while debt stays
 * under the ceiling; only the interest on the borrowed amount reaches the fee.
 * What does not fit under the ceiling is paid by the fee.
 */
export interface SparFinansiering {
  /** Gap below zero sparande, kr/m² totalyta/year (0 when sparande ≥ 0). */
  underskottKrPerM2: number;
  /** Gap from max(sparande, 0) to the target, kr/m² totalyta/year (≥ 0). */
  lanebartKrPerM2: number;
  /** Interest-bearing debt per m² used for the headroom; null when unknown. */
  skuldKrPerM2: number | null;
  /** Which statutory key figure `skuldKrPerM2` is. */
  skuldBas: "totalyta" | "bostadsrattsyta" | null;
  /** Debt ceiling, kr/m² (BENCHMARKS.md acceptabel/svag limit). */
  takKrPerM2: number;
  /** Borrowed within the horizon, kr (0 without headroom or with unknown debt). */
  lanatKr: number;
  /** Rate on the borrowed amount, % (the prognosis' new-loan rate). */
  rantaProcent: number;
  /** BRF kr/year reaching the fee at the end of the horizon, by part. */
  krPerArUnderskott: number;
  krPerArOlanat: number;
  krPerArRanta: number;
}

export interface ByggdelBedomning {
  byggdel: Byggdel;
  label: string;
  /** Year last renovated (or built, when never mentioned). */
  senast?: number;
  senastKalla: "atgard" | "byggar" | "okand";
  /** Typical lifetime range, years (docs/underhall-referens.md). */
  livslangd: { lag: number; hog: number };
  status: "nyligen" | "ok" | "eftersatt" | "okant";
  ref?: PageRef;
}

/** One loan in the refinancing calculation (round 2026-10-24c). */
export interface RefinansieringsLan {
  belopp: number;
  rantaProcent: number | null;
  /** Reset date, YYYY-MM-DD; absent for rörlig loans without one. */
  dag?: string;
  /** True when the report gives only the YEAR (old extractions): `dag` is then
   *  a placeholder and must not be shown as a date (round 2026-10-26). */
  endastAr?: true;
  rorlig: boolean;
  /** 'inom_horisont' = within 24 months (both directions); 'senare' = months
   *  25–60, counted only when cheaper than the new rate; 'forfallit' = the
   *  reset date is on or before the calculation date, so the loan already has
   *  new terms we don't know (round 2026-10-26): shown, never priced. */
  fas: "inom_horisont" | "senare" | "forfallit";
  vikt: number;
  /** kr/year after the weight; null when the rate is missing. */
  foreningKrPerAr: number | null;
  ref?: PageRef;
}

export interface Referensranta {
  /** Plain Swedish, e.g. "3-månaders statsskuldväxel". */
  namn: string;
  /** Source series id, e.g. "SETB3MBENCH". */
  serie: string;
  /** Observation date, YYYY-MM-DD. */
  datum: string;
  procent: number;
  kalla: string;
  /** True when no fetched value was available and the config fallback was used. */
  reserv: boolean;
}

export interface Refinansieringsunderlag {
  /** Debt that reprices within the horizon, kr (or the assumed share). */
  forfallandeBelopp: number;
  /** Amount-weighted current rate of that debt, percent. */
  nuvarandeRantaProcent: number | null;
  nyRantaProcent: number;
  referensranta: Referensranta;
  marginalProcent: number;
  /** Set when maturities were missing and a share of total debt was assumed. */
  antagenAndelProcent?: number;
  antalLan: number;
  /** Per-loan rows, both phases (round 2026-10-24c). */
  lan?: RefinansieringsLan[];
  /** Months of the later, cheap-loans-only phase (e.g. 60). */
  senareHorisontManader?: number;
}

export interface Avgiftsprognos {
  horisontManader: number;
  /** The day the horizon counts from, YYYY-MM-DD. */
  berakningsdatum: string;
  /** The flat's share of the association's fee income; null = unknown. */
  andel: { varde: number; metod: "avgiftsandel" | "ytandel" | "harledd_avgiftsandel" } | null;
  komponenter: AvgiftsKomponent[];
  /** Σ beräknade komponenter, kr/month; null when the share is unknown. */
  totalKrPerManad: number | null;
  refinansiering?: Refinansieringsunderlag;
  /** Set when the total looks implausibly large (sanity guard). */
  osaker?: string;
  /** Pressure colour of the total. */
  tryck?: Tryck;
  sparbehov?: Sparbehov;
  /** INTERNAL check (owner 2026-10-25): has each stated årsavgift change
   *  already taken effect in the buyer's fee? Stored for Binfo's own review of
   *  drafts; never rendered on the web or in the PDF. */
  avgiftsandringKontroll?: AvgiftsandringKontroll[];
}

export interface AvgiftsandringKontroll {
  procent: number;
  fran?: string;
  /** `fran` versus the day of the calculation. */
  datum: "passerat" | "framtida" | "okant";
  /** årsavgift/m² bostadsrättsyta × boarea ÷ 12, kr/month, before and after
   *  the change; null when the key figure is missing. */
  uppskattadAvgiftFore: number | null;
  uppskattadAvgiftEfter: number | null;
  /** Which estimate the buyer's fee is closer to. */
  avgift: "matchar_fore" | "matchar_efter" | "okant";
  slutsats: "i_kraft" | "ej_i_kraft" | "okant";
  /** Date and fee point different ways (the date decides). */
  konflikt: boolean;
  ref?: PageRef;
}

/** Report data vs the buyer's input, per field (round 2026-10-24b). */
export type JamforelseFalt =
  "byggar" | "antalLagenheter" | "totalyta" | "bostadsrattsyta" | "totalSkuld";

export interface Faltjamforelse {
  falt: JamforelseFalt;
  label: string;
  anvandare?: number;
  rapport?: number;
  status: "bekraftat" | "avviker" | "manuellt" | "osakert" | "endast_rapport";
  /** The value Binfo uses; null when neither side has one. */
  anvant: number | null;
  /** Plain Swedish, e.g. "Du angav 1962, årsredovisningen anger 1958, vi använder 1958." */
  text: string;
  ref?: PageRef;
}

/** Closing summary (deterministic, buyer-level). */
export interface Sammanfattning {
  betyg: string;
  pris: string;
  avgift: string;
  slutsats: string;
}

// ---------------------------------------------------------------------------
// Monthly cost model
// ---------------------------------------------------------------------------

export type CostItemId =
  | "rantekostnad"
  | "amortering"
  | "ranteavdrag" // negative
  | "manadsavgift"
  | "hushallsel"
  | "varme"
  | "vatten"
  | "bredband"
  | "hemforsakring";

export interface CostItem {
  id: CostItemId;
  label: string;
  figure: Figure; // source 'schablon' renders visually distinct
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
  belaningsgrad: number; // percent
  skuldkvot: number; // loan / gross annual income
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
  ursprung: "analys" | "saknad_uppgift";
  riktadTill: "styrelsen" | "maklaren" | "banken";
  /** One or two short sentences shown under the question ("Varför: …"). For a
   *  question tied to a finding it names that finding and its number from this
   *  report; for a generic question it says why the answer matters to the buyer
   *  (avgift, budnivå, risk). Required. */
  varfor: string;
  /** What a reassuring and a worrying answer sounds like, one line. Shown as
   *  "Bra svar / varningssignal". Omitted (never empty) when there is nothing
   *  useful to say. */
  svarssignal?: string;
  ref?: PageRef;
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

export interface Konfidens {
  niva: "hog" | "medel" | "lag";
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
  /**
   * Where the extracted text came from. 'skannad' = no usable text layer, the
   * pages were transcribed from images (page refs then point into that
   * transcription; confidence is capped at 'medel'). Absent on analyses made
   * before v2 — treat as 'textlager'.
   */
  kalla?: "textlager" | "skannad";
}

/** Raw totals the extraction reads only so deterministic sanity checks
 *  (src/lib/analysis/rimlighet.ts) can cross-check the nyckeltal. Every field
 *  optional — absent means not found, never zero. Not shown to the buyer. */
export interface Kontrollsummor {
  summaTillgangar?: Figure;
  summaEgetKapitalOchSkulder?: Figure;
  /** Årsavgifter (fee income) for the fiscal year, kr. */
  arsavgifter?: Figure;
  /** Area let as bostadsrätt, m². */
  bostadsrattsyta?: Figure;
  /** Interest-bearing debt per the balance sheet / notes, kr. */
  rantebarandeSkulder?: Figure;
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export interface AnalysisResult {
  /** Bump on any breaking change to this contract. */
  schemaVersion: "1.0.0";
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

  /** Round 2026-10-24b, assembled on every read. Absent on frozen snapshots
   *  made before it. */
  avgiftsprognos?: Avgiftsprognos;
  uppgiftsjamforelse?: Faltjamforelse[];
  sammanfattning?: Sammanfattning;

  /** Vestigial: from the removed free-preview paywall. Nothing reads it any
   *  more; kept because stored results carry it and the schema is strict. A
   *  future payment goes before the analysis runs (see src/server/behorighet.ts). */
  gratisSektioner: Array<"betyg" | "rodaFlaggor_topp2" | "datakvalitet">;
}

/** Extraction output only — the raw read of the PDF, before any judgement is
 *  applied. Keeping this separate is what makes extraction independently
 *  testable against a manual answer key. */
export interface ExtractionResult {
  schemaVersion: "1.0.0";
  forening: Forening;
  datakvalitet: Pick<
    Datakvalitet,
    "pdfSaknarTextlager" | "extraktionKonfidens" | "saknadeFalt" | "kalla"
  >;
  /** v2: raw totals for sanity checks only. Absent on pre-v2 extractions. */
  kontrollsummor?: Kontrollsummor;
}
