/**
 * Small, pure display-mapping helpers shared by the UI screens that render
 * a real AnalysisResult. Kept out of src/lib/analysis/ deliberately — that
 * directory is the extraction/analysis pipeline; this file only reshapes
 * already-computed results for presentation. Nothing here recomputes a
 * domain figure — it selects, ranks, and formats.
 */
import { iEllerPaOmrade } from "@/lib/omradeText";
import { kr } from "@/data/mockData";
import { BETYG_TITEL } from "@/lib/betygVy";
import { BENCHMARKS, visasIHuvudanalys } from "@/lib/analysis/benchmarks";
import {
  SPARMAL_SCHABLON_KR_PER_M2,
  SPARMAL_SCHABLON_MAX,
  SPARMAL_SCHABLON_MIN,
} from "@/lib/analysis/calc/prognosantaganden";
import type {
  AnalysisResult,
  Avgiftsprognos,
  AvgiftsKomponent,
  Budpremie,
  CostItemId,
  Datakvalitet,
  Dataperiod,
  FeeInclusion,
  Faltjamforelse,
  Figure,
  Forening,
  Grade,
  KeyFigure,
  KeyFigureId,
  PageRef,
  Prisanalys,
  RedFlag,
  RefinansieringsLan,
  Severity,
  Sparbehov,
  Tryck,
  Varderingsunderlag,
} from "@/types/analysis";

// ---------------------------------------------------------------------------
// Visad värdering: avrundning och spann (ägarbeslut 2026-10-26)
// ---------------------------------------------------------------------------

/** Every DISPLAYED valuation figure is rounded to the nearest 10 000 kr. */
export const VARDE_AVRUNDNING_KR = 10_000;
/** The span shown under the main value: ±10 % of the EXACT value. It is an
 *  approximate span, never a confidence interval. */
export const VARDESPANN_PROCENT = 10;
export const VARDESPANN_LABEL = `Ungefärligt spann (±${VARDESPANN_PROCENT} %)`;

/** The ONE rounding rule for displayed valuations (web, PDF, summary, texts). */
export function avrundaVardering(belopp: number): number {
  const r = Math.round(belopp / VARDE_AVRUNDNING_KR) * VARDE_AVRUNDNING_KR;
  return r === 0 ? 0 : r;
}

/** "5 680 000 kr"; null renders as "Uppgift saknas" (unknown is not zero). */
export function formatVardeAvrundat(belopp: number | null): string {
  return belopp === null ? "Uppgift saknas" : kr(avrundaVardering(belopp));
}

/** ±10 % of the exact value, each end rounded to 10 000: 5 681 607 gives
 *  5 110 000 and 6 250 000. */
export function vardespann(exakt: number): { low: number; high: number } {
  const f = VARDESPANN_PROCENT / 100;
  return { low: avrundaVardering(exakt * (1 - f)), high: avrundaVardering(exakt * (1 + f)) };
}

/** "5 110 000 – 6 250 000 kr" */
export function formatVardespann(exakt: number): string {
  const { low, high } = vardespann(exakt);
  return `${Math.round(low).toLocaleString("sv-SE")} – ${Math.round(high).toLocaleString("sv-SE")} kr`;
}

/** The asking price against the displayed span: inside (ends included, as
 *  displayed) means "i linje med modellen". */
export function lageMotVardespann(
  utgangspris: number,
  exaktVarde: number,
): "inom" | "over" | "under" {
  const { low, high } = vardespann(exaktVarde);
  return utgangspris > high ? "over" : utgangspris < low ? "under" : "inom";
}

/** The main shown value: the adjusted value when it exists, else the baseline. */
export function visatVarde(
  p: Pick<Prisanalys, "externVardering" | "justeradVardering">,
): { exakt: number; kalla: "justerad" | "bas" } | null {
  const j = p.justeradVardering?.value;
  if (j !== null && j !== undefined) return { exakt: j, kalla: "justerad" };
  const b = p.externVardering?.value;
  if (b !== null && b !== undefined) return { exakt: b, kalla: "bas" };
  return null;
}

/** A Figure's valuation, rounded for display. */
export function formatVardeFigurAvrundat(f: Pick<Figure, "value">): string {
  return formatVardeAvrundat(f.value);
}

/**
 * "ca 115 600 kr/m²": the price per m² an estimate corresponds to (owner
 * 2026-10-26), shown as a small line under it. Computed from the SHOWN value
 * (rounded to 10 000 kr) so it can be reproduced from the page, rounded to
 * 100 kr. Undefined without a value or a boarea.
 */
export function kvmPrisForVardering(
  varde: number | null | undefined,
  boarea: number | undefined,
): string | undefined {
  if (varde === null || varde === undefined || boarea === undefined || !(boarea > 0)) {
    return undefined;
  }
  const perM2 = Math.round(avrundaVardering(varde) / boarea / 100) * 100;
  return `ca ${perM2.toLocaleString("sv-SE")} kr/m²`;
}

/**
 * Priset som förifyller bolånekalkylen: det VISADE värdet (justerat om det
 * finns, annars Binfos värdering, avrundat till 10 000 kr som på sidan) hellre
 * än utgångspriset, och inget alls (undefined) om varken värdering eller
 * utgångspris finns — då länkas kalkylen utan `pris`.
 */
export function bolanekalkylPris(prisanalys: AnalysisResult["prisanalys"]): number | undefined {
  const visat = visatVarde(prisanalys);
  if (visat) return avrundaVardering(visat.exakt);
  if (prisanalys.externVardering) return undefined;
  return prisanalys.utgangspris?.value ?? undefined;
}

const SEVERITY_RANK: Record<Severity, number> = { hog: 0, medel: 1, lag: 2 };

/**
 * Selects the N most important red flags for a free/teaser view, most
 * severe first. Stable-sorts by severity only — flags with equal severity
 * keep their original (backend-assigned) order rather than being shuffled.
 */
export function toppRodaFlaggor(flaggor: RedFlag[], antal: number): RedFlag[] {
  return flaggor
    .map((flagga, index) => ({ flagga, index }))
    .sort((a, b) => {
      const diff = SEVERITY_RANK[a.flagga.severity] - SEVERITY_RANK[b.flagga.severity];
      return diff !== 0 ? diff : a.index - b.index;
    })
    .slice(0, antal)
    .map((entry) => entry.flagga);
}

/** Which FeeInclusion item, if any, governs whether a cost line item is
 *  already covered by the monthly fee. Hemförsäkring and the loan-related
 *  items (ränta, amortering, ränteavdrag, avgiften själv) have none. */
export const FEE_KEY_BY_COST_ITEM: Partial<Record<CostItemId, keyof FeeInclusion>> = {
  hushallsel: "el",
  varme: "varme",
  vatten: "vatten",
  bredband: "bredband",
};

/**
 * True when a cost item's fee-inclusion is still unanswered ('okant') — the
 * UI marks these as uncertain rather than silently treating them as known.
 * Items with no FeeInclusion mapping (e.g. hemförsäkring) are never
 * uncertain in this sense: the fee never covers them.
 */
export function costItemOsaker(id: CostItemId, avgiftInkluderar: FeeInclusion): boolean {
  const key = FEE_KEY_BY_COST_ITEM[id];
  return key !== undefined && avgiftInkluderar[key] === "okant";
}

