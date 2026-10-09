import { describe, expect, it } from "vitest";
import {
  ENHET_COOKIE,
  ENHET_COOKIE_ALTERNATIV,
  arGiltigtEnhetId,
  hashaIp,
  losIp,
  losKontext,
  skapaEnhetId,
  type CookieAlternativ,
  type KontextKallor,
} from "./kontext";

interface FakeKallor extends KontextKallor {
  cookies: Map<string, string>;
  satta: Array<{ namn: string; varde: string; alternativ: CookieAlternativ }>;
}

function fakeKallor(headers: Record<string, string> = {}, cookies: Record<string, string> = {}) {
  const k: FakeKallor = {
    cookies: new Map(Object.entries(cookies)),
    satta: [],
    lasCookie(namn) {
      return this.cookies.get(namn);
    },
    sattCookie(namn, varde, alternativ) {
      this.satta.push({ namn, varde, alternativ });
      this.cookies.set(namn, varde);
    },
    lasHeader(namn) {
      return headers[namn.toLowerCase()];
    },
  };
  return k;
}

const HEMLIGHET = "sb_secret_test_nyckel";

describe("enhets-id (cookie binfo_enhet)", () => {
  it("skapas en gång och återanvänds sedan", async () => {
    const kallor = fakeKallor();
    const forsta = await losKontext({ kallor, hemlighet: HEMLIGHET });
    const andra = await losKontext({ kallor, hemlighet: HEMLIGHET });

    expect(kallor.satta).toHaveLength(1);
    expect(andra.enhetId).toBe(forsta.enhetId);
    expect(kallor.satta[0]?.namn).toBe(ENHET_COOKIE);
    expect(kallor.satta[0]?.varde).toBe(forsta.enhetId);
  });

  it("sätts httpOnly, Secure, SameSite=Lax, Path=/, ett år", async () => {
    const kallor = fakeKallor();
    await losKontext({ kallor, hemlighet: HEMLIGHET });
    expect(kallor.satta[0]?.alternativ).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 31_536_000,
    });
    expect(ENHET_COOKIE_ALTERNATIV.maxAge).toBe(365 * 24 * 3600);
  });

  it("är 128 slumpbitar som base64url (22 tecken, ingen padding)", () => {
    const id = skapaEnhetId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(skapaEnhetId()).not.toBe(id);
    // Deterministic with injected randomness: 16 × 0xff → all '_'.
    expect(skapaEnhetId(() => new Uint8Array(16).fill(0xff))).toBe("_".repeat(21) + "w");
  });

  it("ersätter ett befintligt men felformat cookievärde i stället för att lita på det", async () => {
    const kallor = fakeKallor({}, { [ENHET_COOKIE]: "inte-vart-format" });
    const kontext = await losKontext({ kallor, hemlighet: HEMLIGHET });
    expect(kontext.enhetId).not.toBe("inte-vart-format");
    expect(arGiltigtEnhetId(kontext.enhetId)).toBe(true);
    expect(kallor.satta).toHaveLength(1);
  });

  it("återanvänder ett giltigt befintligt cookievärde utan att sätta nytt", async () => {
    const befintlig = skapaEnhetId();
    const kallor = fakeKallor({}, { [ENHET_COOKIE]: befintlig });
    const kontext = await losKontext({ kallor, hemlighet: HEMLIGHET });
    expect(kontext.enhetId).toBe(befintlig);
    expect(kallor.satta).toHaveLength(0);
  });

  it("principalId är alltid null från losKontext (skapas lat)", async () => {
    const kontext = await losKontext({ kallor: fakeKallor(), hemlighet: HEMLIGHET });
    expect(kontext.principalId).toBeNull();
  });
});

describe("IP-hash", () => {
  it("är deterministisk per nyckel och skiljer sig mellan nycklar", async () => {
    const a1 = await hashaIp("203.0.113.7", "nyckel-a");
    const a2 = await hashaIp("203.0.113.7", "nyckel-a");
    const b = await hashaIp("203.0.113.7", "nyckel-b");
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(a1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("skiljer olika IP-adresser åt", async () => {
    expect(await hashaIp("203.0.113.7", HEMLIGHET)).not.toBe(
      await hashaIp("203.0.113.8", HEMLIGHET),
    );
  });

  it("normaliserar IPv6-skiftläge och blanksteg", async () => {
    expect(await hashaIp(" 2001:DB8::1 ", HEMLIGHET)).toBe(await hashaIp("2001:db8::1", HEMLIGHET));
  });

  it("innehåller aldrig den råa IP-adressen", async () => {
    const ip = "198.51.100.23";
    const kontext = await losKontext({
      kallor: fakeKallor({ "cf-connecting-ip": ip }),
      hemlighet: HEMLIGHET,
    });
    expect(kontext.ipHash).not.toBeNull();
    expect(kontext.ipHash).not.toContain(ip);
    expect(kontext.ipHash).not.toContain("198");
    expect(JSON.stringify(kontext)).not.toContain(ip);
  });

  it("använder en härledd nyckel, inte hemligheten direkt", async () => {
    // HMAC(hemlighet, ip) directly must NOT equal our hash.
    const kodare = new TextEncoder();
    const k = await crypto.subtle.importKey(
      "raw",
      kodare.encode(HEMLIGHET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const direkt = Array.from(
      new Uint8Array(await crypto.subtle.sign("HMAC", k, kodare.encode("203.0.113.7"))),
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    expect(await hashaIp("203.0.113.7", HEMLIGHET)).not.toBe(direkt);
  });

  it("ingen IP-header → ipHash null", async () => {
    const kontext = await losKontext({ kallor: fakeKallor(), hemlighet: HEMLIGHET });
    expect(kontext.ipHash).toBeNull();
  });

  it("föredrar cf-connecting-ip, annars första x-forwarded-for", () => {
    expect(losIp(fakeKallor({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }))).toBe(
      "1.1.1.1",
    );
    expect(losIp(fakeKallor({ "x-forwarded-for": " 2.2.2.2 , 3.3.3.3" }))).toBe("2.2.2.2");
    expect(losIp(fakeKallor({ "x-forwarded-for": "" }))).toBeNull();
    expect(losIp(fakeKallor())).toBeNull();
  });

  it("samma IP via cf-connecting-ip och x-forwarded-for ger samma hash", async () => {
    const a = await losKontext({
      kallor: fakeKallor({ "cf-connecting-ip": "1.2.3.4" }),
      hemlighet: HEMLIGHET,
    });
    const b = await losKontext({
      kallor: fakeKallor({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }),
      hemlighet: HEMLIGHET,
    });
    expect(a.ipHash).toBe(b.ipHash);
  });
});
