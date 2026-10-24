/**
 * Miljövariabler för server-zonen (`src/server/`).
 *
 * Den här modulen körs i tre olika miljöer:
 *   1. Node/tsx på den här maskinen (CLI:er).
 *   2. En TanStack Start-serverfunktion, byggd av Vite för Cloudflare Workers.
 *   3. En Deno-baserad Supabase Edge Function.
 *
 * Bara miljö (1) har `process.loadEnvFile`; (2) och (3) har varken `process`
 * eller den funktionen. Därför är modulen delad i två halvor:
 *
 * - `lasEnv` är ren validering av ett redan inläst key-value-record (ett
 *   almänt `Record<string, string | undefined>`) — inga sidoeffekter, inga
 *   Node-specifika API:er. Den fungerar identiskt oavsett körtid: Node kan
 *   skicka in `process.env`, Deno kan skicka in `Deno.env.toObject()`.
 * - `envFromProcess` är Node-specifik bekvämlighet: den försöker läsa
 *   `.env.local` via `process.loadEnvFile` (som bara finns i Node) och
 *   anropar sedan `lasEnv(process.env)`. Den framtida Edge Function-koden
 *   anropar aldrig den här funktionen — den anropar `lasEnv` direkt.
 */

import { z } from "zod";
import { STANDARD_MODELL } from "@/lib/analysis/costGuard";

/** Sonnet 5's `output_config.effort` values — see runExtraction.ts's
 *  `ModelEffort` (this module can't import from `src/lib/analysis/` without
 *  creating a server↔lib dependency edge the Edge Function's inline env
 *  reader would also need to mirror; a plain, independently-defined string
 *  union of the exact same five values is a smaller price than that). */
export type ModelEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface Env {
  supabaseUrl: string;
  supabaseSecretKey: string;
  supabasePublishableKey?: string;
  maxDailySpendSek: number;
  killSwitchPa: boolean;
  anthropicApiKey: string;
  anthropicModel: string;
  maxCostPerAnalysisSek: number;
  /**
   * Per-stage reasoning-depth (task 1.2's speed work) — always set, never
   * `undefined`. Defaults to "medium" for all three stages (see the
   * `ANTHROPIC_EFFORT_*` env vars below): measured at 100% on the full
   * verify-extraction regression set (both verified and draft fixtures)
   * with real latency/cost wins over Sonnet 5's default adaptive thinking —
   * a supervisor decision to make that the shipped default rather than an
   * opt-in the deploy owner has to remember to set. The env vars remain
   * pure overrides: set one to deliberately try a different depth (or to
   * fall back toward "high"/adaptive-like behaviour by setting it there
   * explicitly — there is no "unset" escape hatch once a var is present,
   * see `lasEnv`). Grounding and extraction each get their own variable
   * because they're independently-effort-tunable calls (see
   * runGrounding/runStructuredExtraction in runExtraction.ts); judging is
   * separate again since its quality (flags/questions) can't be scored
   * automatically and may warrant a different setting later.
   */
  effortGrounding: ModelEffort;
  effortExtraction: ModelEffort;
  effortJudging: ModelEffort;
  /**
   * Kill switch for "Hämta uppgifter" (src/server/annons/hamta.ts): `true`
   * only when `ANNONS_HAMTNING=off`. Unset/anything else = fetching is on.
   * Optional so existing Env literals (tests, the Edge Function's own reader)
   * stay valid; `undefined` = on.
   */
  annonsHamtningAvstangd?: boolean;
  /**
   * Optional model fallback for listing pages the structured parser can't
   * read: `true` only when `ANNONS_LLM_FALLBACK=on`. Default off (spends API
   * money, Haiku 4.5, a few öre per page).
   */
  annonsLlmFallback?: boolean;
}

/** Shipped default for all three `ANTHROPIC_EFFORT_*` env vars — see
 *  `Env.effortGrounding`'s doc comment. Exported so the local dev CLIs
 *  (cli.ts, verifyAnswerKey.ts — never bundled for the client, so importing
 *  from `src/server/` here is safe) default to the exact same "medium"
 *  Sonnet 5 uses in production, instead of silently reverting to adaptive
 *  thinking the moment nobody sets an `ANTHROPIC_EFFORT*` var by hand. */
export const STANDARD_EFFORT: ModelEffort = "medium";

/**
 * Kastas när en nyckel med `VITE_`-prefix hittas bland miljövariablerna som
 * skickas in i den här — server-only — modulen. Vite injicerar allt som
 * börjar på `VITE_` i klientbunten; en hemlighet under det prefixet skulle
 * läcka till webbläsaren. Kollar ALLA nycklar i input-recordet, inte bara de
 * den här modulen känner till, eftersom en felstavad eller okänd
 * `VITE_`-nyckel är precis lika farlig.
 */
export class OsakerMiljoNyckelError extends Error {
  constructor(public readonly nycklar: string[]) {
    super(
      `Miljövariabler med VITE_-prefix hittades där de aldrig får finnas ` +
        `(server-only): ${nycklar.join(", ")}. Vite injicerar VITE_-prefixade ` +
        `variabler i klientbunten — en hemlighet under det namnet skulle ` +
        `exponeras i webbläsaren. Döp om variabeln eller ta bort den ur denna miljö.`,
    );
    this.name = "OsakerMiljoNyckelError";
  }
}

/** Kastas när en enskild miljövariabel saknas eller har ett ogiltigt värde. */
export class OgiltigMiljoError extends Error {
  constructor(
    public readonly variabel: string,
    anledning: string,
  ) {
    super(`Miljövariabeln ${variabel} är ogiltig: ${anledning}`);
    this.name = "OgiltigMiljoError";
  }
}

