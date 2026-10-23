/**
 * "Spara analysen" (owner 2026-10-24): a logged-out analysis into the account,
 * end to end against the in-memory fakes (Auth, principal store, cookies).
 * See `hamtaSparstatus` / `forberedSparaAnalys` / `sparaAnalys` in ./sparat.ts
 * and the marker in ./sessionCookies.ts.
 */

import { describe, expect, it } from "vitest";
import type { PropertyInput } from "@/types/analysis";
import { skapaFakeAuth } from "./__fakes__/auth";
import { fakeKallor, type FakeKallor } from "./__fakes__/kallor";
import { skapaFakeKontoDatabas, type FakeKontoDatabas } from "./__fakes__/konto";
import { bekraftaEpost, loggaIn, loggaUt, registreraKonto, type KontoBeroenden } from "./auth";
import { ENHET_COOKIE, losKontext } from "./kontext";
import { medPrincipal } from "./principal";
import { SPARA_COOKIE, SPARA_MAX_AGE_SEK, lasSparaMarke, sattSparaMarke } from "./sessionCookies";
import {
  forberedSparaAnalys,
  hamtaSparstatus,
  listaSparat,
  sparaAnalys,
  type SparaAnalysBeroenden,
} from "./sparat";

const HEMLIGHET = "h";
const LOSEN = "ett-langt-losenord";
const ENHET_A = "AAAAAAAAAAAAAAAAAAAAAA";
const ENHET_B = "BBBBBBBBBBBBBBBBBBBBBB";
const ANALYS = "11111111-1111-4111-8111-111111111111";
const ANNAN_ANALYS = "22222222-2222-4222-8222-222222222222";

const KAN_INTE =
  "Analysen kunde inte sparas i din profil. Öppna den i webbläsaren där du gjorde analysen och tryck på Spara analysen där.";

const auth = skapaFakeAuth();

/** One browser: its own cookies, sharing the Auth server and the database. */
function webblasare(db: FakeKontoDatabas, enhet: string) {
  const kallor: FakeKallor = fakeKallor(
    { "cf-connecting-ip": "1.2.3.4" },
    { [ENHET_COOKIE]: enhet },
  );
  const lasKontext = () => losKontext({ kallor, hemlighet: HEMLIGHET, session: { auth, db } });
  const konto = async (): Promise<KontoBeroenden> => ({
    kallor,
    kontext: await lasKontext(),
    auth,
    db,
    hemlighet: HEMLIGHET,
  });
  const spara = async (nuMs?: number): Promise<SparaAnalysBeroenden> => ({
    kallor,
    kontext: await lasKontext(),
    db,
    hemlighet: HEMLIGHET,
    ...(nuMs !== undefined ? { nuMs: () => nuMs } : {}),
  });
  return { kallor, lasKontext, konto, spara };
}

let nastaEpost = 1;
const nyEpost = () => `person${nastaEpost++}@example.se`;

/** An analysis made logged out in this browser (device principal, created by
 *  the upload as `medPrincipal` does). */
async function anonymAnalys(
  db: FakeKontoDatabas,
  w: ReturnType<typeof webblasare>,
  id: string = ANALYS,
): Promise<string> {
  const { principalId } = await medPrincipal(db, await w.lasKontext());
  db.laggTillAnalys({
    id,
    principalId,
    propertyInput: { adress: "Testgatan 1" } as unknown as PropertyInput,
    rapportId: null,
  });
  return principalId!;
}

async function listadeAnalyser(db: FakeKontoDatabas, w: ReturnType<typeof webblasare>) {
  const svar = await listaSparat({ kontext: await w.lasKontext(), db });
  if (!svar.ok) throw new Error(svar.meddelande);
  return svar.analyser.map((a) => a.analysisId);
}

