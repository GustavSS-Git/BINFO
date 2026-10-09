import {
  budpremieForOmrade,
  drivareForInput,
  vardera,
  type VarderingResultat,
} from "@/lib/vardering";
import { formatDataperiod } from "@/lib/analysisView";
import type {
  Budpremie,
  Figure,
  Konfidens,
  Prisanalys,
  Tristate,
  Varderingsdrivare,
} from "@/types/analysis";

/**
 * Prisdatalagret — gränssnittet mellan analysen och en oberoende priskälla.
 *
 * Det finns ingen ansluten priskälla ännu (skrapning, licensierad statistik
 * eller manuellt inmatade jämförelseobjekt är ett öppet affärsbeslut). Därför
 * ligger hämtningen bakom ett gränssnitt: när en riktig källa finns ska den
 * kunna droppas in utan att någon anropare ändras.
 *
 * Returtyperna härleds ur kontraktet (src/types/analysis.ts) via indexed
 * access — de får aldrig deklareras om här, annars kan de glida isär.
 */

/** Tredjepartsvärdering, exakt som Prisanalys.externVardering kräver den. */
export type Vardering = NonNullable<Prisanalys["externVardering"]>;

/** En försäljning i samma förening — elementtypen ur kontraktet. */
export type ForsaljningIForeningen = NonNullable<
  Prisanalys["senasteForsaljningarIForeningen"]
>[number];

/** Områdesmedian i kr/m², exakt som Prisanalys.omradeMedianPrisPerM2. */
export type OmradeMedian = NonNullable<Prisanalys["omradeMedianPrisPerM2"]>;

/**
 * Allt en priskälla kan behöva för en uppslagning, i ett objekt i stället för
 * positionsargument. En riktig källa kommer med stor sannolikhet behöva fler
 * fält (adress, våning, byggår) för att kunna matcha rätt objekt — med ett
 * förfrågningsobjekt kan de fälten läggas till utan att någon anropare
 * ändras, vilket är hela poängen med gränssnittet.
 */
export interface Prisdataforfragan {
  /** XXXXXX-XXXX. Utan orgnr går föreningens egna försäljningar inte att slå upp.
   *  Saknas i den fristående priskollen (prisuppskattning, /vardering), som
   *  inte känner föreningen — en källa ska då svara tom lista, aldrig gissa. */
  orgnr?: string;
  boarea: number;
  postnummer: string;
  /** Saknas i den fristående priskollen, av samma skäl som orgnr. */
  ort?: string;
  adress?: string;

  // Tillagda för task 4g: exakt de fält Binfos värderingsmodell (src/lib/
  // vardering) behöver utöver boarea/postnummer ovan — se ModellPrisdatakalla
  // nedan. En riktig extern källa kan också ha nytta av dem (t.ex. för att
  // matcha rätt jämförelseobjekt), så de hör hemma i det delade
  // förfrågningsobjektet, inte bara i modellens egna typer.
  antalRum: number;
  manadsavgift: number;
  vaning?: number;
  byggar?: number;
  hiss: Tristate;
  balkong: Tristate;
}

/**
 * En källa till oberoende prisreferenser. Alla metoder är asynkrona eftersom
 * en riktig implementation kommer gå över nätet.
 *
 * Frånvaro av data är alltid `null` respektive tom lista — aldrig ett påhittat
 * tal, och aldrig ett kastat fel. "Vi vet inte" är ett giltigt svar och måste
 * gå att skilja från "priset stämmer".
 */
export interface Prisdatakalla {
  /** Tredjepartsvärdering av objektet, eller null om ingen finns. */
  hamtaVardering(forfragan: Prisdataforfragan): Promise<Vardering | null>;
  /** Senaste försäljningarna i samma förening. Tom lista när inga är kända. */
  hamtaForsaljningarIForeningen(forfragan: Prisdataforfragan): Promise<ForsaljningIForeningen[]>;
  /** Områdets medianpris i kr/m², eller null om det inte är känt. */
  hamtaOmradeMedian(forfragan: Prisdataforfragan): Promise<OmradeMedian | null>;
}

// ---------------------------------------------------------------------------
// Tom källa — ingen prisdata alls
// ---------------------------------------------------------------------------

