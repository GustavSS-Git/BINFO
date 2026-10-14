import type { FeeInclusion, PropertyInput, PropertyKind, Tristate } from "@/types/analysis";
import type { PropertyType } from "@/data/mockData";

/**
 * Ren logik för /analysera: formulär → PropertyInput, plus filkontrollen som
 * körs innan uppladdning. Ingen React-import, testbar direkt (se
 * analyseraForm.test.ts) — samma mönster som src/lib/bolanekalkyl.ts.
 */

// ---------------------------------------------------------------------------
// Filkontroll — klientsidans motsvarighet till serverns validering. Ren
// bekvämlighet: servern (skapaAnalys) är den faktiska auktoriteten.
// ---------------------------------------------------------------------------

export const MAX_PDF_STORLEK_BYTES = 25 * 1024 * 1024;

/**
 * `null` betyder "godkänd". Enträff på ANTINGEN MIME-typen ELLER
 * filändelsen räcker — vissa webbläsare/OS rapporterar tom `type` för PDF-
 * filer, så ändelsen måste kunna bära hela avgörandet ensam.
 */
export function kontrolleraPdfFil(file: File | null): string | null {
  if (!file) {
    return "Välj en fil att ladda upp.";
  }
  const ärPdfTyp = file.type === "application/pdf";
  const ärPdfNamn = file.name.toLowerCase().endsWith(".pdf");
  if (!ärPdfTyp && !ärPdfNamn) {
    return "Filen måste vara en PDF.";
  }
  if (file.size > MAX_PDF_STORLEK_BYTES) {
    return "Filen är för stor. Max 25 MB.";
  }
  return null;
}

/**
 * Filfelet att visa när användaren skickar formuläret. En vald men avvisad
 * fil (fel typ, för stor) sparas aldrig som `fil` — bara skälet i
 * `tidigareFilfel`. Det skälet ska stå kvar, inte ersättas av "välj en fil".
 */
export function filfelVidSkick(fil: File | null, tidigareFilfel: string | null): string | null {
  if (fil === null && tidigareFilfel !== null) return tidigareFilfel;
  return kontrolleraPdfFil(fil);
}