describe("Spara analysen — lösenordsinloggning", () => {
  it("utloggad ägare ser kan_sparas; efter inloggningen är den redan sparad (sammanslagningen) och syns i profilen", async () => {
    const db = skapaFakeKontoDatabas();
    const a = webblasare(db, ENHET_A);
    await anonymAnalys(db, a);
    const epost = nyEpost();
    auth.skapaBekraftadAnvandare(epost, LOSEN);

    expect(await hamtaSparstatus(await a.spara(), { analysisId: ANALYS })).toEqual({
      status: "kan_sparas",
    });
    expect(await forberedSparaAnalys(await a.spara(), { analysisId: ANALYS })).toEqual({
      ok: true,
    });

    const inloggning = await loggaIn(await a.konto(), { epost, losenord: LOSEN });
    expect(inloggning.ok).toBe(true);

    expect(await hamtaSparstatus(await a.spara(), { analysisId: ANALYS })).toEqual({
      status: "sparad",
    });
    expect(await sparaAnalys(await a.spara(), { analysisId: ANALYS })).toEqual({ ok: true });
    expect(await listadeAnalyser(db, a)).toEqual([ANALYS]);
    // The successful save cleared the marker.
    expect(a.kallor.cookies.get(SPARA_COOKIE)).toBe("");
  });
});

describe("Spara analysen — nytt konto via bekräftelselänk (enhets-id roteras)", () => {
  it("markeringen flyttar exakt den analysen till kontot; två gånger är ofarligt", async () => {
    const db = skapaFakeKontoDatabas();
    const a = webblasare(db, ENHET_A);
    const enhetP = await anonymAnalys(db, a);
    await anonymAnalys(db, a, ANNAN_ANALYS);

    expect(await forberedSparaAnalys(await a.spara(), { analysisId: ANALYS })).toEqual({
      ok: true,
    });
    const satt = a.kallor.satta.find((c) => c.namn === SPARA_COOKIE)!;
    expect(satt.alternativ).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: SPARA_MAX_AGE_SEK,
    });
    expect(SPARA_MAX_AGE_SEK).toBe(7 * 24 * 60 * 60);

    const epost = nyEpost();
    await registreraKonto(await a.konto(), { epost, losenord: LOSEN });
    const mejl = auth.mejl.find((m) => m.till === epost)!;
    const r = await bekraftaEpost(await a.konto(), { tokenHash: mejl.tokenHash, typ: "signup" });
    expect(r.ok).toBe(true);
    expect(a.kallor.cookies.get(ENHET_COOKIE)).not.toBe(ENHET_A);
    // No merge: the analysis is still on the old device principal.
    expect(db.analyser.get(ANALYS)?.principalId).toBe(enhetP);

    const kontext = await a.lasKontext();
    expect(await hamtaSparstatus(await a.spara(), { analysisId: ANALYS })).toEqual({
      status: "kan_sparas",
    });
    expect(await sparaAnalys(await a.spara(), { analysisId: ANALYS })).toEqual({ ok: true });
    expect(db.analyser.get(ANALYS)?.principalId).toBe(kontext.principalId);
    // Only that one: the other analysis of the old device stays where it was.
    expect(db.analyser.get(ANNAN_ANALYS)?.principalId).toBe(enhetP);
    expect(db.principaler.get(enhetP)?.sammanslagenTill).toBeNull();
    expect(await hamtaSparstatus(await a.spara(), { analysisId: ANALYS })).toEqual({
      status: "sparad",
    });
    expect(await listadeAnalyser(db, a)).toEqual([ANALYS]);
    expect(a.kallor.cookies.get(SPARA_COOKIE)).toBe("");

    // Twice: harmless, nothing changes.
    expect(await sparaAnalys(await a.spara(), { analysisId: ANALYS })).toEqual({ ok: true });
    expect(db.analyser.get(ANALYS)?.principalId).toBe(kontext.principalId);
    // The other analysis has no marker: refused.
    expect(await sparaAnalys(await a.spara(), { analysisId: ANNAN_ANALYS })).toEqual({
      ok: false,
      felKod: "kan_inte_sparas",
      meddelande: KAN_INTE,
    });
  });
});

