/**
 * Excel-export av bolånekalkylen (.xlsx) med LEVANDE formler.
 *
 * Arbetsboken har fyra blad:
 *  - "Indata": alla inmatningsvärden som namngivna celler (ändra här).
 *  - "Regler och antaganden": varje regel i regelregistret (regler.ts) i en
 *    namngiven cell, med källa, giltighetsdatum, verifieringsdatum och status.
 *  - "Beräkning": hela beräkningen som formler som pekar på de namngivna
 *    cellerna. Speglar src/lib/kalkyl/berakna.ts, src/lib/skatt2026.ts och
 *    levnadskostnader.ts formel för formel (inklusive avrundningar).
 *  - "Om filen": datum, regelversion, förbehåll.
 *
 * Inga siffror hittas på här: reglerna läses ur REGLER, inmatningen ur
 * KalkylUnderlag. Paritetstestet (xlsx.paritet.test.ts) räknar om filen med
 * en formelmotor och jämför mot beraknaKalkyl.
 *
 * Den här modulen importerar exceljs (stor) och får BARA nås via
 * dynamic import (se src/components/pdf/downloadKalkyl.tsx).
 */
import ExcelJS from "exceljs";
import { PDF_DISCLAIMER } from "@/components/pdf/theme";
import { FALTGRANSER } from "@/lib/kalkyl/indata";
import {
  KONSUMENTVERKET_2026,
  KV_ALDERSGRUPPER,
  REGELVERSION,
  REGLER,
  STATUS_ETIKETT,
  type Regel,
} from "@/lib/kalkyl/regler";
import { KALKYL_UNDERLAG_VERSION, type KalkylUnderlag } from "@/lib/kalkyl/underlag";

export const BLAD_INDATA = "Indata";
export const BLAD_REGLER = "Regler och antaganden";
export const BLAD_BERAKNING = "Beräkning";
export const BLAD_OM = "Om filen";

const FYLLNING_INDATA = "FFEEF1E6"; // PDF_COLORS.primaryTint
const FYLLNING_RUBRIK = "FFF1F0EA"; // PDF_COLORS.secondary
const FYLLNING_RESULTAT = "FFE9F5EE"; // PDF_COLORS.successTint
const FARG_PRIMARY = "FF627342";
const FARG_MUTED = "FF716D66";

const FMT = {
  kr: '#,##0 "kr";-#,##0 "kr"',
  tal: "#,##0",
  proc1: '0.0 "%"',
  proc2: '0.00 "%"',
  andel: "0.000",
  decimal: "#,##0.##",
} as const;

// ---------------------------------------------------------------------------
// Regler: id -> namn på cellen i arbetsboken
// ---------------------------------------------------------------------------

const REGELNAMN: Record<string, string> = {
  bolanetak: "Bolanetak",
  amortering_troskel_hog: "Amort_Grans_2",
  amortering_troskel_lag: "Amort_Grans_1",
  amortering_takt_hog: "Amort_Takt_2",
  amortering_takt_mellan: "Amort_Takt_1",
  amortering_takt_lag: "Amort_Takt_0",
  amortering_nyproduktion_ar: "Amort_Nyproduktion_Ar",
  ranteavdrag_sats_lag: "Ranteavdrag_Sats_Lag",
  ranteavdrag_sats_hog: "Ranteavdrag_Sats_Hog",
  ranteavdrag_tak: "Ranteavdrag_Tak_Per_Person",
  skatt_pbb: "PBB",
  skatt_ibb: "IBB",
  skatt_kommunal: "Kommunalskatt",
  skatt_begravning: "Begravningsavgift",
  skatt_statlig: "Statlig_Skatt",
  skatt_skiktgrans: "Skiktgrans",
  skatt_publicservice_sats: "PublicService_Sats",
  skatt_publicservice_tak: "PublicService_Tak",
  skatt_pension_sats: "Pension_Sats",
  skatt_pension_tak_inkomst: "Pension_Tak_Inkomst",
  skatt_pension_nedre_grans: "Pension_Nedre_Grans",
  ga_grans_1: "GA_Grans_1",
  ga_grans_2: "GA_Grans_2",
  ga_grans_3: "GA_Grans_3",
  ga_grans_4: "GA_Grans_4",
  ga_bas: "GA_Bas",
  ga_okning: "GA_Okning",
  ga_topp: "GA_Topp",
  ga_minskning: "GA_Minskning",
  ga_lagsta: "GA_Lagsta",
  jsa_grans_1: "JSA_Grans_1",
  jsa_grans_2: "JSA_Grans_2",
  jsa_grans_3: "JSA_Grans_3",
  jsa_sats_2: "JSA_Sats_2",
  jsa_bas_3: "JSA_Bas_3",
  jsa_sats_3: "JSA_Sats_3",
  jsa_tak: "JSA_Tak",
  sf_nedre: "SF_Nedre",
  sf_ovre: "SF_Ovre",
  sf_sats: "SF_Sats",
  sf_max: "SF_Max",
  kalkylranta_standard: "Kalkylranta_Standard",
  skuldkvot_bankstak: "Skuldkvot_Bankstak",
  kalp_barn_under_8_avdrag: "KV_Barn_Under_8_Avdrag",
  schablon_varme_per_m2: "Schablon_Varme_Per_M2",
  schablon_vatten_per_m2: "Schablon_Vatten_Per_M2",
  schablon_bredband: "Schablon_Bredband",
};

/** Konsumentverkets tabeller: namn på intervallet (10 åldersgrupper eller 1–7 personer). */
const KV_INTERVALL: Record<string, string> = {
  kv_mat_: "KV_Mat",
  kv_klader_skor_: "KV_Klader_Skor",
  kv_fritid_lek_: "KV_Fritid_Lek",
  kv_mobiltelefon_: "KV_Mobiltelefon",
  kv_personlig_hygien_: "KV_Personlig_Hygien",
  kv_barn_och_ungdomsforsakring_: "KV_Barnforsakring",
  kv_ovrig_barnutrustning_: "KV_Barnutrustning",
  kv_gemensam_forbrukningsvaror_: "KV_G_Forbrukningsvaror",
  kv_gemensam_hemutrustning_: "KV_G_Hemutrustning",
  kv_gemensam_internet_och_mobilabonnemang_: "KV_G_Internet",
  kv_gemensam_ovriga_medietjanster_: "KV_G_Medier",
  kv_gemensam_hushallsel_: "KV_G_Hushallsel",
  kv_gemensam_vatten_och_avlopp_: "KV_G_Vatten",
  kv_gemensam_hemforsakring_: "KV_G_Hemforsakring",
};

const OVRIGA_INTERVALL = [
  "KV_Klader_Skor",
  "KV_Fritid_Lek",
  "KV_Mobiltelefon",
  "KV_Personlig_Hygien",
  "KV_Barnforsakring",
  "KV_Barnutrustning",
] as const;

const GEMENSAMMA_INTERVALL = [
  "KV_G_Forbrukningsvaror",
  "KV_G_Hemutrustning",
  "KV_G_Internet",
  "KV_G_Medier",
  "KV_G_Hushallsel",
  "KV_G_Vatten",
  "KV_G_Hemforsakring",
] as const;

// ---------------------------------------------------------------------------
// Hjälpare
// ---------------------------------------------------------------------------

function kvIndex(alder: (typeof KV_ALDERSGRUPPER)[number]): number {
  return KV_ALDERSGRUPPER.indexOf(alder) + 1;
}

const adr = (blad: string, cell: string) => `'${blad}'!${cell}`;

function stil(
  cell: ExcelJS.Cell,
  s: {
    fill?: string;
    bold?: boolean;
    color?: string;
    size?: number;
    wrap?: boolean;
    border?: boolean;
    fmt?: string;
    italic?: boolean;
  },
): void {
  if (s.fill !== undefined) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: s.fill } };
  }
  if (s.bold !== undefined || s.color !== undefined || s.size !== undefined || s.italic) {
    cell.font = {
      name: "Calibri",
      ...(s.bold ? { bold: true } : {}),
      ...(s.italic ? { italic: true } : {}),
      ...(s.color !== undefined ? { color: { argb: s.color } } : {}),
      ...(s.size !== undefined ? { size: s.size } : {}),
    };
  }
  if (s.wrap) cell.alignment = { wrapText: true, vertical: "top" };
  if (s.border) {
    const k = { style: "thin", color: { argb: "FFDEDCD6" } } as const;
    cell.border = { top: k, left: k, bottom: k, right: k };
  }
  if (s.fmt !== undefined) cell.numFmt = s.fmt;
}

