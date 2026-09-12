import { describe, expect, it } from "vitest";
import { formatEnhet, formatFigureVarde, formatVarde } from "@/routes/analys";
import type { Figure } from "@/types/analysis";

/**
 * Formatteringen som visar Figure-värden i /analys — svensk decimalkomma,
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

  it("visar 'Uppgift saknas' för en figur utan värde", () => {
    const figure: Figure = { value: null, unit: "kr", source: "arsredovisning" };
    expect(formatFigureVarde(figure)).toBe("Uppgift saknas");
  });
});
