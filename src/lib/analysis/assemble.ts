import type { z } from "zod";
import type {
  AnalysisResult,
  Avgiftsprognos,
  Budpremie,
  ExtractionResult,
  FeeInclusion,
  Figure,
  Forening,
  Fraga,
  KeyFigureId,
  Konfidens,
  Prisanalys,
  PrisanalysUtanForening,
  PrisInput,
  PropertyInput,
  Rantestress,
  RedFlag,
  Referensranta,
  Varderingsunderlag,
} from "@/types/analysis";
import {
  formatDataperiod,
  formatVardespann,
  lageMotVardespann,
  VARDESPANN_PROCENT,
} from "@/lib/analysisView";
import { AnalysisResultSchema } from "./schema";
import { ALLA_NYCKELTAL } from "./prompts";
import type { AnalysJudgement } from "./analyze";
import { beraknaRantestress, byggPrognosTabell } from "./calc/rantestress";
import { beraknaAvgiftsprognos } from "./calc/avgiftsprognos";
import { reservReferensranta } from "./calc/prognosantaganden";
import { byggPrisjustering } from "./prisjustering";
import { jamforUppgifter } from "./uppgiftsjamforelse";
import { byggSammanfattning } from "./sammanfattning";
import { lokalFragor } from "./lokalfragor";
import { omgraderaNyckeltal } from "./benchmarks";
import { arRefinansieringsflagga, byggRefinansieringsflagga } from "./refinansieringsflagga";
import { sagerAttByggarSaknas } from "./tolkaVarde";
import {
  konfidensUtanPrisdata,
  konfidensUtanPostnummer,
  korBinfoVarderingsmodell,
  prisnivaCitat,
  type ModellVarderingUnderlag,
  type Prisdatakalla,
  type Prisdataforfragan,
} from "./prisdata";

/**
 * Slutmonteringen: kombinerar pass 1:s extraktion, pass 2:s bedömning och de
 * rena, deterministiska delarna av AnalysisResult (räntestress, prisanalys,
 * datakvalitet och 'saknad_uppgift'-frågorna) som PIPELINE.md och
 * analyze.ts:s filkommentar är tydliga med att INTE ska komma från modellen.
 * Ingen modellanrop görs här — allt är ren funktion av det som skickas in.
 *
 * Månadskostnaden (lånedata) är sedan Fas 1 Steg 0 INTE längre del av det
 * här: den beräknas klientsidan i den fristående /bolanekalkyl-kalkylatorn
 * (src/lib/analysis/calc/manadskostnad.ts) och skickas aldrig till servern.
 */

export class AssemblyValidationError extends Error {
  constructor(
    public readonly zodError: z.ZodError,
    public readonly raw: unknown,
  ) {
    const issues = zodError.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    super(
      `Sammansättningen av analysen misslyckades schemavalidering — det är en bugg i ` +
        `monteringen (fel enhet, ett fält som missades), inte ett modellfel: ${issues}`,
    );
    this.name = "AssemblyValidationError";
  }
}

export interface AssembleraAnalysInput {
  extraction: ExtractionResult;
  input: PropertyInput;
  /** Injiceras av anroparen — ModellPrisdatakalla (Binfos egen
   *  värderingsmodell) i produktion; TomPrisdatakalla/DemoPrisdatakalla
   *  för tester, utveckling och demo. */
  prisdatakalla: Prisdatakalla;
  /** Pass 2:s betyg/rodaFlaggor/fragor(ursprung 'analys'), redan Zod-validerat. */
  analys: AnalysJudgement;
  /** Injicera för idempotent omkörning mot en befintlig jobbrad (t.ex. en
   *  Supabase-backad serverlagring) — samma id/datum in ska ge byte-identiskt
   *  JSON ut. Utelämnas i normalfallet, då genereras båda internt. */
  analysisId?: string;
  skapad?: string;
  /** Today's reference rate for the fee prognosis; absent → the configured
   *  fallback (labelled `reserv`). The Edge dry assembly never fetches. */
  referensranta?: Referensranta;
  /** The day the prognosis horizon starts, YYYY-MM-DD; defaults to today
   *  (Stockholm). Injected by tests for determinism. */
  idag?: string;
}

const AVGIFTSPOSTER: ReadonlyArray<{ id: keyof FeeInclusion; label: string }> = [
  // Värme and vatten are NOT asked about or counted in the analysis (owner 2026-10-26): they
  // are only considered in /bolanekalkyl. FeeInclusion keeps the fields (contract).
  { id: "el", label: "el" },
  { id: "bredband", label: "bredband" },
  { id: "tv", label: "tv" },
];

/**
 * Auto-genererar en 'saknad_uppgift'-fråga per Tristate-fält på PropertyInput
 * som fortfarande är 'okant'. Speglar mönstret i src/lib/uppgifter.ts
 * (tristateFalt/sakerhet) men läser det riktiga kontraktet, inte mock-läget.
 *
 * OBS: PropertyInput.avgiftInkluderar är kontraktets EFFEKTIVA värde —
 * förifyllnaden från föreningens egna avgiftInkluderarEnligtForening är
 * orkestreringens ansvar, inte den här funktionens (se kontraktskommentaren
 * på Forening.avgiftInkluderarEnligtForening och filkommentaren på
 * assembleraAnalys nedan). Det enda den här funktionen gör med
 * avgiftInkluderarEnligtForening är att undvika att fråga om något
 * årsredovisningen redan svarat definitivt på, även om orkestreringen av
 * någon anledning inte hunnit föra in det svaret i input än.
 */
function genereraSaknadUppgiftFragor(input: PropertyInput, forening: Forening): Fraga[] {
  const fragor: Fraga[] = [];

  if (input.hiss === "okant") {
    fragor.push({
      id: "saknad-hiss",
      fraga: "Finns det hiss i huset?",
      ursprung: "saknad_uppgift",
      riktadTill: "maklaren",
      varfor:
        "Uppgiften om hiss saknas. Hiss påverkar både värdet och hur lätt lägenheten är att " +
        "komma till, så svaret avgör vad priset rimligen bör vara och hur lätt den är att sälja " +
        "vidare.",
    });
  }

  if (input.balkong === "okant") {
    fragor.push({
      id: "saknad-balkong",
      fraga: "Har lägenheten balkong eller uteplats?",
      ursprung: "saknad_uppgift",
      riktadTill: "maklaren",
      varfor:
        "Uppgiften om balkong saknas. Den påverkar både priset och hur lägenheten ska jämföras " +
        "med andra, så svaret avgör om budet du tänker lägga är rimligt.",
    });
  }

  for (const post of AVGIFTSPOSTER) {
    if (input.avgiftInkluderar[post.id] !== "okant") continue;
    const enligtForening = forening.avgiftInkluderarEnligtForening?.[post.id];
    if (enligtForening === "ja" || enligtForening === "nej") continue;

    fragor.push({
      id: `saknad-avgift-${post.id}`,
      fraga: `Ingår ${post.label} i månadsavgiften?`,
      ursprung: "saknad_uppgift",
      riktadTill: "maklaren",
      varfor:
        `Om ${post.label} ingår i avgiften eller inte påverkar din faktiska månadskostnad: ` +
        `ingår det inte, tillkommer det på din egen räkning och avgiften är inte jämförbar med ` +
        `andra lägenheters.`,
      svarssignal:
        "Bra svar: ett tydligt ja eller nej som går att få skriftligt. " +
        "Varningssignal: ett vagt svar eller att ingen vet.",
    });
  }

  return fragor;
}

/**
 * Deterministisk fråga för det fall räntekänslighet genuint saknas i
 * årsredovisningen (Rantestress.rantekanslighetProcent === null) — se
 * beslutet i rantestress.ts's filkommentar och CLAUDE.md:s domänregel om en
 * genuint saknad räntekänslighet. Stabilt id, precis som
 * saknad-uppgift-frågorna ovan.
 */
