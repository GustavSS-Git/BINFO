import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { skapaFakeLager } from "./__fakes__/lager";
import type { Env } from "./env";
import { PROMPT_VERSION } from "@/lib/analysis/prompts";
import { sparaAnalysICache, sparaExtraktionICache } from "./cache";
import { extraktion } from "@/lib/analysis/__fixtures__/extraktion";
import type { AnalysJudgement } from "@/lib/analysis/analyze";
import { AnalysisResultSchema } from "@/lib/analysis/schema";
import {
  AnalysHittadesInteError,
  AnalysInteKlarError,
  hamtaResultat,
  hamtaStatus,
  skapaAnalys,
} from "./analys";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = (name: string) =>
  path.join(here, "..", "lib", "analysis", "__fixtures__", name);

async function medTextPdf(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(fixturePath("med-text.pdf")));
}

async function utanTextPdf(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(fixturePath("utan-text.pdf")));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Oberoende oracle — beräknad direkt via samma web-standard-API, men i
  // testet, inte i produktionskoden, för att verifiera att skapaAnalys
  // faktiskt hashar rätt bytes.
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function buildEnv(overrides: Partial<Env> = {}): Env {
  return {
    supabaseUrl: "https://example.supabase.co",
    supabaseSecretKey: "secret",
    maxDailySpendSek: 100,
    killSwitchPa: false,
    anthropicApiKey: "test-key",
    anthropicModel: "claude-sonnet-5",
    maxCostPerAnalysisSek: 5,
    ...overrides,
  };
}

// Läses från disk med JSON.parse, precis som cli.ts läser sin objektsfil —
// undviker en statisk JSON-import av en fil utanför tsconfig-projektets
// `include` (fixtures/ ligger utanför src/).
const fixturesDir = path.join(here, "..", "..", "fixtures");
const propertyInputFixture: { input: unknown; lan: unknown } = JSON.parse(
  await readFile(path.join(fixturesDir, "property-input-example.json"), "utf-8"),
);
const { input: propertyInput, lan: lanUnderlag } = propertyInputFixture;

function minimalJudgement(): AnalysJudgement {
  return {
    betyg: "C",
    betygMotivering: "Testomdöme, inget särskilt att anmärka.",
    rodaFlaggor: [],
    fragor: [],
  };
}

