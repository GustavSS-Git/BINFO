/**
 * Scanned reports (WS1) through the real register job machine on the in-memory
 * fake: identifiering -> transkribering -> grundning (from sidtext) ->
 * extraktion (kalla 'skannad') -> bedomning -> done. A fake Anthropic client
 * answers each call by recognising its system prompt, so the test also pins
 * which calls the machine makes (and does not make) per route.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalysJudgement } from "@/lib/analysis/analyze";
import { extraktion } from "@/lib/analysis/__fixtures__/extraktion";
import { namnLiknar } from "@/lib/analysis/identitet";
import type { identifieraMedModell } from "@/lib/analysis/identitetModell";
import {
  buildAnalysSystemPrompt,
  buildExtractionSystemPrompt,
  buildGroundingSystemPrompt,
  buildTranskriberingSystemPrompt,
} from "@/lib/analysis/prompts";
import { SKANNAD_KONFIDENS_SKAL, type AnthropicClientLike } from "@/lib/analysis/runExtraction";
import type { ExtractionResult } from "@/types/analysis";
import { skapaFakeLager, type FakeLager } from "./__fakes__/lager";
import { hamtaResultat, hamtaStatus, skapaAnalys, type SkapaAnalysBeroenden } from "./analys";
import type { Env } from "./env";
import type { RapportRad, RapportStage } from "./portar";
import { PIPELINE_VERSION } from "./register";
import {
  TRANSKRIBERING_MAX_OUTPUT_TOKENS_PER_CHUNK,
  UPPSKATTAD_KOSTNAD_TRANSKRIBERING_SEK_PER_SIDA,
} from "./spend";
import { korNastaSteg, type KorNastaStegOptions } from "./steg";

const here = path.dirname(fileURLToPath(import.meta.url));
const MODEL = "claude-sonnet-5-5";
const ORGNR = "769616-0253";
const AR = 2025;
const EXTRAKTION: ExtractionResult = {
  ...extraktion,
  forening: { ...extraktion.forening, orgnr: ORGNR, rakenskapsar: AR },
};

const propertyInput: unknown = (
  JSON.parse(
    await readFile(path.join(here, "..", "..", "fixtures", "property-input-example.json"), "utf-8"),
  ) as { input: unknown }
).input;

function buildEnv(overrides: Partial<Env> = {}): Env {
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
    ...overrides,
  };
}

/** An image-only PDF: blank pages, no text layer. `variant` changes the bytes. */
async function skannadPdf(sidor: number, variant = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < sidor; i++) doc.addPage([200 + variant, 200]);
  return doc.save();
}

async function textPdf(rader: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const sida = doc.addPage([595, 842]);
  rader.forEach((rad, i) => sida.drawText(rad, { x: 50, y: 780 - i * 20, size: 12, font }));
  return doc.save();
}

function lokalIdentitet(): SkapaAnalysBeroenden {
  return {
    identifieraLokalt: () => ({ identitet: null, orgnrKandidater: [], arKandidater: [], skal: [] }),
    namnLiknar,
  };
}

function fakeIdentifierare() {
  return vi.fn<typeof identifieraMedModell>(async () => ({
    identitet: null,
    spentSek: 0.05,
    calls: [],
  }));
}

// ---------------------------------------------------------------------------
// The fake Anthropic client
// ---------------------------------------------------------------------------

type Kind = "transkribering" | "grundning" | "extraktion" | "bedomning";

interface Params {
  system?: unknown;
  max_tokens: number;
  messages: Array<{ content: unknown }>;
}

interface Anrop {
  kind: Kind;
  params: Params;
  /** Transcription calls only: the chunk's original first page / page count. */
  forstaSida?: number;
  antalSidor?: number;
}

