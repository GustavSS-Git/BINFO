/**
 * Small, pure display-mapping helpers shared by the UI screens that render
 * a real AnalysisResult. Kept out of src/lib/analysis/ deliberately — that
 * directory is the extraction/analysis pipeline; this file only reshapes
 * already-computed results for presentation. Nothing here recomputes a
 * domain figure — it selects, ranks, and formats.
 */
import { kr } from "@/data/mockData";
import type {
  Budpremie,
  CostItemId,
  Dataperiod,
  FeeInclusion,
  Figure,
  RedFlag,
  Severity,
} from "@/types/analysis";

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
  return franAr === tillAr
    ? `${franLabel}–${tillLabel} ${tillAr}`
    : `${franLabel} ${franAr}–${tillLabel} ${tillAr}`;
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
 * Caveat-text för värderingsdrivarlistan (Prisanalys.varderingsunderlag.drivare).
 * Ren UI-kopia av samma budskap som src/lib/vardering/drivare.ts's
 * hamtaVarderingsdrivareCaveat() (effects.json -> caveat_sv) — inte hämtad
 * därifrån, eftersom src/lib/vardering är server-only och aldrig får nå
 * klientbundeln (se dess filkommentar). Håll de två i synk för hand om
 * caveat-budskapet någonsin ändras; de säger avsiktligt samma sak.
 */
export const OMRADESINDELNING_ATTRIBUTION =
  "Områdesindelning: Binfos egen, baserad på © OpenStreetMap-bidragsgivare (ODbL), Stockholms " +
  "stad och GeoNames (CC BY 4.0).";

export const VARDERINGSDRIVARE_CAVEAT =
  "Det här är genomsnittliga effekter för Stockholm (eller angivet område), inte en beräkning " +
  "för just din lägenhet.";

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
  const period = formatDataperiod(budpremie.dataperiod);
  if (budpremie.omrade !== null) {
    return (
      `Bostäder i ${budpremie.omrade} har sålts för ${formatProcentAbs(budpremie.medianProcent)} % ` +
      `${riktningstext(budpremie.medianProcent)} utgångspriset (median, n = ${budpremie.n}, ${period}).`
    );
  }
  // Fallback (unmapped postnummer or too few sales in the area): same
  // statistic as for an area — the median — so the two are comparable.
  return (
    `Bostäder i Stockholm har sålts för ${formatProcentAbs(budpremie.medianProcent)} % ` +
    `${riktningstext(budpremie.medianProcent)} utgångspriset (median för hela Stockholm, ` +
    `n = ${budpremie.n}, ${period}).`
  );
}
