import { afterEach, describe, expect, it, vi } from "vitest";
import { skapaFakeAuth } from "./__fakes__/auth";
import { fakeKallor } from "./__fakes__/kallor";
import { skapaFakeKontoDatabas } from "./__fakes__/konto";
import {
  begarAterstallning,
  bekraftaEpost,
  hamtaSession,
  loggaIn,
  loggaUt,
  raderaKonto,
  registreraKonto,
  sattNyttLosenord,
  type KontoBeroenden,
} from "./auth";
import { ENHET_COOKIE, losKontext } from "./kontext";
import { medPrincipal } from "./principal";
import { ACCESS_COOKIE, ATERST_COOKIE, REFRESH_COOKIE } from "./sessionCookies";

const ENHET = "AAAAAAAAAAAAAAAAAAAAAA";
const LOSEN = "ett-langt-losenord";

async function bygg(over: { ip?: string } = {}) {
  const auth = skapaFakeAuth();
  const db = skapaFakeKontoDatabas();
  const kallor = fakeKallor(
    { "cf-connecting-ip": over.ip ?? "1.2.3.4" },
    { [ENHET_COOKIE]: ENHET },
  );
  const lasKontext = () => losKontext({ kallor, hemlighet: "h", session: { auth, db } });
  const beroenden = async (): Promise<KontoBeroenden> => ({
    kallor,
    kontext: await lasKontext(),
    auth,
    db,
    hemlighet: "h",
  });
  return { auth, db, kallor, beroenden, lasKontext };
}

describe("registreraKonto", () => {
  it("skickar bekräftelsemejl och sätter ingen session", async () => {
    const t = await bygg();
    const r = await registreraKonto(await t.beroenden(), {
      epost: "Anna@Example.se",
      losenord: LOSEN,
    });
    expect(r).toEqual({ ok: true });
    expect(t.auth.mejl).toHaveLength(1);
    expect(t.auth.mejl[0]).toMatchObject({ till: "anna@example.se", typ: "signup" });
    expect(t.kallor.cookies.has(ACCESS_COOKIE)).toBe(false);
  });

  it("enumerationssäkert: samma svar för en redan registrerad adress", async () => {
    const t = await bygg();
    t.auth.skapaBekraftadAnvandare("finns@example.se", "gammalt-losenord");
    const nyAdress = await registreraKonto(await t.beroenden(), {
      epost: "ny@example.se",
      losenord: LOSEN,
    });
    const finns = await registreraKonto(await t.beroenden(), {
      epost: "finns@example.se",
      losenord: LOSEN,
    });
    expect(finns).toEqual(nyAdress);
    expect(t.auth.anvandare.get([...t.auth.anvandare.keys()][0]!)?.losenord).toBe(
      "gammalt-losenord",
    );
  });

  it("lösenord under 10 tecken eller över 72 byte nekas före Auth", async () => {
    const t = await bygg();
    const kort = await registreraKonto(await t.beroenden(), {
      epost: "a@b.se",
      losenord: "123456789",
    });
    const langt = await registreraKonto(await t.beroenden(), {
      epost: "a@b.se",
      losenord: "ö".repeat(37),
    });
    expect(kort).toMatchObject({ ok: false, felKod: "svagt_losenord" });
    expect(langt).toMatchObject({ ok: false, felKod: "svagt_losenord" });
    expect(t.auth.anrop).toEqual([]);
  });

  it("ogiltig e-post och skräpindata ger svenskt fel", async () => {
    const t = await bygg();
    for (const data of [{ epost: "inte-en-adress", losenord: LOSEN }, null, 5, {}]) {
      const r = await registreraKonto(await t.beroenden(), data);
      expect(r).toMatchObject({ ok: false });
      expect((r as { meddelande: string }).meddelande.length).toBeGreaterThan(5);
    }
  });

  it("kvot: 5 per IP och timme, sedan 'För många försök'", async () => {
    const t = await bygg();
    for (let i = 0; i < 5; i++) {
      expect(
        (await registreraKonto(await t.beroenden(), { epost: `u${i}@x.se`, losenord: LOSEN })).ok,
      ).toBe(true);
    }
    expect(
      await registreraKonto(await t.beroenden(), { epost: "u6@x.se", losenord: LOSEN }),
    ).toEqual({
      ok: false,
      felKod: "kvot",
      meddelande: "För många försök, vänta en stund.",
    });
  });
});

