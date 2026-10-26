/**
 * Regelregister för bolånekalkylen: EN post per regel eller antagande som
 * beräkningen använder, med källa, giltighetsdatum och verifieringsdatum.
 * Samma register läses av kalkylsidan, PDF-exporten och Excel-exportens blad
 * "Regler och antaganden" — ändra ett värde här och alla tre följer med.
 *
 * Fyra statusar (STATUS_ETIKETT):
 * - faststalld: värde satt i lag eller av myndighet (Lag 2026:226, Skatteverket…).
 * - referens:   publicerad uppskattning (Konsumentverkets hushållskostnader).
 * - antagande:  Binfos eget antagande, inte reglerat (kalkylränta, bankernas skuldkvot).
 * - schablon:   Binfos schablon utan källa ("Schablon (uppskattning)").
 *
 * Hushållsel och hemförsäkring i drift-schablonerna är Konsumentverkets
 * tabellvärden per antal personer (kv_gemensam_hushallsel_N /
 * kv_gemensam_hemforsakring_N nedan, calc/schabloner.ts slår upp dem).
 *
 * Nya eller ändrade värden kräver en ny post/ny `verifierad`-dag. Inga
 * konstanter får läggas till utan källa; saknas källan märks posten
 * `verifierad: null` och visas för användaren som "Binfos uppskattning"
 * (aldrig med TODO-text; ett test i regler.test.ts vaktar det).
 * TODO: unverified placeholder — bredband och skuldkvot_bankstak saknar källa.
 */

/** Version of this registry, stored with every saved kalkyl
 *  (`sparad_kalkyl.regelversion`). Bump it (date of the change) whenever a
 *  rule's value or a formula changes, so a saved kalkyl shows which rules it
 *  was computed with. */
export const REGELVERSION = "2026-10-26b";

export type RegelGrupp =
  | "Bolån och amortering"
  | "Ränteavdrag"
  | "Skatt 2026"
  | "Levnadskostnader (KALP)"
  | "Antaganden"
  | "Drift (schabloner)";

export type RegelStatus = "faststalld" | "referens" | "antagande" | "schablon";

export const STATUS_ETIKETT: Record<RegelStatus, string> = {
  faststalld: "Regel",
  referens: "Referensvärde",
  antagande: "Antagande",
  schablon: "Schablon (uppskattning)",
};

export interface Regel {
  id: string;
  /** Svenskt namn, visas i UI/PDF/Excel. */
  namn: string;
  varde: number | string;
  /** T.ex. "%", "kr", "kr/mån", "år", "× PBB". */
  enhet: string;
  kalla: { titel: string; url: string | null };
  /** ISO-datum då regeln börjar gälla. */
  gallerFran: string;
  /** ISO-datum då Binfo senast kontrollerade värdet mot källan. null = ej verifierad. */
  verifierad: string | null;
  grupp: RegelGrupp;
  status: RegelStatus;
  anmarkning?: string;
  /** Sida/paragraf i källan. */
  referens?: string;
}

type RegelUtanId = Omit<Regel, "id">;

function r<const I extends string>(id: I, rest: RegelUtanId): Regel & { id: I } {
  return { id, ...rest };
}

const VERIFIERAD = "2026-10-13";

// ---------------------------------------------------------------------------
// Källor
// ---------------------------------------------------------------------------

