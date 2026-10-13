import { describe, expect, it } from "vitest";
import { skapaFakeAuth } from "./__fakes__/auth";
import { fakeKallor } from "./__fakes__/kallor";
import { skapaFakeKontoDatabas } from "./__fakes__/konto";
import { ENHET_COOKIE, hashaEpost, losKontext } from "./kontext";
import { ACCESS_COOKIE, REFRESH_COOKIE, sattSessionCookies } from "./sessionCookies";

const HEMLIGHET = "sb_secret_test";
const ENHET = "AAAAAAAAAAAAAAAAAAAAAA";

function uppsattning() {
  let nu = 1_000_000;
  const auth = skapaFakeAuth(() => nu);
  const db = skapaFakeKontoDatabas();
  const anvandare = auth.skapaBekraftadAnvandare("Anna@Example.se", "hemligt-losen-1");
  return {
    auth,
    db,
    anvandare,
    tidFramat: (ms: number) => (nu += ms),
    kontext: (kallor: ReturnType<typeof fakeKallor>) =>
      losKontext({ kallor, hemlighet: HEMLIGHET, session: { auth, db } }),
  };
}

describe("losKontext med session", () => {
  it("utan session-cookies: anonym, inga anrop till Auth", async () => {
    const u = uppsattning();
    const k = fakeKallor({}, { [ENHET_COOKIE]: ENHET });
    const ctx = await u.kontext(k);
    expect(ctx.principalId).toBeNull();
    expect(ctx.konto).toBeUndefined();
    expect(u.auth.anrop).toEqual([]);
    expect(u.db.principaler.size).toBe(0);
  });

  it("utan session-beroenden beter sig som förut (cookies ignoreras)", async () => {
    const u = uppsattning();
    const s = u.auth.utfardaSession(u.anvandare.id);
    const k = fakeKallor({}, { [ACCESS_COOKIE]: s.accessToken, [REFRESH_COOKIE]: s.refreshToken });
    const ctx = await losKontext({ kallor: k, hemlighet: HEMLIGHET });
    expect(ctx.principalId).toBeNull();
  });

  it("giltig access-token: kontots principal, e-post, inga nya cookies", async () => {
    const u = uppsattning();
    const s = u.auth.utfardaSession(u.anvandare.id);
    const k = fakeKallor({}, { [ENHET_COOKIE]: ENHET });
    sattSessionCookies(k, s);
    k.satta.length = 0;
    const ctx = await u.kontext(k);
    expect(ctx.konto).toEqual({ authUserId: u.anvandare.id, epost: "anna@example.se" });
    expect(ctx.principalId).not.toBeNull();
    expect(u.db.principaler.get(ctx.principalId!)?.typ).toBe("konto");
    expect(k.satta).toEqual([]);
  });

  it("utgången access-token + refresh: förnyas och BÅDA cookies roteras", async () => {
    const u = uppsattning();
    const s = u.auth.utfardaSession(u.anvandare.id);
    const k = fakeKallor({}, { [ENHET_COOKIE]: ENHET });
    sattSessionCookies(k, s);
    k.satta.length = 0;
    u.tidFramat(3601_000);
    const ctx = await u.kontext(k);
    expect(ctx.konto?.authUserId).toBe(u.anvandare.id);
    expect(k.satta.map((x) => x.namn)).toEqual([ACCESS_COOKIE, REFRESH_COOKIE]);
    expect(k.cookies.get(ACCESS_COOKIE)).not.toBe(s.accessToken);
    expect(k.cookies.get(REFRESH_COOKIE)).not.toBe(s.refreshToken);
    // The rotated pair works on the next request.
    expect((await u.kontext(k)).konto).toBeDefined();
  });

  it("bara refresh-cookie kvar (access-cookien har gått ut i webbläsaren): förnyas", async () => {
    const u = uppsattning();
    const s = u.auth.utfardaSession(u.anvandare.id);
    const k = fakeKallor({}, { [ENHET_COOKIE]: ENHET, [REFRESH_COOKIE]: s.refreshToken });
    expect((await u.kontext(k)).konto).toBeDefined();
    expect(k.cookies.get(ACCESS_COOKIE)).toBeTruthy();
  });

  it("ogiltig token + ogiltig refresh: anonym och cookies rensas", async () => {
    const u = uppsattning();
    const k = fakeKallor(
      {},
      { [ENHET_COOKIE]: ENHET, [ACCESS_COOKIE]: "a.b.c", [REFRESH_COOKIE]: "okandrefresh1" },
    );
    const ctx = await u.kontext(k);
    expect(ctx.principalId).toBeNull();
    expect(ctx.konto).toBeUndefined();
    expect(k.cookies.get(ACCESS_COOKIE)).toBe("");
    expect(k.cookies.get(REFRESH_COOKIE)).toBe("");
    expect(u.db.principaler.size).toBe(0);
  });

  it("ogiltig access-token utan refresh: anonym och cookie rensas", async () => {
    const u = uppsattning();
    const k = fakeKallor({}, { [ENHET_COOKIE]: ENHET, [ACCESS_COOKIE]: "a.b.c" });
    expect((await u.kontext(k)).konto).toBeUndefined();
    expect(k.cookies.get(ACCESS_COOKIE)).toBe("");
  });

  it("använd refresh-token (replay) loggar inte in", async () => {
    const u = uppsattning();
    const s = u.auth.utfardaSession(u.anvandare.id);
    await u.auth.fornyaSession(s.refreshToken);
    const k = fakeKallor({}, { [ENHET_COOKIE]: ENHET, [REFRESH_COOKIE]: s.refreshToken });
    expect((await u.kontext(k)).konto).toBeUndefined();
  });

  it("Auth nere: anonym för anropet men cookies lämnas orörda", async () => {
    const u = uppsattning();
    const s = u.auth.utfardaSession(u.anvandare.id);
    const k = fakeKallor({}, { [ENHET_COOKIE]: ENHET });
    sattSessionCookies(k, s);
    k.satta.length = 0;
    u.auth.simuleraAuthNere = true;
    expect((await u.kontext(k)).konto).toBeUndefined();
    expect(k.satta).toEqual([]);
    u.auth.simuleraAuthNere = false;
    expect((await u.kontext(k)).konto).toBeDefined();
  });

  it("utgången access + Auth nere vid förnyelse: cookies lämnas orörda", async () => {
    const u = uppsattning();
    const s = u.auth.utfardaSession(u.anvandare.id);
    const k = fakeKallor({}, { [ENHET_COOKIE]: ENHET, [REFRESH_COOKIE]: s.refreshToken });
    u.auth.simuleraAuthNere = true;
    expect((await u.kontext(k)).konto).toBeUndefined();
    expect(k.cookies.get(REFRESH_COOKIE)).toBe(s.refreshToken);
  });
});

