import { describe, expect, it } from "vitest";
import {
  costItemOsaker,
  formatBudpremieText,
  formatDataperiod,
  formatDrivareLabel,
  formatEnhet,
  formatFigureVarde,
  formatSkapadDatum,
  formatVarde,
  toppRodaFlaggor,
  varderingsTackningText,
} from "./analysisView";
import type {
  Varderingsunderlag,
  Budpremie,
  FeeInclusion,
  Figure,
  RedFlag,
} from "@/types/analysis";

function flagga(id: string, severity: RedFlag["severity"]): RedFlag {
  return { id, titel: id, beskrivning: id, severity, harledsFran: [] };
}

describe("toppRodaFlaggor", () => {
  it("plockar ut de mest allvarliga flaggorna först", () => {
    const flaggor = [flagga("a", "lag"), flagga("b", "hog"), flagga("c", "medel")];
    expect(toppRodaFlaggor(flaggor, 2).map((f) => f.id)).toEqual(["b", "c"]);
  });

  it("behåller ursprunglig ordning vid lika allvarlighetsgrad", () => {
    const flaggor = [flagga("a", "hog"), flagga("b", "hog"), flagga("c", "hog")];
    expect(toppRodaFlaggor(flaggor, 2).map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("returnerar färre än N om det inte finns fler flaggor", () => {
    expect(toppRodaFlaggor([flagga("a", "hog")], 2)).toHaveLength(1);
  });

  it("muterar inte den ursprungliga listan", () => {
    const flaggor = [flagga("a", "lag"), flagga("b", "hog")];
    toppRodaFlaggor(flaggor, 1);
    expect(flaggor.map((f) => f.id)).toEqual(["a", "b"]);
  });
});

const avgiftInkluderar = (overrides: Partial<FeeInclusion>): FeeInclusion => ({
  varme: "okant",
  vatten: "okant",
  el: "okant",
  bredband: "okant",
  tv: "okant",
  ...overrides,
});

describe("costItemOsaker", () => {
  it("är osäker när avgiftsfältet står på 'okant'", () => {
    expect(costItemOsaker("hushallsel", avgiftInkluderar({ el: "okant" }))).toBe(true);
  });

  it("är inte osäker när avgiftsfältet är 'ja' eller 'nej'", () => {
    expect(costItemOsaker("varme", avgiftInkluderar({ varme: "ja" }))).toBe(false);
    expect(costItemOsaker("vatten", avgiftInkluderar({ vatten: "nej" }))).toBe(false);
  });

  it("hemförsäkring och lånerelaterade poster är aldrig osäkra — de har ingen avgiftskoppling", () => {
    expect(costItemOsaker("hemforsakring", avgiftInkluderar({}))).toBe(false);
    expect(costItemOsaker("rantekostnad", avgiftInkluderar({}))).toBe(false);
    expect(costItemOsaker("amortering", avgiftInkluderar({}))).toBe(false);
    expect(costItemOsaker("ranteavdrag", avgiftInkluderar({}))).toBe(false);
    expect(costItemOsaker("manadsavgift", avgiftInkluderar({}))).toBe(false);
  });
});

describe("formatSkapadDatum", () => {
  it("formaterar en ISO 8601-tidsstämpel som ett kort svenskt datum", () => {
    expect(formatSkapadDatum("2026-09-12T16:26:31.734Z")).toBe("12 sep. 2026");
  });
});

describe("formatDataperiod", () => {
  it("formaterar en period inom samma år som 'kortmånad–kortmånad år'", () => {
    expect(formatDataperiod({ fran: "2026-01-01", till: "2026-08-31" })).toBe("jan–aug 2026");
  });

  it("formaterar en period över ett årsskifte med båda åren utsatta", () => {
    expect(formatDataperiod({ fran: "2025-11-01", till: "2026-02-28" })).toBe("nov 2025–feb 2026");
  });

  it("formaterar en enda månad som 'kortmånad år', inte 'aug–aug'", () => {
    expect(formatDataperiod({ fran: "2026-08", till: "2026-08" })).toBe("aug 2026");
    expect(formatDataperiod({ fran: "2026-08-01", till: "2026-08-31" })).toBe("aug 2026");
  });

  it("faller tillbaka till rådatumen för ett oväntat format hellre än att krascha", () => {
    expect(formatDataperiod({ fran: "", till: "" })).toBe("–");
  });
});

describe("formatBudpremieText", () => {
  const period = { fran: "2026-01-01", till: "2026-08-31" };

  it("använder området och medianen när omrade är känt", () => {
    const budpremie: Budpremie = {
      omrade: "Södermalm",
      medianProcent: 3.7,
      medelProcent: 5.57,
      n: 448,
      dataperiod: period,
    };
    expect(formatBudpremieText(budpremie)).toBe(
      "Bostäder i Södermalm har sålts för 3,7 % över utgångspriset.",
    );
  });

  it("säger 'under' för ett negativt värde", () => {
    const budpremie: Budpremie = {
      omrade: "Farsta-Vantör",
      medianProcent: -2.1,
      medelProcent: -1.4,
      n: 120,
      dataperiod: period,
    };
    expect(formatBudpremieText(budpremie)).toContain("under utgångspriset");
    expect(formatBudpremieText(budpremie)).toContain("2,1 %");
  });

  it("säger 'i linje med' för ett värde nära noll", () => {
    const budpremie: Budpremie = {
      omrade: "Essingen",
      medianProcent: 0.1,
      medelProcent: 0.1,
      n: 77,
      dataperiod: period,
    };
    expect(formatBudpremieText(budpremie)).toContain("i linje med utgångspriset");
  });

  it("faller tillbaka till Stockholms median (samma mått som för ett område) när omrade är null", () => {
    const budpremie: Budpremie = {
      omrade: null,
      medianProcent: 4.78,
      medelProcent: 6.41,
      n: 4051,
      dataperiod: period,
    };
    const text = formatBudpremieText(budpremie);
    expect(text).toBe(
      "Bostäder i Stockholm har sålts för 4,8 % över utgångspriset.",
    );
  });
});

/**
 * Formatteringen som visar Figure-värden — svensk decimalkomma,
 * mellanslag som tusentalsavgränsare, och "Uppgift saknas" för null
 * (okänt är inte samma sak som noll eller falskt).
 *
 * sv-SE:s Intl.NumberFormat använder en icke-brytande mellanslag (U+00A0)
 * som tusentalsavgränsare och ett riktigt minustecken (U+2212), inte ett
 * bindestreck — därför byggs förväntade strängar med samma tecken här
 * i stället för att gissa på vanliga ASCII-tecken.
 */
const NBSP = " ";
const MINUS = "−";

describe("formatEnhet", () => {
  it("mappar varje Figure-enhet till läsbar svensk enhetstext", () => {
    expect(formatEnhet("kr")).toBe("kr");
    expect(formatEnhet("kr/man")).toBe("kr/mån");
    expect(formatEnhet("kr/m2")).toBe("kr/m²");
    expect(formatEnhet("kr/m2/ar")).toBe("kr/m²/år");
    expect(formatEnhet("procent")).toBe("%");
    expect(formatEnhet("m2")).toBe("m²");
    expect(formatEnhet("ar")).toBe("år");
    expect(formatEnhet("antal")).toBe("st");
    expect(formatEnhet("gånger")).toBe("ggr");
  });
});

describe("formatVarde", () => {
  it("renderar null som 'Uppgift saknas', oavsett enhet — okänt är inte falskt", () => {
    expect(formatVarde(null, "kr")).toBe("Uppgift saknas");
    expect(formatVarde(null, "procent")).toBe("Uppgift saknas");
  });

  it("formaterar kr som heltal med mellanslag och kr-suffix", () => {
    expect(formatVarde(3200000, "kr")).toBe(`3${NBSP}200${NBSP}000 kr`);
    expect(formatVarde(0, "kr")).toBe("0 kr");
  });

  it("formaterar kr/m2 som heltal med rätt suffix", () => {
    expect(formatVarde(1006, "kr/m2")).toBe(`1${NBSP}006 kr/m²`);
  });

  it("formaterar procent med svenskt decimalkomma, utan onödiga decimaler", () => {
    expect(formatVarde(9.09, "procent")).toBe("9,09 %");
    expect(formatVarde(80.1, "procent")).toBe("80,1 %");
    expect(formatVarde(-25.9, "procent")).toBe(`${MINUS}25,9 %`);
    expect(formatVarde(2, "procent")).toBe("2 %");
  });

  it("formaterar m2 med exakt en decimal, enligt konventionen för areor", () => {
    expect(formatVarde(3040, "m2")).toBe(`3${NBSP}040,0 m²`);
    expect(formatVarde(54.5, "m2")).toBe("54,5 m²");
  });

  it("formaterar antal som tusentalsavgränsat heltal, ar (årtal) utan avgränsare", () => {
    expect(formatVarde(49, "antal")).toBe("49 st");
    expect(formatVarde(1935, "ar")).toBe("1935 år");
  });
});

describe("formatFigureVarde", () => {
  it("delegerar till formatVarde utifrån figurens value och unit", () => {
    const figure: Figure = { value: 9.09, unit: "procent", source: "arsredovisning" };
    expect(formatFigureVarde(figure)).toBe("9,09 %");
  });

  it("visar 'Uppgift saknas' för en figur utan värde och utan tecken", () => {
    const figure: Figure = { value: null, unit: "kr", source: "arsredovisning" };
    expect(formatFigureVarde(figure)).toBe("Uppgift saknas");
  });

  it("visar tecken negativ plus det tryckta värdet i stället för 'Uppgift saknas' (t.ex. 'neg' i rapporten)", () => {
    const figure: Figure = {
      value: null,
      unit: "kr/m2",
      source: "arsredovisning",
      tecken: "negativ",
      tryckt: "neg",
    };
    expect(formatFigureVarde(figure)).toBe('Negativt ("neg" i årsredovisningen)');
  });

  it("visar tecken positiv plus det tryckta värdet", () => {
    const figure: Figure = {
      value: null,
      unit: "kr/m2",
      source: "arsredovisning",
      tecken: "positiv",
      tryckt: "pos",
    };
    expect(formatFigureVarde(figure)).toBe('Positivt ("pos" i årsredovisningen)');
  });

  it("visar bara tecknet, utan citat, om tryckt saknas", () => {
    const figure: Figure = {
      value: null,
      unit: "kr/m2",
      source: "berakning",
      tecken: "negativ",
    };
    expect(formatFigureVarde(figure)).toBe("Negativt");
  });

  it("en figur med ett faktiskt negativt tal formateras som vanligt (tecken påverkar bara null-fallet)", () => {
    const figure: Figure = {
      value: -50,
      unit: "kr/m2",
      source: "arsredovisning",
      tecken: "negativ",
    };
    expect(formatFigureVarde(figure)).toBe(formatVarde(-50, "kr/m2"));
  });
});

describe("formatDrivareLabel", () => {
  it("names the area for an area-specific driver, not for a Stockholm-wide one", () => {
    expect(formatDrivareLabel({ label: "Ingen hiss", niva: "omrade" }, "Östermalm")).toBe(
      "Ingen hiss (Östermalm)",
    );
    expect(formatDrivareLabel({ label: "Ingen hiss", niva: "stad" }, "Södermalm")).toBe(
      "Ingen hiss",
    );
  });
});

describe("varderingsTackningText", () => {
  const base = { omrade: null, drivare: [] } as unknown as Varderingsunderlag;
  const prisniva = {
    region: "Nacka",
    krPerM2: 82000,
    period: { fran: "2026-01-01", till: "2026-08-31" },
    kalla: "Svensk Mäklarstatistik",
  };

  it("ger null för Stockholm och för äldre analyser utan tackning", () => {
    expect(varderingsTackningText(base)).toBeNull();
    expect(varderingsTackningText({ ...base, tackning: "stockholm" })).toBeNull();
  });

  it("ger en metodnotis för län med kommun och prisnivå", () => {
    const t = varderingsTackningText({ ...base, tackning: "lan", kommun: "Nacka", prisniva });
    expect(t?.typ).toBe("lan");
    expect(t?.text).toContain("genomsnittspriset i Nacka");
    expect(t?.text).toContain("82");
    expect(t?.text).toContain("Svensk Mäklarstatistik");
    expect(t?.text).toContain("jan–aug 2026");
  });

  it("ger en friskrivning utanför länet", () => {
    const t = varderingsTackningText({
      ...base,
      tackning: "utanfor_lan",
      prisniva: { ...prisniva, region: "Riket" },
    });
    expect(t?.typ).toBe("utanfor_lan");
    expect(t?.titel).toBe("Utanför Binfos täckningsområde");
    expect(t?.text).toContain("riksgenomsnittet för bostadsrätter");
    expect(t?.text).toContain("betydligt mindre träffsäker");
  });

  it("skriver aldrig 'undefined' när prisnivå eller kommun saknas", () => {
    for (const tackning of ["lan", "utanfor_lan"] as const) {
      const t = varderingsTackningText({ ...base, tackning });
      expect(t?.text).toBeTruthy();
      expect(t?.text).not.toContain("undefined");
      expect(t?.text).not.toContain("null");
    }
  });
});
