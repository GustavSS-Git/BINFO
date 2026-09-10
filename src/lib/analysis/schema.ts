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

export const FigureSchema = z
  .object({
    value: z.number().nullable(),
    unit: FigureUnitSchema,
    source: ValueSourceSchema,
    ref: PageRefSchema.optional(),
    schablonBasis: z.string().optional(),
    range: z.object({ low: z.number(), high: z.number() }).strict().optional(),
  })
  .strict()
  .superRefine((figure, ctx) => {
    if (figure.source === "arsredovisning" && !figure.ref) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ref"],
        message:
          "En figur med source 'arsredovisning' måste ha en PageRef — en siffra utan citat kan inte visas.",
      });
    }
    if (figure.source === "schablon" && !figure.schablonBasis) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["schablonBasis"],
        message:
          "En figur med source 'schablon' måste ha schablonBasis — en gissning får aldrig se ut som ett faktum.",
      });
    }
  });

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
        kommandeAtgarder: z.array(z.string()).optional(),
        ref: PageRefSchema.optional(),
      })
      .strict()
      .optional(),
    vasentligaHandelser: z
      .array(z.object({ text: z.string(), ref: PageRefSchema }).strict())
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
    externVardering: FigureSchema.and(z.object({ leverantor: z.string() })).optional(),
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
