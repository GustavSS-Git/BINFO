import { describe, expect, it, vi } from "vitest";
import { fonsterStart, skapaFakeKontoDatabas } from "./__fakes__/konto";
import type { Kontext } from "./kontext";
import {
  DAG_SEK,
  KVOT_MEDDELANDE,
  PRISUPPSKATTNINGAR_PER_IP_OCH_TIMME,
  TIMME_SEK,
  UPPLADDNINGAR_LOSA_PER_ENHET_OCH_DAG,
  UPPLADDNINGAR_LOSA_PER_IP_OCH_DAG,
  UPPLADDNINGAR_PER_ENHET_OCH_DAG,
  UPPLADDNINGAR_PER_IP_OCH_DAG,
  aterlamnaUppladdningskvot,
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

describe("aterlamnaUppladdningskvot", () => {
  const start = fonsterStart(FAST_NU, DAG_SEK);
  const antal = (db: ReturnType<typeof skapaFakeKontoDatabas>, typ: "enhet" | "ip", id: string) =>
    db.kvot.get(`${kvotNyckel("uppladdning", typ, id)}|${start}`)?.antal;

  it("ger tillbaka både enhetens och IP:ns uttag", async () => {
    const db = skapaFakeKontoDatabas({ nu: () => FAST_NU });
    const k = kontext("e1", "ip1");
    await kontrolleraUppladdningskvot(db, k);
    await kontrolleraUppladdningskvot(db, k);
    expect([antal(db, "enhet", "e1"), antal(db, "ip", "ip1")]).toEqual([2, 2]);

    await aterlamnaUppladdningskvot(db, k);
    expect([antal(db, "enhet", "e1"), antal(db, "ip", "ip1")]).toEqual([1, 1]);
  });

  it("utan IP återlämnas bara enhetens uttag", async () => {
    const db = skapaFakeKontoDatabas({ nu: () => FAST_NU });
    const k = kontext("e1", null);
    await kontrolleraUppladdningskvot(db, k);
    await aterlamnaUppladdningskvot(db, k);
    expect(antal(db, "enhet", "e1")).toBe(0);
    expect([...db.kvot.values()].every((r) => !r.nyckel.includes(":ip:"))).toBe(true);
  });

  it("bästa försök: ett fel i kontolagret loggas men kastas aldrig", async () => {
    const db = skapaFakeKontoDatabas({ nu: () => FAST_NU });
    const varna = vi.spyOn(console, "warn").mockImplementation(() => {});
    db.aterlamnaKvot = async () => {
      throw new Error("databasen nere");
    };
    await expect(aterlamnaUppladdningskvot(db, kontext("e1", "ip1"))).resolves.toBeUndefined();
    expect(varna).toHaveBeenCalledWith(expect.stringContaining("databasen nere"));
    varna.mockRestore();
  });
});

describe("den lösa kvoten på uppladdningar (aldrig återlämnad)", () => {
  const start = fonsterStart(FAST_NU, DAG_SEK);
  const losNyckel = (typ: "enhet" | "ip", id: string) =>
    `${kvotNyckel("uppladdning_los", typ, id)}|${start}`;

  it("gränserna är 30 per enhet och 100 per IP och dag (produktbeslut, supervisor 2026-10-09)", () => {
    expect(UPPLADDNINGAR_LOSA_PER_ENHET_OCH_DAG).toBe(30);
    expect(UPPLADDNINGAR_LOSA_PER_IP_OCH_DAG).toBe(100);
  });

  it("varje uppladdning tar även en lös användning, enhet och IP", async () => {
    const db = skapaFakeKontoDatabas({ nu: () => FAST_NU });
    await kontrolleraUppladdningskvot(db, kontext("e1", "ip1"));
    expect(db.kvot.get(losNyckel("enhet", "e1"))?.antal).toBe(1);
    expect(db.kvot.get(losNyckel("ip", "ip1"))?.antal).toBe(1);
  });

  it("återlämningen rör bara den stränga kvoten: den lösa räknar även uppladdningar som servades gratis", async () => {
    const db = skapaFakeKontoDatabas({ nu: () => FAST_NU });
    const k = kontext("e1", "ip1");
    for (let i = 0; i < 3; i++) {
      expect((await kontrolleraUppladdningskvot(db, k)).ok).toBe(true);
      await aterlamnaUppladdningskvot(db, k);
    }
    expect(db.kvot.get(`${kvotNyckel("uppladdning", "enhet", "e1")}|${start}`)?.antal).toBe(0);
    expect(db.kvot.get(losNyckel("enhet", "e1"))?.antal).toBe(3);
    expect(db.kvot.get(losNyckel("ip", "ip1"))?.antal).toBe(3);
  });

  it("den 31:a uppladdningen från en enhet nekas även om alla tidigare servades gratis (strikta kvoten är då tom)", async () => {
    const db = skapaFakeKontoDatabas({ nu: () => FAST_NU });
    const k = kontext("e1", "ip1");
    for (let i = 0; i < UPPLADDNINGAR_LOSA_PER_ENHET_OCH_DAG; i++) {
      expect((await kontrolleraUppladdningskvot(db, k)).ok).toBe(true);
      await aterlamnaUppladdningskvot(db, k);
    }
    expect(await kontrolleraUppladdningskvot(db, k)).toEqual({
      ok: false,
      errorCode: "kvot",
      message: KVOT_MEDDELANDE.uppladdningEnhetTotalt,
    });
    // The refused attempt took nothing: neither the strict nor the loose quota.
    expect(db.kvot.get(`${kvotNyckel("uppladdning", "enhet", "e1")}|${start}`)?.antal).toBe(0);
    expect(db.kvot.get(losNyckel("enhet", "e1"))?.antal).toBe(30);
    expect(db.kvot.get(losNyckel("ip", "ip1"))?.antal).toBe(30);
  });

  it("100 per IP och dag över flera enheter; en nekad IP återlämnar enhetens lösa och stränga uttag", async () => {
    const db = skapaFakeKontoDatabas({ nu: () => FAST_NU });
    for (let i = 0; i < UPPLADDNINGAR_LOSA_PER_IP_OCH_DAG; i++) {
      const k = kontext(`enhet-${i}`, "delad-ip");
      expect((await kontrolleraUppladdningskvot(db, k)).ok).toBe(true);
      await aterlamnaUppladdningskvot(db, k);
    }
    const sista = kontext("enhet-ny", "delad-ip");
    expect(await kontrolleraUppladdningskvot(db, sista)).toEqual({
      ok: false,
      errorCode: "kvot",
      message: KVOT_MEDDELANDE.uppladdningIpTotalt,
    });
    expect(db.kvot.get(losNyckel("enhet", "enhet-ny"))?.antal).toBe(0);
    expect(db.kvot.get(`${kvotNyckel("uppladdning", "enhet", "enhet-ny")}|${start}`)?.antal).toBe(
      0,
    );
    // Another network is unaffected.
    expect((await kontrolleraUppladdningskvot(db, kontext("enhet-ny", "annan-ip"))).ok).toBe(true);
  });

  it("utan IP gäller bara de två enhetskvoterna", async () => {
    const db = skapaFakeKontoDatabas({ nu: () => FAST_NU });
    await kontrolleraUppladdningskvot(db, kontext("e1", null));
    expect([...db.kvot.values()].every((r) => r.nyckel.includes(":enhet:"))).toBe(true);
    expect(db.kvot.size).toBe(2);
  });
});