/** Swedish short date for a skapad/ISO 8601 timestamp, e.g. "12 sep. 2026". */
export function formatSkapadDatum(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

const SV_MANADER_KORT = [
  "jan",
  "feb",
  "mar",
  "apr",
  "maj",
  "jun",
  "jul",
  "aug",
  "sep",
  "okt",
  "nov",
  "dec",
];

/**
 * Svensk kort periodtext för en Dataperiod, e.g. "jan–aug 2026" (samma år)
 * eller "nov 2025–feb 2026" (över årsskifte). Ren strängformatering — läser
 * bara ISO-datumens år/månad, gör ingen tidszonshantering. Delad av
 * prisdata.ts (server, för schablonBasis-texten) och UI-lagret (rapport +
 * PDF, för värderingsunderlagets databasrad), så de aldrig kan glida isär.
 */
export function formatDataperiod(period: Dataperiod): string {
  const [franAr, franManad] = period.fran.split("-");
  const [tillAr, tillManad] = period.till.split("-");
  const franIdx = franManad ? Number(franManad) - 1 : NaN;
  const tillIdx = tillManad ? Number(tillManad) - 1 : NaN;
  const franLabel = SV_MANADER_KORT[franIdx];
  const tillLabel = SV_MANADER_KORT[tillIdx];
  if (!franLabel || !tillLabel || !franAr || !tillAr) {
    // Oväntat format — visa datumen rakt av hellre än att krascha eller
    // visa "undefined".
    return `${period.fran}–${period.till}`;
  }
  if (franAr === tillAr && franIdx === tillIdx) return `${tillLabel} ${tillAr}`;
  return franAr === tillAr
    ? `${franLabel}–${tillLabel} ${tillAr}`
    : `${franLabel} ${franAr}–${tillLabel} ${tillAr}`;
}

const SV_MANADER_LANG = [
  "januari",
  "februari",
  "mars",
  "april",
  "maj",
  "juni",
  "juli",
  "augusti",
  "september",
  "oktober",
  "november",
  "december",
];

/** Som formatDataperiod men med hela månadsnamn, e.g. "januari–augusti 2026". */
export function formatDataperiodLang(period: Dataperiod): string {
  const [franAr, franManad] = period.fran.split("-");
  const [tillAr, tillManad] = period.till.split("-");
  const franIdx = franManad ? Number(franManad) - 1 : NaN;
  const tillIdx = tillManad ? Number(tillManad) - 1 : NaN;
  const franLabel = SV_MANADER_LANG[franIdx];
  const tillLabel = SV_MANADER_LANG[tillIdx];
  if (!franLabel || !tillLabel || !franAr || !tillAr) {
    return `${period.fran}–${period.till}`;
  }
  if (franAr === tillAr && franIdx === tillIdx) return `${tillLabel} ${tillAr}`;
  return franAr === tillAr
    ? `${franLabel}–${tillLabel} ${tillAr}`
    : `${franLabel} ${franAr}–${tillLabel} ${tillAr}`;
}

/** Källtext under värderingen (modelldata + områdesindelning); delas av webb och PDF. */
export function varderingsKallaText(period: Dataperiod): string {
  return (
    `Modellen är tränad på bostadsrättsförsäljningar i Stockholm under perioden ${formatDataperiodLang(period)}, ` +
    "baserade på data från Svensk Mäklarstatistik. Områdesindelningen bygger på data från " +
    "© OpenStreetMap-bidragsgivare (ODbL), Stockholms stad och GeoNames (CC BY 4.0)."
  );
}

/** Svensk enhetstext för en Figure-enhet. */
export function formatEnhet(unit: Figure["unit"]): string {
  switch (unit) {
    case "kr":
      return "kr";
    case "kr/man":
      return "kr/mån";
    case "kr/m2":
      return "kr/m²";
    case "kr/m2/ar":
      return "kr/m²/år";
    case "procent":
      return "%";
    case "m2":
      return "m²";
    case "ar":
      return "år";
    case "antal":
      return "st";
    case "gånger":
      return "ggr";
  }
}

/**
 * Formaterar ett numeriskt värde för en given Figure-enhet, på svenska
 * (decimalkomma, mellanslag som tusentalsavgränsare). `null` renderas
 * alltid som "Uppgift saknas" — ett okänt värde får aldrig se ut som noll.
 */
export function formatVarde(value: number | null, unit: Figure["unit"]): string {
  if (value === null) return "Uppgift saknas";

  switch (unit) {
    case "kr":
      return kr(value);
    case "kr/man":
    case "kr/m2":
    case "kr/m2/ar":
      return `${Math.round(value).toLocaleString("sv-SE")} ${formatEnhet(unit)}`;
    case "procent":
    case "gånger":
      return `${value.toLocaleString("sv-SE", { maximumFractionDigits: 2 })} ${formatEnhet(unit)}`;
    case "m2":
      return `${value.toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${formatEnhet(unit)}`;
    case "ar":
      // Ett årtal (t.ex. byggår) — inget tusentalsavgränsat, till skillnad
      // från "antal" som är en räknad mängd.
      return `${Math.round(value)} ${formatEnhet(unit)}`;
    case "antal":
      return `${Math.round(value).toLocaleString("sv-SE")} ${formatEnhet(unit)}`;
  }
}

/**
 * Renders a Figure's value the way the buyer should see it, including the
 * case where the report printed a sign without a magnitude (e.g. "neg" for
 * sparande — `value` is then null but `tecken` is set). A bare
 * "Uppgift saknas" would be wrong there: the report DOES say something
 * ("negativt"), it just doesn't give a number — so this shows the sign in
 * Swedish plus the report's own verbatim text via `tryckt`, never inventing
 * a number.
 */
export function formatFigureVarde(figure: Figure): string {
  if (figure.value === null && figure.tecken !== undefined) {
    const tecken = figure.tecken === "negativ" ? "Negativt" : "Positivt";
    return figure.tryckt ? `${tecken} ("${figure.tryckt}" i årsredovisningen)` : tecken;
  }
  return formatVarde(figure.value, figure.unit);
}

/**
 * Does a key figure appear in the report's "Föreningens ekonomi" (web and PDF)?
 * Graded figures: only when the product shows them and a status was judged. The
 * informative one (årsavgifternas andel av rörelseintäkter, riktning "informativ",
 * always status "okant") is shown unrated whenever it has a value.
 */
export function visasNyckeltal(kf: Pick<KeyFigure, "id" | "status" | "figure">): boolean {
  if (BENCHMARKS[kf.id].riktning === "informativ") return kf.figure.value !== null;
  return visasIHuvudanalys(kf.id) && kf.status !== "okant";
}

/** True for a figure shown without a status label or benchmark. */
export function arOgraderatNyckeltal(kf: Pick<KeyFigure, "id" | "status">): boolean {
  return BENCHMARKS[kf.id].riktning === "informativ" || kf.status === "okant";
}

/** "över" / "under" / "i linje med" — ±0,5 procentenheter räknas som "i
 *  linje med" hellre än att låtsas veta en riktning på ren mätbrus. */
function riktningstext(procentVarde: number): string {
  if (procentVarde > 0.5) return "över";
  if (procentVarde < -0.5) return "under";
  return "i linje med";
}

function formatProcentAbs(procentVarde: number): string {
  return Math.abs(procentVarde).toLocaleString("sv-SE", { maximumFractionDigits: 1 });
}

/**
 * Svensk mening för task 5:s statistik "hur mycket bostäder sålts över/under
 * utgångspriset" (Prisanalys.budpremie). Två former, beroende på om
 * budpremie.omrade är känt:
 *   - Känt område: områdets median, med antal försäljningar utsatt.
 *   - null (Stockholmsövergripande fallback — antingen för att lägenhetens
 *     eget område inte kunde kopplas till postnumret, eller för att
 *     områdets egen statistik hade för få försäljningar): medianen för hela
 *     Stockholm, med Stockholms n. Samma mått i båda fallen.
 */
export function formatBudpremieText(budpremie: Budpremie): string {
  if (budpremie.omrade !== null) {
    return (
      `Bostäder ${iEllerPaOmrade(budpremie.omrade)} har sålts för ${formatProcentAbs(budpremie.medianProcent)} % ` +
      `${riktningstext(budpremie.medianProcent)} utgångspriset.`
    );
  }
  // Fallback (unmapped postnummer or too few sales in the area): same
  // statistic as for an area — the median — so the two are comparable.
  return (
    `Bostäder i Stockholm har sålts för ${formatProcentAbs(budpremie.medianProcent)} % ` +
    `${riktningstext(budpremie.medianProcent)} utgångspriset.`
  );
}

export interface VarderingsTackningText {
  typ: "lan" | "utanfor_lan";
  /** Only set for 'utanfor_lan' (shown as a disclaimer heading). */
  titel?: string;
  text: string;
}

/**
 * Coverage copy for a valuation: null for Stockholms kommun (or analyses
 * that predate regional coverage), a method note for the rest of Stockholms
 * län, and a disclaimer for postnummer outside the län. Never prints
 * "undefined" when prisniva/kommun are missing.
 */
export function varderingsTackningText(u: Varderingsunderlag): VarderingsTackningText | null {
  const tackning = u.tackning ?? "stockholm";
  if (tackning === "stockholm") return null;
  const n = u.prisniva;
  const niva = n
    ? ` (${n.krPerM2.toLocaleString("sv-SE", { maximumFractionDigits: 0 })} kr/m², ${n.kalla}, ${formatDataperiod(n.period)})`
    : "";
  if (tackning === "utanfor_lan") {
    return {
      typ: "utanfor_lan",
      titel: "Utanför Binfos täckningsområde",
      text:
        "Binfo är byggt för bostadsrätter i Stockholms län, och värderingsmodellen är tränad på försäljningar i Stockholm. " +
        "Det här postnumret ligger utanför Stockholms län, så uppskattningen nedan bygger på generella samband från Stockholm " +
        (n ? `och riksgenomsnittet för bostadsrätter${niva}. ` : "och ett riksgenomsnitt. ") +
        "Den kan vara betydligt mindre träffsäker än i Stockholm.",
    };
  }
  const plats = u.kommun ?? n?.region;
  return {
    typ: "lan",
    text:
      "Uppskattningen bygger på generella samband från Binfos Stockholmsmodell" +
      (n ? `, skalade till genomsnittspriset i ${plats ?? "området"}${niva}.` : "."),
  };
}

// ---------------------------------------------------------------------------
// v2: lägenhetens andel av föreningens lån, skannad rapport
// ---------------------------------------------------------------------------

/**
 * Raden "Lägenhetens ungefärliga andel av föreningens lån" under värderingen
 * (PLAN-v2 §2.2). Ren kommentar — värderingen är orörd, och texten säger det.
 * Delas av rapporten och PDF-exporten så de aldrig kan glida isär.
 */
export interface AndelAvSkuldRad {
  text: string;
  /** Sidhänvisning till nyckeltalet som beräkningen bygger på. */
  ref?: PageRef;
  /** Varför beloppet är osäkert, när motsvarande underlag är markerat så. */
  osaker?: string;
}

export const SKULDFRI_FORENING_TEXT =
  "Föreningen har inga räntebärande lån enligt årsredovisningen.";

/**
 * `undefined` när `prisanalys.andelAvForeningensSkuld` saknas eller saknar
 * värde — raden utelämnas då helt (en fråga tar hand om luckan, se
 * assemble.ts). 0 kr (en skuldfri förening) ger den särskilda
 * skuldfria texten. Skuld per m² läses ur nyckeltalet som beräkningen
 * byggde på; saknas det visas beloppet utan uppdelning hellre än en
 * baklängesräknad siffra.
 */
export function andelAvSkuldRad(
  analys: Pick<AnalysisResult, "prisanalys" | "forening" | "input">,
): AndelAvSkuldRad | undefined {
  const andel = analys.prisanalys.andelAvForeningensSkuld;
  if (!andel || andel.value === null) return undefined;

  const rad = (text: string): AndelAvSkuldRad => ({
    text,
    ...(andel.ref ? { ref: andel.ref } : {}),
    ...(andel.osaker ? { osaker: andel.osaker } : {}),
  });

  if (andel.value === 0) return rad(SKULDFRI_FORENING_TEXT);

  const skuldPerM2 = analys.forening.keyFigures.find(
    (kf) => kf.id === "skuldsattning_per_m2_brf_yta",
  )?.figure;
  const uppdelning =
    skuldPerM2 && skuldPerM2.value !== null
      ? ` (${formatVarde(skuldPerM2.value, "kr/m2")} × ${formatVarde(analys.input.boarea, "m2")})`
      : "";
  return rad(
    `Lägenhetens ungefärliga andel av föreningens lån: ca ${formatVarde(andel.value, "kr")}` +
      `${uppdelning}. Ingår inte i värderingen.`,
  );
}

/** Visas i rapporten och PDF:en när `datakvalitet.kalla === 'skannad'`. */
export const SKANNAD_NOTIS =
  "Årsredovisningen var skannad; siffrorna är avlästa från sidbilderna och kan innehålla fel – " +
  "kontrollera de viktigaste mot rapporten.";

export function arSkannad(analys: { datakvalitet: Pick<Datakvalitet, "kalla"> }): boolean {
  return analys.datakvalitet.kalla === "skannad";
}

// ---------------------------------------------------------------------------
// Avgiftsprognos, "Så har vi räknat" och uppgiftsjämförelse (runda 2026-10-24b).
// Rena textbyggare som delas av webben och PDF:en; inget här räknar om en
// siffra — allt kommer färdigt från servern.
// ---------------------------------------------------------------------------

/** Heltal med svensk tusentalsavgränsare, utan tecken. */
function heltal(v: number): string {
  return Math.round(Math.abs(v)).toLocaleString("sv-SE");
}

/** "1 234 kr/mån" (absolutbelopp, riktningen står i texten runt omkring). */
export function formatKrPerManad(v: number): string {
  return `${heltal(v)} kr/mån`;
}

/** Procent med decimalkomma, upp till två decimaler: "2,53 %". */
export function formatProcentTal(v: number): string {
  return `${v.toLocaleString("sv-SE", { maximumFractionDigits: 2 })} %`;
}

/** Under det här (kr/mån, absolut) säger vi att prognosen inte pekar åt något håll. */
const TYDLIG_FORANDRING_KR = 10;

/** Raden överst i "Så har vi räknat", del 2. */
export function avgiftsprognosRubrik(p: Avgiftsprognos): string {
  const tid = `inom de närmaste ${p.horisontManader} månaderna`;
  if (p.totalKrPerManad === null) {
    return `Baserat på årsredovisningen kan vi inte uppskatta hur avgiften utvecklas ${tid}, eftersom lägenhetens andel av föreningens avgifter inte gick att fastställa.`;
  }
  if (Math.abs(p.totalKrPerManad) < TYDLIG_FORANDRING_KR) {
    return `Baserat på årsredovisningen pekar inget på någon tydlig förändring av avgiften ${tid}.`;
  }
  const verb = p.totalKrPerManad > 0 ? "höjs" : "sänks";
  return `Baserat på årsredovisningen väntar vi oss att avgiften ${verb} med ca ${heltal(p.totalKrPerManad)} kr/mån ${tid}.`;
}

export interface KomponentRad {
  id: AvgiftsKomponent["id"];
  label: string;
  /** "+312 kr/mån", "Underlag saknas" eller "Ej aktuellt". */
  vardeText: string;
  forklaring: string;
  /** Visas nedtonad (ej aktuell / saknar underlag). */
  dimmad: boolean;
  ref?: PageRef;
}

export function komponentRader(p: Avgiftsprognos): KomponentRad[] {
  return p.komponenter.map((k) => {
    const bas = { id: k.id, label: k.label, forklaring: k.forklaring };
    const ref = k.ref ? { ref: k.ref } : {};
    if (k.status === "saknar_underlag") {
      return {
        ...bas,
        vardeText: "Underlag saknas",
        dimmad: true,
        ...ref,
      };
    }
    if (k.status === "ej_aktuell" || k.krPerManad === null) {
      return { ...bas, vardeText: "Ej aktuellt", dimmad: true, ...ref };
    }
    const tecken = k.krPerManad > 0 ? "+" : k.krPerManad < 0 ? "−" : "";
    return {
      ...bas,
      vardeText: `${tecken}${heltal(k.krPerManad)} kr/mån`,
      dimmad: false,
      ...ref,
    };
  });
}

export const ENERGI_TEXT =
  "Energikostnaden ingår redan i dagens avgift och därmed i värderingen. Bara energiprojekt som inte är finansierade räknas in i höjningen.";

export const PRISEFFEKT_CAVEAT =
  "Prisutslaget bygger på det statistiska sambandet mellan månadsavgift och pris i försäljningarna. Det är ett samband, inte en exakt uträkning av vad just den här lägenheten påverkas.";

/** Text om prisutslaget (del 2), eller tom lista om inget justeringsunderlag finns. */
export function prisEffektTexter(p: Pick<Prisanalys, "justeringar" | "breddningsskal">): string[] {
  const rader: string[] = [];
  for (const j of p.justeringar ?? []) {
    rader.push(`${j.label}: ${formatFigureVarde(j.belopp)}. ${j.forklaring}`);
    if (j.krPerKrManad !== undefined) {
      rader.push(`≈ ${heltal(j.krPerKrManad)} kr i pris per krona i månadsavgift.`);
    }
  }
  // The range is no longer shown (owner 2026-10-24), so its widening reasons
  // (breddningsskal) are not either.
  return rader;
}

/** Del 3: upplåningsunderlaget som rader (etikett, värde). */
export function refinansieringRader(
  r: NonNullable<Avgiftsprognos["refinansiering"]>,
): Array<{ label: string; value: string }> {
  const rf = r.referensranta;
  const rader = [
    { label: "Lån som omsätts inom horisonten", value: formatVarde(r.forfallandeBelopp, "kr") },
    {
      label: "Nuvarande ränta",
      value:
        r.nuvarandeRantaProcent === null
          ? "Uppgift saknas"
          : formatProcentTal(r.nuvarandeRantaProcent),
    },
    {
      label: "Antagen ny ränta",
      value:
        `${formatProcentTal(r.nyRantaProcent)} = ${rf.namn} ${formatProcentTal(rf.procent)} ` +
        `(${rf.datum}${rf.reserv ? ", reservvärde" : ""}) + föreningens marginal ` +
        `${formatProcentTal(r.marginalProcent)}`,
    },
  ];
  return rader;
}

/** Del 3: notis när förfallodagar saknades och en andel av skulden antagits. */
export function antagenAndelText(
  r: NonNullable<Avgiftsprognos["refinansiering"]>,
): string | undefined {
  return r.antagenAndelProcent !== undefined
    ? `Förfallodagar saknades i årsredovisningen, så vi har antagit att ${r.antagenAndelProcent.toLocaleString("sv-SE", { maximumFractionDigits: 0 })} % av skulden omsätts inom horisonten.`
    : undefined;
}

export const RAKNA_UTGANGSLAGE_RUBRIK = "Utgångsläget: Binfos värderingsmodell";
export const RAKNA_UTGANGSLAGE_INTRO =
  "Utgångsläget är Binfos värderingsmodell, som bygger på tidigare försäljningar av bostadsrätter. Här är vad som i stora drag påverkar värderingen och åt vilket håll (det rör sig om samband i försäljningsdata, inte om orsaker):";
export const RAKNA_FAKTORER: string[] = [
  "Boarea: större yta ger högre pris totalt men lägre pris per kvadratmeter.",
  "Postnummer och område: priset per kvadratmeter skiljer sig mycket mellan områden.",
  "Våning: högre våning drar upp priset.",
  "Balkong: balkong drar upp priset.",
  "Hiss: saknad hiss drar ner priset.",
  "Månadsavgift: högre avgift drar ner priset.",
  "Byggår: påverkar priset, och hur mycket beror på området.",
];
export const RAKNA_PROGNOS_RUBRIK = "Väntad avgiftsutveckling enligt årsredovisningen";
export const RAKNA_REFINANSIERING_RUBRIK = "Lån som omsätts inom horisonten";

/** Byggår-raden i objektsammanfattningen: värdet vi använder och en liten
 *  markör som säger hur det förhåller sig till årsredovisningen. */
export interface ByggarMarkor {
  /** Värdet som visas. */
  varde: string;
  markor?: { ton: "success" | "warning" | "teal"; text: string };
  /** Synlig rad under värdet när uppgiften avviker eller är osäker. */
  rad?: string;
  /** Hela förklaringen, för tooltip och skärmläsare. */
  forklaring?: string;
  /** Kort notis efter värdet i PDF:en, t.ex. "bekräftat, s. 4". */
  pdfNotis?: string;
}

/** Årsredovisningens uppgift är ett värdeår (utdraget säger det): då heter det så. */
function arVardear(rad: Faltjamforelse): boolean {
  return /värdeår/i.test(rad.ref?.excerpt ?? "");
}

/**
 * Byggårsregeln (2026-10-26): köparens år används alltid när det angetts; ett
 * annat år i årsredovisningen är en notis ("Årsredovisningen anger X"), aldrig
 * en "bekräftelse". Utan köparens år visas och används årsredovisningens.
 * Äldre lagrade resultat kan ha använt rapportens år trots att köparen angav ett
 * annat (`anvant === rapport`); de behåller sin gamla ordalydelse.
 */
export function byggarMarkor(
  rad: Faltjamforelse | undefined,
  inputByggar: number | undefined,
): ByggarMarkor {
  const fran = (v: number | undefined) => (v !== undefined ? String(v) : "Okänt");
  if (!rad || rad.falt !== "byggar") return { varde: fran(inputByggar) };
  const sida = rad.ref ? `s. ${rad.ref.page}` : undefined;
  const utdrag = rad.ref?.excerpt ? ` Ur årsredovisningen: "${rad.ref.excerpt}"` : "";
  const forklaring = `${rad.text}${sida ? ` (${sida})` : ""}${utdrag}`;
  const varde = fran(rad.anvant ?? inputByggar);
  const vardear = arVardear(rad);
  const rapportAr = rad.rapport !== undefined ? `${vardear ? "värdeår " : ""}${rad.rapport}` : "";
  const harAvvikandeRapport =
    rad.rapport !== undefined && rad.anvandare !== undefined && rad.rapport !== rad.anvandare;
  const rapportAnvandes = harAvvikandeRapport && rad.anvant === rad.rapport;
  const motArsredovisning = harAvvikandeRapport
    ? rapportAnvandes
      ? `Årsredovisningen: ${rapportAr} (du angav ${rad.anvandare})`
      : `Årsredovisningen anger ${rapportAr}`
    : undefined;
  const medSida = (t: string) => (sida ? `${t} · ${sida}` : t);
  const pdfMed = (t: string) => (sida ? `${t}, ${sida}` : t);
  const pdfAvvikelse = rapportAnvandes
    ? `årsredovisningen: ${rapportAr}, du angav ${rad.anvandare}`
    : `årsredovisningen anger ${rapportAr}`;
  switch (rad.status) {
    case "avviker":
      return {
        varde,
        markor: { ton: "warning", text: "Avviker" },
        rad: medSida(motArsredovisning ?? rad.text),
        forklaring,
        pdfNotis: pdfMed(motArsredovisning ? pdfAvvikelse : "avviker från årsredovisningen"),
      };
    case "osakert":
      return {
        varde,
        markor: { ton: "warning", text: "Osäkert" },
        rad: rad.text,
        forklaring,
        pdfNotis: pdfMed(
          rad.rapport !== undefined
            ? `årsredovisningen: ${rapportAr}, osäkert läst`
            : "osäkert mot årsredovisningen",
        ),
      };
    case "endast_rapport":
      if (rad.anvant === null) {
        return {
          varde: "Okänt",
          markor: { ton: "warning", text: "Osäkert" },
          rad: rad.text,
          forklaring,
          pdfNotis: pdfMed(`årsredovisningen: ${rapportAr}, osäkert, används inte`),
        };
      }
      return {
        varde,
        markor: {
          ton: "teal",
          text: vardear ? "Värdeår enligt årsredovisningen" : "Från årsredovisningen",
        },
        forklaring,
        pdfNotis: pdfMed(vardear ? "värdeår enligt årsredovisningen" : "från årsredovisningen"),
      };
    // "bekraftat" is no longer produced; old data is shown like a manual entry.
    case "bekraftat":
    case "manuellt":
      return motArsredovisning
        ? {
            varde,
            rad: medSida(motArsredovisning),
            forklaring,
            pdfNotis: pdfMed(pdfAvvikelse),
          }
        : { varde };
  }
}

/** Den lilla raden under värderingen som säger vilket byggår priset räknats med
 *  när det inte är det köparen angav (eller när köparen inte angav något), eller
 *  när årsredovisningen anger ett annat år än det köparen angav. Bara den
 *  fullständiga analysen har raden `uppgiftsjamforelse`; på Priskollen och när
 *  året stämmer blir det ingen rad. */
export interface ByggarPrisNotis {
  text: string;
  /** Sidhänvisning i årsredovisningen, t.ex. "s. 4" (till källtaggen). */
  sida?: string;
}

export function byggarPrisNotis(rad: Faltjamforelse | undefined): ByggarPrisNotis | undefined {
  if (!rad || rad.falt !== "byggar") return undefined;
  if (rad.anvant === null) return undefined;
  const sida = rad.ref ? `s. ${rad.ref.page}` : undefined;
  const med = (text: string): ByggarPrisNotis => ({ text, ...(sida ? { sida } : {}) });
  const vardear = arVardear(rad);
  const arNamn = vardear ? "värdeår" : "byggår";
  if (rad.anvandare === undefined) {
    return rad.status === "endast_rapport"
      ? med(`Värderingen räknar med ${arNamn} ${rad.anvant} enligt årsredovisningen.`)
      : undefined;
  }
  if (rad.anvant !== rad.anvandare) {
    // Older results: the report's year was used instead of the buyer's.
    return med(
      `Värderingen räknar med ${arNamn} ${rad.anvant} enligt årsredovisningen, inte ${rad.anvandare} som du angav.`,
    );
  }
  if (rad.rapport !== undefined && rad.rapport !== rad.anvandare) {
    return med(
      `Värderingen räknar med ditt byggår ${rad.anvandare}. Årsredovisningen anger ${vardear ? "värdeår " : ""}${rad.rapport}.`,
    );
  }
  return undefined;
}

/** Texten under det justerade värdet (jämförelse mot utgångspriset). */
export function avvikelseJusteradText(avvikelse: number): string {
  return `Utgångspriset ligger ${Math.abs(avvikelse).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} % ${avvikelse > 0 ? "över" : "under"} den justerade värderingen`;
}

/**
 * The % line under the shown value. Its wording and colour follow the same
 * ±10 % span as the summary: inside the span it is neutral and says so ("…, inom
 * spannet"); outside it is over (danger) / under (success). The percentage is
 * against the shown value (adjusted when present). Undefined when there is none.
 */
export function prisAvvikelseRad(
  p: Pick<
    Prisanalys,
    | "externVardering"
    | "justeradVardering"
    | "utgangspris"
    | "avvikelseMotVardering"
    | "avvikelseMotJusteradVardering"
  >,
): { text: string; ton: Ton } | undefined {
  const harJusterad = p.justeradVardering !== undefined;
  const pct = harJusterad ? p.avvikelseMotJusteradVardering : p.avvikelseMotVardering;
  if (pct === undefined) return undefined;
  const visat = visatVarde(p);
  const utgangspris = p.utgangspris?.value ?? null;
  const lage =
    visat && utgangspris !== null
      ? lageMotVardespann(utgangspris, visat.exakt)
      : pct > 0
        ? "over"
        : "under";
  const procent = Math.abs(pct).toLocaleString("sv-SE", { maximumFractionDigits: 1 });
  const riktning = pct > 0 ? "över" : "under";
  if (lage === "inom") {
    return {
      text: `Utgångspriset ligger ${procent} % ${riktning} värdet, inom spannet`,
      ton: "neutral",
    };
  }
  return {
    text: harJusterad
      ? avvikelseJusteradText(pct)
      : `Utgångspriset ligger ${procent} % ${riktning} (jämfört per m²)`,
    ton: pct > 0 ? "danger" : "success",
  };
}

/** Signerad förändring i kr/mån för tabellen: "+312", "−45", "0". */
export function formatForandringKr(v: number): string {
  const r = Math.round(v);
  if (r === 0) return "0";
  return `${r > 0 ? "+" : "−"}${Math.abs(r).toLocaleString("sv-SE")}`;
}

// ---------------------------------------------------------------------------
// Visuell prognos (round 2026-10-24c): färg, kedja, vattenfall, lån, byggdelar.
// ---------------------------------------------------------------------------

export const PRIS_LABEL_BAS = "Vad jämförbara lägenheter säljs för";
/** Short form for the waterfall's last row (its heading already names the
 *  förening's economy; the long label wraps to four lines there). */
export const PRIS_LABEL_JUSTERAD_KORT = "Justerat värde";
export const PRIS_LABEL_JUSTERAD =
  "Värde med hänsyn till föreningens ekonomi utöver nuvarande avgift";

export type Ton = "success" | "warning" | "danger" | "neutral";

/** Avgiftstryck -> samma toner som nyckeltalens status (god / svag / kritisk). */
export const TRYCK_STATUS = { gron: "god", gul: "svag", rod: "kritisk" } as const;
export const TRYCK_TON: Record<Tryck, Ton> = { gron: "success", gul: "warning", rod: "danger" };
/** Samma utility-klasser som StatusDot / StatusLabel i UI-kitet använder. */
export const TON_BG: Record<Ton, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-muted-foreground/40",
};
export const TON_TEXT: Record<Ton, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  neutral: "text-muted-foreground",
};
export const TRYCK_ETIKETT: Record<Tryck, string> = {
  gron: "Inget tryck på avgiften",
  gul: "Visst tryck på avgiften",
  rod: "Tydlig avgiftshöjning väntas",
};