const SFS_2026_226 = {
  titel: "Lag (2026:226) om begränsning av bostadskrediter",
  url: "https://data.riksdagen.se/dokument/sfs-2026-226.text",
};
const PROP_2025_26_119 = {
  titel: "Prop. 2025/26:119 Utveckling av makrotillsynsområdet",
  url: "https://data.riksdagen.se/dokument/HD03119",
};
const SKV_RANTEAVDRAG = {
  titel: "Skatteverket: Avdrag för ränteutgifter (inkomstår 2026)",
  url: "https://skatteverket.se/ranteavdrag",
};
const SKV_BELOPP_2026 = {
  titel: "Skatteverket: Belopp och procent, inkomstår 2026",
  url: "https://www.skatteverket.se/privat/skatter/beloppochprocent/2026.4.1522bf3f19aea8075ba21.html",
};
const SCB_SKATTESATSER = {
  titel: "SCB: Kommunala skattesatser 2000–2026 (tabell TAB2017), Stockholm",
  url: "https://statistikdatabasen.scb.se/api/v2/tables/TAB2017?lang=sv",
};
const IL_63 = {
  titel: "Inkomstskattelag (1999:1229) 63 kap. 3 § (grundavdrag)",
  url: "https://data.riksdagen.se/dokument/sfs-1999-1229.text",
};
const IL_67 = {
  titel:
    "Inkomstskattelag (1999:1229) 67 kap. 7 § (jobbskatteavdrag) och 46–47 §§ (skattereduktion för förvärvsinkomster)",
  url: "https://data.riksdagen.se/dokument/sfs-1999-1229.text",
};
const LAG_PENSIONSAVGIFT = {
  titel: "Lag (1994:1744) om allmän pensionsavgift",
  url: "https://data.riksdagen.se/dokument/sfs-1994-1744.text",
};
const LAG_PUBLIC_SERVICE = {
  titel: "Lag (2025:986) om public service, 5 kap. 4–5 §§",
  url: "https://data.riksdagen.se/dokument/sfs-2025-986.text",
};
const KONSUMENTVERKET = {
  titel: "Konsumentverket: Hushållskostnader 2026",
  url: "https://publikationer.konsumentverket.se/downloads/kostnadsberakningar-hushallskostnader-2026-sv-kov_tga_32d.pdf",
};
const INGEN_KALLA = { titel: "Ingen källa: Binfos antagande", url: null };

// ---------------------------------------------------------------------------
// Statiska regler
// ---------------------------------------------------------------------------

const LAGSTIFTNING_I_KRAFT = "2026-04-01";