describe("loggaIn", () => {
  it("rätt uppgifter: cookies sätts, principal skapas, enhetens analyser slås ihop", async () => {
    const t = await bygg();
    const u = t.auth.skapaBekraftadAnvandare("anna@example.se", LOSEN);
    const enhetP = await t.db.sakerstallPrincipal(ENHET);
    const r = await loggaIn(await t.beroenden(), { epost: "ANNA@example.se", losenord: LOSEN });
    expect(r).toMatchObject({ ok: true, epost: "anna@example.se" });
    expect(t.kallor.cookies.get(ACCESS_COOKIE)).toBeTruthy();
    expect(t.kallor.cookies.get(REFRESH_COOKIE)).toBeTruthy();
    const ctx = await t.lasKontext();
    expect(ctx.konto?.authUserId).toBe(u.id);
    expect(t.db.principaler.get(enhetP)?.sammanslagenTill).toBe(ctx.principalId);
    expect(hamtaSession(ctx)).toEqual({
      inloggad: true,
      epost: "anna@example.se",
      principalId: ctx.principalId,
    });
  });

  it("fel lösenord och okänd adress ger exakt samma svar", async () => {
    const t = await bygg();
    t.auth.skapaBekraftadAnvandare("anna@example.se", LOSEN);
    const fel = await loggaIn(await t.beroenden(), {
      epost: "anna@example.se",
      losenord: "fel-losenord-1",
    });
    const okand = await loggaIn(await t.beroenden(), {
      epost: "ingen@example.se",
      losenord: "fel-losenord-1",
    });
    expect(fel).toEqual(okand);
    expect(fel).toMatchObject({ ok: false, felKod: "ogiltig_inloggning" });
    expect(t.kallor.cookies.has(ACCESS_COOKIE)).toBe(false);
  });

  it("obekräftad adress med rätt lösenord: epost_ej_bekraftad", async () => {
    const t = await bygg();
    await registreraKonto(await t.beroenden(), { epost: "ny@example.se", losenord: LOSEN });
    const r = await loggaIn(await t.beroenden(), { epost: "ny@example.se", losenord: LOSEN });
    expect(r).toMatchObject({ ok: false, felKod: "epost_ej_bekraftad" });
  });

  it("kvot: efter 5 felförsök på samma adress nekas även rätt lösenord", async () => {
    const t = await bygg();
    t.auth.skapaBekraftadAnvandare("anna@example.se", LOSEN);
    for (let i = 0; i < 5; i++) {
      await loggaIn(await t.beroenden(), { epost: "anna@example.se", losenord: "fel-losenord-1" });
    }
    const r = await loggaIn(await t.beroenden(), { epost: "anna@example.se", losenord: LOSEN });
    expect(r).toMatchObject({
      ok: false,
      felKod: "kvot",
      meddelande: "För många försök, vänta en stund.",
    });
  });

  it("lyckade inloggningar tär inte på kvoten", async () => {
    const t = await bygg();
    t.auth.skapaBekraftadAnvandare("anna@example.se", LOSEN);
    for (let i = 0; i < 12; i++) {
      expect(
        (await loggaIn(await t.beroenden(), { epost: "anna@example.se", losenord: LOSEN })).ok,
      ).toBe(true);
    }
  });

  it("kvot per IP: 10 försök med olika adresser, det 11:e nekas", async () => {
    const t = await bygg();
    for (let i = 0; i < 10; i++) {
      await loggaIn(await t.beroenden(), { epost: `u${i}@x.se`, losenord: "fel-losenord-1" });
    }
    const r = await loggaIn(await t.beroenden(), { epost: "u11@x.se", losenord: "fel-losenord-1" });
    expect(r).toMatchObject({ felKod: "kvot" });
  });
});

describe("bekraftaEpost", () => {
  it("signup-länk: bekräftar, loggar in och sätter cookies; länken är engångs", async () => {
    const t = await bygg();
    await registreraKonto(await t.beroenden(), { epost: "ny@example.se", losenord: LOSEN });
    const m = t.auth.mejl[0]!;
    const r = await bekraftaEpost(await t.beroenden(), { tokenHash: m.tokenHash, typ: "signup" });
    expect(r).toMatchObject({ ok: true, typ: "signup", epost: "ny@example.se" });
    expect((await t.lasKontext()).konto).toBeDefined();
    const igen = await bekraftaEpost(await t.beroenden(), {
      tokenHash: m.tokenHash,
      typ: "signup",
    });
    expect(igen).toMatchObject({ ok: false, felKod: "ogiltig_lank" });
  });

  it("fel typ, skräp och saknad data ger ogiltig_lank", async () => {
    const t = await bygg();
    await registreraKonto(await t.beroenden(), { epost: "ny@example.se", losenord: LOSEN });
    const m = t.auth.mejl[0]!;
    for (const d of [
      { tokenHash: m.tokenHash, typ: "recovery" },
      { tokenHash: "kort", typ: "signup" },
      { tokenHash: m.tokenHash, typ: "magiclink" },
      null,
    ]) {
      expect(await bekraftaEpost(await t.beroenden(), d)).toMatchObject({ felKod: "ogiltig_lank" });
    }
  });
});

