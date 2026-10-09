import { describe, expect, it } from "vitest";
import { fonsterStart, skapaFakeKontoDatabas } from "./__fakes__/konto";
import type { Kontext } from "./kontext";
import {
  DAG_SEK,
  KVOT_MEDDELANDE,
  PRISUPPSKATTNINGAR_PER_IP_OCH_TIMME,
  TIMME_SEK,
  UPPLADDNINGAR_PER_ENHET_OCH_DAG,
  UPPLADDNINGAR_PER_IP_OCH_DAG,
  kontrolleraPrisuppskattningskvot,
  kontrolleraUppladdningskvot,
  kvotNyckel,
  taKvot,
} from "./kvot";

function klocka(iso: string) {
  let nu = new Date(iso);
  return {
    nu: () => nu,
    satt(ny: string) {
      nu = new Date(ny);
    },
  };
}

const FAST_NU = new Date("2026-10-09T12:00:00Z");

function kontext(enhetId: string, ipHash: string | null): Kontext {
  return { enhetId, principalId: null, ipHash };
}

describe("taKvot (fake som speglar ta_kvot)", () => {
  it("5:e tillåts, 6:e nekas, och en nekad försök förbrukar inget", async () => {
    const db = skapaFakeKontoDatabas();
    for (let i = 1; i <= 5; i++) expect(await taKvot(db, "k", DAG_SEK, 5)).toBe(true);
    expect(await taKvot(db, "k", DAG_SEK, 5)).toBe(false);
    expect(await taKvot(db, "k", DAG_SEK, 5)).toBe(false);
    const rader = [...db.kvot.values()];
    expect(rader).toHaveLength(1);
    expect(rader[0]?.antal).toBe(5);
  });

  it("nytt fönster nollställer räkningen (UTC-justerade fasta fönster)", async () => {
    const k = klocka("2026-10-09T23:59:59Z");
    const db = skapaFakeKontoDatabas({ nu: k.nu });
    for (let i = 0; i < 5; i++) expect(await taKvot(db, "k", DAG_SEK, 5)).toBe(true);
    expect(await taKvot(db, "k", DAG_SEK, 5)).toBe(false);
    k.satt("2026-10-10T00:00:00Z");
    expect(await taKvot(db, "k", DAG_SEK, 5)).toBe(true);
    expect(db.kvot.size).toBe(2);
  });

  it("fönsterstart = floor(epoch / fönster) * fönster", () => {
    expect(fonsterStart(new Date("2026-10-09T13:45:10Z"), DAG_SEK)).toBe(
      "2026-10-09T00:00:00.000Z",
    );
    expect(fonsterStart(new Date("2026-10-09T13:45:10Z"), TIMME_SEK)).toBe(
      "2026-10-09T13:00:00.000Z",
    );
  });

  it("olika nycklar räknas var för sig", async () => {
    const db = skapaFakeKontoDatabas();
    expect(await taKvot(db, "a", DAG_SEK, 1)).toBe(true);
    expect(await taKvot(db, "a", DAG_SEK, 1)).toBe(false);
    expect(await taKvot(db, "b", DAG_SEK, 1)).toBe(true);
  });

  it("ogiltigt fönster kastar, som SQL-funktionen", async () => {
    const db = skapaFakeKontoDatabas();
    await expect(taKvot(db, "k", 0, 5)).rejects.toThrow();
  });
});

describe("gränserna (ägarbeslut 2026-10-09)", () => {
  it("har de beslutade värdena", () => {
    expect(UPPLADDNINGAR_PER_ENHET_OCH_DAG).toBe(5);
    expect(UPPLADDNINGAR_PER_IP_OCH_DAG).toBe(10);
    expect(PRISUPPSKATTNINGAR_PER_IP_OCH_TIMME).toBe(60);
  });
});

