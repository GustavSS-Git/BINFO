/**
 * The seam between "Hämta uppgifter" (hamta.ts) and where listing data comes
 * from (docs/plans/booli-api.md §3). Two sources today:
 *   - `booliApiLeverantor` (booliApi.ts): Booli's REST API, `/annons/<id>` only;
 *   - `booliSidaLeverantor` (booliSida.ts): the listing page (Cloudflare-
 *     challenged in production), behind `ANNONS_SIDHAMTNING=on`.
 * When the API key expires, another source is one more `AnnonsLeverantor`.
 *
 * hamta.ts does the input/URL/cache/entitlement/quota steps and the choice of
 * source; a source only fetches and normalises, logs its own failures
 * (`[annons] …` with `kalla`) and returns them. It never throws for an
 * expected case.
 */

import type { AnnonsFalt, AnnonsUppgifter } from "@/lib/annons/typer";
import { ANNONS_FALT } from "@/lib/annons/typer";
import type { AnthropicClientLike } from "@/lib/analysis/runExtraction";
import type { Env } from "../env";
import type { Anropare, Databas } from "../portar";
import type { GeokodIndata, GeokodUtfall } from "./geokod";
import type { AnnonsLlmUtfall } from "./llmFallback";

export interface HamtaAnnonsBeroenden {
  anropare: Anropare;
  env: Env;
  /** Injected in tests; defaults to the global fetch (page, API and Nominatim). */
  fetch?: typeof fetch;
  /** Injected in tests. */
  nu?: () => Date;
  /** Page fetch deadline; default 10 s (tests shorten it). */
  tidsgransMs?: number;
  /** Per-call API deadline; default 8 s (tests shorten it). */
  apiTidsgransMs?: number;
  /** Injected in tests: the API's `unique` value. */
  unik?: () => string;
  /** Injected in tests: replaces the Nominatim lookup (page source only). */
  geokoda?: (indata: GeokodIndata) => Promise<GeokodUtfall>;
  /** Injected in tests: replaces the WHOLE model fallback (call and spend). */
  llm?: (html: string, url: string) => Promise<AnnonsLlmUtfall>;
  /** Injected in tests: the Anthropic client of the default model fallback. */
  anthropicKlient?: AnthropicClientLike;
  /** Injected in tests: the database holding the daily spend counter that the
   *  default model fallback reserves against (default: the real one). */
  spendDb?: Databas;
}

/** A checked, canonical listing link (`kontrolleraAnnonsUrl`). */
export interface KontrolleradLank {
  url: string;
  typ: "annons" | "bostad";
  id: string;
}

export type LeverantorFelkod =
  "ej_tillganglig" | "nyckel" | "hittades_inte" | "blockerad" | "natverk" | "tolkning";

export type LeverantorUtfall =
  | {
      typ: "ok";
      uppgifter: AnnonsUppgifter;
      postnummerKalla?: "annons" | "geokodning";
      tolkning: "struktur" | "llm";
    }
  | { typ: "fel"; kod: LeverantorFelkod; orsak: string };

export interface AnnonsLeverantor {
  namn: "booli_api" | "booli_sida";
  /** `AnnonsSvar.metod` of a success. */
  metod: "api" | "sida";
  hamta(lank: KontrolleradLank, b: HamtaAnnonsBeroenden): Promise<LeverantorUtfall>;
}

/** The fields present in all six recorded pages (docs/booli.md): when one is
 *  missing on an otherwise good answer, the source has probably changed. */
export const ANNONS_KARNFALT: readonly AnnonsFalt[] = [
  "adress",
  "postnummer",
  "ort",
  "boarea",
  "antalRum",
  "vaning",
  "byggar",
];

export function logga(handelse: string, detaljer: Record<string, unknown>): void {
  console.warn(`[annons] ${handelse}`, detaljer);
}

export function felText(fel: unknown): string {
  return fel instanceof Error ? fel.message : String(fel);
}

export function harFormfalt(u: AnnonsUppgifter): boolean {
  return ANNONS_FALT.some((f) => u[f] !== undefined);
}

/** A plausible construction year (shared by both parsers: booli.ts and
 *  booliApiTolkning.ts). */
export function rimligtByggar(ar: unknown, iAr = new Date().getFullYear()): ar is number {
  return typeof ar === "number" && Number.isInteger(ar) && ar >= 1600 && ar <= iAr + 5;
}
