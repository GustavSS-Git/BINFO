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
// Endast i testet: analysisView.ts är UI-zonens presentationslager och får
// aldrig importeras av server-koden själv (den drar in @/data/mockData). Ett
// testfil hamnar dock aldrig i någon bundle, och att jämföra de två
// implementationerna mot varandra är just poängen med testet nedan.
import { toppRodaFlaggor } from "@/lib/analysisView";
import type { RedFlag } from "@/types/analysis";
import {
  AnalysHittadesInteError,
  AnalysInteKlarError,
  hamtaForhandsvisning,
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
const propertyInputFixture: { input: unknown } = JSON.parse(
  await readFile(path.join(fixturesDir, "property-input-example.json"), "utf-8"),
);
const { input: propertyInput } = propertyInputFixture;

function minimalJudgement(): AnalysJudgement {
  return {
    betyg: "C",
    betygMotivering: "Testomdöme, inget särskilt att anmärka.",
    rodaFlaggor: [],
    fragor: [],
  };
}

/** Fyra flaggor, medvetet i osorterad severity-ordning, för att testa att
 *  hamtaForhandsvisning väljer de TVÅ allvarligaste — inte bara de två
 *  första i listan. */
function fyraRodaFlaggor(): RedFlag[] {
  return [
    {
      id: "flagga-lag",
      titel: "Låg risk-flagga",
      beskrivning: "En mindre anmärkning.",
      severity: "lag",
      harledsFran: ["rantekanslighet"],
    },
    {
      id: "flagga-hog-1",
      titel: "Första allvarliga flaggan",
      beskrivning: "Något allvarligt.",
      severity: "hog",
      harledsFran: ["rantekanslighet"],
    },
    {
      id: "flagga-medel",
      titel: "Medelrisk-flagga",
      beskrivning: "En måttlig anmärkning.",
      severity: "medel",
      harledsFran: ["rantekanslighet"],
    },
    {
      id: "flagga-hog-2",
      titel: "Andra allvarliga flaggan",
      beskrivning: "Något annat allvarligt.",
      severity: "hog",
      harledsFran: ["rantekanslighet"],
    },
  ];
}

function judgementMedFleraFlaggor(): AnalysJudgement {
  return { ...minimalJudgement(), rodaFlaggor: fyraRodaFlaggor() };
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
    });

    expect(resultat.ok).toBe(false);
    if (resultat.ok) throw new Error("unreachable");
    expect(resultat.errorMessage.length).toBeGreaterThan(0);

    const status = await hamtaStatus(lager, "fake-analys-1");
    expect(status).toBeNull();
  });

  it("avvisar ogiltig propertyInput innan hashning/uppladdning", async () => {
    const lager = skapaFakeLager();
    const env = buildEnv();
    const pdfBytes = await medTextPdf();
    const pdfHash = await sha256Hex(pdfBytes);

    const { orgnr: _orgnr, ...ofullstandigInput } = propertyInput as Record<string, unknown>;

    const resultat = await skapaAnalys(lager, env, {
      pdfBytes,
      propertyInput: ofullstandigInput,
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

describe("hamtaForhandsvisning", () => {
  async function insertDoneRad(
    lager: ReturnType<typeof skapaFakeLager>,
    judgement: AnalysJudgement,
    pdfHash = "forhandsvisning-hash",
  ) {
    const model = "claude-sonnet-5";
    const nyckel = { pdfHash, model, promptVersion: PROMPT_VERSION };
    await sparaExtraktionICache(lager.db, nyckel, extraktion, 1.0);
    await sparaAnalysICache(lager.db, nyckel, judgement, 0.5);

    const { id } = await lager.db.skapaAnalys({
      pdfHash,
      pdfPath: `${pdfHash}.pdf`,
      propertyInput: propertyInput as never,
      model,
      promptVersion: PROMPT_VERSION,
      status: "done",
      stage: "complete",
    });
    return id;
  }

  it("returnerar de gratis sektionerna för en klar analys", async () => {
    const lager = skapaFakeLager();
    const id = await insertDoneRad(lager, minimalJudgement());
    const rad = await lager.db.hamtaAnalys(id);

    const forhandsvisning = await hamtaForhandsvisning(lager, id);

    expect(forhandsvisning.analysisId).toBe(id);
    expect(forhandsvisning.skapad).toBe(rad?.createdAt);
    expect(forhandsvisning.schemaVersion).toBe("1.0.0");
    expect(forhandsvisning.betyg).toBe("C");
    expect(forhandsvisning.betygMotivering).toBe("Testomdöme, inget särskilt att anmärka.");
    expect(forhandsvisning.forening.namn).toBe(extraktion.forening.namn);
    expect(forhandsvisning.datakvalitet).toBeDefined();
    expect(forhandsvisning.gratisSektioner).toEqual(
      expect.arrayContaining(["betyg", "rodaFlaggor_topp2", "datakvalitet"]),
    );
  });

  it("returnerar som mest två röda flaggor — de mest allvarliga — även när fler finns", async () => {
    const lager = skapaFakeLager();
    const id = await insertDoneRad(lager, judgementMedFleraFlaggor());

    const forhandsvisning = await hamtaForhandsvisning(lager, id);

    expect(forhandsvisning.rodaFlaggor).toHaveLength(2);
    expect(forhandsvisning.rodaFlaggor.map((f) => f.id)).toEqual(["flagga-hog-1", "flagga-hog-2"]);
  });

  // Regressionsskydd för en medveten kodduplicering. `toppRodaFlaggorForServer`
  // i analys.ts är en kopia av `toppRodaFlaggor` i src/lib/analysisView.ts
  // (som inte får importeras hit — den drar in @/data/mockData). Kopian löser
  // zonproblemet men skapar ett driftproblem: ändrar någon rangordningen på
  // ena stället och inte det andra, får köparen se ANDRA "topp 2"-flaggor i
  // förhandsvisningen än överst i den fullständiga rapporten — en tyst,
  // användarsynlig inkonsekvens som inget annat test skulle fånga. Testet
  // jämför de två vägarna mot varandra i stället för mot en hårdkodad lista,
  // så det går sönder direkt när implementationerna glider isär.
  it("väljer samma topp-2-flaggor som UI:ts toppRodaFlaggor — kopian får inte glida isär", async () => {
    const lager = skapaFakeLager();
    const id = await insertDoneRad(lager, judgementMedFleraFlaggor());

    const forhandsvisning = await hamtaForhandsvisning(lager, id);
    const fullResultat = await hamtaResultat(lager, id);

    expect(forhandsvisning.rodaFlaggor).toEqual(
      toppRodaFlaggor(fullResultat.rodaFlaggor, forhandsvisning.rodaFlaggor.length),
    );
    // Och att den faktiskt hade fler att välja bland, annars bevisar inget ovan.
    expect(fullResultat.rodaFlaggor.length).toBeGreaterThan(forhandsvisning.rodaFlaggor.length);
  });

  it("returnerar INTE någon prissatt sektion — det är hela garantin bakom betalväggen", async () => {
    const lager = skapaFakeLager();
    const id = await insertDoneRad(lager, judgementMedFleraFlaggor());

    const forhandsvisning = await hamtaForhandsvisning(lager, id);
    const nycklar = Object.keys(forhandsvisning);

    expect(nycklar).not.toContain("prisanalys");
    expect(nycklar).not.toContain("rantestress");
    expect(nycklar).not.toContain("fragor");
    expect(nycklar).not.toContain("manadskostnad");
    expect(nycklar).not.toContain("input");
    // Ingen FULL forening — bara { namn } enligt Forhandsvisning-kontraktet.
    expect(Object.keys(forhandsvisning.forening)).toEqual(["namn"]);
  });

  it("kastar AnalysInteKlarError för en rad som inte är done", async () => {
    const lager = skapaFakeLager();
    const { id } = await lager.db.skapaAnalys({
      pdfHash: "forhandsvisning-pending",
      pdfPath: "forhandsvisning-pending.pdf",
      propertyInput: propertyInput as never,
      model: "claude-sonnet-5",
      promptVersion: PROMPT_VERSION,
      status: "queued",
      stage: "uploaded",
    });

    await expect(hamtaForhandsvisning(lager, id)).rejects.toThrow(AnalysInteKlarError);
  });

  it("kastar AnalysHittadesInteError för ett okänt id", async () => {
    const lager = skapaFakeLager();
    await expect(hamtaForhandsvisning(lager, "finns-inte")).rejects.toThrow(
      AnalysHittadesInteError,
    );
  });

  it("återberikar nyckeltalen vid läsning, precis som hamtaResultat", async () => {
    // Speglar cache.ts filkommentar: berikaNyckeltal appliceras alltid på
    // läsvägen, aldrig lagrad status/benchmark. Vi verifierar indirekt genom
    // att kontrollera att förening-namnet (från re-monterad extraktion)
    // matchar fixturen — samma spårbarhet som hamtaResultat-testerna ovan
    // etablerar för hela AnalysisResult.
    const lager = skapaFakeLager();
    const id = await insertDoneRad(lager, minimalJudgement());

    const forsta = await hamtaForhandsvisning(lager, id);
    const andra = await hamtaForhandsvisning(lager, id);

    expect(JSON.stringify(forsta)).toBe(JSON.stringify(andra));
    expect(forsta.forening.namn).toBe(extraktion.forening.namn);
  });
});
