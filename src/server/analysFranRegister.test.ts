import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extraktion } from "@/lib/analysis/__fixtures__/extraktion";
import { AnalysisResultSchema } from "@/lib/analysis/schema";
import { skapaFakeKontoDatabas, type FakeKontoDatabas } from "./__fakes__/konto";
import { skapaFakeLager, type FakeLager } from "./__fakes__/lager";
import { hamtaResultat, hamtaStatus, skapaAnalysFranRegister } from "./analys";
import { skapaBehorighet, STANDARD_POLICY, type Policy } from "./behorighet";
import type { Env } from "./env";
import { tolkaSpendSkal } from "./fel";
import type { Kontext } from "./kontext";
import { kvotNyckel } from "./kvot";
import type { Anropare } from "./portar";
import { ALDRE_VERSION_SKAL, PIPELINE_VERSION, uppdateraRegisterForOrgnr } from "./register";

const here = path.dirname(fileURLToPath(import.meta.url));
const { input: propertyInput } = JSON.parse(
  await readFile(path.join(here, "..", "..", "fixtures", "property-input-example.json"), "utf-8"),
) as { input: Record<string, unknown> };

const ORGNR = "716420-0599";
const ENHET = "AAAAAAAAAAAAAAAAAAAAAA";
const IP_HASH = "ab".repeat(32);

function buildEnv(overrides: Partial<Env> = {}): Env {
  return {
    supabaseUrl: "https://example.supabase.co",
    supabaseSecretKey: "secret",
    maxDailySpendSek: 100,
    killSwitchPa: false,
    anthropicApiKey: "test-key",
    anthropicModel: "claude-sonnet-5-5",
    maxCostPerAnalysisSek: 5,
    effortGrounding: "medium",
    effortExtraction: "medium",
    effortJudging: "medium",
    ...overrides,
  };
}

function skapaAnropare(konto: FakeKontoDatabas, policy: Partial<Policy> = {}): Anropare {
  const kontext: Kontext = { enhetId: ENHET, principalId: null, ipHash: IP_HASH };
  return { kontext, konto, behorighet: skapaBehorighet({ ...STANDARD_POLICY, ...policy }) };
}

function anvand(konto: FakeKontoDatabas, nyckel: string): number {
  let summa = 0;
  for (const rad of konto.kvot.values()) if (rad.nyckel === nyckel) summa += rad.antal;
  return summa;
}

/** A listed BRF (Kungsholmen via postnummer 112 42) with one done rapport + its PDF row. */
async function laggBrf(
  lager: FakeLager,
  o: {
    pipeline?: string;
    status?: "done" | "failed";
    postnummer?: string;
    /** Store the PDF bytes too (needed for a re-run). */
    pdf?: boolean;
  } = {},
) {
  await lager.db.registreraForening(ORGNR, "Brf Pontonjären 3");
  const r = await lager.db.skapaRapport({
    orgnr: ORGNR,
    rakenskapsar: 2025,
    pipelineVersion: o.pipeline ?? PIPELINE_VERSION,
    model: "m",
    textlager: "ok",
    status: o.status ?? "done",
    stage: "klar",
    pdfHash: "brf-hash",
    extraction: {
      ...extraktion,
      forening: {
        ...extraktion.forening,
        namn: "Brf Pontonjären 3",
        orgnr: ORGNR,
        adresser: [
          {
            gatuadress: "Testgatan 1",
            postnummer: o.postnummer ?? "112 42",
            ort: "Stockholm",
            ref: { page: 2, excerpt: "Testgatan 1" },
          },
        ],
      },
    },
    judgement: { betyg: "C", betygMotivering: "Motivering.", rodaFlaggor: [], fragor: [] },
    finishedAt: "2026-10-13T10:00:00.000Z",
  });
  if (!r.ok) throw new Error("rapport");
  await lager.db.skapaRapportFil({
    pdfHash: "brf-hash",
    rapportId: r.id,
    pdfPath: "brf-hash.pdf",
    sidor: 10,
    bytes: 1000,
  });
  if (o.pdf) await lager.filer.laggUpp("brf-hash.pdf", new TextEncoder().encode("%PDF-1.7 test"));
  await uppdateraRegisterForOrgnr(lager.db, ORGNR);
  const slug = (await lager.db._registerLasning().hamtaForeningViaOrgnr(ORGNR))?.slug;
  return { rapportId: r.id, slug: slug ?? "" };
}

