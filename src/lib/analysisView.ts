/**
 * Small, pure display-mapping helpers shared by the UI screens that render
 * a real AnalysisResult. Kept out of src/lib/analysis/ deliberately — that
 * directory is the extraction/analysis pipeline; this file only reshapes
 * already-computed results for presentation. Nothing here recomputes a
 * domain figure — it selects, ranks, and formats.
 */
import { kr } from "@/data/mockData";
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
  PageRef,
  Prisanalys,
  RedFlag,
  Severity,
  Varderingsunderlag,
} from "@/types/analysis";

/**
 * Priset som förifyller bolånekalkylen: hellre Binfos/extern värdering än
 * utgångspriset, och inget alls (undefined) om varken värdering eller
 * utgångspris finns — då länkas kalkylen utan `pris`.
 */
export function bolanekalkylPris(prisanalys: AnalysisResult["prisanalys"]): number | undefined {
  const figur = prisanalys.externVardering ?? prisanalys.utgangspris;
  return figur?.value ?? undefined;
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
 * Caveat-text för värderingsdrivarlistan (Prisanalys.varderingsunderlag.drivare).
 * Ren UI-kopia av samma budskap som src/lib/vardering/drivare.ts's
 * hamtaVarderingsdrivareCaveat() (effects.json -> caveat_sv) — inte hämtad
 * därifrån, eftersom src/lib/vardering är server-only och aldrig får nå
 * klientbundeln (se dess filkommentar). Håll de två i synk för hand om
 * caveat-budskapet någonsin ändras; de säger avsiktligt samma sak.
 */
export const VARDERINGSDRIVARE_CAVEAT =
  "Det här är genomsnittliga effekter för hela Stockholm (eller för området, där det står " +
  "inom parentes), inte en beräkning för just din lägenhet.";

/** Driver label; area-specific effects name their area so a buyer can tell
 *  them from the Stockholm-wide averages. */
export function formatDrivareLabel(
  d: { label: string; niva: "stad" | "omrade" },
  omrade: string | null,
): string {
  return d.niva === "omrade" && omrade !== null ? `${d.label} (${omrade})` : d.label;
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
      `Bostäder i ${budpremie.omrade} har sålts för ${formatProcentAbs(budpremie.medianProcent)} % ` +
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
  /** "+312 kr/mån", "Underlag saknas – spannet breddas" eller "Ej aktuellt". */
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
        vardeText: "Underlag saknas – spannet breddas",
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
  for (const skal of p.breddningsskal ?? []) rader.push(skal);
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

/** Etikett för jämförelsestatus (uppgift mot årsredovisningen). */
export const JAMFORELSE_STATUS_LABEL: Record<Faltjamforelse["status"], string> = {
  bekraftat: "Bekräftat",
  avviker: "Avviker",
  manuellt: "Ej i årsredovisningen",
  osakert: "Osäkert",
  endast_rapport: "Från årsredovisningen",
};

export const JAMFORELSE_RUBRIK = "Dina uppgifter mot årsredovisningen";

/** Texten under det justerade värdet (jämförelse mot utgångspriset). */
export function avvikelseJusteradText(avvikelse: number): string {
  return `Utgångspriset ligger ${Math.abs(avvikelse).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} % ${avvikelse > 0 ? "över" : "under"} den justerade värderingen`;
}

/** Signerad förändring i kr/mån för tabellen: "+312", "−45", "0". */
export function formatForandringKr(v: number): string {
  const r = Math.round(v);
  if (r === 0) return "0";
  return `${r > 0 ? "+" : "−"}${Math.abs(r).toLocaleString("sv-SE")}`;
}
