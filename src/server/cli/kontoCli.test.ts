import { describe, expect, it } from "vitest";
import type { PropertyInput } from "@/types/analysis";
import { skapaFakeKontoDatabas } from "../__fakes__/konto";
import { kontrolleraUppladdningskvot } from "../kvot";
import { sakerstallPrincipal, slaSammanPrincipal } from "../principal";
import { ANVANDNING, korKontoKommando } from "./kontoCli";

const input = (adress: string) => ({ adress }) as unknown as PropertyInput;

function utskrift() {
  const ut: string[] = [];
  const fel: string[] = [];
  return { ut, fel, skriv: { ut: (t: string) => ut.push(t), fel: (t: string) => fel.push(t) } };
}

async function seed() {
  const db = skapaFakeKontoDatabas();
  const enhet = await sakerstallPrincipal(db, "enhet_A-1");
  const konto = await sakerstallPrincipal(db, "enhet_B-2");
  const annan = await sakerstallPrincipal(db, "enhet_C-3");
  db.laggTillAnalys({
    id: "a1",
    principalId: enhet,
    propertyInput: input("Gata 1"),
    rapportId: "r1",
    createdAt: "2026-10-01T00:00:00.000Z",
  });
  db.laggTillAnalys({
    id: "a2",
    principalId: konto,
    propertyInput: input("Gata 2"),
    rapportId: null,
    createdAt: "2026-10-02T00:00:00.000Z",
  });
  db.laggTillAnalys({
    id: "a3",
    principalId: annan,
    propertyInput: input("Gata 3"),
    rapportId: null,
  });
  db.laggTillBehorighet({
    principalId: enhet,
    formaga: "full_rapport",
    kalla: "kop",
    rapportId: "r1",
    giltigTill: null,
  });
  await kontrolleraUppladdningskvot(db, { enhetId: "enhet_A-1", principalId: null, ipHash: "ip" });
  await kontrolleraUppladdningskvot(db, { enhetId: "enhet_C-3", principalId: null, ipHash: "ip" });
  await slaSammanPrincipal(db, enhet, konto);
  return { db, enhet, konto, annan };
}

describe("npm run konto", () => {
  it("exportera ger JSON med principalens (och sammanslagnas) analyser", async () => {
    const { db, konto, enhet } = await seed();
    const u = utskrift();
    const kod = await korKontoKommando(db, ["exportera", konto], u.skriv, { kravUuid: false });
    expect(kod).toBe(0);
    const data = JSON.parse(u.ut.join("\n")) as {
      principaler: Array<{ id: string }>;
      analyser: Array<{
        id: string;
        createdAt: string;
        propertyInput: unknown;
        rapportId: string | null;
      }>;
    };
    expect(data.principaler.map((p) => p.id).sort()).toEqual([enhet, konto].sort());
    expect(data.analyser).toEqual([
      {
        id: "a1",
        createdAt: "2026-10-01T00:00:00.000Z",
        propertyInput: { adress: "Gata 1" },
        rapportId: "r1",
      },
      {
        id: "a2",
        createdAt: "2026-10-02T00:00:00.000Z",
        propertyInput: { adress: "Gata 2" },
        rapportId: null,
      },
    ]);
  });

  it("radera tar bort principal, sammanslagna, analyser, behörigheter och enhetens kvotrader — inget annat", async () => {
    const { db, konto, annan } = await seed();
    const u = utskrift();
    const kod = await korKontoKommando(db, ["radera", konto], u.skriv, { kravUuid: false });
    expect(kod).toBe(0);
    expect(u.fel.join("\n")).toMatch(
      /2 principal\(er\), 2 analys\(er\), 1 behörighet\(er\), 2 kvotrad\(er\)/,
    );

    expect([...db.principaler.keys()]).toEqual([annan]);
    expect([...db.analyser.keys()]).toEqual(["a3"]);
    expect(db.behorigheter.size).toBe(0);
    const kvarvarande = [...db.kvot.values()].map((r) => r.nyckel).sort();
    // The device's strict and loose rows go; the other device's rows and the
    // IP-keyed rows (not tied to a person) stay.
    expect(kvarvarande).toEqual([
      "uppladdning:enhet:enhet_C-3",
      "uppladdning:ip:ip",
      "uppladdning_los:enhet:enhet_C-3",
      "uppladdning_los:ip:ip",
    ]);
  });

  it("exportera och radera täcker sparade värderingar och kalkyler, och Auth-användaren", async () => {
    const { skapaFakeAuth } = await import("../__fakes__/auth");
    const auth = skapaFakeAuth();
    const anv = auth.skapaBekraftadAnvandare("a@b.se", "ett-langt-losenord");
    const db = skapaFakeKontoDatabas();
    const { principalId } = await db.sakerstallKontoPrincipal(anv.id, null);
    await db.skapaSparadKalkyl({
      principalId,
      etikett: "k",
      input: {},
      sammanfattning: {},
      regelversion: "r",
    });
    await db.skapaSparadVardering({
      principalId,
      etikett: "v",
      input: {} as never,
      resultat: {} as never,
      modellVersion: "m",
    });

    const e = utskrift();
    expect(
      await korKontoKommando(db, ["exportera", principalId], e.skriv, { kravUuid: false }),
    ).toBe(0);
    const data = JSON.parse(e.ut.join("\n")) as {
      sparadeVarderingar: unknown[];
      sparadeKalkyler: unknown[];
    };
    expect([data.sparadeVarderingar.length, data.sparadeKalkyler.length]).toEqual([1, 1]);

    // Without Auth access the Auth user would survive: warn and exit 1.
    const utanAuth = utskrift();
    const db2 = skapaFakeKontoDatabas();
    const p2 = (await db2.sakerstallKontoPrincipal(anv.id, null)).principalId;
    expect(await korKontoKommando(db2, ["radera", p2], utanAuth.skriv, { kravUuid: false })).toBe(
      1,
    );
    expect(utanAuth.fel.join("\n")).toMatch(/INTE/);

    const r = utskrift();
    expect(
      await korKontoKommando(db, ["radera", principalId], r.skriv, { kravUuid: false, auth }),
    ).toBe(0);
    expect(r.fel.join("\n")).toMatch(/1 sparad\(e\) värdering\(ar\), 1 sparad\(e\) kalkyl\(er\)/);
    expect(db.sparadeKalkyler.size + db.sparadeVarderingar.size).toBe(0);
    expect(auth.anvandare.size).toBe(0);
  });

  it("okänd principal: exit 1, inget raderas", async () => {
    const { db } = await seed();
    const u = utskrift();
    expect(await korKontoKommando(db, ["radera", "nope"], u.skriv, { kravUuid: false })).toBe(1);
    expect(await korKontoKommando(db, ["exportera", "nope"], u.skriv, { kravUuid: false })).toBe(1);
    expect(db.principaler.size).toBe(3);
  });

  it("fel användning och icke-uuid ger exit 2", async () => {
    const db = skapaFakeKontoDatabas();
    const u = utskrift();
    expect(await korKontoKommando(db, [], u.skriv)).toBe(2);
    expect(await korKontoKommando(db, ["lista"], u.skriv)).toBe(2);
    expect(await korKontoKommando(db, ["radera"], u.skriv)).toBe(2);
    expect(await korKontoKommando(db, ["radera", "a", "b"], u.skriv)).toBe(2);
    expect(u.fel[0]).toBe(ANVANDNING);
    expect(await korKontoKommando(db, ["radera", "inte-ett-uuid"], u.skriv)).toBe(2);
    expect(u.fel.at(-1)).toMatch(/uuid/);
  });
});
