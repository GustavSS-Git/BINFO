import { z } from "zod";
import type { KeyFigureId } from "@/types/analysis";

/**
 * Zod mirror of src/types/analysis.ts. Model output is untrusted input —
 * every shape the Anthropic API returns is parsed through here before
 * anything else touches it.
 *
 * Beyond structural mirroring, this file enforces the domain invariants
 * CLAUDE.md states as rules but the TypeScript interfaces can't express on
 * their own (a Figure's optionality is shared across very different
 * sources, so only a runtime check can require a citation on an extracted
 * figure without also demanding one on a computed one):
 *   - A Figure with source 'arsredovisning' must carry a PageRef.
 *   - A Figure with source 'schablon' must carry schablonBasis.
 *   - Extraction must produce all seven statutory key figures, no more,
 *     no fewer, each exactly once — even when a figure's value is null.
 *   - tillampadAmorteringstakt only accepts 0 | 1 | 2, never 3.
 *
 * Every object is `.strict()`: an unrecognized key is a sign the model
 * hallucinated a field, and that should fail loudly, not pass silently.
 */

export const TristateSchema = z.enum(["ja", "nej", "okant"]);

export const ValueSourceSchema = z.enum([
  "arsredovisning",
  "anvandare",
  "berakning",
  "schablon",
  "extern",
]);

export const PageRefSchema = z
  .object({
    page: z.number().int().positive(),
    excerpt: z.string().optional(),
  })
  .strict();

const FigureUnitSchema = z.enum([
  "kr",
  "kr/man",
  "kr/m2",
  "kr/m2/ar",
  "procent",
  "m2",
  "ar",
  "antal",
  "gånger",
]);

/**
 * Split into a plain object shape plus a standalone refinement, rather than
 * one `.strict().superRefine()` chain, so a variant with extra fields (see
 * `FigureMedLeverantorSchema` below) can be built with `.extend()` and still
 * carry the same invariants. `FigureSchema.and(z.object({ leverantor }))`
 * looked equivalent but silently wasn't: intersecting two `.strict()` sides
 * validates each side against the *merged* object, so the strict Figure side
 * rejects `leverantor` as unrecognized — which meant every Prisanalys with a
 * populated `externVardering` failed validation, blocking price
 * reconciliation entirely. `.extend()` on the shared base avoids that.
 */
const FigureObjectSchema = z
  .object({
    value: z.number().nullable(),
    unit: FigureUnitSchema,
    source: ValueSourceSchema,
    ref: PageRefSchema.optional(),
    schablonBasis: z.string().optional(),
    range: z.object({ low: z.number(), high: z.number() }).strict().optional(),
  })
  .strict();

function refineFigure(figure: z.infer<typeof FigureObjectSchema>, ctx: z.RefinementCtx): void {
  if (figure.source === "arsredovisning") {
    if (!figure.ref) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ref"],
        message:
          "En figur med source 'arsredovisning' måste ha en PageRef — en siffra utan citat kan inte visas.",
      });
    } else if (!figure.ref.excerpt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ref", "excerpt"],
        message:
          "En figur med source 'arsredovisning' måste ha ett excerpt — en sidhänvisning utan citat bevisar ingenting för köparen.",
      });
    }
  }
  if (figure.source === "schablon" && !figure.schablonBasis) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["schablonBasis"],
      message:
        "En figur med source 'schablon' måste ha schablonBasis — en gissning får aldrig se ut som ett faktum.",
    });
  }
}

export const FigureSchema = FigureObjectSchema.superRefine(refineFigure);

/** Figure plus `leverantor` — Prisanalys.externVardering's exact shape. Carries
 *  the same arsredovisning/schablon invariants as FigureSchema. */
export const FigureMedLeverantorSchema = FigureObjectSchema.extend({
  leverantor: z.string(),
})
  .strict()
  .superRefine(refineFigure);

export const StatusSchema = z.enum(["god", "acceptabel", "svag", "kritisk", "okant"]);
export const GradeSchema = z.enum(["A", "B", "C", "D", "E"]);
export const KonfidensSchema = z
  .object({
    niva: z.enum(["hog", "medel", "lag"]),
    skal: z.array(z.string()).optional(),
  })
  .strict();