describe("lösenordsåterställning", () => {
  it("svarar lika för känd och okänd adress; mejl skickas bara för känd", async () => {
    const t = await bygg();
    t.auth.skapaBekraftadAnvandare("anna@example.se", LOSEN);
    const a = await begarAterstallning(await t.beroenden(), { epost: "anna@example.se" });
    const b = await begarAterstallning(await t.beroenden(), { epost: "ingen@example.se" });
    expect(a).toEqual({ ok: true });
    expect(b).toEqual(a);
    expect(t.auth.mejl.map((m) => m.till)).toEqual(["anna@example.se"]);
  });

  it("kvot: 3 per adress och timme", async () => {
    const t = await bygg();
    const r: unknown[] = [];
    for (let i = 0; i < 4; i++)
      r.push(await begarAterstallning(await t.beroenden(), { epost: "a@x.se" }));
    expect(r.slice(0, 3).every((x) => (x as { ok: boolean }).ok)).toBe(true);
    expect(r[3]).toMatchObject({ ok: false, felKod: "kvot" });
  });

  it("länk → ny session → nytt lösenord; det gamla slutar fungera", async () => {
    const t = await bygg();
    t.auth.skapaBekraftadAnvandare("anna@example.se", LOSEN);
    await begarAterstallning(await t.beroenden(), { epost: "anna@example.se" });
    const m = t.auth.mejl[0]!;
    expect(m.typ).toBe("recovery");
    const b = await bekraftaEpost(await t.beroenden(), { tokenHash: m.tokenHash, typ: "recovery" });
    expect(b).toMatchObject({ ok: true, typ: "recovery" });

    expect(await sattNyttLosenord(await t.beroenden(), { losenord: "kort" })).toMatchObject({
      felKod: "svagt_losenord",
    });
    expect(await sattNyttLosenord(await t.beroenden(), { losenord: "helt-nytt-losenord" })).toEqual(
      { ok: true },
    );

    await loggaUt(await t.beroenden());
    const gammalt = await loggaIn(await t.beroenden(), {
      epost: "anna@example.se",
      losenord: LOSEN,
    });
    expect(gammalt).toMatchObject({ felKod: "ogiltig_inloggning" });
    const nytt = await loggaIn(await t.beroenden(), {
      epost: "anna@example.se",
      losenord: "helt-nytt-losenord",
    });
    expect(nytt.ok).toBe(true);
  });

  it("sattNyttLosenord utan session: ej_inloggad", async () => {
    const t = await bygg();
    expect(
      await sattNyttLosenord(await t.beroenden(), { losenord: "helt-nytt-losenord" }),
    ).toMatchObject({
      ok: false,
      felKod: "ej_inloggad",
    });
  });
});