export function tonForTryck(t: Tryck | undefined): Ton {
  return t ? TRYCK_TON[t] : "neutral";
}

/** "+1 200 kr" / "−150 000 kr" / "0 kr". */
export function formatSigneratKr(v: number, enhet = "kr"): string {
  const r = Math.round(v);
  if (r === 0) return `0 ${enhet}`;
  return `${r > 0 ? "+" : "−"}${Math.abs(r).toLocaleString("sv-SE")} ${enhet}`;
}

const kronorM2 = (v: number) => `${Math.round(v).toLocaleString("sv-SE")} kr/m²`;

function ärSparkomponent(k: AvgiftsKomponent): boolean {
  const id = k.id as string;
  return id === "spargap" || id === "sparandegap";
}

export function sparKomponent(p: Avgiftsprognos): AvgiftsKomponent | undefined {
  return p.komponenter.find(ärSparkomponent);
}

export function refiKomponent(p: Avgiftsprognos): AvgiftsKomponent | undefined {
  return p.komponenter.find((k) => k.id === "refinansiering");
}

/** Rubrikens stora tal: "+500 kr/mån" och raden under. */
export function avgiftsHuvud(p: Avgiftsprognos): { varde: string; under: string } {
  const under = `inom ${p.horisontManader} månader`;
  if (p.totalKrPerManad === null) return { varde: "Kan inte uppskattas", under };
  if (Math.abs(p.totalKrPerManad) < TYDLIG_FORANDRING_KR) {
    return { varde: "Ingen tydlig förändring", under };
  }
  return { varde: formatSigneratKr(p.totalKrPerManad, "kr/mån"), under };
}

