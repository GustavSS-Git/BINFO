import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { KontoEjKonfigureratError } from "./fel";
import { mappaAuthFel, skapaAuthPortFranFabrik, skapaKlientFabrik } from "./supabaseAuth";

type Svar = { data: unknown; error: unknown };

/** A stand-in for the supabase-js auth surface; records calls. */
function klient(svar: Record<string, Svar>, anrop: Array<{ namn: string; args: unknown[] }>) {
  const metod =
    (namn: string) =>
    (...args: unknown[]) => {
      anrop.push({ namn, args });
      return Promise.resolve(svar[namn] ?? { data: {}, error: null });
    };
  return {
    auth: {
      signUp: metod("signUp"),
      signInWithPassword: metod("signInWithPassword"),
      verifyOtp: metod("verifyOtp"),
      resetPasswordForEmail: metod("resetPasswordForEmail"),
      refreshSession: metod("refreshSession"),
      setSession: metod("setSession"),
      updateUser: metod("updateUser"),
      getUser: metod("getUser"),
      admin: { signOut: metod("admin.signOut"), deleteUser: metod("admin.deleteUser") },
    },
  } as unknown as SupabaseClient;
}

function port(svar: Record<string, Svar>) {
  const anrop: Array<{ namn: string; args: unknown[] }> = [];
  let publika = 0;
  const p = skapaAuthPortFranFabrik({
    publik: () => {
      publika++;
      return klient(svar, anrop);
    },
    admin: () => klient(svar, anrop),
  });
  return { p, anrop, publika: () => publika };
}

const session = { access_token: "a.b.c", refresh_token: "r12345", expires_in: 3600 };
const user = { id: "u1", email: "anna@example.se" };
const authFel = (code: string, status: number) => ({
  name: "AuthApiError",
  code,
  status,
  message: "RÅTT MEDDELANDE",
});

describe("mappaAuthFel", () => {
  it.each([
    [authFel("invalid_credentials", 400), "ogiltig_inloggning"],
    [authFel("email_not_confirmed", 400), "ej_bekraftad"],
    [authFel("weak_password", 422), "svagt_losenord"],
    [authFel("same_password", 422), "svagt_losenord"],
    [authFel("email_address_invalid", 400), "ogiltig_epost"],
    [authFel("over_email_send_rate_limit", 429), "kvot"],
    [authFel("whatever", 429), "kvot"],
    [authFel("otp_expired", 403), "ogiltig_token"],
    [authFel("refresh_token_already_used", 400), "ogiltig_token"],
    [authFel("bad_jwt", 401), "ogiltig_token"],
    [{ name: "AuthRetryableFetchError", status: 0 }, "tillfalligt"],
    [authFel("unexpected_failure", 500), "tillfalligt"],
    [authFel("nagot_annat", 400), "annat"],
    [undefined, "annat"],
  ])("%j → %s", (fel, forvantat) => {
    expect(mappaAuthFel(fel)).toBe(forvantat);
  });
});