const STATISKA = [
  // ---- Bolån och amortering ------------------------------------------------
  r("bolanetak", {
    namn: "Bolånetak (högsta belåningsgrad vid nytt lån)",
    varde: 90,
    enhet: "%",
    kalla: SFS_2026_226,
    referens: "4 §",
    gallerFran: LAGSTIFTNING_I_KRAFT,
    verifierad: VERIFIERAD,
    grupp: "Bolån och amortering",
    status: "faststalld",
    anmarkning: "Motsvarar minst 10 % kontantinsats.",
  }),
  r("amortering_troskel_hog", {
    namn: "Belåningsgrad över vilken amortering är 2 % per år",
    varde: 70,
    enhet: "%",
    kalla: SFS_2026_226,
    referens: "7 §",
    gallerFran: LAGSTIFTNING_I_KRAFT,
    verifierad: VERIFIERAD,
    grupp: "Bolån och amortering",
    status: "faststalld",
    anmarkning: "Gränsen är ”överstiger”: exakt 70 % ger fortfarande 1 %.",
  }),
  r("amortering_troskel_lag", {
    namn: "Belåningsgrad över vilken amortering är minst 1 % per år",
    varde: 50,
    enhet: "%",
    kalla: SFS_2026_226,
    referens: "7 §",
    gallerFran: LAGSTIFTNING_I_KRAFT,
    verifierad: VERIFIERAD,
    grupp: "Bolån och amortering",
    status: "faststalld",
    anmarkning: "Gränsen är ”överstiger”: exakt 50 % ger ingen amortering.",
  }),
  r("amortering_takt_hog", {
    namn: "Amortering när belåningsgraden överstiger 70 %",
    varde: 2,
    enhet: "% av högsta lånebeloppet per år",
    kalla: SFS_2026_226,
    referens: "7 §",
    gallerFran: LAGSTIFTNING_I_KRAFT,
    verifierad: VERIFIERAD,
    grupp: "Bolån och amortering",
    status: "faststalld",
  }),
  r("amortering_takt_mellan", {
    namn: "Amortering när belåningsgraden överstiger 50 % men inte 70 %",
    varde: 1,
    enhet: "% av högsta lånebeloppet per år",
    kalla: SFS_2026_226,
    referens: "7 §",
    gallerFran: LAGSTIFTNING_I_KRAFT,
    verifierad: VERIFIERAD,
    grupp: "Bolån och amortering",
    status: "faststalld",
  }),
  r("amortering_takt_lag", {
    namn: "Amortering när belåningsgraden är högst 50 %",
    varde: 0,
    enhet: "% av högsta lånebeloppet per år",
    kalla: SFS_2026_226,
    referens: "7 §",
    gallerFran: LAGSTIFTNING_I_KRAFT,
    verifierad: VERIFIERAD,
    grupp: "Bolån och amortering",
    status: "faststalld",
  }),
  r("amortering_underlag", {
    namn: "Vad amorteringen räknas på",
    varde: "Det högsta lånebeloppet sedan senaste värderingen. Vid köp är det det nya lånet.",
    enhet: "text",
    kalla: SFS_2026_226,
    referens: "7 och 13 §§",
    gallerFran: LAGSTIFTNING_I_KRAFT,
    verifierad: VERIFIERAD,
    grupp: "Bolån och amortering",
    status: "faststalld",
    anmarkning:
      "Belåningsgraden räknas mot bostadens marknadsvärde vid förvärvet. Kalkylen använder lånebelopp + kontantinsats som bostadens värde.",
  }),
  r("amortering_nyproduktion_ar", {
    namn: "Nyproduktion: kreditgivaren får medge uppehåll i amortering i högst",
    varde: 5,
    enhet: "år",
    kalla: SFS_2026_226,
    referens: "10 §",
    gallerFran: LAGSTIFTNING_I_KRAFT,
    verifierad: VERIFIERAD,
    grupp: "Bolån och amortering",
    status: "faststalld",
    anmarkning:
      "Endast information: gäller förstahandsköpare av nyproducerad bostad och är kreditgivarens val. Kalkylen räknar inte med undantaget.",
  }),
  r("skarpt_amorteringskrav", {
    namn: "Skärpt amorteringskrav (extra 1 % vid skuldkvot över 4,5 ×)",
    varde: "Avskaffat",
    enhet: "text",
    kalla: PROP_2025_26_119,
    referens: "avsnitt 5.3.2",
    gallerFran: LAGSTIFTNING_I_KRAFT,
    verifierad: VERIFIERAD,
    grupp: "Bolån och amortering",
    status: "faststalld",
    anmarkning:
      "Lag (2026:226) innehåller inget skuldkvotsbaserat krav. Skuldkvoten visas bara som information.",
  }),

  // ---- Ränteavdrag ---------------------------------------------------------
  r("ranteavdrag_sats_lag", {
    namn: "Ränteavdrag (skattereduktion) på ränta upp till 100 000 kr per person",
    varde: 30,
    enhet: "%",
    kalla: SKV_RANTEAVDRAG,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Ränteavdrag",
    status: "faststalld",
    anmarkning: "Inkomstår 2026. Skattereduktion vid underskott av kapital.",
  }),
  r("ranteavdrag_sats_hog", {
    namn: "Ränteavdrag på ränta över 100 000 kr per person",
    varde: 21,
    enhet: "%",
    kalla: SKV_RANTEAVDRAG,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Ränteavdrag",
    status: "faststalld",
  }),
  r("ranteavdrag_tak", {
    namn: "Ränta per person och år där avdraget går från 30 % till 21 %",
    varde: 100000,
    enhet: "kr per person och år",
    kalla: SKV_BELOPP_2026,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Ränteavdrag",
    status: "faststalld",
    anmarkning:
      "Taket gäller per person. Kalkylen delar räntan lika mellan låntagarna. Ränteavdraget är en skattereduktion och kan aldrig bli större än skatten: outnyttjat avdrag flyttas inte mellan personer i kalkylen (i deklarationen kan ränteutgifter omfördelas).",
  }),

  // ---- Skatt 2026 ----------------------------------------------------------
  r("skatt_pbb", {
    namn: "Prisbasbelopp 2026",
    varde: 59200,
    enhet: "kr",
    kalla: SKV_BELOPP_2026,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
  }),
  r("skatt_ibb", {
    namn: "Inkomstbasbelopp 2026",
    varde: 83400,
    enhet: "kr",
    kalla: SKV_BELOPP_2026,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
  }),
  r("skatt_kommunal", {
    namn: "Kommunal inkomstskatt inkl. region, Stockholms kommun",
    varde: 30.55,
    enhet: "%",
    kalla: SCB_SKATTESATSER,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
    anmarkning: "Kommun 18,22 % + region 12,33 % (SCB, 2026). Kyrkoavgift ingår inte.",
  }),
  r("skatt_begravning", {
    namn: "Begravningsavgift, Stockholms kommun",
    varde: 0.07,
    enhet: "%",
    kalla: SKV_BELOPP_2026,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
    anmarkning: "Riksgenomsnittet är 0,292 %; Stockholm har 0,07 %.",
  }),
  r("skatt_statlig", {
    namn: "Statlig inkomstskatt över skiktgränsen",
    varde: 20,
    enhet: "%",
    kalla: SKV_BELOPP_2026,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
  }),
  r("skatt_skiktgrans", {
    namn: "Skiktgräns för statlig inkomstskatt (beskattningsbar förvärvsinkomst)",
    varde: 643000,
    enhet: "kr",
    kalla: SKV_BELOPP_2026,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
  }),
  r("skatt_publicservice_sats", {
    namn: "Public service-avgift",
    varde: 1,
    enhet: "% av beskattningsbar förvärvsinkomst",
    kalla: LAG_PUBLIC_SERVICE,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
  }),
  r("skatt_publicservice_tak", {
    namn: "Public service-avgift, högsta belopp per person och år",
    varde: 1184,
    enhet: "kr",
    kalla: SKV_BELOPP_2026,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
    anmarkning:
      "Underlaget är högst 1,42 × inkomstbasbeloppet (lag 2025:986 5 kap. 4 §), alltså 118 428 kr × 1 %.",
  }),
  r("skatt_pension_sats", {
    namn: "Allmän pensionsavgift",
    varde: 7,
    enhet: "% av förvärvsinkomsten",
    kalla: LAG_PENSIONSAVGIFT,
    referens: "2 §",
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
    anmarkning: "Avgiften ger en lika stor skattereduktion.",
  }),
  r("skatt_pension_tak_inkomst", {
    namn: "Högsta pensionsgrundande inkomst (8,07 × inkomstbasbeloppet)",
    varde: 673038,
    enhet: "kr",
    kalla: LAG_PENSIONSAVGIFT,
    referens: "3 §",
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
    anmarkning: "8,07 × 83 400 kr. Skatteverket anger högsta avgift 47 100 kr.",
  }),
  r("skatt_pension_nedre_grans", {
    namn: "Allmän pensionsavgift tas ut från och med förvärvsinkomsten",
    varde: 25042,
    enhet: "kr",
    kalla: LAG_PENSIONSAVGIFT,
    referens: "4 §",
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
    anmarkning:
      "Avgift tas inte ut under 42,3 % av prisbasbeloppet (25 041,6 kr); Skatteverkets skattefria årsinkomst är 25 041 kr.",
  }),

  // Grundavdrag (63 kap. 3 § IL), faktorer × prisbasbeloppet.
  r("ga_grans_1", {
    namn: "Grundavdrag: första inkomstgräns",
    varde: 0.99,
    enhet: "× PBB",
    kalla: IL_63,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
  }),
  r("ga_grans_2", {
    namn: "Grundavdrag: andra inkomstgräns",
    varde: 2.72,
    enhet: "× PBB",
    kalla: IL_63,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
  }),
  r("ga_grans_3", {
    namn: "Grundavdrag: tredje inkomstgräns",
    varde: 3.11,
    enhet: "× PBB",
    kalla: IL_63,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
  }),
  r("ga_grans_4", {
    namn: "Grundavdrag: fjärde inkomstgräns",
    varde: 7.88,
    enhet: "× PBB",
    kalla: IL_63,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
  }),
  r("ga_bas", {
    namn: "Grundavdrag vid låg inkomst",
    varde: 0.423,
    enhet: "× PBB",
    kalla: IL_63,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
  }),
  r("ga_okning", {
    namn: "Grundavdrag: ökning per krona inkomst mellan första och andra gränsen",
    varde: 20,
    enhet: "%",
    kalla: IL_63,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
  }),
  r("ga_topp", {
    namn: "Grundavdrag mellan andra och tredje gränsen",
    varde: 0.77,
    enhet: "× PBB",
    kalla: IL_63,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
  }),
  r("ga_minskning", {
    namn: "Grundavdrag: minskning per krona inkomst mellan tredje och fjärde gränsen",
    varde: 10,
    enhet: "%",
    kalla: IL_63,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
  }),
  r("ga_lagsta", {
    namn: "Grundavdrag vid hög inkomst",
    varde: 0.293,
    enhet: "× PBB",
    kalla: IL_63,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
    anmarkning: "Avrundas uppåt till helt hundratal (17 400 kr 2026).",
  }),

  // Jobbskatteavdrag (67 kap. 7 § IL).
  r("jsa_grans_1", {
    namn: "Jobbskatteavdrag: första inkomstgräns",
    varde: 0.91,
    enhet: "× PBB",
    kalla: IL_67,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
  }),
  r("jsa_grans_2", {
    namn: "Jobbskatteavdrag: andra inkomstgräns",
    varde: 3.24,
    enhet: "× PBB",
    kalla: IL_67,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
  }),
  r("jsa_grans_3", {
    namn: "Jobbskatteavdrag: tredje inkomstgräns",
    varde: 8.08,
    enhet: "× PBB",
    kalla: IL_67,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
  }),
  r("jsa_sats_2", {
    namn: "Jobbskatteavdrag: andel av inkomsten mellan första och andra gränsen",
    varde: 38.74,
    enhet: "%",
    kalla: IL_67,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
  }),
  r("jsa_bas_3", {
    namn: "Jobbskatteavdrag: grundbelopp mellan andra och tredje gränsen",
    varde: 1.813,
    enhet: "× PBB",
    kalla: IL_67,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
  }),
  r("jsa_sats_3", {
    namn: "Jobbskatteavdrag: andel av inkomsten mellan andra och tredje gränsen",
    varde: 25.1,
    enhet: "%",
    kalla: IL_67,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
  }),
  r("jsa_tak", {
    namn: "Jobbskatteavdrag: grundbelopp över tredje gränsen",
    varde: 3.027,
    enhet: "× PBB",
    kalla: IL_67,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
    anmarkning:
      "Avdraget (efter grundavdrag) multipliceras med den kommunala skattesatsen och räknas av mot kommunal skatt.",
  }),

  // Skattereduktion för förvärvsinkomster (67 kap. 46–47 §§ IL).
  r("sf_nedre", {
    namn: "Skattereduktion för förvärvsinkomster: lägsta beskattningsbara inkomst",
    varde: 40000,
    enhet: "kr",
    kalla: IL_67,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
  }),
  r("sf_ovre", {
    namn: "Skattereduktion för förvärvsinkomster: inkomst där högsta belopp nås",
    varde: 240000,
    enhet: "kr",
    kalla: IL_67,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
  }),
  r("sf_sats", {
    namn: "Skattereduktion för förvärvsinkomster: andel mellan gränserna",
    varde: 0.75,
    enhet: "%",
    kalla: IL_67,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
  }),
  r("sf_max", {
    namn: "Skattereduktion för förvärvsinkomster: högsta belopp",
    varde: 1500,
    enhet: "kr",
    kalla: IL_67,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Skatt 2026",
    status: "faststalld",
  }),

  r("skatt_forutsattningar", {
    namn: "Förutsättningar för skatteberäkningen",
    varde:
      "Låntagarna är under 66 år vid årets ingång, folkbokförda i Stockholms kommun, har bara lön som inkomst, betalar ingen kyrkoavgift och har inga andra avdrag.",
    enhet: "text",
    kalla: INGEN_KALLA,
    gallerFran: "2026-01-01",
    verifierad: null,
    grupp: "Antaganden",
    status: "antagande",
    anmarkning: "Avgränsning i Binfos kalkyl, ingen regel.",
  }),

  // ---- Antaganden ---------------------------------------------------------
  r("kalkylranta_standard", {
    namn: "Kalkylränta (bankens stresstest, förvalt värde)",
    varde: 7,
    enhet: "% per år",
    kalla: INGEN_KALLA,
    gallerFran: "2026-10-12",
    verifierad: null,
    grupp: "Antaganden",
    status: "antagande",
    anmarkning:
      "Inte reglerad: varje bank bestämmer sin egen kalkylränta. 7 % är Binfos antagande och förvalda värde. Du kan ändra det.",
  }),
  r("skuldkvot_bankstak", {
    namn: "Bankernas typiska tak för skuldkvot (lån ÷ bruttoårsinkomst)",
    varde: 5,
    enhet: "×",
    kalla: INGEN_KALLA,
    gallerFran: "2026-10-12",
    verifierad: null,
    grupp: "Antaganden",
    status: "antagande",
    anmarkning:
      "Binfos uppskattning. Vi har inte hittat något publicerat tak från bankerna, så 5 gånger bruttoårsinkomsten är ett antagande. För sammanhang: bland köpare 2025 lånade 7,1 % mer än 4,5 gånger inkomsten och 1,8 % mer än 5,5 gånger (Finansinspektionen, Svenska bolån 2025). Visas bara som information och styr aldrig amorteringen.",
  }),
  r("kalp_mat", {
    namn: "Matkostnad i KALP",
    varde: "All mat lagas hemma",
    enhet: "text",
    kalla: KONSUMENTVERKET,
    referens: "sida 1, Individuella matkostnader",
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Antaganden",
    status: "antagande",
    anmarkning:
      "Konsumentverket anger också ett lägre alternativ utan lunch på vardagar. Binfo räknar med det dyrare, att all mat lagas hemma.",
  }),
  r("kalp_vuxen_alder", {
    namn: "Vuxnas åldersgrupp i KALP",
    varde: "25–50 år",
    enhet: "text",
    kalla: INGEN_KALLA,
    gallerFran: "2026-10-13",
    verifierad: null,
    grupp: "Antaganden",
    status: "antagande",
    anmarkning:
      "Kalkylen frågar inte efter ålder, så alla vuxna räknas som 25–50 år (Konsumentverkets kolumn).",
  }),
  r("kalp_barn_0_3", {
    namn: "Barn 0–3 år i KALP",
    varde: "Konsumentverkets kolumn 0 år",
    enhet: "text",
    kalla: KONSUMENTVERKET,
    referens: "sida 1",
    gallerFran: "2026-10-13",
    verifierad: VERIFIERAD,
    grupp: "Antaganden",
    status: "antagande",
    anmarkning:
      "Konsumentverket skiljer på 0 år (3 950 kr/mån för mat och övriga individuella kostnader) och 1–3 år (3 830 kr/mån). Kalkylens åldersgrupp 0–3 år räknas som den dyrare, 0 år, så att kalkylen inte underskattar.",
  }),
  r("kalp_barn_under_8_avdrag", {
    namn: "Avdrag för internet- och mobilabonnemang i hushåll med barn under 8 år",
    varde: 229,
    enhet: "kr/mån",
    kalla: KONSUMENTVERKET,
    referens: "sida 1, fotnot 5",
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Levnadskostnader (KALP)",
    status: "referens",
    anmarkning:
      "Avdraget görs en gång per hushåll om det finns barn i åldersgruppen 0–3 eller 4–6 år. Åldersgruppen 7–10 år räknas som 8 år eller äldre (ingen minskning).",
  }),
] as const;