/** Källtagg på en komponentrad: årsredovisningssida när det finns, annars estimat. */
export function komponentKalla(k: AvgiftsKomponent): { text: string; fakta: boolean } | undefined {
  if (k.status !== "beraknad") return undefined;
  return k.ref
    ? { text: `Årsredovisning s. ${k.ref.page}`, fakta: true }
    : { text: "Uppskattning", fakta: false };
}

/** Component price effects are allocated in steps of 10 kr. */
const KOMPONENT_PRIS_STEG_KR = 10;

/**
 * Prisbidrag per komponent (kr, signerat; negativt sänker priset). The ONE place
 * that computes them, used by the sparande card (`sparKedja`), the waterfall
 * (`vattenfall`) and the PDF, so the same component shows the same number
 * everywhere (owner 2026-10-26).
 *
 * Exact factor: justeringens belopp ÷ (−prognosens totala kr/mån), i.e. each
 * component gets its share `belopp × komponentens kr/mån ÷ total` of the exact
 * adjustment. Each share is rounded to the nearest 10 kr, and the rounding
 * remainder (belopp − the rounded sum) goes once, here, to the component with the
 * largest effect (first one on ties), so the components sum EXACTLY to the
 * adjustment. Without a usable total (null or 0) the shares are taken of the
 * components' own sum (`proportionell: true`).
 */
export function komponentPris(
  prisanalys: Pick<Prisanalys, "justeringar">,
  prognos: Avgiftsprognos,
): { bidrag: Record<string, number>; proportionell: boolean } {
  const j = prisanalys.justeringar?.find((x) => x.id === "forvantad_avgiftshojning");
  const bidrag: Record<string, number> = {};
  const belopp = j?.belopp.value ?? null;
  if (!j || belopp === null) return { bidrag, proportionell: false };
  const kmp = prognos.komponenter.filter(
    (k) => k.status === "beraknad" && k.krPerManad !== null && k.krPerManad !== 0,
  );
  const summa = kmp.reduce((a, k) => a + (k.krPerManad ?? 0), 0);
  const total = prognos.totalKrPerManad;
  const harTotal = total !== null && total !== 0;
  const namnare = harTotal ? total : summa;
  if (kmp.length === 0 || namnare === 0) return { bidrag, proportionell: !harTotal };

  const delar = kmp.map((k) => {
    const exakt = (belopp * (k.krPerManad ?? 0)) / namnare;
    const avrundat = Math.round(exakt / KOMPONENT_PRIS_STEG_KR) * KOMPONENT_PRIS_STEG_KR;
    return { id: k.id, exakt, varde: avrundat === 0 ? 0 : avrundat };
  });
  const rest = belopp - delar.reduce((a, d) => a + d.varde, 0);
  if (rest !== 0) {
    const storst = delar.reduce((a, d) => (Math.abs(d.exakt) > Math.abs(a.exakt) ? d : a));
    storst.varde += rest;
  }
  for (const d of delar) bidrag[d.id] = d.varde;
  return { bidrag, proportionell: !harTotal };
}

export interface VattenfallRad {
  id: string;
  label: string;
  typ: "bas" | "steg" | "slut";
  /** "−150 000 kr" för steg, hela beloppet för bas/slut. */
  beloppText: string;
  /** Position och bredd i procent av skalan (skalan är utzoomad kring värdena). */
  vansterPct: number;
  breddPct: number;
  ton: Ton;
}

/** Stapeldiagram baslinje -> varje komponents prisbidrag -> justerat värde. */
export function vattenfall(
  prisanalys: Pick<Prisanalys, "justeringar" | "externVardering" | "justeradVardering">,
  prognos: Avgiftsprognos,
): { rader: VattenfallRad[]; proportionell: boolean } | undefined {
  const bas = prisanalys.externVardering?.value;
  const slut = prisanalys.justeradVardering?.value;
  if (bas === null || bas === undefined || slut === null || slut === undefined) return undefined;
  const { bidrag, proportionell } = komponentPris(prisanalys, prognos);
  const steg: Array<{ id: string; label: string; c: number; ton: Ton }> = [];
  for (const k of prognos.komponenter) {
    const c = bidrag[k.id];
    if (c === undefined || c === 0) continue;
    steg.push({
      id: k.id,
      label: k.label,
      c,
      ton: k.tryck ? TRYCK_TON[k.tryck] : c < 0 ? "danger" : "success",
    });
  }
  if (steg.length === 0) return undefined;
  const summa = steg.reduce((a, s) => a + s.c, 0);
  const rest = slut - (bas + summa);
  // Rounding leftovers go into the largest step instead of a noise row.
  if (Math.abs(rest) > 1) {
    const storst = steg.reduce((a, s) => (Math.abs(s.c) > Math.abs(a.c) ? s : a));
    if (Math.abs(rest) <= 0.002 * bas) storst.c += rest;
    else steg.push({ id: "ovrigt", label: "Övrigt", c: rest, ton: "neutral" });
  }

  const punkter = [bas, slut];
  let lopande = bas;
  for (const s of steg) {
    lopande += s.c;
    punkter.push(lopande);
  }
  const min = Math.min(...punkter);
  const max = Math.max(...punkter);
  if (max - min <= 0) return undefined;
  const pad = (max - min) * 0.08;
  const lo = min - pad;
  const spann = max - min + 2 * pad;
  const pct = (v: number) => ((v - lo) / spann) * 100;
  const MIN_BREDD = 1.5;

  const rader: VattenfallRad[] = [
    {
      id: "bas",
      label: PRIS_LABEL_BAS,
      typ: "bas",
      beloppText: formatVarde(bas, "kr"),
      vansterPct: pct(bas) - MIN_BREDD / 2,
      breddPct: MIN_BREDD,
      ton: "neutral",
    },
  ];
  let start = bas;
  for (const s of steg) {
    const till = start + s.c;
    rader.push({
      id: s.id,
      label: s.label,
      typ: "steg",
      beloppText: formatSigneratKr(s.c),
      vansterPct: pct(Math.min(start, till)),
      breddPct: Math.max((Math.abs(s.c) / spann) * 100, MIN_BREDD),
      ton: s.ton,
    });
    start = till;
  }
  rader.push({
    id: "slut",
    label: PRIS_LABEL_JUSTERAD_KORT,
    typ: "slut",
    beloppText: formatVarde(slut, "kr"),
    vansterPct: pct(slut) - MIN_BREDD / 2,
    breddPct: MIN_BREDD,
    ton: prognos.tryck ? TRYCK_TON[prognos.tryck] : slut < bas ? "danger" : "success",
  });
  return { rader, proportionell };
}