export const PropertyKindSchema = z.enum(["bostadsratt", "hus"]);

export const FeeInclusionSchema = z
  .object({
    varme: TristateSchema,
    vatten: TristateSchema,
    el: TristateSchema,
    bredband: TristateSchema,
    tv: TristateSchema,
  })
  .strict();

export const PropertyInputSchema = z
  .object({
    kind: PropertyKindSchema,
    utgangspris: z.number(),
    boarea: z.number(),
    antalRum: z.number(),
    manadsavgift: z.number(),
    andelstal: z.number(),
    orgnr: z.string(),
    adress: z.string(),
    postnummer: z.string(),
    ort: z.string(),
    vaning: z.number().optional(),
    byggar: z.number().optional(),
    hiss: TristateSchema,
    balkong: TristateSchema,
    avgiftInkluderar: FeeInclusionSchema,
    antalPersoner: z.number(),
    antalLantagare: z.union([z.literal(1), z.literal(2)]),
  })
  .strict();

// ---------------------------------------------------------------------------
// The seven statutory key figures
// ---------------------------------------------------------------------------

const ALLA_NYCKELTAL_ID: [KeyFigureId, ...KeyFigureId[]] = [
  "arsavgift_per_m2_brf_yta",
  "arsavgift_andel_av_rorelseintakter",
  "skuldsattning_per_m2_totalyta",
  "skuldsattning_per_m2_brf_yta",
  "sparande_per_m2_totalyta",
  "rantekanslighet",
  "energikostnad_per_m2_totalyta",
];

export const KeyFigureIdSchema = z.enum(ALLA_NYCKELTAL_ID);

export const KeyFigureSchema = z
  .object({
    id: KeyFigureIdSchema,
    label: z.string(),
    figure: FigureSchema,
    status: StatusSchema,
    benchmark: z
      .object({ value: z.number(), label: z.string(), source: z.string() })
      .strict()
      .optional(),
    forklaring: z.string(),
  })
  .strict();

/** Exactly the seven statutory ids, each exactly once — per BFNAR 2023:1. */
const KeyFiguresArraySchema = z.array(KeyFigureSchema).superRefine((keyFigures, ctx) => {
  const sedda = new Set<string>();
  for (const kf of keyFigures) {
    if (sedda.has(kf.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Nyckeltalet '${kf.id}' förekommer mer än en gång.`,
      });
    }
    sedda.add(kf.id);
  }
  for (const kravdId of ALLA_NYCKELTAL_ID) {
    if (!sedda.has(kravdId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Nyckeltalet '${kravdId}' saknas — extraktionen måste producera alla sju (BFNAR 2023:1), även när värdet är null.`,
      });
    }
  }
});