describe("Auth-kvot (429) vid förnyelse", () => {
  it("loggar inte ut: requesten är anonym men båda cookies finns kvar", async () => {
    const u = uppsattning();
    const s = u.auth.utfardaSession(u.anvandare.id);
    const k = fakeKallor(
      {},
      {
        [ENHET_COOKIE]: ENHET,
        [ACCESS_COOKIE]: "gammal.token.x",
        [REFRESH_COOKIE]: s.refreshToken,
      },
    );
    u.auth.simuleraFornyaKvot = true;
    expect((await u.kontext(k)).konto).toBeUndefined();
    expect(k.cookies.get(REFRESH_COOKIE)).toBe(s.refreshToken);
    expect(k.cookies.get(ACCESS_COOKIE)).toBe("gammal.token.x");
    // Next request, Auth answers again: the same refresh token still works.
    u.auth.simuleraFornyaKvot = false;
    expect((await u.kontext(k)).konto).toBeDefined();
  });
});

describe("enhetens anonyma principal slås ihop med kontot — en gång", () => {
  it("första requesten från enheten flyttar enhetens analyser till kontot", async () => {
    const u = uppsattning();
    const enhetPrincipal = await u.db.sakerstallPrincipal(ENHET);
    u.db.laggTillAnalys({
      id: "a1",
      principalId: enhetPrincipal,
      propertyInput: {} as never,
      rapportId: null,
    });
    const s = u.auth.utfardaSession(u.anvandare.id);
    const k = fakeKallor({}, { [ENHET_COOKIE]: ENHET });
    sattSessionCookies(k, s);
    const ctx = await u.kontext(k);
    expect(u.db.analyser.get("a1")?.principalId).toBe(ctx.principalId);
    expect(u.db.principaler.get(enhetPrincipal)?.sammanslagenTill).toBe(ctx.principalId);
    // Idempotent on later requests.
    const igen = await u.kontext(k);
    expect(igen.principalId).toBe(ctx.principalId);
    expect(u.db.principaler.size).toBe(2);
  });

  it("slås ihop bara en gång: ett andra konto på samma enhet tar inte över", async () => {
    const u = uppsattning();
    const enhetPrincipal = await u.db.sakerstallPrincipal(ENHET);
    const andra = u.auth.skapaBekraftadAnvandare("bo@example.se", "annat-losen-123");
    const k1 = fakeKallor({}, { [ENHET_COOKIE]: ENHET });
    sattSessionCookies(k1, u.auth.utfardaSession(u.anvandare.id));
    const forsta = await u.kontext(k1);
    const k2 = fakeKallor({}, { [ENHET_COOKIE]: ENHET });
    sattSessionCookies(k2, u.auth.utfardaSession(andra.id));
    const bo = await u.kontext(k2);
    expect(bo.principalId).not.toBe(forsta.principalId);
    expect(u.db.principaler.get(enhetPrincipal)?.sammanslagenTill).toBe(forsta.principalId);
  });

  it("kontot utan enhetsprincipal skapas bara; inget att slå ihop", async () => {
    const u = uppsattning();
    const k = fakeKallor({}, { [ENHET_COOKIE]: ENHET });
    sattSessionCookies(k, u.auth.utfardaSession(u.anvandare.id));
    await u.kontext(k);
    expect(u.db.principaler.size).toBe(1);
  });
});

describe("hashaEpost", () => {
  it("är stabil, skiftlägesokänslig och skild från IP-hashen och hemligheten", async () => {
    const a = await hashaEpost("Anna@Example.se ", HEMLIGHET);
    expect(a).toBe(await hashaEpost("anna@example.se", HEMLIGHET));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(await hashaEpost("anna@example.se", "annan hemlighet"));
    expect(a).not.toContain("anna");
  });
});