const SAKNAR_RANTEKANSLIGHET_FRAGA: Fraga = {
  id: "saknar-rantekanslighet",
  fraga:
    "Årsredovisningen redovisar inte räntekänslighet. Fråga mäklaren eller styrelsen hur mycket " +
    "avgiften behöver höjas per procentenhet högre ränta.",
  ursprung: "analys",
  riktadTill: "maklaren",
  varfor:
    "Räntekänslighet är ett av de sju lagstadgade nyckeltalen och visar hur känslig avgiften är " +
    "för högre ränta. Utan den kan du inte räkna ut vad en räntehöjning gör med din " +
    "månadsavgift, och därmed inte om du klarar kostnaden om räntan stiger.",
  svarssignal:
    "Bra svar: en siffra som styrelsen kan räkna fram ur lånen och avgiftsintäkterna. " +
    "Varningssignal: att styrelsen inte vet hur mycket avgiften påverkas av räntan.",
};

/** Matches "räntekänslighet"/"räntekänslig" case-insensitively — used to spot
 *  whether pass 2 already raised the exact same gap on its own, so the
 *  deterministic question above is never a duplicate of one the model
 *  already wrote (see rule 3 in buildAnalysSystemPrompt: a null figure is
 *  itself worth a flag or a question). Fraga carries no `harledsFran` (only
 *  RedFlag does), so a question is matched on its own text; a red flag is
 *  matched on its `harledsFran`, which DOES name the key figure. */
function harRedanFragaOmRantekanslighet(analys: AnalysJudgement): boolean {
  const namner = /räntekänslig/i;
  return (
    analys.fragor.some((f) => namner.test(f.fraga) || namner.test(f.varfor)) ||
    analys.rodaFlaggor.some((flagga) => flagga.harledsFran.includes("rantekanslighet"))
  );
}

/**
 * Sänker extraktionskonfidensen med högst ETT steg (hog -> medel; medel och
 * lag oförändrade) och lägger till ett förklarande skäl, ENDAST när
 * räntekänslighet genuint saknas (rantestress.rantekanslighetProcent ===
 * null). En skuldfri förenings härledda 0:a (se tolkaVarde.ts's
 * harledSkuldfriaNyckeltal) är INTE null vid det här laget — den vägen
 * triggar alltså aldrig den här nedgraderingen, precis som CLAUDE.md:s
 * domänregel skiljer på de två fallen.
 */
function sankKonfidensForSaknadRantekanslighet(konfidens: Konfidens): Konfidens {
  return {
    niva: konfidens.niva === "hog" ? "medel" : konfidens.niva,
    skal: [
      ...(konfidens.skal ?? []),
      "Räntekänslighet saknas i årsredovisningen, så analysen är något osäkrare. Det här är den " +
        "bästa bedömningen utifrån tillgängliga uppgifter.",
    ],
  };
}

/**
 * En deterministisk bekräftelsefråga till styrelsen för varje nyckeltal som
 * rimlighetskontrollen (rimlighet.ts) markerat `osaker`. Samma mönster som
 * SAKNAR_RANTEKANSLIGHET_FRAGA: ursprung 'analys', stabilt id, orsaken i
 * `varfor`. Hoppar över ett nyckeltal som en befintlig fråga redan nämner vid
 * namn (pass 2 kan ha frågat om samma sak).
 */
export function osakerhetsfragor(forening: Forening, befintliga: readonly Fraga[]): Fraga[] {
  const fragor: Fraga[] = [];
  for (const kf of forening.keyFigures) {
    const orsak = kf.figure.osaker;
    if (!orsak) continue;
    const namn = ALLA_NYCKELTAL.find((n) => n.id === kf.id)?.label ?? kf.label;
    const id = `osaker-${kf.id}`;
    const nyckelord = namn.toLowerCase();
    const redanFragat = befintliga.some(
      (f) => f.id === id || f.fraga.toLowerCase().includes(nyckelord),
    );
    if (redanFragat) continue;
    fragor.push({
      id,
      fraga: `Kan styrelsen bekräfta siffran för ${nyckelord} i årsredovisningen?`,
      ursprung: "analys",
      riktadTill: "styrelsen",
      varfor:
        `${orsak}${/[.!?]$/.test(orsak.trim()) ? "" : "."} ` +
        "Är siffran fel ändras bilden av föreningens ekonomi, och därmed vad du bör vara " +
        "beredd att betala och hur mycket avgiften kan påverkas.",
      svarssignal:
        "Bra svar: styrelsen visar var siffran står i årsredovisningen och hur den räknats. " +
        "Varningssignal: att ingen kan bekräfta siffran.",
      ...(kf.figure.ref ? { ref: kf.figure.ref } : {}),
    });
  }
  return fragor;
}

export { sagerAttByggarSaknas };

/** A question that ONLY asks which year the house was built (or asks to
 *  confirm the year) — nothing else. Anything longer is kept. */
const FRAGAR_BARA_OM_BYGGAR =
  /^\s*(?:(?:vilket år|när)\s+(?:byggdes|uppfördes)\s+(?:huset|husen|byggnaden|byggnaderna|fastigheten)|(?:kan\s+\S+\s+)?(?:bekräfta|uppge|ange)\s+(?:vilket\s+)?(?:byggår(?:et)?|byggnadsår(?:et)?))\s*\??\s*$/i;

export function fragarBaraOmByggar(fraga: Pick<Fraga, "fraga">): boolean {
  return FRAGAR_BARA_OM_BYGGAR.test(fraga.fraga);
}

// ---------------------------------------------------------------------------
// BRF-lagret ovanpå värderingen — bara i den fullständiga analysen
// ---------------------------------------------------------------------------

function nyckeltalsfigur(forening: Forening, id: KeyFigureId): Figure | undefined {
  return forening.keyFigures.find((kf) => kf.id === id)?.figure;
}

const sv0 = (n: number) => n.toLocaleString("sv-SE", { maximumFractionDigits: 0 });

/**
 * Prisanalys.andelAvForeningensSkuld (ägarbeslut 2026-10-09): skuldsättning
 * per m² BOSTADSRÄTTSYTA (extraherad, citerad) × lägenhetens boarea,
 * avrundat till hela kronor. En kommentar bredvid värderingen — dras ALDRIG
 * av från eller tillämpas på externVardering, avvikelse eller slutsats.
 *
 * - Skuldfri förening: nyckeltalet är 0 (härlett och citerat, se
 *   tolkaVarde.ts:s harledSkuldfriaNyckeltal) -> 0 kr.
 * - Nyckeltalet saknas (value null) -> null: fältet utelämnas och en fråga
 *   läggs till i stället (SAKNAR_SKULD_PER_M2_FRAGA).
 * - Skuldsättning per m² TOTALYTA används medvetet INTE som reserv: ägaren
 *   valde bostadsrättsyta, och en siffra med oklar ytbas är redan arkiverad
 *   under brf_yta av extraktionen.
 */
export function beraknaAndelAvForeningensSkuld(forening: Forening, boarea: number): Figure | null {
  const skuldPerM2 = nyckeltalsfigur(forening, "skuldsattning_per_m2_brf_yta");
  if (!skuldPerM2 || skuldPerM2.value === null) return null;
  // No citation, no display: a debt figure without a page reference is not
  // shown as a kronor amount (the missing-figure question covers it instead).
  if (!skuldPerM2.ref) return null;
  return {
    value: Math.round(skuldPerM2.value * boarea),
    unit: "kr",
    source: "berakning",
    ref: skuldPerM2.ref,
    // A sanity-check doubt on the source figure carries over: the derived
    // kronor amount must never look more certain than what it is built from.
    ...(skuldPerM2.osaker ? { osaker: skuldPerM2.osaker } : {}),
  };
}

/**
 * Deterministisk fråga när skuldsättning per m² bostadsrättsyta saknas —
 * samma mönster som SAKNAR_RANTEKANSLIGHET_FRAGA ovan. Stabilt id.
 */