export type RegelId = (typeof STATISKA)[number]["id"];

// ---------------------------------------------------------------------------
// Drift-schabloner (värdena speglar calc/schabloner.ts; ett test låser dem)
// ---------------------------------------------------------------------------

const SCHABLON_NOT =
  "Binfos uppskattning. Beloppet är en grov uppskattning av en typisk kostnad och bygger inte på någon publicerad källa. Skriv över det med ditt eget belopp om du vet bättre.";

const NILS_HOLGERSSON = {
  titel: "Nils Holgersson-gruppen: Nils Holgersson 2026, bilaga 1a",
  url: "https://nilsholgersson.nu/wp-content/uploads/2026/10/Nils-Holgersson-2026-Slutrapport-Bilaga-1-4.pdf",
};

const SCHABLONER: Regel[] = [
  {
    id: "schablon_varme_per_m2",
    namn: "Värme: per m² boarea och månad (räknas bara med när värme inte ingår i avgiften)",
    varde: 21,
    enhet: "kr/mån och m²",
    kalla: NILS_HOLGERSSON,
    referens: "Bilaga 1a, fjärrvärme, Stockholms kommun",
    gallerFran: "2026-10-26",
    verifierad: "2026-10-26",
    grupp: "Drift (schabloner)",
    status: "referens",
    anmarkning:
      "Fjärrvärme i Stockholms kommun kostar 250,32 kr per m² lägenhetsyta och år inklusive moms (varmvatten ingår). Delat med 12 blir det cirka 20,9, avrundat till 21 kr per m² boarea och månad. Omräkningen är Binfos. Gäller bara när värmen faktiskt inte ingår i månadsavgiften.",
  },
  {
    id: "schablon_vatten_per_m2",
    namn: "Vatten och avlopp: per m² boarea och månad (räknas bara med när vatten inte ingår i avgiften)",
    varde: 6,
    enhet: "kr/mån och m²",
    kalla: NILS_HOLGERSSON,
    referens: "Bilaga 1a, vatten och avlopp, Stockholms kommun",
    gallerFran: "2026-10-26",
    verifierad: "2026-10-26",
    grupp: "Drift (schabloner)",
    status: "referens",
    anmarkning:
      "Vatten och avlopp i Stockholms kommun kostar 71,08 kr per m² lägenhetsyta och år inklusive moms. Delat med 12 blir det cirka 5,9, avrundat till 6 kr per m² boarea och månad. Omräkningen är Binfos. Gäller bara när vatten faktiskt inte ingår i månadsavgiften.",
  },
  {
    id: "schablon_bredband",
    namn: "Bredband",
    varde: 349,
    enhet: "kr/mån",
    kalla: { titel: "Binfos uppskattning (ingen publicerad källa)", url: null },
    gallerFran: "2026-01-01",
    verifierad: null,
    grupp: "Drift (schabloner)",
    status: "schablon",
    anmarkning: SCHABLON_NOT,
  },
];