const AVGIFT_TEXT = { ja: "ja", nej: "nej", okant: "vet ej" } as const;

// ---------------------------------------------------------------------------
// Blad: Indata
// ---------------------------------------------------------------------------

interface IndataFalt {
  namn: string;
  etikett: string;
  varde: number | string | undefined;
  enhet: string;
  hint: string;
  fmt?: string;
  validering?:
    { typ: "decimal" | "whole"; min: number; max: number } | { typ: "lista"; alternativ: string };
}

function indataFalt(u: KalkylUnderlag): Array<IndataFalt | string> {
  const barn = (alder: string) => u.barn.filter((b) => b === alder).length;
  const g = FALTGRANSER;
  const dec = (min: number, max: number) => ({ typ: "decimal" as const, min, max });
  const hel = (min: number, max: number) => ({ typ: "whole" as const, min, max });
  const lista = { typ: "lista" as const, alternativ: '"ja,nej,vet ej"' };
  return [
    "Lån och bostad",
    {
      namn: "Lanebelopp",
      etikett: "Lånebelopp",
      varde: u.lanebelopp,
      enhet: "kr",
      hint: "Hur mycket du lånar av banken.",
      fmt: FMT.kr,
      validering: dec(g.lanebelopp.min, g.lanebelopp.max),
    },
    {
      namn: "Kontantinsats",
      etikett: "Kontantinsats",
      varde: u.kontantinsats,
      enhet: "kr",
      hint: "Det du betalar själv. Bostadens värde räknas som lånebelopp + kontantinsats.",
      fmt: FMT.kr,
      validering: dec(g.kontantinsats.min, g.kontantinsats.max),
    },
    {
      namn: "Ranta",
      etikett: "Din bolåneränta",
      varde: u.rantaProcent,
      enhet: "% per år",
      hint: "Räntan banken erbjuder dig, till exempel 3,6.",
      fmt: FMT.proc2,
      validering: dec(g.ranta.min, g.ranta.max),
    },
    {
      namn: "Manadsavgift",
      etikett: "Månadsavgift till bostadsrättsföreningen",
      varde: u.manadsavgift,
      enhet: "kr per månad",
      hint: "Enligt förvaltarens uppgifter eller annonsen.",
      fmt: FMT.kr,
      validering: dec(g.manadsavgift.min, g.manadsavgift.max),
    },
    {
      namn: "Boarea",
      etikett: "Boarea",
      varde: u.boarea,
      enhet: "m²",
      hint: "Behövs för schablonerna för värme och vatten.",
      fmt: FMT.decimal,
      validering: dec(g.boarea.min, g.boarea.max),
    },
    "Vad ingår i månadsavgiften?",
    ...(
      [
        ["Avgift_Varme", "Värme", u.avgiftInkluderar.varme],
        ["Avgift_Vatten", "Vatten", u.avgiftInkluderar.vatten],
        ["Avgift_El", "Hushållsel", u.avgiftInkluderar.el],
        ["Avgift_Bredband", "Bredband", u.avgiftInkluderar.bredband],
        ["Avgift_Tv", "TV", u.avgiftInkluderar.tv],
      ] as const
    ).map(([namn, etikett, v]): IndataFalt => ({
      namn,
      etikett: `Ingår ${etikett.toLowerCase()} i avgiften?`,
      varde: AVGIFT_TEXT[v],
      enhet: "ja / nej / vet ej",
      hint:
        namn === "Avgift_Tv"
          ? "Påverkar inga belopp i kalkylen (det finns ingen TV-schablon)."
          : "Vet ej: kalkylen visar ett spann med och utan posten.",
      validering: lista,
    })),
    "Hushåll",
    {
      namn: "AntalLantagare",
      etikett: "Antal låntagare",
      varde: u.antalLantagare,
      enhet: "1 eller 2",
      hint: "Räntan delas lika mellan låntagarna. Ränteavdragets tak gäller per person.",
      validering: hel(1, 2),
    },
    {
      namn: "Inkomst_1",
      etikett: "Bruttoinkomst, låntagare 1",
      varde: u.inkomst1,
      enhet: "kr per år",
      hint: "Lön före skatt. Lämnas tomt = okänd.",
      fmt: FMT.kr,
      validering: dec(g.inkomst.min, g.inkomst.max),
    },
    {
      namn: "Inkomst_2",
      etikett: "Bruttoinkomst, låntagare 2",
      varde: u.inkomst2,
      enhet: "kr per år",
      hint: "Används bara när antal låntagare är 2.",
      fmt: FMT.kr,
      validering: dec(g.inkomst.min, g.inkomst.max),
    },
    {
      namn: "AntalPersoner",
      etikett: "Antal personer i hushållet",
      varde: u.antalPersoner,
      enhet: "personer",
      hint: "Styr schablonerna för hushållsel och hemförsäkring.",
      validering: hel(g.antalPersoner.min, g.antalPersoner.max),
    },
    {
      namn: "AntalVuxna",
      etikett: "Antal vuxna",
      varde: u.antalVuxna,
      enhet: "vuxna",
      hint: "Används för bankens levnadskostnader (KALP).",
      validering: hel(g.antalVuxna.min, g.antalVuxna.max),
    },
    ...(
      [
        ["Barn_0_3", "0–3 år", "0-3"],
        ["Barn_4_6", "4–6 år", "4-6"],
        ["Barn_7_10", "7–10 år", "7-10"],
        ["Barn_11_14", "11–14 år", "11-14"],
        ["Barn_15_17", "15–17 år", "15-17"],
      ] as const
    ).map(([namn, etikett, alder]): IndataFalt => ({
      namn,
      etikett: `Antal barn ${etikett}`,
      varde: barn(alder),
      enhet: "barn",
      hint: "Används för bankens levnadskostnader (KALP).",
      validering: hel(g.barnPerAlder.min, g.barnPerAlder.max),
    })),
    "Räntescenarier",
    {
      namn: "Rantestress",
      etikett: "Räntehöjning i huvudscenariot",
      varde: u.rantestressPp,
      enhet: "procentenheter",
      hint: "0–3. Läggs på din ränta i kolumnen ”Nu” på bladet Beräkning.",
      fmt: FMT.decimal,
      validering: dec(0, 3),
    },
    {
      namn: "Rantekanslighet",
      etikett: "Föreningens räntekänslighet",
      varde: u.rantekanslighetProcent,
      enhet: "% avgiftshöjning per procentenhet",
      hint: "Från föreningens årsredovisning. Tomt = avgiften stressas inte.",
      fmt: FMT.decimal,
      validering: dec(0, 100),
    },
    {
      namn: "Kalkylranta",
      etikett: "Bankens kalkylränta (KALP)",
      varde: u.kalkylrantaProcent,
      enhet: "% per år",
      hint: "Ett antagande. Varje bank bestämmer sin egen.",
      fmt: FMT.proc2,
      validering: dec(g.kalkylranta.min, g.kalkylranta.max),
    },
    "Egna kostnader (lämna tomt för Binfos schablon)",
    ...(
      [
        ["Egen_Hushallsel", "hushållsel", u.egnaKostnader.hushallsel],
        ["Egen_Varme", "värme", u.egnaKostnader.varme],
        ["Egen_Vatten", "vatten", u.egnaKostnader.vatten],
        ["Egen_Bredband", "bredband", u.egnaKostnader.bredband],
        ["Egen_Hemforsakring", "hemförsäkring", u.egnaKostnader.hemforsakring],
      ] as const
    ).map(([namn, etikett, v]): IndataFalt => ({
      namn,
      etikett: `Eget belopp, ${etikett}`,
      varde: v,
      enhet: "kr per månad",
      hint: "Ersätter schablonen om du fyller i det.",
      fmt: FMT.kr,
      validering: dec(0, g.manadsavgift.max),
    })),
  ];
}

