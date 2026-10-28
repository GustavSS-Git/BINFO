/**
 * Paritetstest för Excel-exporten: arbetsboken skrivs till en riktig .xlsx,
 * läses tillbaka, alla formler räknas av HyperFormula (formelmotor, bara
 * devDependency, GPL-3.0; importeras enbart härifrån och aldrig av
 * produktionskod) och nyckelvärdena jämförs med beraknaKalkyl (±1 kr,
 * ±0,05 procentenheter för kvoter).
 *
 * Kända, avsiktliga skillnader (ingår inte i jämförelsen):
 *  - `betalar`/`drift` jämförs bara när boarean är ifylld (sidan visar inget
 *    schablonvärde utan boarea; summorna använder 0 m² i båda).
 *  - Excels ROUND avrundar halva tal bort från noll, JS Math.round uppåt: kan
 *    ge 1 kr skillnad på ett negativt "kvar" som slutar på exakt ,5.
 */
import ExcelJS from "exceljs";
import { HyperFormula } from "hyperformula";
import { describe, expect, it } from "vitest";
import { beraknaKalkyl } from "./berakna";
import { BOAREA_HINT, PERSONER_HINT } from "@/lib/analysis/calc/schabloner";
import { REGELVERSION, REGLER } from "./regler";
import { BLAD_BERAKNING, BLAD_INDATA, BLAD_OM, BLAD_REGLER, byggKalkylArbetsbok } from "./xlsx";
import { BARN_ALDRAR } from "./sida";
import { KALKYL_UNDERLAG_VERSION, KalkylUnderlagSchema, type KalkylUnderlag } from "./underlag";

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------

interface Motor {
  hf: HyperFormula;
  blad: Map<string, number>;
  namn: Map<string, string>;
  adresser: Record<string, (kolumn?: string) => string>;
}

function kolIndex(kol: string): number {
  let n = 0;
  for (const ch of kol) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parsaAdress(a: string): { blad: string; kol: number; rad: number } {
  const m = /^'?(.+?)'?!\$?([A-Z]+)\$?(\d+)$/.exec(a);
  if (!m) throw new Error(`Ogiltig adress ${a}`);
  return { blad: m[1]!, kol: kolIndex(m[2]!), rad: Number(m[3]) - 1 };
}

async function skapaMotor(u: KalkylUnderlag): Promise<Motor> {
  const { workbook, adresser } = byggKalkylArbetsbok(u, {
    genererad: new Date("2026-10-13T12:00:00Z"),
  });
  // Skriv och läs tillbaka: testar det som faktiskt hamnar i filen.
  const buf = await workbook.xlsx.writeBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);

  const sheets: Record<string, Array<Array<string | number | boolean | null>>> = {};
  for (const ws of wb.worksheets) {
    const rows: Array<Array<string | number | boolean | null>> = [];
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      const cells: Array<string | number | boolean | null> = [];
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        const v = cell.value;
        let out: string | number | boolean | null = null;
        if (v === null || v === undefined) out = null;
        else if (typeof v === "object" && "formula" in v) out = `=${v.formula}`;
        else if (typeof v === "object" && "text" in v) out = String(v.text);
        else if (typeof v === "object")
          out = null; // Date etc.
        else out = v;
        cells[c - 1] = out;
      });
      rows[r - 1] = cells;
    });
    for (let i = 0; i < rows.length; i++) rows[i] ??= [];
    sheets[ws.name] = rows;
  }
  const hf = HyperFormula.buildFromSheets(sheets, { licenseKey: "gpl-v3" });
  const blad = new Map<string, number>();
  for (const name of hf.getSheetNames()) blad.set(name, hf.getSheetId(name)!);

  const namn = new Map<string, string>();
  const model = wb.definedNames.model as Array<{ name: string; ranges: string[] }>;
  for (const d of model) {
    const range = d.ranges[0]!;
    namn.set(d.name, range);
    const r = hf.addNamedExpression(d.name, `=${range}`);
    void r;
  }
  return { hf, blad, namn, adresser };
}

