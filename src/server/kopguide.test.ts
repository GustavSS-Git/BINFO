import { describe, expect, it } from "vitest";
import { skapaFakeKontoDatabas } from "./__fakes__/konto";
import type { Kontext } from "./kontext";
import { hamtaKopguide, hamtaMinaUppgifter, sparaKopguide, type SparatBeroenden } from "./sparat";

const NU = new Date("2026-10-28T12:00:00Z");

function konto(principalId: string): Kontext {
  return {
    enhetId: "enhet-" + principalId,
    principalId,
    ipHash: "ip-1",
    konto: { authUserId: "auth-" + principalId, epost: principalId + "@example.se" },
  };
}
const anonym: Kontext = { enhetId: "e", principalId: null, ipHash: "ip-1" };

async function bygg() {
  const db = skapaFakeKontoDatabas({ nu: () => NU });
  const a = (await db.sakerstallKontoPrincipal("ua", null)).principalId;
  const b = (await db.sakerstallKontoPrincipal("ub", null)).principalId;
  const med = (kontext: Kontext): SparatBeroenden => ({ kontext, db, nu: () => NU });
  return { db, a, b, bA: med(konto(a)), bB: med(konto(b)), bAnonym: med(anonym) };
}

describe("köpguidens framsteg (server)", () => {
  it("utloggad ger ej_inloggad", async () => {
    const t = await bygg();
    expect(await hamtaKopguide(t.bAnonym)).toMatchObject({ ok: false, felKod: "ej_inloggad" });
    expect(await sparaKopguide(t.bAnonym, { klara: ["sok"] })).toMatchObject({
      ok: false,
      felKod: "ej_inloggad",
    });
    expect(t.db.kopguide.size).toBe(0);
  });

  it("tomt konto ger tom lista; spara och läs tillbaka", async () => {
    const t = await bygg();
    expect(await hamtaKopguide(t.bA)).toEqual({ ok: true, klara: [] });
    expect(await sparaKopguide(t.bA, { klara: ["visning", "lanelofte"] })).toEqual({
      ok: true,
      klara: ["lanelofte", "visning"],
    });
    expect(await hamtaKopguide(t.bA)).toEqual({ ok: true, klara: ["lanelofte", "visning"] });
    // Att spara en tom lista är tillåtet (alla steg avbockade igen).
    expect(await sparaKopguide(t.bA, { klara: [] })).toEqual({ ok: true, klara: [] });
  });

  it("är skilt per konto", async () => {
    const t = await bygg();
    await sparaKopguide(t.bA, { klara: ["sok"] });
    expect(await hamtaKopguide(t.bB)).toEqual({ ok: true, klara: [] });
  });

  it("okända id:n och dubletter normaliseras bort", async () => {
    const t = await bygg();
    expect(
      await sparaKopguide(t.bA, { klara: ["sok", "sok", "finns-inte", "efter", "X"] }),
    ).toEqual({
      ok: true,
      klara: ["sok", "efter"],
    });
  });

  it("felformad indata ger ogiltig_indata och sparar ingenting", async () => {
    const t = await bygg();
    const for_manga = Array.from({ length: 21 }, () => "sok");
    for (const data of [null, {}, { klara: "sok" }, { klara: [1] }, { klara: for_manga }]) {
      expect(await sparaKopguide(t.bA, data)).toMatchObject({
        ok: false,
        felKod: "ogiltig_indata",
      });
    }
    expect(t.db.kopguide.size).toBe(0);
  });

  it("sammanslagning av två principaler tar unionen", async () => {
    const t = await bygg();
    await sparaKopguide(t.bA, { klara: ["sok", "lanelofte"] });
    await sparaKopguide(t.bB, { klara: ["sok", "visning"] });
    await t.db.slaSammanPrincipal(t.a, t.b);
    expect(await t.db.lasKopguide(t.a)).toBeNull();
    expect((await t.db.lasKopguide(t.b))?.slice().sort()).toEqual(["lanelofte", "sok", "visning"]);
  });

  it("sammanslagning flyttar en ensam rad", async () => {
    const t = await bygg();
    await sparaKopguide(t.bA, { klara: ["efter"] });
    await t.db.slaSammanPrincipal(t.a, t.b);
    expect(await t.db.lasKopguide(t.b)).toEqual(["efter"]);
    expect(t.db.kopguide.has(t.a)).toBe(false);
  });

  it("radering tar bort raden, och exporten innehåller den", async () => {
    const t = await bygg();
    await sparaKopguide(t.bA, { klara: ["sok"] });
    const ua = await hamtaMinaUppgifter(t.bA);
    expect(ua.ok && ua.uppgifter.kopguide).toEqual({
      klara: ["sok"],
      uppdaterad: NU.toISOString(),
    });
    const ub = await hamtaMinaUppgifter(t.bB);
    expect(ub.ok && ub.uppgifter.kopguide).toBeNull();
    await t.db.raderaPrincipal(t.a);
    expect(t.db.kopguide.size).toBe(0);
  });

  it("fakens skrivning speglar tabellens check", async () => {
    const t = await bygg();
    await expect(t.db.skrivKopguide(t.a, ["Sok"])).rejects.toThrow();
    await expect(t.db.skrivKopguide("okand", ["sok"])).rejects.toThrow();
  });
});