interface Styrning {
  inputTokens?: number;
  /** forstaSida -> how many times the chunk's call throws before it works. */
  kasta?: Map<number, number>;
  /** forstaSidor whose answer always carries wrong page markers. */
  felaktigaMarkorer?: Set<number>;
  /** Runs inside a transcription call, before it answers. */
  innanTranskribering?: (anrop: Anrop) => Promise<void>;
}

const USAGE = { cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
/** One transcription call: (2000 in, 800 out) at $2/$10 per Mtok, 9.7 SEK/USD. */
const KOSTNAD_PER_TRANSKRIBERINGSANROP = ((2000 * 2 + 800 * 10) / 1_000_000) * 9.7;

function systemText(system: unknown): string {
  if (typeof system === "string") return system;
  if (Array.isArray(system)) return system.map((b: { text?: string }) => b.text ?? "").join("\n");
  return "";
}

function klassa(params: Params): Kind {
  const system = systemText(params.system);
  if (system === buildTranskriberingSystemPrompt()) return "transkribering";
  if (system === buildGroundingSystemPrompt()) return "grundning";
  if (system === buildExtractionSystemPrompt()) return "extraktion";
  if (system === buildAnalysSystemPrompt()) return "bedomning";
  throw new Error("Okänd systemprompt i testklienten.");
}

function minimalJudgement(): AnalysJudgement {
  return {
    betyg: "B",
    betygMotivering: "Rimligt stabil förening med enstaka svagheter.",
    rodaFlaggor: [],
    fragor: [],
  };
}

function skapaKlient(styr: Styrning = {}) {
  const anrop: Anrop[] = [];
  const kvarAttKasta = new Map(styr.kasta ?? []);
  const countTokens = vi.fn(async () => ({ input_tokens: styr.inputTokens ?? 100 }));

  const create = vi.fn(async (raw: unknown) => {
    const params = raw as Params;
    const kind = klassa(params);
    const post: Anrop = { kind, params };
    anrop.push(post);

    if (kind === "transkribering") {
      const innehall = params.messages[0]?.content as Array<{ text?: string }>;
      const text = innehall.map((b) => b.text ?? "").join(" ");
      post.antalSidor = Number(/innehåller (\d+) sida/.exec(text)?.[1]);
      post.forstaSida = Number(/originalnummer (\d+)/.exec(text)?.[1]);
      await styr.innanTranskribering?.(post);
      const kvar = kvarAttKasta.get(post.forstaSida) ?? 0;
      if (kvar > 0) {
        kvarAttKasta.set(post.forstaSida, kvar - 1);
        throw new Error("modellen kraschade");
      }
      const sidor = Array.from({ length: post.antalSidor }, (_, i) => post.forstaSida! + i);
      const felaktig = styr.felaktigaMarkorer?.has(post.forstaSida) ?? false;
      return {
        usage: { input_tokens: 2000, output_tokens: 800, ...USAGE },
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: sidor
              .map(
                (n) =>
                  `=== SIDA ${felaktig ? n + 100 : n} ===\nSida ${n}: Brf Kastanjen\nÅrsavgift | ${n}00 kr`,
              )
              .join("\n\n"),
          },
        ],
      };
    }

    if (kind === "grundning") {
      const dokument = (params.messages[0]?.content as Array<{ source?: { type?: string } }>)[0];
      const franTranskription = dokument?.source?.type === "content";
      return {
        usage: { input_tokens: 1500, output_tokens: 300, ...USAGE },
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: "Föreningen heter Brf Kastanjen.",
            citations: [
              franTranskription
                ? {
                    type: "content_block_location",
                    cited_text: "Sida 1: Brf Kastanjen",
                    document_index: 0,
                    start_block_index: 0,
                    end_block_index: 1,
                  }
                : { type: "page_location", cited_text: "Brf Kastanjen", start_page_number: 1 },
            ],
          },
        ],
      };
    }

    if (kind === "extraktion") {
      return {
        usage: { input_tokens: 800, output_tokens: 400, ...USAGE },
        stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify(EXTRAKTION) }],
      };
    }

    return {
      usage: { input_tokens: 600, output_tokens: 200, ...USAGE },
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify(minimalJudgement()) }],
    };
  });

  const client = { messages: { countTokens, create } } as unknown as AnthropicClientLike;
  return {
    client,
    anrop,
    create,
    countTokens,
    ofKind: (kind: Kind) => anrop.filter((a) => a.kind === kind),
  };
}

