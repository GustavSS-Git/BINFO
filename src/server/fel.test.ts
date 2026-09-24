import { z } from "zod";
import { describe, expect, it } from "vitest";
import { ScannedPdfError } from "@/lib/analysis/runExtraction";
import { KostnadsgransOverskriden } from "@/lib/analysis/costGuard";
import { ExtractionValidationError, ModelTruncatedError } from "@/lib/analysis/extract";
import { AnalysValidationError } from "@/lib/analysis/analyze";
import { AssemblyValidationError } from "@/lib/analysis/assemble";
import { SaknarRantekanslighetError } from "@/lib/analysis/calc/rantestress";
import { arRetrybar, tolkaFel, tolkaSpendSkal } from "./fel";

/** En riktig z.ZodError, framtagen via ett faktiskt misslyckat safeParse —
 *  enklare och mer verklighetstroget än att bygga ZodError-instansen för
 *  hand, och det är exakt så alla tre valideringsfelen konstrueras i
 *  produktionskoden (validateWithRetry / assembleraAnalys). */
function dummyZodError(): z.ZodError {
  const result = z.object({ foo: z.string() }).safeParse({});
  if (result.success) throw new Error("test setup: expected safeParse to fail");
  return result.error;
}

describe("tolkaFel", () => {
  it("mappar ModelTruncatedError till validation utan att läcka intern detalj", () => {
    const res = tolkaFel(new ModelTruncatedError("bedomning", 16000));
    expect(res.errorCode).toBe("validation");
    expect(res.message).not.toContain("max_tokens");
    expect(res.message).not.toContain("16000");
  });

  it("mappar ScannedPdfError till scanned_pdf med sitt eget köparsäkra meddelande", () => {
    const error = new ScannedPdfError();
    const resultat = tolkaFel(error);

    expect(resultat.errorCode).toBe("scanned_pdf");
    // BESLUT: ScannedPdfError:s .message är redan skriven på svenska och
    // buyer-safe by convention (pipeline-zonen skriver dessa meddelanden med
    // just det syftet, se filkommentaren i fel.ts) — den nämner varken
    // interna variabelnamn, stack traces eller modellsvar, bara att PDF:en
    // saknar textlager. Att skriva ett nytt meddelande hade bara duplicerat
    // texten utan att göra den säkrare, så vi passerar igenom den oförändrad.
    expect(resultat.message).toBe(error.message);
  });

  it("mappar KostnadsgransOverskriden till cost_cap utan att läcka interna variabelnamn", () => {
    const error = new KostnadsgransOverskriden(12.34, 10);
    const resultat = tolkaFel(error);

    expect(resultat.errorCode).toBe("cost_cap");
    // BESLUT: här passerar vi INTE .message igenom rått — det nämner
    // MAX_COST_PER_ANALYSIS_SEK, ett internt miljövariabelnamn en köpare
    // inte ska se. De publika fälten estimatedCostSek/limitSek är däremot
    // rena tal, säkra att formulera om till en köparvänlig mening.
    expect(resultat.message).not.toContain("MAX_COST_PER_ANALYSIS_SEK");
    expect(resultat.message).toMatch(/kostnad/i);
  });

  it("mappar ExtractionValidationError till validation utan att läcka rått modellsvar", () => {
    const error = new ExtractionValidationError(dummyZodError(), "hemligt-modellsvar-abc", 2);
    const resultat = tolkaFel(error);

    expect(resultat.errorCode).toBe("validation");
    expect(resultat.message).not.toContain("hemligt-modellsvar-abc");
  });

  it("mappar AnalysValidationError till validation utan att läcka rått modellsvar", () => {
    const error = new AnalysValidationError(dummyZodError(), "hemligt-modellsvar-xyz", 2);
    const resultat = tolkaFel(error);

    expect(resultat.errorCode).toBe("validation");
    expect(resultat.message).not.toContain("hemligt-modellsvar-xyz");
  });

  it("mappar AssemblyValidationError till validation utan att läcka det interna resultatet", () => {
    const error = new AssemblyValidationError(dummyZodError(), {
      hemligt: "internt-monteringsdata",
    });
    const resultat = tolkaFel(error);

    expect(resultat.errorCode).toBe("validation");
    expect(resultat.message).not.toContain("internt-monteringsdata");
  });

  it("mappar SaknarRantekanslighetError till saknar_rantekanslighet, med ett meddelande skilt från generisk validation", () => {
    const error = new SaknarRantekanslighetError();
    const resultat = tolkaFel(error);

    expect(resultat.errorCode).toBe("saknar_rantekanslighet");
    // BESLUT: det här är INTE en bugg i vår kod eller ett trasigt modellsvar
    // — det är årsredovisningen som saknar det viktigaste av de sju
    // lagstadgade nyckeltalen (CLAUDE.md). Köparen förtjänar den specifika
    // förklaringen, inte ett generiskt "något gick fel". SaknarRantekanslighetError:s
    // egna .message säger redan precis detta på köparsäker svenska, så vi
    // passerar igenom den (samma resonemang som för ScannedPdfError).
    expect(resultat.message).toBe(error.message);

    const generiskt = tolkaFel(new Error("valideringen misslyckades"));
    expect(resultat.message).not.toBe(generiskt.message);
  });

  it("mappar en okänd Error till unknown UTAN att läcka error.message", () => {
    const HEMLIG_MARKOR = "contains-a-secret-marker-xyz123";
    const error = new Error(HEMLIG_MARKOR);
    const resultat = tolkaFel(error);

    expect(resultat.errorCode).toBe("unknown");
    expect(resultat.message).not.toContain(HEMLIG_MARKOR);
  });

  it("mappar ett kastat icke-Error-värde (sträng) till unknown utan att krascha eller läcka det", () => {
    const HEMLIG_MARKOR = "just-a-string-secret-marker-456";
    let fangat: unknown;
    try {
      throw HEMLIG_MARKOR;
    } catch (e) {
      fangat = e;
    }

    const resultat = tolkaFel(fangat);

    expect(resultat.errorCode).toBe("unknown");
    expect(resultat.message).not.toContain(HEMLIG_MARKOR);
  });

  it("mappar ett kastat icke-Error-objekt till unknown utan att krascha eller läcka det", () => {
    let fangat: unknown;
    try {
      throw { weird: "object", hemlighet: "secret-object-marker-789" };
    } catch (e) {
      fangat = e;
    }

    const resultat = tolkaFel(fangat);

    expect(resultat.errorCode).toBe("unknown");
    expect(resultat.message).not.toContain("secret-object-marker-789");
  });
});

