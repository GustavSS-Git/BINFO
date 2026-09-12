import type { Figure, Konfidens, Prisanalys } from "@/types/analysis";

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
  /** XXXXXX-XXXX. Utan orgnr går föreningens egna försäljningar inte att slå upp. */
  orgnr: string;
  boarea: number;
  postnummer: string;
  ort: string;
  adress?: string;
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
  hamtaForsaljningarIForeningen(
    forfragan: Prisdataforfragan,
  ): Promise<ForsaljningIForeningen[]>;
  /** Områdets medianpris i kr/m², eller null om det inte är känt. */
  hamtaOmradeMedian(forfragan: Prisdataforfragan): Promise<OmradeMedian | null>;
}

// ---------------------------------------------------------------------------
// Tom källa — standardvalet i produktion
// ---------------------------------------------------------------------------

/**
 * Den ärliga standardimplementationen: ingen prisdata alls.
 *
 * Detta är vad produktion använder tills en riktig källa finns. Analysen ska
 * då säga rent ut att ingen oberoende prisreferens är ansluten — inte antyda
 * att priset är avstämt. Se konfidensUtanPrisdata() nedan.
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
function platshallarfigur(
  mittpunkt: number,
  unit: Figure["unit"],
  vad: string,
): Figure {
  const halvtSpann = Math.abs(mittpunkt) * DEMO_SPANN_ANDEL;
  return {
    value: null,
    unit,
    source: "schablon",
    schablonBasis:
      `${PLATSHALLARE_PREFIX} ${vad}: utgångspriset ±${Math.round(DEMO_SPANN_ANDEL * 100)} %.`,
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
        prisPerM2: platshallarfigur(
          this.prisPerM2,
          "kr/m2",
          "Kvadratmeterpris i föreningen",
        ),
      };
    });
  }

  async hamtaOmradeMedian(_forfragan: Prisdataforfragan): Promise<OmradeMedian | null> {
    return platshallarfigur(this.prisPerM2, "kr/m2", "Områdesmedian");
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
