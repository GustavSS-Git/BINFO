import { describe, expect, it } from "vitest";
import type { ExtractionResult, Figure } from "@/types/analysis";
import { extraktion } from "./__fixtures__/extraktion";
import { beraknaFastaVarden } from "./fastaVarden";
import { kontrolleraSiffror } from "./siffrorKontroll";

const kr = (value: number | null, excerpt?: string): Figure => ({
  value,
  unit: "kr",
  source: "arsredovisning",
  ...(excerpt ? { ref: { page: 12, excerpt } } : {}),
});

/** The real 2026-10-23 case: total 7 759 091 kr, of which 5 759 091 kr (74 %) matures 2026. */
function verklig(): ExtractionResult {
  const e = structuredClone(extraktion) as ExtractionResult;
  e.forening.rakenskapsar = 2025;
  e.forening.lanebok = {
    totalSkuld: kr(7_759_091, "Summa skulder till kreditinstitut 7 759 091"),
    forfalloprofil: [
      { ar: 2026, belopp: kr(5_759_091, "SBAB 1,1 % 2026-03-01 5 759 091"), ranta: undefined! },
      { ar: 2029, belopp: kr(2_000_000) },
    ],
    snittranta: { value: 1.98, unit: "procent", source: "berakning" },
  };
  delete (e.forening.lanebok.forfalloprofil![0] as { ranta?: unknown }).ranta;
  return e;
}

const kontroll = (text: string, e: ExtractionResult = verklig()) =>
  kontrolleraSiffror(text, e, beraknaFastaVarden(e));
const texter = (text: string, e: ExtractionResult = verklig()) =>
  kontroll(text, e).map((a) => a.text);

describe("kontrolleraSiffror: the real failure", () => {
  it("flags 6 759 091 kr and 87 % when the data says 5 759 091 kr and 74 %", () => {
    const avvikelser = kontroll("Lån på 6 759 091 kr av 7 759 091 kr (cirka 87 %) förfaller 2026.");
    expect(avvikelser.map((a) => a.text)).toEqual(["6 759 091 kr", "87 %"]);
    expect(avvikelser[0]).toMatchObject({ typ: "belopp", varde: 6_759_091 });
    expect(avvikelser[1]).toMatchObject({ typ: "procent", varde: 87 });
    expect(avvikelser[0]!.skal).toContain("6 759 091 kr");
  });

  it("passes the correct text", () => {
    expect(texter("5 759 091 kr av 7 759 091 kr, cirka 74 %, förfaller 2026.")).toEqual([]);
  });
});

describe("kontrolleraSiffror: number formats", () => {
  it("reads regular, non-breaking and narrow no-break spaces as thousands separators", () => {
    expect(texter("5 759 091 kr och 7 759 091 kr")).toEqual([]);
    expect(texter("5 759 092 kr")).toEqual(["5 759 092 kr"]);
  });

  it("reads a decimal comma", () => {
    // 1,98 is the average rate in the data; 1,89 is not.
    expect(texter("Snittränta 1,98 %")).toEqual([]);
    expect(texter("Snittränta 1,89 %")).toEqual(["1,89 %"]);
  });

  it("compares absolute values: a minus sign (hyphen or U+2212) on a data value", () => {
    const e = verklig();
    e.forening.keyFigures[4]!.figure.value = -12;
    e.forening.keyFigures[4]!.figure.unit = "kr/m2";
    expect(texter("Sparandet är −12 kr/m².", e)).toEqual([]);
    expect(texter("Sparandet är -12 kr/m².", e)).toEqual([]);
    expect(texter("Ett underskott på 12 kr per kvadratmeter.", e)).toEqual([]);
    expect(texter("Sparandet är −13 kr/m².", e)).toEqual(["−13 kr/m²"]);
  });

  it("does not read a hyphen between numbers or in a date as a number to check", () => {
    // 2026-03-01 is in an excerpt; the date parts are years/small counts.
    expect(texter("Lånet 2026-03-01 förfaller.")).toEqual([]);
  });
});

