import { describe, expect, it } from "vitest";
import type { Figure, Forening, Fraga } from "@/types/analysis";
import { lokalFragor } from "./lokalfragor";

const fig = (value: number): Figure => ({
  value,
  unit: "kr",
  source: "arsredovisning",
  ref: { page: 5, excerpt: "x" },
});
const avtal = (
  slutdatum: string,
  arshyra?: number,
  extra: { text?: string; fornyelse?: boolean } = {},
) => ({
  ...(extra.text ? { text: extra.text } : {}),
  slutdatum,
  ...(arshyra !== undefined ? { arshyra: fig(arshyra) } : {}),
  ref: { page: 7, excerpt: "lokal" },
  ...(extra.fornyelse
    ? { fornyelse: { text: "Förlängt", ref: { page: 7, excerpt: "förlängt" } } }
    : {}),
});
const signal = (arshyra?: number, text = "Hyresgästen har sagt upp avtalet") => ({
  text,
  ...(arshyra !== undefined ? { arshyra: fig(arshyra) } : {}),
  ref: { page: 8, excerpt: text },
});
function forening(lokaler: Forening["lokaler"], extra: Partial<Forening> = {}): Forening {
  return {
    namn: "Brf Test",
    orgnr: "769600-0000",
    akta: "ja",
    rakenskapsar: 2023,
    balansdag: "2023-12-31",
    keyFigures: [],
    ...(lokaler ? { lokaler } : {}),
    ...extra,
  };
}
const IDAG = "2026-10-25";
const ren = (t: string) => t.replace(/\s/g, " ");
const kor = (f: Forening, arsavgifter?: number, befintliga: Fraga[] = []) =>
  lokalFragor({
    forening: f,
    ...(arsavgifter !== undefined ? { arsavgifter } : {}),
    idag: IDAG,
    befintliga,
  });
const modellFraga = (fraga: string, varfor = "Därför."): Fraga => ({
  id: "m1",
  fraga,
  ursprung: "analys",
  riktadTill: "styrelsen",
  varfor,
});

describe("lokalFragor: one question per lease ending in the window without fornyelse", () => {
  it("Volontären-like: lease (kontoret, 130,5 kvm) ended 2024-12-31, hyresintakter 244 380, årsavgifter 2 900 000 → 8,4 %", () => {
    // 244 380 ÷ 2 900 000 = 0,08427 → 8,4 %
    const q = kor(
      forening({
        hyresintakter: fig(244_380),
        kontrakt: [avtal("2024-12-31", undefined, { text: "kontoret (130,5 kvm)" })],
      }),
      2_900_000,
    );
    expect(q).toHaveLength(1);
    const f = q[0] as Fraga;
    expect(f).toMatchObject({ ursprung: "analys", riktadTill: "styrelsen", ref: { page: 7 } });
    expect(f.fraga).toBe(
      "Vad händer med hyresavtalet för kontoret (130,5 kvm) som löpte ut 31 december 2024? Har föreningen och hyresgästen kommit överens om att förlänga, eller finns en ny hyresgäst?",
    );
    expect(ren(f.varfor)).toBe(
      "Lokalhyrorna var 244 380 kr under räkenskapsåret 2023, 8,4 % av föreningens årsavgifter. Årsredovisningen säger inget om att avtalet förlängs.",
    );
    expect(f.svarssignal).toBe(
      "Bra svar: avtalet är förlängt eller en ny hyresgäst har skrivit på, till ungefär samma hyra. Varningssignal: hyresgästen har sagt upp eller lokalen står tom.",
    );
  });
  it("a future end date says 'löper ut'", () => {
    const q = kor(
      forening({
        hyresintakter: fig(100_000),
        kontrakt: [avtal("2027-06-30", 100_000, { text: "butiken" })],
      }),
    );
    expect(q[0]?.fraga).toContain("hyresavtalet för butiken som löper ut 30 juni 2027?");
  });
  it("the percentage is omitted without årsavgifter (and with 0)", () => {
    const l = forening({
      hyresintakter: fig(244_380),
      kontrakt: [avtal("2024-12-31")],
    });
    expect(ren(kor(l)[0]?.varfor ?? "")).toBe(
      "Lokalhyrorna var 244 380 kr under räkenskapsåret 2023. Årsredovisningen säger inget om att avtalet förlängs.",
    );
    expect(kor(l, 0)[0]?.varfor).not.toContain("%");
  });
  it("without hyresintakter the lease's own arshyra is the number; without any rent, no number", () => {
    const med = kor(forening({ kontrakt: [avtal("2027-06-30", 130_000)] }), 2_600_000);
    // 130 000 ÷ 2 600 000 = 5 %
    expect(ren(med[0]?.varfor ?? "")).toBe(
      "Hyran för lokalen är 130 000 kr per år, 5 % av föreningens årsavgifter. Årsredovisningen säger inget om att avtalet förlängs.",
    );
    const utan = kor(forening({ kontrakt: [avtal("2027-06-30")] }), 2_600_000);
    expect(utan[0]?.varfor).toBe("Årsredovisningen säger inget om att avtalet förlängs.");
  });
  it("no question for a renewed lease, a lease ending outside the window, or before the balance date", () => {
    const q = kor(
      forening({
        hyresintakter: fig(300_000),
        kontrakt: [
          avtal("2026-12-31", 100_000, { fornyelse: true }),
          avtal("2029-01-01", 100_000),
          avtal("2023-06-30", 100_000),
        ],
      }),
    );
    expect(q).toEqual([]);
  });
  it("one question per lease, with distinct ids", () => {
    const q = kor(
      forening({
        hyresintakter: fig(300_000),
        kontrakt: [
          avtal("2026-12-31", 100_000, { text: "kontoret" }),
          avtal("2027-03-31", 60_000, { text: "förrådet" }),
        ],
      }),
    );
    expect(q).toHaveLength(2);
    expect(new Set(q.map((f) => f.id)).size).toBe(2);
    expect(q[1]?.fraga).toContain("förrådet");
  });
  it("a lease with zero rent gets no question", () => {
    expect(kor(forening({ hyresintakter: fig(0), kontrakt: [avtal("2026-12-31")] }))).toEqual([]);
  });
});

