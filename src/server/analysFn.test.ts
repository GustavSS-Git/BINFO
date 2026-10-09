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

vi.mock("./supabase", () => ({ skapaLager: () => tillstand.lager }));
vi.mock("./supabaseKonto", () => ({ skapaKontoDatabas: () => tillstand.konto }));

const { skapaFakeLager } = await import("./__fakes__/lager");
const { skapaFakeKontoDatabas } = await import("./__fakes__/konto");
const { hashaIp, ENHET_COOKIE } = await import("./kontext");
const { kvotNyckel } = await import("./kvot");
const { extraktion } = await import("@/lib/analysis/__fixtures__/extraktion");
const {
  hamtaForhandsvisningFn,
  hamtaPrisuppskattningFn,
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

  it("status, förhandsvisning och full rapport tar ingen kvot", async () => {
    const analysisId = await klarAnalys();
    const fore = kvotTotalt();

    await hamtaStatusFn({ data: { analysisId } });
    await hamtaForhandsvisningFn({ data: { analysisId } });
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
      () => hamtaForhandsvisningFn({ data: { analysisId: "x" } }),
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