function byggIndata(wb: ExcelJS.Workbook, u: KalkylUnderlag, etikett: string | undefined): void {
  const ws = wb.addWorksheet(BLAD_INDATA, {
    views: [{ state: "frozen", ySplit: 3 }],
  });
  ws.columns = [{ width: 44 }, { width: 22 }, { width: 30 }, { width: 80 }];
  ws.mergeCells("A1:D1");
  const t = ws.getCell("A1");
  t.value = "Binfo bolånekalkyl: indata";
  stil(t, { bold: true, size: 16, color: FARG_PRIMARY });
  if (etikett !== undefined && etikett !== "") {
    ws.getCell("A2").value = `Kalkyl: ${etikett}`;
  }
  const hr = ws.getRow(3);
  ["Uppgift", "Värde", "Enhet", "Så här fyller du i"].forEach((txt, i) => {
    const c = hr.getCell(i + 1);
    c.value = txt;
    stil(c, { bold: true, fill: FYLLNING_RUBRIK, border: true });
  });

  let rad = 4;
  for (const f of indataFalt(u)) {
    if (typeof f === "string") {
      const c = ws.getCell(`A${rad}`);
      c.value = f;
      stil(c, { bold: true, color: FARG_PRIMARY });
      rad += 1;
      continue;
    }
    ws.getCell(`A${rad}`).value = f.etikett;
    const v = ws.getCell(`B${rad}`);
    if (f.varde !== undefined) v.value = f.varde;
    stil(v, {
      fill: FYLLNING_INDATA,
      border: true,
      ...(f.fmt !== undefined ? { fmt: f.fmt } : {}),
    });
    v.alignment = { horizontal: "right" };
    ws.getCell(`C${rad}`).value = f.enhet;
    const h = ws.getCell(`D${rad}`);
    h.value = f.hint;
    stil(h, { color: FARG_MUTED });

    const val = f.validering;
    if (val?.typ === "lista") {
      v.dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: [val.alternativ],
        showErrorMessage: true,
        errorTitle: "Ogiltigt värde",
        error: "Välj ja, nej eller vet ej.",
      };
    } else if (val !== undefined) {
      v.dataValidation = {
        type: val.typ,
        operator: "between",
        allowBlank: true,
        formulae: [val.min, val.max],
        showErrorMessage: true,
        errorTitle: "Ogiltigt värde",
        error: `Skriv ett tal mellan ${val.min.toLocaleString("sv-SE")} och ${val.max.toLocaleString("sv-SE")}.`,
      };
    }
    wb.definedNames.add(adr(BLAD_INDATA, `$B$${rad}`), f.namn);
    rad += 1;
  }
  rad += 1;
  const not = ws.getCell(`A${rad}`);
  not.value = "Ändra bara de ljusgröna cellerna. Allt annat räknas om automatiskt.";
  stil(not, { italic: true, color: FARG_MUTED });
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  ws.pageSetup.printArea = `A1:D${rad}`;
}

// ---------------------------------------------------------------------------
// Blad: Regler och antaganden
// ---------------------------------------------------------------------------

function byggRegler(wb: ExcelJS.Workbook): void {
  const ws = wb.addWorksheet(BLAD_REGLER, { views: [{ state: "frozen", ySplit: 3 }] });
  ws.columns = [
    { width: 64 },
    { width: 14 },
    { width: 30 },
    { width: 52 },
    { width: 18 },
    { width: 14 },
    { width: 14 },
    { width: 24 },
    { width: 90 },
  ];
  ws.mergeCells("A1:I1");
  const t = ws.getCell("A1");
  t.value = `Regler och antaganden (regelversion ${REGELVERSION})`;
  stil(t, { bold: true, size: 16, color: FARG_PRIMARY });
  ws.getCell("A2").value =
    "Värdena nedan används av bladet Beräkning. Ändra ett värde här (ljusgrön cell) så räknas allt om, till exempel för att prova en annan skattesats.";
  stil(ws.getCell("A2"), { italic: true, color: FARG_MUTED });
  [
    "Regel eller antagande",
    "Värde",
    "Enhet",
    "Källa",
    "Paragraf/sida",
    "Gäller från",
    "Verifierad",
    "Status",
    "Anmärkning",
  ].forEach((txt, i) => {
    const c = ws.getRow(3).getCell(i + 1);
    c.value = txt;
    stil(c, { bold: true, fill: FYLLNING_RUBRIK, border: true });
  });

  let rad = 4;
  let senasteGrupp = "";
  const intervall = new Map<string, { forst: number; sist: number }>();

  for (const regel of REGLER) {
    if (regel.grupp !== senasteGrupp) {
      senasteGrupp = regel.grupp;
      const g = ws.getCell(`A${rad}`);
      g.value = regel.grupp;
      stil(g, { bold: true, color: FARG_PRIMARY });
      rad += 1;
    }
    skrivRegel(ws, regel, rad);

    if (typeof regel.varde === "number") {
      const namn = REGELNAMN[regel.id];
      if (namn !== undefined) {
        wb.definedNames.add(adr(BLAD_REGLER, `$B$${rad}`), namn);
      }
      for (const [prefix, intervallNamn] of Object.entries(KV_INTERVALL)) {
        if (regel.id.startsWith(prefix)) {
          const cur = intervall.get(intervallNamn);
          intervall.set(intervallNamn, { forst: cur?.forst ?? rad, sist: rad });
        }
      }
    }
    rad += 1;
  }
  for (const [namn, { forst, sist }] of intervall) {
    wb.definedNames.add(adr(BLAD_REGLER, `$B$${forst}:$B$${sist}`), namn);
  }
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  ws.pageSetup.printArea = `A1:I${rad}`;
}

function skrivRegel(ws: ExcelJS.Worksheet, regel: Regel, rad: number): void {
  const namn = ws.getCell(`A${rad}`);
  namn.value = regel.namn;
  stil(namn, { wrap: true });
  const v = ws.getCell(`B${rad}`);
  v.value = regel.varde;
  const arTal = typeof regel.varde === "number";
  stil(v, {
    border: true,
    wrap: !arTal,
    ...(arTal ? { fill: FYLLNING_INDATA, fmt: FMT.decimal } : {}),
  });
  if (arTal) v.alignment = { horizontal: "right", vertical: "top" };
  ws.getCell(`C${rad}`).value = regel.enhet;
  const k = ws.getCell(`D${rad}`);
  if (regel.kalla.url !== null) {
    k.value = { text: regel.kalla.titel, hyperlink: regel.kalla.url };
    stil(k, { color: "FF0563C1", wrap: true });
  } else {
    k.value = regel.kalla.titel;
    stil(k, { wrap: true });
  }
  ws.getCell(`E${rad}`).value = regel.referens ?? "";
  ws.getCell(`F${rad}`).value = regel.gallerFran;
  ws.getCell(`G${rad}`).value = regel.verifierad ?? "ej verifierad";
  ws.getCell(`H${rad}`).value = STATUS_ETIKETT[regel.status];
  const a = ws.getCell(`I${rad}`);
  a.value = regel.anmarkning ?? "";
  stil(a, { wrap: true, color: FARG_MUTED });
}

// ---------------------------------------------------------------------------
// Blad: Beräkning
// ---------------------------------------------------------------------------

type Fmt = (typeof FMT)[keyof typeof FMT] | "text";

interface RadSpec {
  key?: string;
  etikett: string;
  /** En mall för alla kolumner, eller en mall per kolumn (null = tom). */
  f?: string | Array<string | null>;
  fmt?: Fmt;
  hint?: string;
  stark?: boolean;
  resultat?: boolean;
}

interface Sektion {
  rubrik: string;
  kolumner: string[];
  kolumnRubriker?: string[];
  rader: RadSpec[];
}

