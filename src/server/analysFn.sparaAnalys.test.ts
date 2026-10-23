/**
 * Wiring tests for the three "Spara analysen" handlers in `analysFn.ts`
 * (`hamtaSparstatusFn`, `forberedSparaAnalysFn`, `sparaAnalysFn`): the kontext
 * is resolved first, the marker cookie goes through the request's cookie
 * access, and no internal error text reaches the client. The rules themselves
 * are tested in ./sparaAnalys.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PropertyInput } from "@/types/analysis";
import type { Env } from "./env";
import type { FakeKontoDatabas } from "./__fakes__/konto";

const tillstand = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  satta: [] as Array<{ namn: string; varde: string }>,
  headers: new Map<string, string>(),
  konto: null as unknown,
  auth: null as unknown,
  medKonton: true,
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
    ...(tillstand.medKonton ? { supabasePublishableKey: "test-publishable" } : {}),
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
  skapaLager: () => {
    throw new Error("skapaLager ska inte anropas av sparfunktionerna");
  },
  skapaRegisterLasning: () => {
    throw new Error("skapaRegisterLasning ska inte anropas av sparfunktionerna");
  },
}));
vi.mock("./supabaseKonto", () => ({ skapaKontoDatabas: () => tillstand.konto }));
vi.mock("./supabaseAuth", () => ({ skapaAuthPort: () => tillstand.auth }));

const { skapaFakeKontoDatabas } = await import("./__fakes__/konto");
const { skapaFakeAuth } = await import("./__fakes__/auth");
const { ENHET_COOKIE } = await import("./kontext");
const { ACCESS_COOKIE, REFRESH_COOKIE, SPARA_COOKIE } = await import("./sessionCookies");
const { GENERISKT_FEL_MEDDELANDE } = await import("./fel");
const { forberedSparaAnalysFn, hamtaSparstatusFn, sparaAnalysFn } = await import("./analysFn");

const ENHET = "CCCCCCCCCCCCCCCCCCCCCC";
const ANALYS = "11111111-1111-4111-8111-111111111111";

function konto(): FakeKontoDatabas {
  return tillstand.konto as FakeKontoDatabas;
}

beforeEach(() => {
  tillstand.cookies.clear();
  tillstand.satta.length = 0;
  tillstand.headers.clear();
  tillstand.headers.set("cf-connecting-ip", "203.0.113.7");
  tillstand.medKonton = true;
  tillstand.konto = skapaFakeKontoDatabas();
  tillstand.auth = skapaFakeAuth();
});

describe("analysFn — Spara analysen", () => {
  it("hamtaSparstatusFn löser kontexten först (enhets-cookien sätts) och skapar ingen principal", async () => {
    expect(await hamtaSparstatusFn({ data: { analysisId: ANALYS } })).toEqual({ status: "ingen" });
    expect(tillstand.satta.map((c) => c.namn)).toEqual([ENHET_COOKIE]);
    expect(konto().principaler.size).toBe(0);
  });

  it("utan konton (ingen publishable key): status ingen, kontexten löses ändå", async () => {
    tillstand.medKonton = false;
    expect(await hamtaSparstatusFn({ data: { analysisId: ANALYS } })).toEqual({ status: "ingen" });
    expect(tillstand.satta.map((c) => c.namn)).toEqual([ENHET_COOKIE]);
  });

  it("utloggad ägare: kan_sparas, förbered sätter markeringen, spara kräver inloggning", async () => {
    tillstand.cookies.set(ENHET_COOKIE, ENHET);
    const principalId = await konto().sakerstallPrincipal(ENHET);
    konto().laggTillAnalys({
      id: ANALYS,
      principalId,
      propertyInput: {} as PropertyInput,
      rapportId: null,
    });
    expect(await hamtaSparstatusFn({ data: { analysisId: ANALYS } })).toEqual({
      status: "kan_sparas",
    });
    expect(await forberedSparaAnalysFn({ data: { analysisId: ANALYS } })).toEqual({ ok: true });
    expect(tillstand.satta.map((c) => c.namn)).toContain(SPARA_COOKIE);
    expect(await sparaAnalysFn({ data: { analysisId: ANALYS } })).toMatchObject({
      ok: false,
      felKod: "ej_inloggad",
    });
  });

  it("ett oväntat fel (t.ex. Supabase) blir bara det generiska meddelandet", async () => {
    const logg = vi.spyOn(console, "error").mockImplementation(() => {});
    // Logged in, so sparaAnalysFn also reaches the failing read.
    const fakeAuth = tillstand.auth as ReturnType<typeof skapaFakeAuth>;
    const anvandare = fakeAuth.skapaBekraftadAnvandare("anna@example.se", "ett-langt-losenord");
    const session = fakeAuth.utfardaSession(anvandare.id);
    tillstand.cookies.set(ACCESS_COOKIE, session.accessToken);
    tillstand.cookies.set(REFRESH_COOKIE, session.refreshToken);
    konto().hamtaAnalysAgare = async () => {
      throw new Error("hamtaAnalysAgare misslyckades: relation analys does not exist");
    };
    for (const anrop of [
      () => hamtaSparstatusFn({ data: { analysisId: ANALYS } }),
      () => forberedSparaAnalysFn({ data: { analysisId: ANALYS } }),
      () => sparaAnalysFn({ data: { analysisId: ANALYS } }),
    ]) {
      const fel = await anrop().catch((e: unknown) => e);
      expect(fel).toBeInstanceOf(Error);
      expect((fel as Error).message).toBe(GENERISKT_FEL_MEDDELANDE);
      expect((fel as Error).message).not.toContain("relation");
    }
    logg.mockRestore();
  });
});