function las(m: Motor, adress: string): number | string | boolean | null {
  const { blad, kol, rad } = parsaAdress(adress);
  const v = m.hf.getCellValue({ sheet: m.blad.get(blad)!, row: rad, col: kol });
  if (typeof v === "object" && v !== null) throw new Error(`Fel i ${adress}: ${JSON.stringify(v)}`);
  return v as number | string | boolean | null;
}

function tal(m: Motor, key: string, kol = "B"): number {
  const v = las(m, m.adresser[key]!(kol));
  if (typeof v !== "number") throw new Error(`${key}/${kol} är ${String(v)}`);
  return v;
}

function satt(m: Motor, namn: string, varde: number | string | null): void {
  const a = parsaAdress(m.namn.get(namn)!);
  m.hf.setCellContents({ sheet: m.blad.get(a.blad)!, row: a.rad, col: a.kol }, varde);
}

// ---------------------------------------------------------------------------
// Slumpade underlag
// ---------------------------------------------------------------------------

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TRI = ["ja", "nej"] as const;

function slumpaUnderlag(seed: number): KalkylUnderlag {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const heltal = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  const ibland = (p: number) => r() < p;

  const bostadsvarde = heltal(8, 70) * 100_000;
  let ltv = pick([0.3, 0.5, 0.7, 0.85, 0.9, 0.45, 0.62, 0.78]);
  if (seed % 7 === 0) ltv = 0.5;
  if (seed % 7 === 1) ltv = 0.7;
  const lan = Math.round((bostadsvarde * ltv) / 1000) * 1000;
  const kontant = bostadsvarde - lan;
  const tv = seed % 5 === 0 ? 10_000_000 : 0;
  const lantagare = (seed % 2 === 0 ? 1 : 2) as 1 | 2;
  const inkomstVal = (): number | undefined => {
    const k = r();
    if (k < 0.12) return undefined;
    if (k < 0.3) return heltal(0, 24) * 1000; // låg inkomst, ofta för lite skatt
    return heltal(20, 130) * 10_000 + pick([0, 0, 100, 5_000, 12_345]);
  };
  const barn: KalkylUnderlag["barn"] = [];
  for (const a of BARN_ALDRAR) if (ibland(0.25)) barn.push(a);
  const vuxna = lantagare === 2 ? 2 : pick([1, 1, 2]);
  const egna: KalkylUnderlag["egnaKostnader"] = {};
  if (ibland(0.3)) egna.hushallsel = heltal(0, 1500);
  if (ibland(0.3)) egna.varme = heltal(0, 2500);
  if (ibland(0.2)) egna.vatten = heltal(0, 500);
  if (ibland(0.2)) egna.bredband = heltal(0, 600);
  if (ibland(0.2)) egna.hemforsakring = heltal(0, 600);

  const u: KalkylUnderlag = {
    version: KALKYL_UNDERLAG_VERSION,
    ...(ibland(0.95) ? { pris: bostadsvarde + tv } : {}),
    ...(ibland(0.95) ? { kontantinsats: kontant } : {}),
    ...(ibland(0.95) ? { rantaProcent: pick([0, 2, 3.35, 3.6, 4.1, 5.25, 8]) } : {}),
    ...(ibland(0.92) ? { manadsavgift: heltal(1500, 9000) + pick([0, 0.4, 0.5]) } : {}),
    ...(ibland(0.92) ? { boarea: pick([25, 38.5, 58, 72.3, 110]) } : {}),
    avgiftInkluderar: {
      varme: pick(TRI),
      vatten: pick(TRI),
      el: pick(TRI),
      bredband: pick(TRI),
      tv: pick(TRI),
    },
    antalLantagare: lantagare,
    ...(() => {
      const a = inkomstVal();
      return a !== undefined ? { inkomst1: a } : {};
    })(),
    ...(() => {
      const a = inkomstVal();
      return a !== undefined ? { inkomst2: a } : {};
    })(),
    antalPersoner: heltal(1, 5),
    antalVuxna: vuxna,
    barn,
    rantestressPp: pick([0, 0.5, 1, 2, 3, 1.5]),
    ...(ibland(0.5) ? { rantekanslighetProcent: pick([0.4, 1.2, 2.5, 3.7]) } : {}),
    kalkylrantaProcent: pick([7, 6, 5, 9, 3]),
    egnaKostnader: egna,
  };
  return KalkylUnderlagSchema.parse(u);
}