/**
 * Mallar: `{nyckel}` = samma kolumn på raden `nyckel`, `{nyckel@C}` = fast
 * kolumn C (absolut adress). Namngivna celler skrivs som de är.
 */
function sektioner(): Sektion[] {
  const alderIdx = {
    vuxen: kvIndex("25-50"),
    b46: kvIndex("4-6"),
    b710: kvIndex("7-10"),
    b1114: kvIndex("11-14"),
    b1517: kvIndex("15-17"),
  };
  const kategori = (intervall: string) =>
    `AntalVuxna*INDEX(${intervall},${alderIdx.vuxen})+Barn_0_3*INDEX(${intervall},{kv03kol@B})` +
    `+Barn_4_6*INDEX(${intervall},${alderIdx.b46})+Barn_7_10*INDEX(${intervall},${alderIdx.b710})` +
    `+Barn_11_14*INDEX(${intervall},${alderIdx.b1114})+Barn_15_17*INDEX(${intervall},${alderIdx.b1517})`;
  const kolSumma = (i: number) =>
    ["KV_Mat", ...OVRIGA_INTERVALL].map((n) => `INDEX(${n},${i})`).join("+");
  const kv0 = kvIndex("0");
  const kv13 = kvIndex("1-3");

  const andel = (namn: string) => `ROUND(${namn}/100,10)`;
  const status = (namn: string) => `IF(${namn}="ja","ja",IF(${namn}="nej","nej","vet ej"))`;

  const scenKol = ["B", "C", "D", "E", "F", "G"];
  const scenRubriker = [
    "Nu (med din räntehöjning)",
    "Din ränta",
    "+1 p.e.",
    "+2 p.e.",
    "+3 p.e.",
    "Bankens kalkylränta",
  ];

  const drift = (
    id: string,
    etikett: string,
    schablon: string,
    namn: string | null,
    kraverBoarea: boolean,
  ): RadSpec[] => [
    {
      key: `d_${id}`,
      etikett,
      f: [
        schablon,
        namn === null ? '"alltid med"' : status(namn),
        `IF(ISNUMBER(Egen_${id}),Egen_${id},"")`,
        kraverBoarea
          ? `IF(ISNUMBER(Egen_${id}),Egen_${id},IF(ISNUMBER(Boarea),{d_${id}@B},0))`
          : `IF(ISNUMBER(Egen_${id}),Egen_${id},{d_${id}@B})`,
        namn === null
          ? `IF(ISNUMBER(Egen_${id}),Egen_${id}-{d_${id}@B},0)`
          : `IF(AND(ISNUMBER(Egen_${id}),{d_${id}@C}="nej"),Egen_${id}-{d_${id}@B},0)`,
        namn === null
          ? `IF(ISNUMBER(Egen_${id}),Egen_${id}-{d_${id}@B},0)`
          : `IF(AND(ISNUMBER(Egen_${id}),{d_${id}@C}<>"ja"),Egen_${id}-{d_${id}@B},0)`,
      ],
      fmt: FMT.kr,
    },
  ];

  return [
    {
      rubrik: "Resultat i korthet",
      kolumner: ["B"],
      rader: [
        {
          etikett: "Total månadskostnad efter ränteavdrag, lägsta",
          f: "{nettoLag@B}",
          fmt: FMT.kr,
          stark: true,
          resultat: true,
          hint: "Osäkra poster (vet ej) antas ingå i avgiften.",
        },
        {
          etikett: "Total månadskostnad efter ränteavdrag, högsta",
          f: "{nettoHog@B}",
          fmt: FMT.kr,
          stark: true,
          resultat: true,
          hint: "Osäkra poster (vet ej) antas inte ingå i avgiften.",
        },
        { etikett: "Belåningsgrad", f: "{belaningsgrad@B}", fmt: FMT.proc1, resultat: true },
        { etikett: "Amortering per år", f: "{takt@B}", fmt: FMT.proc1, resultat: true },
        {
          etikett: "Kvar att leva på enligt bankens kalkyl (KALP)",
          f: '=IF({kalpBeraknad@B}=1,{kalpKvar@B},"går inte att räkna")'.slice(1),
          fmt: FMT.kr,
          stark: true,
          resultat: true,
        },
      ],
    },
    {
      rubrik: "1. Lån och belåningsgrad",
      kolumner: ["B"],
      rader: [
        {
          key: "bostadsvarde",
          etikett: "Bostadens värde (lånebelopp + kontantinsats)",
          f: "N(Lanebelopp)+N(Kontantinsats)".replace(/N\((\w+)\)/g, "IF(ISNUMBER($1),$1,0)"),
          fmt: FMT.kr,
        },
        {
          key: "belaningsgrad",
          etikett: "Belåningsgrad",
          f: "IF({bostadsvarde}>0,Lanebelopp/{bostadsvarde}*100,0)",
          fmt: FMT.proc2,
          hint: "Lånebelopp ÷ bostadens värde.",
        },
        {
          key: "takt",
          etikett: "Amorteringstakt",
          f: "IF({belaningsgrad}>Amort_Grans_2,Amort_Takt_2,IF({belaningsgrad}>Amort_Grans_1,Amort_Takt_1,Amort_Takt_0))",
          fmt: FMT.proc1,
          hint: "”Överstiger”: exakt 50 % ger ingen amortering, exakt 70 % ger 1 % (Lag 2026:226 7 §).",
        },
        {
          key: "minKontant",
          etikett: "Lägsta tillåtna kontantinsats (bolånetaket)",
          f: "{bostadsvarde}*ROUND(1-ROUND(Bolanetak/100,10),6)",
          fmt: FMT.kr,
        },
        {
          key: "kontantFel",
          etikett: "Kontantinsatsen är för liten (1 = ja)",
          f: "IF(AND({bostadsvarde}>0,ISNUMBER(Kontantinsats),Kontantinsats<{minKontant}-0.5),1,0)",
          fmt: FMT.tal,
          hint: "Räknas om om du ändrar bolånetaket på bladet Regler och antaganden.",
        },
        {
          key: "inkomstIfylld",
          etikett: "Inkomst är ifylld (1 = ja)",
          f: "IF(AND(ISNUMBER(Inkomst_1),OR(AntalLantagare=1,ISNUMBER(Inkomst_2))),1,0)",
          fmt: FMT.tal,
        },
        {
          key: "bruttoSumma",
          etikett: "Bruttoinkomst, hushållet",
          f: "{brutto@B}+{brutto@C}",
          fmt: FMT.kr,
        },
        {
          key: "skuldkvot",
          etikett: "Skuldkvot (lån ÷ bruttoårsinkomst)",
          f: "IF({bruttoSumma}>0,Lanebelopp/{bruttoSumma},0)",
          fmt: FMT.andel,
          hint: "Bara information; styr inte amorteringen. Bankernas typiska tak är ett antagande.",
        },
      ],
    },
    {
      rubrik: "2. Inkomstskatt per låntagare (inkomstår 2026)",
      kolumner: ["B", "C"],
      kolumnRubriker: ["Låntagare 1", "Låntagare 2"],
      rader: [
        {
          key: "aktiv",
          etikett: "Med i kalkylen (1 = ja)",
          f: ["1", "IF(AntalLantagare=2,1,0)"],
          fmt: FMT.tal,
        },
        {
          key: "brutto",
          etikett: "Bruttoinkomst per år",
          f: [
            "IF(ISNUMBER(Inkomst_1),Inkomst_1,0)",
            "IF(AND(AntalLantagare=2,ISNUMBER(Inkomst_2)),Inkomst_2,0)",
          ],
          fmt: FMT.kr,
        },
        {
          key: "ffi",
          etikett: "Fastställd förvärvsinkomst",
          f: "INT(MAX(0,{brutto})/100)*100",
          fmt: FMT.kr,
          hint: "Nedåt till helt hundratal.",
        },
        {
          key: "ga",
          etikett: "Grundavdrag",
          f:
            "MIN(ROUNDUP(IF({ffi}<=GA_Grans_1*PBB,GA_Bas*PBB,IF({ffi}<=GA_Grans_2*PBB,GA_Bas*PBB+" +
            `${andel("GA_Okning")}*({ffi}-GA_Grans_1*PBB),IF({ffi}<=GA_Grans_3*PBB,GA_Topp*PBB,` +
            `IF({ffi}<=GA_Grans_4*PBB,GA_Topp*PBB-${andel("GA_Minskning")}*({ffi}-GA_Grans_3*PBB),GA_Lagsta*PBB))))/100,0)*100,{ffi})`,
          fmt: FMT.kr,
          hint: "63 kap. 3 § IL, uppåt till helt hundratal, aldrig över inkomsten.",
        },
        {
          key: "bfi",
          etikett: "Beskattningsbar förvärvsinkomst",
          f: "MAX(0,{ffi}-{ga})",
          fmt: FMT.kr,
        },
        {
          key: "kommunal",
          etikett: "Kommunal inkomstskatt",
          f: `INT({bfi}*${andel("Kommunalskatt")})`,
          fmt: FMT.kr,
        },
        {
          key: "statlig",
          etikett: "Statlig inkomstskatt",
          f: `INT(MAX(0,{bfi}-Skiktgrans)*${andel("Statlig_Skatt")})`,
          fmt: FMT.kr,
        },
        {
          key: "begravning",
          etikett: "Begravningsavgift",
          f: `INT({bfi}*${andel("Begravningsavgift")})`,
          fmt: FMT.kr,
        },
        {
          key: "publicservice",
          etikett: "Public service-avgift",
          f: `MIN(INT({bfi}*${andel("PublicService_Sats")}),PublicService_Tak)`,
          fmt: FMT.kr,
        },
        {
          key: "pension",
          etikett: "Allmän pensionsavgift",
          f: `IF({ffi}<Pension_Nedre_Grans,0,ROUNDUP(${andel("Pension_Sats")}*MIN({ffi},Pension_Tak_Inkomst)/100-0.5,0)*100)`,
          fmt: FMT.kr,
          hint: "Närmaste hundratal, exakt 50 avrundas nedåt.",
        },
        {
          key: "redPensionK",
          etikett: "Reduktion för pensionsavgift, mot kommunal skatt",
          f: "MIN({pension},{kommunal})",
          fmt: FMT.kr,
        },
        {
          key: "redPensionS",
          etikett: "Reduktion för pensionsavgift, mot statlig skatt",
          f: "MIN({pension}-{redPensionK},{statlig})",
          fmt: FMT.kr,
        },
        {
          key: "jsaRaw",
          etikett: "Jobbskatteavdrag före begränsning",
          f:
            "MAX(0,IF({ffi}<=JSA_Grans_1*PBB,{ffi}-{ga},IF({ffi}<=JSA_Grans_2*PBB," +
            `JSA_Grans_1*PBB+${andel("JSA_Sats_2")}*({ffi}-JSA_Grans_1*PBB)-{ga},` +
            `IF({ffi}<=JSA_Grans_3*PBB,JSA_Bas_3*PBB+${andel("JSA_Sats_3")}*({ffi}-JSA_Grans_2*PBB)-{ga},` +
            `JSA_Tak*PBB-{ga})))*${andel("Kommunalskatt")})`,
          fmt: FMT.kr,
        },
        {
          key: "jsa",
          etikett: "Jobbskatteavdrag",
          f: "MIN({jsaRaw},{kommunal}-{redPensionK})",
          fmt: FMT.kr,
          hint: "Räknas bara av mot kvarvarande kommunal skatt.",
        },
        {
          key: "sfRaw",
          etikett: "Skattereduktion för förvärvsinkomster före begränsning",
          f:
            "IF({bfi}<=SF_Nedre,0,IF({bfi}<=SF_Ovre," +
            `${andel("SF_Sats")}*({bfi}-SF_Nedre),SF_Max))`,
          fmt: FMT.kr,
        },
        {
          key: "sf",
          etikett: "Skattereduktion för förvärvsinkomster",
          f: "MIN({sfRaw},{kommunal}-{redPensionK}-{jsa})",
          fmt: FMT.kr,
        },
        {
          key: "utrymme",
          etikett: "Skatt kvar att räkna ränteavdrag mot",
          f: "INT({kommunal}-{redPensionK}-{jsa}-{sf}+{statlig}-{redPensionS})",
          fmt: FMT.kr,
          hint: "Ränteavdraget kan aldrig bli större än skatten.",
        },
        {
          key: "slutligSkatt",
          etikett: "Skatt och avgifter före ränteavdrag",
          f: "{kommunal}+{statlig}+{begravning}+{publicservice}+{pension}-{redPensionK}-{redPensionS}-{jsa}-{sf}",
          fmt: FMT.kr,
        },
        {
          key: "nettoAr",
          etikett: "Nettoinkomst per år före ränteavdrag",
          f: "{brutto}-{slutligSkatt}",
          fmt: FMT.kr,
        },
        {
          key: "nettoManad",
          etikett: "Nettoinkomst per månad (hushållet)",
          f: ["({nettoAr@B}+{nettoAr@C})/12", null],
          fmt: FMT.kr,
          stark: true,
          hint: "Före ränteavdrag; ränteavdraget ligger i månadskostnaden nedan.",
        },
      ],
    },
    {
      rubrik: "3. Drift: schabloner och egna belopp",
      kolumner: ["B", "C", "D", "E", "F", "G"],
      kolumnRubriker: [
        "Schablon",
        "Ingår i avgiften?",
        "Eget belopp",
        "Belopp som räknas",
        "Ändring, lägsta",
        "Ändring, högsta",
      ],
      rader: [
        ...drift(
          "Hushallsel",
          "Hushållsel",
          "INDEX(KV_G_Hushallsel,MIN(7,MAX(1,INT(AntalPersoner))))",
          "Avgift_El",
          false,
        ),
        ...drift(
          "Varme",
          "Värme",
          "ROUND(Schablon_Varme_Per_M2*IF(ISNUMBER(Boarea),Boarea,0),0)",
          "Avgift_Varme",
          true,
        ),
        ...drift(
          "Vatten",
          "Vatten",
          "ROUND(Schablon_Vatten_Per_M2*IF(ISNUMBER(Boarea),Boarea,0),0)",
          "Avgift_Vatten",
          true,
        ),
        ...drift("Bredband", "Bredband", "ROUND(Schablon_Bredband,0)", "Avgift_Bredband", false),
        ...drift(
          "Hemforsakring",
          "Hemförsäkring inkl. bostadsrättstillägg",
          "INDEX(KV_G_Hemforsakring,MIN(7,MAX(1,INT(AntalPersoner))))",
          null,
          false,
        ),
        {
          key: "driftSumma",
          etikett: "Drift som inte ingår i avgiften (kr per månad)",
          f: [
            'IF({d_Hushallsel@C}="ja",0,{d_Hushallsel@E})+IF({d_Varme@C}="ja",0,{d_Varme@E})+IF({d_Vatten@C}="ja",0,{d_Vatten@E})+IF({d_Bredband@C}="ja",0,{d_Bredband@E})+{d_Hemforsakring@E}',
          ],
          fmt: FMT.kr,
          stark: true,
        },
        {
          key: "baseLow",
          etikett: "Drift i lägsta fallet (osäkra poster ingår i avgiften), schablon",
          f: [
            'IF({d_Hushallsel@C}="nej",{d_Hushallsel@B},0)+IF({d_Varme@C}="nej",{d_Varme@B},0)+IF({d_Vatten@C}="nej",{d_Vatten@B},0)+IF({d_Bredband@C}="nej",{d_Bredband@B},0)+{d_Hemforsakring@B}',
          ],
          fmt: FMT.kr,
        },
        {
          key: "baseHigh",
          etikett: "Drift i högsta fallet (osäkra poster ingår inte), schablon",
          f: [
            'IF({d_Hushallsel@C}="ja",0,{d_Hushallsel@B})+IF({d_Varme@C}="ja",0,{d_Varme@B})+IF({d_Vatten@C}="ja",0,{d_Vatten@B})+IF({d_Bredband@C}="ja",0,{d_Bredband@B})+{d_Hemforsakring@B}',
          ],
          fmt: FMT.kr,
        },
        {
          key: "deltaLow",
          etikett: "Egna belopp: ändring mot schablon, lägsta",
          f: ["{d_Hushallsel@F}+{d_Varme@F}+{d_Vatten@F}+{d_Bredband@F}+{d_Hemforsakring@F}"],
          fmt: FMT.kr,
        },
        {
          key: "deltaHigh",
          etikett: "Egna belopp: ändring mot schablon, högsta",
          f: ["{d_Hushallsel@G}+{d_Varme@G}+{d_Vatten@G}+{d_Bredband@G}+{d_Hemforsakring@G}"],
          fmt: FMT.kr,
        },
      ],
    },
    {
      rubrik: "4. Månadskostnad och räntescenarier",
      kolumner: scenKol,
      kolumnRubriker: scenRubriker,
      rader: [
        {
          key: "pp",
          etikett: "Räntehöjning (procentenheter)",
          f: [
            "IF(ISNUMBER(Rantestress),Rantestress,0)",
            "0",
            "1",
            "2",
            "3",
            "MAX(0,Kalkylranta-IF(ISNUMBER(Ranta),Ranta,0))",
          ],
          fmt: FMT.decimal,
        },
        {
          key: "rate",
          etikett: "Ränta",
          f: [
            "IF(ISNUMBER(Ranta),Ranta,0)+{pp}",
            "IF(ISNUMBER(Ranta),Ranta,0)+{pp}",
            "IF(ISNUMBER(Ranta),Ranta,0)+{pp}",
            "IF(ISNUMBER(Ranta),Ranta,0)+{pp}",
            "IF(ISNUMBER(Ranta),Ranta,0)+{pp}",
            "Kalkylranta",
          ],
          fmt: FMT.proc2,
        },
        {
          key: "avgiftStress",
          etikett: "Månadsavgift efter räntekänslighet",
          f: "IF(ISNUMBER(Rantekanslighet),ROUND(IF(ISNUMBER(Manadsavgift),Manadsavgift,0)*(1+Rantekanslighet*{pp}/100),0),IF(ISNUMBER(Manadsavgift),Manadsavgift,0))",
          fmt: FMT.kr,
          hint: "Utan räntekänslighet stressas inte avgiften.",
        },
        {
          key: "avgiftPost",
          etikett: "Månadsavgift",
          f: "ROUND({avgiftStress},0)",
          fmt: FMT.kr,
        },
        {
          key: "arlig",
          etikett: "Räntekostnad per år",
          f: "IF(ISNUMBER(Lanebelopp),Lanebelopp,0)*({rate}/100)",
          fmt: FMT.kr,
        },
        {
          key: "rantekost",
          etikett: "Räntekostnad per månad (före ränteavdrag)",
          f: "ROUND({arlig}/12,0)",
          fmt: FMT.kr,
        },
        {
          key: "amortRaw",
          etikett: "Amortering per månad, oavrundad",
          f: "IF(ISNUMBER(Lanebelopp),Lanebelopp,0)*({takt@B}/100)/12",
          fmt: FMT.decimal,
        },
        {
          key: "amort",
          etikett: "Amortering per månad",
          f: "ROUND({amortRaw},0)",
          fmt: FMT.kr,
        },
        {
          key: "beraknat1",
          etikett: "Ränteavdrag, låntagare 1, före skattebegränsning",
          f:
            "ROUND((MIN(MAX(0,{arlig})/MAX(1,AntalLantagare),Ranteavdrag_Tak_Per_Person)*" +
            `${andel("Ranteavdrag_Sats_Lag")}+MAX(0,MAX(0,{arlig})/MAX(1,AntalLantagare)-Ranteavdrag_Tak_Per_Person)*${andel("Ranteavdrag_Sats_Hog")})*{aktiv@B},0)`,
          fmt: FMT.kr,
          hint: "Räntan delas lika mellan låntagarna. 30 % upp till taket, 21 % över.",
        },
        {
          key: "beraknat2",
          etikett: "Ränteavdrag, låntagare 2, före skattebegränsning",
          f:
            "ROUND((MIN(MAX(0,{arlig})/MAX(1,AntalLantagare),Ranteavdrag_Tak_Per_Person)*" +
            `${andel("Ranteavdrag_Sats_Lag")}+MAX(0,MAX(0,{arlig})/MAX(1,AntalLantagare)-Ranteavdrag_Tak_Per_Person)*${andel("Ranteavdrag_Sats_Hog")})*{aktiv@C},0)`,
          fmt: FMT.kr,
        },
        {
          key: "faktiskt1",
          etikett: "Ränteavdrag, låntagare 1, begränsat av skatten",
          f: "MIN({beraknat1},{utrymme@B})",
          fmt: FMT.kr,
        },
        {
          key: "faktiskt2",
          etikett: "Ränteavdrag, låntagare 2, begränsat av skatten",
          f: "MIN({beraknat2},{utrymme@C})",
          fmt: FMT.kr,
        },
        {
          key: "flatAvdrag",
          etikett: "Ränteavdrag per år med full sats (används när inkomst saknas)",
          f:
            "MIN({arlig},Ranteavdrag_Tak_Per_Person*MAX(1,AntalLantagare))*" +
            `${andel("Ranteavdrag_Sats_Lag")}+MAX(0,{arlig}-Ranteavdrag_Tak_Per_Person*MAX(1,AntalLantagare))*${andel("Ranteavdrag_Sats_Hog")}`,
          fmt: FMT.decimal,
          hint: "Förutsätter att ni betalar tillräckligt med skatt.",
        },
        {
          key: "avdragAr",
          etikett: "Ränteavdrag per år",
          f: "IF({inkomstIfylld@B}=1,{faktiskt1}+{faktiskt2},{flatAvdrag})",
          fmt: FMT.kr,
        },
        {
          key: "forlorat",
          etikett: "Ränteavdrag som skatten inte räcker till per år",
          f: "IF({inkomstIfylld@B}=1,{beraknat1}-{faktiskt1}+{beraknat2}-{faktiskt2},0)",
          fmt: FMT.kr,
        },
        {
          key: "avdrag",
          etikett: "Ränteavdrag per månad",
          f: "ROUND({avdragAr}/12,0)",
          fmt: FMT.kr,
        },
        {
          key: "fasta",
          etikett: "Ränta + amortering + avgift, oavrundat",
          f: "{arlig}/12+{amortRaw}+{avgiftStress}",
          fmt: FMT.decimal,
        },
        {
          key: "bruttoLagBas",
          etikett: "Total före ränteavdrag, lägsta (schablon)",
          f: "ROUND({fasta}+{baseLow@B},0)",
          fmt: FMT.kr,
        },
        {
          key: "bruttoHogBas",
          etikett: "Total före ränteavdrag, högsta (schablon)",
          f: "ROUND({fasta}+{baseHigh@B},0)",
          fmt: FMT.kr,
        },
        {
          key: "bruttoLag",
          etikett: "Total före ränteavdrag, lägsta",
          f: "{bruttoLagBas}+{deltaLow@B}",
          fmt: FMT.kr,
        },
        {
          key: "bruttoHog",
          etikett: "Total före ränteavdrag, högsta",
          f: "{bruttoLag}+({bruttoHogBas}-{bruttoLagBas})+({deltaHigh@B}-{deltaLow@B})",
          fmt: FMT.kr,
        },
        {
          key: "nettoLag",
          etikett: "Total månadskostnad efter ränteavdrag, lägsta",
          f: "{bruttoLag}-{avdrag}",
          fmt: FMT.kr,
          stark: true,
          resultat: true,
        },
        {
          key: "nettoHog",
          etikett: "Total månadskostnad efter ränteavdrag, högsta",
          f: "{bruttoHog}-{avdrag}",
          fmt: FMT.kr,
          stark: true,
          resultat: true,
        },
        {
          key: "harSpann",
          etikett: "Totalen är ett spann (1 = ja)",
          f: "IF({nettoHog}>{nettoLag},1,0)",
          fmt: FMT.tal,
        },
        {
          key: "betalar",
          etikett: "Du betalar per månad (ränta före avdrag + amortering + avgift + drift)",
          f: "{rantekost}+{amort}+{avgiftPost}+{driftSumma@B}",
          fmt: FMT.kr,
        },
        {
          key: "kvarEfterBoende",
          etikett: "Kvar efter boendet (nettoinkomst − det du betalar)",
          f: "{nettoManad@B}-{betalar}",
          fmt: FMT.kr,
        },
        {
          key: "andelNetto",
          etikett: "Boendet som andel av nettoinkomsten",
          f: "IF({nettoManad@B}>0,{betalar}/{nettoManad@B}*100,0)",
          fmt: FMT.proc1,
        },
      ],
    },
    {
      rubrik: "5. Bankens kalkyl (KALP)",
      kolumner: ["B"],
      rader: [
        {
          key: "kalpSaknas",
          etikett: "Saknas",
          f: '=IF(ISNUMBER(Lanebelopp),"","lånebelopp, ")&IF(ISNUMBER(Kontantinsats),"","kontantinsats, ")&IF(ISNUMBER(Manadsavgift),"","månadsavgift, ")&IF({inkomstIfylld@B}=1,"","bruttoinkomst, ")&IF(ISNUMBER(Boarea),"","boarea, ")'.slice(
            1,
          ),
          fmt: "text",
        },
        {
          key: "kalpPersoner",
          etikett: "Personer i hushållet (vuxna + barn)",
          f: "N(AntalVuxna)+N(Barn_0_3)+N(Barn_4_6)+N(Barn_7_10)+N(Barn_11_14)+N(Barn_15_17)".replace(
            /N\((\w+)\)/g,
            "IF(ISNUMBER($1),$1,0)",
          ),
          fmt: FMT.tal,
        },
        {
          key: "kalpBeraknad",
          etikett: "Kan räknas (1 = ja)",
          f: `IF(AND({kalpSaknas@B}="",{kalpPersoner@B}>=1,{kalpPersoner@B}<=${KONSUMENTVERKET_2026.maxPersoner},IF(ISNUMBER(AntalVuxna),AntalVuxna,0)>=1),1,0)`,
          fmt: FMT.tal,
          hint: `Konsumentverkets tabell gäller hushåll upp till ${KONSUMENTVERKET_2026.maxPersoner} personer.`,
        },
        {
          key: "kv03kol",
          etikett: "Barn 0–3 år: Konsumentverkets kolumn (1 = 0 år, 2 = 1–3 år)",
          f: `IF(${kolSumma(kv0)}>=${kolSumma(kv13)},1,2)`,
          fmt: FMT.tal,
          hint: "Den dyrare kolumnen väljs så att kalkylen inte underskattar.",
        },
        {
          key: "kalpRanta",
          etikett: "Ränta vid kalkylräntan",
          f: "ROUND(IF(ISNUMBER(Lanebelopp),Lanebelopp,0)*(Kalkylranta/100)/12,0)",
          fmt: FMT.kr,
        },
        {
          key: "kalpAmort",
          etikett: "Amortering",
          f: "ROUND(IF(ISNUMBER(Lanebelopp),Lanebelopp,0)*({takt@B}/100)/12,0)",
          fmt: FMT.kr,
        },
        {
          key: "kalpAvgift",
          etikett: "Månadsavgift",
          f: "ROUND(IF(ISNUMBER(Manadsavgift),Manadsavgift,0),0)",
          fmt: FMT.kr,
        },
        {
          key: "kalpVarme",
          etikett: "Värme (om den inte ingår i avgiften)",
          f: `IF(${status("Avgift_Varme")}<>"ja",IF(ISNUMBER(Egen_Varme),Egen_Varme,{d_Varme@B}),0)`,
          fmt: FMT.kr,
          hint: "Av Binfos driftschabloner räknas bara värme med; Konsumentverkets kostnader omfattar redan el, vatten, internet och försäkring.",
        },
        {
          key: "kalpBoende",
          etikett: "Boende enligt bankens kalkyl",
          f: "{kalpRanta}+{kalpAmort}+{kalpAvgift}+{kalpVarme}",
          fmt: FMT.kr,
          stark: true,
        },
        {
          key: "lv_mat",
          etikett: "Levnadskostnad: mat (all mat lagas hemma)",
          f: kategori("KV_Mat"),
          fmt: FMT.kr,
        },
        {
          key: "lv_klader",
          etikett: "Levnadskostnad: kläder och skor",
          f: kategori("KV_Klader_Skor"),
          fmt: FMT.kr,
        },
        {
          key: "lv_fritid",
          etikett: "Levnadskostnad: fritid och lek",
          f: kategori("KV_Fritid_Lek"),
          fmt: FMT.kr,
        },
        {
          key: "lv_mobil",
          etikett: "Levnadskostnad: mobiltelefon",
          f: kategori("KV_Mobiltelefon"),
          fmt: FMT.kr,
        },
        {
          key: "lv_hygien",
          etikett: "Levnadskostnad: personlig hygien",
          f: kategori("KV_Personlig_Hygien"),
          fmt: FMT.kr,
        },
        {
          key: "lv_barnfors",
          etikett: "Levnadskostnad: barn- och ungdomsförsäkring",
          f: kategori("KV_Barnforsakring"),
          fmt: FMT.kr,
        },
        {
          key: "lv_barnutr",
          etikett: "Levnadskostnad: övrig barnutrustning",
          f: kategori("KV_Barnutrustning"),
          fmt: FMT.kr,
        },
        ...(
          [
            ["lv_g_forbr", "förbrukningsvaror", "KV_G_Forbrukningsvaror", null],
            ["lv_g_hemutr", "hemutrustning", "KV_G_Hemutrustning", null],
            ["lv_g_internet", "internet- och mobilabonnemang", "KV_G_Internet", null],
            ["lv_g_medier", "övriga medietjänster", "KV_G_Medier", null],
            ["lv_g_el", "hushållsel (0 om den ingår i avgiften)", "KV_G_Hushallsel", "Avgift_El"],
            [
              "lv_g_vatten",
              "vatten och avlopp (0 om det ingår i avgiften)",
              "KV_G_Vatten",
              "Avgift_Vatten",
            ],
            ["lv_g_hemfors", "hemförsäkring", "KV_G_Hemforsakring", null],
          ] as const
        ).map(([key, namn, intervall, avgift]): RadSpec => ({
          key,
          etikett: `Levnadskostnad: ${namn}`,
          f:
            avgift === null
              ? `IF({kalpPersoner@B}<1,0,IF({kalpPersoner@B}>${KONSUMENTVERKET_2026.maxPersoner},0,INDEX(${intervall},{kalpPersoner@B})))`
              : `IF(OR({kalpPersoner@B}<1,{kalpPersoner@B}>${KONSUMENTVERKET_2026.maxPersoner}),0,IF(${avgift}="ja",0,INDEX(${intervall},{kalpPersoner@B})))`,
          fmt: FMT.kr,
        })),
        {
          key: "lv_avdrag",
          etikett: "Avdrag internet/mobil, hushåll med barn under 8 år",
          f: "IF(N(Barn_0_3)+N(Barn_4_6)>0,-KV_Barn_Under_8_Avdrag,0)".replace(
            /N\((\w+)\)/g,
            "IF(ISNUMBER($1),$1,0)",
          ),
          fmt: FMT.kr,
        },
        {
          key: "lvSumma",
          etikett: "Levnadskostnader enligt Konsumentverket",
          f: "{lv_mat}+{lv_klader}+{lv_fritid}+{lv_mobil}+{lv_hygien}+{lv_barnfors}+{lv_barnutr}+{lv_g_forbr}+{lv_g_hemutr}+{lv_g_internet}+{lv_g_medier}+{lv_g_el}+{lv_g_vatten}+{lv_g_hemfors}+{lv_avdrag}",
          fmt: FMT.kr,
          stark: true,
        },
        {
          key: "kalpSumma",
          etikett: "Bankens kalkylerade kostnader",
          f: "{kalpBoende}+{lvSumma}",
          fmt: FMT.kr,
          stark: true,
        },
        {
          key: "kalpNetto",
          etikett: "Nettoinkomst per månad",
          f: "{nettoManad@B}",
          fmt: FMT.kr,
        },
        {
          key: "kalpKvar",
          etikett: "Kvar att leva på (plus eller minus)",
          f: "ROUND({kalpNetto}-{kalpSumma},0)",
          fmt: FMT.kr,
          stark: true,
          resultat: true,
          hint: "Visas bara när allt som krävs är ifyllt (se ”Kan räknas”).",
        },
        {
          key: "kalpUtfall",
          etikett: "Utfall",
          f: '=IF({kalpBeraknad@B}<>1,"går inte att räkna",IF({kalpKvar@B}>=0,"Plus","Minus"))'.slice(
            1,
          ),
          fmt: "text",
        },
      ],
    },
  ];
}

