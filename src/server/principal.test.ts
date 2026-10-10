import { describe, expect, it } from "vitest";
import type { PropertyInput } from "@/types/analysis";
import { skapaFakeKontoDatabas } from "./__fakes__/konto";
import { medPrincipal, sakerstallPrincipal, slaSammanPrincipal } from "./principal";

const input = { adress: "Testgatan 1" } as unknown as PropertyInput;

function klocka(iso: string) {
  let nu = new Date(iso);
  return {
    nu: () => nu,
    satt(ny: string) {
      nu = new Date(ny);
    },
  };
}

describe("sakerstallPrincipal", () => {
  it("är idempotent per enhet och uppdaterar senast_sedd", async () => {
    const k = klocka("2026-10-09T10:00:00Z");
    const db = skapaFakeKontoDatabas({ nu: k.nu });
    const a = await sakerstallPrincipal(db, "enhet-1");
    k.satt("2026-10-09T11:00:00Z");
    const b = await sakerstallPrincipal(db, "enhet-1");

    expect(b).toBe(a);
    expect(db.principaler.size).toBe(1);
    const rad = await db.hamtaPrincipal(a);
    expect(rad).toMatchObject({
      typ: "anonym",
      enhetId: "enhet-1",
      authUserId: null,
      skapad: "2026-10-09T10:00:00.000Z",
      senastSedd: "2026-10-09T11:00:00.000Z",
      sammanslagenTill: null,
    });
  });

  it("olika enheter får olika principaler", async () => {
    const db = skapaFakeKontoDatabas();
    expect(await sakerstallPrincipal(db, "e1")).not.toBe(await sakerstallPrincipal(db, "e2"));
  });

  it("vägrar tomt enhets-id", async () => {
    await expect(sakerstallPrincipal(skapaFakeKontoDatabas(), "")).rejects.toThrow();
  });
});

describe("medPrincipal", () => {
  it("fyller i principalId för en anonym kontext", async () => {
    const db = skapaFakeKontoDatabas();
    const k = await medPrincipal(db, { enhetId: "e1", principalId: null, ipHash: "h" });
    expect(k.principalId).toBe(await sakerstallPrincipal(db, "e1"));
    expect(k.ipHash).toBe("h");
  });

  it("lämnar en kontext som redan har en principal orörd (konto senare)", async () => {
    const db = skapaFakeKontoDatabas();
    const k = { enhetId: "e1", principalId: "konto-principal", ipHash: null };
    expect(await medPrincipal(db, k)).toBe(k);
    expect(db.principaler.size).toBe(0);
  });
});

describe("slaSammanPrincipal", () => {
  it("flyttar analys- och behörighetsrader och pekar om enheten", async () => {
    const db = skapaFakeKontoDatabas();
    const enhet = await sakerstallPrincipal(db, "enhet");
    const konto = await sakerstallPrincipal(db, "kontots-enhet");
    db.laggTillAnalys({ id: "a1", principalId: enhet, propertyInput: input, rapportId: null });
    db.laggTillAnalys({ id: "a2", principalId: konto, propertyInput: input, rapportId: "r1" });
    db.laggTillAnalys({ id: "a3", principalId: null, propertyInput: input, rapportId: null });
    db.laggTillBehorighet({
      principalId: enhet,
      formaga: "full_rapport",
      kalla: "kop",
      rapportId: "r1",
      giltigTill: null,
    });

    await slaSammanPrincipal(db, enhet, konto);

    expect(db.analyser.get("a1")?.principalId).toBe(konto);
    expect(db.analyser.get("a2")?.principalId).toBe(konto);
    expect(db.analyser.get("a3")?.principalId).toBeNull();
    expect([...db.behorigheter.values()].every((b) => b.principalId === konto)).toBe(true);
    expect((await db.hamtaPrincipal(enhet))?.sammanslagenTill).toBe(konto);
    // The device now resolves to the account principal.
    expect(await sakerstallPrincipal(db, "enhet")).toBe(konto);
  });

  it("håller sammanslagningar på en nivå", async () => {
    const db = skapaFakeKontoDatabas();
    const a = await sakerstallPrincipal(db, "a");
    const b = await sakerstallPrincipal(db, "b");
    const c = await sakerstallPrincipal(db, "c");
    await slaSammanPrincipal(db, a, b);
    await slaSammanPrincipal(db, b, c);
    expect((await db.hamtaPrincipal(a))?.sammanslagenTill).toBe(c);
    expect((await db.hamtaPrincipal(b))?.sammanslagenTill).toBe(c);
  });

  it("vägrar samma id, okända id och ett mål som självt är sammanslaget", async () => {
    const db = skapaFakeKontoDatabas();
    const a = await sakerstallPrincipal(db, "a");
    const b = await sakerstallPrincipal(db, "b");
    const c = await sakerstallPrincipal(db, "c");
    await expect(slaSammanPrincipal(db, a, a)).rejects.toThrow();
    await expect(slaSammanPrincipal(db, a, "finns-inte")).rejects.toThrow();
    await expect(slaSammanPrincipal(db, "finns-inte", a)).rejects.toThrow();
    await slaSammanPrincipal(db, b, c);
    await expect(slaSammanPrincipal(db, a, b)).rejects.toThrow(/merged/);
  });
});
