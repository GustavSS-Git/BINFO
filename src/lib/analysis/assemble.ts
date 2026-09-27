import type { z } from "zod";
import type {
  AnalysisResult,
  Budpremie,
  ExtractionResult,
  FeeInclusion,
  Figure,
  Forening,
  Fraga,
  Konfidens,
  Prisanalys,
  PropertyInput,
  Rantestress,
  Varderingsunderlag,
} from "@/types/analysis";
import { formatDataperiod } from "@/lib/analysisView";
import { AnalysisResultSchema } from "./schema";
import type { AnalysJudgement } from "./analyze";
import { beraknaRantestress } from "./calc/rantestress";
import {
  konfidensUtanPrisdata,
  konfidensUtanforStockholm,
  korBinfoVarderingsmodell,
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
  /** Injiceras av anroparen — TomPrisdatakalla i produktion tills en riktig
   *  källa finns, DemoPrisdatakalla för utveckling/demo. */
  prisdatakalla: Prisdatakalla;
  /** Pass 2:s betyg/rodaFlaggor/fragor(ursprung 'analys'), redan Zod-validerat. */
  analys: AnalysJudgement;
  /** Injicera för idempotent omkörning mot en befintlig jobbrad (t.ex. en
   *  Supabase-backad serverlagring) — samma id/datum in ska ge byte-identiskt
   *  JSON ut. Utelämnas i normalfallet, då genereras båda internt. */
  analysisId?: string;
  skapad?: string;
}