export interface KalkylArbetsbok {
  workbook: ExcelJS.Workbook;
  /** Nyckel -> adress (blad + cell, t.ex. "'Beräkning'!B40") för varje beräkningsrad. */
  adresser: Record<string, (kolumn?: string) => string>;
}

function expandera(mall: string, kol: string, rader: Map<string, number>): string {
  return mall.replace(/\{(\w+)(?:@([A-Z]+))?\}/g, (_m, key: string, fast: string | undefined) => {
    const rad = rader.get(key);
    if (rad === undefined) throw new Error(`Okänd formelnyckel: ${key}`);
    return fast !== undefined ? `$${fast}$${rad}` : `${kol}${rad}`;
  });
}

function byggBerakning(wb: ExcelJS.Workbook): Map<string, number> {
  const ws = wb.addWorksheet(BLAD_BERAKNING, { views: [{ state: "frozen", ySplit: 3 }] });
  ws.columns = [
    { width: 62 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 20 },
    { width: 90 },
  ];
  ws.mergeCells("A1:H1");
  stil(ws.getCell("A1"), { bold: true, size: 16, color: FARG_PRIMARY });
  ws.getCell("A1").value = "Binfo bolånekalkyl: beräkning";
  ws.getCell("A2").value =
    "Allt på det här bladet är formler. Ändra värden på bladet Indata (och vid behov Regler och antaganden).";
  stil(ws.getCell("A2"), { italic: true, color: FARG_MUTED });
  ["Beräkning", "", "", "", "", "", "", "Förklaring"].forEach((txt, i) => {
    const c = ws.getRow(3).getCell(i + 1);
    c.value = txt;
    stil(c, { bold: true, fill: FYLLNING_RUBRIK, border: true });
  });

  const sek = sektioner();
  // Första passet: radnummer.
  const rader = new Map<string, number>();
  let rad = 4;
  for (const s of sek) {
    rad += 1; // rubrikrad
    if (s.kolumnRubriker) rad += 1;
    for (const r of s.rader) {
      if (r.key !== undefined) rader.set(r.key, rad);
      rad += 1;
    }
    rad += 1; // tom rad
  }
  const sistaRad = rad;

  // Andra passet: skriv.
  rad = 4;
  for (const s of sek) {
    const sr = ws.getCell(`A${rad}`);
    sr.value = s.rubrik;
    stil(sr, { bold: true, size: 12, color: FARG_PRIMARY });
    rad += 1;
    if (s.kolumnRubriker) {
      s.kolumnRubriker.forEach((txt, i) => {
        const c = ws.getCell(`${s.kolumner[i]}${rad}`);
        c.value = txt;
        stil(c, { bold: true, fill: FYLLNING_RUBRIK });
        c.alignment = { wrapText: true, horizontal: "right" };
      });
      rad += 1;
    }
    for (const r of s.rader) {
      const a = ws.getCell(`A${rad}`);
      a.value = r.etikett;
      if (r.stark) stil(a, { bold: true });
      s.kolumner.forEach((kol, i) => {
        const mall = Array.isArray(r.f) ? r.f[i] : r.f;
        if (mall === undefined || mall === null) return;
        const c = ws.getCell(`${kol}${rad}`);
        c.value = { formula: expandera(mall, kol, rader) } as ExcelJS.CellFormulaValue;
        const fmt = r.fmt;
        stil(c, {
          ...(fmt !== undefined && fmt !== "text" ? { fmt } : {}),
          ...(r.stark ? { bold: true } : {}),
          ...(r.resultat ? { fill: FYLLNING_RESULTAT } : {}),
        });
        c.alignment = { horizontal: "right" };
      });
      if (r.hint !== undefined) {
        const h = ws.getCell(`H${rad}`);
        h.value = r.hint;
        stil(h, { color: FARG_MUTED });
      }
      rad += 1;
    }
    rad += 1;
  }
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  ws.pageSetup.printArea = `A1:H${sistaRad}`;
  return rader;
}

