/**
 * The bolånekalkyl's complete input state, versioned. One schema serves three
 * consumers: the calculator page (`/bolanekalkyl`), a saved kalkyl in an
 * account (`sparad_kalkyl.input`) and both exports (PDF, Excel).
 *
 * Empty calculator fields are `undefined`, never 0: the page shows "—" for an
 * unknown value rather than computing with a guess (see VET_EJ in the route).
 *
 * Bump `KALKYL_UNDERLAG_VERSION` (and add a migration step in the parser) on
 * any breaking change: saved kalkyler are stored with their version.
 */
import { z } from "zod";
import { FeeInclusionSchema } from "@/lib/analysis/schema";

export const KALKYL_UNDERLAG_VERSION = 1 as const;

const Belopp = z.number().finite().nonnegative();
const Procent = z.number().finite().min(0).max(100);

/** Konsumentverket's age bands for children (Hushållskostnader 2026). */
export const BarnAlderSchema = z.enum(["0-3", "4-6", "7-10", "11-14", "15-17"]);
export type BarnAlder = z.infer<typeof BarnAlderSchema>;

/** The drift posts the user can override inline (the schablon rows). */
export const EgenKostnadIdSchema = z.enum([
  "hushallsel",
  "varme",
  "vatten",
  "bredband",
  "hemforsakring",
]);
export type EgenKostnadId = z.infer<typeof EgenKostnadIdSchema>;

export const KalkylUnderlagSchema = z
  .object({
    version: z.literal(KALKYL_UNDERLAG_VERSION),

    // Lån och bostad
    lanebelopp: Belopp.optional(),
    kontantinsats: Belopp.optional(),
    /** Borrower's own interest rate, percent per year (e.g. 3.6). */
    rantaProcent: Procent.optional(),
    manadsavgift: Belopp.optional(),
    boarea: z.number().finite().positive().optional(),
    avgiftInkluderar: FeeInclusionSchema,

    // Hushåll
    antalLantagare: z.union([z.literal(1), z.literal(2)]),
    /** Gross income per borrower per year, kr. inkomst2 is ignored when
     *  antalLantagare is 1 (kept so switching back restores it). */
    inkomst1: Belopp.optional(),
    inkomst2: Belopp.optional(),
    /** Persons in the household (drives the water schablon). */
    antalPersoner: z.number().int().min(1).max(20),
    /** Adults in the household for the KALP living costs. */
    antalVuxna: z.number().int().min(1).max(10),
    /** One entry per child, by Konsumentverket age band. */
    barn: z.array(BarnAlderSchema).max(10),

    // Scenarier
    /** Rate stress slider, percentage points added to rantaProcent (0–3). */
    rantestressPp: z.number().finite().min(0).max(3),
    /** The association's räntekänslighet (percent fee rise per pp), when the
     *  kalkyl came from an analysis; enables the fee stress. */
    rantekanslighetProcent: z.number().finite().positive().optional(),
    /** KALP stress rate, percent per year. An editable assumption, default 7. */
    kalkylrantaProcent: Procent,

    /** User overrides of the drift schablons, kr per month. */
    egnaKostnader: z.record(EgenKostnadIdSchema, Belopp).default({}),

    /** Where the numbers came from, for labels only (never for math). */
    kalla: z
      .object({
        pris: Belopp.optional(),
        prisArUppskattning: z.boolean().optional(),
        analysisId: z.string().uuid().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type KalkylUnderlag = z.infer<typeof KalkylUnderlagSchema>;

/** Key results for list views (profile) and file names. Null = not computable
 *  from the inputs given (e.g. no loan amount). */
export const KalkylSammanfattningSchema = z
  .object({
    /** Monthly total after ränteavdrag, lower bound ("vet ej" fee items
     *  assumed included in the avgift). */
    totalPerManad: z.number().finite().nullable(),
    /** Upper bound of the same total ("vet ej" items assumed not included).
     *  Optional: summaries saved before 2026-10-13 lack it. */
    totalPerManadHog: z.number().finite().nullable().optional(),
    belaningsgradProcent: z.number().finite().nullable(),
    amorteringstaktProcent: z.number().finite().nullable(),
    kvarAttLevaPaKalp: z.number().finite().nullable(),
  })
  .strict();

export type KalkylSammanfattning = z.infer<typeof KalkylSammanfattningSchema>;

/** Never throws: an unknown version or malformed object gives null, and the
 *  caller shows an empty calculator plus a notice. */
export function tolkaKalkylUnderlag(varde: unknown): KalkylUnderlag | null {
  const r = KalkylUnderlagSchema.safeParse(varde);
  return r.success ? r.data : null;
}