const SAKNAR_SKULD_PER_M2_FRAGA: Fraga = {
  id: "saknar-skuldsattning-per-m2",
  fraga: "Hur stor är föreningens räntebärande skuld per kvadratmeter bostadsrättsyta?",
  ursprung: "analys",
  riktadTill: "maklaren",
  varfor:
    "Årsredovisningen redovisar inte skuldsättning per kvadratmeter bostadsrättsyta. Med den " +
    "går det att räkna ut ungefär hur stor del av föreningens lån lägenheten bär — lån som " +
    "betalas via avgiften. Utan siffran kan du inte bedöma hur skuldtyngd föreningen är, och " +
    "därmed hur mycket av din månadsavgift som går till lånen.",
};

/** Samma dedup-idé som harRedanFragaOmRantekanslighet: hoppa över frågan om
 *  pass 2 redan frågat om eller flaggat exakt samma nyckeltal. */
function harRedanFragaOmSkuldPerM2(analys: AnalysJudgement): boolean {
  const namner =
    /skulds[äa]ttning per (kvadratmeter|kvm|m²|m2)|skuld per (kvadratmeter|kvm|m²|m2)/i;
  return (
    analys.fragor.some((f) => namner.test(f.fraga) || namner.test(f.varfor)) ||
    analys.rodaFlaggor.some((flagga) => flagga.harledsFran.includes("skuldsattning_per_m2_brf_yta"))
  );
}

/**
 * Hur mycket den angivna månadsavgiften får avvika från föreningens
 * genomsnitt (årsavgift per m² bostadsrättsyta × boarea / 12) innan en
 * fråga läggs till. Produktgräns, ägarbeslut D6 2026-10-09 — inte ett
 * marknadsfaktum.
 */
const AVGIFTSAVVIKELSE_TROSKEL = 0.15;

/**
 * Avgiftskontrollen (D6, bara i den fullständiga analysen): en
 * deterministisk fråga till mäklaren när lägenhetens månadsavgift avviker
 * mer än AVGIFTSAVVIKELSE_TROSKEL från vad föreningens årsavgift per m²
 * bostadsrättsyta ger för den här boarean. Ingen fråga när någon av
 * siffrorna saknas — en månadsavgift på 0 kr räknas som saknad, eftersom
 * en bostadsrätt utan avgift inte går att jämföra.
 */
export function avgiftsavvikelseFraga(
  input: Pick<PropertyInput, "manadsavgift" | "boarea">,
  forening: Forening,
  /** Stated raises already in effect after the balance date (2026-10-25):
   *  the comparison uses the raised level, since the key figure predates them. */
  hojningIKraft: { faktor: number; procent: number[] } = { faktor: 1, procent: [] },
): Fraga | null {
  const arsavgiftPerM2 = nyckeltalsfigur(forening, "arsavgift_per_m2_brf_yta");
  if (!arsavgiftPerM2 || arsavgiftPerM2.value === null || arsavgiftPerM2.value <= 0) return null;
  if (!(input.boarea > 0) || !(input.manadsavgift > 0)) return null;

  const fore = (arsavgiftPerM2.value * input.boarea) / 12;
  const hojd = hojningIKraft.faktor > 1 && hojningIKraft.procent.length > 0;
  const forvantad = hojd ? fore * hojningIKraft.faktor : fore;
  const hojningText = hojd
    ? `, eller ungefär ${sv0(Math.round(forvantad))} kr efter ${
        hojningIKraft.procent.length === 1 ? "den beslutade höjningen" : "de beslutade höjningarna"
      } på ${hojningIKraft.procent.map((p) => `${procent(p)} %`).join(" och ")} som redan gäller`
    : "";
  const avvikelse = (input.manadsavgift - forvantad) / forvantad;
  if (Math.abs(avvikelse) <= AVGIFTSAVVIKELSE_TROSKEL) return null;

  const riktning = avvikelse > 0 ? "högre" : "lägre";
  const boareaText = input.boarea.toLocaleString("sv-SE", { maximumFractionDigits: 1 });
  return {
    id: "avgift-avviker-fran-foreningen",
    fraga:
      "Varför skiljer sig lägenhetens månadsavgift från föreningens genomsnittliga avgift per " +
      "kvadratmeter?",
    ursprung: "analys",
    riktadTill: "maklaren",
    varfor:
      `Enligt årsredovisningen är årsavgiften ${sv0(arsavgiftPerM2.value)} kr per kvadratmeter ` +
      `bostadsrättsyta, vilket för ${boareaText} m² motsvarar ungefär ${sv0(Math.round(fore))} kr ` +
      `i månaden${hojningText}. Den angivna månadsavgiften är ${sv0(input.manadsavgift)} kr, ` +
      `${procent(avvikelse * 100)} % ${riktning}. Skillnaden kan bero på ett annat andelstal, på ` +
      "vad som ingår i avgiften eller på en planerad avgiftsändring. Svaret avgör vilken " +
      "månadskostnad du faktiskt kan räkna med i din budget.",
    svarssignal:
      "Bra svar: en konkret förklaring, till exempel ett annat andelstal eller en uppgift om " +
      "vad som ingår. Varningssignal: att ingen kan förklara skillnaden, eller att en " +
      "avgiftshöjning är på väg.",
    ...(arsavgiftPerM2.ref ? { ref: arsavgiftPerM2.ref } : {}),
  };
}

interface Uppgiftsstatus {
  kanda: number;
  totalt: number;
  saknade: string[];
}

/**
 * Räknar hur många av PropertyInputs Tristate/optionella fält som är kända.
 * Samma fältuppsättning som genereraSaknadUppgiftFragor för Tristate-delen,
 * plus vaning/byggar (optionella tal, ingen fråga genereras för dem här —
 * det ligger utanför uppgiften, men de ska ändå räknas som "kända uppgifter"
 * i datakvaliteten).
 */
function berakUppgiftsstatus(input: PropertyInput): Uppgiftsstatus {
  const falt: Array<{ namn: string; kant: boolean }> = [
    { namn: "hiss", kant: input.hiss !== "okant" },
    { namn: "balkong", kant: input.balkong !== "okant" },
    ...AVGIFTSPOSTER.map((post) => ({
      namn: `avgiftInkluderar.${post.id}`,
      kant: input.avgiftInkluderar[post.id] !== "okant",
    })),
    { namn: "vaning", kant: input.vaning !== undefined },
    { namn: "byggar", kant: input.byggar !== undefined },
  ];

  return {
    kanda: falt.filter((f) => f.kant).length,
    totalt: falt.length,
    saknade: falt.filter((f) => !f.kant).map((f) => f.namn),
  };
}

/** Svensk procentform — decimalkomma, aldrig punkt. */
function procent(varde: number): string {
  return Math.abs(varde).toLocaleString("sv-SE", { maximumFractionDigits: 1 });
}

