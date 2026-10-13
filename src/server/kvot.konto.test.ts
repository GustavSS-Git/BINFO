import { describe, expect, it } from "vitest";
import { skapaFakeKontoDatabas } from "./__fakes__/konto";
import type { Kontext } from "./kontext";
import {
  KVARTAR_SEK,
  TIMME_SEK,
  aterlamnaInloggningskvot,
  kontrolleraAterstallningskvot,
  kontrolleraInloggningskvot,
  kontrolleraRegistreringskvot,
  kvotNyckel,
} from "./kvot";

const kontext = (over: Partial<Kontext> = {}): Kontext => ({
  enhetId: "enhet-1",
  principalId: null,
  ipHash: "iphash-1",
  ...over,
});

async function upprepa(n: number, fn: () => Promise<{ ok: boolean }>) {
  const ut: boolean[] = [];
  for (let i = 0; i < n; i++) ut.push((await fn()).ok);
  return ut;
}

describe("inloggningskvot: 10 per IP och 5 per adress per 15 min", () => {
  it("adressgränsen: försök 1–5 ok, 6 nekas", async () => {
    const db = skapaFakeKontoDatabas();
    const r = await upprepa(6, () => kontrolleraInloggningskvot(db, kontext(), "e1"));
    expect(r).toEqual([true, true, true, true, true, false]);
  });

  it("IP-gränsen: 10 olika adresser ok, den 11:e nekas", async () => {
    const db = skapaFakeKontoDatabas();
    const r: boolean[] = [];
    for (let i = 0; i < 11; i++)
      r.push((await kontrolleraInloggningskvot(db, kontext(), `e${i}`)).ok);
    expect(r.slice(0, 10).every(Boolean)).toBe(true);
    expect(r[10]).toBe(false);
  });

  it("en nekad försöker ger tillbaka det som redan tagits (kostar inget)", async () => {
    const db = skapaFakeKontoDatabas();
    await upprepa(5, () => kontrolleraInloggningskvot(db, kontext(), "e1"));
    const ipNyckel = kvotNyckel("inloggning", "ip", "iphash-1");
    const fore = [...db.kvot.values()].find((k) => k.nyckel === ipNyckel)?.antal;
    expect((await kontrolleraInloggningskvot(db, kontext(), "e1")).ok).toBe(false);
    expect([...db.kvot.values()].find((k) => k.nyckel === ipNyckel)?.antal).toBe(fore);
  });

  it("meddelandet säger inte vilken nyckel som tog slut", async () => {
    const db = skapaFakeKontoDatabas();
    await upprepa(5, () => kontrolleraInloggningskvot(db, kontext(), "e1"));
    expect(await kontrolleraInloggningskvot(db, kontext(), "e1")).toEqual({
      ok: false,
      errorCode: "kvot",
      message: "För många försök, vänta en stund.",
    });
  });

  it("fönstret är 15 min och nollställs vid nästa", async () => {
    let nu = new Date("2026-10-13T10:00:00Z");
    const db = skapaFakeKontoDatabas({ nu: () => nu });
    await upprepa(5, () => kontrolleraInloggningskvot(db, kontext(), "e1"));
    expect((await kontrolleraInloggningskvot(db, kontext(), "e1")).ok).toBe(false);
    nu = new Date(nu.getTime() + KVARTAR_SEK * 1000);
    expect((await kontrolleraInloggningskvot(db, kontext(), "e1")).ok).toBe(true);
  });

  it("lyckad inloggning ger sitt eget försök tillbaka; misslyckade fortsätter räknas", async () => {
    const db = skapaFakeKontoDatabas();
    await upprepa(4, () => kontrolleraInloggningskvot(db, kontext(), "e1")); // 4 failed
    await kontrolleraInloggningskvot(db, kontext(), "e1"); // 5th succeeds…
    await aterlamnaInloggningskvot(db, kontext(), "e1"); // …and is refunded
    expect((await kontrolleraInloggningskvot(db, kontext(), "e1")).ok).toBe(true);
    expect((await kontrolleraInloggningskvot(db, kontext(), "e1")).ok).toBe(false);
  });

  it("ingen IP-header: enhetsnyckeln används i stället för IP", async () => {
    const db = skapaFakeKontoDatabas();
    const k = kontext({ ipHash: null });
    await kontrolleraInloggningskvot(db, k, "e1");
    expect([...db.kvot.values()].map((r) => r.nyckel)).toContain("inloggning:enhet:enhet-1");
  });

  it("e-postadressen finns aldrig i en nyckel (bara hashen vi skickar in)", async () => {
    const db = skapaFakeKontoDatabas();
    await kontrolleraInloggningskvot(db, kontext(), "deadbeef");
    expect([...db.kvot.values()].some((r) => r.nyckel.includes("@"))).toBe(false);
  });
});

describe("registreringskvot: 5 per IP och timme", () => {
  it("5 ok, 6:e nekas, nytt fönster ok", async () => {
    let nu = new Date("2026-10-13T10:10:00Z");
    const db = skapaFakeKontoDatabas({ nu: () => nu });
    expect(await upprepa(6, () => kontrolleraRegistreringskvot(db, kontext()))).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
    nu = new Date(nu.getTime() + TIMME_SEK * 1000);
    expect((await kontrolleraRegistreringskvot(db, kontext())).ok).toBe(true);
  });

  it("annan IP har egen kvot", async () => {
    const db = skapaFakeKontoDatabas();
    await upprepa(5, () => kontrolleraRegistreringskvot(db, kontext()));
    expect((await kontrolleraRegistreringskvot(db, kontext({ ipHash: "annan" }))).ok).toBe(true);
  });
});

describe("återställningskvot: 3 per adress och 10 per IP och timme", () => {
  it("adress: 3 ok, 4:e nekas", async () => {
    const db = skapaFakeKontoDatabas();
    expect(await upprepa(4, () => kontrolleraAterstallningskvot(db, kontext(), "e1"))).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it("IP: 10 olika adresser ok, den 11:e nekas, och adressens räknare återlämnas", async () => {
    const db = skapaFakeKontoDatabas();
    const r: boolean[] = [];
    for (let i = 0; i < 11; i++)
      r.push((await kontrolleraAterstallningskvot(db, kontext(), `e${i}`)).ok);
    expect(r.slice(0, 10).every(Boolean)).toBe(true);
    expect(r[10]).toBe(false);
    const e10 = [...db.kvot.values()].find(
      (k) => k.nyckel === kvotNyckel("aterstallning", "epost", "e10"),
    );
    expect(e10?.antal).toBe(0);
  });
});