function uppsattning() {
  const lager = skapaFakeLager();
  const konto = skapaFakeKontoDatabas({ analyser: lager.db._analysTabell() });
  const anropare = skapaAnropare(konto);
  const lasning = lager.db._registerLasning();
  return { lager, konto, anropare, lasning };
}

afterEach(() => vi.restoreAllMocks());

describe("skapaAnalysFranRegister", () => {
  it("lyckas: en länkad analys som är klar direkt och monteras med köparens uppgifter, utan API-anrop", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { lager, konto, anropare, lasning } = uppsattning();
    const { rapportId, slug } = await laggBrf(lager);
    expect(slug).not.toBe("");

    const svar = await skapaAnalysFranRegister(
      lager,
      buildEnv(),
      { slug, propertyInput: { ...propertyInput, orgnr: "" } },
      { anropare, lasning },
    );
    if (!svar.ok) throw new Error(svar.errorMessage);
    expect(svar.ateranvand).toBe(true);

    const rad = await lager.db.hamtaAnalys(svar.analysisId);
    expect(rad).toMatchObject({
      rapportId,
      pdfHash: "brf-hash",
      pdfPath: "brf-hash.pdf",
      status: "queued",
      stage: "uploaded",
    });
    expect(rad?.principalId).not.toBeNull();
    expect(rad?.propertyInput.orgnr).toBe(ORGNR);
    expect(konto.principaler.size).toBe(1);

    const status = await hamtaStatus(lager, svar.analysisId);
    expect(status).toMatchObject({ status: "done", stage: "complete", vantarPaRapport: false });

    const resultat = await hamtaResultat(lager, svar.analysisId, anropare);
    expect(AnalysisResultSchema.safeParse(resultat).success).toBe(true);
    expect(resultat.input.adress).toBe(propertyInput["adress"]);
    expect(resultat.input.utgangspris).toBe(propertyInput["utgangspris"]);
    expect(resultat.betyg).toBe("C");

    // No upload, no model call.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await lager.filer.finns("brf-hash.pdf")).toBe(false);
  });

  it("tar bara den lösa kvoten; den strikta lämnas orörd", async () => {
    const { lager, konto, anropare, lasning } = uppsattning();
    const { slug } = await laggBrf(lager);
    const ok = await skapaAnalysFranRegister(
      lager,
      buildEnv(),
      { slug, propertyInput },
      { anropare, lasning },
    );
    expect(ok.ok).toBe(true);
    expect(anvand(konto, kvotNyckel("uppladdning_los", "enhet", ENHET))).toBe(1);
    expect(anvand(konto, kvotNyckel("uppladdning_los", "ip", IP_HASH))).toBe(1);
    expect(anvand(konto, kvotNyckel("uppladdning", "enhet", ENHET))).toBe(0);
    expect(anvand(konto, kvotNyckel("uppladdning", "ip", IP_HASH))).toBe(0);
  });

  it("nekas när den lösa kvoten är slut, utan rad", async () => {
    const { lager, konto, anropare, lasning } = uppsattning();
    const { slug } = await laggBrf(lager);
    const nyckel = kvotNyckel("uppladdning_los", "enhet", ENHET);
    for (let i = 0; i < 30; i++) await konto.taKvot(nyckel, 24 * 3600, 30);
    const svar = await skapaAnalysFranRegister(
      lager,
      buildEnv(),
      { slug, propertyInput },
      { anropare, lasning },
    );
    expect(svar).toMatchObject({ ok: false, errorCode: "kvot" });
    expect(lager.db._allaAnalyser()).toHaveLength(0);
    expect(anvand(konto, kvotNyckel("uppladdning_los", "ip", IP_HASH))).toBe(0);
  });

  it("nekas för en okänd slug", async () => {
    const { lager, anropare, lasning } = uppsattning();
    await laggBrf(lager);
    const svar = await skapaAnalysFranRegister(
      lager,
      buildEnv(),
      { slug: "finns-inte", propertyInput },
      { anropare, lasning },
    );
    expect(svar).toMatchObject({ ok: false, errorCode: "validation" });
    expect(lager.db._allaAnalyser()).toHaveLength(0);
  });

  it("nekas för en förening som inte är listad (inget registerområde)", async () => {
    const { lager, anropare, lasning } = uppsattning();
    const { slug } = await laggBrf(lager, { postnummer: "999 99" });
    // Not listed in the public register: either no slug at all, or no area.
    const svar = await skapaAnalysFranRegister(
      lager,
      buildEnv(),
      { slug: slug || "brf-pontonjaren-3", propertyInput },
      { anropare, lasning },
    );
    expect(svar).toMatchObject({ ok: false, errorCode: "validation" });
    expect(lager.db._allaAnalyser()).toHaveLength(0);
  });

  it("nekas när det inte finns någon klar rapport", async () => {
    const { lager, anropare, lasning } = uppsattning();
    const { slug } = await laggBrf(lager);
    // Tombstone the only rapport: it is no longer done.
    const [rapport] = await lager.db.listaRapporter({ orgnr: ORGNR });
    await lager.db.uppdateraRapport(rapport!.id, { status: "failed" });
    const svar = await skapaAnalysFranRegister(
      lager,
      buildEnv(),
      { slug, propertyInput },
      { anropare, lasning },
    );
    expect(svar).toMatchObject({ ok: false, errorCode: "validation" });
    expect(lager.db._allaAnalyser()).toHaveLength(0);
  });

  it("nekas för en rapport som inte går att tolka med den körande koden", async () => {
    const { lager, anropare, lasning } = uppsattning();
    const { slug, rapportId } = await laggBrf(lager);
    await lager.db.uppdateraRapport(rapportId, { extraction: { trasig: true } });
    const svar = await skapaAnalysFranRegister(
      lager,
      buildEnv(),
      { slug, propertyInput },
      { anropare, lasning },
    );
    expect(svar).toMatchObject({ ok: false, errorCode: "validation" });
  });

  it("avvisar ogiltiga objektsuppgifter utan rad eller kvot", async () => {
    const { lager, konto, anropare, lasning } = uppsattning();
    const { slug } = await laggBrf(lager);
    const svar = await skapaAnalysFranRegister(
      lager,
      buildEnv(),
      { slug, propertyInput: { ...propertyInput, boarea: "stor", extra: 1 } },
      { anropare, lasning },
    );
    expect(svar).toMatchObject({ ok: false, errorCode: "validation" });
    expect(lager.db._allaAnalyser()).toHaveLength(0);
    expect(konto.kvot.size).toBe(0);
  });

  it("nekad behörighet ger behorighet utan sidoeffekter", async () => {
    const { lager, konto, lasning } = uppsattning();
    const { slug } = await laggBrf(lager);
    const svar = await skapaAnalysFranRegister(
      lager,
      buildEnv(),
      { slug, propertyInput },
      { anropare: skapaAnropare(konto, { ladda_upp_analys: () => false }), lasning },
    );
    expect(svar).toMatchObject({ ok: false, errorCode: "behorighet" });
    expect(lager.db._allaAnalyser()).toHaveLength(0);
    expect(konto.kvot.size).toBe(0);
    expect(konto.principaler.size).toBe(0);
  });

  it("respekterar kill switchen utan sidoeffekter", async () => {
    const { lager, konto, anropare, lasning } = uppsattning();
    const { slug } = await laggBrf(lager);
    const svar = await skapaAnalysFranRegister(
      lager,
      buildEnv({ killSwitchPa: true }),
      { slug, propertyInput },
      { anropare, lasning },
    );
    expect(svar.ok).toBe(false);
    expect(svar).toEqual(
      expect.objectContaining({ errorMessage: tolkaSpendSkal("kill_switch").message }),
    );
    expect(lager.db._allaAnalyser()).toHaveLength(0);
    expect(konto.kvot.size).toBe(0);
  });

  it("registrerar köparens postnummer som områdesbevis", async () => {
    const { lager, anropare, lasning } = uppsattning();
    const { slug } = await laggBrf(lager);
    const spy = vi.spyOn(lager.db, "registreraForeningAdress");
    await skapaAnalysFranRegister(
      lager,
      buildEnv(),
      { slug, propertyInput },
      { anropare, lasning },
    );
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ orgnr: ORGNR, kalla: "anvandare" }));
  });

  it("på aktuell version skapas ingen ny rapport (gratis, ingen omkörning)", async () => {
    const { lager, anropare, lasning } = uppsattning();
    const { slug } = await laggBrf(lager, { pdf: true });
    const svar = await skapaAnalysFranRegister(
      lager,
      buildEnv(),
      { slug, propertyInput },
      { anropare, lasning },
    );
    expect(svar).toMatchObject({ ok: true, ateranvand: true });
    expect(lager.db._allaRapporter()).toHaveLength(1);
  });
});