/** Ett eller två svenska meningar. Säger rent ut när ingen avstämning kunde göras. */
function byggSlutsats(underlag: {
  harOberoendeData: boolean;
  /** Värderingen finns, men är en schablon — inte en bedömning av just det här objektet. */
  varderingArSchablon: boolean;
  // Uttryckligen "| undefined" snarare än optional: anroparen skickar alltid
  // med nyckeln (värdet kan vara undefined), och exactOptionalPropertyTypes
  // skiljer på de två.
  avvikelseMotVardering: number | undefined;
  avvikelseMotForeningen: number | undefined;
  /** false när köparen inte angett något utgångspris. */
  harUtgangspris: boolean;
}): string {
  if (!underlag.harUtgangspris) {
    // Inget pris att stämma av (och utan pris finns inget kvadratmeterpris att
    // jämföra med föreningens försäljningar). Ingen mening får tala om
    // "utgångspriset".
    return underlag.harOberoendeData
      ? "Inget utgångspris har angetts, så ingen prisjämförelse görs."
      : "Inget utgångspris har angetts, och ingen oberoende prisuppgift kunde hämtas.";
  }
  if (!underlag.harOberoendeData) {
    // Schablonen ger ett tal att visa, men den känner varken objektet, läget
    // eller skicket. Slutsatsen måste säga att jämförelsen görs mot en
    // schablon — att kalla den "den externa värderingen" vore att påstå en
    // avstämning som aldrig gjorts.
    if (underlag.varderingArSchablon && underlag.avvikelseMotVardering !== undefined) {
      const riktning = underlag.avvikelseMotVardering >= 0 ? "över" : "under";
      return (
        `Utgångspriset ligger ${procent(underlag.avvikelseMotVardering)} % ${riktning} en ` +
        `schablonvärdering. Schablonen är ett platt kvadratmeterpris, inte en bedömning av ` +
        `just den här lägenheten — ingen oberoende priskälla är ansluten, så priset är ännu ` +
        `inte avstämt mot vare sig en riktig värdering eller jämförbara försäljningar.`
      );
    }
    return (
      "Ingen oberoende prisuppgift kunde hämtas, så utgångspriset har inte kunnat stämmas av " +
      "mot vare sig en värdering eller jämförbara försäljningar. Prisbedömningen bygger enbart " +
      "på det angivna utgångspriset."
    );
  }

  const delar: string[] = [];
  if (underlag.avvikelseMotVardering !== undefined) {
    const riktning = underlag.avvikelseMotVardering >= 0 ? "över" : "under";
    delar.push(
      `Utgångspriset ligger ${procent(underlag.avvikelseMotVardering)} % ${riktning} den ` +
        `externa värderingen.`,
    );
  }
  if (underlag.avvikelseMotForeningen !== undefined) {
    const riktning = underlag.avvikelseMotForeningen >= 0 ? "över" : "under";
    delar.push(
      `Kvadratmeterpriset ligger ${procent(underlag.avvikelseMotForeningen)} % ${riktning} ` +
        `snittet för de senaste försäljningarna i föreningen.`,
    );
  }
  if (delar.length === 0) {
    delar.push(
      "Viss extern prisinformation kunde hämtas, men inte tillräckligt för att räkna fram " +
        "någon avvikelse i procent.",
    );
  }
  return delar.join(" ");
}

/**
 * Konfidensen Prisanalys ska bära när externVardering kom från Binfos egen
 * värderingsmodell (produktbeslut): aldrig 'hog'.
 *   - 'stockholm' med känt område: 'medel' (uppmätt typiskt fel 8–17 % beroende
 *     på område, se ml/artifacts/valuation-v3/MODEL_CARD.md).
 *   - 'stockholm' utan område (hela Stockholm som fallback): 'lag'.
 *   - 'lan' och 'utanfor_lan': alltid 'lag'. Modellen är inte tränad på
 *     försäljningar där; felet har bara simulerats inom Stockholm, och är en
 *     nedre gräns. Skälen anger metoden rakt ut.
 */
function konfidensForModell(resultat: ModellVarderingUnderlag["resultat"]): Konfidens {
  const felText = resultat.typisktFelProcent.toLocaleString("sv-SE", { maximumFractionDigits: 1 });

  if (resultat.tackning === "stockholm") {
    const skal: string[] = [
      `Värderingen är en statistisk modell (typiskt fel ±${felText} %), inte en besiktning av lägenheten.`,
    ];
    if (resultat.omrade === null) {
      skal.push(
        "Postnumret kunde inte kopplas till ett specifikt Stockholmsområde — värderingen bygger " +
          "på en stadsövergripande modell med lägre precision än en områdesspecifik skattning.",
      );
    }
    return { niva: resultat.omrade !== null ? "medel" : "lag", skal };
  }

  const skal: string[] = [
    `Värderingen är en statistisk modell, inte en besiktning av lägenheten. Det simulerade felet är ±${felText} %, ` +
      "men det är en nedre gräns — det verkliga felet utanför Stockholms kommun är okänt och sannolikt större.",
  ];
  const prisniva = resultat.prisniva;
  if (resultat.tackning === "lan") {
    const kommun = resultat.kommun ?? prisniva?.region ?? "kommunen";
    skal.push(
      "Uppskattningen bygger på generella samband från Binfos Stockholmsmodell, skalade till " +
        `genomsnittspriset i ${kommun}${prisniva ? ` (${prisnivaCitat(prisniva)})` : ""}. ` +
        `Modellen är inte tränad på försäljningar i ${kommun}.`,
    );
  } else {
    skal.push(
      "Binfo är byggt för bostadsrätter i Stockholms län och modellen är tränad på försäljningar i Stockholm. " +
        "Postnumret ligger utanför Stockholms län, så uppskattningen bygger på generella samband från " +
        `Stockholm och riksgenomsnittet för bostadsrätter${prisniva ? ` (${prisnivaCitat(prisniva)})` : ""}. ` +
        "Den kan vara betydligt mindre träffsäker.",
    );
  }
  return { niva: "lag", skal };
}

/**
 * Slutsatsen när externVardering kom från Binfos egen värderingsmodell.
 * Jämför utgångspriset med EN sak (ägarbeslut 2026-10-26): värdet med hänsyn
 * till föreningens ekonomi när det finns (`justeradVardering`), annars
 * modellens värdering. Ligger priset inom det visade spannet (±10 % av det
 * exakta värdet, ändarna avrundade) är det "i linje med modellen", annars över
 * eller under spannet; aldrig ett procenttal mot basvärderingen och aldrig
 * "kan vara attraktivt". Säger vilket prisläge värderingen speglar
 * (träningsperioden, inte "idag" i någon strikt mening — se MODEL_CARD.md), och
 * att det är en statistisk skattning, inte en besiktning av lägenheten.
 */
export function byggModellSlutsats(underlag: {
  /** undefined i den fristående priskollen när köparen inte angett något pris. */
  utgangspris: number | undefined;
  resultat: ModellVarderingUnderlag["resultat"];
  avvikelseMotForeningen: number | undefined;
  /** Exakt värde med hänsyn till föreningens ekonomi; undefined utan justering. */
  justeradVardering: number | undefined;
}): string {
  const { utgangspris, resultat, avvikelseMotForeningen, justeradVardering } = underlag;
  const omradeText =
    resultat.tackning === "stockholm"
      ? (resultat.omrade ?? "Stockholm (postnumret gick inte att koppla till ett specifikt område)")
      : (resultat.kommun ?? "riket");
  const periodText = formatDataperiod(resultat.dataperiod);
  const jamforVarde = justeradVardering ?? resultat.varde;

  const delar: string[] = [];
  if (utgangspris === undefined) {
    delar.push(
      `Inget utgångspris har angetts, så Binfos värderingsmodell för ${omradeText} jämförs inte ` +
        `med något pris.`,
    );
  } else if (jamforVarde > 0) {
    const lage = lageMotVardespann(utgangspris, jamforVarde);
    const spann = `${formatVardespann(jamforVarde)} (±${VARDESPANN_PROCENT} %)`;
    const kring =
      justeradVardering !== undefined
        ? "värdet med hänsyn till föreningens ekonomi"
        : `Binfos värderingsmodell för ${omradeText}`;
    delar.push(
      lage === "inom"
        ? `Utgångspriset är i linje med modellen: det ligger inom det ungefärliga spannet ${spann} kring ${kring}.`
        : `Utgångspriset ligger ${lage === "over" ? "över" : "under"} det ungefärliga spannet ${spann} kring ${kring}.`,
    );
  } else {
    delar.push(`Binfos värderingsmodell för ${omradeText} kunde inte jämföras med utgångspriset.`);
  }
  delar.push(
    `Värderingen speglar prisläget ${periodText} och är en statistisk skattning — inte en ` +
      `besiktning av just den här lägenheten.`,
  );
  if (resultat.tackning !== "stockholm" && resultat.prisniva) {
    delar.push(
      resultat.tackning === "lan"
        ? `Den bygger på generella samband från Stockholm, skalade till genomsnittspriset i ${omradeText} ` +
            `(${prisnivaCitat(resultat.prisniva)}); modellen är inte tränad på försäljningar där.`
        : "Den bygger på generella samband från Stockholm och riksgenomsnittet för bostadsrätter " +
            `(${prisnivaCitat(resultat.prisniva)}) och kan vara betydligt mindre träffsäker.`,
    );
  }
  if (avvikelseMotForeningen !== undefined) {
    const riktning = avvikelseMotForeningen >= 0 ? "över" : "under";
    delar.push(
      `Kvadratmeterpriset ligger ${procent(avvikelseMotForeningen)} % ${riktning} snittet för de ` +
        `senaste försäljningarna i föreningen.`,
    );
  }
  return delar.join(" ");
}

