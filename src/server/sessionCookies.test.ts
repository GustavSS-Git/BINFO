import { describe, expect, it } from "vitest";
import { fakeKallor } from "./__fakes__/kallor";
import {
  ACCESS_COOKIE,
  CookieForStorError,
  MAX_COOKIE_BYTES,
  REFRESH_COOKIE,
  REFRESH_COOKIE_MAX_AGE_SEK,
  lasSessionCookies,
  rensaSessionCookies,
  sattSessionCookies,
} from "./sessionCookies";

const jwt = (n: string) => `aaa${n}.bbb${n}.ccc${n}`;
const session = (n: string, expiresIn = 3600) => ({
  accessToken: jwt(n),
  refreshToken: `refresh${n}xyz`,
  expiresIn,
});

describe("sessionCookies", () => {
  it("sätter båda cookies httpOnly, Secure, SameSite=Lax, Path=/", () => {
    const k = fakeKallor();
    sattSessionCookies(k, session("1"));
    expect(k.satta).toEqual([
      {
        namn: ACCESS_COOKIE,
        varde: jwt("1"),
        alternativ: { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 3600 },
      },
      {
        namn: REFRESH_COOKIE,
        varde: "refresh1xyz",
        alternativ: {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          maxAge: REFRESH_COOKIE_MAX_AGE_SEK,
        },
      },
    ]);
    expect(REFRESH_COOKIE_MAX_AGE_SEK).toBe(30 * 24 * 3600);
  });

  it("läser tillbaka det som sattes, och roterar vid ny set", () => {
    const k = fakeKallor();
    sattSessionCookies(k, session("1"));
    expect(lasSessionCookies(k)).toEqual({ accessToken: jwt("1"), refreshToken: "refresh1xyz" });
    sattSessionCookies(k, session("2"));
    expect(lasSessionCookies(k)).toEqual({ accessToken: jwt("2"), refreshToken: "refresh2xyz" });
  });

  it("rensa sätter tomt värde och Max-Age=0 på båda", () => {
    const k = fakeKallor();
    sattSessionCookies(k, session("1"));
    rensaSessionCookies(k);
    const sista = k.satta.slice(-2);
    expect(sista.map((s) => [s.namn, s.varde, s.alternativ.maxAge])).toEqual([
      [ACCESS_COOKIE, "", 0],
      [REFRESH_COOKIE, "", 0],
    ]);
    expect(lasSessionCookies(k)).toEqual({ accessToken: undefined, refreshToken: undefined });
  });

  it("ignorerar värden som inte har formen vi utfärdar", () => {
    const k = fakeKallor({}, { [ACCESS_COOKIE]: "inte en jwt", [REFRESH_COOKIE]: "a b" });
    expect(lasSessionCookies(k)).toEqual({ accessToken: undefined, refreshToken: undefined });
  });

  it("en realistisk JWT på ~1,5 kB ryms långt under 4 kB; en för stor vägras", () => {
    const stor = {
      accessToken: `h.${"p".repeat(1500)}.s`,
      refreshToken: "r".repeat(40),
      expiresIn: 3600,
    };
    const k = fakeKallor();
    sattSessionCookies(k, stor);
    for (const s of k.satta) {
      expect(new TextEncoder().encode(`${s.namn}=${s.varde}`).length).toBeLessThan(4000);
    }
    const for_stor = { ...stor, accessToken: `h.${"p".repeat(MAX_COOKIE_BYTES)}.s` };
    expect(() => sattSessionCookies(fakeKallor(), for_stor)).toThrow(CookieForStorError);
  });

  it("minst en minuts livslängd på access-cookien", () => {
    const k = fakeKallor();
    sattSessionCookies(k, session("1", 0));
    expect(k.satta[0]?.alternativ.maxAge).toBe(60);
  });
});
