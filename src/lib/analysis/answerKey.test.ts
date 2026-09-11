import { describe, expect, it } from "vitest";
import { jamforTristate, jamforVarde } from "./answerKey";

describe("jamforVarde", () => {
  it("godkänner exakt likhet vid tolerans 'exakt'", () => {
    // Riksbyggen (Helsingborgshus nr 17), verifierat mot sida 8: 984 kr/m²
    const r = jamforVarde("arsavgift_per_m2_brf_yta", 984, 984, "exakt");
    expect(r.godkand).toBe(true);
  });

  it("underkänner minsta avvikelse vid tolerans 'exakt'", () => {
    const r = jamforVarde("arsavgift_per_m2_brf_yta", 985, 984, "exakt");
    expect(r.godkand).toBe(false);
  });

  it("godkänner inom ±1 % vid tolerans 'ungefar'", () => {
    // Riksbyggen snittränta: viktat snitt 2,6757 %, rapporterat 2,68 %
    const r = jamforVarde("lanebok.snittranta", 2.68, 2.6757, "ungefar");
    expect(r.godkand).toBe(true);
    expect(r.avvikelseProcent).toBeLessThan(1);
  });

  it("underkänner utanför ±1 % vid tolerans 'ungefar'", () => {
    const r = jamforVarde("lanebok.snittranta", 3.0, 2.6757, "ungefar");
    expect(r.godkand).toBe(false);
  });

  it("godkänner exakt vid gränsen 1,0 % (inklusive)", () => {
    const r = jamforVarde("x", 101, 100, "ungefar");
    expect(r.avvikelseProcent).toBe(1);
    expect(r.godkand).toBe(true);
  });

  it("underkänner strax över gränsen", () => {
    const r = jamforVarde("x", 101.01, 100, "ungefar");
    expect(r.godkand).toBe(false);
  });

  it("underkänner alltid ett saknat värde (null), oavsett tolerans", () => {
    const exakt = jamforVarde("x", null, 100, "exakt");
    const ungefar = jamforVarde("x", null, 100, "ungefar");
    expect(exakt.godkand).toBe(false);
    expect(ungefar.godkand).toBe(false);
  });

  it("avvikelseProcent är alltid positiv, oavsett riktning", () => {
    const over = jamforVarde("x", 110, 100, "ungefar");
    const under = jamforVarde("x", 90, 100, "ungefar");
    expect(over.avvikelseProcent).toBeCloseTo(10);
    expect(under.avvikelseProcent).toBeCloseTo(10);
  });
});

describe("jamforTristate", () => {
  it("godkänner exakt likhet", () => {
    // Riksbyggen, verifierat mot sida 15: "I årsavgiften ingår kostnader
    // för bredband, kabel-tv, vatten och värme."
    const r = jamforTristate("varme", "ja", "ja");
    expect(r.godkand).toBe(true);
  });

  it("underkänner en felaktig gissning — t.ex. 'nej' när rapporten inte alls tar ställning", () => {
    // SBC, verifierat mot sida 7: "Kostnader för medlemmarnas
    // elförbrukning ingår inte i årsavgiften."
    const r = jamforTristate("el", "okant", "nej");
    expect(r.godkand).toBe(false);
  });

  it("underkänner alltid ett saknat värde (undefined)", () => {
    const r = jamforTristate("el", undefined, "nej");
    expect(r.godkand).toBe(false);
  });

  it("skiljer 'okant' från 'nej' — okänt är inte samma sak som falskt", () => {
    const okantMotNej = jamforTristate("el", "okant", "nej");
    const nejMotNej = jamforTristate("el", "nej", "nej");
    expect(okantMotNej.godkand).toBe(false);
    expect(nejMotNej.godkand).toBe(true);
  });
});