export function formateraFilstorlek(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1).replace(".", ",")} MB`;
}

// ---------------------------------------------------------------------------
// Sökparametern `forening` (länk från BRF-registret)
// ---------------------------------------------------------------------------

/** Registerslugen (`<namn>-<orgnr>`, se slugForForening på servern) ur
 *  söksträngen. Kastar aldrig: allt som inte ser ut som en slug blir
 *  `undefined`, och formuläret visar då den vanliga uppladdningen. */
export function parseForeningSlug(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const slug = v.trim();
  return /^[a-z0-9][a-z0-9-]{0,199}$/.test(slug) ? slug : undefined;
}

// ---------------------------------------------------------------------------
// Talparsning — användare skriver "4 950 000" eller "2,1", inte JSON-tal.
// ---------------------------------------------------------------------------

/** Tar bort vanliga, icke-brytande och smala icke-brytande mellanslag
 *  (tusentalsavgränsare) och tolkar komma som decimaltecken. */
function normaliseraTalsträng(rått: string): string {
  return rått.replace(/[\s\u00A0\u202F]/g, "").replace(",", ".");
}

/** Ett obligatoriskt, positivt tal. `null` för tomt, icke-numeriskt, noll
 *  eller negativt — alla dessa ska visas som samma valideringsfel. */
export function parsePositivtTal(rått: string): number | null {
  const normaliserat = normaliseraTalsträng(rått);
  if (normaliserat === "") return null;
  const tal = Number(normaliserat);
  return Number.isFinite(tal) && tal > 0 ? tal : null;
}

/** Ett VALFRITT heltal (våning, byggår). Tomt fält -> `undefined` (utelämnas
 *  helt ur PropertyInput, se buildPropertyInput). Ogiltig text i ett valfritt
 *  fält blockerar aldrig formuläret — den tolkas också som "inget angivet"
 *  snarare än ett fel, eftersom fältet redan är valfritt. */
export function parseValfrittHeltal(rått: string): number | undefined {
  if (rått.trim() === "") return undefined;
  const tal = parsePositivtTal(rått);
  if (tal === null) return undefined;
  return Math.trunc(tal);
}

/** Våning: ett heltal ≥ 0 — 0 är bottenvåning, som `parsePositivtTal` annars
 *  skulle avvisa. `null` för tomt eller ogiltigt. */
export function parseVaning(rått: string): number | null {
  const normaliserat = normaliseraTalsträng(rått);
  if (normaliserat === "") return null;
  const tal = Number(normaliserat);
  return Number.isFinite(tal) && tal >= 0 ? Math.trunc(tal) : null;
}

// ---------------------------------------------------------------------------
// Formulärvalidering
// ---------------------------------------------------------------------------

export interface AnalyseraFormFields {
  utgangspris: string;
  boarea: string;
  vaning: string;
  manadsavgift: string;
  andelstal: string;
  organisationsnummer: string;
  adress: string;
  postnummer: string;
  ort: string;
  antalRum: string;
  byggar: string;
}

/** Ett fel per obligatoriskt fält. `byggar` är valfritt och ingår därför inte
 *  här. `vaning` är obligatoriskt i formuläret (köparen ska alltid kunna säga
 *  var i huset lägenheten ligger) även om PropertyInput-kontraktet har fältet
 *  valfritt. */
export interface AnalyseraFormFel {
  utgangspris: string | null;
  boarea: string | null;
  vaning: string | null;
  manadsavgift: string | null;
  antalRum: string | null;
  adress: string | null;
  postnummer: string | null;
  ort: string | null;
}

/** Felet för ett obligatoriskt postnummer (`null` = giltigt). Delas av
 *  /analysera och /vardering (src/lib/varderingForm.ts). */
export function valideraPostnummer(rått: string): string | null {
  const postnummer = rått.trim();
  if (postnummer === "") return "Ange postnummer.";
  return /^\d{3} ?\d{2}$/.test(postnummer)
    ? null
    : "Ange ett postnummer med fem siffror, t.ex. 116 25.";
}

export function validateraAnalyseraForm(f: AnalyseraFormFields): AnalyseraFormFel {
  return {
    utgangspris: parsePositivtTal(f.utgangspris) === null ? "Ange ett giltigt utgångspris." : null,
    boarea: parsePositivtTal(f.boarea) === null ? "Ange en giltig boarea." : null,
    vaning: parseVaning(f.vaning) === null ? "Ange våning." : null,
    manadsavgift: parsePositivtTal(f.manadsavgift) === null ? "Ange en giltig månadsavgift." : null,
    antalRum: parsePositivtTal(f.antalRum) === null ? "Ange antal rum." : null,
    adress: f.adress.trim() === "" ? "Ange adress." : null,
    postnummer: valideraPostnummer(f.postnummer),
    ort: f.ort.trim() === "" ? "Ange ort." : null,
  };
}

export function harValideringsfel(fel: AnalyseraFormFel): boolean {
  return Object.values(fel).some(Boolean);
}

// ---------------------------------------------------------------------------
// PropertyInput-mappning
// ---------------------------------------------------------------------------

export function mapPropertyKind(typ: PropertyType): PropertyKind {
  return typ === "brf" ? "bostadsratt" : "hus";
}

/** De fält som INTE kommer från AnalyseraFormFields — de lever i den delade
 *  useUppgifter-storen (src/lib/uppgifter.ts) och skickas in separat. */
export interface AnalyseraFormUppgifter {
  hiss: Tristate;
  balkong: Tristate;
  avgiftInkluderar: FeeInclusion;
  antalPersoner: number;
}

/**
 * Bygger en PropertyInput från formuläret. Förutsätter att formuläret redan
 * validerats (validateraAnalyseraForm gav inga fel) — anropsstället spärrar
 * submit på fel innan detta anropas, så de obligatoriska `?? 0`-reserverna
 * nedan är en säkerhetsnätslösning, inte den normala vägen.
 *
 * `vaning`/`byggar` utelämnas HELT (inte satta till `undefined`) när de inte
 * går att tolka som tal — exactOptionalPropertyTypes kräver det, och ett
 * utelämnat fält är dessutom den semantik kontraktet vill ha. `vaning` är
 * numera obligatoriskt i formuläret, så där är utelämnandet bara ett
 * säkerhetsnät; `byggar` kan fortfarande vara riktigt tomt.
 */
export function buildPropertyInput(
  typ: PropertyType,
  form: AnalyseraFormFields,
  uppgifter: AnalyseraFormUppgifter,
): PropertyInput {
  const vaning = parseVaning(form.vaning) ?? undefined;
  const byggar = parseValfrittHeltal(form.byggar);

  return {
    kind: mapPropertyKind(typ),
    utgangspris: Math.round(parsePositivtTal(form.utgangspris) ?? 0),
    boarea: parsePositivtTal(form.boarea) ?? 0,
    antalRum: parsePositivtTal(form.antalRum) ?? 0,
    manadsavgift: Math.round(parsePositivtTal(form.manadsavgift) ?? 0),
    // Kompatibilitetsvärden: fälten visas inte längre i UI, men kontraktet
    // kräver dem fortfarande tills en separat kontraktsändring görs.
    andelstal: 0,
    orgnr: "",
    adress: form.adress.trim(),
    postnummer: form.postnummer.trim(),
    ort: form.ort.trim(),
    ...(vaning !== undefined ? { vaning } : {}),
    ...(byggar !== undefined ? { byggar } : {}),
    hiss: uppgifter.hiss,
    balkong: uppgifter.balkong,
    avgiftInkluderar: uppgifter.avgiftInkluderar,
    antalPersoner: uppgifter.antalPersoner,
  };
}