// ---------------------------------------------------------------------------
// Helpers over the machine
// ---------------------------------------------------------------------------

function alternativ(
  klient: ReturnType<typeof skapaKlient>,
  extra: KorNastaStegOptions = {},
): KorNastaStegOptions {
  return { client: klient.client, identifieraMedModell: fakeIdentifierare(), ...extra };
}

/** Runs ticks until nothing is claimable; returns the stages in the order they ran. */
async function korTillsTomt(
  lager: FakeLager,
  options: KorNastaStegOptions,
  env: Env = buildEnv(),
  max = 20,
): Promise<RapportStage[]> {
  const steg: RapportStage[] = [];
  for (let i = 0; i < max; i++) {
    const r = await korNastaSteg(lager, env, options);
    if (!r.claimed) return steg;
    if (r.rapportSteg) steg.push(r.rapportSteg);
  }
  throw new Error("Workern blev aldrig klar.");
}

async function laddaUpp(lager: FakeLager, pdfBytes: Uint8Array, env: Env = buildEnv()) {
  const resultat = await skapaAnalys(lager, env, { pdfBytes, propertyInput }, lokalIdentitet());
  if (!resultat.ok) throw new Error(`skapaAnalys misslyckades: ${resultat.errorMessage}`);
  const rad = await lager.db.hamtaAnalys(resultat.analysisId);
  const rapport = await lager.db.hamtaRapport(rad?.rapportId ?? "");
  if (!rad || !rapport) throw new Error("rad/rapport saknas");
  return { resultat, rad, rapport };
}

async function rapportNu(lager: FakeLager, id: string): Promise<RapportRad> {
  const r = await lager.db.hamtaRapport(id);
  if (!r) throw new Error("rapport saknas");
  return r;
}

/** Spies on the spend port; returns the reserved amounts and the reconciliations. */
function spionera(lager: FakeLager) {
  const reservationer: number[] = [];
  const avstamningar: Array<{ reserverat: number; faktiskt: number }> = [];
  const reservera = lager.db.reserveraSpend.bind(lager.db);
  const avstam = lager.db.avstamSpend.bind(lager.db);
  lager.db.reserveraSpend = async (dag, belopp, tak) => {
    const ok = await reservera(dag, belopp, tak);
    if (ok) reservationer.push(belopp);
    return ok;
  };
  lager.db.avstamSpend = async (dag, reserverat, faktiskt) => {
    avstamningar.push({ reserverat, faktiskt });
    return avstam(dag, reserverat, faktiskt);
  };
  return { reservationer, avstamningar };
}

