import type { PrisInput, Tristate } from "@/types/analysis";
import {
  parsePositivtTal,
  parseValfrittHeltal,
  parseVaning,
  valideraPostnummer,
} from "@/lib/analyseraForm";

/**
 * Ren logik för /vardering ("Bara priskoll"): formulär → PrisInput. Återanvänder
 * talparsning och postnummerkontroll från analyseraForm.ts så att de två
 * formulären aldrig tolkar samma inmatning olika. Ingen React-import.
 *
 * Skillnader mot /analysera: ingen PDF, ingen adress/ort, och utgångspriset är
 * VALFRITT (utan det visas värderingen utan prisjämförelse).
 */

export interface VarderingFormFields {
  utgangspris: string;
  boarea: string;
  antalRum: string;
  manadsavgift: string;
  postnummer: string;
  vaning: string;
  byggar: string;
}

export const TOM_VARDERING_FORM: VarderingFormFields = {
  utgangspris: "",
  boarea: "",
  antalRum: "",
  manadsavgift: "",
  postnummer: "",
  vaning: "",
  byggar: "",
};

/** Ett fel per fält som kan vara fel. `byggar` är valfritt och ingår inte. */
export interface VarderingFormFel {
  utgangspris: string | null;
  boarea: string | null;
  antalRum: string | null;
  manadsavgift: string | null;
  postnummer: string | null;
  vaning: string | null;
}

export function validateraVarderingForm(f: VarderingFormFields): VarderingFormFel {
  return {
    // Valfritt: tomt är OK, men text som inte går att tolka får inte tyst
    // släppas igenom som "inget utgångspris" — då skulle köparen tro att
    // jämförelsen gjorts mot det hen skrev.
    utgangspris:
      f.utgangspris.trim() === "" || parsePositivtTal(f.utgangspris) !== null
        ? null
        : "Ange ett giltigt utgångspris eller lämna fältet tomt.",
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
 * De fält /analysera kan förifyllas med via sökparametrar när köparen går
 * vidare från priskollen. Allt är text — samma sak som användaren hade
 * skrivit i formuläret — så ingen omräkning sker på vägen.
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

/** Bara ifyllda fält tas med; tomma utelämnas så URL:en blir ren. */
export function tillAnalyseraPrefill(form: VarderingFormFields): AnalyseraPrefill {
  const ut: AnalyseraPrefill = {};
  for (const nyckel of Object.keys(TOM_VARDERING_FORM) as Array<keyof VarderingFormFields>) {
    const varde = form[nyckel].trim();
    if (varde !== "") ut[nyckel] = varde;
  }
  return ut;
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
