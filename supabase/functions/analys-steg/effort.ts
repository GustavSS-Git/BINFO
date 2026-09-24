/**
 * Pure, Deno-independent half of the Edge Function's per-stage effort
 * reading (see `lasEffortInline` in `index.ts`) — split into its own file
 * SPECIFICALLY so it can be unit-tested with real assertions (`effort.test.ts`)
 * despite `index.ts` itself being untestable under Vitest: `index.ts`'s
 * top-level `Deno.serve(...)` call executes immediately on import and there
 * is no `Deno` global in the Node/Vitest environment this repo's tests run
 * in, so importing `index.ts` directly would crash at import time. This file
 * has no top-level side effects and never references `Deno`, so it imports
 * cleanly under both Deno (from `index.ts`) and Node (from its test).
 *
 * Mirrors `Env.effortGrounding`/`STANDARD_EFFORT` in `src/server/env.ts`
 * exactly — same five allowed values, same "absent → default, present (even
 * blank) → validated, invalid → throw" behaviour as that file's `lasEnv`
 * (Zod's `.optional()` there only treats a genuinely MISSING key as "use the
 * default"; a key present with an empty string still goes through the enum
 * check and is rejected). `index.ts` reads `Deno.env.get(namn)`, which
 * returns `undefined` only when the secret is truly unset — a secret set to
 * `""` comes back as `""`, which must be treated the same way: checked
 * against `GILTIGA_EFFORT` and thrown on, not silently treated as absent.
 */

export type ModelEffort = "low" | "medium" | "high" | "xhigh" | "max";

export const GILTIGA_EFFORT: ModelEffort[] = ["low", "medium", "high", "xhigh", "max"];

/** Shipped default for all three ANTHROPIC_EFFORT_* secrets — mirrors
 *  `STANDARD_EFFORT` in `src/server/env.ts` (see that file's
 *  `Env.effortGrounding` doc comment for the supervisor decision behind it). */
export const STANDARD_EFFORT: ModelEffort = "medium";

/**
 * Validates one already-read env value against the five allowed effort
 * levels. `rått` is exactly what `Deno.env.get(namn)` (or, in a test,
 * anything else) returned: `undefined` for a genuinely absent secret, or the
 * literal string value otherwise — including `""` for a secret explicitly
 * set to blank, which is NOT treated as absent.
 */
export function valideraEffort(namn: string, rått: string | undefined): ModelEffort {
  if (rått === undefined) return STANDARD_EFFORT;
  if (!GILTIGA_EFFORT.includes(rått as ModelEffort)) {
    throw new Error(`Miljövariabeln ${namn} måste vara en av ${GILTIGA_EFFORT.join(", ")}, fick "${rått}".`);
  }
  return rått as ModelEffort;
}
