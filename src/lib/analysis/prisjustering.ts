/**
 * Price adjustment from the expected fee rise (round 2026-10-24b,
 * docs/avgiftsprognos.md). Pure.
 *
 * The valuation model already prices TODAY's fee, so the only thing added is
 * the rise the report points to. The effect is the model's OLS coefficient on
 * the fee (an association, never a causal claim), flat-specific:
 *   kr of price per kr/month of fee = −β × baseline kr/m²   (positive number)
 *   belopp = round(−total × that)                           (linear)
 * Missing data NEVER changes the point value: it only widens the LOW end of
 * the range, by BREDDNING_PER_SAKNAT_UNDERLAG of the baseline per component.
 *
 * Decision: when the flat's share is unknown (total null) there is no
 * adjustment (no `justeringar` entry, effect 0) and the unknown share counts as
 * one extra missing input for the widening.
 */
import type { Figure, Prisanalys } from "@/types/analysis";
import type { AvgiftsprognosResultat } from "./calc/avgiftsprognos";
import { AVGIFT_BETA_LOG_PER_KR_M2, BREDDNING_PER_SAKNAT_UNDERLAG } from "./calc/prognosantaganden";

export interface PrisjusteringInput {
  /** externVardering when it is Binfo's model (value non-null). */
  baseline: { value: number; range?: { low: number; high: number } } | null;
  boarea: number;
  prognos: AvgiftsprognosResultat;
  /** Extra widening reasons with an explicit alternative price (e.g. the
   *  valuation re-run with the report's uncertain byggår): the range is
   *  extended to include `pris`. */
  alternativa?: Array<{ skal: string; pris: number }>;
  utgangspris?: number;
}

type Resultat = Pick<
  Prisanalys,
  "justeringar" | "justeradVardering" | "avvikelseMotJusteradVardering" | "breddningsskal"
>;

function kr(n: number): string {
  return Math.round(Math.abs(n)).toLocaleString("sv-SE");
}

function pct(n: number): string {
  return n.toLocaleString("sv-SE", { maximumFractionDigits: 1 });
}

function avrunda(n: number): number {
  const r = Math.round(n);
  return r === 0 ? 0 : r;
}

export function byggPrisjustering(input: PrisjusteringInput): Resultat | null {
  const { baseline, boarea, prognos, utgangspris } = input;
  const alternativa = input.alternativa ?? [];
  if (!baseline || baseline.value === null || !(boarea > 0)) return null;

  const total = prognos.prognos.totalKrPerManad;
  const saknar = prognos.antalSaknadeUnderlag;
  if (total === null && saknar === 0) return null;

  const horisont = prognos.prognos.horisontManader;
  const krPerKrManadExakt = -AVGIFT_BETA_LOG_PER_KR_M2 * (baseline.value / boarea);
  const beloppExakt = total === null ? 0 : -total * krPerKrManadExakt;
  const belopp = avrunda(beloppExakt);
  const punkt = avrunda(baseline.value + belopp);

  const skal: string[] = [];
  let low = (baseline.range?.low ?? baseline.value) + belopp;
  let high = (baseline.range?.high ?? baseline.value) + belopp;
  let breddat = false;

  // Missing data: widen the low end only.
  const enheter = saknar + (total === null ? 1 : 0);
  if (enheter > 0) {
    low -= BREDDNING_PER_SAKNAT_UNDERLAG * enheter * baseline.value;
    breddat = true;
    const namn = prognos.prognos.komponenter
      .filter((k) => k.status === "saknar_underlag")
      .map((k) => k.label.toLowerCase());
    const delar: string[] = [];
    if (namn.length > 0) delar.push(`årsredovisningen saknar underlag för: ${namn.join(", ")}`);
    if (total === null)
      delar.push(
        "vi kan inte räkna ut hur stor andel av föreningens kostnader som faller på din lägenhet",
      );
    skal.push(
      `Spannet är bredare nedåt, med ${pct(BREDDNING_PER_SAKNAT_UNDERLAG * enheter * 100)} % av värderingen, eftersom ${delar.join(" och ")}. Det ändrar inte det beräknade värdet.`,
    );
  }

  // Missing maturities: show the outcome with none / all of the debt repricing.
  const spann = prognos.totalSpannVidAntagande;
  if (spann) {
    low = Math.min(low, baseline.value - spann.hog * krPerKrManadExakt);
    high = Math.max(high, baseline.value - spann.lag * krPerKrManadExakt);
    breddat = true;
    skal.push(
      "Årsredovisningen anger inte när hela skulden ska omsättas. För den delen har vi antagit att hälften prissätts om inom horisonten, och spannet visar utfallet om ingen respektive allt av den gör det.",
    );
  }

  for (const a of alternativa) {
    // The alternative valuation gets the same fee adjustment as the baseline.
    const justerad = a.pris + belopp;
    low = Math.min(low, justerad);
    high = Math.max(high, justerad);
    breddat = true;
    skal.push(a.skal);
  }

  const range = (() => {
    if (!breddat && !baseline.range) return undefined;
    return {
      low: Math.max(0, avrunda(Math.min(low, punkt))),
      high: Math.max(0, avrunda(Math.max(high, punkt))),
    };
  })();

  const riktning = total === null ? "" : total > 0 ? "stiga" : total < 0 ? "sjunka" : "";
  const forklaring =
    total === null
      ? ""
      : total === 0
        ? `Årsredovisningen pekar inte på någon förändring av avgiften inom ${horisont} månader, så vi justerar inte värderingen.`
        : `Årsredovisningen pekar på att din avgift kan ${riktning} med cirka ${kr(total)} kr i månaden inom ${horisont} månader. ` +
          `I Binfos data hänger en högre månadsavgift ihop med ett lägre pris, ungefär ${kr(krPerKrManadExakt)} kr per krona i månadsavgift för en lägenhet som den här. ` +
          `Det är ett statistiskt samband, inte ett orsakssamband.`;

  const justeringar: Prisanalys["justeringar"] =
    total === null
      ? []
      : [
          {
            id: "forvantad_avgiftshojning",
            label: "Föreningens ekonomi",
            belopp: { value: belopp, unit: "kr", source: "berakning" },
            krPerKrManad: avrunda(krPerKrManadExakt),
            forklaring,
          },
        ];

  const schablonBasis =
    total === null
      ? "Binfos värdering. Vi kunde inte räkna ut din lägenhets andel av avgiftshöjningen, så värdet är oförändrat och spannet bredare."
      : "Binfos värdering justerad för den avgiftshöjning årsredovisningen pekar på, med modellens samband mellan månadsavgift och pris.";

  const justerad: Figure = {
    value: punkt,
    unit: "kr",
    source: "schablon",
    schablonBasis,
    ...(range ? { range } : {}),
  };

  return {
    justeringar,
    justeradVardering: justerad,
    ...(utgangspris !== undefined && punkt > 0
      ? { avvikelseMotJusteradVardering: Math.round(((utgangspris - punkt) / punkt) * 1000) / 10 }
      : {}),
    breddningsskal: skal,
  };
}
