/**
 * Best-effort parts of the register job machine must never fail a rapport:
 * the page-check text loader (extraktion) and the register refresh after done
 * (bedomning). Same fake client pattern as steg.skannat.test.ts.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extraktion } from "@/lib/analysis/__fixtures__/extraktion";
import { namnLiknar } from "@/lib/analysis/identitet";
import type { identifieraMedModell } from "@/lib/analysis/identitetModell";
import {
  buildAnalysSystemPrompt,
  buildExtractionSystemPrompt,
  buildGroundingSystemPrompt,
} from "@/lib/analysis/prompts";
import type { AnthropicClientLike } from "@/lib/analysis/runExtraction";
import type { ExtractionResult } from "@/types/analysis";
import { skapaFakeLager, type FakeLager } from "./__fakes__/lager";
import { skapaAnalys, type SkapaAnalysBeroenden } from "./analys";
import type { Env } from "./env";
import type { RapportRad } from "./portar";
import { korNastaSteg, type KorNastaStegOptions } from "./steg";

const here = path.dirname(fileURLToPath(import.meta.url));
const MODEL = "claude-sonnet-5-5";
const ORGNR = "769616-0253";
const EXTRAKTION: ExtractionResult = {
  ...extraktion,
  forening: { ...extraktion.forening, orgnr: ORGNR, rakenskapsar: 2025 },
};

const propertyInput: unknown = (
  JSON.parse(
    await readFile(path.join(here, "..", "..", "fixtures", "property-input-example.json"), "utf-8"),
  ) as { input: unknown }
).input;

function buildEnv(): Env {
  return {
    supabaseUrl: "https://example.supabase.co",
    supabaseSecretKey: "secret",
    maxDailySpendSek: 100,
    killSwitchPa: false,
    anthropicApiKey: "test-key",
    anthropicModel: MODEL,
    maxCostPerAnalysisSek: 5,
    effortGrounding: "medium",
    effortExtraction: "medium",
    effortJudging: "medium",
  };
}

async function textPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const sida = doc.addPage([595, 842]);
  ["Brf Kastanjen", "Arsavgift 700 kr per kvm"].forEach((rad, i) =>
    sida.drawText(rad, { x: 50, y: 780 - i * 20, size: 12, font }),
  );
  return doc.save();
}

const lokalIdentitet: SkapaAnalysBeroenden = {
  identifieraLokalt: () => ({ identitet: null, orgnrKandidater: [], arKandidater: [], skal: [] }),
  namnLiknar,
};

function systemText(system: unknown): string {
  if (typeof system === "string") return system;
  if (Array.isArray(system)) return system.map((b: { text?: string }) => b.text ?? "").join("\n");
  return "";
}

function skapaKlient() {
  const USAGE = { cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const create = vi.fn(async (raw: unknown) => {
    const system = systemText((raw as { system?: unknown }).system);
    if (system === buildExtractionSystemPrompt()) {
      return {
        usage: { input_tokens: 800, output_tokens: 400, ...USAGE },
        stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify(EXTRAKTION) }],
      };
    }
    if (system === buildAnalysSystemPrompt()) {
      return {
        usage: { input_tokens: 600, output_tokens: 200, ...USAGE },
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              betyg: "B",
              betygMotivering: "Rimligt stabil förening med enstaka svagheter.",
              rodaFlaggor: [],
              fragor: [],
            }),
          },
        ],
      };
    }
    if (system === buildGroundingSystemPrompt()) throw new Error("grundning ska inte köras");
    throw new Error("Okänd systemprompt i testklienten.");
  });
  const countTokens = vi.fn(async () => ({ input_tokens: 100 }));
  return {
    client: { messages: { countTokens, create } } as unknown as AnthropicClientLike,
    create,
  };
}

function alternativ(client: AnthropicClientLike): KorNastaStegOptions {
  return {
    client,
    identifieraMedModell: vi.fn<typeof identifieraMedModell>(async () => ({
      identitet: null,
      spentSek: 0,
      calls: [],
    })),
  };
}

async function tillExtraktion(lager: FakeLager, pdf: Uint8Array) {
  const res = await skapaAnalys(
    lager,
    buildEnv(),
    { pdfBytes: pdf, propertyInput },
    lokalIdentitet,
  );
  if (!res.ok) throw new Error(`skapaAnalys misslyckades: ${res.errorMessage}`);
  const rad = await lager.db.hamtaAnalys(res.analysisId);
  const id = rad?.rapportId ?? "";
  await lager.db.uppdateraRapport(id, {
    stage: "extraktion",
    grundtext: "Föreningen heter Brf Kastanjen.",
  });
  return id;
}

async function kor(lager: FakeLager, client: AnthropicClientLike): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const r = await korNastaSteg(lager, buildEnv(), alternativ(client));
    if (!r.claimed) return;
  }
  throw new Error("Workern blev aldrig klar.");
}

async function rapportNu(lager: FakeLager, id: string): Promise<RapportRad> {
  const r = await lager.db.hamtaRapport(id);
  if (!r) throw new Error("rapport saknas");
  return r;
}

afterEach(() => vi.restoreAllMocks());

describe("extraktion: sidtexter för sidkontrollen är best effort", () => {
  it("en PDF-läsare som kastar ger ändå en klar rapport (kontrollen hoppas över)", async () => {
    const lager = skapaFakeLager();
    const klient = skapaKlient();
    const id = await tillExtraktion(lager, await textPdf());
    // The page loader reads the stored PDF; make that throw (pdf.js crash/timeout).
    lager.filer.hamta = async () => {
      throw new Error("pdf.js: minnet tog slut");
    };
    const fel = vi.spyOn(console, "error").mockImplementation(() => {});

    await kor(lager, klient.client);

    const r = await rapportNu(lager, id);
    expect(r).toMatchObject({ status: "done", stage: "klar", errorCode: null });
    expect((r.extraction as ExtractionResult).forening.orgnr).toBe(ORGNR);
    expect(fel.mock.calls.some((c) => String(c[0]).includes("sidkontroll_hoppad"))).toBe(true);
  });

  it("en PDF över storleksgränsen hoppar över kontrollen utan att läsa den med pdf.js", async () => {
    const lager = skapaFakeLager();
    const klient = skapaKlient();
    const id = await tillExtraktion(lager, await textPdf());
    const riktig = lager.filer.hamta.bind(lager.filer);
    lager.filer.hamta = async (sokvag: string) => {
      const bytes = await riktig(sokvag);
      // Same bytes, pretending to be huge: only byteLength matters to the guard.
      return Object.defineProperty(bytes.slice(), "byteLength", {
        value: 15_000_001,
      }) as Uint8Array;
    };
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await kor(lager, klient.client);

    expect(await rapportNu(lager, id)).toMatchObject({ status: "done", errorCode: null });
    expect(info.mock.calls.some((c) => String(c[0]).includes("hoppas över"))).toBe(true);
  });
});

describe("extraktion: ett omförsök hoppar över PDF-tolkningen", () => {
  it("efter ett avbrutet försök (t.ex. Edge-CPU-taket) läses PDF:en inte igen", async () => {
    const lager = skapaFakeLager();
    const klient = skapaKlient();
    const id = await tillExtraktion(lager, await textPdf());
    // A previous attempt was claimed and then killed (no try/catch saw it).
    await lager.db.uppdateraRapport(id, { attempts: 1 });
    const riktig = lager.filer.hamta.bind(lager.filer);
    let lasningar = 0;
    lager.filer.hamta = async (sokvag: string) => {
      lasningar++;
      return riktig(sokvag);
    };
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await kor(lager, klient.client);

    expect(await rapportNu(lager, id)).toMatchObject({ status: "done", errorCode: null });
    expect(lasningar).toBe(0);
    expect(info.mock.calls.some((c) => String(c[0]).includes("försök 2"))).toBe(true);
  });
});

describe("bedömning: registeruppdateringen efter klar är best effort", () => {
  it("hamtaRapport som kastar efter att rapporten blivit klar fäller den inte", async () => {
    const lager = skapaFakeLager();
    const klient = skapaKlient();
    const id = await tillExtraktion(lager, await textPdf());
    const avstamningar: number[] = [];
    const avstam = lager.db.avstamSpend.bind(lager.db);
    lager.db.avstamSpend = async (dag, reserverat, faktiskt) => {
      avstamningar.push(faktiskt);
      return avstam(dag, reserverat, faktiskt);
    };
    const hamta = lager.db.hamtaRapport.bind(lager.db);
    lager.db.hamtaRapport = async (rid: string) => {
      const r = await hamta(rid);
      if (r?.status === "done") throw new Error("anslutningen bröts");
      return r;
    };
    const varna = vi.spyOn(console, "warn").mockImplementation(() => {});

    await kor(lager, klient.client);

    const r = await hamta(id);
    expect(r).toMatchObject({ status: "done", stage: "klar", errorCode: null });
    // One reconciliation per paid stage (extraction, judging): no extra one from rapportFel.
    expect(avstamningar).toHaveLength(2);
    expect(varna.mock.calls.some((c) => String(c[0]).includes("registeruppdateringen"))).toBe(true);
  });
});
