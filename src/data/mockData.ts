/**
 * Central mock data for Binfo.
 * ALL screens read from this file so numbers stay consistent.
 *
 * TODO(pipeline): this object is the shape the real analysis pipeline
 * (PDF-parsning av årsredovisning + värderingsdata) should return.
 * TODO(payment): betalintegrationen (Stripe/Swish) kopplas in i
 * src/routes/forhandsvisning.tsx och låser upp /analys.
 */

/**
 * Så länge denna är true körs appen helt på mockdata,
 * även om en backend finns kopplad. Sätt false när
 * analyspipelinen är på plats.
 */
export const USE_MOCK_DATA = true;

export type Status = "green" | "amber" | "red";
export type PropertyType = "brf" | "hus";

export const property = {
  namn: "Brf Lindgården",
  adress: "Kapellgränd 12, Södermalm",
  ort: "Stockholm",
  utgangspris: 4_950_000,
  boarea: 58,
  rum: "3:a",
  vaning: 4,
  vaningarTotalt: 6,
  manadsavgift: 3_240,
  andelstal: 2.1,
  byggar: 1931,
  skuldPerKvm: 8_500,
  foreningensLan: 43_200_000,
  foreningensYta: 5_082, // m² → 43,2 Mkr / 5 082 m² ≈ 8 500 kr/m²
  snittranta: 1.94,
  rantebindning: "Två lån (58 %) omsätts inom 12 månader",
};

export const risk = {
  betyg: "B+",
  sammanfattning:
    "Stabil förening med god kassa, men hög belåning och stora ränteomsättningar inom ett år gör avgiften känslig.",
};

export const rodaFlaggor = [
  {
    titel: "Hög skuldsättning per kvadratmeter",
    text: "Föreningen har 8 500 kr/m² i lån, mot ett riksgenomsnitt kring 5 500 kr/m². Din andel av skulden är cirka 493 000 kr.",
  },
  {
    titel: "58 % av lånen omsätts inom 12 månader",
    text: "Snitträntan är i dag 1,94 %. Vid omsättning till 4 % ökar föreningens räntekostnad med cirka 516 000 kr per år — motsvarande ungefär 490 kr/mån för den här lägenheten.",
  },
];

export const lastaInsikter = [
  {
    titel: "Underhållsplan & kommande projekt",
    text: "Stambyte planerat 2029 enligt underhållsplanen. Avsatt belopp täcker cirka 40 % av bedömd kostnad.",
  },
  {
    titel: "Är priset rimligt?",
    text: "Utgångspriset ligger 3,1 % under Boolis värdering men 6 % över senaste jämförbara försäljningen i föreningen.",
  },
  {
    titel: "Avgiftsprognos 3 år",
    text: "Sannolik avgiftshöjning på 12–18 % till 2028 i basscenariot.",
  },
  {
    titel: "Frågor att ställa styrelsen",
    text: "Sex skräddarsydda frågor baserade på årsredovisningens avvikelser.",
  },
];

/** De sju nyckeltal som ska redovisas enligt lag (BRL/BRF-förordningen). */
export const nyckeltal: {
  namn: string;
  varde: string;
  status: Status;
  forklaring: string;
  highlight?: boolean;
}[] = [
  {
    namn: "Skuldsättning per kvadratmeter",
    varde: "8 500 kr/m²",
    status: "red",
    forklaring:
      "Föreningens lån delat på ytan. Över 8 000 kr/m² räknas som högt — räntehöjningar slår hårt mot avgiften.",
    highlight: true,
  },
  {
    namn: "Sparande per kvadratmeter",
    varde: "212 kr/m²",
    status: "amber",
    forklaring:
      "Vad föreningen lägger undan för framtida underhåll. Under 250 kr/m² brukar vara i underkant för ett hus från 1931.",
  },
  {
    namn: "Räntekänslighet",
    varde: "12,7 %",
    status: "red",
    forklaring:
      "Så mycket avgiften behöver höjas om räntan stiger en procentenhet och slår igenom på hela lånestocken. Över 8 % räknas som tydligt känsligt.",
  },
  {
    namn: "Energikostnad per kvadratmeter",
    varde: "168 kr/m²",
    status: "green",
    forklaring:
      "Uppvärmning, el och vatten per kvadratmeter. Ligger under snittet för liknande hus i Stockholm.",
  },
  {
    namn: "Årsavgift per kvadratmeter",
    varde: "670 kr/m²",
    status: "green",
    forklaring:
      "Din avgift på årsbasis per kvadratmeter. Låg avgift i kombination med hög skuld kan dock betyda framtida höjningar.",
  },
  {
    namn: "Nettoomsättning per kvadratmeter",
    varde: "742 kr/m²",
    status: "green",
    forklaring:
      "Föreningens totala intäkter per kvadratmeter, inklusive hyror från lokaler.",
  },
  {
    namn: "Kassaflöde efter investeringar",
    varde: "+ 640 tkr",
    status: "green",
    forklaring:
      "Föreningen går plus efter årets investeringar och amorteringar. Ekonomin bär sig i dagsläget.",
  },
];