describe("loggaUt och raderaKonto", () => {
  it("loggaUt avslutar sessionen, rensar cookies och är idempotent", async () => {
    const t = await bygg();
    t.auth.skapaBekraftadAnvandare("anna@example.se", LOSEN);
    await loggaIn(await t.beroenden(), { epost: "anna@example.se", losenord: LOSEN });
    const access = t.kallor.cookies.get(ACCESS_COOKIE)!;
    expect(await loggaUt(await t.beroenden())).toEqual({ ok: true });
    expect(t.auth.accessTokens.has(access)).toBe(false);
    expect(t.kallor.cookies.get(ACCESS_COOKIE)).toBe("");
    expect(hamtaSession(await t.lasKontext())).toEqual({ inloggad: false });
    expect(await loggaUt(await t.beroenden())).toEqual({ ok: true });
  });

  it("loggaUt ger enheten ett nytt id, så senare anonyma uppladdningar inte hamnar på kontot", async () => {
    const t = await bygg();
    t.auth.skapaBekraftadAnvandare("anna@example.se", LOSEN);
    await loggaIn(await t.beroenden(), { epost: "anna@example.se", losenord: LOSEN });
    const fore = t.kallor.cookies.get(ENHET_COOKIE);
    const kontoPrincipal = (await t.lasKontext()).principalId;
    await loggaUt(await t.beroenden());
    const efter = t.kallor.cookies.get(ENHET_COOKIE);
    expect(efter).toBeDefined();
    expect(efter).not.toBe(fore);
    const anonym = await medPrincipal(t.db, await t.lasKontext());
    expect(anonym.principalId).not.toBe(kontoPrincipal);
  });

  it("raderaKonto tar bort data, Auth-användaren och cookies; inloggning går inte längre", async () => {
    const t = await bygg();
    t.auth.skapaBekraftadAnvandare("anna@example.se", LOSEN);
    await loggaIn(await t.beroenden(), { epost: "anna@example.se", losenord: LOSEN });
    const ctx = await t.lasKontext();
    await t.db.skapaSparadKalkyl({
      principalId: ctx.principalId!,
      etikett: null,
      input: {},
      sammanfattning: {},
      regelversion: "r1",
    });
    expect(await raderaKonto(await t.beroenden(), { losenord: LOSEN })).toEqual({ ok: true });
    expect(t.db.sparadeKalkyler.size).toBe(0);
    expect(t.db.principaler.has(ctx.principalId!)).toBe(false);
    expect(t.auth.anvandare.size).toBe(0);
    expect(t.kallor.cookies.get(ACCESS_COOKIE)).toBe("");
    expect(
      await loggaIn(await t.beroenden(), { epost: "anna@example.se", losenord: LOSEN }),
    ).toMatchObject({
      ok: false,
    });
  });

  it("raderaKonto utan session: ej_inloggad och inget raderas", async () => {
    const t = await bygg();
    t.auth.skapaBekraftadAnvandare("anna@example.se", LOSEN);
    expect(await raderaKonto(await t.beroenden(), { losenord: LOSEN })).toMatchObject({
      felKod: "ej_inloggad",
    });
    expect(t.auth.anvandare.size).toBe(1);
  });
});

