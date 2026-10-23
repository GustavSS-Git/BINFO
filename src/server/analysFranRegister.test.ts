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
import { PIPELINE_VERSION, uppdateraRegisterForOrgnr } from "./register";

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
  o: { pipeline?: string; status?: "done" | "failed"; postnummer?: string } = {},
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
});
