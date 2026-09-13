/**
 * Läs/skriv-lager över `extraktion_cache` och `analys_cache`, nycklade på
 * (pdf_hash, model, prompt_version) — se `src/server/portar.ts` för
 * `Databas`-metoderna detta bygger på.
 *
 * Den viktigaste egenskapen i den här filen: att läsa tillbaka en cachad
 * extraktion återapplicerar ALLTID `berikaNyckeltal` på
 * `extraction.forening.keyFigures`, istället för att lita på lagrad
 * status/benchmark. Enligt SUPABASE.md är tröskelvärdena i BENCHMARKS.md
 * medvetet UTANFÖR cache-nyckeln: `berikaNyckeltal` läser bara
 * `figure.value` och skriver alltid över `status`/`benchmark` i sin helhet,
 * så ett ändrat tröskelvärde i BENCHMARKS.md kostar ingenting och kräver
 * ingen cache-invalidering — men bara om läsvägen faktiskt återberikar.
 * Det är ett krav, inte en optimering (SUPABASE.md: "That is a required
 * step, not an optimisation.").
 *
 * Läsvägen validerar också alltid det återberikade resultatet mot
 * `ExtractionResultSchema`/`AnalysJudgementSchema` (parse, inte safeParse).
 * En cache-rad som inte längre matchar kontraktet — t.ex. efter en
 * kontraktsändring i `src/types/analysis.ts` — ska krascha synligt vid
 * läsning, inte glida igenom som tyst ogiltig data.
 */

import { berikaNyckeltal } from "@/lib/analysis/benchmarks";
import { AnalysJudgementSchema, ExtractionResultSchema } from "@/lib/analysis/schema";
import type { AnalysJudgement } from "@/lib/analysis/analyze";
import type { ExtractionResult } from "@/types/analysis";
import type { AnalysCacheRad, Databas, ExtraktionCacheRad } from "./portar";

export interface CacheNyckel {
  pdfHash: string;
  model: string;
  promptVersion: string;
}

export async function hamtaExtraktionFranCache(
  db: Databas,
  nyckel: CacheNyckel,
): Promise<ExtractionResult | null> {
  const rad = await db.hamtaExtraktion(nyckel.pdfHash, nyckel.model, nyckel.promptVersion);
  if (!rad) return null;

  // Återberika, aldrig lita på lagrad status/benchmark — se filkommentaren.
  const berikad: ExtractionResult = {
    ...rad.extraction,
    forening: {
      ...rad.extraction.forening,
      keyFigures: berikaNyckeltal(rad.extraction.forening.keyFigures),
    },
  };

  try {
    const parsed = ExtractionResultSchema.parse(berikad);
    // Zods inferrade typ tillåter explicit `undefined` på optionella fält;
    // exactOptionalPropertyTypes gör det inte. Formen är redan verifierad av
    // Zod ovan — detta förenar bara de två typsystemen (samma mönster som
    // src/lib/analysis/analyze.ts använder för AnalysJudgement).
    return parsed as ExtractionResult;
  } catch (fel) {
    throw new Error(
      `Cachad extraktion för (pdf_hash=${nyckel.pdfHash}, model=${nyckel.model}, ` +
        `prompt_version=${nyckel.promptVersion}) matchar inte ExtractionResultSchema efter ` +
        `återberikning: ${fel instanceof Error ? fel.message : String(fel)}`,
    );
  }
}

export async function sparaExtraktionICache(
  db: Databas,
  nyckel: CacheNyckel,
  extraction: ExtractionResult,
  costSek: number,
): Promise<void> {
  const rad: ExtraktionCacheRad = {
    extraction,
    schemaVersion: extraction.schemaVersion,
    costSek,
    // Denormaliserade kolumner, se migrationskommentaren i portar.ts.
    orgnr: extraction.forening.orgnr,
    rakenskapsar: extraction.forening.rakenskapsar,
  };
  await db.sparaExtraktion(nyckel.pdfHash, nyckel.model, nyckel.promptVersion, rad);
}

export async function hamtaAnalysFranCache(
  db: Databas,
  nyckel: CacheNyckel,
): Promise<AnalysJudgement | null> {
  const rad = await db.hamtaAnalysCache(nyckel.pdfHash, nyckel.model, nyckel.promptVersion);
  if (!rad) return null;

  try {
    const parsed = AnalysJudgementSchema.parse(rad.judgement);
    return parsed as AnalysJudgement;
  } catch (fel) {
    throw new Error(
      `Cachad analys för (pdf_hash=${nyckel.pdfHash}, model=${nyckel.model}, ` +
        `prompt_version=${nyckel.promptVersion}) matchar inte AnalysJudgementSchema: ` +
        `${fel instanceof Error ? fel.message : String(fel)}`,
    );
  }
}

export async function sparaAnalysICache(
  db: Databas,
  nyckel: CacheNyckel,
  judgement: AnalysJudgement,
  costSek: number,
): Promise<void> {
  const rad: AnalysCacheRad = { judgement, costSek };
  await db.sparaAnalysCache(nyckel.pdfHash, nyckel.model, nyckel.promptVersion, rad);
}