/** Föreningens identitet för de prisdatakällor som kan slå upp något på den
 *  (försäljningar i föreningen). Bara den fullständiga analysen har den. */
export interface Foreningsuppslag {
  orgnr: string;
  ort?: string;
  adress?: string;
}

/**
 * PropertyInput -> PrisInput: exakt värderingsdelmängden (kontraktet,
 * src/types/analysis.ts). Den fullständiga analysen anropar den delade
 * värderingskärnan nedan med det här — samma kärna som den fristående
 * priskollen (src/server/prisuppskattning.ts) — så de två kan aldrig ge
 * olika värdering för samma lägenhet.
 */
export function tillPrisInput(input: PropertyInput): PrisInput {
  return {
    boarea: input.boarea,
    antalRum: input.antalRum,
    manadsavgift: input.manadsavgift,
    postnummer: input.postnummer,
    ...(input.vaning !== undefined ? { vaning: input.vaning } : {}),
    ...(input.byggar !== undefined ? { byggar: input.byggar } : {}),
    hiss: input.hiss,
    balkong: input.balkong,
    ...(input.utgangspris !== undefined ? { utgangspris: input.utgangspris } : {}),
  };
}

/** Utgångspriset och kvadratmeterpriset som figurer. */
function utgangsprisFigurer(
  utgangspris: number,
  boarea: number,
): { utgangspris: Figure; prisPerM2: Figure } {
  const prisPerM2Varde = boarea > 0 ? Math.round(utgangspris / boarea) : null;
  return {
    utgangspris: { value: utgangspris, unit: "kr", source: "anvandare" },
    prisPerM2: { value: prisPerM2Varde, unit: "kr/m2", source: "berakning" },
  };
}

/**
 * DEN DELADE VÄRDERINGSKÄRNAN — enda stället där värderingsfälten i en
 * Prisanalys räknas fram (externVardering, varderingsunderlag, budpremie,
 * konfidens, slutsats, och avvikelseMotVardering/utgangspris/prisPerM2 när
 * ett utgångspris finns). Både den fristående priskollen
 * (src/server/prisuppskattning.ts) och den fullständiga analysen
 * (byggPrisanalys nedan) går hit: paritet genom konstruktion, inte genom
 * dubblering.
 *
 * avvikelseMotVardering/avvikelseMotForeningen beräknas ENDAST när
 * respektive underlag faktiskt bär ett numeriskt value — DemoPrisdatakalla
 * lämnar avsiktligt value: null på sina platshållarfigurer just för att
 * förhindra att en påhittad procentsats räknas fram här (se prisdata.ts:s
 * filkommentar). Fälten utelämnas helt när de inte går att räkna — de sätts
 * aldrig till undefined (exactOptionalPropertyTypes).
 *
 * Utan utgångspris (den fristående priskollen när köparen inte angett något)
 * finns ingen avvikelse att räkna; slutsatsen säger då bara vad värderingen
 * bygger på.
 *
 * `foreningsuppslag` saknas i den fristående priskollen: källan får då ingen
 * orgnr och ska svara tom lista på försäljningar i föreningen.
 */