const PositivtTalSchema = z
  .string()
  .min(1, "saknas")
  .transform((varde, ctx) => {
    const tal = Number(varde);
    if (!Number.isFinite(tal) || tal <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "måste vara ett positivt tal, fick " + JSON.stringify(varde),
      });
      return z.NEVER;
    }
    return tal;
  });

// Inte .strict(): input-recordet är ofta hela process.env (eller
// Deno.env.toObject()), som innehåller massor av variabler den här modulen
// inte bryr sig om. VITE_-vakten nedan täcker den enda sortens okänd nyckel
// som är farlig; allt annat okänt ignoreras och plockas bort av Zod som vanligt.
//
// Namnen är PROJECT_* och inte SUPABASE_*: både Lovables och Supabases egna
// hemlighetslager reserverar SUPABASE_-prefixet (Lovable vägrar spara en
// hemlighet med det prefixet; `supabase secrets set` vägrar det av samma
// skäl). Edge Function-koden (`supabase/functions/analys-steg/index.ts`)
// läser redan samma PROJECT_*-namn — ett enda namnschema fungerar då i alla
// tre körtider.
const EffortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]).optional();

const RawEnvSchema = z.object({
  PROJECT_URL: z.string().min(1, "saknas").url("måste vara en giltig URL"),
  PROJECT_SECRET_KEY: z.string().min(1, "saknas"),
  PROJECT_PUBLISHABLE_KEY: z.string().min(1, "saknas").optional(),
  MAX_DAILY_SPEND_SEK: PositivtTalSchema,
  ANALYSIS_KILL_SWITCH: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().min(1, "saknas"),
  ANTHROPIC_MODEL: z.string().min(1, "saknas").optional(),
  MAX_COST_PER_ANALYSIS_SEK: PositivtTalSchema.optional(),
  ANTHROPIC_EFFORT_GROUNDING: EffortSchema,
  ANTHROPIC_EFFORT_EXTRACTION: EffortSchema,
  ANTHROPIC_EFFORT_JUDGING: EffortSchema,
  // Listing fetch flags: `off` / `on`, any other value (or unset) = default.
  ANNONS_HAMTNING: z.string().optional(),
  ANNONS_LLM_FALLBACK: z.string().optional(),
});

/**
 * Ren validering av ett redan inläst key-value-record till ett `Env`.
 * Inga sidoeffekter, inga Node-specifika API:er — fungerar identiskt under
 * Node, Vite/Workers och Deno.
 */
export function lasEnv(record: Record<string, string | undefined>): Env {
  const viteNycklar = Object.keys(record).filter((key) => key.startsWith("VITE_"));
  if (viteNycklar.length > 0) {
    throw new OsakerMiljoNyckelError(viteNycklar);
  }

  const parsed = RawEnvSchema.safeParse(record);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const variabel =
      issue === undefined ? "okänd variabel" : String(issue.path[0] ?? "okänd variabel");
    const anledning = issue === undefined ? "okänt valideringsfel" : issue.message;
    throw new OgiltigMiljoError(variabel, anledning);
  }

  const data = parsed.data;

  const env: Env = {
    supabaseUrl: data.PROJECT_URL,
    supabaseSecretKey: data.PROJECT_SECRET_KEY,
    maxDailySpendSek: data.MAX_DAILY_SPEND_SEK,
    killSwitchPa: data.ANALYSIS_KILL_SWITCH === "on",
    anthropicApiKey: data.ANTHROPIC_API_KEY,
    anthropicModel: data.ANTHROPIC_MODEL ?? STANDARD_MODELL,
    maxCostPerAnalysisSek: data.MAX_COST_PER_ANALYSIS_SEK ?? 5,
    // Alltid satta (never undefined) — se STANDARD_EFFORT/Env.effortGrounding.
    effortGrounding: data.ANTHROPIC_EFFORT_GROUNDING ?? STANDARD_EFFORT,
    effortExtraction: data.ANTHROPIC_EFFORT_EXTRACTION ?? STANDARD_EFFORT,
    effortJudging: data.ANTHROPIC_EFFORT_JUDGING ?? STANDARD_EFFORT,
    annonsHamtningAvstangd: data.ANNONS_HAMTNING?.trim().toLowerCase() === "off",
    annonsLlmFallback: data.ANNONS_LLM_FALLBACK?.trim().toLowerCase() === "on",
  };
  // exactOptionalPropertyTypes: tilldela fältet bara när det faktiskt finns,
  // aldrig `undefined` explicit — annars är "fältet är frånvarande" och
  // "fältet är satt till undefined" inte samma sak för typsystemet.
  if (data.PROJECT_PUBLISHABLE_KEY !== undefined) {
    env.supabasePublishableKey = data.PROJECT_PUBLISHABLE_KEY;
  }
  return env;
}

/**
 * Node-specifik bekvämlighet: läser `.env.local` om `process.loadEnvFile`
 * finns (bara i Node), och validerar sedan `process.env` via `lasEnv`.
 * Måste inte krascha när `process`/`process.loadEnvFile` inte finns (Deno) —
 * i praktiken anropar ingen kod den här funktionen där; Edge Function-koden
 * anropar `lasEnv(Deno.env.toObject())` direkt istället.
 */
export function envFromProcess(): Env {
  if (typeof process !== "undefined" && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(".env.local");
    } catch {
      // Ingen .env.local — fine om variablerna redan är exporterade i skalet.
    }
  }
  return lasEnv(typeof process !== "undefined" ? process.env : {});
}
