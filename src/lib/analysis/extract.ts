import type { z } from "zod";
import { ExtractionResultSchema } from "./schema";
import type { ExtractionResult } from "@/types/analysis";

/** Calls the model and returns its parsed JSON response (already parsed, not a raw string). */
export type ModelCaller = (systemPrompt: string, userPrompt: string) => Promise<unknown>;

export class ExtractionValidationError extends Error {
  constructor(
    public readonly zodError: z.ZodError,
    public readonly raw: unknown,
    attempts: number,
  ) {
    super(
      `Extraktionen misslyckades validering efter ${attempts} försök: ` +
        zodError.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
    this.name = "ExtractionValidationError";
  }
}

/**
 * Model output is untrusted input — validate, and on failure retry once
 * before surfacing the error. Per PIPELINE.md's failure-mode table: "Model
 * returns malformed JSON | Schema validation fails, one retry, then
 * surface the error." Never a silent empty analysis.
 */
export async function extractWithRetry(
  systemPrompt: string,
  userPrompt: string,
  callModel: ModelCaller,
  maxAttempts = 2,
): Promise<ExtractionResult> {
  let lastError: z.ZodError | undefined;
  let lastRaw: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const raw = await callModel(systemPrompt, userPrompt);
    const parsed = ExtractionResultSchema.safeParse(raw);
    if (parsed.success) {
      // Zod's inferred optional-field type allows an explicit `undefined`;
      // exactOptionalPropertyTypes doesn't. Runtime shape is already
      // Zod-verified — this reconciles the two type systems, nothing more.
      return parsed.data as ExtractionResult;
    }
    lastError = parsed.error;
    lastRaw = raw;
  }

  throw new ExtractionValidationError(lastError!, lastRaw, maxAttempts);
}