// ---------------------------------------------------------------------------
// Blad: Om filen
// ---------------------------------------------------------------------------

function byggOm(wb: ExcelJS.Workbook, genererad: Date, etikett: string | undefined): void {
  const ws = wb.addWorksheet(BLAD_OM);
  ws.columns = [{ width: 28 }, { width: 100 }];
  ws.getCell("A1").value = "Om den här filen";
  stil(ws.getCell("A1"), { bold: true, size: 16, color: FARG_PRIMARY });
  const rader: Array<[string, string]> = [
    ["Skapad av", "Binfo (binfo.slanesens.com), bolånekalkylen"],
    ["Skapad", genererad.toISOString().slice(0, 10)],
    ...(etikett !== undefined && etikett !== ""
      ? ([["Kalkyl", etikett]] as Array<[string, string]>)
      : []),
    ["Regelversion", REGELVERSION],
    ["Underlagsversion", String(KALKYL_UNDERLAG_VERSION)],
    ["Så här använder du filen", "Ändra värdena på bladet Indata. Allt räknas om."],
    [
      "Regler",
      "Bladet Regler och antaganden visar varje regel och antagande med källa. Schabloner och antaganden är Binfos egna uppskattningar och är märkta så.",
    ],
    [
      "Skatteantaganden",
      "Låntagarna är under 66 år, folkbokförda i Stockholms kommun, har bara lön, betalar ingen kyrkoavgift och har inga andra avdrag.",
    ],
    ["Förbehåll", PDF_DISCLAIMER],
  ];
  rader.forEach(([k, v], i) => {
    const a = ws.getCell(`A${i + 3}`);
    a.value = k;
    stil(a, { bold: true });
    const b = ws.getCell(`B${i + 3}`);
    b.value = v;
    stil(b, { wrap: true });
  });
  ws.pageSetup.printArea = `A1:B${rader.length + 3}`;
}