/** Uploads a scan and moves its rapport straight to 'transkribering'. */
async function skannadVidTranskribering(lager: FakeLager, sidor: number) {
  const { rapport, rad } = await laddaUpp(lager, await skannadPdf(sidor));
  await lager.db.uppdateraRapport(rapport.id, { stage: "transkribering" });
  return { rapportId: rapport.id, analysId: rad.id };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("skannad rapport — hela livscykeln", () => {
  it("identifiering → transkribering → grundning (från sidtext) → extraktion → bedömning → klar", async () => {
    const lager = skapaFakeLager();
    const spend = spionera(lager);
    const klient = skapaKlient();
    const { rad, rapport } = await laddaUpp(lager, await skannadPdf(12));
    expect(rapport).toMatchObject({ textlager: "saknas", stage: "identifiering" });

    const steg = await korTillsTomt(lager, alternativ(klient));
    expect(steg).toEqual([
      "identifiering",
      "transkribering",
      "grundning",
      "extraktion",
      "bedomning",
    ]);

    // Calls: 3 chunks (5+5+2 pages), then one each of grounding, extraction, judging.
    expect(klient.ofKind("transkribering").map((a) => [a.forstaSida, a.antalSidor])).toEqual(
      expect.arrayContaining([
        [1, 5],
        [6, 5],
        [11, 2],
      ]),
    );
    expect(klient.ofKind("transkribering")).toHaveLength(3);
    expect(klient.anrop.slice(3).map((a) => a.kind)).toEqual([
      "grundning",
      "extraktion",
      "bedomning",
    ]);
    for (const t of klient.ofKind("transkribering")) {
      expect(t.params.max_tokens).toBe(TRANSKRIBERING_MAX_OUTPUT_TOKENS_PER_CHUNK);
      expect(t.params.messages[0]?.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "document",
            source: expect.objectContaining({ type: "base64", media_type: "application/pdf" }),
          }),
        ]),
      );
    }

    // Every page persisted, source recorded.
    const sidtext = lager.db._allaSidtext(rapport.id);
    expect(sidtext.map((s) => s.sida)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(new Set(sidtext.map((s) => s.kalla))).toEqual(new Set(["transkribering"]));
    expect(sidtext[6]?.text).toBe("Sida 7: Brf Kastanjen\nÅrsavgift | 700 kr");

    // Grounding ran on the transcription (a custom-content document), not the PDF.
    const grundning = klient.ofKind("grundning")[0];
    const dokument = (grundning?.params.messages[0]?.content as Array<Record<string, unknown>>)[0];
    expect(dokument).toMatchObject({
      type: "document",
      source: { type: "content" },
      citations: { enabled: true },
    });

    // Extraction: tagged as scanned, confidence capped, no text-layer claim.
    const klar = await rapportNu(lager, rapport.id);
    expect(klar).toMatchObject({ status: "done", stage: "klar", errorCode: null, grundtext: null });
    const extraction = klar.extraction as ExtractionResult;
    expect(extraction.datakvalitet).toMatchObject({ kalla: "skannad", pdfSaknarTextlager: true });
    expect(extraction.datakvalitet.extraktionKonfidens.niva).not.toBe("hog");
    expect(extraction.datakvalitet.extraktionKonfidens.skal).toContain(SKANNAD_KONFIDENS_SKAL);
    // The grounded page number comes from the block map: block 0 sits on page 1.
    expect(klient.ofKind("extraktion")[0]?.params.messages[0]?.content).toContain("Sida 1");

    // Spend: the transcription reserved a realistic per-page amount and every
    // reservation was reconciled to the real cost (rapport cost == sum of actuals).
    expect(spend.reservationer).toContain(12 * UPPSKATTAD_KOSTNAD_TRANSKRIBERING_SEK_PER_SIDA);
    const faktiskt = spend.avstamningar.reduce((s, a) => s + a.faktiskt, 0);
    expect(klar.costSek).toBeCloseTo(faktiskt, 9);
    expect(klar.costSek).toBeGreaterThan(3 * KOSTNAD_PER_TRANSKRIBERINGSANROP);

    // The buyer sees a finished report, tagged as scanned.
    expect(await hamtaStatus(lager, rad.id)).toMatchObject({
      status: "done",
      stage: "complete",
      textlager: "saknas",
    });
    const resultat = await hamtaResultat(lager, rad.id);
    expect(resultat.datakvalitet).toMatchObject({ kalla: "skannad" });
  });

  it("samma skannade PDF en gång till: serveras ur registret, inga nya anrop (hash-träff)", async () => {
    const lager = skapaFakeLager();
    const klient = skapaKlient();
    const pdf = await skannadPdf(7);
    await laddaUpp(lager, pdf);
    await korTillsTomt(lager, alternativ(klient));
    const anropFore = klient.anrop.length;

    const andra = await skapaAnalys(
      lager,
      buildEnv(),
      { pdfBytes: pdf, propertyInput },
      lokalIdentitet(),
    );
    expect(andra).toMatchObject({ ok: true, ateranvand: true });
    expect(await korTillsTomt(lager, alternativ(klient))).toEqual([]);
    expect(klient.anrop).toHaveLength(anropFore);
  });

  it("textsökvägen är oförändrad: grundning på själva PDF:en, ingen transkribering, kalla 'textlager'", async () => {
    const lager = skapaFakeLager();
    const klient = skapaKlient();
    const { rapport } = await laddaUpp(
      lager,
      await textPdf(["Arsredovisning for Brf Kastanjen", `Org.nr ${ORGNR}`, "Rakenskapsaret 2025"]),
    );
    expect(rapport.textlager).toBe("ok");

    const steg = await korTillsTomt(lager, alternativ(klient));
    expect(steg).toEqual(["identifiering", "grundning", "extraktion", "bedomning"]);
    expect(klient.ofKind("transkribering")).toHaveLength(0);
    const dokument = (
      klient.ofKind("grundning")[0]?.params.messages[0]?.content as Array<Record<string, unknown>>
    )[0];
    expect(dokument).toMatchObject({ type: "document", source: { type: "base64" } });
    expect(lager.db._allaSidtext(rapport.id)).toEqual([]);

    const extraction = (await rapportNu(lager, rapport.id)).extraction as ExtractionResult;
    expect(extraction.datakvalitet).toMatchObject({
      kalla: "textlager",
      pdfSaknarTextlager: false,
    });
    expect(extraction.datakvalitet.extraktionKonfidens.skal ?? []).not.toContain(
      SKANNAD_KONFIDENS_SKAL,
    );
  });

  it("ett trasigt textlager stannar på den vanliga vägen (uppmätt bättre än skannvägen)", async () => {
    const lager = skapaFakeLager();
    const klient = skapaKlient();
    const { rapport } = await laddaUpp(
      lager,
      await textPdf(["7 , 4 3 8 , 0 0 k r 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5"]),
    );
    expect(rapport.textlager).toBe("trasigt");

    const steg = await korTillsTomt(lager, alternativ(klient));
    expect(steg).toEqual(["identifiering", "grundning", "extraktion", "bedomning"]);
    expect(klient.ofKind("transkribering")).toHaveLength(0);
    const dokument = (
      klient.ofKind("grundning")[0]?.params.messages[0]?.content as Array<Record<string, unknown>>
    )[0];
    expect(dokument).toMatchObject({ source: { type: "base64" } });
    const extraction = (await rapportNu(lager, rapport.id)).extraction as ExtractionResult;
    expect(extraction.datakvalitet.kalla).toBe("textlager");
  });
});