describe("supabaseAuth (AuthPort mot en mockad klient)", () => {
  it("loggaIn: skickar e-post/lösenord, mappar session och användare", async () => {
    const { p, anrop } = port({ signInWithPassword: { data: { session, user }, error: null } });
    const r = await p.loggaIn("anna@example.se", "hemligt-losen-1");
    expect(r).toEqual({
      ok: true,
      session: { accessToken: "a.b.c", refreshToken: "r12345", expiresIn: 3600 },
      anvandare: { id: "u1", epost: "anna@example.se" },
    });
    expect(anrop[0]).toEqual({
      namn: "signInWithPassword",
      args: [{ email: "anna@example.se", password: "hemligt-losen-1" }],
    });
  });

  it("fel behåller bara orsaken, aldrig GoTrues meddelande", async () => {
    const { p } = port({
      signInWithPassword: { data: {}, error: authFel("invalid_credentials", 400) },
    });
    const r = await p.loggaIn("a@b.se", "x");
    expect(r).toEqual({ ok: false, orsak: "ogiltig_inloggning" });
    expect(JSON.stringify(r)).not.toContain("RÅTT");
  });

  it("registrera: ok utan session; ok även om en session (felkonfig) kommer tillbaka, men den kastas", async () => {
    const a = port({ signUp: { data: { user, session: null }, error: null } });
    expect(await a.p.registrera("a@b.se", "hemligt-losen-1")).toEqual({ ok: true });
    const b = port({ signUp: { data: { user, session }, error: null } });
    expect(await b.p.registrera("a@b.se", "hemligt-losen-1")).toEqual({ ok: true });
  });

  it("bekrafta: verifyOtp med token_hash och typ", async () => {
    const { p, anrop } = port({ verifyOtp: { data: { session, user }, error: null } });
    expect((await p.bekrafta("hash1234567890", "recovery")).ok).toBe(true);
    expect(anrop[0]).toEqual({
      namn: "verifyOtp",
      args: [{ token_hash: "hash1234567890", type: "recovery" }],
    });
  });

  it("bekrafta: ett okänt 4xx-fel blir ogiltig_token, inte 'annat'", async () => {
    const { p } = port({ verifyOtp: { data: {}, error: { status: 400, message: "x" } } });
    expect(await p.bekrafta("hash1234567890", "signup")).toEqual({
      ok: false,
      orsak: "ogiltig_token",
    });
  });

  it("valideraAccessToken: ok / ogiltig / fel (Auth nere)", async () => {
    expect(
      (await port({ getUser: { data: { user }, error: null } }).p.valideraAccessToken("t")).status,
    ).toBe("ok");
    expect(
      (
        await port({
          getUser: { data: { user: null }, error: authFel("bad_jwt", 401) },
        }).p.valideraAccessToken("t")
      ).status,
    ).toBe("ogiltig");
    expect(
      (
        await port({
          getUser: { data: { user: null }, error: authFel("x", 503) },
        }).p.valideraAccessToken("t")
      ).status,
    ).toBe("fel");
  });

  it("valideraAccessToken: 429 är 'fel' (inget utslag om token), inte 'ogiltig'", async () => {
    const r = await port({
      getUser: { data: { user: null }, error: authFel("over_request_rate_limit", 429) },
    }).p.valideraAccessToken("t");
    expect(r.status).toBe("fel");
  });

  it("loggaUtAndraSessioner: admin.signOut med scope others; kastar aldrig", async () => {
    const { p, anrop } = port({});
    await p.loggaUtAndraSessioner("a.b.c");
    expect(anrop[0]).toEqual({ namn: "admin.signOut", args: ["a.b.c", "others"] });
    const trasig = skapaAuthPortFranFabrik({
      publik: () => klient({}, []),
      admin: () => {
        throw new Error("nere");
      },
    });
    await expect(trasig.loggaUtAndraSessioner("a.b.c")).resolves.toBeUndefined();
  });

  it("fornyaSession: ogiltigt refresh → ogiltig_token; nere → tillfalligt", async () => {
    expect(
      await port({
        refreshSession: { data: {}, error: authFel("refresh_token_not_found", 400) },
      }).p.fornyaSession("r"),
    ).toEqual({ ok: false, orsak: "ogiltig_token" });
    expect(
      await port({
        refreshSession: { data: {}, error: { name: "AuthRetryableFetchError", status: 0 } },
      }).p.fornyaSession("r"),
    ).toEqual({ ok: false, orsak: "tillfalligt" });
  });

  it("uppdateraLosenord: setSession → updateUser; roterade tokens lämnas tillbaka", async () => {
    const roterad = { ...session, access_token: "ny.ny.ny" };
    const a = port({
      setSession: { data: { session: roterad }, error: null },
      updateUser: { data: {}, error: null },
    });
    const r = await a.p.uppdateraLosenord(
      { accessToken: "gammal.a.b", refreshToken: "r12345" },
      "nytt-losenord-1",
    );
    expect(r).toEqual({
      ok: true,
      session: { accessToken: "ny.ny.ny", refreshToken: "r12345", expiresIn: 3600 },
    });
    expect(a.anrop.map((x) => x.namn)).toEqual(["setSession", "updateUser"]);
    expect(a.anrop[1]?.args).toEqual([{ password: "nytt-losenord-1" }]);
    // Both calls ran on the SAME fresh client, one per operation.
    expect(a.publika()).toBe(1);

    const b = port({
      setSession: { data: { session }, error: null },
      updateUser: { data: {}, error: null },
    });
    expect(
      await b.p.uppdateraLosenord(
        { accessToken: "a.b.c", refreshToken: "r12345" },
        "nytt-losenord-1",
      ),
    ).toEqual({
      ok: true,
      session: null,
    });
  });

  it("uppdateraLosenord: svagt lösenord → svagt_losenord", async () => {
    const { p } = port({
      setSession: { data: { session }, error: null },
      updateUser: { data: {}, error: authFel("weak_password", 422) },
    });
    expect(
      await p.uppdateraLosenord({ accessToken: "a.b.c", refreshToken: "r12345" }, "x"),
    ).toEqual({
      ok: false,
      orsak: "svagt_losenord",
    });
  });

  it("loggaUt: admin.signOut med scope local; kastar aldrig", async () => {
    const { p, anrop } = port({});
    await p.loggaUt("a.b.c");
    expect(anrop[0]).toEqual({ namn: "admin.signOut", args: ["a.b.c", "local"] });
    const trasig = skapaAuthPortFranFabrik({
      publik: () => klient({}, []),
      admin: () => {
        throw new Error("nere");
      },
    });
    await expect(trasig.loggaUt("a.b.c")).resolves.toBeUndefined();
  });

  it("raderaAnvandare kastar vid fel", async () => {
    const { p } = port({ "admin.deleteUser": { data: {}, error: { message: "nej" } } });
    await expect(p.raderaAnvandare("u1")).rejects.toThrow(/nej/);
  });
});

describe("skapaKlientFabrik", () => {
  it("utan publishable key: typat KontoEjKonfigureratError", () => {
    expect(() => skapaKlientFabrik({ supabaseUrl: "http://x", supabaseSecretKey: "s" })).toThrow(
      KontoEjKonfigureratError,
    );
  });
  it("med nyckel skapas fabriken", () => {
    const f = skapaKlientFabrik({
      supabaseUrl: "http://127.0.0.1:54321",
      supabaseSecretKey: "s",
      supabasePublishableKey: "p",
    });
    expect(typeof f.publik).toBe("function");
  });
});
