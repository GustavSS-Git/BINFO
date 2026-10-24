import { describe, expect, it } from "vitest";
import {
  jamforTecken,
  jamforTristate,
  jamforVarde,
  poangsattLan,
  type LanFacitFil,
} from "./answerKey";

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

describe("jamforTecken", () => {
  it("godkänner när tecknet stämmer och value är null (Volontären: 'neg')", () => {
    const r = jamforTecken("sparande_per_m2_totalyta", null, "negativ", "negativ");
    expect(r.godkand).toBe(true);
  });

  it("underkänner ett motsatt tecken", () => {
    const r = jamforTecken("sparande_per_m2_totalyta", null, "positiv", "negativ");
    expect(r.godkand).toBe(false);
  });

  it("underkänner när tecken saknas helt (undefined)", () => {
    const r = jamforTecken("sparande_per_m2_totalyta", null, undefined, "negativ");
    expect(r.godkand).toBe(false);
  });

  it("underkänner ett faktiskt tal — facit ger ingen magnitud att jämföra mot", () => {
    const r = jamforTecken("sparande_per_m2_totalyta", -50, "negativ", "negativ");
    expect(r.godkand).toBe(false);
  });
});

describe("poangsattLan", () => {
  const facit: LanFacitFil = {
    balansdag: "2025-12-31",
    rantekostnader: { belopp: 235636 },
    lan: [
      { kreditgivare: "SEB", belopp: 1000000, ranta: 2.5, villkorsandringsdag: "2026-03-28" },
      { kreditgivare: "SEB", belopp: 2000000, ranta: 3, villkorsandringsdag: "2028-10-28" },
    ],
  };
  const lan = (belopp: number, ranta: number, dag?: string) => ({
    belopp: { value: belopp },
    ranta: { value: ranta },
    ...(dag ? { villkorsandringsdag: dag } : {}),
  });

  it("godkänner allt när antal, summa, datum och ränta stämmer (även i annan ordning)", () => {
    const poang = poangsattLan(facit, {
      balansdag: "2025-12-31",
      rantekostnader: { value: 235636 },
      lan: [lan(2000000, 3, "2028-10-28"), lan(1000000, 2.5, "2026-03-28")],
    });
    expect(poang.every((p) => p.godkand)).toBe(true);
    expect(poang).toHaveLength(4 + 6);
  });

  it("underkänner fel datum, fel ränta och ett lån som saknas", () => {
    const poang = poangsattLan(facit, {
      balansdag: "2025-12-31",
      lan: [lan(1000000, 2.4, "2026-03-29")],
    });
    const per = (f: string) => poang.find((p) => p.falt.endsWith(f) && p.falt.includes("1000000"));
    expect(per("villkorsandringsdag")?.godkand).toBe(false);
    expect(per("ranta")?.godkand).toBe(false);
    expect(per("belopp")?.godkand).toBe(true);
    expect(poang.find((p) => p.falt === "lan.antal")?.godkand).toBe(false);
    expect(poang.find((p) => p.falt === "lan.summa")?.godkand).toBe(false);
    expect(poang.find((p) => p.falt === "lanebok.rantekostnader")).toMatchObject({
      godkand: false,
      faktiskt: "saknas",
    });
    const saknat = poang.filter((p) => p.falt.includes("2000000"));
    expect(saknat).toHaveLength(3);
    expect(saknat.every((p) => !p.godkand)).toBe(true);
  });

  it("underkänner allt när inga lån extraherats (saknat är aldrig godkänt)", () => {
    const poang = poangsattLan(facit, {});
    expect(poang.filter((p) => p.godkand).map((p) => p.falt)).toEqual([]);
  });

  it("parar ett lån med samma belopp bara en gång", () => {
    const tva: LanFacitFil = {
      lan: [
        { belopp: 500, ranta: 1, villkorsandringsdag: "2026-01-01" },
        { belopp: 500, ranta: 2, villkorsandringsdag: "2027-01-01" },
      ],
    };
    const bra = poangsattLan(tva, { lan: [lan(500, 2, "2027-01-01"), lan(500, 1, "2026-01-01")] });
    expect(bra.every((p) => p.godkand)).toBe(true);
    const enda = poangsattLan(tva, { lan: [lan(500, 1, "2026-01-01")] });
    expect(enda.filter((p) => !p.godkand).length).toBeGreaterThan(0);
  });
});