describe("kontrolleraSiffror: unit scaling", () => {
  it("scales tkr, tusen, miljoner/Mkr/mnkr and miljarder", () => {
    expect(texter("5 759 tkr")).toEqual([]); // 91 kr from the data, within half a tkr
    expect(texter("5 760 tkr")).toEqual(["5 760 tkr"]);
    expect(texter("5 759,091 tkr")).toEqual([]);
    expect(texter("7,8 miljoner kronor")).toEqual([]);
    expect(texter("7,8 Mkr")).toEqual([]);
    expect(texter("7,8 mnkr")).toEqual([]);
    expect(texter("7,4 miljoner kr")).toEqual(["7,4 miljoner kr"]);
    expect(texter("0,0078 miljarder kr")).toEqual([]);
    expect(texter("0,0078 mdkr")).toEqual([]);
    expect(texter("0,0074 miljarder kr")).toEqual(["0,0074 miljarder kr"]);
    expect(texter("7 759 tusen kronor")).toEqual([]);
  });

  it("takes the tolerance from the precision shown: 5,8 miljoner is within 50 000 of 5 759 091", () => {
    expect(texter("5,8 miljoner kr")).toEqual([]);
    expect(texter("5,7 miljoner kr")).toEqual(["5,7 miljoner kr"]);
    expect(texter("6 miljoner kr")).toEqual([]);
    expect(texter("7 miljoner kr")).toEqual(["7 miljoner kr"]);
  });

  it("a whole percentage is within 0,5 of the data (74 % for 74,2)", () => {
    expect(texter("74 %")).toEqual([]);
    expect(texter("74,2 %")).toEqual([]);
    expect(texter("75 %")).toEqual(["75 %"]);
    expect(texter("74,3 %")).toEqual(["74,3 %"]);
    expect(texter("74 procent")).toEqual([]);
  });

  it("an exact amount has no slack beyond rounding", () => {
    expect(texter("5 759 091 kr")).toEqual([]);
    expect(texter("5 759 090 kr")).toEqual(["5 759 090 kr"]);
  });
});

describe("kontrolleraSiffror: pools by kind", () => {
  it("a percentage matches only percentage candidates, never an amount or area", () => {
    const e = verklig();
    e.forening.keyFigures[0]!.figure.value = 780; // 780 kr/m2
    expect(texter("780 %", e)).toEqual(["780 %"]);
    expect(texter("780 kr/m²", e)).toEqual([]);
    expect(texter("780 kr per kvm", e)).toEqual([]);
  });

  it("räntekänslighet 9,2 % from the key figure; other percentages are flagged", () => {
    expect(texter("Räntekänsligheten är 9,2 %.")).toEqual([]);
    expect(texter("Räntekänsligheten är 9,8 %.")).toEqual(["9,8 %"]);
  });

  it("kr/m² key figures", () => {
    expect(texter("Skuldsättningen är 9 800 kr/m² totalyta.")).toEqual([]);
    expect(texter("Skuldsättningen är 9 700 kr/m².")).toEqual(["9 700 kr/m²"]);
  });

  it("numbers inside cited excerpts count (with their unit)", () => {
    // "SBAB 1,1 % ..." is an excerpt: 1,1 % is a known percentage.
    expect(texter("Räntan på lånet är 1,1 %.")).toEqual([]);
    expect(texter("Räntan på lånet är 1,2 %.")).toEqual(["1,2 %"]);
  });

  it("derived shares from the fixed values count (cumulative and per-year)", () => {
    const e = verklig();
    // 2 000 000 / 7 759 091 = 25,8 %
    expect(texter("Resten, 25,8 %, förfaller 2029.", e)).toEqual([]);
    // cumulative to 2029 is 100 %
    expect(texter("Allt, 100 %, förfaller senast 2029.", e)).toEqual([]);
  });

  it("an amount with no kr unit but a large size is checked against everything", () => {
    expect(texter("Totalt 7 759 091 i skulder")).toEqual([]);
    expect(texter("Totalt 7 759 092 i skulder")).toEqual(["7 759 092"]);
  });

  it("treats 'kr 2 284' (unit first) as an amount", () => {
    expect(texter("Skuld kr 2 284")).toEqual(["2 284"]);
  });
});

describe("kontrolleraSiffror: approximation words", () => {
  it("'nästan 90 %' is flagged for 74 %, 'drygt 70 %' passes", () => {
    expect(texter("nästan 90 %")).toEqual(["90 %"]);
    expect(texter("drygt 70 %")).toEqual([]);
    expect(texter("över 70 %")).toEqual([]);
    expect(texter("mer än 70 %")).toEqual([]);
  });

  it("'knappt/nästan/under/närmare X' widens downward only", () => {
    expect(texter("knappt 80 %")).toEqual([]); // [68, 80] holds 74,2
    expect(texter("närmare 75 %")).toEqual([]);
    expect(texter("under 75 %")).toEqual([]);
    expect(texter("knappt 70 %")).toEqual(["70 %"]); // 74 is above 70
    expect(texter("drygt 80 %")).toEqual(["80 %"]); // 74 is below 80
  });

  it("'drygt' is bounded: 15 % above X at most", () => {
    expect(texter("drygt 60 %")).toEqual(["60 %"]); // [60, 69]
    expect(texter("på drygt 65 %")).toEqual([]); // [65, 74.75]
  });

  it("'cirka/ca/omkring/runt/ungefär X' allows 5 % either way", () => {
    expect(texter("cirka 75 %")).toEqual([]);
    expect(texter("ca 76 %")).toEqual([]);
    expect(texter("omkring 77 %")).toEqual([]); // 3,85 wide
    expect(texter("runt 80 %")).toEqual(["80 %"]); // 4 wide: [76, 84]
    expect(texter("ungefär 87 %")).toEqual(["87 %"]);
  });

  it("works for amounts too", () => {
    expect(texter("drygt 5,5 miljoner kr")).toEqual([]);
    expect(texter("nästan 6 miljoner kr")).toEqual([]);
    expect(texter("cirka 6 miljoner kr")).toEqual([]);
    expect(texter("nästan 5 miljoner kr")).toEqual(["5 miljoner kr"]);
  });
});