describe("Spara analysen — någon annans analys", () => {
  it("en annan webbläsare/användare kan inte spara den med bara id:t", async () => {
    const db = skapaFakeKontoDatabas();
    const agaren = webblasare(db, ENHET_A);
    const enhetP = await anonymAnalys(db, agaren);
    const annan = webblasare(db, ENHET_B);

    // Logged out in another browser.
    expect(await hamtaSparstatus(await annan.spara(), { analysisId: ANALYS })).toEqual({
      status: "ingen",
    });
    expect(await forberedSparaAnalys(await annan.spara(), { analysisId: ANALYS })).toMatchObject({
      ok: false,
      felKod: "kan_inte_sparas",
    });
    expect(annan.kallor.cookies.has(SPARA_COOKIE)).toBe(false);
    // A plain status read in another browser never creates a principal.
    expect([...db.principaler.values()].some((p) => p.enhetId === ENHET_B)).toBe(false);

    // Logged in in another browser.
    const epost = nyEpost();
    auth.skapaBekraftadAnvandare(epost, LOSEN);
    await loggaIn(await annan.konto(), { epost, losenord: LOSEN });
    expect(await hamtaSparstatus(await annan.spara(), { analysisId: ANALYS })).toEqual({
      status: "ingen",
    });
    expect(await sparaAnalys(await annan.spara(), { analysisId: ANALYS })).toMatchObject({
      ok: false,
      felKod: "kan_inte_sparas",
    });
    expect(db.analyser.get(ANALYS)?.principalId).toBe(enhetP);

    // Unknown ids and garbage get the same answer.
    for (const analysisId of ["33333333-3333-4333-8333-333333333333", "inte-ett-id", 5]) {
      expect(await hamtaSparstatus(await annan.spara(), { analysisId })).toEqual({
        status: "ingen",
      });
      expect(await sparaAnalys(await annan.spara(), { analysisId })).toMatchObject({
        felKod: "kan_inte_sparas",
      });
    }
  });

  it("utloggad kan inte spara direkt (ej_inloggad)", async () => {
    const db = skapaFakeKontoDatabas();
    const a = webblasare(db, ENHET_A);
    await anonymAnalys(db, a);
    expect(await sparaAnalys(await a.spara(), { analysisId: ANALYS })).toMatchObject({
      ok: false,
      felKod: "ej_inloggad",
    });
  });

  it("en analys utan ägare (operatör/legacy) kan aldrig sparas", async () => {
    const db = skapaFakeKontoDatabas();
    const a = webblasare(db, ENHET_A);
    db.laggTillAnalys({
      id: ANALYS,
      principalId: null,
      propertyInput: {} as PropertyInput,
      rapportId: null,
    });
    expect(await hamtaSparstatus(await a.spara(), { analysisId: ANALYS })).toEqual({
      status: "ingen",
    });
    expect(await forberedSparaAnalys(await a.spara(), { analysisId: ANALYS })).toMatchObject({
      felKod: "kan_inte_sparas",
    });
  });
});