// ---------------------------------------------------------------------------
// Publikt
// ---------------------------------------------------------------------------

export interface KalkylXlsxAlternativ {
  etikett?: string;
  /** Skapad-datum (för test och stabila filer). Standard: nu. */
  genererad?: Date;
}

export function byggKalkylArbetsbok(
  underlag: KalkylUnderlag,
  alt: KalkylXlsxAlternativ = {},
): KalkylArbetsbok {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Binfo";
  wb.created = alt.genererad ?? new Date();
  wb.calcProperties = { fullCalcOnLoad: true };

  byggIndata(wb, underlag, alt.etikett);
  byggRegler(wb);
  const rader = byggBerakning(wb);
  byggOm(wb, alt.genererad ?? new Date(), alt.etikett);

  wb.views = [
    { x: 0, y: 0, width: 20000, height: 20000, firstSheet: 0, activeTab: 0, visibility: "visible" },
  ];

  return {
    workbook: wb,
    adresser: Object.fromEntries(
      [...rader.entries()].map(([key, rad]) => [
        key,
        (kolumn = "B") => adr(BLAD_BERAKNING, `${kolumn}${rad}`),
      ]),
    ),
  };
}

/** xlsx-filen som bytes. */
export async function skapaKalkylXlsx(
  underlag: KalkylUnderlag,
  alt: KalkylXlsxAlternativ = {},
): Promise<Uint8Array> {
  const { workbook } = byggKalkylArbetsbok(underlag, alt);
  const buf = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}