export const prisjamforelse = {
  utgangspris: property.utgangspris,
  boolivardering: 5_110_000,
  senasteForsaljning: {
    pris: 4_670_000,
    boarea: 57,
    datum: "mars 2026",
    beskrivning: "3:a, 57 m², våning 3",
  },
  verdikt:
    "Utgångspriset är satt strax under värderingen men klart över den senaste jämförbara affären i föreningen. Räkna med att slutpriset landar 3–7 % över utgångspris — sätt din gräns innan budgivningen.",
};

export const fragorAttStalla = [
  "Vilka lån omsätts under de kommande 12 månaderna, och till vilken ränta räknar styrelsen?",
  "Vad står det i underhållsplanen om stammar och fasad — och när är stambytet budgeterat?",
  "Har styrelsen beslutat om, eller diskuterat, en avgiftshöjning de närmaste två åren?",
  "Amorterar föreningen på sina lån i dag, och i så fall med hur mycket per år?",
  "Finns det pågående eller avslutade tvister, fuktskador eller försäkringsärenden i huset?",
  "Hur många lägenheter ägs av föreningen eller hyrs ut som hyresrätter, och finns lokalhyresavtal som löper ut?",
];

/** Bolånekalkylens utgångsvärden. */
export const kalkylDefaults = {
  lanebelopp: 3_960_000, // 80 % av utgångspriset
  kontantinsats: 990_000,
  ranta: 3.6,
  bruttoinkomst: 900_000,
  antalLantagare: 2,
};

/**
 * Gällande svenska regler från 1 april 2026.
 * Amorteringskravet baseras ENBART på belåningsgrad.
 * Det skärpta kravet (skuldkvot > 4,5×) är slopat.
 */
export const amorteringsregler = {
  bolanetak: 0.9, // minsta kontantinsats 10 %
  minKontantinsatsAndel: 0.1,
  bankernasInternaTak: 5.0, // skuldkvot där bankerna brukar dra gränsen
};

/** Ränteavdrag: 30 % upp till taket per person och år, 21 % däröver. */
export const ranteavdrag = {
  takPerPerson: 100_000,
  lagreSats: 0.3,
  hogreSats: 0.21,
};

/**
 * Tre lägen för alla osäkra uppgifter. "okant" är alltid förvalt —
 * ett okänt värde får aldrig se ut som ett "nej".
 */
export type Tristate = "ja" | "nej" | "okant";

export type AvgiftPostId = "varme" | "vatten" | "el" | "bredband" | "tv";

export const avgiftPoster: { id: AvgiftPostId; label: string }[] = [
  { id: "varme", label: "Värme" },
  { id: "vatten", label: "Vatten" },
  { id: "el", label: "El" },
  { id: "bredband", label: "Bredband" },
  { id: "tv", label: "TV" },
];

/** Bakåtkompatibelt alias för äldre anrop. */
export const avgiftIngarOptions = avgiftPoster.map((p) => ({
  value: p.id,
  label: p.label,
}));

/**
 * Varje osäkert attribut modelleras som värde + säkerhet, aldrig som ett
 * platt värde.
 * TODO(backend): säkerheten ska styra analysens konfidensintervall.
 */
export type Osaker<T> = { varde: T; sakerhet: "kand" | "okand" };

const okand = <T,>(varde: T): Osaker<T> => ({ varde, sakerhet: "okand" });

export const osakraUppgifter: {
  hiss: Osaker<Tristate>;
  balkong: Osaker<Tristate>;
  ingarIAvgiften: Record<AvgiftPostId, Osaker<Tristate>>;
} = {
  hiss: okand<Tristate>("okant"),
  balkong: okand<Tristate>("okant"),
  ingarIAvgiften: {
    varme: okand<Tristate>("okant"),
    vatten: okand<Tristate>("okant"),
    el: okand<Tristate>("okant"),
    bredband: okand<Tristate>("okant"),
    tv: okand<Tristate>("okant"),
  },
};

/** Uppgifter om föreningen — speglar formuläret på Analysera-sidan. */
export const foreningsUppgifter = {
  organisationsnummer: "769612-3456",
  adress: property.adress,
  postnummer: "116 25",
  ort: property.ort,
  antalRum: "3",
  byggar: String(property.byggar),
};

/** Din andel av föreningens skuld: 8 500 kr/m² × 58 m². */
export const andelAvSkuld = property.skuldPerKvm * property.boarea; // 493 000 kr

/** Andel av lånen som omsätts inom 12 månader. */
export const omsattsInom12Man = 0.58;

/** Avgiftspåslag per procentenhet högre ränta, full genomslagseffekt. */
export const avgiftPerProcentenhet = (andelAvSkuld * 0.01) / 12; // ca 411 kr/mån

export function kr(n: number): string {
  return Math.round(n).toLocaleString("sv-SE") + " kr";
}