export async function byggPrisanalysUtanForening(
  input: PrisInput,
  prisdatakalla: Prisdatakalla,
  foreningsuppslag?: Foreningsuppslag,
): Promise<PrisanalysUtanForening> {
  const forfragan: Prisdataforfragan = {
    ...(foreningsuppslag
      ? {
          orgnr: foreningsuppslag.orgnr,
          ...(foreningsuppslag.ort !== undefined ? { ort: foreningsuppslag.ort } : {}),
          ...(foreningsuppslag.adress !== undefined ? { adress: foreningsuppslag.adress } : {}),
        }
      : {}),
    boarea: input.boarea,
    postnummer: input.postnummer,
    antalRum: input.antalRum,
    manadsavgift: input.manadsavgift,
    ...(input.vaning !== undefined ? { vaning: input.vaning } : {}),
    ...(input.byggar !== undefined ? { byggar: input.byggar } : {}),
    hiss: input.hiss,
    balkong: input.balkong,
  };

  const [vardering, forsaljningar, omradeMedian] = await Promise.all([
    prisdatakalla.hamtaVardering(forfragan),
    prisdatakalla.hamtaForsaljningarIForeningen(forfragan),
    prisdatakalla.hamtaOmradeMedian(forfragan),
  ]);

  const prisFigurer =
    input.utgangspris !== undefined ? utgangsprisFigurer(input.utgangspris, input.boarea) : null;
  const prisPerM2Varde = prisFigurer?.prisPerM2.value ?? null;

  let avvikelseMotVardering: number | undefined;
  if (
    input.utgangspris !== undefined &&
    vardering &&
    vardering.value !== null &&
    vardering.value !== 0
  ) {
    avvikelseMotVardering =
      Math.round(((input.utgangspris - vardering.value) / vardering.value) * 1000) / 10;
  }

  // Jämförs mot föreningens EGNA försäljningar (tightare underlag än
  // områdesmedianen, se kontraktskommentaren på Prisanalys), inte mot
  // omradeMedianPrisPerM2.
  const kandaForsaljningspriser = forsaljningar
    .map((f) => f.prisPerM2.value)
    .filter((v): v is number => v !== null);
  let avvikelseMotForeningen: number | undefined;
  if (kandaForsaljningspriser.length > 0 && prisPerM2Varde !== null) {
    const snitt =
      kandaForsaljningspriser.reduce((a, b) => a + b, 0) / kandaForsaljningspriser.length;
    if (snitt !== 0) {
      avvikelseMotForeningen = Math.round(((prisPerM2Varde - snitt) / snitt) * 1000) / 10;
    }
  }

  // En schablon är INTE en oberoende prisreferens. Den känner varken objektet,
  // läget eller skicket — den är ett platt antagande som råkar ha ett värde.
  // Att räkna den som underlag skulle höja konfidensen på ren gissning, vilket
  // är precis det CLAUDE.md förbjuder: en gissning får aldrig se ut som ett
  // faktum. Bara källor med annan proveniens än 'schablon' räknas här.
  // Kräver ett faktiskt värde: DemoPrisdatakalla är också 'schablon' men
  // lämnar value: null, och då har ingen jämförelse gjorts alls — då gäller
  // det vanliga "ingen prisdata"-svaret, inte schablonformuleringen.
  const varderingArSchablon =
    vardering !== null && vardering.value !== null && vardering.source === "schablon";
  const oberoendeVardering =
    vardering !== null && vardering.value !== null && vardering.source !== "schablon";
  const oberoendeMedian =
    omradeMedian !== null && omradeMedian.value !== null && omradeMedian.source !== "schablon";

  // Konfidensnivån är en bedömning av HUR MYCKET oberoende underlag som
  // faktiskt kom tillbaka — inte ett citerat riktvärde, utan en läsbar
  // regel: 0 oberoende källor ger låg konfidens, 1 ger medel, 2–3 källor
  // (flera oberoende bekräftelser av samma prisnivå) ger hög.
  const antalOberoendeKallor = [
    oberoendeVardering,
    kandaForsaljningspriser.length > 0,
    oberoendeMedian,
  ].filter(Boolean).length;

  const harOberoendeData = antalOberoendeKallor > 0;

  // Kör Binfos egen värderingsmodell direkt ur `input` — oberoende av vad
  // prisdatakalla faktiskt returnerade, men på exakt samma fält som
  // ModellPrisdatakalla.hamtaVardering(forfragan) använder (forfragan är
  // byggd ur precis de här input-fälten ovan), så de två körningarna aldrig
  // kan säga olika saker. Null betyder "ingen värdering möjlig" (tomt eller
  // felformaterat postnummer), oavsett vilken prisdatakalla som faktiskt
  // användes.
  const modellRun = korBinfoVarderingsmodell(input);
  const inomVarderingensRackvidd = modellRun !== null;
  // Bara meningsfullt att koppla varderingsunderlag/budpremie till DEN HÄR
  // externVardering:en när den faktiskt kom från en schablon med ett tal —
  // se varderingArSchablon ovan. Utan det villkoret skulle en riktig
  // 'extern' källa (eller en annan schablonkälla än Binfos egen, t.ex. i
  // tester) felaktigt få Binfo-modellens underlag hängt på sig.
  const modellUnderlag = varderingArSchablon ? modellRun : null;

  let konfidens: Konfidens;
  let slutsats: string;
  let varderingsunderlag: Varderingsunderlag | undefined;
  let budpremie: Budpremie | undefined;

  if (modellUnderlag) {
    // Fall A: externVardering kom från Binfos egen värderingsmodell.
    konfidens = konfidensForModell(modellUnderlag.resultat);
    slutsats = byggModellSlutsats({
      utgangspris: input.utgangspris,
      resultat: modellUnderlag.resultat,
      avvikelseMotForeningen,
      justeradVardering: undefined,
    });
    varderingsunderlag = {
      modellVersion: modellUnderlag.resultat.modellVersion,
      omrade: modellUnderlag.resultat.omrade,
      intervallTackningProcent: modellUnderlag.resultat.intervallTackningProcent,
      dataperiod: modellUnderlag.resultat.dataperiod,
      antalForsaljningar: modellUnderlag.resultat.antalForsaljningar,
      typisktFelProcent: modellUnderlag.resultat.typisktFelProcent,
      drivare: modellUnderlag.drivare,
      tackning: modellUnderlag.resultat.tackning,
      kommun: modellUnderlag.resultat.kommun,
      ...(modellUnderlag.resultat.prisniva ? { prisniva: modellUnderlag.resultat.prisniva } : {}),
    };
    if (modellUnderlag.budpremie) budpremie = modellUnderlag.budpremie;
  } else if (!inomVarderingensRackvidd && !harOberoendeData) {
    // Fall B: ingen värdering går att räkna fram eftersom postnumret saknas
    // eller är felformaterat (t.ex. en anonymiserad rapport), och ingen
    // annan oberoende prisdata finns heller. Postnummer utanför Stockholm
    // hamnar INTE här — de får en egen uppskattning (Fall A, 'lag').
    konfidens = konfidensUtanPostnummer();
    slutsats =
      input.utgangspris !== undefined
        ? "Postnumret saknas eller är ogiltigt, så Binfos värdering kan inte räknas fram och " +
          "utgångspriset har inte kunnat stämmas av mot någon värdering. Prisbedömningen bygger " +
          "enbart på det angivna utgångspriset."
        : "Postnumret saknas eller är ogiltigt, så Binfos värdering kan inte räknas fram.";
  } else {
    // Fall C: allt annat — en annan schablonkälla än Binfos modell, en
    // riktig oberoende källa (source 'extern'), eller en blandning. Samma
    // källoberoende logik som innan task 4g.
    konfidens = !harOberoendeData
      ? varderingArSchablon
        ? {
            niva: "lag",
            skal: [
              (input.utgangspris !== undefined
                ? "Utgångspriset är endast jämfört med en schablon — "
                : "Värderingen är endast en schablon — ") +
                "ett platt kvadratmeterpris som " +
                "inte tar hänsyn till läge, skick eller våning. Ingen oberoende priskälla är ansluten.",
            ],
          }
        : konfidensUtanPrisdata(input.utgangspris !== undefined)
      : antalOberoendeKallor >= 2
        ? { niva: "hog" }
        : { niva: "medel", skal: ["Endast en oberoende prisreferens kunde hämtas."] };

    slutsats = byggSlutsats({
      harOberoendeData,
      varderingArSchablon,
      avvikelseMotVardering,
      avvikelseMotForeningen,
      harUtgangspris: input.utgangspris !== undefined,
    });
  }

  return {
    ...(prisFigurer ?? {}),
    ...(vardering ? { externVardering: vardering } : {}),
    senasteForsaljningarIForeningen: forsaljningar,
    ...(omradeMedian ? { omradeMedianPrisPerM2: omradeMedian } : {}),
    ...(avvikelseMotVardering !== undefined ? { avvikelseMotVardering } : {}),
    ...(avvikelseMotForeningen !== undefined ? { avvikelseMotForeningen } : {}),
    slutsats,
    konfidens,
    ...(varderingsunderlag ? { varderingsunderlag } : {}),
    ...(budpremie ? { budpremie } : {}),
  };
}

/**
 * Bygger Prisanalys-blocket för den fullständiga analysen: den delade
 * värderingskärnan ovan (byggPrisanalysUtanForening) med PropertyInput
 * mappad till PrisInput och föreningens identitet för uppslag. Lägger inte
 * till något eget i värderingsfälten — BRF-lagret (andelAvForeningensSkuld)
 * läggs på i assembleraAnalys, där extraktionen finns.
 *
 * Exporterad (utöver assembleraAnalys) så den kan enhetstestas direkt utan
 * att gå via hela AnalysisResultSchema-valideringen i assembleraAnalys.
 */
export async function byggPrisanalys(
  input: PropertyInput,
  prisdatakalla: Prisdatakalla,
): Promise<Prisanalys> {
  const karna = await byggPrisanalysUtanForening(tillPrisInput(input), prisdatakalla, {
    orgnr: input.orgnr,
    ...(input.ort !== undefined ? { ort: input.ort } : {}),
    adress: input.adress,
  });
  // Kärnan sätter utgangspris/prisPerM2 när ett utgångspris skickas in;
  // utan pris utelämnas båda (samma ren funktion, identiska värden).
  return {
    ...(input.utgangspris !== undefined ? utgangsprisFigurer(input.utgangspris, input.boarea) : {}),
    ...karna,
  };
}

/**
 * Slutmonterar ett fullständigt AnalysisResult. Inget modellanrop — allt
 * som produceras här är antingen en ren beräkning (rantestress, prisanalys,
 * datakvalitet, saknad_uppgift-frågor) eller en direkt kopiering av det
 * anroparen redan tagit fram (input, forening, pass 2:s
 * betyg/rodaFlaggor/analys-frågor).
 *
 * BESLUT (task 7, ägarbeslut) — en genuint saknad räntekänslighet FÅLLER
 * INTE längre hela analysen: `beraknaRantestress` degraderar numera i
 * stället för att kasta `SaknarRantekanslighetError` (se den funktionens
 * filkommentar i rantestress.ts). Den här funktionen bygger på det genom
 * att, ENDAST när `rantestress.rantekanslighetProcent` kom tillbaka `null`,
 * lägga till en deterministisk fråga till mäklaren (om inte pass 2 redan
 * skrev en fråga eller flagga om exakt samma sak — se
 * `harRedanFragaOmRantekanslighet`) och sänka `datakvalitet.extraktionKonfidens`
 * högst ett steg (se `sankKonfidensForSaknadRantekanslighet`). En genuint
 * skuldfri förenings härledda 0:a (tolkaVarde.ts's
 * `harledSkuldfriaNyckeltal`, kört långt innan detta, i extraktionens
 * pipeline) gör att `rantekanslighetProcent` ALDRIG är null i det fallet —
 * ingen av de här två sidoeffekterna triggas då.
 *
 * FÖRIFYLLNING AV avgiftInkluderar: PropertyInput.avgiftInkluderar är
 * kontraktets EFFEKTIVA värde, avsett att förifyllas från föreningens
 * avgiftInkluderarEnligtForening vid orkestrering och sedan vara
 * användarövergripbart därifrån — se kontraktskommentaren på
 * Forening.avgiftInkluderarEnligtForening. Den här funktionen implementerar
 * INTE den förifyllningspolicyn; den tar input precis som den fått den och
 * genererar saknad_uppgift-frågor för det som fortfarande är 'okant' i just
 * det den fick (med ett undantag: den hoppar över frågan om föreningen
 * redan gett ett definitivt ja/nej, se genereraSaknadUppgiftFragor ovan).
 */