describe("skapaAnalys", () => {
  it("kallt lyckat fall: skapar en köad rad med rätt pdf_hash och laddar upp filen", async () => {
    const lager = skapaFakeLager();
    const env = buildEnv();
    const pdfBytes = await medTextPdf();
    const forvantadHash = await sha256Hex(pdfBytes);

    const resultat = await skapaAnalys(lager, env, {
      pdfBytes,
      propertyInput,
      lanUnderlag,
    });

    expect(resultat.ok).toBe(true);
    if (!resultat.ok) throw new Error("unreachable");

    const rad = await lager.db.hamtaAnalys(resultat.analysisId);
    expect(rad).not.toBeNull();
    expect(rad?.status).toBe("queued");
    expect(rad?.stage).toBe("uploaded");
    expect(rad?.pdfHash).toBe(forvantadHash);
    expect(rad?.pdfPath).toBe(`${forvantadHash}.pdf`);

    const uppladdad = await lager.filer.hamta(`${forvantadHash}.pdf`);
    expect(uppladdad.byteLength).toBeGreaterThan(0);
  });

  it("dedupe: båda cacharna träffade ger status done/complete direkt, kostnadsfritt", async () => {
    const lager = skapaFakeLager();
    const env = buildEnv();
    const pdfBytes = await medTextPdf();
    const pdfHash = await sha256Hex(pdfBytes);
    const nyckel = { pdfHash, model: env.anthropicModel, promptVersion: PROMPT_VERSION };

    await sparaExtraktionICache(lager.db, nyckel, extraktion, 1.23);
    await sparaAnalysICache(lager.db, nyckel, minimalJudgement(), 0.45);

    const resultat = await skapaAnalys(lager, env, {
      pdfBytes,
      propertyInput,
      lanUnderlag,
    });

    expect(resultat.ok).toBe(true);
    if (!resultat.ok) throw new Error("unreachable");

    const rad = await lager.db.hamtaAnalys(resultat.analysisId);
    expect(rad?.status).toBe("done");
    expect(rad?.stage).toBe("complete");
    // Den här köparen betalade 0 kr — skapaAnalys anropar aldrig modellen.
    expect(rad?.costSek).toBe(0);
  });

  it("dedupe: bara extraktionen cachad ger stage judging", async () => {
    const lager = skapaFakeLager();
    const env = buildEnv();
    const pdfBytes = await medTextPdf();
    const pdfHash = await sha256Hex(pdfBytes);
    const nyckel = { pdfHash, model: env.anthropicModel, promptVersion: PROMPT_VERSION };

    await sparaExtraktionICache(lager.db, nyckel, extraktion, 1.23);

    const resultat = await skapaAnalys(lager, env, {
      pdfBytes,
      propertyInput,
      lanUnderlag,
    });

    expect(resultat.ok).toBe(true);
    if (!resultat.ok) throw new Error("unreachable");

    const rad = await lager.db.hamtaAnalys(resultat.analysisId);
    expect(rad?.status).toBe("queued");
    expect(rad?.stage).toBe("judging");
  });

  it("avvisar en skannad PDF utan textlager, utan att ladda upp eller skapa någon rad", async () => {
    const lager = skapaFakeLager();
    const env = buildEnv();
    const pdfBytes = await utanTextPdf();
    const pdfHash = await sha256Hex(pdfBytes);

    const resultat = await skapaAnalys(lager, env, {
      pdfBytes,
      propertyInput,
      lanUnderlag,
    });

    expect(resultat).toEqual({
      ok: false,
      errorCode: "scanned_pdf",
      errorMessage: expect.any(String),
    });
    if (resultat.ok) throw new Error("unreachable");
    expect(resultat.errorMessage.length).toBeGreaterThan(0);

    await expect(lager.filer.hamta(`${pdfHash}.pdf`)).rejects.toThrow();
  });

  it("avvisar innehåll som inte börjar med %PDF, utan uppladdning eller radskapande", async () => {
    const lager = skapaFakeLager();
    const env = buildEnv();
    const pdfBytes = new TextEncoder().encode("not a pdf");

    const resultat = await skapaAnalys(lager, env, {
      pdfBytes,
      propertyInput,
      lanUnderlag,
    });

    expect(resultat.ok).toBe(false);
    if (resultat.ok) throw new Error("unreachable");
    expect(resultat.errorCode).toBe("validation");

    const hash = await sha256Hex(pdfBytes);
    await expect(lager.filer.hamta(`${hash}.pdf`)).rejects.toThrow();
  });

  it("avvisar en fil över 25 MB", async () => {
    // Storleken kontrolleras oberoende av magic-bytes-kontrollen (ordningen
    // spelar ingen roll för detta test eftersom bufferten även börjar med
    // giltiga %PDF-bytes) — men gör den ändå avsiktligt %PDF-prefixad så
    // testet garanterat verifierar STORLEKS-kontrollen, inte magic bytes.
    const lager = skapaFakeLager();
    const env = buildEnv();
    const pdfBytes = new Uint8Array(25 * 1024 * 1024 + 1);
    pdfBytes[0] = 0x25;
    pdfBytes[1] = 0x50;
    pdfBytes[2] = 0x44;
    pdfBytes[3] = 0x46;

    const resultat = await skapaAnalys(lager, env, {
      pdfBytes,
      propertyInput,
      lanUnderlag,
    });

    expect(resultat.ok).toBe(false);
    if (resultat.ok) throw new Error("unreachable");
    expect(resultat.errorCode).toBe("validation");
  });

  it("kill switch: nekar utan att skapa någon rad", async () => {
    const lager = skapaFakeLager();
    const env = buildEnv({ killSwitchPa: true });
    const pdfBytes = await medTextPdf();

    const resultat = await skapaAnalys(lager, env, {
      pdfBytes,
      propertyInput,
      lanUnderlag,
    });

    expect(resultat.ok).toBe(false);
    if (resultat.ok) throw new Error("unreachable");
    expect(resultat.errorMessage.length).toBeGreaterThan(0);

    const status = await hamtaStatus(lager, "fake-analys-1");
    expect(status).toBeNull();
  });

  it("avvisar ogiltig propertyInput/lanUnderlag innan hashning/uppladdning", async () => {
    const lager = skapaFakeLager();
    const env = buildEnv();
    const pdfBytes = await medTextPdf();
    const pdfHash = await sha256Hex(pdfBytes);

    const { orgnr: _orgnr, ...ofullstandigInput } = propertyInput as Record<string, unknown>;

    const resultat = await skapaAnalys(lager, env, {
      pdfBytes,
      propertyInput: ofullstandigInput,
      lanUnderlag,
    });

    expect(resultat.ok).toBe(false);
    if (resultat.ok) throw new Error("unreachable");
    expect(resultat.errorCode).toBe("validation");

    await expect(lager.filer.hamta(`${pdfHash}.pdf`)).rejects.toThrow();
  });
});