describe("kontrolleraSiffror: years, page references and small counts", () => {
  it("accepts years in the report and rakenskapsar..rakenskapsar+2", () => {
    expect(texter("Stambyte 2028, lån 2026, årsredovisningen för 2025, nästa år 2027")).toEqual([]);
    expect(texter("Underhållsplanen uppdaterades 2021.")).toEqual([]);
  });

  it("flags a year that is nowhere in the data", () => {
    const a = kontroll("Lånet förfaller 2031.");
    expect(a.map((x) => x.text)).toEqual(["2031"]);
    expect(a[0]!.typ).toBe("ar");
  });

  it("skips page references", () => {
    expect(texter("(se sidan 8)")).toEqual([]);
    expect(texter("se s. 8 och s. 13")).toEqual([]);
    expect(texter("på sidorna 8 och 14")).toEqual([]);
    expect(texter("sida 147")).toEqual([]);
  });

  it("skips small unitless integers (counts) but not small percentages or amounts", () => {
    expect(texter("två lån, 2 lån, 7 nyckeltal, 3 av 7")).toEqual([]);
    expect(texter("3 %")).toEqual(["3 %"]);
    expect(texter("3 kr")).toEqual(["3 kr"]);
  });

  it("a larger unitless integer must exist in the data", () => {
    expect(texter("Föreningen har 48 lägenheter")).toEqual([]); // < 100: skipped
    expect(texter("Föreningen har 480 lägenheter")).toEqual(["480"]);
  });

  it("scenario procentenheter (whole, small) are not data points", () => {
    expect(texter("om räntan stiger med 2 procentenheter")).toEqual([]);
    expect(texter("En ökning med 40 procentenheter")).toEqual(["40 procentenheter"]);
  });
});

describe("kontrolleraSiffror: misc", () => {
  it("reports each distinct wrong number once", () => {
    expect(texter("87 % och återigen 87 %")).toEqual(["87 %"]);
  });

  it("returns nothing for a text without numbers", () => {
    expect(texter("Föreningen har hög skuldsättning.")).toEqual([]);
    expect(texter("")).toEqual([]);
  });

  it("the unmodified fixture's own text numbers pass (benchmarks and excerpts are in the pool)", () => {
    const e = structuredClone(extraktion) as ExtractionResult;
    expect(
      texter(
        "Räntekänsligheten är 9,2 %, skuldsättningen 9 800 kr/m² och 31 000 000 kr omsätts 2026 från 1,1 %.",
        e,
      ),
    ).toEqual([]);
  });

  it("a realistic, correct motivation over the fixture produces no false positives", () => {
    const e = structuredClone(extraktion) as ExtractionResult;
    const text =
      "Betyget D beror på hög skuldsättning, 11 200 kr per kvm bostadsrättsyta, tillsammans med att " +
      "31 000 000 kr (cirka 60 %) av lånen på 52 miljoner kronor omsätts 2026 från en ränta på 1,1 %. " +
      "Räntekänsligheten på 9,2 % betyder att avgiften måste höjas med 9,2 % om räntan stiger med en " +
      "procentenhet. Sparandet är 180 kr/m² och ett stambyte planeras 2028 (se sidan 6). Avgiften höjs " +
      "med 12 % från 2026, och ungefär 40 % förfaller 2029. Två nyckeltal är svaga och ett är kritiskt.";
    expect(texter(text, e)).toEqual([]);
  });

  it("the ASCII spellings kr/m2 and kvm work like kr/m²", () => {
    expect(texter("Sparandet är 180 kr/m2.")).toEqual([]);
    expect(texter("Sparandet är 181 kr/kvm.")).toEqual(["181 kr/kvm"]);
  });
});