/**
 * Den ärliga nollimplementationen: ingen prisdata alls. Produktion använder
 * numera ModellPrisdatakalla (se nedan) i stället, men den här källan
 * fyller fortfarande sin roll i tester och som ett explicit "koppla bort
 * all prisdata"-läge: Analysen ska då säga rent ut att ingen oberoende
 * prisreferens är ansluten — inte antyda att priset är avstämt. Se
 * konfidensUtanPrisdata() nedan.
 */
export class TomPrisdatakalla implements Prisdatakalla {
  async hamtaVardering(_forfragan: Prisdataforfragan): Promise<Vardering | null> {
    return null;
  }

  async hamtaForsaljningarIForeningen(
    _forfragan: Prisdataforfragan,
  ): Promise<ForsaljningIForeningen[]> {
    return [];
  }

  async hamtaOmradeMedian(_forfragan: Prisdataforfragan): Promise<OmradeMedian | null> {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Demokälla — endast för utveckling och demo
// ---------------------------------------------------------------------------

// TODO: unverified placeholder — konstanterna nedan är inte hämtade från
// någon marknadsdatakälla. De är medvetet valda för att vara omöjliga att
// förväxla med en värdering, inte för att vara realistiska.

/** Halva spannbredden runt utgångspriset, som andel av utgångspriset. */
// TODO: unverified placeholder
const DEMO_SPANN_ANDEL = 0.25;

/** Antal påhittade försäljningar demokällan returnerar. */
// TODO: unverified placeholder
const DEMO_ANTAL_FORSALJNINGAR = 2;

/** Datum på de påhittade försäljningarna, bakåt från förfrågningsdagen. */
// TODO: unverified placeholder
const DEMO_FORSALJNING_DAGAR_BAKAT = [45, 120];

const PLATSHALLARE_PREFIX =
  "PLATSHÅLLARE: ingen riktig värderingskälla är ansluten. Talet är härlett ur " +
  "utgångspriset och säger därför ingenting om marknadsvärdet. Får inte visas för en riktig köpare.";

/**
 * Varför demofigurerna saknar värde (`value: null`) och bara bär ett brett spann:
 *
 * En demovärdering som landar några procent från utgångspriset skulle räknas
 * vidare till avvikelseMotVardering och renderas som ett omdöme — "priset är
 * rimligt" — som ingen faktiskt har beräknat. Det är precis det felet resten
 * av kodbasen är byggd för att förhindra.
 *
 * En figur som är härledd ur utgångspriset innehåller per definition noll
 * information om utgångspriset. Demokällan säger därför det numeriskt: den
 * lämnar `value: null`, så att inget led nedströms kan räkna fram en avvikelse
 * i procent, och lägger i stället ett spann så brett (±25 %) att det omöjligt
 * kan skilja ett rimligt pris från ett orimligt. UI:t får något att rendera —
 * spannbalken, leverantörsraden, listan med föreningsförsäljningar — utan att
 * någonsin få ett tal som kan misstas för en värdering.
 */
function platshallarfigur(mittpunkt: number, unit: Figure["unit"], vad: string): Figure {
  const halvtSpann = Math.abs(mittpunkt) * DEMO_SPANN_ANDEL;
  return {
    value: null,
    unit,
    source: "schablon",
    schablonBasis: `${PLATSHALLARE_PREFIX} ${vad}: utgångspriset ±${Math.round(DEMO_SPANN_ANDEL * 100)} %.`,
    range: {
      low: Math.round(mittpunkt - halvtSpann),
      high: Math.round(mittpunkt + halvtSpann),
    },
  };
}

export interface DemoPrisdataInput {
  utgangspris: number;
  boarea: number;
}

/**
 * Utvecklings- och demoimplementation. Härleder platshållarfigurer ur
 * utgångspriset och boarean så att lagren nedströms — och så småningom UI:t —
 * har något att rendera innan en riktig källa finns.
 *
 * Får aldrig användas i produktion. Varje figur den producerar är
 * `source: 'schablon'` med en schablonBasis som börjar med PLATSHÅLLARE, och
 * ingen av dem har ett numeriskt värde.
 */
export class DemoPrisdatakalla implements Prisdatakalla {
  private readonly utgangspris: number;
  private readonly boarea: number;

  constructor(input: DemoPrisdataInput) {
    this.utgangspris = input.utgangspris;
    this.boarea = input.boarea;
  }

  /** kr/m² på utgångspriset. 0 när boarean saknas — undviker division med noll. */
  private get prisPerM2(): number {
    return this.boarea > 0 ? this.utgangspris / this.boarea : 0;
  }

  async hamtaVardering(_forfragan: Prisdataforfragan): Promise<Vardering | null> {
    return {
      ...platshallarfigur(this.utgangspris, "kr", "Värdering"),
      // Leverantören är medvetet inte ett riktigt varumärke — en påhittad
      // värdering får aldrig kunna attribueras till en verklig aktör.
      leverantor: "PLATSHÅLLARE — ingen värderingsleverantör ansluten",
    };
  }

  async hamtaForsaljningarIForeningen(
    _forfragan: Prisdataforfragan,
  ): Promise<ForsaljningIForeningen[]> {
    const idag = new Date();
    return Array.from({ length: DEMO_ANTAL_FORSALJNINGAR }, (_, i) => {
      const dagar = DEMO_FORSALJNING_DAGAR_BAKAT[i] ?? 30 * (i + 1);
      const datum = new Date(idag.getTime() - dagar * 24 * 60 * 60 * 1000);
      return {
        datum: datum.toISOString().slice(0, 10),
        pris: platshallarfigur(this.utgangspris, "kr", "Försäljning i föreningen"),
        // Samma boarea som objektet självt — en påhittad försäljning ska se
        // syntetisk ut även i de fält som inte är Figure.
        boarea: this.boarea,
        prisPerM2: platshallarfigur(this.prisPerM2, "kr/m2", "Kvadratmeterpris i föreningen"),
      };
    });
  }

  async hamtaOmradeMedian(_forfragan: Prisdataforfragan): Promise<OmradeMedian | null> {
    return platshallarfigur(this.prisPerM2, "kr/m2", "Områdesmedian");
  }
}

// ---------------------------------------------------------------------------
// Modellkälla — Binfos egen värderingsmodell (task 4g/5)
// ---------------------------------------------------------------------------

/**
 * Täckning (se src/lib/vardering/tackning.ts för den fullständiga
 * upplösningsordningen): varje välformat femsiffrigt postnummer får en
 * värdering.
 *   - 'stockholm'   : Stockholms kommun — områdesmodellen (tränad på
 *                     försäljningar där).
 *   - 'lan'         : övriga Stockholms län — generella samband × kommunens
 *                     genomsnittspris.
 *   - 'utanfor_lan' : utanför länet — generella samband × riksgenomsnittet.
 * Bara ett tomt eller felformaterat postnummer (t.ex. en anonymiserad
 * rapport) ger INGEN värdering; det avgörandet fattas i vardera() (null).
 */

/** Exakt de fält vardera()/budpremieForOmrade()/drivareForInput() behöver. */
export interface ModellVarderingInput {
  postnummer: string;
  boarea: number;
  antalRum: number;
  manadsavgift: number;
  vaning?: number;
  byggar?: number;
  hiss: Tristate;
  balkong: Tristate;
}

/**
 * Allt en fullständig körning av Binfos modell producerar för en lägenhet —
 * mer än det Prisdatakalla-gränssnittet (bara en Vardering) kan bära.
 * Exporterad så assembleraAnalys (assemble.ts) kan bygga
 * Prisanalys.varderingsunderlag/.budpremie ur SAMMA rena, deterministiska
 * körning som ModellPrisdatakalla.hamtaVardering gör — inte gissa fram dem
 * ur den redan avrundade Figure:n.
 */
export interface ModellVarderingUnderlag {
  resultat: VarderingResultat;
  /** Bara för 'stockholm' — underlaget (utgångspris mot slutpris) täcker
   *  enbart Stockholms kommun. null för 'lan' och 'utanfor_lan'. */
  budpremie: Budpremie | null;
  drivare: Varderingsdrivare[];
}

/**
 * Kör Binfos värderingsmodell end-till-end för en lägenhet, eller null när
 * postnumret är tomt eller felformaterat (ingen värdering möjlig). Ren
 * funktion, inget nätverksanrop — vardera()/budpremieForOmrade()/
 * drivareForInput() är alla rena uppslagningar mot data som redan laddats
 * vid modulinit (src/lib/vardering).
 *
 * Budpremie sätts bara för 'stockholm'. Drivarna (och deras förbehåll) är
 * desamma för alla täckningsnivåer, men områdesspecifika effekter används
 * bara när ett Stockholmsområde är känt.
 */
export function korBinfoVarderingsmodell(
  input: ModellVarderingInput,
): ModellVarderingUnderlag | null {
  const resultat = vardera({
    postnummer: input.postnummer,
    boarea: input.boarea,
    antalRum: input.antalRum,
    manadsavgift: input.manadsavgift,
    ...(input.vaning !== undefined ? { vaning: input.vaning } : {}),
    ...(input.byggar !== undefined ? { byggar: input.byggar } : {}),
    hiss: input.hiss,
    balkong: input.balkong,
  });
  if (!resultat) return null;

  return {
    resultat,
    budpremie: resultat.tackning === "stockholm" ? budpremieForOmrade(resultat.omrade) : null,
    drivare: drivareForInput(
      { hiss: input.hiss, balkong: input.balkong },
      resultat.omrade,
      resultat.tackning,
    ),
  };
}

const sv0 = (n: number) => n.toLocaleString("sv-SE", { maximumFractionDigits: 0 });
const sv1 = (n: number) => n.toLocaleString("sv-SE", { maximumFractionDigits: 1 });

/**
 * "46 317 kr/m², Svensk Mäklarstatistik, aug 2026" — prisnivån som citeras i
 * texterna. Delas av schablonBasis här och konfidensskälen i assemble.ts.
 */
export function prisnivaCitat(prisniva: NonNullable<VarderingResultat["prisniva"]>): string {
  return `${sv0(prisniva.krPerM2)} kr/m², ${prisniva.kalla}, ${formatDataperiod(prisniva.period)}`;
}

/** schablonBasis för Binfos värdering — metod och baslinje utpekade, och aldrig
 *  något som kan läsas som ett faktum. */
function byggSchablonBasis(resultat: VarderingResultat): string {
  const modell = `Binfos värderingsmodell (${resultat.modellVersion})`;
  const forsaljningar = `${resultat.antalForsaljningar} försäljningar i Stockholm ${formatDataperiod(resultat.dataperiod)}`;
  const slut = "Det är en statistisk skattning, inte en besiktning av just den här lägenheten.";

  if (resultat.tackning === "stockholm") {
    const omradeText =
      resultat.omrade ??
      "hela Stockholm (postnumret gick inte att koppla till ett specifikt område)";
    return (
      `${modell}: en statistisk skattning för ${omradeText}, byggd på ${forsaljningar}. ` +
      `Typiskt fel ±${sv1(resultat.typisktFelProcent)} %. ${slut}`
    );
  }

  const prisniva = resultat.prisniva;
  const generella =
    "Den bygger på generella samband (storlek, antal rum, våning, byggår, avgift, hiss och balkong) " +
    `från ${forsaljningar}`;
  const nedreGrans = (plats: string) =>
    `Typiskt fel ±${sv1(resultat.typisktFelProcent)} % är simulerat inom Stockholm och är en nedre gräns — ` +
    `det verkliga felet ${plats} är sannolikt större.`;

  if (resultat.tackning === "lan" && prisniva) {
    const kommun = resultat.kommun ?? prisniva.region;
    return (
      `${modell}: en statistisk skattning för ${kommun}. ${generella}, skalade till ` +
      `genomsnittspriset i ${kommun} (${prisnivaCitat(prisniva)}). ` +
      `Modellen är inte tränad på försäljningar i ${kommun}. ${nedreGrans(`i ${kommun}`)} ${slut}`
    );
  }

  const forKommun = resultat.kommun ? ` för ${resultat.kommun}` : "";
  const enManad =
    prisniva && prisniva.period.fran === prisniva.period.till
      ? " Riksgenomsnittet avser en enda månad."
      : "";
  return (
    `${modell}: en statistisk skattning${forKommun} utanför Stockholms län. ${generella}, skalade till ` +
    `riksgenomsnittet för bostadsrätter${prisniva ? ` (${prisnivaCitat(prisniva)})` : ""}. ` +
    `Modellen är inte tränad på försäljningar utanför Stockholm.${enManad} ` +
    `${nedreGrans("utanför länet")} ${slut}`
  );
}

/**
 * Binfos egen värderingsmodell (src/lib/vardering) som Prisdatakalla.
 * Ersätter den tidigare platta 80 000 kr/m²-schablonen. Märks fortfarande
 * `source: 'schablon'` — inte `'extern'`, som är reserverad för en verklig
 * tredjepartsintegration — men är till skillnad från den gamla schablonen en
 * riktig statistisk modell: den tar hänsyn till storlek, antal rum, våning,
 * byggår, avgift, hiss och balkong, och bär ett uppmätt (för Stockholm) eller
 * simulerat (för resten av landet) osäkerhetsintervall. Se
 * ml/artifacts/valuation-v3/MODEL_CARD.md.
 *
 * Tre metoder efter postnummer (se täckningskommentaren
 * ovan och src/lib/vardering/tackning.ts): områdesmodellen för Stockholms
 * kommun, samt generella samband × kommunens respektive riksgenomsnittets
 * kr/m² för resten. Alla ger en uppskattning; bara ett tomt eller
 * felformaterat postnummer ger null.
 *
 * Kräver inget konstruktortillstånd (till skillnad från de äldre källorna
 * ovan) — allt modellen behöver kommer med varje enskild förfrågan. Modellen
 * känner varken enskilda försäljningar i en förening eller en riktig
 * områdesmedian, så de två andra metoderna lämnar alltid tomt/null, av samma
 * skäl som de äldre källorna ovan.
 */
export class ModellPrisdatakalla implements Prisdatakalla {
  async hamtaVardering(forfragan: Prisdataforfragan): Promise<Vardering | null> {
    const underlag = korBinfoVarderingsmodell(forfragan);
    if (!underlag) return null;
    const { resultat } = underlag;

    return {
      value: resultat.varde,
      unit: "kr",
      source: "schablon",
      schablonBasis: byggSchablonBasis(resultat),
      range: resultat.intervall,
      leverantor: `Binfo värderingsmodell ${resultat.modellVersion}`,
    };
  }

  async hamtaForsaljningarIForeningen(
    _forfragan: Prisdataforfragan,
  ): Promise<ForsaljningIForeningen[]> {
    // Modellen producerar en punktprediktion för EN lägenhet, inte en lista
    // över föreningens egna försäljningar — att hitta på sådana ur samma
    // prediktion vore påhittade jämförelseobjekt.
    return [];
  }

  async hamtaOmradeMedian(_forfragan: Prisdataforfragan): Promise<OmradeMedian | null> {
    // Samma skäl: modellen har inget mått på områdets faktiska medianpris,
    // bara en prediktion för den här specifika lägenheten.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Konfidens när ingen prisdata finns
// ---------------------------------------------------------------------------

/**
 * Konfidensen en Prisanalys ska bära när den byggts helt utan extern prisdata.
 * Skälet visas ordagrant för användaren, så det måste stå på svenska och säga
 * rent ut att avstämningen inte har gjorts.
 */
export function konfidensUtanPrisdata(): Konfidens {
  return {
    niva: "lag",
    skal: [
      "Ingen oberoende priskälla är ansluten. Utgångspriset har inte stämts av mot " +
        "någon värdering, mot försäljningar i föreningen eller mot områdets medianpris.",
    ],
  };
}

/**
 * Konfidensen en Prisanalys ska bära när Binfos värdering inte kan räknas
 * fram alls eftersom postnumret saknas eller är felformaterat (t.ex. en
 * anonymiserad rapport). Postnummer utanför Stockholm har en egen
 * uppskattning (konfidens 'lag', se konfidensForModell i assemble.ts), så
 * den här gäller bara det som inte går att placera alls.
 */
export function konfidensUtanPostnummer(): Konfidens {
  return {
    niva: "lag",
    skal: [
      "Postnumret saknas eller är ogiltigt, så Binfos värdering kan inte räknas fram och " +
        "utgångspriset har inte stämts av mot någon värdering.",
    ],
  };
}