describe("lokalFragor: one question per forlustsignal", () => {
  it("signal 244 380 with årsavgifter 2 900 000", () => {
    const q = kor(
      forening({
        hyresintakter: fig(300_000),
        forlustsignaler: [signal(244_380, "Hyresgästen i kontoret har sagt upp avtalet.")],
      }),
      2_900_000,
    );
    expect(q).toHaveLength(1);
    const f = q[0] as Fraga;
    expect(f.fraga).toBe(
      "Hur planerar föreningen att ersätta lokalhyran som enligt årsredovisningen faller bort, och när kan lokalen vara uthyrd igen?",
    );
    expect(ren(f.varfor)).toBe(
      "Årsredovisningen nämner: ”Hyresgästen i kontoret har sagt upp avtalet”. Hyran är 244 380 kr per år, 8,4 % av föreningens årsavgifter. Bortfallet kan behöva täckas med högre avgifter.",
    );
    expect(f.svarssignal).toMatch(/^Bra svar: .* Varningssignal: /);
    expect(f.ref?.page).toBe(8);
  });
  it("a signal without any rent figure has no number and no percent", () => {
    const q = kor(forening({ forlustsignaler: [signal()] }), 2_900_000);
    expect(q[0]?.varfor).toBe(
      "Årsredovisningen nämner: ”Hyresgästen har sagt upp avtalet”. Bortfallet kan behöva täckas med högre avgifter.",
    );
  });
  it("a signal and a lease with the same rent give ONE question (the signal's)", () => {
    const q = kor(
      forening({
        hyresintakter: fig(500_000),
        kontrakt: [avtal("2026-12-31", 200_000)],
        forlustsignaler: [signal(200_000)],
      }),
    );
    expect(q).toHaveLength(1);
    expect(q[0]?.fraga).toMatch(/^Hur planerar föreningen/);
  });
});

describe("lokalFragor: dedupe against the model's own questions", () => {
  const l = forening({
    hyresintakter: fig(244_380),
    kontrakt: [avtal("2026-12-31")],
    forlustsignaler: [signal(100_000)],
  });
  it("skips everything when a question already mentions lokal, hyresavtal or hyresgäst (fraga or varfor)", () => {
    expect(kor(l, undefined, [modellFraga("Hur ser lokalhyrorna ut framöver?")])).toEqual([]);
    expect(kor(l, undefined, [modellFraga("Löper något hyresavtal ut?")])).toEqual([]);
    expect(kor(l, undefined, [modellFraga("Finns en hyresgäst?")])).toEqual([]);
    expect(kor(l, undefined, [modellFraga("Något annat?", "Lokalen står tom.")])).toEqual([]);
  });
  it("keeps them when the model's questions are about something else", () => {
    expect(
      kor(l, undefined, [modellFraga("Hur finansieras stambytet?", "Lånet är stort.")]),
    ).toHaveLength(2);
  });
});

describe("lokalFragor: nothing to ask", () => {
  it("no lokaler → no questions", () => {
    expect(kor(forening(undefined))).toEqual([]);
  });
  it("lokaler without end dates or signals → no questions", () => {
    expect(kor(forening({ hyresintakter: fig(300_000) }))).toEqual([]);
  });
});
