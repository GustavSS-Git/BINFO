/**
 * Small, pure display-mapping helpers shared by the UI screens that render
 * a real AnalysisResult. Kept out of src/lib/analysis/ deliberately — that
 * directory is the extraction/analysis pipeline; this file only reshapes
 * already-computed results for presentation. Nothing here recomputes a
 * domain figure — it selects, ranks, and formats.
 */
import { kr } from "@/data/mockData";
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
  PageRef,
  Prisanalys,
  RedFlag,
  RefinansieringsLan,
  Severity,
  Sparbehov,
  Tryck,
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
  const motArsredovisning =
    rad.rapport !== undefined && rad.anvandare !== undefined
      ? `Årsredovisningen: ${rad.rapport} (du angav ${rad.anvandare})`
      : undefined;
  const medSida = (t: string) => (sida ? `${t} · ${sida}` : t);
  const pdfMed = (t: string) => (sida ? `${t}, ${sida}` : t);
  switch (rad.status) {
    case "bekraftat":
      return {
        varde,
        markor: { ton: "success", text: "✓ Bekräftat" },
        forklaring: `Bekräftat av årsredovisningen. ${forklaring}`,
        pdfNotis: pdfMed("bekräftat"),
      };
    case "avviker":
      return {
        varde,
        markor: { ton: "warning", text: "Avviker" },
        rad: medSida(motArsredovisning ?? rad.text),
        forklaring,
        pdfNotis: pdfMed(
          motArsredovisning
            ? `årsredovisningen: ${rad.rapport}, du angav ${rad.anvandare}`
            : "avviker från årsredovisningen",
        ),
      };
    case "osakert":
      return {
        varde,
        markor: { ton: "warning", text: "Osäkert" },
        rad: rad.text,
        forklaring,
        pdfNotis: pdfMed(
          rad.rapport !== undefined
            ? `årsredovisningen: ${rad.rapport}, osäkert läst`
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
          pdfNotis: pdfMed(`årsredovisningen: ${rad.rapport}, osäkert, används inte`),
        };
      }
      return {
        varde,
        markor: { ton: "teal", text: "Från årsredovisningen" },
        forklaring,
        pdfNotis: pdfMed("från årsredovisningen"),
      };
    case "manuellt":
      return { varde };
  }
}

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

// ---------------------------------------------------------------------------
// Visuell prognos (round 2026-10-24c): färg, kedja, vattenfall, lån, byggdelar.
// ---------------------------------------------------------------------------

export const PRIS_LABEL_BAS = "Vad jämförbara lägenheter säljs för";
export const PRIS_LABEL_JUSTERAD = "Värde med hänsyn till föreningens ekonomi";

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

/**
 * Prisbidrag per komponent (kr, signerat; negativt sänker priset). Med
 * justeringens kr-per-kr/mån-faktor: -krPerManad × faktor. Utan faktor delas
 * justeringens belopp proportionellt mot komponenternas kr/mån
 * (`proportionell: true`).
 */
export function komponentPris(
  prisanalys: Pick<Prisanalys, "justeringar">,
  prognos: Avgiftsprognos,
): { bidrag: Record<string, number>; proportionell: boolean } {
  const j = prisanalys.justeringar?.find((x) => x.id === "forvantad_avgiftshojning");
  const bidrag: Record<string, number> = {};
  if (!j) return { bidrag, proportionell: false };
  const kmp = prognos.komponenter.filter(
    (k) => k.status === "beraknad" && k.krPerManad !== null && Math.round(k.krPerManad) !== 0,
  );
  if (j.krPerKrManad !== undefined) {
    for (const k of kmp) bidrag[k.id] = -(k.krPerManad ?? 0) * j.krPerKrManad;
    return { bidrag, proportionell: false };
  }
  const summa = kmp.reduce((a, k) => a + (k.krPerManad ?? 0), 0);
  const total = j.belopp.value;
  if (summa === 0 || total === null) return { bidrag, proportionell: true };
  for (const k of kmp) bidrag[k.id] = (total * (k.krPerManad ?? 0)) / summa;
  return { bidrag, proportionell: true };
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
    if (c === undefined || Math.round(c) === 0) continue;
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
  if (Math.abs(rest) > 1) steg.push({ id: "ovrigt", label: "Övrigt", c: rest, ton: "neutral" });

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
    label: PRIS_LABEL_JUSTERAD,
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
      fakta: !schablon,
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
  /** This flat's share in kr/mån, or the förening's kr/år when the share is unknown. */
  effekt: string;
  /** The förening's kr/år, secondary; only when `effekt` is the flat's kr/mån. */
  effektForening?: string;
  ref?: PageRef;
}

export function lanRader(
  r: NonNullable<Avgiftsprognos["refinansiering"]>,
  horisontManader: number,
  andel?: number | null,
): LanRad[] {
  const senareAr = Math.round((r.senareHorisontManader ?? 60) / 12);
  return (r.lan ?? []).map((l: RefinansieringsLan, i) => {
    const senare = l.fas === "senare";
    return {
      key: `${i}-${l.dag ?? "rorlig"}-${l.belopp}`,
      forfaller: l.dag ? formatDag(l.dag) : l.rorlig ? "Rörligt" : "Datum saknas",
      belopp: formatVarde(l.belopp, "kr"),
      ranta:
        l.rantaProcent === null
          ? "Ränta saknas"
          : `${formatProcentTal(l.rantaProcent)} → ${formatProcentTal(r.nyRantaProcent)}`,
      fas: senare
        ? `År ${Math.floor(horisontManader / 12) + 1}–${senareAr} · väger ${Math.round(l.vikt * 100)} %`
        : `≤ ${horisontManader} mån`,
      senare,
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