describe("Spara analysen — markeringen", () => {
  /** Logged-in account in browser A whose analysis sits on A's old device
   *  principal (the post-confirmation state), with no marker yet. */
  async function efterBekraftelse() {
    const db = skapaFakeKontoDatabas();
    const a = webblasare(db, ENHET_A);
    const enhetP = await anonymAnalys(db, a);
    const epost = nyEpost();
    await registreraKonto(await a.konto(), { epost, losenord: LOSEN });
    const mejl = auth.mejl.find((m) => m.till === epost)!;
    await bekraftaEpost(await a.konto(), { tokenHash: mejl.tokenHash, typ: "signup" });
    return { db, a, enhetP };
  }

  it("förfalskad signatur nekas", async () => {
    const { db, a, enhetP } = await efterBekraftelse();
    const utgar = Date.now() + 60_000;
    a.kallor.cookies.set(SPARA_COOKIE, `${ANALYS}.${enhetP}.${utgar}.${"0".repeat(64)}`);
    expect(await hamtaSparstatus(await a.spara(), { analysisId: ANALYS })).toEqual({
      status: "ingen",
    });
    expect(await sparaAnalys(await a.spara(), { analysisId: ANALYS })).toMatchObject({
      felKod: "kan_inte_sparas",
    });
    expect(db.analyser.get(ANALYS)?.principalId).toBe(enhetP);
  });

  it("en äkta markering med utbytt principal eller analys nekas (signaturen täcker båda)", async () => {
    const { db, a, enhetP } = await efterBekraftelse();
    const k = fakeKallor();
    await sattSparaMarke(k, HEMLIGHET, { analysisId: ANNAN_ANALYS, enhetsPrincipalId: enhetP });
    const [, , utgar, mac] = k.cookies.get(SPARA_COOKIE)!.split(".");
    a.kallor.cookies.set(SPARA_COOKIE, `${ANALYS}.${enhetP}.${utgar}.${mac}`);
    expect(await sparaAnalys(await a.spara(), { analysisId: ANALYS })).toMatchObject({
      felKod: "kan_inte_sparas",
    });
    expect(db.analyser.get(ANALYS)?.principalId).toBe(enhetP);
  });

  it("utgången markering nekas", async () => {
    const { db, a, enhetP } = await efterBekraftelse();
    const atta = 8 * 24 * 60 * 60 * 1000;
    await sattSparaMarke(
      a.kallor,
      HEMLIGHET,
      { analysisId: ANALYS, enhetsPrincipalId: enhetP },
      Date.now() - atta,
    );
    expect(await sparaAnalys(await a.spara(), { analysisId: ANALYS })).toMatchObject({
      felKod: "kan_inte_sparas",
    });
    expect(db.analyser.get(ANALYS)?.principalId).toBe(enhetP);
    // Still valid just inside the 7 days.
    const nu = Date.now();
    await sattSparaMarke(
      a.kallor,
      HEMLIGHET,
      { analysisId: ANALYS, enhetsPrincipalId: enhetP },
      nu,
    );
    expect(
      await lasSparaMarke(a.kallor, HEMLIGHET, nu + SPARA_MAX_AGE_SEK * 1000 - 1),
    ).not.toBeNull();
    expect(await lasSparaMarke(a.kallor, HEMLIGHET, nu + SPARA_MAX_AGE_SEK * 1000)).toBeNull();
  });

  it("markering för en annan analys nekas", async () => {
    const { db, a, enhetP } = await efterBekraftelse();
    await sattSparaMarke(a.kallor, HEMLIGHET, {
      analysisId: ANNAN_ANALYS,
      enhetsPrincipalId: enhetP,
    });
    expect(await sparaAnalys(await a.spara(), { analysisId: ANALYS })).toMatchObject({
      felKod: "kan_inte_sparas",
    });
    expect(db.analyser.get(ANALYS)?.principalId).toBe(enhetP);
  });

  it("en annan hemlighet (annan nyckel) ger ingen giltig markering", async () => {
    const k = fakeKallor();
    await sattSparaMarke(k, "en-annan-hemlighet", {
      analysisId: ANALYS,
      enhetsPrincipalId: "fake-principal-1",
    });
    expect(await lasSparaMarke(k, HEMLIGHET)).toBeNull();
    expect(await lasSparaMarke(k, "en-annan-hemlighet")).toEqual({
      analysisId: ANALYS,
      enhetsPrincipalId: "fake-principal-1",
    });
  });

  it("utloggning rensar en väntande markering", async () => {
    const db = skapaFakeKontoDatabas();
    const a = webblasare(db, ENHET_A);
    await anonymAnalys(db, a);
    await forberedSparaAnalys(await a.spara(), { analysisId: ANALYS });
    expect(await lasSparaMarke(a.kallor, HEMLIGHET)).not.toBeNull();
    await loggaUt(await a.konto());
    expect(a.kallor.cookies.get(SPARA_COOKIE)).toBe("");
  });
});