// --- Sparandekedja ----------------------------------------------------------

export interface KedjeSteg {
  id: "behov" | "sparar" | "glapp" | "avgift" | "pris";
  rubrik: string;
  varde: string;
  kalla?: string;
  /** true = uppgift ur årsredovisningen/planen, false = vår uppskattning/schablon. */
  fakta?: boolean;
  ton?: Ton;
}

export interface SparKedja {
  steg: KedjeSteg[];
  dampningTag?: string;
  /** Stapelbredd i procent (behov är alltid mot skalans max). */
  behovPct: number;
  sparPct: number | null;
  sparTon: Ton;
}

const MAL_KALLA_TEXT: Record<Sparbehov["malKalla"], string> = {
  investeringsbehov: "Underhållsplan",
  rekommenderad_avsattning: "Underhållsplan",
  planerade_kostnader: "Underhållsplan",
  schablon: "Schablon",
};

export function sparKedja(
  prognos: Avgiftsprognos,
  prisanalys: Pick<Prisanalys, "justeringar">,
): SparKedja | undefined {
  const sb = prognos.sparbehov;
  if (!sb) return undefined;
  const komp = sparKomponent(prognos);
  const schablon = sb.malKalla === "schablon";
  const sida = (r: { page: number } | undefined) => (r ? ` s. ${r.page}` : "");
  const steg: KedjeSteg[] = [
    {
      id: "behov",
      rubrik: "Behov",
      varde: kronorM2(sb.malKrPerM2),
      kalla: `${MAL_KALLA_TEXT[sb.malKalla]}${schablon ? "" : sida(sb.malRef)}`,
      // Only the report's own investeringsbehov is a cited fact; the others
      // are Binfo's division of plan figures.
      fakta: sb.malKalla === "investeringsbehov",
    },
    {
      id: "sparar",
      rubrik: "Sparar",
      varde: sb.sparandeKrPerM2 === null ? "Uppgift saknas" : kronorM2(sb.sparandeKrPerM2),
      kalla: `Årsredovisning${sida(sb.sparandeRef)}`,
      fakta: true,
    },
    {
      id: "glapp",
      rubrik: sb.glappKrPerM2 !== null && sb.glappKrPerM2 < 0 ? "Överskott" : "Glapp",
      varde: sb.glappKrPerM2 === null ? "–" : kronorM2(Math.abs(sb.glappKrPerM2)),
      ton:
        sb.glappKrPerM2 === null
          ? "neutral"
          : sb.glappKrPerM2 > 0
            ? tonForTryck(komp?.tryck)
            : "success",
    },
  ];
  if (komp) {
    steg.push({
      id: "avgift",
      rubrik: "Avgift",
      varde: komp.krPerManad === null ? "–" : formatSigneratKr(komp.krPerManad, "kr/mån"),
      kalla: "Uppskattning",
      fakta: false,
      ton: tonForTryck(komp.tryck),
    });
    const pris =
      komp.krPerManad === null ? undefined : komponentPris(prisanalys, prognos).bidrag[komp.id];
    if (pris !== undefined) {
      steg.push({
        id: "pris",
        rubrik: "Pris",
        varde: formatSigneratKr(pris),
        kalla: "Uppskattning",
        fakta: false,
        ton: pris < 0 ? "danger" : "success",
      });
    }
  }
  const max = Math.max(sb.malKrPerM2, sb.sparandeKrPerM2 ?? 0, 1);
  const sparTon: Ton =
    sb.glappKrPerM2 === null
      ? "neutral"
      : sb.glappKrPerM2 <= 0
        ? "success"
        : tonForTryck(komp?.tryck);
  const tag =
    sb.dampning < 1
      ? `Räknas till ${Math.round(sb.dampning * 100)} %${schablon ? " (schablon)" : ""}`
      : undefined;
  return {
    steg,
    ...(tag ? { dampningTag: tag } : {}),
    behovPct: (sb.malKrPerM2 / max) * 100,
    sparPct: sb.sparandeKrPerM2 === null ? null : (Math.max(sb.sparandeKrPerM2, 0) / max) * 100,
    sparTon,
  };
}

export const BYGGDEL_KALLA_TEXT = "Livslängder: FAR 2025, SIB M84:10.";

export function byggdelNot(): string {
  return `Byggdelarna flyttar målet inom ${SPARMAL_SCHABLON_MIN}–${SPARMAL_SCHABLON_MAX} kr/m² (schablon ${SPARMAL_SCHABLON_KR_PER_M2}).`;
}

export interface ByggdelRad {
  key: string;
  label: string;
  senast: string;
  livslangd: string;
  status: "nyligen" | "ok" | "eftersatt" | "okant";
  statusEtikett: string;
  ton: "success" | "warning" | "neutral";
  ref?: PageRef;
}

const BYGGDEL_STATUS: Record<ByggdelRad["status"], { text: string; ton: ByggdelRad["ton"] }> = {
  nyligen: { text: "Nyligen", ton: "success" },
  ok: { text: "Ok", ton: "neutral" },
  eftersatt: { text: "Eftersatt", ton: "warning" },
  okant: { text: "Okänt", ton: "neutral" },
};

export function byggdelRader(sb: Pick<Sparbehov, "byggdelar">): ByggdelRad[] {
  return (sb.byggdelar ?? []).map((b) => ({
    key: b.byggdel,
    label: b.label,
    senast:
      b.senast === undefined
        ? "okänt"
        : `${b.senast} (${b.senastKalla === "atgard" ? "åtgärd" : "byggår"})`,
    livslangd: `${b.livslangd.lag}–${b.livslangd.hog} år`,
    status: b.status,
    statusEtikett: BYGGDEL_STATUS[b.status].text,
    ton: BYGGDEL_STATUS[b.status].ton,
    ...(b.ref ? { ref: b.ref } : {}),
  }));
}

// --- Lån ---------------------------------------------------------------------

export const REFI_FASTRAD =
  "Lån som omsätts om 3–5 år räknas bara om de har lägre ränta än i dag, och väger mindre ju längre bort de ligger – ett medvetet försiktigt val.";
export const RANTEKANSLIGHET_RAD =
  "Räntekänsligheten påverkar inte priset; tabellen nedan visar hur avgiften ändras om räntan stiger.";
export const RAKNA_UTGANGSLAGE_KORT =
  "Utgångsläget bygger på tidigare försäljningar av bostadsrätter.";

const MANADER = [
  "januari",
  "februari",
  "mars",
  "april",
  "maj",
  "juni",
  "juli",
  "augusti",
  "september",
  "oktober",
  "november",
  "december",
];

/** "2027-03-01" -> "1 mars 2027"; allt annat returneras oförändrat. */
export function formatDag(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const manad = m ? MANADER[Number(m[2]) - 1] : undefined;
  return m && manad ? `${Number(m[3])} ${manad} ${m[1]}` : iso;
}

export interface LanRad {
  key: string;
  forfaller: string;
  belopp: string;
  ranta: string;
  fas: string;
  senare: boolean;
  /** The loan matured on or before the calculation date: shown, never priced. */
  forfallit: boolean;
  /** This flat's share in kr/mån, or the förening's kr/år when the share is unknown. */
  effekt: string;
  /** The förening's kr/år, secondary; only when `effekt` is the flat's kr/mån. */
  effektForening?: string;
  /** Whole row as one sentence, for a matured loan ("Förföll … – omsatt till …"). */
  text?: string;
  ref?: PageRef;
}

/** Date column: "Rörlig ränta" (no date) for a floating loan, "under 2027" when the
 *  report gave only the year, else the date. */
function lanDatum(l: RefinansieringsLan): string {
  if (l.rorlig) return "Rörlig ränta";
  if (!l.dag) return "Datum saknas";
  return l.endastAr ? `under ${l.dag.slice(0, 4)}` : formatDag(l.dag);
}

export const FORFALLIT_LAN_TEXT = "omsatt till villkor vi inte känner till";

export function lanRader(
  r: NonNullable<Avgiftsprognos["refinansiering"]>,
  horisontManader: number,
  andel?: number | null,
): LanRad[] {
  const senareAr = Math.round((r.senareHorisontManader ?? 60) / 12);
  return (r.lan ?? []).map((l: RefinansieringsLan, i) => {
    const key = `${i}-${l.dag ?? "rorlig"}-${l.belopp}`;
    if (l.fas === "forfallit") {
      const forfaller = l.rorlig ? "Rörlig ränta" : l.dag ? `Förföll ${lanDatum(l)}` : "Förföll";
      return {
        key,
        forfaller,
        belopp: formatVarde(l.belopp, "kr"),
        ranta: "–",
        fas: `Omsatt till villkor vi inte känner till`,
        senare: false,
        forfallit: true,
        effekt: "–",
        text: `${forfaller} – ${FORFALLIT_LAN_TEXT}`,
        ...(l.ref ? { ref: l.ref } : {}),
      };
    }
    const senare = l.fas === "senare";
    return {
      key,
      forfaller: lanDatum(l),
      belopp: formatVarde(l.belopp, "kr"),
      ranta:
        l.rantaProcent === null
          ? "Ränta saknas"
          : `${formatProcentTal(l.rantaProcent)} → ${formatProcentTal(r.nyRantaProcent)}`,
      fas: senare
        ? `År ${Math.floor(horisontManader / 12) + 1}–${senareAr} · väger ${Math.round(l.vikt * 100)} %`
        : `≤ ${horisontManader} mån`,
      senare,
      forfallit: false,
      effekt:
        l.foreningKrPerAr === null
          ? "–"
          : andel != null
            ? formatSigneratKr((l.foreningKrPerAr * andel) / 12, "kr/mån")
            : formatSigneratKr(l.foreningKrPerAr, "kr/år"),
      ...(l.foreningKrPerAr !== null && andel != null
        ? { effektForening: formatSigneratKr(l.foreningKrPerAr, "kr/år") }
        : {}),
      ...(l.ref ? { ref: l.ref } : {}),
    };
  });
}

/** Referensränta och marginal som en liten rad. */
export function referensrantaRad(r: NonNullable<Avgiftsprognos["refinansiering"]>): string {
  const rf = r.referensranta;
  return `Ny ränta ${formatProcentTal(r.nyRantaProcent)} = ${rf.namn} ${formatProcentTal(rf.procent)} (${rf.datum}${rf.reserv ? ", reservvärde" : ""}) + marginal ${formatProcentTal(r.marginalProcent)}`;
}

// ---------------------------------------------------------------------------
// "Vad händer om räntan stiger?" — reglaget med två flikar (2026-10-25)
// ---------------------------------------------------------------------------

export type RantestressFlik = "idag" | "forvantad";

export interface RantestressVy {
  /** True when the report has an expected fee, so the tabs are shown. */
  harPrognos: boolean;
  /** The tab actually shown (falls back to "idag" without a prognosis). */
  flik: RantestressFlik;
  /** Räntekänslighet missing: slider locked at +0, no stressed fee. */
  ejBeraknbar: boolean;
  /** The slider value actually shown (0 when locked). */
  visadDelta: 0 | 1 | 2 | 3;
  vanster: { etikett: string; varde: string; under: string; tryck?: Tryck };
  hoger: { etikett: string; varde: string; under: string } | { etikett: string; saknas: string };
  kommentar: string;
}

