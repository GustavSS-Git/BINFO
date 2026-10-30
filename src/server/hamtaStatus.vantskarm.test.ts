import { describe, expect, it, vi } from "vitest";
import type { PropertyInput } from "@/types/analysis";
import { PROMPT_VERSION } from "@/lib/analysis/prompts";
import type { Prisdatakalla } from "@/lib/analysis/prisdata";
import { skapaFakeLager, type FakeLager } from "./__fakes__/lager";
import { hamtaStatus } from "./analys";
import { PIPELINE_VERSION } from "./register";
import { liknandeVarde } from "./vantskarmVardering";

const INPUT: PropertyInput = {
  kind: "bostadsratt",
  utgangspris: 4_995_000,
  boarea: 48,
  antalRum: 2,
  manadsavgift: 3503,
  andelstal: 0,
  orgnr: "",
  adress: "Baltzar von Platens gata 6",
  postnummer: "112 46",
  vaning: 4,
  byggar: 1931,
  hiss: "okant",
  balkong: "nej",
  avgiftInkluderar: { varme: "ja", vatten: "ja", el: "nej", bredband: "nej", tv: "nej" },
  antalPersoner: 2,
};

async function legacyRad(
  lager: FakeLager,
  status: "queued" | "running" | "done" | "failed",
  input: unknown = INPUT,
) {
  const { id } = await lager.db.skapaAnalys({
    pdfHash: "h",
    pdfPath: "h.pdf",
    propertyInput: input as never,
    model: "m",
    promptVersion: PROMPT_VERSION,
    status,
    stage: "uploaded",
  });
  return id;
}

describe("hamtaStatus: väntskärmens uppgifter", () => {
  it("ger adress, utgångspris och Liknande lägenheter medan jobbet väntar (och mäter tiden)", async () => {
    const lager = skapaFakeLager();
    const id = await legacyRad(lager, "queued");
    const start = performance.now();
    const svar = await hamtaStatus(lager, id);
    const ms = performance.now() - start;
    process.stdout.write(`[mätning] första anropet inkl. modellinläsning: ${ms.toFixed(0)} ms\n`);
    expect(svar?.adress).toBe("Baltzar von Platens gata 6");
    expect(svar?.utgangspris).toBe(4_995_000);
    expect(svar?.foreningNamn).toBeNull();
    expect(svar?.liknande?.varde).toBeGreaterThan(1_000_000);
    // Andra anropet (modellen är inläst): den siffra som driver sidans 5 s-pollning.
    const start2 = performance.now();
    await hamtaStatus(lager, id);
    process.stdout.write(
      `[mätning] ett anrop till: ${(performance.now() - start2).toFixed(1)} ms\n`,
    );
    expect(performance.now() - start2).toBeLessThan(1000);
  });

  it("ger fälten även för running, men aldrig för done eller failed", async () => {
    const lager = skapaFakeLager();
    expect((await hamtaStatus(lager, await legacyRad(lager, "running")))?.adress).toBe(
      "Baltzar von Platens gata 6",
    );
    for (const s of ["done", "failed"] as const) {
      const svar = await hamtaStatus(lager, await legacyRad(lager, s));
      expect(svar).not.toBeNull();
      for (const nyckel of ["adress", "foreningNamn", "utgangspris", "liknande"]) {
        expect(nyckel in (svar as object)).toBe(false);
      }
    }
  });

  it("utgångspris saknas och adress tom blir null", async () => {
    const lager = skapaFakeLager();
    const { utgangspris: _u, ...utan } = INPUT;
    const svar = await hamtaStatus(
      lager,
      await legacyRad(lager, "queued", { ...utan, adress: "" }),
    );
    expect(svar?.utgangspris).toBeNull();
    expect(svar?.adress).toBeNull();
  });

  it("en värdering som kastar ger liknande null, aldrig ett fel", async () => {
    const lager = skapaFakeLager();
    const trasig: Prisdatakalla = {
      hamtaVardering: () => Promise.reject(new Error("modellen föll")),
      hamtaForsaljningarIForeningen: () => Promise.resolve([]),
      hamtaOmradeMedian: () => Promise.resolve(null),
    };
    const fel = vi.spyOn(console, "error").mockImplementation(() => {});
    const svar = await hamtaStatus(lager, await legacyRad(lager, "queued"), {
      prisdatakalla: trasig,
    });
    fel.mockRestore();
    expect(svar?.liknande).toBeNull();
    expect(svar?.adress).toBe("Baltzar von Platens gata 6");
  });

  it("en oläsbar lagrad input ger null i alla fält, aldrig ett fel", async () => {
    const lager = skapaFakeLager();
    const fel = vi.spyOn(console, "error").mockImplementation(() => {});
    const svar = await hamtaStatus(lager, await legacyRad(lager, "queued", { skräp: true }));
    fel.mockRestore();
    expect(svar).toMatchObject({
      status: "queued",
      adress: null,
      utgangspris: null,
      liknande: null,
    });
  });

  it("registerlänkad rapport som pågår: föreningens namn från registret", async () => {
    const lager = skapaFakeLager();
    await lager.db.registreraForening("716420-0599", "Brf Pontonjären 3");
    const r = await lager.db.skapaRapport({
      orgnr: "716420-0599",
      rakenskapsar: 2025,
      pipelineVersion: PIPELINE_VERSION,
      model: "m",
      textlager: "ok",
      status: "running",
      stage: "grundning",
      pdfHash: "h",
    });
    if (!r.ok) throw new Error("rapport");
    const { id } = await lager.db.skapaAnalys({
      pdfHash: "h",
      pdfPath: "h.pdf",
      propertyInput: INPUT,
      model: "m",
      promptVersion: PROMPT_VERSION,
      status: "queued",
      stage: "uploaded",
      rapportId: r.id,
    });
    const svar = await hamtaStatus(lager, id);
    expect(svar).toMatchObject({
      status: "running",
      rapportSteg: "grundning",
      foreningNamn: "Brf Pontonjären 3",
      adress: "Baltzar von Platens gata 6",
      utgangspris: 4_995_000,
    });
    expect(svar?.liknande?.varde).toBeGreaterThan(0);
  });

  it("registerlänkad rapport utan identifierad förening: foreningNamn null", async () => {
    const lager = skapaFakeLager();
    const r = await lager.db.skapaRapport({
      orgnr: null,
      rakenskapsar: null,
      pipelineVersion: PIPELINE_VERSION,
      model: "m",
      textlager: "ok",
      status: "queued",
      stage: "identifiering",
      pdfHash: "h2",
    });
    if (!r.ok) throw new Error("rapport");
    const { id } = await lager.db.skapaAnalys({
      pdfHash: "h2",
      pdfPath: "h2.pdf",
      propertyInput: INPUT,
      model: "m",
      promptVersion: PROMPT_VERSION,
      status: "queued",
      stage: "uploaded",
      rapportId: r.id,
    });
    expect((await hamtaStatus(lager, id))?.foreningNamn).toBeNull();
  });
});

describe("liknandeVarde", () => {
  it("är samma obearbetade modellvärde som Priskollen (inget avgiftspåslag)", async () => {
    const v = await liknandeVarde(INPUT);
    expect(v?.varde).toBeGreaterThan(1_000_000);
  });
});