describe("återställningsmarkör och omautentisering", () => {
  afterEach(() => vi.useRealTimers());

  async function aterstall(t: Awaited<ReturnType<typeof bygg>>, epost = "anna@example.se") {
    t.auth.skapaBekraftadAnvandare(epost, LOSEN);
    await begarAterstallning(await t.beroenden(), { epost });
    const m = t.auth.mejl.at(-1)!;
    await bekraftaEpost(await t.beroenden(), { tokenHash: m.tokenHash, typ: "recovery" });
  }
  const NYTT = "helt-nytt-losenord";

  it("markör sätts bara för recovery, inte signup; liten och med rätt attribut", async () => {
    const t = await bygg();
    await registreraKonto(await t.beroenden(), { epost: "ny@example.se", losenord: LOSEN });
    await bekraftaEpost(await t.beroenden(), {
      tokenHash: t.auth.mejl[0]!.tokenHash,
      typ: "signup",
    });
    expect(t.kallor.cookies.has(ATERST_COOKIE)).toBe(false);

    const t2 = await bygg();
    await aterstall(t2);
    const satt = t2.kallor.satta.find((c) => c.namn === ATERST_COOKIE)!;
    expect(satt.alternativ).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 900,
    });
    expect(satt.varde).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect((ATERST_COOKIE + "=" + satt.varde).length).toBeLessThan(120);
  });

  it("recovery-markör räcker; rensas efter lyckat byte", async () => {
    const t = await bygg();
    await aterstall(t);
    expect(await sattNyttLosenord(await t.beroenden(), { losenord: NYTT })).toEqual({ ok: true });
    expect(t.kallor.cookies.get(ATERST_COOKIE)).toBe("");
    expect(await sattNyttLosenord(await t.beroenden(), { losenord: NYTT + "2" })).toMatchObject({
      felKod: "kraver_nuvarande_losenord",
    });
  });

  it("ingen markör och inget nuvarande lösenord: kraver_nuvarande_losenord", async () => {
    const t = await bygg();
    t.auth.skapaBekraftadAnvandare("anna@example.se", LOSEN);
    await loggaIn(await t.beroenden(), { epost: "anna@example.se", losenord: LOSEN });
    const r = await sattNyttLosenord(await t.beroenden(), { losenord: NYTT });
    expect(r).toMatchObject({ ok: false, felKod: "kraver_nuvarande_losenord" });
    expect(r.ok === false && r.meddelande).toBe(
      "Ange ditt nuvarande lösenord för att byta till ett nytt.",
    );
  });

  it("rätt nuvarande lösenord fungerar utan att byta session-cookies", async () => {
    const t = await bygg();
    t.auth.skapaBekraftadAnvandare("anna@example.se", LOSEN);
    await loggaIn(await t.beroenden(), { epost: "anna@example.se", losenord: LOSEN });
    const refreshForst = t.kallor.cookies.get(REFRESH_COOKIE);
    const antalSatta = t.kallor.satta.length;
    const r = await sattNyttLosenord(await t.beroenden(), {
      losenord: NYTT,
      nuvarandeLosenord: LOSEN,
    });
    expect(r).toEqual({ ok: true });
    // verification did not touch the cookies on its own
    const nya = t.kallor.satta.slice(antalSatta);
    expect(nya.some((c) => c.namn === REFRESH_COOKIE && c.varde === refreshForst)).toBe(false);
    await loggaUt(await t.beroenden());
    expect(
      await loggaIn(await t.beroenden(), { epost: "anna@example.se", losenord: NYTT }),
    ).toMatchObject({ ok: true });
  });

  it("fel nuvarande lösenord nekas och räknas mot inloggningskvoten", async () => {
    const t = await bygg();
    t.auth.skapaBekraftadAnvandare("anna@example.se", LOSEN);
    await loggaIn(await t.beroenden(), { epost: "anna@example.se", losenord: LOSEN });
    const svar: unknown[] = [];
    for (let i = 0; i < 6; i++)
      svar.push(
        await sattNyttLosenord(await t.beroenden(), {
          losenord: NYTT,
          nuvarandeLosenord: "fel-lösenord-x",
        }),
      );
    expect(svar[0]).toMatchObject({ ok: false, felKod: "ogiltig_inloggning" });
    expect(svar[5]).toMatchObject({ ok: false, felKod: "kvot" });
    // even the right password is now refused
    expect(
      await sattNyttLosenord(await t.beroenden(), { losenord: NYTT, nuvarandeLosenord: LOSEN }),
    ).toMatchObject({ felKod: "kvot" });
  });

  it("markör för annan användare nekas", async () => {
    const t = await bygg();
    await aterstall(t, "anna@example.se");
    await loggaUt(await t.beroenden());
    t.auth.skapaBekraftadAnvandare("bo@example.se", LOSEN);
    await loggaIn(await t.beroenden(), { epost: "bo@example.se", losenord: LOSEN });
    expect(t.kallor.cookies.get(ATERST_COOKIE)).toMatch(/^\d+\./);
    expect(await sattNyttLosenord(await t.beroenden(), { losenord: NYTT })).toMatchObject({
      felKod: "kraver_nuvarande_losenord",
    });
  });

  it("utgången markör nekas", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T10:00:00Z"));
    const t = await bygg();
    await aterstall(t);
    vi.setSystemTime(new Date("2026-10-13T10:15:01Z"));
    expect(await sattNyttLosenord(await t.beroenden(), { losenord: NYTT })).toMatchObject({
      felKod: "kraver_nuvarande_losenord",
    });
  });

  it("manipulerad markör nekas (signatur och tid)", async () => {
    const t = await bygg();
    await aterstall(t);
    const [ms, sig] = t.kallor.cookies.get(ATERST_COOKIE)!.split(".");
    const flip = sig!.replace(/^./, sig![0] === "a" ? "b" : "a");
    for (const v of [`${ms}.${flip}`, `${Number(ms) + 600_000}.${sig}`, "skräp", `${ms}`]) {
      t.kallor.cookies.set(ATERST_COOKIE, v);
      expect(await sattNyttLosenord(await t.beroenden(), { losenord: NYTT })).toMatchObject({
        felKod: "kraver_nuvarande_losenord",
      });
    }
  });

  it("raderaKonto kräver rätt lösenord", async () => {
    const t = await bygg();
    t.auth.skapaBekraftadAnvandare("anna@example.se", LOSEN);
    await loggaIn(await t.beroenden(), { epost: "anna@example.se", losenord: LOSEN });
    expect(await raderaKonto(await t.beroenden(), {})).toMatchObject({
      felKod: "ogiltig_inloggning",
    });
    expect(await raderaKonto(await t.beroenden(), { losenord: "fel-lösenord-x" })).toMatchObject({
      felKod: "ogiltig_inloggning",
    });
    expect(t.auth.anvandare.size).toBe(1);
    expect(t.db.principaler.size).toBeGreaterThan(0);
    expect(await raderaKonto(await t.beroenden(), { losenord: LOSEN })).toEqual({ ok: true });
    expect(t.auth.anvandare.size).toBe(0);
  });
});
