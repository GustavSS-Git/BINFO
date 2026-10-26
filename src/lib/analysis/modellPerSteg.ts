/**
 * CLI-only (cli.ts) model choice per stage, for measurements: grounding and
 * extraction run on `ANTHROPIC_MODEL`, judging (bedömning + the motivation
 * rewrite) on `ANTHROPIC_MODEL_BEDOMNING` when set. The production job path
 * (steg.ts / Edge) is deliberately untouched: one model per job (`rad.model`).
 */
export interface ModellPerSteg {
  /** transkribering, grundning, extraktion. */
  extraktion: string;
  /** bedömning (+ motivering). */
  bedomning: string;
}

export function lasModellPerSteg(
  env: Record<string, string | undefined>,
  standard: string,
): ModellPerSteg {
  const bas = env["ANTHROPIC_MODEL"]?.trim() || standard;
  const bedomning = env["ANTHROPIC_MODEL_BEDOMNING"]?.trim() || bas;
  return { extraktion: bas, bedomning };
}

/**
 * CLI-only override of a stage's `max_tokens` (measurement: Haiku 5.5's extraction
 * answers sit near the production cap of 16000). Unset = undefined = the stage's
 * own default. Anything but a positive integer up to 128000 is an error, not a guess.
 */
export function lasMaxTokens(
  env: Record<string, string | undefined>,
  namn: string,
): number | undefined {
  const rå = env[namn]?.trim();
  if (!rå) return undefined;
  const n = Number(rå);
  if (!Number.isInteger(n) || n < 1 || n > 128_000) {
    throw new Error(`${namn} måste vara ett heltal mellan 1 och 128000, fick "${rå}".`);
  }
  return n;
}