/** True when the expected fee exists and the two tabs should be offered. */
export function harRantestressFlikar(analys: Pick<AnalysisResult, "avgiftsprognos">): boolean {
  return typeof analys.avgiftsprognos?.totalKrPerManad === "number";
}

/**
 * Texts for the rate slider. The same slider value (`delta`) drives both tabs;
 * the stressed fee is always the base fee plus the SAME per-p.e. increment
 * (`scenarier[].avgiftsokningKrPerManad`), so the web and the PDF fee table
 * agree. Nothing is recomputed here beyond today's fee + the expected rise.
 */
export function rantestressVy(
  analys: Pick<AnalysisResult, "rantestress" | "avgiftsprognos">,
  onskadFlik: RantestressFlik,
  delta: 0 | 1 | 2 | 3,
): RantestressVy {
  const r = analys.rantestress;
  const total = analys.avgiftsprognos?.totalKrPerManad;
  const harPrognos = typeof total === "number";
  const flik: RantestressFlik = harPrognos ? onskadFlik : "idag";
  const ejBeraknbar = r.rantekanslighetProcent === null;
  const visadDelta = ejBeraknbar ? 0 : delta;
  const scenario = r.scenarier.find((s) => s.okningPe === visadDelta);
  const okning = scenario?.avgiftsokningKrPerManad.value ?? null;
  const dagens = r.nuvarandeManadsavgift.value;

  if (flik === "forvantad" && typeof total === "number" && dagens !== null) {
    const forvantad = dagens + total;
    const tryck = analys.avgiftsprognos?.tryck;
    const horisont = analys.avgiftsprognos?.horisontManader;
    const inledning =
      `Förväntad avgift är dagens avgift plus den höjning som väntas inom ${horisont} månader. ` +
      `Reglaget lägger en ränteökning på föreningens hela skuld, via räntekänsligheten, ovanpå den förväntade avgiften.`;
    return {
      harPrognos,
      flik,
      ejBeraknbar,
      visadDelta,
      vanster: {
        etikett: "Förväntad avgift",
        varde: kr(forvantad),
        under: `per månad · ${formatForandringKr(total)} kr mot i dag`,
        ...(tryck ? { tryck } : {}),
      },
      hoger: ejBeraknbar
        ? {
            etikett: "Stressad avgift",
            saknas: "Inte möjligt att räkna då räntekänslighet saknas i rapporten.",
          }
        : {
            etikett: "Stressad avgift",
            varde: okning === null ? "Uppgift saknas" : kr(forvantad + okning),
            under: `per månad · +${okning === null ? "okänt" : kr(okning)} mot förväntad avgift`,
          },
      // Missing or zero räntekänslighet: the slider sentence would mislead, so
      // the stored comment (why there is no effect) follows instead.
      kommentar:
        r.rantekanslighetProcent === null || r.rantekanslighetProcent === 0
          ? `Förväntad avgift är dagens avgift plus den höjning som väntas inom ${horisont} månader. ${r.kommentar}`
          : inledning,
    };
  }

  return {
    harPrognos,
    flik: "idag",
    ejBeraknbar,
    visadDelta,
    vanster: {
      etikett: "Dagens avgift",
      varde: formatFigureVarde(r.nuvarandeManadsavgift),
      under: "per månad",
    },
    hoger: ejBeraknbar
      ? {
          etikett: "Stressad avgift",
          saknas: "Inte möjligt att räkna då räntekänslighet saknas i rapporten.",
        }
      : {
          etikett: "Stressad avgift",
          varde: scenario ? formatFigureVarde(scenario.nyManadsavgift) : "Uppgift saknas",
          under: `per månad · +${scenario ? formatFigureVarde(scenario.avgiftsokningKrPerManad) : "okänt"}`,
        },
    kommentar: r.kommentar,
  };
}

// ---------------------------------------------------------------------------
// Rapporten i redesign v4 (2026-10-28): rubriker, sammanfattningskort, tabeller.
// Allt här väljer och formaterar det som redan finns i analysen; inget räknas om.
// ---------------------------------------------------------------------------

const TAL_I_ORD: Record<number, string> = {
  0: "noll",
  1: "en",
  2: "två",
  3: "tre",
  4: "fyra",
  5: "fem",
  6: "sex",
  7: "sju",
  8: "åtta",
  9: "nio",
  10: "tio",
  11: "elva",
  12: "tolv",
};

/** 0–12 i ord ("en" för 1, i samma form som "en sak" och "en fråga"); större tal som siffror. */
export function antalIOrd(n: number): string {
  return TAL_I_ORD[n] ?? String(n);
}

export function medVersal(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toLocaleUpperCase("sv-SE") + text.slice(1);
}

/** "a", "a och b", "a, b och c". */
export function listaPaSvenska(delar: string[]): string {
  if (delar.length <= 1) return delar.join("");
  return `${delar.slice(0, -1).join(", ")} och ${delar[delar.length - 1]}`;
}

/** "s. 4" / "s. 4, 7": unika sidnummer i stigande ordning; tom sträng utan sidor. */
export function sidhanvisning(sidor: Array<number | undefined>): string {
  const unika = [...new Set(sidor.filter((s): s is number => s !== undefined))].sort(
    (a, b) => a - b,
  );
  return unika.length === 0 ? "" : `s. ${unika.join(", ")}`;
}

/**
 * Första meningen av en längre text (betygsmotiveringen), för sammanfattningskortet.
 * Bryter vid första punkt/utrop/frågetecken följd av ny mening; är den längre än `max`
 * tecken kortas den vid ett ord och får "…".
 */
export function forstaMening(text: string, max = 150): string {
  const t = text.trim().replace(/\s+/g, " ");
  const traff = /^(.+?[.!?])(?=\s+[A-ZÅÄÖ0-9]|$)/.exec(t);
  const mening = traff?.[1] ?? t;
  if (mening.length <= max) return mening;
  const klipp = mening.slice(0, max);
  const sista = klipp.lastIndexOf(" ");
  return `${(sista > 40 ? klipp.slice(0, sista) : klipp).replace(/[\s,;:]+$/, "")}…`;
}

/** Rubriken för avsnitt 1: "Stabil ekonomi, två saker att hålla koll på". */
export function foreningenRubrik(betyg: Grade, antalFlaggor: number): string {
  const titel = BETYG_TITEL[betyg];
  if (antalFlaggor <= 0) return `${titel}, inga större varningsflaggor`;
  if (antalFlaggor === 1) return `${titel}, en sak att hålla koll på`;
  return `${titel}, ${antalIOrd(antalFlaggor)} saker att hålla koll på`;
}

/** Nyckeltalens ordning i tabellen (sparande först, den ej bedömda sist). */
export const NYCKELTAL_ORDNING: KeyFigureId[] = [
  "sparande_per_m2_totalyta",
  "skuldsattning_per_m2_brf_yta",
  "skuldsattning_per_m2_totalyta",
  "rantekanslighet",
  "arsavgift_per_m2_brf_yta",
  "energikostnad_per_m2_totalyta",
  "arsavgift_andel_av_rorelseintakter",
];

export function sorteraNyckeltal<T extends { id: KeyFigureId }>(kfs: T[]): T[] {
  const rang = (id: KeyFigureId) => {
    const i = NYCKELTAL_ORDNING.indexOf(id);
    return i === -1 ? NYCKELTAL_ORDNING.length : i;
  };
  return kfs
    .map((kf, index) => ({ kf, index }))
    .sort((a, b) => rang(a.kf.id) - rang(b.kf.id) || a.index - b.index)
    .map((x) => x.kf);
}

export const OBEDOMT_NYCKELTAL_TEXT = "Lagstadgat nyckeltal som Binfo inte bedömer";

/** "Riksgenomsnitt" / "Stockholmssnitt" ur jämförelsevärdets etikett (benchmarks.ts, ej ändrad). */
export function jamforelseNamn(label: string): string {
  if (/^riksgenomsnitt/i.test(label)) return "Riksgenomsnitt";
  if (/^snitt stockholm/i.test(label)) return "Stockholmssnitt";
  const forsta = label.split(",")[0]?.trim();
  return forsta ? forsta : label;
}

/**
 * Kolumnen "Jämförelse": "Riksgenomsnitt: 7 117 kr/m²", "Behov för huset: ca 300 kr/m²"
 * (sparande, när föreningens sparbehov finns), förklaringen för det ej bedömda
 * nyckeltalet, annars tomt.
 */
export function nyckeltalJamforelse(
  kf: Pick<KeyFigure, "id" | "status" | "figure" | "benchmark">,
  sparbehovMal?: number | undefined,
): string {
  if (BENCHMARKS[kf.id].riktning === "informativ") return OBEDOMT_NYCKELTAL_TEXT;
  if (kf.id === "sparande_per_m2_totalyta" && sparbehovMal !== undefined) {
    return `Behov för huset: ca ${Math.round(sparbehovMal).toLocaleString("sv-SE")} kr/m²`;
  }
  if (kf.benchmark && kf.status !== "okant") {
    return `${jamforelseNamn(kf.benchmark.label)}: ${formatVarde(kf.benchmark.value, kf.figure.unit)}`;
  }
  return "";
}

const AVGIFT_POSTER: Array<[keyof FeeInclusion, string]> = [
  ["varme", "värme"],
  ["vatten", "vatten"],
  ["el", "el"],
  ["bredband", "bredband"],
  ["tv", "tv"],
];

/**
 * "I avgiften" som en mening över alla fem posterna, grupperade efter vad
 * årsredovisningen säger: "Värme, vatten och tv ingår (s. 14). El ingår inte (s. 8).
 * Bredband framgår inte." Individuell mätning läggs till som egna meningar.
 * undefined när årsredovisningen inte behandlar avgiften alls.
 */
export function avgiftIngarText(
  f: Pick<
    Forening,
    "avgiftInkluderarEnligtForening" | "avgiftInkluderarKallor" | "individuellMatning"
  >,
): string | undefined {
  const status = f.avgiftInkluderarEnligtForening;
  if (!status) return undefined;
  const grupp = (vilken: "ja" | "nej" | "okant", verb: string): string | undefined => {
    const poster = AVGIFT_POSTER.filter(([nyckel]) => status[nyckel] === vilken);
    if (poster.length === 0) return undefined;
    const sidor = sidhanvisning(poster.map(([nyckel]) => f.avgiftInkluderarKallor?.[nyckel]?.page));
    return `${medVersal(listaPaSvenska(poster.map(([, namn]) => namn)))} ${verb}${sidor ? ` (${sidor})` : ""}.`;
  };
  const meningar = [
    grupp("ja", "ingår"),
    grupp("nej", "ingår inte"),
    grupp("okant", "framgår inte"),
  ];
  const matning = f.individuellMatning;
  if (matning) {
    const poster: Array<["el" | "vatten" | "varme", string]> = [
      ["varme", "värme"],
      ["vatten", "vatten"],
      ["el", "el"],
    ];
    for (const vilken of ["ja", "nej"] as const) {
      const med = poster.filter(([nyckel]) => matning[nyckel]?.matning === vilken);
      if (med.length === 0) continue;
      const sidor = sidhanvisning(med.map(([nyckel]) => matning[nyckel]?.ref.page));
      meningar.push(
        `${vilken === "ja" ? "Individuell mätning av" : "Ingen individuell mätning av"} ${listaPaSvenska(med.map(([, namn]) => namn))}${sidor ? ` (${sidor})` : ""}.`,
      );
    }
  }
  const ut = meningar.filter((m): m is string => m !== undefined);
  return ut.length === 0 ? undefined : ut.join(" ");
}