// ---------------------------------------------------------------------------
// Konsumentverket, Hushållskostnader 2026 (sida 1 i PDF:en, kr per månad)
// ---------------------------------------------------------------------------

/** Konsumentverkets åldersgrupper, i den ordning kolumnerna står i tabellen. */
export const KV_ALDERSGRUPPER = [
  "0",
  "1-3",
  "4-6",
  "7-10",
  "11-14",
  "15-17",
  "18-24",
  "25-50",
  "51-70",
  "71+",
] as const;
export type KvAlder = (typeof KV_ALDERSGRUPPER)[number];

type Tioarsrad = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
type Sjurad = readonly [number, number, number, number, number, number, number];

/** "Individuella matkostnader per månad", raden "all mat lagas hemma" (sida 1). */
const KV_MAT: Tioarsrad = [1030, 1100, 1710, 2130, 2650, 3050, 2840, 2730, 2490, 2450];

/** "Övriga individuella kostnader per månad" (sida 1). 0 = posten gäller inte åldersgruppen. */
const KV_OVRIGA = {
  klader_skor: [1070, 1050, 1160, 1130, 1000, 950, 870, 820, 790, 720],
  fritid_lek: [120, 240, 420, 450, 410, 520, 630, 600, 590, 560],
  // Gäller barn från 8 år; tabellen visar värde redan i kolumnen 7–10.
  mobiltelefon: [0, 0, 0, 80, 80, 130, 130, 130, 110, 110],
  personlig_hygien: [510, 660, 170, 180, 350, 560, 570, 590, 580, 550],
  barn_och_ungdomsforsakring: [230, 230, 230, 230, 230, 230, 0, 0, 0, 0],
  ovrig_barnutrustning: [990, 550, 20, 20, 0, 0, 0, 0, 0, 0],
} as const satisfies Record<string, Tioarsrad>;