describe("tolkaSpendSkal", () => {
  it("mappar daily_cap till daily_cap med ett meddelande som säger att det är tillfälligt", () => {
    const resultat = tolkaSpendSkal("daily_cap");

    expect(resultat.errorCode).toBe("daily_cap");
    expect(resultat.message).toMatch(/imorgon|igen/i);
  });

  it("mappar kill_switch till unknown (operationell avstängning, inte tänkt att nå en riktig köpare)", () => {
    // BESLUT: kill_switch är en manuell nödbroms för driften, inte ett fel i
    // köparens data eller i pipelinen. Den har inget eget AnalysErrorCode och
    // portar.ts:s union ändras inte för detta (se uppgiftens instruktion) —
    // "unknown" är defensible eftersom den bara är tänkt att synas internt,
    // men meddelandet hålls ändå ärligt och köparsäkert ifall det av misstag
    // skulle nå fram.
    const resultat = tolkaSpendSkal("kill_switch");

    expect(resultat.errorCode).toBe("unknown");
    expect(resultat.message.length).toBeGreaterThan(0);
  });
});

describe("arRetrybar", () => {
  it("är true endast för daily_cap", () => {
    expect(arRetrybar("daily_cap")).toBe(true);
  });

  it("är false för alla andra felkoder", () => {
    expect(arRetrybar("scanned_pdf")).toBe(false);
    expect(arRetrybar("cost_cap")).toBe(false);
    expect(arRetrybar("validation")).toBe(false);
    expect(arRetrybar("saknar_rantekanslighet")).toBe(false);
    expect(arRetrybar("unknown")).toBe(false);
  });
});