/**
 * "Föreningen" under "Mer ur årsredovisningen": de citerade antalen och byggår/värdeår,
 * t.ex. "39 lägenheter (varav 3 hyresrätter), 2 lokaler, 49 medlemmar (s. 4, 7). Värdeår 1931 (s. 4)."
 */
export function foreningFaktaText(
  f: Pick<
    Forening,
    "antalLagenheter" | "antalHyresratter" | "antalLokaler" | "antalMedlemmar" | "byggar"
  >,
): string | undefined {
  const antal = (
    fig: Figure | undefined,
    singular: string,
    plural: string,
  ): { text: string; sida?: number } | undefined => {
    if (!fig || fig.value === null) return undefined;
    const n = Math.round(fig.value);
    const osaker = fig.osaker ? ` (osäkert: ${fig.osaker})` : "";
    return {
      text: `${n.toLocaleString("sv-SE")} ${n === 1 ? singular : plural}${osaker}`,
      ...(fig.ref ? { sida: fig.ref.page } : {}),
    };
  };
  const lagenheter = antal(f.antalLagenheter, "lägenhet", "lägenheter");
  const hyres = antal(f.antalHyresratter, "hyresrätt", "hyresrätter");
  const lokaler = antal(f.antalLokaler, "lokal", "lokaler");
  const medlemmar = antal(f.antalMedlemmar, "medlem", "medlemmar");
  const delar: string[] = [];
  if (lagenheter) delar.push(hyres ? `${lagenheter.text} (varav ${hyres.text})` : lagenheter.text);
  else if (hyres) delar.push(hyres.text);
  if (lokaler) delar.push(lokaler.text);
  if (medlemmar) delar.push(medlemmar.text);
  const meningar: string[] = [];
  if (delar.length > 0) {
    const sidor = sidhanvisning([lagenheter?.sida, hyres?.sida, lokaler?.sida, medlemmar?.sida]);
    meningar.push(`${delar.join(", ")}${sidor ? ` (${sidor})` : ""}.`);
  }
  const by = f.byggar;
  if (by && by.value !== null) {
    const vardear = /värdeår/i.test(by.ref?.excerpt ?? "");
    const sida = by.ref ? ` (s. ${by.ref.page})` : "";
    meningar.push(`${vardear ? "Värdeår" : "Byggår"} ${Math.round(by.value)}${sida}.`);
  }
  return meningar.length === 0 ? undefined : meningar.join(" ");
}

/** Vart utgångspriset hamnar mot spannet, eller null utan pris/värdering. */
export function prisRubrik(lage: "under" | "inom" | "over" | null): string {
  if (lage === null) return "Binfos värdering";
  return `Utgångspriset ligger ${lage === "over" ? "över" : lage === "under" ? "under" : "inom"} spannet`;
}

export const SPANN_FORKLARING_KORT = `Spannet är Binfos värdering ± ${VARDESPANN_PROCENT} %`;

/** Version ur modellens id: "valuation-v3.1" blir "3.1". */
export function modellVersionText(modellVersion: string): string {
  const m = /v(\d+(?:\.\d+)*)/i.exec(modellVersion);
  return m?.[1] ?? modellVersion;
}

/** "Binfos värderingsmodell (version 3.1), tränad på … januari–augusti 2026, med data från Svensk Mäklarstatistik." */
export function modellKallaRad(
  u: Pick<Varderingsunderlag, "modellVersion" | "dataperiod">,
): string {
  return (
    `Binfos värderingsmodell (version ${modellVersionText(u.modellVersion)}), tränad på ` +
    `bostadsrättsförsäljningar i Stockholm ${formatDataperiodLang(u.dataperiod)}, ` +
    "med data från Svensk Mäklarstatistik."
  );
}

/** Förklaringen till faktorlistan i "Så har vi räknat" (utan att upprepa att modellen är utgångsläget). */
export const MODELL_FAKTORER_INTRO =
  "Här är vad som i stora drag påverkar värderingen och åt vilket håll (det rör sig om samband i försäljningsdata, inte om orsaker):";

export const OMRADES_KALLA_RAD =
  "© OpenStreetMap-bidragsgivare (ODbL), Stockholms stad och GeoNames (CC BY 4.0).";

/** Avrundar komponenternas prisbidrag till 1 000 kr så att de summerar exakt till
 *  totalen avrundad till 1 000 kr (resten läggs på det största bidraget). */
export function avrundaKomponentEffekter(
  bidrag: Record<string, number>,
  total: number,
): { effekter: Record<string, number>; total: number } {
  const steg = 1_000;
  const avrunda = (v: number) => {
    const r = Math.round(v / steg) * steg;
    return r === 0 ? 0 : r;
  };
  const ids = Object.keys(bidrag);
  const effekter: Record<string, number> = {};
  for (const id of ids) effekter[id] = avrunda(bidrag[id] ?? 0);
  const mal = avrunda(total);
  const rest = mal - ids.reduce((a, id) => a + (effekter[id] ?? 0), 0);
  if (rest !== 0 && ids.length > 0) {
    const storst = ids.reduce((a, id) =>
      Math.abs(bidrag[id] ?? 0) > Math.abs(bidrag[a] ?? 0) ? id : a,
    );
    effekter[storst] = (effekter[storst] ?? 0) + rest;
  }
  return { effekter, total: mal };
}

/** Kort namn på en komponent i raden "Föreningens ekonomi" vid priset. */
export const KOMPONENT_KORTNAMN: Record<AvgiftsKomponent["id"], string> = {
  spargap: "lågt sparande",
  refinansiering: "lån som läggs om",
  underhall: "underhåll utan pengar",
  lokaler: "lokalhyra som kan falla bort",
  energi: "energiprojekt",
  beslutad_hojning: "beslutad avgiftshöjning",
};

// --- Kort 3 och avsnitt 3: avgiften framåt --------------------------------------

/** "två år" / "ett år" / "18 månader". */
export function horisontText(manader: number): string {
  if (manader === 12) return "ett år";
  return manader % 12 === 0 ? `${antalIOrd(manader / 12)} år` : `${manader} månader`;
}

const ORSAK_UPP: Record<AvgiftsKomponent["id"], string> = {
  spargap: "föreningen sparar för lite till underhåll",
  refinansiering: "föreningens lån läggs om till högre ränta",
  underhall: "kommande underhåll behöver finansieras",
  lokaler: "lokalhyror kan falla bort",
  energi: "ett energiprojekt behöver finansieras",
  beslutad_hojning: "en beslutad avgiftshöjning ännu inte gäller",
};

const ORSAK_NER: Partial<Record<AvgiftsKomponent["id"], string>> = {
  spargap: "föreningen sparar mer än underhållsbehovet",
  refinansiering: "föreningens lån läggs om till lägre ränta",
};

const SAKNAR_BELOPP: Record<AvgiftsKomponent["id"], string> = {
  spargap: "sparandet",
  refinansiering: "lånen",
  underhall: "kommande underhåll",
  lokaler: "lokalhyrorna",
  energi: "energiprojekt",
  beslutad_hojning: "beslutade höjningar",
};

/** Komponenten som förklarar mest av förändringen (samma riktning som totalen), eller undefined. */
export function avgiftHuvudorsak(
  p: Pick<Avgiftsprognos, "komponenter" | "totalKrPerManad">,
): { id: AvgiftsKomponent["id"]; orsak: string; andel: number } | undefined {
  const total = p.totalKrPerManad;
  if (total === null || Math.abs(total) < TYDLIG_FORANDRING_KR) return undefined;
  let basta: AvgiftsKomponent | undefined;
  for (const k of p.komponenter) {
    if (k.status !== "beraknad" || k.krPerManad === null || k.krPerManad === 0) continue;
    if (Math.sign(k.krPerManad) !== Math.sign(total)) continue;
    if (!basta || Math.abs(k.krPerManad) > Math.abs(basta.krPerManad ?? 0)) basta = k;
  }
  if (!basta || basta.krPerManad === null) return undefined;
  const orsak =
    total > 0
      ? ORSAK_UPP[basta.id]
      : (ORSAK_NER[basta.id] ?? basta.label.toLocaleLowerCase("sv-SE"));
  return { id: basta.id, orsak, andel: basta.krPerManad / total };
}

/** Komponenter som saknar belopp ("kommande underhåll saknar belopp"), eller undefined. */
function saknarBeloppText(p: Pick<Avgiftsprognos, "komponenter">): string | undefined {
  const saknar = p.komponenter.filter((k) => k.status === "saknar_underlag");
  if (saknar.length === 0) return undefined;
  return `${listaPaSvenska(saknar.map((k) => SAKNAR_BELOPP[k.id]))} saknar belopp`;
}

export interface AvgiftKort {
  /** Stora talet: "+463 kr/mån", "Ingen tydlig förändring" eller "Kan inte uppskattas". */
  varde: string;
  /** "3 503 → ca 3 966 kr" när en förändring kan räknas. */
  rad: string | null;
  text: string;
}

export function avgiftKort(p: Avgiftsprognos | undefined, dagens: number | null): AvgiftKort {
  if (!p) {
    return {
      varde: "Kan inte uppskattas",
      rad: null,
      text: "Den här analysen har ingen prognos för avgiften.",
    };
  }
  const tid = horisontText(p.horisontManader);
  const total = p.totalKrPerManad;
  if (total === null) {
    return {
      varde: "Kan inte uppskattas",
      rad: null,
      text: "Lägenhetens andel av föreningens avgifter gick inte att fastställa.",
    };
  }
  const saknar = saknarBeloppText(p);
  if (Math.abs(total) < TYDLIG_FORANDRING_KR) {
    return {
      varde: "Ingen tydlig förändring",
      rad: null,
      text: `Årsredovisningen pekar inte på någon tydlig förändring av avgiften inom ${tid}.${saknar ? ` Kan bli mer: ${saknar}.` : ""}`,
    };
  }
  const orsak = avgiftHuvudorsak(p);
  const text = [
    orsak ? `Främst för att ${orsak.orsak}.` : `Förändring inom ${tid}.`,
    saknar ? `Kan bli mer: ${saknar}.` : undefined,
  ]
    .filter((t): t is string => t !== undefined)
    .join(" ");
  return {
    varde: formatSigneratKr(total, "kr/mån"),
    rad:
      dagens === null
        ? null
        : `${Math.round(dagens).toLocaleString("sv-SE")} → ca ${Math.round(dagens + total).toLocaleString("sv-SE")} kr`,
    text,
  };
}

/** Rubriken för avsnitt 3. */
export function avgiftRubrik(p: Avgiftsprognos | undefined): string {
  if (!p) return "Vad händer om räntan stiger?";
  const tid = horisontText(p.horisontManader);
  const total = p.totalKrPerManad;
  if (total === null) return "Vi kan inte uppskatta hur avgiften utvecklas";
  if (Math.abs(total) < TYDLIG_FORANDRING_KR) {
    return `Ingen tydlig förändring av avgiften inom ${tid}`;
  }
  return `Räkna med ca ${heltal(total)} kr ${total > 0 ? "mer" : "mindre"} i månaden inom ${tid}`;
}

