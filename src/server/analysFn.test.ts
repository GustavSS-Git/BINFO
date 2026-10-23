/**
 * Wiring tests for the thin TanStack Start binding (`analysFn.ts`): every
 * handler resolves the request context first, and the right ones pass a
 * full `Anropare` on. The checks themselves (entitlement, quota, principal)
 * are tested against the implementations in analys.test.ts and
 * prisuppskattning.test.ts; here only the binding is under test.
 *
 * `createServerFn` is replaced by a builder that returns the raw handler, and
 * the request helpers / Supabase factories by in-memory stand-ins — no live
 * request, no database.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import type { FakeLager } from "./__fakes__/lager";
import type { FakeKontoDatabas } from "./__fakes__/konto";

const tillstand = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  satta: [] as Array<{ namn: string; varde: string }>,
  headers: new Map<string, string>(),
  lager: null as unknown,
  konto: null as unknown,
  /** Overrides of the standard policy for one test (deny policy). */
  policy: {} as Record<string, () => boolean>,
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const builder = {
      inputValidator: () => builder,
      handler: (fn: unknown) => fn,
    };
    return builder;
  },
}));

vi.mock("@tanstack/react-start/server", () => ({
  getCookie: (namn: string) => tillstand.cookies.get(namn),
  setCookie: (namn: string, varde: string) => {
    tillstand.satta.push({ namn, varde });
    tillstand.cookies.set(namn, varde);
  },
  getRequestHeader: (namn: string) => tillstand.headers.get(namn),
}));

vi.mock("./env", () => ({
  envFromProcess: (): Env => ({
    supabaseUrl: "https://example.supabase.co",
    supabaseSecretKey: "test-hemlighet",
    maxDailySpendSek: 100,
    killSwitchPa: false,
    anthropicApiKey: "test-key",
    anthropicModel: "claude-sonnet-5",
    maxCostPerAnalysisSek: 5,
    effortGrounding: "medium",
    effortExtraction: "medium",
    effortJudging: "medium",
  }),
}));

vi.mock("./supabase", () => ({
  skapaLager: () => tillstand.lager,
  skapaRegisterLasning: () => (tillstand.lager as FakeLager).db._registerLasning(),
}));
vi.mock("./behorighet", async (importOriginal) => {
  const original = await importOriginal<typeof import("./behorighet")>();
  return {
    ...original,
    skapaBehorighet: () =>
      original.skapaBehorighet({ ...original.STANDARD_POLICY, ...tillstand.policy }),
  };
});
vi.mock("./supabaseKonto", () => ({ skapaKontoDatabas: () => tillstand.konto }));

const { skapaFakeLager } = await import("./__fakes__/lager");
const { skapaFakeKontoDatabas } = await import("./__fakes__/konto");
const { hashaIp, ENHET_COOKIE } = await import("./kontext");
const { kvotNyckel } = await import("./kvot");
const { extraktion } = await import("@/lib/analysis/__fixtures__/extraktion");
const { uppdateraRegisterForOrgnr } = await import("./register");
const { REGISTERANALYS_NEKAD_MEDDELANDE } = await import("./registerPublik");
const {
  hamtaPrisuppskattningFn,
  hamtaRegisterAnalysFn,
  hamtaResultatFn,
  hamtaStatusFn,
  skapaAnalysFn,
} = await import("./analysFn");

const here = path.dirname(fileURLToPath(import.meta.url));
const ENHET = "CCCCCCCCCCCCCCCCCCCCCC";
const IP = "203.0.113.7";

const propertyInputFixture: { input: unknown } = JSON.parse(
  await readFile(path.join(here, "..", "..", "fixtures", "property-input-example.json"), "utf-8"),
);

function lager(): FakeLager {
  return tillstand.lager as FakeLager;
}
function konto(): FakeKontoDatabas {
  return tillstand.konto as FakeKontoDatabas;
}

function kvotTotalt(): number {
  return [...konto().kvot.values()].reduce((summa, r) => summa + r.antal, 0);
}

async function formData(): Promise<FormData> {
  const pdf = await readFile(
    path.join(here, "..", "lib", "analysis", "__fixtures__", "med-text.pdf"),
  );
  const fd = new FormData();
  fd.set("pdf", new File([new Uint8Array(pdf)], "arsredovisning.pdf", { type: "application/pdf" }));
  fd.set("propertyInput", JSON.stringify(propertyInputFixture.input));
  return fd;
}

/** A finished analysis to read back, created through the real handler. */
async function klarAnalys(): Promise<string> {
  const svar = await skapaAnalysFn({ data: await formData() });
  if (!svar.ok) throw new Error(svar.errorMessage);
  const rad = await lager().db.hamtaAnalys(svar.analysisId);
  await lager().db.uppdateraRapport(rad?.rapportId ?? "", {
    status: "done",
    stage: "klar",
    extraction: extraktion,
    judgement: { betyg: "C", betygMotivering: "Test.", rodaFlaggor: [], fragor: [] },
    finishedAt: new Date().toISOString(),
  });
  return svar.analysisId;
}