/** Särfall som slumpen sällan träffar. */
function sarfall(): KalkylUnderlag[] {
  const bas: KalkylUnderlag = {
    version: KALKYL_UNDERLAG_VERSION,
    pris: 7_000_000,
    kontantinsats: 3_500_000, // exakt 50 %
    rantaProcent: 3.6,
    manadsavgift: 4_300,
    boarea: 58,
    avgiftInkluderar: { varme: "nej", vatten: "ja", el: "nej", bredband: "nej", tv: "ja" },
    antalLantagare: 2,
    inkomst1: 510_000,
    inkomst2: 450_000,
    antalPersoner: 2,
    antalVuxna: 2,
    barn: [],
    rantestressPp: 1,
    rantekanslighetProcent: 1.5,
    kalkylrantaProcent: 7,
    egnaKostnader: {},
  };
  return [
    bas,
    { ...bas, pris: 10_000_000, kontantinsats: 3_000_000 }, // exakt 70 %
    {
      ...bas,
      pris: 1_000_000,
      kontantinsats: 0,
      inkomst1: 0,
      inkomst2: undefined,
    } as KalkylUnderlag,
    { ...bas, pris: 2_000_000, kontantinsats: 2_500_000 }, // insats över priset: 0 kr lån, fel
    { ...bas, pris: undefined }, // inget pris: inget lån
    { ...bas, antalLantagare: 1, inkomst1: 5_000_00 },
    { ...bas, antalLantagare: 1, inkomst1: 2_550_00 }, // pensionsavgift på exakt halvt hundratal
    { ...bas, inkomst1: 25_042, inkomst2: 25_041 },
    {
      ...bas,
      inkomst1: 1_200_000,
      inkomst2: 900_000,
      pris: 10_000_000,
      kontantinsats: 1_000_000,
    },
    { ...bas, barn: ["0-3", "4-6", "15-17"], antalVuxna: 2 },
    { ...bas, barn: ["7-10", "11-14", "15-17", "15-17", "11-14", "7-10"], antalVuxna: 2 }, // 8 personer: KALP går inte
  ].map((u) => KalkylUnderlagSchema.parse(u));
}

// ---------------------------------------------------------------------------
// Jämförelse
// ---------------------------------------------------------------------------

function jamfor(m: Motor, u: KalkylUnderlag, ctx: string): void {
  const r = beraknaKalkyl(u);
  const kr = (namn: string, fas: number, ex: number, tol = 1) => {
    expect(Math.abs(fas - ex), `${ctx}: ${namn} excel=${fas} js=${ex}`).toBeLessThanOrEqual(tol);
  };

  kr("belaningsgrad", tal(m, "belaningsgrad"), r.lan.belaningsgradProcent, 0.05);
  expect(tal(m, "takt"), `${ctx}: takt`).toBe(r.lan.amorteringstaktProcent);
  kr("minKontant", tal(m, "minKontant"), r.lan.minKontantinsats, 1);
  expect(tal(m, "kontantFel") === 1, `${ctx}: kontantFel`).toBe(r.lan.kontantinsatsFel !== null);
  kr("nettoManad", tal(m, "nettoManad"), r.skatt.nettoinkomstPerManad, 1);

  r.skatt.hushall.personer.forEach((p, i) => {
    const kol = i === 0 ? "B" : "C";
    kr(`p${i} skatt`, tal(m, "slutligSkatt", kol), p.slutligSkattUtanRanteavdrag, 1);
  });

  const scen: Array<[string, "nu" | string]> = [
    ["B", "nu"],
    ["C", "egen"],
    ["D", "plus1"],
    ["E", "plus2"],
    ["F", "plus3"],
    ["G", "kalkylranta"],
  ];
  for (const [kol, id] of scen) {
    const s = id === "nu" ? r.nu : r.scenarier.find((x) => x.id === id);
    if (s === undefined) continue; // inga scenarier utan ränta
    const c = `${ctx} [${id}]`;
    kr(`${c} rantekostnad`, tal(m, "rantekost", kol), s.rantekostnad);
    kr(`${c} amortering`, tal(m, "amort", kol), s.amortering);
    kr(`${c} avdrag/mån`, tal(m, "avdrag", kol), s.ranteavdragPerManad);
    kr(`${c} avdrag/år`, tal(m, "avdragAr", kol), s.ranteavdragPerAr);
    kr(`${c} förlorat`, tal(m, "forlorat", kol), s.ranteavdragForloratPerAr);
    kr(`${c} avgift`, tal(m, "avgiftPost", kol), s.manadsavgift);
    kr(`${c} netto`, tal(m, "totNetto", kol), s.summor.netto);
    kr(`${c} brutto`, tal(m, "totBrutto", kol), s.summor.brutto);
    if (r.fyllt.boarea) {
      kr(`${c} drift`, tal(m, "driftSumma", "B"), s.drift);
      kr(`${c} betalar`, tal(m, "betalar", kol), s.betalarPerManad);
      kr(`${c} kvar efter boende`, tal(m, "kvarEfterBoende", kol), s.kvarEfterBoende);
      kr(`${c} andel`, tal(m, "andelNetto", kol), s.andelAvNettoProcent, 0.05);
    }
  }

  // KALP
  const kalpBer = tal(m, "kalpBeraknad") === 1;
  expect(kalpBer, `${ctx}: kalp beräknad`).toBe(r.kalp.beraknad);
  if (r.kalp.beraknad) {
    kr("kalp summa", tal(m, "kalpSumma"), r.kalp.summaKostnader!);
    kr("kalp kvar", tal(m, "kalpKvar"), r.kalp.kvarAttLevaPa!);
    kr("levnad", tal(m, "lvSumma"), r.kalp.levnadskostnader!.summa);
    const utfall = las(m, m.adresser["kalpUtfall"]!("B"));
    expect(utfall, `${ctx}: utfall`).toBe(r.kalp.utfall === "plus" ? "Plus" : "Minus");
  }
}

