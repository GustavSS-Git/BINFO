/**
 * The bolånekalkyl's complete input state, versioned. One schema serves three
 * consumers: the calculator page (`/bolanekalkyl`), a saved kalkyl in an
 * account (`sparad_kalkyl.input`) and both exports (PDF, Excel).
 *
 * Empty calculator fields are `undefined`, never 0: the page shows "—" for an
 * unknown value rather than computing with a guess .
 *
 * Bump `KALKYL_UNDERLAG_VERSION` (and add a migration step in the parser) on
 * any breaking change: saved kalkyler are stored with their version.
 */
import { z } from "zod";
import { FeeInclusionSchema } from "@/lib/analysis/schema";
import type { FeeInclusion } from "@/types/analysis";

/**
 * Version 2 (redesign v4, 2026-10-28): `pris` replaces `lanebelopp` (lån =
 * pris − kontantinsats) and `avgiftInkluderar` has two states (ja/nej)
 * instead of three. Version-1 rows (saved kalkyler, 24 h drafts) are migrated
 * by `tolkaKalkylUnderlag`.
 */
export const KALKYL_UNDERLAG_VERSION = 2 as const;

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

/** "Ingår i avgiften" in the kalkyl: two states. The analysis contract keeps
 *  the three-state `FeeInclusion` ("okänt"); the kalkyl maps "okant" to "nej"
 *  at its boundaries (the cost is counted), see `tillKalkylAvgift`. */
export const AvgiftPostSchema = z.enum(["ja", "nej"]);
export type AvgiftPost = z.infer<typeof AvgiftPostSchema>;

export const AVGIFT_POSTER = ["varme", "vatten", "el", "bredband", "tv"] as const;
export type AvgiftPostId = (typeof AVGIFT_POSTER)[number];

export const KalkylAvgiftSchema = z
  .object({
    varme: AvgiftPostSchema,
    vatten: AvgiftPostSchema,
    el: AvgiftPostSchema,
    bredband: AvgiftPostSchema,
    tv: AvgiftPostSchema,
  })
  .strict();
export type KalkylAvgiftInkluderar = z.infer<typeof KalkylAvgiftSchema>;

/** Defaults in the kalkyl: värme and vatten normally ingår in a bostadsrätt's
 *  avgift; el, bredband and tv are paid by the household. */
export const AVGIFT_FORVAL: KalkylAvgiftInkluderar = {
  varme: "ja",
  vatten: "ja",
  el: "nej",
  bredband: "nej",
  tv: "nej",
};

/** Three-state value -> two states. "okant" counts the cost ("nej"). */
export function tillKalkylAvgift(fee: FeeInclusion): KalkylAvgiftInkluderar {
  const ett = (v: FeeInclusion[AvgiftPostId]): AvgiftPost => (v === "ja" ? "ja" : "nej");
  return {
    varme: ett(fee.varme),
    vatten: ett(fee.vatten),
    el: ett(fee.el),
    bredband: ett(fee.bredband),
    tv: ett(fee.tv),
  };
}

/** Fields identical in version 1 and 2 (everything except the price/loan and
 *  the fee-inclusion states). */
const GEMENSAMMA_FALT = {
  kontantinsats: Belopp.optional(),
  /** Borrower's own interest rate, percent per year (e.g. 3.6). */
  rantaProcent: Procent.optional(),
  manadsavgift: Belopp.optional(),
  boarea: z.number().finite().positive().optional(),

  // Hushåll
  antalLantagare: z.union([z.literal(1), z.literal(2)]),
  /** Gross income per borrower per year, kr. inkomst2 is ignored when
   *  antalLantagare is 1 (kept so switching back restores it). */
  inkomst1: Belopp.optional(),
  inkomst2: Belopp.optional(),
  /** Persons in the household (drives the el, vatten and försäkring schablons). */
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
};

export const KalkylUnderlagSchema = z
  .object({
    version: z.literal(KALKYL_UNDERLAG_VERSION),
    /** Priset du räknar med, kr. Lån = max(0, pris − kontantinsats); the
     *  home's value (for belåningsgrad) is the price. */
    pris: Belopp.optional(),
    ...GEMENSAMMA_FALT,
    avgiftInkluderar: KalkylAvgiftSchema,
  })
  .strict();

export type KalkylUnderlag = z.infer<typeof KalkylUnderlagSchema>;

/** The stored version-1 shape (read only, for migration). */
const KalkylUnderlagV1Schema = z
  .object({
    version: z.literal(1),
    lanebelopp: Belopp.optional(),
    ...GEMENSAMMA_FALT,
    avgiftInkluderar: FeeInclusionSchema,
  })
  .strict();

/** Key results for list views (profile) and file names. Null = not computable
 *  from the inputs given (e.g. no loan amount). */
export const KalkylSammanfattningSchema = z
  .object({
    /** Monthly total after ränteavdrag. */
    totalPerManad: z.number().finite().nullable(),
    /** Legacy: upper bound from the removed "Vet ej" state. No longer written
     *  (2026-10-28); kept optional so older saved summaries still parse and
     *  /konto can show them. */
    totalPerManadHog: z.number().finite().nullable().optional(),
    belaningsgradProcent: z.number().finite().nullable(),
    amorteringstaktProcent: z.number().finite().nullable(),
    kvarAttLevaPaKalp: z.number().finite().nullable(),
  })
  .strict();

export type KalkylSammanfattning = z.infer<typeof KalkylSammanfattningSchema>;

/**
 * Version 1 -> 2:
 * - `pris` = lanebelopp + kontantinsats when both exist (same loan, same
 *   belåningsgrad as before).
 * - Only lanebelopp (no kontantinsats): the price cannot be derived, so `pris`
 *   stays empty and `lanebelopp` is dropped. Setting pris = lanebelopp would
 *   show the loan as the price. The owner of the kalkyl re-enters the price;
 *   everything else is kept. Only kontantinsats: kept, pris empty.
 * - `avgiftInkluderar`: "okant" ("Vet ej") becomes "nej" (the cost is counted).
 * - All other fields map 1:1.
 */
function migreraV1(v1: z.infer<typeof KalkylUnderlagV1Schema>): unknown {
  const { lanebelopp, version: _version, avgiftInkluderar, ...rest } = v1;
  const pris =
    lanebelopp !== undefined && v1.kontantinsats !== undefined
      ? lanebelopp + v1.kontantinsats
      : undefined;
  return {
    ...rest,
    version: KALKYL_UNDERLAG_VERSION,
    ...(pris !== undefined ? { pris } : {}),
    avgiftInkluderar: tillKalkylAvgift(avgiftInkluderar),
  };
}

/** Never throws: an unknown version or malformed object gives null, and the
 *  caller shows an empty calculator plus a notice. Version-1 input is migrated. */
export function tolkaKalkylUnderlag(varde: unknown): KalkylUnderlag | null {
  const v1 = KalkylUnderlagV1Schema.safeParse(varde);
  const r = KalkylUnderlagSchema.safeParse(v1.success ? migreraV1(v1.data) : varde);
  return r.success ? r.data : null;
}

/** Zod-schema som läser både version 2 och migrerade version 1 (24 h-utkast i
 *  webbläsaren, sparade rader). Ogiltigt underlag ger ett Zod-fel. */
export const KalkylUnderlagInSchema = z.unknown().transform((varde, ctx): KalkylUnderlag => {
  const u = tolkaKalkylUnderlag(varde);
  if (u === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Ogiltigt kalkylunderlag" });
    return z.NEVER;
  }
  return u;
});