beforeEach(() => {
  tillstand.cookies.clear();
  tillstand.satta.length = 0;
  tillstand.headers.clear();
  tillstand.headers.set("cf-connecting-ip", IP);
  tillstand.policy = {};
  const ny = skapaFakeLager();
  tillstand.lager = ny;
  tillstand.konto = skapaFakeKontoDatabas({ analyser: ny.db._analysTabell() });
});

describe("analysFn — kontext först i varje handler", () => {
  it("hamtaStatusFn sätter enhets-cookien vid första besöket men tar ingen kvot och skapar ingen principal", async () => {
    expect(await hamtaStatusFn({ data: { analysisId: "finns-inte" } })).toBeNull();
    expect(tillstand.satta.map((c) => c.namn)).toEqual([ENHET_COOKIE]);
    expect(konto().kvot.size).toBe(0);
    expect(konto().principaler.size).toBe(0);
  });

  it("skapaAnalysFn: principal_id från enhets-cookien, kvot på enheten och IP-hashen (aldrig rå IP)", async () => {
    tillstand.cookies.set(ENHET_COOKIE, ENHET);

    const svar = await skapaAnalysFn({ data: await formData() });
    if (!svar.ok) throw new Error(svar.errorMessage);

    const [principal] = [...konto().principaler.values()];
    expect(principal?.enhetId).toBe(ENHET);
    expect((await lager().db.hamtaAnalys(svar.analysisId))?.principalId).toBe(principal?.id);

    const ipHash = await hashaIp(IP, "test-hemlighet");
    const nycklar = [...konto().kvot.values()].map((r) => r.nyckel).sort();
    expect(nycklar).toEqual(
      [
        kvotNyckel("uppladdning", "enhet", ENHET),
        kvotNyckel("uppladdning", "ip", ipHash),
        kvotNyckel("uppladdning_los", "enhet", ENHET),
        kvotNyckel("uppladdning_los", "ip", ipHash),
      ].sort(),
    );
    expect(nycklar.join(" ")).not.toContain(IP);
    // Befintlig giltig cookie: ingen ny sätts.
    expect(tillstand.satta).toHaveLength(0);
  });

  it("status och full rapport tar ingen kvot", async () => {
    const analysisId = await klarAnalys();
    const fore = kvotTotalt();

    await hamtaStatusFn({ data: { analysisId } });
    const resultat = await hamtaResultatFn({ data: { analysisId } });

    expect(resultat.analysisId).toBe(analysisId);
    expect(kvotTotalt()).toBe(fore);
  });

  it("hamtaPrisuppskattningFn räknar en användning på IP-nyckeln", async () => {
    const svar = await hamtaPrisuppskattningFn({
      data: {
        boarea: 62,
        antalRum: 3,
        manadsavgift: 4200,
        postnummer: "11857",
        hiss: "ja",
        balkong: "nej",
      },
    });
    expect(svar.ok).toBe(true);
    const ipHash = await hashaIp(IP, "test-hemlighet");
    expect([...konto().kvot.values()]).toEqual([
      expect.objectContaining({ nyckel: kvotNyckel("prisuppskattning", "ip", ipHash), antal: 1 }),
    ]);
  });
});

describe("analysFn — inga interna feltexter når klienten", () => {
  const GENERISKT =
    "Analysen kunde inte slutföras på grund av ett internt fel. Försök igen, och kontakta oss om felet kvarstår.";

  it("skapaAnalysFn: ett oväntat kast (t.ex. Supabase) blir det generiska köparsäkra svaret, loggas på servern och tar ingen kvot", async () => {
    const logg = vi.spyOn(console, "error").mockImplementation(() => {});
    lager().filer.laggUpp = async () => {
      throw new Error("StorageApiError: bucket arsredovisningar hemlig-intern-detalj");
    };
    const svar = await skapaAnalysFn({ data: await formData() });
    expect(svar).toEqual({ ok: false, errorCode: "unknown", errorMessage: GENERISKT });
    expect(JSON.stringify(svar)).not.toMatch(/Storage|bucket|hemlig/);
    expect(logg).toHaveBeenCalledWith(
      expect.stringContaining("skapaAnalysFn"),
      expect.objectContaining({ message: expect.stringContaining("hemlig-intern-detalj") }),
    );
    expect(kvotTotalt()).toBe(0);
    logg.mockRestore();
  });

  it("skapaAnalysFn: ett fält som saknas i FormData ger också det generiska svaret", async () => {
    const logg = vi.spyOn(console, "error").mockImplementation(() => {});
    const svar = await skapaAnalysFn({ data: new FormData() });
    expect(svar).toEqual({ ok: false, errorCode: "unknown", errorMessage: GENERISKT });
    logg.mockRestore();
  });

  it("läs-handlers: ett okänt kast blir ett Error med bara det generiska meddelandet", async () => {
    const logg = vi.spyOn(console, "error").mockImplementation(() => {});
    lager().db.hamtaAnalys = async () => {
      throw new Error("hamtaAnalys misslyckades: relation analys does not exist");
    };
    for (const anrop of [
      () => hamtaStatusFn({ data: { analysisId: "x" } }),
      () => hamtaResultatFn({ data: { analysisId: "x" } }),
    ]) {
      const fel = await anrop().catch((e: unknown) => e);
      expect(fel).toBeInstanceOf(Error);
      expect((fel as Error).message).toBe(GENERISKT);
    }
    logg.mockRestore();
  });

  it("kända fel som klienten känner igen på namn passerar oförändrade (id saknas, inte klar, nekad behörighet)", async () => {
    const saknas = await hamtaResultatFn({ data: { analysisId: "finns-inte" } }).catch(
      (e: unknown) => e,
    );
    expect((saknas as Error).name).toBe("AnalysHittadesInteError");
    const { rad } = await (async () => {
      const svar = await skapaAnalysFn({ data: await formData() });
      if (!svar.ok) throw new Error(svar.errorMessage);
      return { rad: svar.analysisId };
    })();
    const inteKlar = await hamtaResultatFn({ data: { analysisId: rad } }).catch((e: unknown) => e);
    expect((inteKlar as Error).name).toBe("AnalysInteKlarError");
  });
});

