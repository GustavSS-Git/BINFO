import type { PrisInput, Tristate } from "@/types/analysis";
import {
  parsePositivtTal,
  valideraAdress,
  valideraByggar,
  parseValfrittHeltal,
  parseVaning,
  valideraPostnummer,
  valideraValfrittUtgangspris,
  type AnalyseraFormFields,
} from "@/lib/analyseraForm";

/**
 * Ren logik för priskollen (steg 1 på /analysera): formulär → PrisInput.
 * Återanvänder talparsning och postnummerkontroll från analyseraForm.ts så att
 * priskollen och analysen aldrig tolkar samma inmatning olika. Ingen
 * React-import.
 *
 * Priskollen är en delmängd av analysformuläret: ingen PDF, och utgångspriset kan
 * lämnas tomt (utan det visas värderingen utan prisjämförelse). Adress och
 * byggår är obligatoriska i formuläret (2026-10-28), men inte i PrisInput. `tillVarderingForm` plockar ut den delmängden ur det
 * gemensamma formulärtillståndet.
 */

export interface VarderingFormFields {
  adress: string;
  utgangspris: string;
  boarea: string;
  antalRum: string;
  manadsavgift: string;
  postnummer: string;
  vaning: string;
  byggar: string;
}

export const TOM_VARDERING_FORM: VarderingFormFields = {
  adress: "",
  utgangspris: "",
  boarea: "",
  antalRum: "",
  manadsavgift: "",
  postnummer: "",
  vaning: "",
  byggar: "",
};

/** Priskollens fält ur det gemensamma analysformuläret (steg 1 av /analysera). */
export function tillVarderingForm(form: AnalyseraFormFields): VarderingFormFields {
  return {
    adress: form.adress,
    utgangspris: form.utgangspris,
    boarea: form.boarea,
    antalRum: form.antalRum,
    manadsavgift: form.manadsavgift,
    postnummer: form.postnummer,
    vaning: form.vaning,
    byggar: form.byggar,
  };
}

/** Ett fel per fält som kan vara fel. */
export interface VarderingFormFel {
  adress: string | null;
  byggar: string | null;
  utgangspris: string | null;
  boarea: string | null;
  antalRum: string | null;
  manadsavgift: string | null;
  postnummer: string | null;
  vaning: string | null;
}

/**
 * `utanAdress`: för ett återställt utkast (adressen följer inte med i utkastschemat, och
 * PrisInput bär den inte) — då kräver vi bara det värderingen behöver.
 */
export function validateraVarderingForm(
  f: VarderingFormFields,
  opts: { utanAdress?: boolean } = {},
): VarderingFormFel {
  return {
    adress: opts.utanAdress ? null : valideraAdress(f.adress),
    byggar: valideraByggar(f.byggar),
    // Kan lämnas tomt: se valideraValfrittUtgangspris.
    utgangspris: valideraValfrittUtgangspris(f.utgangspris),
    boarea: parsePositivtTal(f.boarea) === null ? "Ange en giltig boarea." : null,
    antalRum: parsePositivtTal(f.antalRum) === null ? "Ange antal rum." : null,
    manadsavgift: parsePositivtTal(f.manadsavgift) === null ? "Ange en giltig månadsavgift." : null,
    postnummer: valideraPostnummer(f.postnummer),
    vaning: parseVaning(f.vaning) === null ? "Ange våning." : null,
  };
}

export function harVarderingsfel(fel: VarderingFormFel): boolean {
  return Object.values(fel).some(Boolean);
}

/**
 * Bygger PrisInput. Förutsätter att formuläret validerats. `vaning`,
 * `byggar` och `utgangspris` utelämnas HELT när de saknas
 * (exactOptionalPropertyTypes, och servern kör ett strikt schema).
 */
export function buildPrisInput(
  form: VarderingFormFields,
  uppgifter: { hiss: Tristate; balkong: Tristate },
): PrisInput {
  const vaning = parseVaning(form.vaning) ?? undefined;
  const byggar = parseValfrittHeltal(form.byggar);
  const utgangspris = parsePositivtTal(form.utgangspris);

  return {
    boarea: parsePositivtTal(form.boarea) ?? 0,
    antalRum: parsePositivtTal(form.antalRum) ?? 0,
    manadsavgift: Math.round(parsePositivtTal(form.manadsavgift) ?? 0),
    postnummer: form.postnummer.trim(),
    ...(vaning !== undefined ? { vaning } : {}),
    ...(byggar !== undefined ? { byggar } : {}),
    hiss: uppgifter.hiss,
    balkong: uppgifter.balkong,
    ...(utgangspris !== null ? { utgangspris: Math.round(utgangspris) } : {}),
  };
}

/**
 * De fält /analysera kan förifyllas med via sökparametrar (äldre länkar från
 * den tidigare separata priskollsidan, och bolånekalkylen). Allt är text —
 * samma sak som användaren hade skrivit i formuläret — så ingen omräkning
 * sker på vägen.
 */
export interface AnalyseraPrefill {
  utgangspris?: string | undefined;
  boarea?: string | undefined;
  antalRum?: string | undefined;
  manadsavgift?: string | undefined;
  postnummer?: string | undefined;
  vaning?: string | undefined;
  byggar?: string | undefined;
}

/** Läser prefill ur router-sökparametrar (JSON-tolkade: "58" blir talet 58).
 *  Okänt eller skräp ignoreras. */
export function parseAnalyseraPrefill(search: Record<string, unknown>): AnalyseraPrefill {
  const lasText = (v: unknown): string | undefined => {
    if (typeof v === "number" && Number.isFinite(v)) return String(v).replace(".", ",");
    if (typeof v === "string" && v.trim() !== "") return v.trim().slice(0, 40);
    return undefined;
  };
  return {
    utgangspris: lasText(search["utgangspris"]),
    boarea: lasText(search["boarea"]),
    antalRum: lasText(search["antalRum"]),
    manadsavgift: lasText(search["manadsavgift"]),
    postnummer: lasText(search["postnummer"]),
    vaning: lasText(search["vaning"]),
    byggar: lasText(search["byggar"]),
  };
}