export const ForeningSchema = z
  .object({
    namn: z.string(),
    orgnr: z.string(),
    akta: TristateSchema,
    byggar: FigureSchema.optional(),
    antalLagenheter: FigureSchema.optional(),
    totalyta: FigureSchema.optional(),
    rakenskapsar: z.number().int(),
    keyFigures: KeyFiguresArraySchema,
    avgiftInkluderarEnligtForening: FeeInclusionSchema.optional(),
    lanebok: z
      .object({
        totalSkuld: FigureSchema,
        forfalloprofil: z
          .array(
            z
              .object({ ar: z.number(), belopp: FigureSchema, ranta: FigureSchema.optional() })
              .strict(),
          )
          .optional(),
        snittranta: FigureSchema.optional(),
      })
      .strict()
      .optional(),
    underhallsplan: z
      .object({
        finns: TristateSchema,
        senastUppdaterad: z.number().optional(),
        kommandeAtgarder: z
          .array(z.object({ text: z.string(), ref: PageRefSchema.optional() }).strict())
          .optional(),
        ref: PageRefSchema.optional(),
      })
      .strict()
      .optional(),
    vasentligaHandelser: z
      .array(z.object({ text: z.string(), ref: PageRefSchema.optional() }).strict())
      .optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Analysis layers 2–4
// ---------------------------------------------------------------------------

export const SeveritySchema = z.enum(["hog", "medel", "lag"]);

export const RedFlagSchema = z
  .object({
    id: z.string(),
    titel: z.string(),
    beskrivning: z.string(),
    severity: SeveritySchema,
    ref: PageRefSchema.optional(),
    harledsFran: z.array(KeyFigureIdSchema),
  })
  .strict();

export const PrisanalysSchema = z
  .object({
    utgangspris: FigureSchema,
    prisPerM2: FigureSchema,
    externVardering: FigureMedLeverantorSchema.optional(),
    senasteForsaljningarIForeningen: z
      .array(
        z
          .object({
            datum: z.string(),
            pris: FigureSchema,
            boarea: z.number(),
            prisPerM2: FigureSchema,
          })
          .strict(),
      )
      .optional(),
    omradeMedianPrisPerM2: FigureSchema.optional(),
    avvikelseMotVardering: z.number().optional(),
    avvikelseMotForeningen: z.number().optional(),
    slutsats: z.string(),
    konfidens: KonfidensSchema,
  })
  .strict();

export const RantestressScenarioSchema = z
  .object({
    okningPe: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    nyManadsavgift: FigureSchema,
    avgiftsokningKrPerManad: FigureSchema,
    totalManadskostnad: FigureSchema.optional(),
  })
  .strict();

export const RantestressSchema = z
  .object({
    rantekanslighetProcent: z.number(),
    nuvarandeManadsavgift: FigureSchema,
    scenarier: z.array(RantestressScenarioSchema),
    kommentar: z.string(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Monthly cost model
// ---------------------------------------------------------------------------

export const CostItemIdSchema = z.enum([
  "rantekostnad",
  "amortering",
  "ranteavdrag",
  "manadsavgift",
  "hushallsel",
  "varme",
  "vatten",
  "bredband",
  "hemforsakring",
]);

export const CostItemSchema = z
  .object({
    id: CostItemIdSchema,
    label: z.string(),
    figure: FigureSchema,
    overriddenByUser: z.boolean(),
    ingarIAvgift: z.boolean(),
  })
  .strict();

/** LTV-only, since 1 April 2026 — the skuldkvot-based extra 1% is abolished. */
export const AmorteringsunderlagSchema = z
  .object({
    belaningsgrad: z.number(),
    skuldkvot: z.number(),
    tillampadAmorteringstakt: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    overBankernasTypiskaTak: z.boolean(),
  })
  .strict();

export const ManadskostnadSchema = z
  .object({
    poster: z.array(CostItemSchema),
    totalBrutto: FigureSchema,
    totalNetto: FigureSchema,
    totalSpann: z.object({ low: z.number(), high: z.number() }).strict().optional(),
    amortering: AmorteringsunderlagSchema,
    ranteavdragPerAr: FigureSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// Layer 4 — action
// ---------------------------------------------------------------------------

export const FragaSchema = z
  .object({
    id: z.string(),
    fraga: z.string(),
    ursprung: z.enum(["analys", "saknad_uppgift"]),
    riktadTill: z.enum(["styrelsen", "maklaren", "banken"]),
    varfor: z.string(),
    ref: PageRefSchema.optional(),
  })
  .strict();

export const DatakvalitetSchema = z
  .object({
    uppgifterKanda: z.number(),
    uppgifterTotalt: z.number(),
    saknadeFalt: z.array(z.string()),
    pdfSaknarTextlager: z.boolean(),
    extraktionKonfidens: KonfidensSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export const AnalysisResultSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    analysisId: z.string(),
    skapad: z.string(),

    input: PropertyInputSchema,
    forening: ForeningSchema,

    betyg: GradeSchema,
    betygMotivering: z.string(),

    rodaFlaggor: z.array(RedFlagSchema),
    prisanalys: PrisanalysSchema,
    rantestress: RantestressSchema,
    manadskostnad: ManadskostnadSchema,
    fragor: z.array(FragaSchema),

    datakvalitet: DatakvalitetSchema,

    gratisSektioner: z.array(z.enum(["betyg", "rodaFlaggor_topp2", "datakvalitet"])),
  })
  .strict();

export const ExtractionResultSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    forening: ForeningSchema,
    datakvalitet: z
      .object({
        pdfSaknarTextlager: z.boolean(),
        extraktionKonfidens: KonfidensSchema,
        saknadeFalt: z.array(z.string()),
      })
      .strict(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Pass 2 — the judgement layer
//
// A strict subset of AnalysisResult: betyg + betygMotivering, rodaFlaggor and
// the 'analys' half of fragor. Not a contract change — every field below is
// already in src/types/analysis.ts, this only tightens what the model is
// allowed to return for them:
//   - harledsFran must be non-empty and may only name real KeyFigureIds, so
//     the UI can always link a flag back to its evidence.
//   - fragor produced here are always ursprung 'analys'; the
//     'saknad_uppgift' kind is generated deterministically elsewhere.
//   - ids unique, prose fields non-empty — an untitled flag or an
//     unmotivated grade is not reviewable, and empty strings are exactly
//     what a model emits when it has nothing to say.
// ---------------------------------------------------------------------------

const ickeTomText = (falt: string) => z.string().min(1, `${falt} får inte vara en tom sträng.`);

export const AnalysRedFlagSchema = RedFlagSchema.extend({
  id: ickeTomText("id"),
  titel: ickeTomText("titel"),
  beskrivning: ickeTomText("beskrivning"),
  harledsFran: z
    .array(KeyFigureIdSchema)
    .min(
      1,
      "harledsFran måste peka ut minst ett nyckeltal — en flagga utan spårbart underlag kan inte visas.",
    ),
});

export const AnalysFragaSchema = FragaSchema.extend({
  id: ickeTomText("id"),
  fraga: ickeTomText("fraga"),
  ursprung: z.literal("analys"),
  varfor: ickeTomText("varfor"),
});

function kravUnikaIdn(poster: Array<{ id: string }>, ctx: z.RefinementCtx, vad: string): void {
  const sedda = new Set<string>();
  poster.forEach((post, i) => {
    if (sedda.has(post.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [i, "id"],
        message: `${vad} '${post.id}' förekommer mer än en gång.`,
      });
    }
    sedda.add(post.id);
  });
}

export const AnalysJudgementSchema = z
  .object({
    betyg: GradeSchema,
    betygMotivering: ickeTomText("betygMotivering"),
    rodaFlaggor: z
      .array(AnalysRedFlagSchema)
      .superRefine((flaggor, ctx) => kravUnikaIdn(flaggor, ctx, "Flagg-id")),
    fragor: z
      .array(AnalysFragaSchema)
      .superRefine((fragor, ctx) => kravUnikaIdn(fragor, ctx, "Fråge-id")),
  })
  .strict();

/**
 * The judgement schema bound to the page numbers that actually occur in the
 * extraction it was produced from. A `ref` is the buyer's "show me where" —
 * a page number the model made up is worse than none at all, so an unknown
 * page fails validation (and therefore gets the one retry) rather than being
 * silently dropped.
 *
 * An extraction with no refs at all yields an empty set, which correctly
 * means "no ref may be cited" rather than "any ref is fine".
 */
export function buildAnalysJudgementSchema(tillatnaSidor: ReadonlySet<number>) {
  return AnalysJudgementSchema.superRefine((omdome, ctx) => {
    const kontrollera = (ref: { page: number } | undefined, path: Array<string | number>) => {
      if (ref && !tillatnaSidor.has(ref.page)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...path, "ref", "page"],
          message: `Sidan ${ref.page} finns inte i underlaget — endast sidnummer som förekommer i extraktionen får användas.`,
        });
      }
    };
    omdome.rodaFlaggor.forEach((flagga, i) => kontrollera(flagga.ref, ["rodaFlaggor", i]));
    omdome.fragor.forEach((fraga, i) => kontrollera(fraga.ref, ["fragor", i]));
  });
}