describe("hamtaStatus", () => {
  it("returnerar null för ett okänt id", async () => {
    const lager = skapaFakeLager();
    expect(await hamtaStatus(lager, "finns-inte")).toBeNull();
  });

  it("returnerar status/stage för en riktig rad, med errorCode/errorMessage när satta", async () => {
    const lager = skapaFakeLager();
    const { id } = await lager.db.skapaAnalys({
      pdfHash: "abc123",
      pdfPath: "abc123.pdf",
      propertyInput: propertyInput as never,
      lanUnderlag: lanUnderlag as never,
      model: "claude-sonnet-5",
      promptVersion: PROMPT_VERSION,
      status: "failed",
      stage: "extracting",
    });
    await lager.db.uppdateraAnalys(id, {
      errorCode: "cost_cap",
      errorMessage: "Kostnadstaket nått.",
    });

    const svar = await hamtaStatus(lager, id);
    expect(svar).toEqual({
      status: "failed",
      stage: "extracting",
      errorCode: "cost_cap",
      errorMessage: "Kostnadstaket nått.",
    });
  });

  it("utelämnar errorCode/errorMessage helt när raden inte har några", async () => {
    const lager = skapaFakeLager();
    const { id } = await lager.db.skapaAnalys({
      pdfHash: "abc123",
      pdfPath: "abc123.pdf",
      propertyInput: propertyInput as never,
      lanUnderlag: lanUnderlag as never,
      model: "claude-sonnet-5",
      promptVersion: PROMPT_VERSION,
      status: "queued",
      stage: "uploaded",
    });

    const svar = await hamtaStatus(lager, id);
    expect(svar).not.toBeNull();
    expect("errorCode" in (svar as object)).toBe(false);
    expect("errorMessage" in (svar as object)).toBe(false);
  });
});

describe("hamtaResultat", () => {
  async function insertDoneRad(lager: ReturnType<typeof skapaFakeLager>) {
    const model = "claude-sonnet-5";
    const nyckel = { pdfHash: "done-hash", model, promptVersion: PROMPT_VERSION };
    await sparaExtraktionICache(lager.db, nyckel, extraktion, 1.0);
    await sparaAnalysICache(lager.db, nyckel, minimalJudgement(), 0.5);

    const { id } = await lager.db.skapaAnalys({
      pdfHash: "done-hash",
      pdfPath: "done-hash.pdf",
      propertyInput: propertyInput as never,
      lanUnderlag: lanUnderlag as never,
      model,
      promptVersion: PROMPT_VERSION,
      status: "done",
      stage: "complete",
    });
    return id;
  }

  it("monterar ett giltigt AnalysisResult för en klar rad", async () => {
    const lager = skapaFakeLager();
    const id = await insertDoneRad(lager);
    const rad = await lager.db.hamtaAnalys(id);

    const resultat = await hamtaResultat(lager, id);

    expect(AnalysisResultSchema.safeParse(resultat).success).toBe(true);
    expect(resultat.analysisId).toBe(id);
    expect(resultat.skapad).toBe(rad?.createdAt);
  });

  it("är idempotent: samma rad ger byte-identiskt JSON två gånger", async () => {
    const lager = skapaFakeLager();
    const id = await insertDoneRad(lager);

    const forsta = await hamtaResultat(lager, id);
    const andra = await hamtaResultat(lager, id);

    expect(JSON.stringify(forsta)).toBe(JSON.stringify(andra));
  });

  it("kastar AnalysInteKlarError för en rad som inte är done", async () => {
    const lager = skapaFakeLager();
    const { id } = await lager.db.skapaAnalys({
      pdfHash: "pending-hash",
      pdfPath: "pending-hash.pdf",
      propertyInput: propertyInput as never,
      lanUnderlag: lanUnderlag as never,
      model: "claude-sonnet-5",
      promptVersion: PROMPT_VERSION,
      status: "queued",
      stage: "uploaded",
    });

    await expect(hamtaResultat(lager, id)).rejects.toThrow(AnalysInteKlarError);
  });

  it("kastar AnalysHittadesInteError för ett okänt id", async () => {
    const lager = skapaFakeLager();
    await expect(hamtaResultat(lager, "finns-inte")).rejects.toThrow(AnalysHittadesInteError);
  });
});