describe("skapaAnalysFranRegister — rapporten finns bara på en äldre version", () => {
  const GAMMAL = "p4.i1.s1";

  it("en begäran kör om på den lagrade PDF:en: ny rapport på aktuell version, strikt kvot, länkad, inte återanvänd", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { lager, konto, anropare, lasning } = uppsattning();
    const { rapportId: gammal, slug } = await laggBrf(lager, { pipeline: GAMMAL, pdf: true });

    const svar = await skapaAnalysFranRegister(
      lager,
      buildEnv(),
      { slug, propertyInput },
      { anropare, lasning },
    );
    if (!svar.ok) throw new Error(svar.errorMessage);
    expect(svar).toEqual({ ok: true, analysisId: svar.analysisId });

    const rad = await lager.db.hamtaAnalys(svar.analysisId);
    expect(rad?.rapportId).not.toBe(gammal);
    expect(await lager.db.hamtaRapport(rad?.rapportId ?? "")).toMatchObject({
      orgnr: ORGNR,
      rakenskapsar: 2025,
      pipelineVersion: PIPELINE_VERSION,
      pdfHash: "brf-hash",
      status: "queued",
      stage: "grundning",
      model: "claude-sonnet-5-5",
    });
    expect(rad).toMatchObject({ pdfHash: "brf-hash", pdfPath: "brf-hash.pdf" });
    expect(anvand(konto, kvotNyckel("uppladdning", "enhet", ENHET))).toBe(1);
    expect(anvand(konto, kvotNyckel("uppladdning", "ip", IP_HASH))).toBe(1);
    expect(anvand(konto, kvotNyckel("uppladdning_los", "enhet", ENHET))).toBe(1);
    expect(await hamtaStatus(lager, svar.analysisId)).toMatchObject({ status: "queued" });
    // The old one is untouched and still what the public register serves.
    expect(await lager.db.hamtaRapport(gammal)).toMatchObject({
      status: "done",
      pipelineVersion: GAMMAL,
    });
    // Queued only: the model is called by the worker, not here.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("dagens spend-tak nekar omkörningen utan sidoeffekter", async () => {
    const { lager, konto, anropare, lasning } = uppsattning();
    const { slug } = await laggBrf(lager, { pipeline: GAMMAL, pdf: true });
    const svar = await skapaAnalysFranRegister(
      lager,
      buildEnv({ maxDailySpendSek: 0 }),
      { slug, propertyInput },
      { anropare, lasning },
    );
    expect(svar).toMatchObject({ ok: false, errorCode: "daily_cap" });
    expect(lager.db._allaRapporter()).toHaveLength(1);
    expect(lager.db._allaAnalyser()).toHaveLength(0);
    expect(konto.kvot.size).toBe(0);
    expect(konto.principaler.size).toBe(0);
  });

  it("den strikta kvoten nekar omkörningen utan att köa något", async () => {
    const { lager, konto, anropare, lasning } = uppsattning();
    const { slug } = await laggBrf(lager, { pipeline: GAMMAL, pdf: true });
    const nyckel = kvotNyckel("uppladdning", "enhet", ENHET);
    for (let i = 0; i < 5; i++) await konto.taKvot(nyckel, 24 * 3600, 5);
    const svar = await skapaAnalysFranRegister(
      lager,
      buildEnv(),
      { slug, propertyInput },
      { anropare, lasning },
    );
    expect(svar).toMatchObject({ ok: false, errorCode: "kvot" });
    expect(lager.db._allaRapporter()).toHaveLength(1);
    expect(lager.db._allaAnalyser()).toHaveLength(0);
  });

  it("kill switchen nekar omkörningen utan sidoeffekter", async () => {
    const { lager, konto, anropare, lasning } = uppsattning();
    const { slug } = await laggBrf(lager, { pipeline: GAMMAL, pdf: true });
    const svar = await skapaAnalysFranRegister(
      lager,
      buildEnv({ killSwitchPa: true }),
      { slug, propertyInput },
      { anropare, lasning },
    );
    expect(svar).toMatchObject({ ok: false });
    expect(lager.db._allaRapporter()).toHaveLength(1);
    expect(konto.kvot.size).toBe(0);
  });

  it("ett kast efter kvoten lämnar tillbaka både den strikta och den lösa kvoten", async () => {
    const { lager, konto, anropare, lasning } = uppsattning();
    const { slug } = await laggBrf(lager, { pipeline: GAMMAL, pdf: true });
    lager.db.skapaAnalys = async () => {
      throw new Error("db nere");
    };
    await expect(
      skapaAnalysFranRegister(lager, buildEnv(), { slug, propertyInput }, { anropare, lasning }),
    ).rejects.toThrow("db nere");
    expect(anvand(konto, kvotNyckel("uppladdning", "enhet", ENHET))).toBe(0);
    expect(anvand(konto, kvotNyckel("uppladdning_los", "enhet", ENHET))).toBe(0);
  });

  it("utan lagrad PDF: den gamla rapporten länkas och serveras som lagrad, gratis (bara den lösa kvoten)", async () => {
    const { lager, konto, anropare, lasning } = uppsattning();
    const { rapportId: gammal, slug } = await laggBrf(lager, { pipeline: GAMMAL });
    const svar = await skapaAnalysFranRegister(
      lager,
      buildEnv({ maxDailySpendSek: 0 }),
      { slug, propertyInput },
      { anropare, lasning },
    );
    if (!svar.ok) throw new Error(svar.errorMessage);
    expect(svar.ateranvand).toBe(true);
    expect((await lager.db.hamtaAnalys(svar.analysisId))?.rapportId).toBe(gammal);
    expect(lager.db._allaRapporter()).toHaveLength(1);
    expect(anvand(konto, kvotNyckel("uppladdning", "enhet", ENHET))).toBe(0);
    expect(anvand(konto, kvotNyckel("uppladdning_los", "enhet", ENHET))).toBe(1);
    const resultat = await hamtaResultat(lager, svar.analysisId, anropare);
    expect(resultat.datakvalitet.extraktionKonfidens.skal).toContain(ALDRE_VERSION_SKAL);
    expect(resultat.betyg).toBe("C");
  });

  it("en omkörning som redan pågår: ansluter till den, väntar, och den strikta kvoten lämnas tillbaka", async () => {
    const { lager, konto, anropare, lasning } = uppsattning();
    const { slug } = await laggBrf(lager, { pipeline: GAMMAL, pdf: true });
    const forsta = await skapaAnalysFranRegister(
      lager,
      buildEnv(),
      { slug, propertyInput },
      { anropare, lasning },
    );
    if (!forsta.ok) throw new Error(forsta.errorMessage);
    const andra = await skapaAnalysFranRegister(
      lager,
      buildEnv(),
      { slug, propertyInput },
      { anropare, lasning },
    );
    if (!andra.ok) throw new Error(andra.errorMessage);
    expect(andra).toEqual({ ok: true, analysisId: andra.analysisId, vantarPaRapport: true });
    expect(lager.db._allaRapporter()).toHaveLength(2);
    const [a, b] = await Promise.all(
      [forsta.analysisId, andra.analysisId].map((id) => lager.db.hamtaAnalys(id)),
    );
    expect(a?.rapportId).toBe(b?.rapportId);
    expect(anvand(konto, kvotNyckel("uppladdning", "enhet", ENHET))).toBe(1);
  });

  it("en tidigare misslyckad omkörning blockerar inte en ny begäran", async () => {
    const { lager, anropare, lasning } = uppsattning();
    const { slug } = await laggBrf(lager, { pipeline: GAMMAL, pdf: true });
    const forsta = await skapaAnalysFranRegister(
      lager,
      buildEnv(),
      { slug, propertyInput },
      { anropare, lasning },
    );
    if (!forsta.ok) throw new Error(forsta.errorMessage);
    const forstaKorning = (await lager.db.hamtaAnalys(forsta.analysisId))?.rapportId ?? "";
    await lager.db.uppdateraRapport(forstaKorning, {
      status: "failed",
      errorCode: "validation",
      finishedAt: new Date().toISOString(),
    });
    const andra = await skapaAnalysFranRegister(
      lager,
      buildEnv(),
      { slug, propertyInput },
      { anropare, lasning },
    );
    if (!andra.ok) throw new Error(andra.errorMessage);
    const andraKorning = (await lager.db.hamtaAnalys(andra.analysisId))?.rapportId ?? "";
    expect(andraKorning).not.toBe(forstaKorning);
    expect(await lager.db.hamtaRapport(andraKorning)).toMatchObject({
      status: "queued",
      pipelineVersion: PIPELINE_VERSION,
    });
  });
});