describe("analysFn — hamtaRegisterAnalysFn", () => {
  const ORGNR = "716420-0599";
  const SLUG = "brf-pontonjaren-3-716420-0599";

  /** A listed BRF (Kungsholmen via 112 42) with one done rapport for 2025. */
  async function laggBrf() {
    const db = lager().db;
    await db.registreraForening(ORGNR, "Brf Pontonjären 3");
    const r = await db.skapaRapport({
      orgnr: ORGNR,
      rakenskapsar: 2025,
      pipelineVersion: "p1.i1.s1",
      model: "m",
      textlager: "ok",
      status: "done",
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
              postnummer: "112 42",
              ort: "Stockholm",
              ref: { page: 2, excerpt: "Testgatan 1" },
            },
          ],
        },
      },
      judgement: { betyg: "B", betygMotivering: "Motivering.", rodaFlaggor: [], fragor: [] },
      finishedAt: "2026-10-13T10:00:00.000Z",
    });
    if (!r.ok) throw new Error("rapport");
    await uppdateraRegisterForOrgnr(db, ORGNR);
  }

  it("löser kontexten först (enhets-cookien sätts), räknar registerkvoten på IP-hashen och skapar ingen principal", async () => {
    await laggBrf();
    const svar = await hamtaRegisterAnalysFn({ data: { slug: SLUG, ar: 2025 } });
    if (svar.status !== "ok") throw new Error(`förväntade ok, fick ${svar.status}`);
    // Served as stored: older version, its own grade, never re-run.
    expect(svar.vy.analys).toMatchObject({ rakenskapsar: 2025, betyg: "B", aldreVersion: true });
    expect(lager().db._allaRapporter()).toHaveLength(1);
    expect(tillstand.satta.map((c) => c.namn)).toEqual([ENHET_COOKIE]);
    expect(konto().principaler.size).toBe(0);
    const ipHash = await hashaIp(IP, "test-hemlighet");
    expect([...konto().kvot.values()]).toEqual([
      expect.objectContaining({ nyckel: `register:ip:${ipHash}`, antal: 1 }),
    ]);
  });

  it("ett år som inte är ett rimligt heltal ger saknas", async () => {
    await laggBrf();
    for (const ar of ["abc", 2025.5, 1066, null] as unknown as number[]) {
      expect(await hamtaRegisterAnalysFn({ data: { slug: SLUG, ar } })).toEqual({
        status: "saknas",
      });
    }
    // A numeric string (a route param) is fine.
    const svar = await hamtaRegisterAnalysFn({ data: { slug: SLUG, ar: "2025" as never } });
    expect(svar.status).toBe("ok");
  });

  it("neka-policy (se_registeranalys) → nekad med köparsäker text, utan kvot", async () => {
    await laggBrf();
    tillstand.policy = { se_registeranalys: () => false };
    const svar = await hamtaRegisterAnalysFn({ data: { slug: SLUG, ar: 2025 } });
    expect(svar).toEqual({ status: "nekad", meddelande: REGISTERANALYS_NEKAD_MEDDELANDE });
    expect(konto().kvot.size).toBe(0);
  });

  it("ett internt fel når aldrig klienten: bara det generiska meddelandet", async () => {
    const logg = vi.spyOn(console, "error").mockImplementation(() => {});
    lager().db._registerLasning = () => {
      throw new Error("relation register_sammanfattning hemlig-intern-detalj");
    };
    const fel = await hamtaRegisterAnalysFn({ data: { slug: SLUG, ar: 2025 } }).catch(
      (e: unknown) => e,
    );
    expect(fel).toBeInstanceOf(Error);
    expect((fel as Error).message).toBe(
      "Analysen kunde inte slutföras på grund av ett internt fel. Försök igen, och kontakta oss om felet kvarstår.",
    );
    expect(logg).toHaveBeenCalledWith(
      expect.stringContaining("hamtaRegisterAnalysFn"),
      expect.anything(),
    );
    logg.mockRestore();
  });
});
