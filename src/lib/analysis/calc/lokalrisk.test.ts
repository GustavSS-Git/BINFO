import { describe, expect, it } from "vitest";
import type { Figure, Forening } from "@/types/analysis";
import { datumText, klassificeraLokaler, lokalNamn } from "./lokalrisk";

const fig = (value: number): Figure => ({
  value,
  unit: "kr",
  source: "arsredovisning",
  ref: { page: 5, excerpt: "x" },
});
const avtal = (
  slutdatum: string | undefined,
  arshyra?: number,
  extra: { text?: string; fornyelse?: { text: string; nyttSlutdatum?: string } } = {},
) => ({
  ...(extra.text ? { text: extra.text } : {}),
  ...(slutdatum ? { slutdatum } : {}),
  ...(arshyra !== undefined ? { arshyra: fig(arshyra) } : {}),
  ref: { page: 7, excerpt: "lokal" },
  ...(extra.fornyelse
    ? { fornyelse: { ...extra.fornyelse, ref: { page: 7, excerpt: "förlängt" } } }
    : {}),
});
const signal = (arshyra?: number) => ({
  text: "Hyresgästen har sagt upp avtalet",
  ...(arshyra !== undefined ? { arshyra: fig(arshyra) } : {}),
  ref: { page: 8, excerpt: "uppsagt" },
});

const BALANSDAG = "2023-12-31";
const SLUT = "2028-10-25";
const kl = (lokaler: NonNullable<Forening["lokaler"]>, antalLokaler?: number) =>
  klassificeraLokaler({
    lokaler,
    antalLokaler: antalLokaler ?? 0,
    balansdag: BALANSDAG,
    horisontSlut: SLUT,
  });

describe("datumText / lokalNamn", () => {
  it("formats dates like '31 december 2024'", () => {
    expect(datumText("2024-12-31")).toBe("31 december 2024");
    expect(datumText("2027-03-01")).toBe("1 mars 2027");
  });
  it("uses the lease text as a noun phrase, lower-cased, else 'lokalen'", () => {
    expect(lokalNamn("Kontoret (130,5 kvm)")).toBe("kontoret (130,5 kvm)");
    expect(lokalNamn("kontoret (130,5 kvm)")).toBe("kontoret (130,5 kvm)");
    expect(lokalNamn("ICA-butiken")).toBe("ICA-butiken");
    expect(lokalNamn(undefined)).toBe("lokalen");
    expect(lokalNamn("  ")).toBe("lokalen");
  });
  it("falls back to 'lokalen' for an old-style sentence that mentions the avtal or is long", () => {
    expect(lokalNamn("Butikslokal, hyresavtal löper ut")).toBe("lokalen");
    expect(lokalNamn("x".repeat(80))).toBe("lokalen");
  });
});

describe("klassificeraLokaler: the window is [balansdag, horisontSlut], both inclusive", () => {
  it("a lease ending on the balance date, on the horizon end, between: in the window", () => {
    const r = kl({
      hyresintakter: fig(300_000),
      kontrakt: [avtal("2023-12-31"), avtal("2028-10-25"), avtal("2024-12-31")],
    });
    expect(r.avtal.map((a) => a.utfall)).toEqual(["osakert", "osakert", "osakert"]);
  });
  it("a lease ending before the balance date, one day after the horizon, or without a date: not in the window", () => {
    const r = kl({
      kontrakt: [avtal("2023-12-30", 1), avtal("2028-10-26", 1), avtal(undefined, 1)],
    });
    expect(r.avtal).toEqual([]);
  });
  it("a lease with fornyelse is 'forlangt' (and keeps the renewal)", () => {
    const r = kl({
      kontrakt: [
        avtal("2026-12-31", 100_000, {
          fornyelse: { text: "Avtalet är förlängt", nyttSlutdatum: "2029-12-31" },
        }),
      ],
    });
    expect(r.avtal).toHaveLength(1);
    expect(r.avtal[0]).toMatchObject({ utfall: "forlangt", nyttSlutdatum: "2029-12-31" });
  });
});

describe("klassificeraLokaler: rent per lease", () => {
  it("arshyra wins; else hyresintakter ÷ max(kontrakt, antalLokaler, 1)", () => {
    const r = kl({
      hyresintakter: fig(600_000),
      kontrakt: [avtal("2025-06-30", 150_000), avtal("2025-07-31"), avtal(undefined)],
    });
    // 600 000 ÷ max(3, 0, 1) = 200 000 for the lease without arshyra
    expect(r.avtal.map((a) => a.hyra)).toEqual([150_000, 200_000]);
    const r2 = kl({ hyresintakter: fig(600_000), kontrakt: [avtal("2025-06-30")] }, 4);
    // 600 000 ÷ max(1, 4, 1) = 150 000
    expect(r2.avtal[0]?.hyra).toBe(150_000);
  });
  it("no arshyra and no hyresintakter: hyra is null", () => {
    expect(kl({ kontrakt: [avtal("2025-06-30")] }).avtal[0]?.hyra).toBeNull();
  });
  it("a signal without arshyra gets the same share", () => {
    const r = kl({
      hyresintakter: fig(300_000),
      kontrakt: [avtal(undefined), avtal(undefined)],
      forlustsignaler: [signal(), signal(50_000)],
    });
    expect(r.signaler.map((s) => s.hyra)).toEqual([150_000, 50_000]);
  });
});

describe("klassificeraLokaler: a signal and a lease with the same arshyra are the same rent", () => {
  it("lease 200 000 + signal 200 000 → the lease is 'tackt' (counted by the signal only)", () => {
    const r = kl({
      hyresintakter: fig(500_000),
      kontrakt: [avtal("2026-06-30", 200_000)],
      forlustsignaler: [signal(200_000)],
    });
    expect(r.avtal[0]?.utfall).toBe("tackt");
  });
  it("lease 200 000 + signal 150 000 → both count", () => {
    const r = kl({
      kontrakt: [avtal("2026-06-30", 200_000)],
      forlustsignaler: [signal(150_000)],
    });
    expect(r.avtal[0]?.utfall).toBe("osakert");
  });
  it("renewal beats the same-rent rule: the lease stays 'forlangt'", () => {
    const r = kl({
      kontrakt: [avtal("2026-06-30", 200_000, { fornyelse: { text: "Förlängt" } })],
      forlustsignaler: [signal(200_000)],
    });
    expect(r.avtal[0]?.utfall).toBe("forlangt");
  });
});