/** Tabellens "summa kostnader" per åldersgrupp, för kontroll i tester. */
export const KV_OVRIGA_SUMMA: Tioarsrad = [
  2920, 2730, 2000, 2090, 2070, 2390, 2200, 2140, 2070, 1940,
];

export const KV_OVRIGA_NAMN: Record<keyof typeof KV_OVRIGA, string> = {
  klader_skor: "Kläder och skor",
  fritid_lek: "Fritid och lek",
  mobiltelefon: "Mobiltelefon",
  personlig_hygien: "Personlig hygien",
  barn_och_ungdomsforsakring: "Barn- och ungdomsförsäkring",
  ovrig_barnutrustning: "Övrig barnutrustning",
};

/** "Hushållets gemensamma kostnader per månad", 1–7 personer (sida 1). */
const KV_GEMENSAMMA = {
  forbrukningsvaror: [200, 300, 460, 560, 690, 790, 890],
  hemutrustning: [920, 1030, 1310, 1560, 1790, 1950, 2060],
  internet_och_mobilabonnemang: [1000, 1230, 1460, 1690, 1920, 2150, 2380],
  ovriga_medietjanster: [640, 690, 720, 720, 720, 720, 840],
  hushallsel: [400, 530, 700, 870, 1010, 1150, 1280],
  vatten_och_avlopp: [220, 440, 650, 880, 1080, 1310, 1530],
  hemforsakring: [150, 170, 200, 250, 300, 340, 350],
} as const satisfies Record<string, Sjurad>;