describe("Excel-export: paritet med beraknaKalkyl", () => {
  it("har rätt blad och namngivna celler", async () => {
    const m = await skapaMotor(sarfall()[0]!);
    expect([...m.blad.keys()]).toEqual([BLAD_INDATA, BLAD_REGLER, BLAD_BERAKNING, BLAD_OM]);
    for (const n of [
      "Pris",
      "Lanebelopp",
      "Kontantinsats",
      "Ranta",
      "Manadsavgift",
      "Boarea",
      "AntalLantagare",
      "Inkomst_1",
      "Inkomst_2",
      "AntalPersoner",
      "AntalVuxna",
      "Barn_0_3",
      "Barn_15_17",
      "Kalkylranta",
      "Rantestress",
      "Rantekanslighet",
      "Bolanetak",
      "Amort_Grans_1",
      "Amort_Grans_2",
      "Amort_Takt_1",
      "Amort_Takt_2",
      "Ranteavdrag_Sats_Lag",
      "Ranteavdrag_Sats_Hog",
      "Ranteavdrag_Tak_Per_Person",
      "PBB",
      "IBB",
      "Kommunalskatt",
      "Skiktgrans",
      "Statlig_Skatt",
      "KV_Mat",
      "Schablon_Varme_Per_M2",
      "Schablon_Vatten_Per_Person",
    ]) {
      expect(m.namn.has(n), `namn ${n}`).toBe(true);
    }
  });

  it("särfall stämmer med beraknaKalkyl", async () => {
    let i = 0;
    for (const u of sarfall()) {
      const m = await skapaMotor(u);
      jamfor(m, u, `särfall ${i++}`);
    }
  }, 120_000);

  it("60 slumpade underlag stämmer med beraknaKalkyl (±1 kr)", async () => {
    for (let seed = 1; seed <= 60; seed++) {
      const u = slumpaUnderlag(seed);
      const m = await skapaMotor(u);
      jamfor(m, u, `seed ${seed}`);
    }
  }, 600_000);

  it("ändrad ränta på bladet Indata räknar om beroende värden", async () => {
    const u = sarfall()[0]!;
    const m = await skapaMotor(u);
    const fore = tal(m, "rantekost", "C");
    satt(m, "Ranta", 5);
    const efter = tal(m, "rantekost", "C");
    expect(efter).toBe(Math.round((3_500_000 * 0.05) / 12));
    expect(efter).toBeGreaterThan(fore);
    // och stämmer med beraknaKalkyl för samma ändring
    jamfor(m, { ...u, rantaProcent: 5 }, "ändrad ränta");
  });

  it("ändrat bolånetak på regelbladet ändrar kontantinsatskontrollen", async () => {
    // 10 % kontantinsats: godkänd vid 90 % tak.
    const u = KalkylUnderlagSchema.parse({
      ...sarfall()[0]!,
      pris: 5_000_000,
      kontantinsats: 500_000,
    });
    const m = await skapaMotor(u);
    expect(tal(m, "kontantFel")).toBe(0);
    satt(m, "Bolanetak", 85);
    expect(tal(m, "kontantFel")).toBe(1);
    expect(tal(m, "minKontant")).toBeCloseTo(750_000, 0);
  });

  it("ändrad amorteringsgräns på regelbladet ändrar amorteringstakten", async () => {
    const m = await skapaMotor(sarfall()[0]!); // exakt 50 %: 0 %
    expect(tal(m, "takt")).toBe(0);
    satt(m, "Amort_Grans_1", 40);
    expect(tal(m, "takt")).toBe(1);
  });

  it("jämförelsen slår larm när en regel ändras (mätarens kontroll)", async () => {
    const u = KalkylUnderlagSchema.parse({
      ...sarfall()[0]!,
      pris: 7_000_000,
      kontantinsats: 1_000_000,
    });
    const m = await skapaMotor(u);
    jamfor(m, u, "orörd");
    satt(m, "Kommunalskatt", 40);
    expect(() => jamfor(m, u, "ändrad skatt")).toThrow();
  });

  it("bladet Regler och antaganden visar samma värden som regelregistret (inkl. vatten per person)", () => {
    const { workbook } = byggKalkylArbetsbok(sarfall()[0]!, {
      genererad: new Date("2026-10-28T12:00:00Z"),
    });
    const ws = workbook.getWorksheet(BLAD_REGLER)!;
    expect(String(ws.getCell("A1").value)).toContain(REGELVERSION);
    const rader = new Map<string, { varde: unknown; enhet: unknown }>();
    ws.eachRow((row) => {
      rader.set(String(row.getCell(1).value), {
        varde: row.getCell(2).value,
        enhet: row.getCell(3).value,
      });
    });
    for (const regel of REGLER) {
      const rad = rader.get(regel.namn);
      expect(rad, regel.namn).toBeDefined();
      expect(rad?.varde, regel.namn).toBe(regel.varde);
      expect(rad?.enhet, regel.namn).toBe(regel.enhet);
    }
    expect(rader.get(REGLER.find((r) => r.id === "schablon_vatten_per_person")!.namn)?.varde).toBe(
      135,
    );
    expect(
      [...rader.keys()].some((k) => k.includes("per m² boarea") && k.startsWith("Vatten")),
    ).toBe(false);
  });

  it("fälthintarna på bladet Indata är samma som sidans, och posterna har två lägen", () => {
    const { workbook } = byggKalkylArbetsbok(sarfall()[0]!);
    const ws = workbook.getWorksheet(BLAD_INDATA)!;
    const hint = (etikett: string): string => {
      let ut = "";
      ws.eachRow((row) => {
        if (String(row.getCell(1).value) === etikett) ut = String(row.getCell(4).value);
      });
      return ut;
    };
    expect(hint("Boarea")).toBe(BOAREA_HINT);
    expect(hint("Antal personer i hushållet")).toBe(PERSONER_HINT);
    expect(hint("Pris du räknar med")).toContain("Lånet är priset minus kontantinsatsen");
    expect(hint("Ingår vatten i avgiften?")).not.toMatch(/vet ej/i);
  });

  it("vatten som inte ingår i avgiften kostar 135 kr per person i Excel (+270 för två personer)", async () => {
    const bas = sarfall()[0]!;
    const m = await skapaMotor({
      ...bas,
      avgiftInkluderar: { ...bas.avgiftInkluderar, vatten: "ja" },
    });
    const fore = tal(m, "totNetto");
    satt(m, "Avgift_Vatten", "nej");
    expect(tal(m, "totNetto") - fore).toBe(270);
  });
});