/**
 * Modellens betygsmotivering kan räkna upp hur många nyckeltal som bedömts
 * ("Två av sju nyckeltal har status 'svag'"). Sjutton… rapporten visar bara de
 * bedömda nyckeltalen — varje tal med status "okänt" filtreras bort i
 * AnalysRapport.tsx — så ett totalantal som "sju" är ett påstående sidan inte
 * längre kan backa. Antalet tas därför bort ur partivformen "av <antal>
 * nyckeltal(en)", som då blir bestämd plural: "Två av nyckeltalen har status
 * 'svag'". Bestämd plural är dessutom det grammatiskt korrekta efter "av".
 *
 * Endast former med ett uttryckligt antal ersätts — en mening som redan säger
 * "av nyckeltalen" lämnas orörd.
 */
const NYCKELTALORTAL = "(?:\\d+|ett|två|tre|fyra|fem|sex|sju|åtta|nio|tio|elva|tolv|ton)";
const AV_ANTAL_NYCKELTAL = new RegExp(
  `\\bav\\s+(?:de\\s+)?${NYCKELTALORTAL}\\s+(?:lagstadgade\\s+)?nyckeltal(en)?\\b`,
  "gi",
);

export function utanNyckeltalsantal(text: string): string {
  return text.replace(AV_ANTAL_NYCKELTAL, (match) =>
    match.startsWith("A") ? "Av nyckeltalen" : "av nyckeltalen",
  );
}