export const KV_GEMENSAMMA_SUMMA: Sjurad = [3530, 4390, 5500, 6530, 7510, 8410, 9330];

export const KV_GEMENSAMMA_NAMN: Record<keyof typeof KV_GEMENSAMMA, string> = {
  forbrukningsvaror: "Förbrukningsvaror",
  hemutrustning: "Hemutrustning",
  internet_och_mobilabonnemang: "Internet- och mobilabonnemang",
  ovriga_medietjanster: "Övriga medietjänster",
  hushallsel: "Hushållsel",
  vatten_och_avlopp: "Vatten och avlopp",
  hemforsakring: "Hemförsäkring",
};

export const KONSUMENTVERKET_2026 = {
  mat: KV_MAT,
  ovriga: KV_OVRIGA,
  gemensamma: KV_GEMENSAMMA,
  /** Minskning av internet- och mobilabonnemang när hushållet har barn under 8 år. */
  barnUnder8Avdrag: 229,
  /** Största hushållsstorlek tabellen täcker. */
  maxPersoner: 7,
} as const;

function kvPost(
  id: string,
  namn: string,
  varde: number,
  enhet: string,
  referens: string,
  anmarkning?: string,
): Regel {
  return {
    id,
    namn,
    varde,
    enhet,
    kalla: KONSUMENTVERKET,
    referens,
    gallerFran: "2026-01-01",
    verifierad: VERIFIERAD,
    grupp: "Levnadskostnader (KALP)",
    status: "referens",
    ...(anmarkning !== undefined ? { anmarkning } : {}),
  };
}