describe("transkriberingssteget", () => {
  it("ett chunk-fel: de färdiga sidorna sparas och räknas av, omförsöket gör BARA den saknade chunken", async () => {
    const lager = skapaFakeLager();
    const spend = spionera(lager);
    const klient = skapaKlient({ kasta: new Map([[6, 1]]) });
    const { rapportId } = await skannadVidTranskribering(lager, 12);
    const options = alternativ(klient);

    // Tick 1: chunks 1–5 and 11–12 finish, 6–10 throws.
    const r1 = await korNastaSteg(lager, buildEnv(), options);
    expect(r1).toMatchObject({ claimed: true, rapportSteg: "transkribering" });
    expect(klient.ofKind("transkribering")).toHaveLength(3);
    expect(lager.db._allaSidtext(rapportId).map((s) => s.sida)).toEqual([1, 2, 3, 4, 5, 11, 12]);
    const efterFel = await rapportNu(lager, rapportId);
    expect(efterFel).toMatchObject({
      status: "queued",
      stage: "transkribering",
      attempts: 1,
      errorCode: "unknown",
      leaseUntil: null,
    });
    // Real spend of the two finished chunks is booked on the rapport and reconciled.
    expect(efterFel.costSek).toBeCloseTo(2 * KOSTNAD_PER_TRANSKRIBERINGSANROP, 9);
    expect(spend.avstamningar[0]).toEqual({
      reserverat: 12 * UPPSKATTAD_KOSTNAD_TRANSKRIBERING_SEK_PER_SIDA,
      faktiskt: expect.closeTo(2 * KOSTNAD_PER_TRANSKRIBERINGSANROP, 9),
    });

    // Tick 2: exactly one more call — the missing chunk.
    await korNastaSteg(lager, buildEnv(), options);
    expect(klient.ofKind("transkribering")).toHaveLength(4);
    expect(klient.ofKind("transkribering")[3]).toMatchObject({ forstaSida: 6, antalSidor: 5 });
    expect(klient.countTokens).toHaveBeenCalledTimes(3 + 1);
    const klarMedSteget = await rapportNu(lager, rapportId);
    expect(klarMedSteget).toMatchObject({
      stage: "grundning",
      status: "queued",
      attempts: 0,
      errorCode: null,
    });
    expect(klarMedSteget.costSek).toBeCloseTo(3 * KOSTNAD_PER_TRANSKRIBERINGSANROP, 9);
    expect(lager.db._allaSidtext(rapportId)).toHaveLength(12);
    // The retry reserved only the 5 missing pages.
    expect(spend.reservationer).toEqual([
      12 * UPPSKATTAD_KOSTNAD_TRANSKRIBERING_SEK_PER_SIDA,
      5 * UPPSKATTAD_KOSTNAD_TRANSKRIBERING_SEK_PER_SIDA,
    ]);
  });

  it("tre misslyckade försök: rapporten blir failed med ett köparsäkert fel, och spenden är bokförd", async () => {
    const lager = skapaFakeLager();
    const klient = skapaKlient({ kasta: new Map([[1, 99]]) });
    const { rapportId } = await skannadVidTranskribering(lager, 5);
    const options = alternativ(klient);
    for (let i = 0; i < 3; i++) await korNastaSteg(lager, buildEnv(), options);
    const r = await rapportNu(lager, rapportId);
    expect(r).toMatchObject({ status: "failed", stage: "transkribering", errorCode: "unknown" });
    expect(r.errorMessage).not.toContain("modellen kraschade");
    expect(await korNastaSteg(lager, buildEnv(), options)).toEqual({ claimed: false });
  });

  it("felaktiga sidmarkörer även efter omförsöket: scanned_pdf med fast text, båda anropens kostnad bokförd", async () => {
    const lager = skapaFakeLager();
    const spend = spionera(lager);
    const klient = skapaKlient({ felaktigaMarkorer: new Set([1]) });
    const { rapportId } = await skannadVidTranskribering(lager, 5);

    await korNastaSteg(lager, buildEnv(), alternativ(klient));

    expect(klient.ofKind("transkribering")).toHaveLength(2);
    const r = await rapportNu(lager, rapportId);
    expect(r).toMatchObject({
      status: "queued",
      stage: "transkribering",
      errorCode: "scanned_pdf",
    });
    expect(r.errorMessage).toBe(
      "Vi kunde inte läsa av de skannade sidorna tillförlitligt. " +
        "Försök gärna med en digital version av årsredovisningen.",
    );
    expect(r.costSek).toBeCloseTo(2 * KOSTNAD_PER_TRANSKRIBERINGSANROP, 9);
    expect(spend.avstamningar[0]?.faktiskt).toBeCloseTo(2 * KOSTNAD_PER_TRANSKRIBERINGSANROP, 9);
    expect(lager.db._allaSidtext(rapportId)).toEqual([]);
  });

  it("lease förlorad mitt i transkriberingen: resultatet skrivs inte över en avslutad rapport", async () => {
    const lager = skapaFakeLager();
    const spend = spionera(lager);
    const varna = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reinvoke = vi.fn();
    const { rapportId } = await skannadVidTranskribering(lager, 5);
    const klient = skapaKlient({
      innanTranskribering: async () => {
        // An admin invalidates the rapport while the model is working.
        await lager.db.uppdateraRapport(rapportId, {
          status: "failed",
          errorCode: "ogiltigforklarad",
          leaseUntil: null,
          finishedAt: new Date().toISOString(),
        });
      },
    });

    await korNastaSteg(lager, buildEnv(), alternativ(klient, { reinvoke }));

    expect(await rapportNu(lager, rapportId)).toMatchObject({
      status: "failed",
      stage: "transkribering",
      errorCode: "ogiltigforklarad",
      costSek: 0,
    });
    expect(reinvoke).not.toHaveBeenCalled();
    expect(varna).toHaveBeenCalledWith(expect.stringContaining("ändrades av någon annan"));
    // Spend is still reconciled to what the model call really cost.
    expect(spend.avstamningar[0]).toEqual({
      reserverat: 5 * UPPSKATTAD_KOSTNAD_TRANSKRIBERING_SEK_PER_SIDA,
      faktiskt: expect.closeTo(KOSTNAD_PER_TRANSKRIBERINGSANROP, 9),
    });
  });

  it("budgeten är max(per-analys-taket, chunkar × 1,0 kr): ryms värsta fallet går det, annars synligt cost_cap före första anropet", async () => {
    // 12 sidor = 3 chunkar; med 8 600 in-tokens är värsta fallet ~0,94 kr per chunk (2,83 kr
    // totalt) — över ett per-analys-tak på 1 kr, men under max(1, 3 × 1,0).
    const lager = skapaFakeLager();
    const klient = skapaKlient({ inputTokens: 8_600 });
    const { rapportId } = await skannadVidTranskribering(lager, 12);
    await korNastaSteg(lager, buildEnv({ maxCostPerAnalysisSek: 1 }), alternativ(klient));
    expect(klient.ofKind("transkribering")).toHaveLength(3);
    expect((await rapportNu(lager, rapportId)).stage).toBe("grundning");

    // Med 12 000 in-tokens är värsta fallet ~1,01 kr per chunk = 3,03 kr > 3 kr.
    const lager2 = skapaFakeLager();
    const klient2 = skapaKlient({ inputTokens: 12_000 });
    const { rapportId: id2 } = await skannadVidTranskribering(lager2, 12);
    await korNastaSteg(lager2, buildEnv({ maxCostPerAnalysisSek: 1 }), alternativ(klient2));
    expect(klient2.create).not.toHaveBeenCalled();
    expect(await rapportNu(lager2, id2)).toMatchObject({
      stage: "transkribering",
      errorCode: "cost_cap",
      costSek: 0,
    });
  });

  it("dagens spend-tak nekar reservationen: rapporten läggs tillbaka med försöket återlämnat, inga anrop", async () => {
    const lager = skapaFakeLager();
    const klient = skapaKlient();
    const { rapportId } = await skannadVidTranskribering(lager, 12);

    // 12 sidor reserverar 1,8 kr — över ett tak på 1 kr.
    await korNastaSteg(lager, buildEnv({ maxDailySpendSek: 1 }), alternativ(klient));

    expect(klient.create).not.toHaveBeenCalled();
    expect(klient.countTokens).not.toHaveBeenCalled();
    expect(await rapportNu(lager, rapportId)).toMatchObject({
      status: "queued",
      stage: "transkribering",
      attempts: 0,
      errorCode: null,
    });
  });

  it("alla sidor redan sparade: inga anrop och ingen reservation, vidare till grundning", async () => {
    const lager = skapaFakeLager();
    const spend = spionera(lager);
    const klient = skapaKlient();
    const { rapportId } = await skannadVidTranskribering(lager, 7);
    await lager.db.sparaSidtext(
      rapportId,
      Array.from({ length: 7 }, (_, i) => ({ sida: i + 1, text: `redan ${i + 1}` })),
      "transkribering",
    );

    await korNastaSteg(lager, buildEnv(), alternativ(klient));

    expect(klient.create).not.toHaveBeenCalled();
    expect(spend.reservationer).toEqual([]);
    expect(await rapportNu(lager, rapportId)).toMatchObject({ stage: "grundning", costSek: 0 });
  });

  it("modellen som sätts på rapporten används (inte miljöns), med env.effortGrounding", async () => {
    const lager = skapaFakeLager();
    const klient = skapaKlient();
    await skannadVidTranskribering(lager, 3);
    await korNastaSteg(lager, buildEnv({ effortGrounding: "low" }), alternativ(klient));
    const anrop = klient.create.mock.calls[0]?.[0] as unknown as {
      model: string;
      output_config: { effort: string };
    };
    expect(anrop.model).toBe(MODEL);
    expect(anrop.output_config).toEqual({ effort: "low" });
  });
});