const AVGIFTSPOSTER: ReadonlyArray<{ id: keyof FeeInclusion; label: string }> = [
  { id: "varme", label: "värme" },
  { id: "vatten", label: "vatten" },
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
      varfor: "Uppgiften om hiss saknas — det påverkar både värdet och tillgängligheten.",
    });
  }

  if (input.balkong === "okant") {
    fragor.push({
      id: "saknad-balkong",
      fraga: "Har lägenheten balkong eller uteplats?",
      ursprung: "saknad_uppgift",
      riktadTill: "maklaren",
      varfor: "Uppgiften om balkong saknas — det påverkar både pris och jämförbarhet.",
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
      varfor: `Om ${post.label} ingår i avgiften eller inte påverkar den faktiska månadskostnaden.`,
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
    "för högre ränta.",
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
}): string {
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
 * värderingsmodell (task 4g:s produktbeslut): aldrig 'hog' — modellens eget
 * uppmätta typiska fel (8–18 % beroende på område, se
 * ml/artifacts/valuation-v2/MODEL_CARD.md) gör det oärligt att kalla den
 * hög konfidens — 'medel' när postnumret gick att koppla till ett specifikt
 * Stockholmsområde, annars 'lag' (hela Stockholm som fallback-område ger
 * märkbart lägre precision, se MODEL_CARD.mds per-område-MAPE).
 */
function konfidensForModell(resultat: ModellVarderingUnderlag["resultat"]): Konfidens {
  const felText = resultat.typisktFelProcent.toLocaleString("sv-SE", { maximumFractionDigits: 1 });
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

/**
 * Slutsatsen när externVardering kom från Binfos egen värderingsmodell.
 * Säger uttryckligen om utgångspriset ligger inom eller utanför modellens
 * 90-procentiga intervall (inte bara över/under punktskattningen), vilket
 * prisläge värderingen speglar (träningsperioden, inte "idag" i någon
 * strikt mening — se MODEL_CARD.md), och att det är en statistisk skattning,
 * inte en besiktning av just den här lägenheten.
 */
function byggModellSlutsats(underlag: {
  utgangspris: number;
  resultat: ModellVarderingUnderlag["resultat"];
  avvikelseMotVardering: number | undefined;
  avvikelseMotForeningen: number | undefined;
}): string {
  const { utgangspris, resultat, avvikelseMotVardering, avvikelseMotForeningen } = underlag;
  const omradeText =
    resultat.omrade ?? "Stockholm (postnumret gick inte att koppla till ett specifikt område)";
  const innanforIntervallet =
    utgangspris >= resultat.intervall.low && utgangspris <= resultat.intervall.high;
  const periodText = formatDataperiod(resultat.dataperiod);

  const delar: string[] = [];
  if (avvikelseMotVardering !== undefined) {
    const riktning = avvikelseMotVardering >= 0 ? "över" : "under";
    delar.push(
      `Utgångspriset ligger ${procent(avvikelseMotVardering)} % ${riktning} Binfos värderingsmodell ` +
        `för ${omradeText} och ligger ${innanforIntervallet ? "inom" : "utanför"} modellens ` +
        `${resultat.intervallTackningProcent}-procentiga intervall.`,
    );
  } else {
    delar.push(
      `Binfos värderingsmodell för ${omradeText} kunde inte jämföras med utgångspriset i procent.`,
    );
  }
  delar.push(
    `Värderingen speglar prisläget ${periodText} och är en statistisk skattning — inte en ` +
      `besiktning av just den här lägenheten.`,
  );
  if (avvikelseMotForeningen !== undefined) {
    const riktning = avvikelseMotForeningen >= 0 ? "över" : "under";
    delar.push(
      `Kvadratmeterpriset ligger ${procent(avvikelseMotForeningen)} % ${riktning} snittet för de ` +
        `senaste försäljningarna i föreningen.`,
    );
  }
  return delar.join(" ");
}

/**
 * Bygger Prisanalys-blocket. avvikelseMotVardering/avvikelseMotForeningen
 * beräknas ENDAST när respektive underlag faktiskt bär ett numeriskt value —
 * DemoPrisdatakalla lämnar avsiktligt value: null på sina platshållarfigurer
 * just för att förhindra att en påhittad procentsats räknas fram här (se
 * prisdata.ts:s filkommentar). Fälten utelämnas helt när de inte går att
 * räkna — de sätts aldrig till undefined (exactOptionalPropertyTypes).
 *
 * Exporterad (utöver assembleraAnalys) så den kan enhetstestas direkt utan
 * att gå via hela AnalysisResultSchema-valideringen i assembleraAnalys —
 * se assemble.test.ts och kommentaren där om en känd, oberoende brist i
 * schema.ts:s externVardering-definition (FigureSchema.and(...) med ett
 * .strict()-schema på ena sidan avvisar det extra fältet 'leverantor'
 * varje riktig värdering måste ha).
 */
export async function byggPrisanalys(
  input: PropertyInput,
  prisdatakalla: Prisdatakalla,
): Promise<Prisanalys> {
  const forfragan: Prisdataforfragan = {
    orgnr: input.orgnr,
    boarea: input.boarea,
    postnummer: input.postnummer,
    ort: input.ort,
    adress: input.adress,
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

  const prisPerM2Varde = input.boarea > 0 ? Math.round(input.utgangspris / input.boarea) : null;

  const utgangspris: Figure = { value: input.utgangspris, unit: "kr", source: "anvandare" };
  const prisPerM2: Figure = { value: prisPerM2Varde, unit: "kr/m2", source: "berakning" };

  let avvikelseMotVardering: number | undefined;
  if (vardering && vardering.value !== null && vardering.value !== 0) {
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
  // kan säga olika saker. Null betyder "postnumret ligger utanför Binfos
  // modells räckvidd" (task 4g:s omfångsregel), oavsett vilken prisdatakalla
  // som faktiskt användes.
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
      avvikelseMotVardering,
      avvikelseMotForeningen,
    });
    varderingsunderlag = {
      modellVersion: modellUnderlag.resultat.modellVersion,
      omrade: modellUnderlag.resultat.omrade,
      intervallTackningProcent: modellUnderlag.resultat.intervallTackningProcent,
      dataperiod: modellUnderlag.resultat.dataperiod,
      antalForsaljningar: modellUnderlag.resultat.antalForsaljningar,
      typisktFelProcent: modellUnderlag.resultat.typisktFelProcent,
      drivare: modellUnderlag.drivare,
    };
    budpremie = modellUnderlag.budpremie;
  } else if (!inomVarderingensRackvidd && !harOberoendeData) {
    // Fall B: postnumret ligger utanför Binfos modells räckvidd (utanför
    // Stockholm, eller en anonymiserad rapport med tomt postnummer) och
    // ingen annan oberoende prisdata finns heller.
    konfidens = konfidensUtanforStockholm();
    slutsats =
      "Binfos värdering finns i dag bara för Stockholms kommun, så utgångspriset har inte " +
      "kunnat stämmas av mot någon värdering. Prisbedömningen bygger enbart på det angivna " +
      "utgångspriset.";
  } else {
    // Fall C: allt annat — en annan schablonkälla än Binfos modell, en
    // riktig oberoende källa (source 'extern'), eller en blandning. Samma
    // källoberoende logik som innan task 4g.
    konfidens = !harOberoendeData
      ? varderingArSchablon
        ? {
            niva: "lag",
            skal: [
              "Utgångspriset är endast jämfört med en schablon — ett platt kvadratmeterpris som " +
                "inte tar hänsyn till läge, skick eller våning. Ingen oberoende priskälla är ansluten.",
            ],
          }
        : konfidensUtanPrisdata()
      : antalOberoendeKallor >= 2
        ? { niva: "hog" }
        : { niva: "medel", skal: ["Endast en oberoende prisreferens kunde hämtas."] };

    slutsats = byggSlutsats({
      harOberoendeData,
      varderingArSchablon,
      avvikelseMotVardering,
      avvikelseMotForeningen,
    });
  }

  return {
    utgangspris,
    prisPerM2,
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
export async function assembleraAnalys({
  extraction,
  input,
  prisdatakalla,
  analys,
  analysisId,
  skapad,
}: AssembleraAnalysInput): Promise<AnalysisResult> {
  // Degraderar numera i stället för att kasta — se filkommentaren ovan.
  const rantestress: Rantestress = beraknaRantestress(extraction.forening, input.manadsavgift);
  const rantekanslighetSaknas = rantestress.rantekanslighetProcent === null;
  const prisanalys = await byggPrisanalys(input, prisdatakalla);

  const uppgiftsstatus = berakUppgiftsstatus(input);
  const extraktionKonfidens = rantekanslighetSaknas
    ? sankKonfidensForSaknadRantekanslighet(extraction.datakvalitet.extraktionKonfidens)
    : extraction.datakvalitet.extraktionKonfidens;
  const datakvalitet: AnalysisResult["datakvalitet"] = {
    pdfSaknarTextlager: extraction.datakvalitet.pdfSaknarTextlager,
    extraktionKonfidens,
    uppgifterKanda: uppgiftsstatus.kanda,
    uppgifterTotalt: uppgiftsstatus.totalt,
    saknadeFalt: uppgiftsstatus.saknade,
  };

  const saknadUppgiftFragor = genereraSaknadUppgiftFragor(input, extraction.forening);
  const rantekanslighetFraga: Fraga[] =
    rantekanslighetSaknas && !harRedanFragaOmRantekanslighet(analys)
      ? [SAKNAR_RANTEKANSLIGHET_FRAGA]
      : [];

  const resultat: AnalysisResult = {
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
    forening: extraction.forening,

    betyg: analys.betyg,
    betygMotivering: analys.betygMotivering,

    rodaFlaggor: analys.rodaFlaggor,
    prisanalys,
    rantestress,
    fragor: [...analys.fragor, ...saknadUppgiftFragor, ...rantekanslighetFraga],

    datakvalitet,

    gratisSektioner: ["betyg", "rodaFlaggor_topp2", "datakvalitet"],
  };

  const parsed = AnalysisResultSchema.safeParse(resultat);
  if (!parsed.success) {
    throw new AssemblyValidationError(parsed.error, resultat);
  }
  return resultat;
}