/** Ingressen till avsnitt 3: största drivaren och en hänvisning till reglaget. */
export function avgiftLead(p: Avgiftsprognos | undefined): string {
  const slut = "Hur mycket räntan påverkar ser du längre ner.";
  if (!p) return slut;
  const orsak = avgiftHuvudorsak(p);
  if (!orsak) return slut;
  const inledning = orsak.andel >= 0.5 ? "Det mesta beror på att" : "Främst beror det på att";
  return `${inledning} ${orsak.orsak}. ${slut}`;
}

export interface DrivarRad {
  key: string;
  label: string;
  forklaring: string;
  /** "+400 kr/mån", "Okänt" eller "0 kr/mån". */
  varde: string;
  ton: Ton;
  dimmad: boolean;
  /** Pressure colour of the component, for the screen-reader label next to the colour. */
  tryck?: Tryck;
  ref?: PageRef;
}

const GRUPP_FRASER: Record<string, string> = {
  beslutad_hojning: "beslutade höjningar",
  lokaler: "lokalhyra",
  energi: "energiprojekt",
};

/**
 * Raderna i "Det här driver den förväntade avgiften". Komponenterna som inte är aktuella
 * (beslutade höjningar, lokalhyra, energiprojekt) slås ihop till en rad bara när ALLA
 * som finns är "ej aktuell"; annars får varje komponent en egen rad.
 */
export function drivareRader(p: Pick<Avgiftsprognos, "komponenter">): DrivarRad[] {
  const gruppOrdning = Object.keys(GRUPP_FRASER);
  const grupp = p.komponenter
    .filter((k) => k.id in GRUPP_FRASER)
    .sort((a, b) => gruppOrdning.indexOf(a.id) - gruppOrdning.indexOf(b.id));
  const slaIhop = grupp.length >= 2 && grupp.every((k) => k.status === "ej_aktuell");
  const rader: DrivarRad[] = [];
  let gruppLagd = false;
  for (const k of p.komponenter) {
    if (slaIhop && k.id in GRUPP_FRASER) {
      if (gruppLagd) continue;
      gruppLagd = true;
      rader.push({
        key: "grupp",
        label: medVersal(grupp.map((g) => GRUPP_FRASER[g.id] ?? g.label).join(", ")),
        forklaring: grupp.map((g) => g.forklaring).join(" "),
        varde: "0 kr/mån",
        ton: "neutral",
        dimmad: true,
      });
      continue;
    }
    const ref = k.ref ? { ref: k.ref } : {};
    const bas = { key: k.id, label: k.label, forklaring: k.forklaring, ...ref };
    if (k.status === "saknar_underlag" || (k.status === "beraknad" && k.krPerManad === null)) {
      rader.push({ ...bas, varde: "Okänt", ton: "neutral", dimmad: true });
    } else if (k.status === "ej_aktuell" || k.krPerManad === null) {
      rader.push({ ...bas, varde: "0 kr/mån", ton: "neutral", dimmad: true });
    } else {
      rader.push({
        ...bas,
        varde: formatSigneratKr(k.krPerManad, "kr/mån"),
        ton: tonForTryck(k.tryck),
        dimmad: k.krPerManad === 0,
        ...(k.tryck ? { tryck: k.tryck } : {}),
      });
    }
  }
  return rader;
}

export interface ByggdelTabellRad {
  key: string;
  label: string;
  /** "2025", "Inget nämnt, troligen original (1931)" eller "Inget nämnt". */
  senast: string;
  sida?: number;
  livslangd: string;
  lage: { text: string; ton: "success" | "warning" | "neutral" };
  excerpt?: string;
}

const BYGGDEL_LAGE: Record<ByggdelRad["status"], ByggdelTabellRad["lage"]> = {
  nyligen: { text: "Nyligen", ton: "success" },
  ok: { text: "Ok", ton: "success" },
  eftersatt: { text: "Troligen eftersatt", ton: "warning" },
  okant: { text: "Okänt", ton: "neutral" },
};

export function byggdelTabell(sb: Pick<Sparbehov, "byggdelar">): ByggdelTabellRad[] {
  return (sb.byggdelar ?? []).map((b) => ({
    key: b.byggdel,
    label: b.label,
    senast:
      b.senast === undefined
        ? "Inget nämnt"
        : b.senastKalla === "atgard"
          ? String(b.senast)
          : b.senastKalla === "byggar"
            ? `Inget nämnt, troligen original (${b.senast})`
            : "Inget nämnt",
    ...(b.senastKalla === "atgard" && b.ref ? { sida: b.ref.page } : {}),
    livslangd: `${b.livslangd.lag}–${b.livslangd.hog} år`,
    lage: BYGGDEL_LAGE[b.status],
    ...(b.ref?.excerpt ? { excerpt: b.ref.excerpt } : {}),
  }));
}

export const BYGGDEL_KALLOR = "FAR 2025 och SIB M84:10";
export const BYGGDEL_KALLA_RAD = `Livslängder enligt ${BYGGDEL_KALLOR}.`;

export interface SparRad {
  label: string;
  note: string;
  varde: string;
  total?: boolean;
}

/**
 * Sparandet mot underhållsbehovet som fyra rader: behov, sparar, glapp och hur det blir
 * din avgift. Gäller både schablon (byggdelarna flyttar målet) och föreningens egen plan.
 */
export function sparRader(prognos: Avgiftsprognos): SparRad[] | undefined {
  const sb = prognos.sparbehov;
  if (!sb) return undefined;
  const komp = sparKomponent(prognos);
  const schablon = sb.malKalla === "schablon";
  const sida = (r: PageRef | undefined) => (r ? `, s. ${r.page}` : "");
  const behovNot = schablon
    ? `Vad föreningen borde spara per år för husets byggdelar, spann ${SPARMAL_SCHABLON_MIN}–${SPARMAL_SCHABLON_MAX} kr/m²`
    : `Enligt föreningens underhållsplan${sida(sb.malRef)}`;
  const rader: SparRad[] = [
    {
      label: "Indikerat underhållsbehov",
      note: behovNot,
      varde: `ca ${Math.round(sb.malKrPerM2).toLocaleString("sv-SE")} kr/m² per år`,
    },
    {
      label: "Föreningen sparar i dag",
      note: `Avsättning enligt årsredovisningen${sida(sb.sparandeRef)}`,
      varde:
        sb.sparandeKrPerM2 === null
          ? "Uppgift saknas"
          : `${Math.round(sb.sparandeKrPerM2).toLocaleString("sv-SE")} kr/m² per år`,
    },
  ];
  if (sb.glappKrPerM2 !== null) {
    const under = sb.glappKrPerM2 > 0;
    rader.push({
      label: under ? "Sparar för lite" : "Sparar mer än behovet",
      note: "Skillnaden mellan behovet och det föreningen sparar i dag",
      varde: `ca ${Math.abs(Math.round(sb.glappKrPerM2)).toLocaleString("sv-SE")} kr/m² per år`,
    });
  }
  if (komp && komp.krPerManad !== null) {
    const andel = prognos.andel?.varde;
    const formel =
      sb.glappKrPerM2 !== null && sb.totalyta !== null && andel !== undefined
        ? `${Math.round(sb.glappKrPerM2).toLocaleString("sv-SE")} kr/m² × ${Math.round(sb.dampning * 100)} % (så stor del av glappet räknar vi med) × ${Math.round(sb.totalyta).toLocaleString("sv-SE")} m² totalyta × din andel av avgifterna ${(andel * 100).toLocaleString("sv-SE", { maximumFractionDigits: 2 })} % ÷ 12 månader`
        : komp.forklaring;
    rader.push({
      label: "Så blir det din avgift",
      note: formel,
      varde: `ca ${formatSigneratKr(komp.krPerManad, "kr/mån")}`,
      total: true,
    });
  }
  return rader;
}

export const RANTEKANSLIGHET_PRIS_RAD =
  "Räntekänsligheten påverkar inte värderingen, bara avgiften i stresstestet.";

export interface LanTabellRad {
  key: string;
  forfaller: string;
  belopp: string;
  ranta: string;
  lage: { text: string; ton: "success" | "warning" | "info" | "neutral" };
}

/** Lånen som tabell: förfallodag, belopp, ränta i årsredovisningen och läge. */
export function lanTabell(
  r: NonNullable<Avgiftsprognos["refinansiering"]>,
  horisontManader: number,
): LanTabellRad[] {
  const rader = lanRader(r, horisontManader);
  return (r.lan ?? []).map((l, i) => {
    const rad = rader[i];
    const bas = {
      key: rad?.key ?? String(i),
      forfaller: (rad?.forfaller ?? "").replace(/^Förföll\s*/, "") || "Datum saknas",
      belopp: rad?.belopp ?? formatVarde(l.belopp, "kr"),
      ranta: l.rantaProcent === null ? "Ränta saknas" : formatProcentTal(l.rantaProcent),
    };
    if (l.fas === "forfallit") {
      return { ...bas, lage: { text: "Redan omsatt, ny ränta okänd", ton: "info" as const } };
    }
    if (l.fas === "senare") {
      return { ...bas, lage: { text: rad?.fas ?? "Senare", ton: "neutral" as const } };
    }
    const ton: "success" | "warning" | "info" =
      l.rantaProcent === null || l.rantaProcent === r.nyRantaProcent
        ? "info"
        : r.nyRantaProcent > l.rantaProcent
          ? "warning"
          : "success";
    return { ...bas, lage: { text: `Ca ${formatProcentTal(r.nyRantaProcent)} väntas`, ton } };
  });
}

/** Meningen under lånetabellen: vilka sidor lånen står på. */
export function lanKallaText(r: NonNullable<Avgiftsprognos["refinansiering"]>): string | undefined {
  const sidor = sidhanvisning((r.lan ?? []).map((l) => l.ref?.page));
  return sidor ? `Lånen enligt årsredovisningen, ${sidor}.` : undefined;
}

// --- Frågor ------------------------------------------------------------------------

export type SvarssignalDelar =
  { typ: "tva"; bra: string; varning: string } | { typ: "en"; text: string };

/**
 * Delar `svarssignal` i "Bra svar" och "Varningssignal" när båda etiketterna finns;
 * annars en rad som förut (fritext får rubriken "Bra svar / varningssignal:" framför).
 */
export function svarssignalDelar(signal: string): SvarssignalDelar {
  const text = signal.trim();
  const m = /^bra svar:\s*(.*?)\s*varningssignal:\s*(.*)$/is.exec(text);
  if (m && m[1] !== undefined && m[2] !== undefined && m[1] !== "" && m[2] !== "") {
    return { typ: "tva", bra: m[1], varning: m[2] };
  }
  return {
    typ: "en",
    text: /^(bra svar|varningssignal):/i.test(text) ? text : `Bra svar / varningssignal: ${text}`,
  };
}

// --- Rapportens huvud --------------------------------------------------------------

/** "48 m²" (heltal utan decimal), "48,5 m²" annars. */
export function formatBoareaKort(m2: number): string {
  return `${m2.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} m²`;
}

/** Området i metaraden: modellens område, annars kommunen. */
export function rapportOmrade(
  u: Pick<Varderingsunderlag, "omrade" | "kommun"> | undefined,
): string | undefined {
  return u?.omrade ?? u?.kommun ?? undefined;
}