describe("grundning på transkriptionen", () => {
  it("en skannad rapport utan sparad sidtext misslyckas synligt före något anrop (scanned_pdf), spend återställd", async () => {
    const lager = skapaFakeLager();
    const spend = spionera(lager);
    const klient = skapaKlient();
    const { rapport } = await laddaUpp(lager, await skannadPdf(4));
    await lager.db.uppdateraRapport(rapport.id, { stage: "grundning" });

    await korNastaSteg(lager, buildEnv(), alternativ(klient));

    expect(klient.create).not.toHaveBeenCalled();
    expect(await rapportNu(lager, rapport.id)).toMatchObject({
      status: "queued",
      stage: "grundning",
      errorCode: "scanned_pdf",
      costSek: 0,
    });
    expect(spend.avstamningar).toEqual([{ reserverat: 3, faktiskt: 0 }]);
  });

  it("grundningen läser sidtexten i sidordning, oavsett i vilken ordning den sparades", async () => {
    const lager = skapaFakeLager();
    const klient = skapaKlient();
    const { rapport } = await laddaUpp(lager, await skannadPdf(2));
    await lager.db.sparaSidtext(
      rapport.id,
      [{ sida: 2, text: "Andra sidan | 2" }],
      "transkribering",
    );
    await lager.db.sparaSidtext(rapport.id, [{ sida: 1, text: "Första sidan" }], "transkribering");
    await lager.db.uppdateraRapport(rapport.id, { stage: "grundning" });

    await korNastaSteg(lager, buildEnv(), alternativ(klient));

    const dokument = (
      klient.ofKind("grundning")[0]?.params.messages[0]?.content as Array<{
        source: { content: Array<{ text: string }> };
      }>
    )[0];
    expect(dokument?.source.content.map((b) => b.text)).toEqual([
      "Första sidan",
      "Andra sidan | 2",
    ]);
    expect((await rapportNu(lager, rapport.id)).stage).toBe("extraktion");
  });
});

describe("registret och skannade rapporter", () => {
  it("två skannade uppladdningar av samma bytes samtidigt: en transkribering", async () => {
    const lager = skapaFakeLager();
    const klient = skapaKlient();
    const pdf = await skannadPdf(6);
    const [a, b] = await Promise.all([laddaUpp(lager, pdf), laddaUpp(lager, pdf)]);
    expect(a.rapport.id).toBe(b.rapport.id);
    await korTillsTomt(lager, alternativ(klient));
    expect(klient.ofKind("transkribering")).toHaveLength(2); // 5 + 1 pages, once
    expect(
      lager.db._allaRapporter().filter((r) => r.pipelineVersion === PIPELINE_VERSION),
    ).toHaveLength(1);
  });
});