describe("kontrolleraUppladdningskvot", () => {
  it("5 per enhet och dag: 5:e ok, 6:e nekas med kvot-kod och svensk text", async () => {
    const db = skapaFakeKontoDatabas({ nu: () => FAST_NU });
    const k = kontext("enhet-1", "ip-1");
    for (let i = 0; i < 5; i++)
      expect(await kontrolleraUppladdningskvot(db, k)).toEqual({ ok: true });
    expect(await kontrolleraUppladdningskvot(db, k)).toEqual({
      ok: false,
      errorCode: "kvot",
      message: KVOT_MEDDELANDE.uppladdningEnhet,
    });
    // The refused attempt took nothing from the IP either.
    expect(
      db.kvot.get(`${kvotNyckel("uppladdning", "ip", "ip-1")}|${fonsterStart(FAST_NU, DAG_SEK)}`)
        ?.antal,
    ).toBe(5);
  });

  it("10 per IP och dag oavsett enhet, och IP-nekat återlämnar enhetens uttag", async () => {
    const db = skapaFakeKontoDatabas({ nu: () => FAST_NU });
    // Two devices × 5 = 10 on the same IP.
    for (const enhet of ["e1", "e2"]) {
      for (let i = 0; i < 5; i++) {
        expect((await kontrolleraUppladdningskvot(db, kontext(enhet, "delad-ip"))).ok).toBe(true);
      }
    }
    const tredje = kontext("e3", "delad-ip");
    expect(await kontrolleraUppladdningskvot(db, tredje)).toEqual({
      ok: false,
      errorCode: "kvot",
      message: KVOT_MEDDELANDE.uppladdningIp,
    });
    const start = fonsterStart(FAST_NU, DAG_SEK);
    expect(db.kvot.get(`${kvotNyckel("uppladdning", "enhet", "e3")}|${start}`)?.antal).toBe(0);
    expect(db.kvot.get(`${kvotNyckel("uppladdning", "ip", "delad-ip")}|${start}`)?.antal).toBe(10);

    // e3 on another network is unaffected and still has its full 5.
    for (let i = 0; i < 5; i++) {
      expect((await kontrolleraUppladdningskvot(db, kontext("e3", "annan-ip"))).ok).toBe(true);
    }
    expect((await kontrolleraUppladdningskvot(db, kontext("e3", "annan-ip"))).ok).toBe(false);
  });

  it("utan IP gäller bara enhetsgränsen", async () => {
    const db = skapaFakeKontoDatabas();
    for (let i = 0; i < 5; i++) {
      expect((await kontrolleraUppladdningskvot(db, kontext("e1", null))).ok).toBe(true);
    }
    expect((await kontrolleraUppladdningskvot(db, kontext("e1", null))).ok).toBe(false);
    expect([...db.kvot.values()].every((r) => r.nyckel.includes(":enhet:"))).toBe(true);
  });

  it("nästa dag är det öppet igen", async () => {
    const k = klocka("2026-10-09T12:00:00Z");
    const db = skapaFakeKontoDatabas({ nu: k.nu });
    for (let i = 0; i < 5; i++) await kontrolleraUppladdningskvot(db, kontext("e1", "ip"));
    expect((await kontrolleraUppladdningskvot(db, kontext("e1", "ip"))).ok).toBe(false);
    k.satt("2026-10-10T00:00:01Z");
    expect((await kontrolleraUppladdningskvot(db, kontext("e1", "ip"))).ok).toBe(true);
  });
});

describe("kontrolleraPrisuppskattningskvot", () => {
  it("60 per IP och timme, 61:a nekas, nästa timme ok", async () => {
    const k = klocka("2026-10-09T12:30:00Z");
    const db = skapaFakeKontoDatabas({ nu: k.nu });
    for (let i = 0; i < 60; i++) {
      expect((await kontrolleraPrisuppskattningskvot(db, kontext(`e${i}`, "ip"))).ok).toBe(true);
    }
    expect(await kontrolleraPrisuppskattningskvot(db, kontext("ny", "ip"))).toEqual({
      ok: false,
      errorCode: "kvot",
      message: KVOT_MEDDELANDE.prisuppskattning,
    });
    k.satt("2026-10-09T13:00:00Z");
    expect((await kontrolleraPrisuppskattningskvot(db, kontext("ny", "ip"))).ok).toBe(true);
  });

  it("utan IP faller den tillbaka på enhetsnyckeln", async () => {
    const db = skapaFakeKontoDatabas();
    for (let i = 0; i < 60; i++) await kontrolleraPrisuppskattningskvot(db, kontext("e1", null));
    expect((await kontrolleraPrisuppskattningskvot(db, kontext("e1", null))).ok).toBe(false);
    expect((await kontrolleraPrisuppskattningskvot(db, kontext("e2", null))).ok).toBe(true);
  });

  it("delar inte kvot med uppladdningar", async () => {
    const db = skapaFakeKontoDatabas();
    for (let i = 0; i < 5; i++) await kontrolleraUppladdningskvot(db, kontext("e1", "ip"));
    expect((await kontrolleraPrisuppskattningskvot(db, kontext("e1", "ip"))).ok).toBe(true);
  });
});
