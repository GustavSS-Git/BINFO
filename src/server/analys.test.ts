import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { skapaFakeLager } from "./__fakes__/lager";
import { skapaFakeKontoDatabas, type FakeKontoDatabas } from "./__fakes__/konto";
import {
  SaknarBehorighetError,
  skapaBehorighet,
  STANDARD_POLICY,
  type BehorighetsFraga,
  type Policy,
} from "./behorighet";
import type { Kontext } from "./kontext";
import {
  DAG_SEK,
  KVOT_MEDDELANDE,
  kvotNyckel,
  UPPLADDNINGAR_PER_ENHET_OCH_DAG,
  UPPLADDNINGAR_PER_IP_OCH_DAG,
} from "./kvot";
import type { Anropare } from "./portar";
import { FOR_MANGA_SKANNADE_SIDOR_MEDDELANDE, MAX_SIDOR_SKANNAD_RAPPORT } from "./register";
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

/** A text-bearing PDF that differs per `n` (different bytes, so a different
 *  hash and its own rapport). */
async function unikTextPdf(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([595, 842]).drawText(`Arsredovisning nummer ${n} for Brf Test`, {
    x: 50,
    y: 780,
    size: 12,
    font,
  });
  return doc.save();
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
    effortGrounding: "medium",
    effortExtraction: "medium",
    effortJudging: "medium",
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

  it("dedupe sker i registret: samma bytes som en klar rapport ger en klar analys direkt, kostnadsfritt", async () => {
    const lager = skapaFakeLager();
    const env = buildEnv();
    const pdfBytes = await medTextPdf();

    const forsta = await skapaAnalys(lager, env, { pdfBytes, propertyInput });
    if (!forsta.ok) throw new Error("unreachable");
    const forstaRad = await lager.db.hamtaAnalys(forsta.analysisId);
    // Markera rapporten klar, som om workern kört den (se register.test.ts
    // för hela livscykeln).
    await lager.db.uppdateraRapport(forstaRad?.rapportId ?? "", {
      status: "done",
      stage: "klar",
      extraction: extraktion,
      judgement: minimalJudgement(),
      finishedAt: new Date(Date.now() - 1000).toISOString(),
    });

    const resultat = await skapaAnalys(lager, env, { pdfBytes, propertyInput });
    expect(resultat).toMatchObject({ ok: true, ateranvand: true });
    if (!resultat.ok) throw new Error("unreachable");

    const rad = await lager.db.hamtaAnalys(resultat.analysisId);
    expect(rad?.rapportId).toBe(forstaRad?.rapportId);
    // Den här köparen betalade 0 kr — skapaAnalys anropar aldrig modellen.
    expect(rad?.costSek).toBe(0);
    expect(await hamtaStatus(lager, resultat.analysisId)).toMatchObject({
      status: "done",
      stage: "complete",
    });
  });

  it("legacy-cacharna konsulteras inte vid uppladdning — de flyttas in i registret av `register backfill-legacy`", async () => {
    const lager = skapaFakeLager();
    const env = buildEnv();
    const pdfBytes = await medTextPdf();
    const pdfHash = await sha256Hex(pdfBytes);
    const nyckel = { pdfHash, model: env.anthropicModel, promptVersion: PROMPT_VERSION };
    await sparaExtraktionICache(lager.db, nyckel, extraktion, 1.23);
    await sparaAnalysICache(lager.db, nyckel, minimalJudgement(), 0.45);

    const resultat = await skapaAnalys(lager, env, { pdfBytes, propertyInput });
    if (!resultat.ok) throw new Error("unreachable");

    const rad = await lager.db.hamtaAnalys(resultat.analysisId);
    expect(rad?.rapportId).not.toBeNull();
    expect(await hamtaStatus(lager, resultat.analysisId)).toMatchObject({ status: "queued" });
  });

  it("tar emot en skannad PDF utan textlager (WS1): rapporten köas med textlager 'saknas' och PDF:en laddas upp", async () => {
    const lager = skapaFakeLager();
    const env = buildEnv();
    const pdfBytes = await utanTextPdf();
    const pdfHash = await sha256Hex(pdfBytes);

    const resultat = await skapaAnalys(lager, env, { pdfBytes, propertyInput });

    expect(resultat.ok).toBe(true);
    await expect(lager.filer.hamta(`${pdfHash}.pdf`)).resolves.toBeDefined();
    const [rapport] = lager.db._allaRapporter();
    expect(rapport).toMatchObject({ textlager: "saknas", status: "queued", pdfHash });
  });

  it("avvisar en skannad PDF med fler sidor än MAX_SIDOR_SKANNAD_RAPPORT, utan uppladdning eller rad", async () => {
    const lager = skapaFakeLager();
    const env = buildEnv();
    const doc = await PDFDocument.create();
    for (let i = 0; i < MAX_SIDOR_SKANNAD_RAPPORT + 1; i++) doc.addPage();
    const pdfBytes = new Uint8Array(await doc.save());
    const pdfHash = await sha256Hex(pdfBytes);

    const resultat = await skapaAnalys(lager, env, { pdfBytes, propertyInput });

    expect(resultat).toEqual({
      ok: false,
      errorCode: "scanned_pdf",
      errorMessage: FOR_MANGA_SKANNADE_SIDOR_MEDDELANDE,
    });
    await expect(lager.filer.hamta(`${pdfHash}.pdf`)).rejects.toThrow();
    expect(lager.db._allaRapporter()).toHaveLength(0);
  });

  it("tar emot en skannad PDF med exakt MAX_SIDOR_SKANNAD_RAPPORT sidor", async () => {
    const lager = skapaFakeLager();
    const env = buildEnv();
    const doc = await PDFDocument.create();
    for (let i = 0; i < MAX_SIDOR_SKANNAD_RAPPORT; i++) doc.addPage();
    const pdfBytes = new Uint8Array(await doc.save());

    const resultat = await skapaAnalys(lager, env, { pdfBytes, propertyInput });

    expect(resultat.ok).toBe(true);
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

describe("hamtaResultat: rader från äldre kodversioner", () => {
  // Regressionsskydd för en riktig produktionsbugg. Rader skapade FÖRE Fas 1
  // Steg 0 har ett property_input-JSON med `antalLantagare`, ett fält som
  // steget tog bort ur kontraktet. PropertyInputSchema är .strict(), så
  // assembleraAnalys avvisade varje sådan rad med "Unrecognized key(s)" —
  // alla tre färdiga analyser i det live projektet blev olästbara, och
  // routens loader svalde felet tyst till en evig väntskärm. Steg 0:s tester
  // missade det eftersom samtliga använde färska fixtures; ingen läste en rad
  // som en äldre version av koden hade skrivit. Lagrat JSON från en tidigare
  // kodversion är också opålitlig indata: en okänd nyckel från ett BORTTAGET
  // fält ska strippas vid läsning, inte vara dödlig. .strict() behåller sitt
  // värde vid SKRIVNING (skapaAnalys fångar stavfel i formuläret).
  it("läser en rad vars lagrade property_input bär ett numera borttaget fält", async () => {
    const lager = skapaFakeLager();
    const model = "claude-sonnet-5";
    const pdfHash = "rad-fran-fore-steg-0";
    const nyckel = { pdfHash, model, promptVersion: PROMPT_VERSION };
    await sparaExtraktionICache(lager.db, nyckel, extraktion, 1.0);
    await sparaAnalysICache(lager.db, nyckel, minimalJudgement(), 0.5);
    const { id } = await lager.db.skapaAnalys({
      pdfHash,
      pdfPath: `${pdfHash}.pdf`,
      // Exakt formen en rad från före Steg 0 har: giltig i övrigt, plus det
      // borttagna fältet. `as never` eftersom typen — korrekt — inte längre
      // tillåter nyckeln; det är ju hela poängen.
      propertyInput: { ...(propertyInput as object), antalLantagare: 2 } as never,
      model,
      promptVersion: PROMPT_VERSION,
      status: "done",
      stage: "complete",
    });

    const resultat = await hamtaResultat(lager, id);

    expect(resultat.betyg).toBe("C");
    // Och det strippade fältet får inte läcka igenom till resultatet.
    expect(Object.keys(resultat.input)).not.toContain("antalLantagare");
  });
});

// ---------------------------------------------------------------------------
// Anropare (WS4): behörighet, kvot, spend-tak och principal
// ---------------------------------------------------------------------------

const ENHET = "AAAAAAAAAAAAAAAAAAAAAA";
const IP_HASH = "ab".repeat(32);

function skapaAnropare(
  konto: FakeKontoDatabas,
  policy: Partial<Policy> = {},
  kontext: Partial<Kontext> = {},
): Anropare {
  return {
    kontext: { enhetId: ENHET, principalId: null, ipHash: IP_HASH, ...kontext },
    konto,
    behorighet: skapaBehorighet({ ...STANDARD_POLICY, ...policy }),
  };
}

/** Antal använda i dagens fönster för en kvotnyckel (0 om ingen rad). */
function kvotAnvand(konto: FakeKontoDatabas, nyckel: string): number {
  let summa = 0;
  for (const rad of konto.kvot.values()) if (rad.nyckel === nyckel) summa += rad.antal;
  return summa;
}

const ENHET_NYCKEL = kvotNyckel("uppladdning", "enhet", ENHET);
const IP_NYCKEL = kvotNyckel("uppladdning", "ip", IP_HASH);

/** Ett lager + kontolager som delar EN analys-tabell, som i databasen. */
function skapaDeladeFakes() {
  const lager = skapaFakeLager();
  const konto = skapaFakeKontoDatabas({ analyser: lager.db._analysTabell() });
  return { lager, konto };
}

describe("skapaAnalys med anropare", () => {
  it("nekad behörighet (ladda_upp_analys) → behorighet, utan rad, uppladdning, principal eller kvot", async () => {
    const { lager, konto } = skapaDeladeFakes();
    const pdfBytes = await medTextPdf();

    const resultat = await skapaAnalys(
      lager,
      buildEnv(),
      { pdfBytes, propertyInput },
      { anropare: skapaAnropare(konto, { ladda_upp_analys: () => false }) },
    );

    expect(resultat).toEqual({
      ok: false,
      errorCode: "behorighet",
      errorMessage: "Du har inte tillgång till den här funktionen just nu.",
    });
    expect(lager.db._allaAnalyser()).toHaveLength(0);
    expect(await lager.filer.finns(`${await sha256Hex(pdfBytes)}.pdf`)).toBe(false);
    expect(konto.principaler.size).toBe(0);
    expect(konto.kvot.size).toBe(0);
  });

  it("en policyregel som kastar släpps igenom (fail closed), inte som en beviljad behörighet", async () => {
    const { lager, konto } = skapaDeladeFakes();
    const anropare = skapaAnropare(konto, {
      ladda_upp_analys: () => {
        throw new Error("policyfel");
      },
    });
    await expect(
      skapaAnalys(lager, buildEnv(), { pdfBytes: await medTextPdf(), propertyInput }, { anropare }),
    ).rejects.toThrow("policyfel");
    expect(lager.db._allaAnalyser()).toHaveLength(0);
  });

  it("skriver principal_id på analys-raden och skapar principalen lat", async () => {
    const { lager, konto } = skapaDeladeFakes();

    const resultat = await skapaAnalys(
      lager,
      buildEnv(),
      { pdfBytes: await medTextPdf(), propertyInput },
      { anropare: skapaAnropare(konto) },
    );
    if (!resultat.ok) throw new Error(resultat.errorMessage);

    expect(konto.principaler.size).toBe(1);
    const [principal] = [...konto.principaler.values()];
    expect(principal?.enhetId).toBe(ENHET);
    const rad = await lager.db.hamtaAnalys(resultat.analysisId);
    expect(rad?.principalId).toBe(principal?.id);
    expect(kvotAnvand(konto, ENHET_NYCKEL)).toBe(1);
    expect(kvotAnvand(konto, IP_NYCKEL)).toBe(1);
  });

  it("en kontext som redan har en principal (ett konto, senare) används som den är", async () => {
    const { lager, konto } = skapaDeladeFakes();
    const resultat = await skapaAnalys(
      lager,
      buildEnv(),
      { pdfBytes: await medTextPdf(), propertyInput },
      { anropare: skapaAnropare(konto, {}, { principalId: "konto-principal" }) },
    );
    if (!resultat.ok) throw new Error(resultat.errorMessage);
    expect((await lager.db.hamtaAnalys(resultat.analysisId))?.principalId).toBe("konto-principal");
    expect(konto.principaler.size).toBe(0);
  });

  it("enhetens dagskvot slut → kvot med enhetens meddelande, utan rad, uppladdning eller principal", async () => {
    const { lager, konto } = skapaDeladeFakes();
    for (let i = 0; i < UPPLADDNINGAR_PER_ENHET_OCH_DAG; i++) {
      await konto.taKvot(ENHET_NYCKEL, DAG_SEK, UPPLADDNINGAR_PER_ENHET_OCH_DAG);
    }
    const pdfBytes = await medTextPdf();

    const resultat = await skapaAnalys(
      lager,
      buildEnv(),
      { pdfBytes, propertyInput },
      { anropare: skapaAnropare(konto) },
    );

    expect(resultat).toEqual({
      ok: false,
      errorCode: "kvot",
      errorMessage: KVOT_MEDDELANDE.uppladdningEnhet,
    });
    expect(lager.db._allaAnalyser()).toHaveLength(0);
    expect(lager.db._allaRapporter()).toHaveLength(0);
    expect(await lager.filer.finns(`${await sha256Hex(pdfBytes)}.pdf`)).toBe(false);
    expect(konto.principaler.size).toBe(0);
    expect(kvotAnvand(konto, IP_NYCKEL)).toBe(0);
  });

  it("nätverkets dagskvot slut → kvot med nätverkets meddelande, och enhetens användning lämnas tillbaka", async () => {
    const { lager, konto } = skapaDeladeFakes();
    for (let i = 0; i < UPPLADDNINGAR_PER_IP_OCH_DAG; i++) {
      await konto.taKvot(IP_NYCKEL, DAG_SEK, UPPLADDNINGAR_PER_IP_OCH_DAG);
    }

    const resultat = await skapaAnalys(
      lager,
      buildEnv(),
      { pdfBytes: await medTextPdf(), propertyInput },
      { anropare: skapaAnropare(konto) },
    );

    expect(resultat).toMatchObject({
      ok: false,
      errorCode: "kvot",
      errorMessage: KVOT_MEDDELANDE.uppladdningIp,
    });
    expect(lager.db._allaAnalyser()).toHaveLength(0);
    expect(kvotAnvand(konto, ENHET_NYCKEL)).toBe(0);
  });

  it("den sjätte uppladdningen samma dag nekas — de fem första (olika rapporter) går igenom", async () => {
    const { lager, konto } = skapaDeladeFakes();
    const anropare = skapaAnropare(konto);
    for (let i = 0; i < UPPLADDNINGAR_PER_ENHET_OCH_DAG; i++) {
      const pdfBytes = await unikTextPdf(i);
      const ok = await skapaAnalys(lager, buildEnv(), { pdfBytes, propertyInput }, { anropare });
      expect(ok.ok).toBe(true);
    }
    const sjatte = await skapaAnalys(
      lager,
      buildEnv(),
      { pdfBytes: await unikTextPdf(99), propertyInput },
      { anropare },
    );
    expect(sjatte).toMatchObject({ ok: false, errorCode: "kvot" });
    expect(lager.db._allaAnalyser()).toHaveLength(UPPLADDNINGAR_PER_ENHET_OCH_DAG);
  });

  it("en uppladdning som bara ansluter till en rapport som redan analyseras (vantarPaRapport) ger tillbaka kvoten — ingen ny kostnad uppstår", async () => {
    const { lager, konto } = skapaDeladeFakes();
    const anropare = skapaAnropare(konto);
    const pdfBytes = await medTextPdf();

    const forsta = await skapaAnalys(lager, buildEnv(), { pdfBytes, propertyInput }, { anropare });
    expect(forsta).toMatchObject({ ok: true });
    expect(kvotAnvand(konto, ENHET_NYCKEL)).toBe(1);

    for (let i = 0; i < 3; i++) {
      const vantar = await skapaAnalys(
        lager,
        buildEnv(),
        { pdfBytes, propertyInput },
        { anropare },
      );
      expect(vantar).toMatchObject({ ok: true, vantarPaRapport: true });
    }
    // Bara den första (som startade en riktig analys) räknas, varken per enhet eller IP.
    expect(kvotAnvand(konto, ENHET_NYCKEL)).toBe(1);
    expect(kvotAnvand(konto, IP_NYCKEL)).toBe(1);
    expect(lager.db._allaRapporter()).toHaveLength(1);
    expect(lager.db._allaAnalyser()).toHaveLength(4);
  });

  it("en uppladdning som serveras direkt ur registret (ateranvand) ger tillbaka kvoten", async () => {
    const { lager, konto } = skapaDeladeFakes();
    const anropare = skapaAnropare(konto);
    const pdfBytes = await medTextPdf();

    const forsta = await skapaAnalys(lager, buildEnv(), { pdfBytes, propertyInput }, { anropare });
    if (!forsta.ok) throw new Error(forsta.errorMessage);
    const forstaRad = await lager.db.hamtaAnalys(forsta.analysisId);
    await lager.db.uppdateraRapport(forstaRad?.rapportId ?? "", {
      status: "done",
      stage: "klar",
      extraction: extraktion,
      judgement: minimalJudgement(),
      finishedAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(kvotAnvand(konto, ENHET_NYCKEL)).toBe(1);

    const andra = await skapaAnalys(lager, buildEnv(), { pdfBytes, propertyInput }, { anropare });
    expect(andra).toMatchObject({ ok: true, ateranvand: true });
    if (!andra.ok) throw new Error("unreachable");

    // Bara den första (som köade en riktig analys) räknas.
    expect(kvotAnvand(konto, ENHET_NYCKEL)).toBe(1);
    expect(kvotAnvand(konto, IP_NYCKEL)).toBe(1);
    // Raden finns ändå och tillhör köparen.
    expect((await lager.db.hamtaAnalys(andra.analysisId))?.principalId).toBe(
      forstaRad?.principalId,
    );
  });

  it("en identitets-träff med ANDRA bytes (inte exakt samma fil) ger inte tillbaka den stränga kvoten — bara en exakt hash-träff gör det", async () => {
    const { lager, konto } = skapaDeladeFakes();
    const anropare = skapaAnropare(konto);
    const identitet = { orgnr: "769616-0253", rakenskapsar: 2025, namn: "Brf Kastanjen" };
    const beroenden = {
      anropare,
      identifieraLokalt: () => ({ identitet, orgnrKandidater: [], arKandidater: [], skal: [] }),
      namnLiknar: (a: string, b: string) => a === b,
    };
    const forsta = await skapaAnalys(
      lager,
      buildEnv(),
      { pdfBytes: await unikTextPdf(1), propertyInput },
      beroenden,
    );
    if (!forsta.ok) throw new Error(forsta.errorMessage);
    const rad = await lager.db.hamtaAnalys(forsta.analysisId);
    await lager.db.uppdateraRapport(rad?.rapportId ?? "", {
      status: "done",
      stage: "klar",
      extraction: extraktion,
      judgement: minimalJudgement(),
      finishedAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(kvotAnvand(konto, ENHET_NYCKEL)).toBe(1);

    // Same report, other bytes: served instantly, but the strict quota stays taken.
    const andra = await skapaAnalys(
      lager,
      buildEnv(),
      { pdfBytes: await unikTextPdf(2), propertyInput },
      beroenden,
    );
    expect(andra).toMatchObject({ ok: true, ateranvand: true });
    expect(kvotAnvand(konto, ENHET_NYCKEL)).toBe(2);
    expect(kvotAnvand(konto, IP_NYCKEL)).toBe(2);

    // Exactly the same file again: refunded.
    const tredje = await skapaAnalys(
      lager,
      buildEnv(),
      { pdfBytes: await unikTextPdf(2), propertyInput },
      beroenden,
    );
    expect(tredje).toMatchObject({ ok: true, ateranvand: true });
    expect(kvotAnvand(konto, ENHET_NYCKEL)).toBe(2);
  });

  it("den lösa kvoten återlämnas aldrig: 30 gratis-uppladdningar av samma klara rapport från en enhet, sedan nekas den 31:a", async () => {
    const { lager, konto } = skapaDeladeFakes();
    const anropare = skapaAnropare(konto);
    const pdfBytes = await medTextPdf();
    const forsta = await skapaAnalys(lager, buildEnv(), { pdfBytes, propertyInput }, { anropare });
    if (!forsta.ok) throw new Error(forsta.errorMessage);
    const rad = await lager.db.hamtaAnalys(forsta.analysisId);
    await lager.db.uppdateraRapport(rad?.rapportId ?? "", {
      status: "done",
      stage: "klar",
      extraction: extraktion,
      judgement: minimalJudgement(),
      finishedAt: new Date(Date.now() - 1000).toISOString(),
    });
    for (let i = 0; i < 29; i++) {
      const r = await skapaAnalys(lager, buildEnv(), { pdfBytes, propertyInput }, { anropare });
      expect(r).toMatchObject({ ok: true, ateranvand: true });
    }
    expect(kvotAnvand(konto, ENHET_NYCKEL)).toBe(1); // strict: refunded each time
    const trettioforsta = await skapaAnalys(
      lager,
      buildEnv(),
      { pdfBytes, propertyInput },
      { anropare },
    );
    expect(trettioforsta).toMatchObject({
      ok: false,
      errorCode: "kvot",
      errorMessage: KVOT_MEDDELANDE.uppladdningEnhetTotalt,
    });
  });

  it("ett oväntat kast efter att kvoten tagits ger tillbaka den (stränga och lösa) och kastar vidare", async () => {
    const { lager, konto } = skapaDeladeFakes();
    const anropare = skapaAnropare(konto);
    lager.filer.laggUpp = async () => {
      throw new Error("Supabase Storage: intern detalj");
    };
    await expect(
      skapaAnalys(lager, buildEnv(), { pdfBytes: await medTextPdf(), propertyInput }, { anropare }),
    ).rejects.toThrow("Supabase Storage: intern detalj");
    expect([...konto.kvot.values()].reduce((summa, r) => summa + r.antal, 0)).toBe(0);
    expect(lager.db._allaAnalyser()).toHaveLength(0);
  });

  describe("dagens spend-tak och hash-träffar", () => {
    async function medKlarRapport() {
      const { lager, konto } = skapaDeladeFakes();
      const pdfBytes = await medTextPdf();
      const forsta = await skapaAnalys(lager, buildEnv(), { pdfBytes, propertyInput });
      if (!forsta.ok) throw new Error(forsta.errorMessage);
      const rad = await lager.db.hamtaAnalys(forsta.analysisId);
      await lager.db.uppdateraRapport(rad?.rapportId ?? "", {
        status: "done",
        stage: "klar",
        extraction: extraktion,
        judgement: minimalJudgement(),
        finishedAt: new Date(Date.now() - 1000).toISOString(),
      });
      return { lager, konto, pdfBytes, rapportId: rad?.rapportId ?? "" };
    }

    /** Dagens spend över taket (10) — samma datum som spend.ts använder. */
    async function fyllDagensTak(lager: ReturnType<typeof skapaFakeLager>) {
      const idag = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Stockholm" }).format(
        new Date(),
      );
      await lager.db.reserveraSpend(idag, 50, 100);
    }

    it("en hash-träff på en klar, kompatibel rapport nekas INTE av dagens tak (det kostar inget) — och tar ingen kvot", async () => {
      const { lager, konto, pdfBytes } = await medKlarRapport();
      await fyllDagensTak(lager);
      const resultat = await skapaAnalys(
        lager,
        buildEnv({ maxDailySpendSek: 10 }),
        { pdfBytes, propertyInput },
        { anropare: skapaAnropare(konto) },
      );
      expect(resultat).toMatchObject({ ok: true, ateranvand: true });
      expect(kvotAnvand(konto, ENHET_NYCKEL)).toBe(0);
    });

    it("samma sak utan anropare (operatörens CLI)", async () => {
      const { lager, pdfBytes } = await medKlarRapport();
      await fyllDagensTak(lager);
      const resultat = await skapaAnalys(lager, buildEnv({ maxDailySpendSek: 10 }), {
        pdfBytes,
        propertyInput,
      });
      expect(resultat).toMatchObject({ ok: true, ateranvand: true });
    });

    it("en NY PDF nekas fortfarande av taket, med samma tak som träffen slapp igenom", async () => {
      const { lager, konto } = await medKlarRapport();
      await fyllDagensTak(lager);
      const nekad = await skapaAnalys(
        lager,
        buildEnv({ maxDailySpendSek: 10 }),
        { pdfBytes: await unikTextPdf(7), propertyInput },
        { anropare: skapaAnropare(konto) },
      );
      expect(nekad).toMatchObject({ ok: false, errorCode: "daily_cap" });
      expect(kvotAnvand(konto, ENHET_NYCKEL)).toBe(0);
    });

    it("en hash-träff på en rapport som INTE går att servera (klar men oläsbar → en omkörning skulle kosta) nekas av taket", async () => {
      const { lager, pdfBytes, rapportId } = await medKlarRapport();
      await lager.db.uppdateraRapport(rapportId, { extraction: { trasig: true } });
      const resultat = await skapaAnalys(lager, buildEnv({ maxDailySpendSek: 0 }), {
        pdfBytes,
        propertyInput,
      });
      expect(resultat).toMatchObject({ ok: false, errorCode: "daily_cap" });
    });

    it("en hash-träff på en rapport som fortfarande pågår nekas av taket (den kan inte serveras direkt)", async () => {
      const lager = skapaFakeLager();
      const pdfBytes = await medTextPdf();
      await skapaAnalys(lager, buildEnv(), { pdfBytes, propertyInput });
      const resultat = await skapaAnalys(lager, buildEnv({ maxDailySpendSek: 0 }), {
        pdfBytes,
        propertyInput,
      });
      expect(resultat).toMatchObject({ ok: false, errorCode: "daily_cap" });
    });

    it("kill switch gäller även för en hash-träff", async () => {
      const { lager, pdfBytes } = await medKlarRapport();
      const resultat = await skapaAnalys(lager, buildEnv({ killSwitchPa: true }), {
        pdfBytes,
        propertyInput,
      });
      expect(resultat).toMatchObject({ ok: false });
    });
  });

  it("utan IP (lokal utveckling) tas och återlämnas bara enhetens kvot", async () => {
    const { lager, konto } = skapaDeladeFakes();
    const anropare = skapaAnropare(konto, {}, { ipHash: null });
    const resultat = await skapaAnalys(
      lager,
      buildEnv(),
      { pdfBytes: await medTextPdf(), propertyInput },
      { anropare },
    );
    expect(resultat.ok).toBe(true);
    expect(kvotAnvand(konto, ENHET_NYCKEL)).toBe(1);
    expect([...konto.kvot.values()].every((r) => !r.nyckel.includes(":ip:"))).toBe(true);
  });

  it("dagens spend-tak redan nått → daily_cap direkt, utan rad, uppladdning eller förbrukad kvot", async () => {
    const { lager, konto } = skapaDeladeFakes();
    const pdfBytes = await medTextPdf();

    const resultat = await skapaAnalys(
      lager,
      buildEnv({ maxDailySpendSek: 0 }),
      { pdfBytes, propertyInput },
      { anropare: skapaAnropare(konto) },
    );

    expect(resultat).toMatchObject({ ok: false, errorCode: "daily_cap" });
    expect(lager.db._allaAnalyser()).toHaveLength(0);
    expect(await lager.filer.finns(`${await sha256Hex(pdfBytes)}.pdf`)).toBe(false);
    expect(konto.kvot.size).toBe(0);
    expect(konto.principaler.size).toBe(0);
  });

  it("spend-taket gäller även utan anropare (operatörens CLI) — och reserverar ingenting", async () => {
    const lager = skapaFakeLager();
    const resultat = await skapaAnalys(lager, buildEnv({ maxDailySpendSek: 0 }), {
      pdfBytes: await medTextPdf(),
      propertyInput,
    });
    expect(resultat).toMatchObject({ ok: false, errorCode: "daily_cap" });
  });

  it("utan anropare (CLI): ingen principal på raden, inga kontokontroller", async () => {
    const lager = skapaFakeLager();
    const resultat = await skapaAnalys(lager, buildEnv(), {
      pdfBytes: await medTextPdf(),
      propertyInput,
    });
    if (!resultat.ok) throw new Error(resultat.errorMessage);
    expect((await lager.db.hamtaAnalys(resultat.analysisId))?.principalId).toBeNull();
  });
});

describe("hamtaResultat med anropare", () => {
  async function klarAnalys() {
    const { lager, konto } = skapaDeladeFakes();
    const anropare = skapaAnropare(konto);
    const skapad = await skapaAnalys(
      lager,
      buildEnv(),
      { pdfBytes: await medTextPdf(), propertyInput },
      { anropare },
    );
    if (!skapad.ok) throw new Error(skapad.errorMessage);
    const rad = await lager.db.hamtaAnalys(skapad.analysisId);
    await lager.db.uppdateraRapport(rad?.rapportId ?? "", {
      status: "done",
      stage: "klar",
      extraction: extraktion,
      judgement: minimalJudgement(),
      finishedAt: new Date().toISOString(),
    });
    return { lager, konto, analysisId: skapad.analysisId, rapportId: rad?.rapportId ?? null };
  }

  it("nekad behörighet (full_rapport) → SaknarBehorighetError, med radens rapportId i frågan", async () => {
    const { lager, konto, analysisId, rapportId } = await klarAnalys();
    const fragor: BehorighetsFraga[] = [];
    const anropare = skapaAnropare(konto, {
      full_rapport: (fraga) => {
        fragor.push(fraga);
        return false;
      },
    });

    await expect(hamtaResultat(lager, analysisId, anropare)).rejects.toBeInstanceOf(
      SaknarBehorighetError,
    );
    expect(fragor).toHaveLength(1);
    expect(fragor[0]?.formaga).toBe("full_rapport");
    expect(fragor[0]?.rapportId).toBe(rapportId);
  });

  it("ett okänt id ger fortfarande AnalysHittadesInteError (inte ett behörighetsfel)", async () => {
    const { lager, konto } = skapaDeladeFakes();
    const anropare = skapaAnropare(konto, { full_rapport: () => false });
    await expect(hamtaResultat(lager, "finns-inte", anropare)).rejects.toBeInstanceOf(
      AnalysHittadesInteError,
    );
  });

  it("beviljad → samma resultat som utan anropare, och läsningen tar ingen kvot", async () => {
    const { lager, konto, analysisId } = await klarAnalys();
    const fore = JSON.stringify([...konto.kvot.values()]);

    const resultat = await hamtaResultat(lager, analysisId, skapaAnropare(konto));
    expect(AnalysisResultSchema.safeParse(resultat).success).toBe(true);
    expect(JSON.stringify([...konto.kvot.values()])).toBe(fore);
  });
});
