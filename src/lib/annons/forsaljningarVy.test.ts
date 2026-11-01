import { describe, expect, it } from "vitest";
import { byggForsaljningarVy } from "@/lib/annons/forsaljningarVy";
import type { TidigareForsaljning } from "@/lib/annons/forsaljningar";

const f = (o: Partial<TidigareForsaljning> = {}): TidigareForsaljning => ({
  saldDatum: "2026-10-15",
  pris: 5_950_000,
  boarea: 54,
  antalRum: 2,
  avgift: null,
  ...o,
});
// sv-SE groups thousands with U+00A0; compare with plain spaces.
const nbsp = (s: string) => s;
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v).replace(/\u00a0/g, " ")) as T;

describe("byggForsaljningarVy", () => {
  it("returns null for failure and empty lists", () => {
    expect(byggForsaljningarVy({ ok: false })).toBeNull();
    expect(byggForsaljningarVy(null)).toBeNull();
    expect(byggForsaljningarVy({ ok: true, adress: "X", forsaljningar: [] })).toBeNull();
  });

  it("formats a row", () => {
    const vy = byggForsaljningarVy({
      ok: true,
      adress: "Sankt Eriksgatan 31A",
      forsaljningar: [f(), f({ saldDatum: "2020-01-03", pris: 4_200_000, avgift: 2950 })],
    });
    expect(vy?.rubrik).toBe("Tidigare försäljningar av Sankt Eriksgatan 31A");
    expect(plain(vy?.rader[0])).toEqual({
      sald: "okt 2026",
      pris: nbsp("5 950 000 kr"),
      krPerM2: nbsp("110 185"),
      storlek: "54 m², 2 rum",
      avgift: "—",
    });
    expect(vy?.rader[1]?.sald).toBe("jan 2020");
    expect(plain(vy?.rader[1]?.avgift)).toBe(nbsp("2 950 kr"));
    expect(vy?.attributionText).toBe("Uppgifter från Booli");
    expect(vy?.fotnot).toContain("inte justerade");
  });

  it("handles missing fields and a null address", () => {
    const vy = byggForsaljningarVy({
      ok: true,
      adress: null,
      forsaljningar: [f({ boarea: null, antalRum: null }), f({ boarea: 40.5, antalRum: null })],
    });
    expect(vy?.rubrik).toBe("Tidigare försäljningar");
    expect(vy?.rader[0]).toMatchObject({ krPerM2: "—", storlek: "—" });
    expect(plain(vy?.rader[1]?.storlek)).toBe(nbsp("40,5 m²"));
  });

  it("covers every month name and caps rows, newest first", () => {
    const manader = Array.from(
      { length: 12 },
      (_, i) => `2025-${String(i + 1).padStart(2, "0")}-05`,
    );
    const vy = byggForsaljningarVy({
      ok: true,
      adress: null,
      forsaljningar: manader.map((d) => f({ saldDatum: d })),
    });
    expect(vy?.rader.map((r) => r.sald)).toEqual([
      "dec 2025",
      "nov 2025",
      "okt 2025",
      "sep 2025",
      "aug 2025",
    ]);
    const jan = byggForsaljningarVy({
      ok: true,
      adress: null,
      forsaljningar: [f({ saldDatum: "2025-01-05" })],
    });
    expect(jan?.rader[0]?.sald).toBe("jan 2025");
  });
});
