import type { z } from "zod";
import type {
  AnalysisResult,
  ExtractionResult,
  FeeInclusion,
  Figure,
  Forening,
  Fraga,
  Konfidens,
  Prisanalys,
  PropertyInput,
} from "@/types/analysis";
import { AnalysisResultSchema } from "./schema";
import type { AnalysJudgement } from "./analyze";
import { beraknaManadskostnad, type LaneUnderlag } from "./calc/manadskostnad";
import { beraknaRantestress } from "./calc/rantestress";
import { konfidensUtanPrisdata, type Prisdatakalla, type Prisdataforfragan } from "./prisdata";

/**
 * Slutmonteringen: kombinerar pass 1:s extraktion, pass 2:s bedömning och de
 * rena, deterministiska delarna av AnalysisResult (månadskostnad,
 * räntestress, prisanalys, datakvalitet och 'saknad_uppgift'-frågorna) som
 * PIPELINE.md och analyze.ts:s filkommentar är tydliga med att INTE ska
 * komma från modellen. Ingen modellanrop görs här — allt är ren funktion av
 * det som skickas in.
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
  lan: LaneUnderlag;
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

  const konfidens: Konfidens = !harOberoendeData
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

  const slutsats = byggSlutsats({
    harOberoendeData,
    varderingArSchablon,
    avvikelseMotVardering,
    avvikelseMotForeningen,
  });

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
  };
}

/**
 * Slutmonterar ett fullständigt AnalysisResult. Inget modellanrop — allt
 * som produceras här är antingen en ren beräkning (manadskostnad,
 * rantestress, prisanalys, datakvalitet, saknad_uppgift-frågor) eller en
 * direkt kopiering av det anroparen redan tagit fram (input, forening,
 * pass 2:s betyg/rodaFlaggor/analys-frågor).
 *
 * BESLUT — SaknarRantekanslighetError FÅR PROPAGERA: beraknaRantestress
 * kastar när räntekänslighet saknas i årsredovisningen. Att fånga felet
 * här och falla tillbaka på ett nollscenario skulle producera precis det
 * självsäkra tomma felläget CLAUDE.md och PIPELINE.md förbjuder — en
 * köpare skulle se fyra oförändrade avgiftsscenarier och tro att avgiften
 * inte är räntekänslig, när sanningen är att vi inte vet. Anroparen (som
 * har kontext för att visa ett tydligt felmeddelande eller avbryta hela
 * analysen) måste se felet.
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
  lan,
  prisdatakalla,
  analys,
  analysisId,
  skapad,
}: AssembleraAnalysInput): Promise<AnalysisResult> {
  const manadskostnad = beraknaManadskostnad(input, lan);
  // Propagerar avsiktligt SaknarRantekanslighetError — se filkommentaren ovan.
  const rantestress = beraknaRantestress(extraction.forening, input.manadsavgift);
  const prisanalys = await byggPrisanalys(input, prisdatakalla);

  const uppgiftsstatus = berakUppgiftsstatus(input);
  const datakvalitet: AnalysisResult["datakvalitet"] = {
    pdfSaknarTextlager: extraction.datakvalitet.pdfSaknarTextlager,
    extraktionKonfidens: extraction.datakvalitet.extraktionKonfidens,
    uppgifterKanda: uppgiftsstatus.kanda,
    uppgifterTotalt: uppgiftsstatus.totalt,
    saknadeFalt: uppgiftsstatus.saknade,
  };

  const saknadUppgiftFragor = genereraSaknadUppgiftFragor(input, extraction.forening);

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
    manadskostnad,
    fragor: [...analys.fragor, ...saknadUppgiftFragor],

    datakvalitet,

    gratisSektioner: ["betyg", "rodaFlaggor_topp2", "datakvalitet"],
  };

  const parsed = AnalysisResultSchema.safeParse(resultat);
  if (!parsed.success) {
    throw new AssemblyValidationError(parsed.error, resultat);
  }
  return resultat;
}
