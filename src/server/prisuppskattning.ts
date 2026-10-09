/**
 * `price_estimate`-tjänsten (PLAN-v2 §2): den fristående priskollen — Binfos
 * värdering av en lägenhet ur formulärets uppgifter, utan årsredovisning och
 * utan föreningsdata. Tillståndslös: ingenting sparas.
 *
 * Värderingsfälten räknas fram av den DELADE kärnan
 * `byggPrisanalysUtanForening` (src/lib/analysis/assemble.ts) — exakt samma
 * funktion som den fullständiga analysens `byggPrisanalys` anropar. Den
 * fristående priskollen och den fullständiga analysen kan därför aldrig ge
 * olika värdering för samma lägenhet.
 *
 * `hamtaPrisuppskattningFn` i analysFn.ts är en tunn bindning till
 * `hamtaPrisuppskattning` nedan.
 */

import type { z } from "zod";
import type { PrisInput, PrisuppskattningResultat } from "@/types/analysis";
import { byggPrisanalysUtanForening } from "@/lib/analysis/assemble";
import { ModellPrisdatakalla, type Prisdatakalla } from "@/lib/analysis/prisdata";
import { PrisInputSchema, PrisuppskattningResultatSchema } from "@/lib/analysis/schema";
import { normaliseraPostnummer } from "@/lib/vardering";
import { SaknarBehorighetError } from "./behorighet";
import { tolkaFel, tolkaKvot } from "./fel";
import { kontrolleraPrisuppskattningskvot } from "./kvot";
import type { Anropare } from "./portar";

export class PrisuppskattningValidationError extends Error {
  constructor(
    public readonly zodError: z.ZodError,
    public readonly raw: unknown,
  ) {
    const issues = zodError.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    super(
      `Prisuppskattningen misslyckades schemavalidering — det är en bugg i monteringen, ` +
        `inte ett indatafel: ${issues}`,
    );
    this.name = "PrisuppskattningValidationError";
  }
}

export interface PrisuppskattningOptions {
  /** The requester (analysFn.ts always sets it): entitlement
   *  `prisuppskattning` and the 60/hour quota are checked before any work.
   *  Omitted only by tests of the valuation itself. */
  anropare?: Anropare;
  /** Standard: ModellPrisdatakalla (Binfos egen värderingsmodell), samma
   *  källa som den fullständiga analysen använder i produktion. */
  prisdatakalla?: Prisdatakalla;
  /** Injiceras för deterministiska tester; standard: nu. */
  nu?: Date;
}

/**
 * Värderar en lägenhet ur PrisInput. Ett tomt eller felformaterat postnummer
 * ger ett resultat utan externVardering, med konfidens 'lag' och en slutsats
 * som förklarar varför — samma beteende som den fullständiga analysen.
 * Resultatet valideras mot PrisuppskattningResultatSchema innan det lämnas
 * ut; ett ogiltigt resultat kastar (en bugg, aldrig ett tyst tomt svar).
 */
export async function prisuppskattning(
  input: PrisInput,
  opts: PrisuppskattningOptions = {},
): Promise<PrisuppskattningResultat> {
  const prisdatakalla = opts.prisdatakalla ?? new ModellPrisdatakalla();
  const prisanalys = await byggPrisanalysUtanForening(input, prisdatakalla);

  const resultat: PrisuppskattningResultat = {
    schemaVersion: "1.0.0",
    skapad: (opts.nu ?? new Date()).toISOString(),
    input,
    prisanalys,
  };

  const parsed = PrisuppskattningResultatSchema.safeParse(resultat);
  if (!parsed.success) {
    throw new PrisuppskattningValidationError(parsed.error, resultat);
  }
  return resultat;
}

export type HamtaPrisuppskattningSvar =
  | { ok: true; resultat: PrisuppskattningResultat }
  | { ok: false; errorCode: "validation" | "kvot" | "behorighet"; errorMessage: string };

/** Köparsäkra felmeddelanden — visas ordagrant i /vardering. */
const FELMEDDELANDE_OGILTIGT_POSTNUMMER = "Postnumret måste bestå av fem siffror, t.ex. 118 57.";
const FELMEDDELANDE_OGILTIGA_UPPGIFTER =
  "Några av uppgifterna saknas eller är ogiltiga. Kontrollera boarea, antal rum, månadsavgift " +
  "och utgångspris och försök igen.";

/**
 * Serverfunktionens implementation (`hamtaPrisuppskattningFn` i analysFn.ts):
 * validerar okänd indata mot PrisInputSchema och kör `prisuppskattning`.
 *
 * Utöver kontraktsschemat (som tar vilken sträng som helst som postnummer,
 * eftersom den fullständiga analysen måste klara en anonymiserad rapport)
 * kräver den fristående priskollen ett välformat femsiffrigt postnummer:
 * utan det finns inget att värdera, och köparen ska få veta det direkt i
 * formuläret i stället för ett tomt resultat. Samma normalisering som
 * värderingsmodellen (blanksteg tas bort).
 *
 * Med `opts.anropare`: behörigheten `prisuppskattning` och sedan kvoten (60
 * per IP och timme, se kvot.ts) kontrolleras FÖRE allt annat — även en
 * ogiltig förfrågan räknas, så att kvoten inte går att kringgå med skräpdata.
 */
export async function hamtaPrisuppskattning(
  data: unknown,
  opts: PrisuppskattningOptions = {},
): Promise<HamtaPrisuppskattningSvar> {
  const { anropare } = opts;
  if (anropare) {
    try {
      await anropare.behorighet.kravBehorighet(anropare.kontext, "prisuppskattning");
    } catch (fel) {
      if (!(fel instanceof SaknarBehorighetError)) throw fel;
      return { ok: false, errorCode: "behorighet", errorMessage: tolkaFel(fel).message };
    }
    const kvot = await kontrolleraPrisuppskattningskvot(anropare.konto, anropare.kontext);
    if (!kvot.ok) return { ok: false, errorCode: "kvot", errorMessage: tolkaKvot(kvot).message };
  }

  const parsed = PrisInputSchema.safeParse(data);
  if (!parsed.success) {
    const postnummerFel = parsed.error.issues.some((i) => i.path[0] === "postnummer");
    return {
      ok: false,
      errorCode: "validation",
      errorMessage: postnummerFel
        ? FELMEDDELANDE_OGILTIGT_POSTNUMMER
        : FELMEDDELANDE_OGILTIGA_UPPGIFTER,
    };
  }
  if (!/^\d{5}$/.test(normaliseraPostnummer(parsed.data.postnummer))) {
    return { ok: false, errorCode: "validation", errorMessage: FELMEDDELANDE_OGILTIGT_POSTNUMMER };
  }

  // exactOptionalPropertyTypes: Zod v3:s utdata typar optionella fält som
  // `T | undefined`; bygg PrisInput utan undefined-nycklar.
  const d = parsed.data;
  const input: PrisInput = {
    boarea: d.boarea,
    antalRum: d.antalRum,
    manadsavgift: d.manadsavgift,
    postnummer: d.postnummer,
    ...(d.vaning !== undefined ? { vaning: d.vaning } : {}),
    ...(d.byggar !== undefined ? { byggar: d.byggar } : {}),
    hiss: d.hiss,
    balkong: d.balkong,
    ...(d.utgangspris !== undefined ? { utgangspris: d.utgangspris } : {}),
  };
  return { ok: true, resultat: await prisuppskattning(input, opts) };
}