function genereraKvRegler(): Regel[] {
  const ut: Regel[] = [];
  KV_ALDERSGRUPPER.forEach((alder, i) => {
    ut.push(
      kvPost(
        `kv_mat_${alder}`,
        `Mat, åldersgrupp ${alder} år (all mat lagas hemma)`,
        KV_MAT[i] ?? 0,
        "kr/mån",
        "sida 1, Individuella matkostnader",
      ),
    );
  });
  (Object.keys(KV_OVRIGA) as Array<keyof typeof KV_OVRIGA>).forEach((nyckel) => {
    KV_ALDERSGRUPPER.forEach((alder, i) => {
      ut.push(
        kvPost(
          `kv_${nyckel}_${alder}`,
          `${KV_OVRIGA_NAMN[nyckel]}, åldersgrupp ${alder} år`,
          KV_OVRIGA[nyckel][i] ?? 0,
          "kr/mån",
          "sida 1, Övriga individuella kostnader",
          nyckel === "mobiltelefon" ? "Gäller barn från 8 år." : undefined,
        ),
      );
    });
  });
  (Object.keys(KV_GEMENSAMMA) as Array<keyof typeof KV_GEMENSAMMA>).forEach((nyckel) => {
    for (let personer = 1; personer <= KONSUMENTVERKET_2026.maxPersoner; personer++) {
      ut.push(
        kvPost(
          `kv_gemensam_${nyckel}_${personer}`,
          `${KV_GEMENSAMMA_NAMN[nyckel]}, hushåll med ${personer} ${personer === 1 ? "person" : "personer"}`,
          KV_GEMENSAMMA[nyckel][personer - 1] ?? 0,
          "kr/mån",
          "sida 1, Hushållets gemensamma kostnader",
        ),
      );
    }
  });
  return ut;
}

// ---------------------------------------------------------------------------
// Registret
// ---------------------------------------------------------------------------

/** Alla regler och antaganden, i visningsordning. */
export const REGLER: readonly Regel[] = [...STATISKA, ...SCHABLONER, ...genereraKvRegler()];

const PER_ID = new Map<string, Regel>(REGLER.map((x) => [x.id, x]));

export function hittaRegel(id: string): Regel | undefined {
  return PER_ID.get(id);
}

/** Talvärdet för en statisk regel. Kastar om posten saknas eller inte är ett tal. */
export function tal(id: RegelId): number {
  const regel = PER_ID.get(id);
  if (regel === undefined || typeof regel.varde !== "number") {
    throw new Error(`Regel ${id} saknas eller är inte ett tal`);
  }
  return regel.varde;
}

export function reglerIGrupp(grupp: RegelGrupp): Regel[] {
  return REGLER.filter((x) => x.grupp === grupp);
}

/** Procent (30) till andel (0,3). Avrundar bort flyttalsbrus så att 38,74 blir exakt 0,3874. */
export const andel = (id: RegelId): number => Number((tal(id) / 100).toPrecision(12));

/** Minsta kontantinsats som andel av bostadens värde: 1 − bolånetak. */
export const MIN_KONTANTINSATS_ANDEL = Number((1 - andel("bolanetak")).toFixed(6));
