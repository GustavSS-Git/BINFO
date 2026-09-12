import type { z } from "zod";
import { ExtractionResultSchema } from "./schema";
import type { ExtractionResult } from "@/types/analysis";

/** Calls the model and returns its parsed JSON response (already parsed, not a raw string). */
export type ModelCaller = (systemPrompt: string, userPrompt: string) => Promise<unknown>;

const RAW_PREVIEW_LENGTH = 300;

/**
 * Base for every "the model gave us something we can't use" failure. Each
 * pass names itself (`steg`) so the message says which half of the pipeline
 * failed — PIPELINE.md's whole reason for keeping the passes apart is that
 * when the report is wrong you can tell which one broke.
 */
export class ModelValidationError extends Error {
  constructor(
    steg: string,
    public readonly zodError: z.ZodError,
    public readonly raw: unknown,
    attempts: number,
  ) {
    const issues = zodError.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    const preview =
      typeof raw === "string"
        ? ` | Svar: ${raw.slice(0, RAW_PREVIEW_LENGTH)}${raw.length > RAW_PREVIEW_LENGTH ? "…" : ""}`
        : "";
    super(`${steg} misslyckades validering efter ${attempts} försök: ${issues}${preview}`);
    this.name = "ModelValidationError";
  }
}

export class ExtractionValidationError extends ModelValidationError {
  constructor(zodError: z.ZodError, raw: unknown, attempts: number) {
    super("Extraktionen", zodError, raw, attempts);
    this.name = "ExtractionValidationError";
  }
}

/** Builds the error thrown once the last attempt has also failed validation. */
export type ValidationErrorFactory = (
  zodError: z.ZodError,
  raw: unknown,
  attempts: number,
) => Error;

/**
 * Model output is untrusted input — validate, and on failure retry once
 * before surfacing the error. Per PIPELINE.md's failure-mode table: "Model
 * returns malformed JSON | Schema validation fails, one retry, then
 * surface the error." Never a silent empty analysis.
 *
 * Schema-agnostic so both passes share one retry policy: pass 1 validates
 * against ExtractionResultSchema, pass 2 against the judgement schema.
 */
export async function validateWithRetry<S extends z.ZodTypeAny>(
  schema: S,
  systemPrompt: string,
  userPrompt: string,
  callModel: ModelCaller,
  createError: ValidationErrorFactory,
  maxAttempts = 2,
): Promise<z.infer<S>> {
  let lastError: z.ZodError | undefined;
  let lastRaw: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const raw = await callModel(systemPrompt, userPrompt);
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    lastError = parsed.error;
    lastRaw = raw;
  }

  throw createError(lastError!, lastRaw, maxAttempts);
}

/** Pass 1's binding of validateWithRetry. */
export async function extractWithRetry(
  systemPrompt: string,
  userPrompt: string,
  callModel: ModelCaller,
  maxAttempts = 2,
): Promise<ExtractionResult> {
  const parsed = await validateWithRetry(
    ExtractionResultSchema,
    systemPrompt,
    userPrompt,
    callModel,
    (zodError, raw, attempts) => new ExtractionValidationError(zodError, raw, attempts),
    maxAttempts,
  );
  // Zod's inferred optional-field type allows an explicit `undefined`;
  // exactOptionalPropertyTypes doesn't. Runtime shape is already
  // Zod-verified — this reconciles the two type systems, nothing more.
  return parsed as ExtractionResult;
}
