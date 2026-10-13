import { tal } from "@/lib/kalkyl/regler";
import { amorteringstakt } from "./amortering";
import { ranteavdrag } from "./ranteavdrag";
import { schabloner } from "./schabloner";
import { beraknaSpann, type KostnadspostForSpann } from "./spann";
import type { CostItem, Manadskostnad, PropertyInput } from "@/types/analysis";

/**
 * Loan assumptions needed to assemble Manadskostnad. Not part of the
 * AnalysisResult contract — PropertyInput has no loan fields, they exist
 * only in the frontend's standalone, client-side /bolanekalkyl calculator
 * (kalkylDefaults, routes/bolanekalkyl.tsx). Loan data is never sent to the
 * server or persisted (a deliberate privacy decision).
 *
 * antalLantagare lives here rather than on PropertyInput: it exists solely
 * to compute the ränteavdrag cap, which is a property of the borrower's
 * loan, not of the apartment.
 */
export interface LaneUnderlag {
  lanebelopp: number;
  kontantinsats: number;
  /** Percent, e.g. 3.6. */
  ranta: number;
  /** Annual, household. */
  bruttoinkomst: number;
  antalLantagare: 1 | 2;
}

// Skuldkvot där bankerna brukar dra gränsen: ett antagande i regelregistret
// (skuldkvot_bankstak, märkt TODO: unverified placeholder). Informational
// only, per Amorteringsunderlag's contract comment — never drives
// tillampadAmorteringstakt.

function heltal(varde: number): number {
  return Math.round(varde);
}

/**
 * `ranteavdragPerArOverride`: det årliga ränteavdraget, redan beräknat per
 * person och begränsat av skatten (beraknaHushallSkatt i src/lib/skatt2026.ts).
 * Kalkylen skickar alltid med det, så att månadssumman och "Tillbaka i
 * deklarationen" är samma tal. Utan det används lagens fulla sats utan
 * skattebegränsning (ranteavdrag.ts), dvs. förutsatt att skatten räcker.
 */
export function beraknaManadskostnad(
  input: PropertyInput,
  lan: LaneUnderlag,
  ranteavdragPerArOverride?: number,
): Manadskostnad {
  const bostadsvarde = lan.lanebelopp + lan.kontantinsats;
  const belaningsgradProcent = bostadsvarde > 0 ? (lan.lanebelopp / bostadsvarde) * 100 : 0;
  const skuldkvot = lan.bruttoinkomst > 0 ? lan.lanebelopp / lan.bruttoinkomst : 0;

  const tillampadAmorteringstakt = amorteringstakt(belaningsgradProcent);
  const overBankernasTypiskaTak = skuldkvot > tal("skuldkvot_bankstak");

  const rantekostnadPerManad = (lan.lanebelopp * (lan.ranta / 100)) / 12;
  const amorteringPerManad = (lan.lanebelopp * (tillampadAmorteringstakt / 100)) / 12;

  const ranteavdragPerAr =
    ranteavdragPerArOverride ?? ranteavdrag(rantekostnadPerManad * 12, lan.antalLantagare);

  const s = schabloner(input.boarea, input.antalPersoner);

  // Hushållsel/värme/vatten/bredband kan vara täckta av avgiften — samma
  // fem schabloner som i calc/schabloner.ts, Figure-inpackade med
  // proveniens. Hemförsäkring är aldrig en avgiftspost. Notera: FeeInclusion
  // har ett "tv"-fält (rapporterna kan uttala sig om det, se
  // avgiftInkluderarEnligtForening), men varken schabloner.ts eller
  // CostItemId har en TV-motsvarighet — samma begränsning som redan finns i
  // routes/bolanekalkyl.tsx, inte något nytt infört här.
  const poster: CostItem[] = [
    {
      id: "rantekostnad",
      label: "Räntekostnad",
      figure: { value: heltal(rantekostnadPerManad), unit: "kr", source: "berakning" },
      overriddenByUser: false,
      ingarIAvgift: false,
    },
    {
      id: "amortering",
      label: "Amortering",
      figure: { value: heltal(amorteringPerManad), unit: "kr", source: "berakning" },
      overriddenByUser: false,
      ingarIAvgift: false,
    },
    {
      id: "ranteavdrag",
      label: "Ränteavdrag",
      figure: { value: -heltal(ranteavdragPerAr / 12), unit: "kr", source: "berakning" },
      overriddenByUser: false,
      ingarIAvgift: false,
    },
    {
      id: "manadsavgift",
      label: "Månadsavgift",
      figure: { value: heltal(input.manadsavgift), unit: "kr", source: "anvandare" },
      overriddenByUser: false,
      ingarIAvgift: false,
    },
    {
      id: "hushallsel",
      label: "Hushållsel",
      figure: s.el,
      overriddenByUser: false,
      ingarIAvgift: input.avgiftInkluderar.el === "ja",
    },
    {
      id: "varme",
      label: "Värme",
      figure: s.varme,
      overriddenByUser: false,
      ingarIAvgift: input.avgiftInkluderar.varme === "ja",
    },
    {
      id: "vatten",
      label: "Vatten",
      figure: s.vatten,
      overriddenByUser: false,
      ingarIAvgift: input.avgiftInkluderar.vatten === "ja",
    },
    {
      id: "bredband",
      label: "Bredband",
      figure: s.bredband,
      overriddenByUser: false,
      ingarIAvgift: input.avgiftInkluderar.bredband === "ja",
    },
    {
      id: "hemforsakring",
      label: "Hemförsäkring inkl. bostadsrättstillägg",
      figure: s.forsakring,
      overriddenByUser: false,
      ingarIAvgift: false,
    },
  ];

  const spannPoster: KostnadspostForSpann[] = [
    { belopp: s.el.value ?? 0, avgiftspost: "el" },
    { belopp: s.varme.value ?? 0, avgiftspost: "varme" },
    { belopp: s.vatten.value ?? 0, avgiftspost: "vatten" },
    { belopp: s.bredband.value ?? 0, avgiftspost: "bredband" },
    { belopp: s.forsakring.value ?? 0 },
  ];
  const spann = beraknaSpann(spannPoster, input.avgiftInkluderar);

  const fastaKostnader = rantekostnadPerManad + amorteringPerManad + input.manadsavgift;
  const bruttoLag = heltal(fastaKostnader + spann.low);
  const bruttoHog = heltal(fastaKostnader + spann.high);
  const avdragPerManad = heltal(ranteavdragPerAr / 12);

  return {
    poster,
    // .value är low-scenariot (avgiften antas täcka det okända) — samma
    // konvention som beraknaSpann. totalSpann ger high när det är relevant;
    // frontend visar spannet istället för punktvärdet när det finns.
    totalBrutto: { value: bruttoLag, unit: "kr", source: "berakning" },
    totalNetto: { value: bruttoLag - avdragPerManad, unit: "kr", source: "berakning" },
    ...(spann.arSpann
      ? { totalSpann: { low: bruttoLag - avdragPerManad, high: bruttoHog - avdragPerManad } }
      : {}),
    amortering: {
      belaningsgrad: Math.round(belaningsgradProcent * 10) / 10,
      skuldkvot: Math.round(skuldkvot * 1000) / 1000,
      tillampadAmorteringstakt,
      overBankernasTypiskaTak,
    },
    ranteavdragPerAr: { value: heltal(ranteavdragPerAr), unit: "kr", source: "berakning" },
  };
}