/** YYYY-MM-DD in Stockholm time — the day the fee prognosis horizon starts. */
function idagStockholm(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const ALLVARLIGHET_RANG: Record<RedFlag["severity"], number> = { hog: 0, medel: 1, lag: 2 };

/**
 * Red flags on read (round 2026-10-26). When the prognosis has per-loan rows,
 * Binfo's own refinancing flag (built from the SAME component as the loan
 * table) replaces any model flag about maturities: the model writes once,
 * without today's date, and once said the fee may rise where the table showed
 * a fall. Without loan rows the model's flags stay as they are. The new flag
 * goes in before the first flag of lower severity, so `betygText` in the
 * summary picks it up by the usual rule.
 */
export function rodaFlaggorMedRefinansiering(
  modellFlaggor: readonly RedFlag[],
  prognos: Avgiftsprognos,
  totalSkuld: number | null,
): RedFlag[] {
  const harLanrader = (prognos.refinansiering?.lan?.length ?? 0) > 0;
  const kvar = harLanrader
    ? modellFlaggor.filter((f) => !arRefinansieringsflagga(f))
    : [...modellFlaggor];
  const flagga = harLanrader ? byggRefinansieringsflagga(prognos, totalSkuld) : null;
  if (!flagga) return kvar;
  const plats = kvar.findIndex(
    (f) => ALLVARLIGHET_RANG[f.severity] > ALLVARLIGHET_RANG[flagga.severity],
  );
  return plats === -1 ? [...kvar, flagga] : [...kvar.slice(0, plats), flagga, ...kvar.slice(plats)];
}

/**
 * A model flag ABOUT byggår being missing (its title or opening sentence says
 * so), shown when the buyer or the report has the year (round 2026-10-26): the
 * judging model never sees the buyer's input. Flags that only mention it in
 * passing are kept, minus that sentence (`utanByggarSaknasMeningar`).
 */
export function flaggarBaraOmSaknatByggar(f: Pick<RedFlag, "titel" | "beskrivning">): boolean {
  const forsta = f.beskrivning.split(/(?<=[.!?])\s+/)[0] ?? "";
  return sagerAttByggarSaknas(f.titel) || sagerAttByggarSaknas(forsta);
}

/** A flag without its sentences claiming byggår is missing (same rule as the skal). */
export function utanByggarSaknasMeningar(f: RedFlag): RedFlag {
  const meningar = f.beskrivning.split(/(?<=[.!?])\s+/);
  const kvar = meningar.filter((m) => !sagerAttByggarSaknas(m));
  return kvar.length === meningar.length ? f : { ...f, beskrivning: kvar.join(" ") };
}

/** Deterministic question when the expected fee rise trips the sanity guard. */
function avgiftsprognosFraga(orsak: string): Fraga {
  return {
    id: "avgiftsprognos-osaker",
    fraga:
      "Planerar styrelsen avgiftshöjningar de närmaste åren, och i så fall hur stora — och " +
      "stämmer de kostnader och lån vi läst ut ur årsredovisningen?",
    ursprung: "analys",
    riktadTill: "styrelsen",
    varfor:
      `${orsak}${/[.!?]$/.test(orsak.trim()) ? "" : "."} Ett så stort belopp kan bero på att ` +
      "vi läst en siffra fel, så det är värt att få bekräftat innan du bestämmer budnivå.",
    svarssignal:
      "Bra svar: en konkret plan med belopp och tidpunkt. Varningssignal: att ingen vet eller " +
      "att höjningen ska skjutas upp utan finansiering.",
  };
}

export async function assembleraAnalys({
  extraction,
  input,
  prisdatakalla,
  analys,
  analysisId,
  skapad,
  referensranta,
  idag,
}: AssembleraAnalysInput): Promise<AnalysisResult> {
  // Report vs the buyer's input (round 2026-10-24b). Förening-level byggår
  // from the report wins at high confidence and feeds the valuation; the
  // stored input itself is never changed.
  const jamforelse = jamforUppgifter({
    input,
    forening: extraction.forening,
    datakvalitet: extraction.datakvalitet,
  });
  // Statuses are re-graded with today's bands on every read (round
  // 2026-10-26), so a stored "god" from older bands never shows next to a
  // prognosis that uses the newer reference. Grades are untouched.
  const forening: Forening = {
    ...extraction.forening,
    keyFigures: omgraderaNyckeltal(extraction.forening.keyFigures),
  };
  const { byggar: _anvandarensByggar, ...utanByggar } = input;
  const varderingsInput: PropertyInput =
    jamforelse.byggarForVardering !== undefined
      ? { ...utanByggar, byggar: jamforelse.byggarForVardering }
      : utanByggar;

  // Degraderar numera i stället för att kasta — se filkommentaren ovan.
  const rantestressBas: Rantestress = beraknaRantestress(extraction.forening, input.manadsavgift);
  const rantekanslighetSaknas = rantestressBas.rantekanslighetProcent === null;
  const andelAvForeningensSkuld = beraknaAndelAvForeningensSkuld(extraction.forening, input.boarea);
  const basPrisanalys = await byggPrisanalys(varderingsInput, prisdatakalla);

  // The ONE channel from the report to the price: the expected fee rise
  // (docs/avgiftsprognos.md). The grade never enters here.
  const prognos = beraknaAvgiftsprognos({
    forening: extraction.forening,
    ...(extraction.kontrollsummor ? { kontrollsummor: extraction.kontrollsummor } : {}),
    manadsavgift: input.manadsavgift,
    boarea: input.boarea,
    // Building age for the schablon savings target: the byggår the valuation
    // uses (report at high confidence, else the buyer's), else the report's.
    ...(() => {
      const byggar = varderingsInput.byggar ?? extraction.forening.byggar?.value ?? undefined;
      return byggar !== undefined && byggar !== null ? { byggar } : {};
    })(),
    hiss: input.hiss,
    referensranta: referensranta ?? reservReferensranta(),
    idag: idag ?? idagStockholm(),
  });

  // Only Binfo's own model is adjusted (a real external valuation would
  // already be a market view of this flat).
  const modellBaslinje =
    basPrisanalys.varderingsunderlag &&
    basPrisanalys.externVardering &&
    basPrisanalys.externVardering.value !== null
      ? {
          value: basPrisanalys.externVardering.value,
          ...(basPrisanalys.externVardering.range
            ? { range: basPrisanalys.externVardering.range }
            : {}),
        }
      : null;
  const justering = byggPrisjustering({
    baseline: modellBaslinje,
    boarea: input.boarea,
    prognos,
    ...(input.utgangspris !== undefined ? { utgangspris: input.utgangspris } : {}),
  });

  // BRF-lagret läggs på EFTER den delade värderingskärnan och rör inga av
  // dess fält — skuldandelen är en kommentar, ingen prisjustering.
  // One comparison (owner 2026-10-26): with an adjusted value the conclusion
  // compares the asking price only with it (the core wrote the baseline version).
  const modellKorning =
    justering?.justeradVardering && basPrisanalys.varderingsunderlag
      ? korBinfoVarderingsmodell(tillPrisInput(varderingsInput))
      : null;
  const justeradSlutsats =
    modellKorning && justering?.justeradVardering
      ? byggModellSlutsats({
          utgangspris: input.utgangspris,
          resultat: modellKorning.resultat,
          avvikelseMotForeningen: basPrisanalys.avvikelseMotForeningen,
          justeradVardering: justering.justeradVardering.value ?? undefined,
        })
      : undefined;
  const prisanalys: Prisanalys = {
    ...basPrisanalys,
    ...(andelAvForeningensSkuld ? { andelAvForeningensSkuld } : {}),
    ...(justering ?? {}),
    ...(justeradSlutsats !== undefined ? { slutsats: justeradSlutsats } : {}),
  };
  const prognosTabell = byggPrognosTabell(
    input.manadsavgift,
    prognos,
    rantestressBas.rantekanslighetProcent,
  );
  const rantestress: Rantestress = prognosTabell
    ? { ...rantestressBas, prognosTabell }
    : rantestressBas;

  // Model-written text claiming byggår is missing, when the buyer or the
  // report has it (neither model sees the buyer's input).
  const byggarKant = input.byggar !== undefined || extraction.forening.byggar?.value != null;
  const modellSkal = extraction.datakvalitet.extraktionKonfidens.skal;
  const extraktionKonfidensRensad =
    byggarKant && modellSkal
      ? {
          ...extraction.datakvalitet.extraktionKonfidens,
          skal: modellSkal.filter((rad) => !sagerAttByggarSaknas(rad)),
        }
      : extraction.datakvalitet.extraktionKonfidens;
  const analysFragor = byggarKant
    ? analys.fragor.filter((f) => !(fragarBaraOmByggar(f) || sagerAttByggarSaknas(f.fraga)))
    : analys.fragor;

  const uppgiftsstatus = berakUppgiftsstatus(input);
  const extraktionKonfidens = rantekanslighetSaknas
    ? sankKonfidensForSaknadRantekanslighet(extraktionKonfidensRensad)
    : extraktionKonfidensRensad;
  const datakvalitet: AnalysisResult["datakvalitet"] = {
    pdfSaknarTextlager: extraction.datakvalitet.pdfSaknarTextlager,
    extraktionKonfidens,
    ...(extraction.datakvalitet.kalla ? { kalla: extraction.datakvalitet.kalla } : {}),
    uppgifterKanda: uppgiftsstatus.kanda,
    uppgifterTotalt: uppgiftsstatus.totalt,
    saknadeFalt: uppgiftsstatus.saknade,
  };

  const saknadUppgiftFragor = genereraSaknadUppgiftFragor(input, extraction.forening);
  const rantekanslighetFraga: Fraga[] =
    rantekanslighetSaknas && !harRedanFragaOmRantekanslighet(analys)
      ? [SAKNAR_RANTEKANSLIGHET_FRAGA]
      : [];
  const skuldFraga: Fraga[] =
    andelAvForeningensSkuld === null && !harRedanFragaOmSkuldPerM2(analys)
      ? [SAKNAR_SKULD_PER_M2_FRAGA]
      : [];
  const avgiftFraga = avgiftsavvikelseFraga(input, extraction.forening, prognos.hojningIKraft);
  const prognosFraga: Fraga[] = prognos.prognos.osaker
    ? [avgiftsprognosFraga(prognos.prognos.osaker)]
    : [];
  // Lokal leases ending without a stated renewal, and cited loss signals
  // (owner 2026-10-25): deterministic questions for the styrelse, skipped when
  // the model already asks about lokaler / hyresavtal / hyresgäster.
  const lokalFragorLista = lokalFragor({
    forening: extraction.forening,
    arsavgifter: extraction.kontrollsummor?.arsavgifter?.value ?? undefined,
    idag: prognos.prognos.berakningsdatum,
    befintliga: [...analysFragor, ...saknadUppgiftFragor, ...prognosFraga],
  });
  const osakerFragor = osakerhetsfragor(extraction.forening, [
    ...analysFragor,
    ...saknadUppgiftFragor,
    ...rantekanslighetFraga,
    ...skuldFraga,
    ...(avgiftFraga ? [avgiftFraga] : []),
  ]);

  const utanSammanfattning: Omit<AnalysisResult, "sammanfattning"> = {
    schemaVersion: "1.0.0",
    // Globala crypto.randomUUID(), inte node:crypto — samma API finns i
    // Cloudflare Workers (dit appen byggs), i Node 19+ och i webbläsaren,
    // så sammanställningen kan köras var som helst utan kompatibilitetsflagga.
    // Injicerade av anroparen tar alltid företräde: en serverlagring som
    // kör om samma jobbrad (stabilt id + skapad-tidsstämpel redan satta)
    // måste få byte-identiskt JSON tillbaka, inte ett nytt id/datum varje gång.
    analysisId: analysisId ?? crypto.randomUUID(),
    skapad: skapad ?? new Date().toISOString(),

    input,
    forening,

    betyg: analys.betyg,
    betygMotivering: utanNyckeltalsantal(analys.betygMotivering),

    rodaFlaggor: rodaFlaggorMedRefinansiering(
      byggarKant
        ? analys.rodaFlaggor
            .filter((f) => !flaggarBaraOmSaknatByggar(f))
            .map(utanByggarSaknasMeningar)
        : analys.rodaFlaggor,
      prognos.prognos,
      extraction.forening.lanebok?.totalSkuld.value ?? null,
    ),
    prisanalys,
    rantestress,
    fragor: [
      ...analysFragor,
      ...saknadUppgiftFragor,
      ...rantekanslighetFraga,
      ...skuldFraga,
      ...(avgiftFraga ? [avgiftFraga] : []),
      ...prognosFraga,
      ...lokalFragorLista,
      ...osakerFragor,
    ],

    datakvalitet,

    avgiftsprognos: prognos.prognos,
    ...(jamforelse.rader.length > 0 ? { uppgiftsjamforelse: jamforelse.rader } : {}),

    gratisSektioner: ["betyg", "rodaFlaggor_topp2", "datakvalitet"],
  };
  const resultat: AnalysisResult = {
    ...utanSammanfattning,
    sammanfattning: byggSammanfattning(utanSammanfattning),
  };

  const parsed = AnalysisResultSchema.safeParse(resultat);
  if (!parsed.success) {
    throw new AssemblyValidationError(parsed.error, resultat);
  }
  return resultat;
}
