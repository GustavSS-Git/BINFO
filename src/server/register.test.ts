/**
 * The register (v2) end to end on the in-memory fake: upload linking
 * (skapaAnalys), the rapport worker (korNastaSteg), and the read paths
 * (hamtaStatus / hamtaResultat). No Anthropic calls:
 * a fake client for the three pipeline stages and an injected identity
 * function for the identifiering stage.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AnalysJudgement } from "@/lib/analysis/analyze";
import { extraktion } from "@/lib/analysis/__fixtures__/extraktion";
import { namnLiknar, type Rapportidentitet } from "@/lib/analysis/identitet";
import type { identifieraMedModell } from "@/lib/analysis/identitetModell";
import { ModelValidationError } from "@/lib/analysis/extract";
import { AssemblyValidationError } from "@/lib/analysis/assemble";
import type { AnthropicClientLike } from "@/lib/analysis/runExtraction";
import { APIConnectionError, InternalServerError } from "@anthropic-ai/sdk";
import { AnalysisResultSchema } from "@/lib/analysis/schema";
import { losTackning } from "@/lib/vardering";
import type { ExtractionResult } from "@/types/analysis";
import { skapaFakeLager, type FakeLager } from "./__fakes__/lager";
import {
  AnalysInteKlarError,
  hamtaResultat,
  hamtaStatus,
  skapaAnalys,
  type SkapaAnalysBeroenden,
} from "./analys";
import type { Env } from "./env";
import type { Databas, RapportRad, RapportStage } from "./portar";
import {
  ALDRE_VERSION_SKAL,
  klassificeraTextlager,
  nyareArSkal,
  PIPELINE_VERSION,
  tillAnalysStage,
} from "./register";
import { korNastaSteg, type KorNastaStegOptions } from "./steg";

const here = path.dirname(fileURLToPath(import.meta.url));
const MODEL = "claude-sonnet-5";
/** Luhn-valid (the shared fixture's 769612-3456 is not, so every identity
 *  check in the register would rightly reject it). */
const ORGNR = "769616-0253";
const AR = 2025;
/** The extraction fixture, carrying the Luhn-valid test orgnr. */
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

/** A real, text-bearing PDF. Different `rader` → different bytes/hash. */
async function skapaPdf(rader: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const sida = doc.addPage([595, 842]);
  rader.forEach((rad, i) => sida.drawText(rad, { x: 50, y: 780 - i * 20, size: 12, font }));
  return doc.save();
}

const standardPdf = () =>
  skapaPdf(["Arsredovisning for Brf Kastanjen", `Org.nr ${ORGNR}`, `Rakenskapsaret ${AR}`]);

/** Stub for the local identity scan — the real one is tested in its own module. */
function lokalIdentitet(identitet: Rapportidentitet | null): SkapaAnalysBeroenden {
  return {
    identifieraLokalt: () => ({ identitet, orgnrKandidater: [], arKandidater: [], skal: [] }),
    namnLiknar,
  };
}

const KASTANJEN: Rapportidentitet = { orgnr: ORGNR, rakenskapsar: AR, namn: "Brf Kastanjen" };

type CountTokens = AnthropicClientLike["messages"]["countTokens"];
type Create = AnthropicClientLike["messages"]["create"];

function fakeClient() {
  const client = {
    messages: {
      countTokens: vi.fn<CountTokens>().mockResolvedValue({ input_tokens: 100 }),
      create: vi.fn<Create>(),
    },
  };
  return client;
}

function minimalJudgement(): AnalysJudgement {
  return {
    betyg: "C",
    betygMotivering: "Rimligt stabil förening med enstaka svagheter.",
    rodaFlaggor: [],
    fragor: [],
  };
}

/** Queues the three pipeline responses, each reporting prompt-cache tokens. */
function koaPipelineSvar(
  client: ReturnType<typeof fakeClient>,
  data: ExtractionResult = EXTRAKTION,
) {
  const usage = (input: number, output: number) => ({
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: 40,
    cache_creation_input_tokens: 10,
  });
  client.messages.create
    .mockResolvedValueOnce({
      usage: usage(500, 200),
      content: [
        {
          type: "text",
          text: "Föreningen heter Brf Kastanjen.",
          citations: [{ type: "page_location", cited_text: "Brf Kastanjen", start_page_number: 1 }],
        },
      ],
    })
    .mockResolvedValueOnce({
      usage: usage(300, 100),
      content: [{ type: "text", text: JSON.stringify(data) }],
    })
    .mockResolvedValueOnce({
      usage: usage(200, 80),
      content: [{ type: "text", text: JSON.stringify(minimalJudgement()) }],
    });
}

function fakeIdentifierare(identitet: Rapportidentitet | null) {
  return vi.fn<typeof identifieraMedModell>(async () => ({
    identitet,
    spentSek: 0.05,
    calls: [],
  }));
}

/** Runs the worker until nothing is claimable. Returns the number of ticks. */
async function korTillsTomt(lager: FakeLager, options: KorNastaStegOptions, max = 20) {
  let ticks = 0;
  while (ticks < max) {
    const r = await korNastaSteg(lager, buildEnv(), options);
    if (!r.claimed) return ticks;
    ticks++;
  }
  throw new Error("Workern blev aldrig klar.");
}

/** Seeds a finished rapport (with forening + file) straight into the fake. */
async function seedaKlarRapport(
  lager: FakeLager,
  opts: {
    pdfHash: string;
    identitet?: Rapportidentitet | null;
    pipelineVersion?: string;
    extraction?: unknown;
    judgement?: unknown;
    status?: RapportRad["status"];
    stage?: RapportStage;
    laggUppPdf?: boolean;
  },
): Promise<string> {
  const identitet = opts.identitet === undefined ? KASTANJEN : opts.identitet;
  if (identitet) await lager.db.registreraForening(identitet.orgnr, identitet.namn);
  const skapad = await lager.db.skapaRapport({
    orgnr: identitet?.orgnr ?? null,
    rakenskapsar: identitet?.rakenskapsar ?? null,
    pipelineVersion: opts.pipelineVersion ?? PIPELINE_VERSION,
    model: MODEL,
    textlager: "ok",
    status: opts.status ?? "done",
    stage: opts.stage ?? "klar",
    pdfHash: opts.pdfHash,
    extraction: opts.extraction === undefined ? EXTRAKTION : opts.extraction,
    judgement: opts.judgement === undefined ? minimalJudgement() : opts.judgement,
    finishedAt:
      (opts.status ?? "done") === "done" ? new Date(Date.now() - 60_000).toISOString() : null,
  });
  if (!skapad.ok) throw new Error("seed krockade");
  await lager.db.skapaRapportFil({
    pdfHash: opts.pdfHash,
    rapportId: skapad.id,
    pdfPath: `${opts.pdfHash}.pdf`,
    sidor: 1,
    bytes: 1,
  });
  if (opts.laggUppPdf !== false) {
    await lager.filer.laggUpp(`${opts.pdfHash}.pdf`, await standardPdf());
  }
  return skapad.id;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function laddaUpp(
  lager: FakeLager,
  pdfBytes: Uint8Array,
  beroenden: SkapaAnalysBeroenden = lokalIdentitet(null),
) {
  const resultat = await skapaAnalys(lager, buildEnv(), { pdfBytes, propertyInput }, beroenden);
  if (!resultat.ok) throw new Error(`skapaAnalys misslyckades: ${resultat.errorMessage}`);
  const rad = await lager.db.hamtaAnalys(resultat.analysisId);
  if (!rad) throw new Error("analys-raden saknas");
  return { resultat, rad };
}

/** Holds the first `antal` calls to `metod` until all of them have arrived —
 *  forces the interleaving a real race would need. */
function medBarriar(db: Databas, metod: keyof Databas, antal = 2): Databas {
  const vantande: Array<() => void> = [];
  let anrop = 0;
  return new Proxy(db, {
    get(target, prop, mottagare) {
      const varde: unknown = Reflect.get(target, prop, mottagare);
      if (prop !== metod || typeof varde !== "function") return varde;
      return async (...args: unknown[]) => {
        anrop++;
        if (anrop <= antal) {
          await new Promise<void>((klar) => {
            vantande.push(klar);
            if (vantande.length === antal) vantande.forEach((f) => f());
          });
        }
        return (varde as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

// ---------------------------------------------------------------------------

describe("klassificeraTextlager / tillAnalysStage", () => {
  it("saknas = alla sidor tomma; trasigt = glyf-för-glyf-text; annars ok", () => {
    expect(klassificeraTextlager(["", "  \n"])).toBe("saknas");
    expect(klassificeraTextlager(["7 , 4 3 8 , 0 0 k r 1 2 3 4 5 6 7 8 9"])).toBe("trasigt");
    expect(klassificeraTextlager(["Årsavgift per kvadratmeter 7 438,00 kr"])).toBe("ok");
  });

  it("mappar rapportens steg till UI:ts AnalysStage", () => {
    const fall: Array<[RapportStage, string]> = [
      ["identifiering", "uploaded"],
      ["transkribering", "uploaded"],
      ["grundning", "uploaded"],
      ["extraktion", "extracting"],
      ["bedomning", "judging"],
      ["klar", "complete"],
    ];
    for (const [rapportSteg, forvantat] of fall) {
      expect(tillAnalysStage(rapportSteg)).toBe(forvantat);
    }
  });
});

describe("skapaAnalys — registret", () => {
  it("kallt utan lokal identitet: ny rapport i 'identifiering', fil + länk, setup-leasen släppt", async () => {
    const lager = skapaFakeLager();
    const pdf = await standardPdf();
    const { resultat, rad } = await laddaUpp(lager, pdf);

    expect(resultat).toEqual({ ok: true, analysisId: rad.id });
    const [rapport] = lager.db._allaRapporter();
    expect(rapport).toMatchObject({
      orgnr: null,
      rakenskapsar: null,
      stage: "identifiering",
      status: "queued",
      textlager: "ok",
      pipelineVersion: PIPELINE_VERSION,
      model: MODEL,
      leaseUntil: null,
      pdfHash: await sha256Hex(pdf),
    });
    expect(rad.rapportId).toBe(rapport?.id);
    expect(rad.status).toBe("queued");
    expect(rad.stage).toBe("uploaded");
    expect(lager.db._allaRapportFiler()).toEqual([
      expect.objectContaining({ pdfHash: rapport?.pdfHash, rapportId: rapport?.id, sidor: 1 }),
    ]);
    expect(await lager.filer.finns(`${rapport?.pdfHash}.pdf`)).toBe(true);
  });

  it("kallt med lokal identitet: rapport direkt i 'grundning', förening + område registrerade utan gatuadress", async () => {
    const lager = skapaFakeLager();
    await laddaUpp(lager, await standardPdf(), lokalIdentitet(KASTANJEN));

    const [rapport] = lager.db._allaRapporter();
    expect(rapport).toMatchObject({ orgnr: ORGNR, rakenskapsar: AR, stage: "grundning" });
    expect((await lager.db.hamtaForening(ORGNR))?.namn).toBe("Brf Kastanjen");

    const tackning = losTackning((propertyInput as { postnummer: string }).postnummer);
    const adresser = lager.db._allaAdresser();
    if (tackning && (tackning.kommunKod !== null || tackning.omrade !== null)) {
      expect(adresser).toEqual([
        expect.objectContaining({
          orgnr: ORGNR,
          kalla: "anvandare",
          adress: null,
          kommunKod: tackning.kommunKod,
          omrade: tackning.omrade,
        }),
      ]);
    } else {
      expect(adresser).toEqual([]);
    }
  });

  it("hash-träff på en klar rapport: återanvänd, klar direkt, noll modellanrop", async () => {
    const lager = skapaFakeLager();
    const pdf = await standardPdf();
    const rapportId = await seedaKlarRapport(lager, { pdfHash: await sha256Hex(pdf) });

    const { resultat, rad } = await laddaUpp(lager, pdf);
    expect(resultat).toEqual({ ok: true, analysisId: rad.id, ateranvand: true });
    expect(rad.rapportId).toBe(rapportId);
    expect(lager.db._allaRapporter()).toHaveLength(1);

    const status = await hamtaStatus(lager, rad.id);
    expect(status).toMatchObject({
      status: "done",
      stage: "complete",
      ateranvand: true,
      vantarPaRapport: false,
      rapportSteg: "klar",
      textlager: "ok",
    });
    const fullt = await hamtaResultat(lager, rad.id);
    expect(AnalysisResultSchema.safeParse(fullt).success).toBe(true);
    expect(fullt.analysisId).toBe(rad.id);
    expect(fullt.datakvalitet.extraktionKonfidens.skal ?? []).not.toContain(ALDRE_VERSION_SKAL);
  });

  it("hash-träff på en pågående rapport: väntar på den, ingen ny rapport", async () => {
    const lager = skapaFakeLager();
    const pdf = await standardPdf();
    const forsta = await laddaUpp(lager, pdf);
    const andra = await laddaUpp(lager, pdf);

    expect(andra.resultat).toEqual({ ok: true, analysisId: andra.rad.id, vantarPaRapport: true });
    expect(andra.rad.rapportId).toBe(forsta.rad.rapportId);
    expect(lager.db._allaRapporter()).toHaveLength(1);
    expect(await hamtaStatus(lager, andra.rad.id)).toMatchObject({
      status: "queued",
      stage: "uploaded",
      rapportSteg: "identifiering",
      vantarPaRapport: true,
    });
    expect(await hamtaStatus(lager, forsta.rad.id)).toMatchObject({ vantarPaRapport: false });
  });

  it("identitetsträff med matchande namn: ny fil pekar på den befintliga rapporten", async () => {
    const lager = skapaFakeLager();
    const rapportId = await seedaKlarRapport(lager, { pdfHash: "annan-utgava" });

    const pdf = await skapaPdf(["Samma rapport, annan nedladdning", "Brf Kastanjen"]);
    const { resultat, rad } = await laddaUpp(lager, pdf, lokalIdentitet(KASTANJEN));

    expect(resultat).toMatchObject({ ok: true, ateranvand: true });
    expect(rad.rapportId).toBe(rapportId);
    expect(lager.db._allaRapporter()).toHaveLength(1);
    expect((await lager.db.hamtaRapportFil(await sha256Hex(pdf)))?.rapportId).toBe(rapportId);
  });

  it("identitetsträff med avvikande namn: ny rapport UTAN identitet (orgnr kan vara feläst)", async () => {
    const lager = skapaFakeLager();
    const befintlig = await seedaKlarRapport(lager, { pdfHash: "annan-utgava" });

    const pdf = await skapaPdf(["En helt annan förening"]);
    const { rad } = await laddaUpp(
      lager,
      pdf,
      lokalIdentitet({ orgnr: ORGNR, rakenskapsar: AR, namn: "Brf Ekbacken Norra" }),
    );

    expect(rad.rapportId).not.toBe(befintlig);
    const ny = await lager.db.hamtaRapport(rad.rapportId ?? "");
    expect(ny).toMatchObject({ orgnr: null, rakenskapsar: null, stage: "identifiering" });
    expect((await lager.db.hamtaForening(ORGNR))?.namn).toBe("Brf Kastanjen");
  });

  it("två samtidiga identiska uppladdningar: exakt en rapport, båda länkade, en pipelinekörning", async () => {
    const bas = skapaFakeLager();
    const lager: FakeLager = {
      ...bas,
      db: medBarriar(bas.db, "hamtaRapportFil") as FakeLager["db"],
    };
    const pdf = await standardPdf();

    const [a, b] = await Promise.all([laddaUpp(lager, pdf), laddaUpp(lager, pdf.slice())]);

    const rapporter = bas.db._allaRapporter();
    expect(rapporter).toHaveLength(1);
    expect(a.rad.rapportId).toBe(rapporter[0]?.id);
    expect(b.rad.rapportId).toBe(rapporter[0]?.id);
    expect([a.resultat, b.resultat].filter((r) => "vantarPaRapport" in r)).toHaveLength(1);
    expect(rapporter[0]?.leaseUntil).toBeNull();

    const client = fakeClient();
    koaPipelineSvar(client);
    const identifiera = fakeIdentifierare(null);
    await korTillsTomt(bas, { client, identifieraMedModell: identifiera });

    expect(identifiera).toHaveBeenCalledTimes(1);
    expect(client.messages.create).toHaveBeenCalledTimes(3);
    for (const id of [a.rad.id, b.rad.id]) {
      expect(await hamtaStatus(bas, id)).toMatchObject({ status: "done", stage: "complete" });
    }
  });

  it("identitetskapplöpning: två olika filer med samma identitet samtidigt → en rapport, två filer", async () => {
    const bas = skapaFakeLager();
    const lager: FakeLager = {
      ...bas,
      db: medBarriar(bas.db, "registreraForening") as FakeLager["db"],
    };
    const pdfA = await skapaPdf(["Utgava A"]);
    const pdfB = await skapaPdf(["Utgava B"]);

    const [a, b] = await Promise.all([
      laddaUpp(lager, pdfA, lokalIdentitet(KASTANJEN)),
      laddaUpp(lager, pdfB, lokalIdentitet(KASTANJEN)),
    ]);

    const rapporter = bas.db._allaRapporter();
    expect(rapporter).toHaveLength(1);
    expect(rapporter[0]).toMatchObject({ orgnr: ORGNR, rakenskapsar: AR, leaseUntil: null });
    expect(a.rad.rapportId).toBe(rapporter[0]?.id);
    expect(b.rad.rapportId).toBe(rapporter[0]?.id);
    expect(bas.db._allaRapportFiler().map((f) => f.rapportId)).toEqual([
      rapporter[0]?.id,
      rapporter[0]?.id,
    ]);
  });

  it("en misslyckad rapport återanvänds aldrig: en ny skapas och filen pekas om", async () => {
    const lager = skapaFakeLager();
    const pdf = await standardPdf();
    const gammal = await seedaKlarRapport(lager, {
      pdfHash: await sha256Hex(pdf),
      identitet: null,
      status: "failed",
      stage: "grundning",
      extraction: null,
      judgement: null,
    });

    const { rad } = await laddaUpp(lager, pdf);
    expect(rad.rapportId).not.toBe(gammal);
    expect((await lager.db.hamtaRapportFil(await sha256Hex(pdf)))?.rapportId).toBe(rad.rapportId);
  });

  it("en skannad PDF köas (SKANNADE_RAPPORTER_AKTIVA på): textlager 'saknas', identifiering först", async () => {
    const lager = skapaFakeLager();
    const doc = await PDFDocument.create();
    doc.addPage();
    const resultat = await skapaAnalys(
      lager,
      buildEnv(),
      { pdfBytes: await doc.save(), propertyInput },
      lokalIdentitet(null),
    );
    expect(resultat.ok).toBe(true);
    expect(lager.db._allaRapporter()).toEqual([
      expect.objectContaining({ textlager: "saknas", stage: "identifiering", status: "queued" }),
    ]);
  });

  it("en skannad PDF med lokal identitet går direkt till transkribering, inte grundning", async () => {
    const lager = skapaFakeLager();
    const doc = await PDFDocument.create();
    doc.addPage();
    await skapaAnalys(
      lager,
      buildEnv(),
      { pdfBytes: await doc.save(), propertyInput },
      lokalIdentitet(KASTANJEN),
    );
    expect(lager.db._allaRapporter()).toEqual([
      expect.objectContaining({ textlager: "saknas", stage: "transkribering" }),
    ]);
  });
});

describe("granskningsfynd — uppladdning och läsväg", () => {
  it("M1: samma pipeline_version men oläsbart resultat (hash-träff): rapporten ogiltigförklaras, en omkörning köas, inget kast", async () => {
    const lager = skapaFakeLager();
    const pdf = await standardPdf();
    const trasig = await seedaKlarRapport(lager, {
      pdfHash: await sha256Hex(pdf),
      extraction: { schemaVersion: "0.9.0", forening: {} },
    });
    const { id: gammalKopare } = await lager.db.skapaAnalys({
      pdfHash: "x",
      pdfPath: null,
      propertyInput: propertyInput as never,
      model: MODEL,
      promptVersion: "5",
      status: "queued",
      stage: "uploaded",
      rapportId: trasig,
    });

    const { rad } = await laddaUpp(lager, pdf);

    expect(await lager.db.hamtaRapport(trasig)).toMatchObject({
      status: "failed",
      errorCode: "ogiltigforklarad",
    });
    const omkorning = lager.db._allaRapporter().filter((r) => r.id !== trasig);
    expect(omkorning).toHaveLength(1);
    expect(omkorning[0]).toMatchObject({
      orgnr: ORGNR,
      rakenskapsar: AR,
      pipelineVersion: PIPELINE_VERSION,
      stage: "grundning",
      status: "queued",
    });
    expect(rad.rapportId).toBe(omkorning[0]?.id);
    // The buyer linked to the broken one follows the re-run, and is never served.
    expect(await hamtaStatus(lager, gammalKopare)).toMatchObject({
      status: "queued",
      rapportSteg: "grundning",
    });
    await expect(hamtaResultat(lager, gammalKopare)).rejects.toThrow(AnalysInteKlarError);
  });

  it("M1: samma pipeline_version men oläsbart resultat (läsväg): omkörning köas, ingen dödläge", async () => {
    const lager = skapaFakeLager();
    const trasig = await seedaKlarRapport(lager, {
      pdfHash: "trasig",
      judgement: { betyg: "Z" },
    });
    const { id } = await lager.db.skapaAnalys({
      pdfHash: "trasig",
      pdfPath: null,
      propertyInput: propertyInput as never,
      model: MODEL,
      promptVersion: "5",
      status: "queued",
      stage: "uploaded",
      rapportId: trasig,
    });
    await expect(hamtaResultat(lager, id)).rejects.toThrow(AnalysInteKlarError);
    const levande = lager.db
      ._allaRapporter()
      .filter((r) => r.status !== "failed" && r.pipelineVersion === PIPELINE_VERSION);
    expect(levande).toHaveLength(1);
    expect(levande[0]?.id).not.toBe(trasig);

    const client = fakeClient();
    koaPipelineSvar(client);
    await korTillsTomt(lager, { client });
    expect(AnalysisResultSchema.safeParse(await hamtaResultat(lager, id)).success).toBe(true);
  });

  it("M1: lokal identitet mot en oläsbar rapport på samma version ger en ny rapport med identiteten", async () => {
    const lager = skapaFakeLager();
    const trasig = await seedaKlarRapport(lager, {
      pdfHash: "trasig",
      judgement: { betyg: "Z" },
    });
    const { rad } = await laddaUpp(
      lager,
      await skapaPdf(["Annan utgava av Arsredovisning for Brf Kastanjen"]),
      lokalIdentitet(KASTANJEN),
    );
    expect(rad.rapportId).not.toBe(trasig);
    expect(await lager.db.hamtaRapport(rad.rapportId ?? "")).toMatchObject({
      orgnr: ORGNR,
      rakenskapsar: AR,
      stage: "grundning",
    });
    expect((await lager.db.hamtaRapport(trasig))?.status).toBe("failed");
  });

  it("M3: samtidiga lata omkörningar av en rapport utan identitet → en omkörning, en pipelinekörning", async () => {
    const bas = skapaFakeLager();
    const gammal = await seedaKlarRapport(bas, {
      pdfHash: "utan-identitet",
      identitet: null,
      pipelineVersion: "p4.i1.s1",
    });
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const { id } = await bas.db.skapaAnalys({
        pdfHash: "utan-identitet",
        pdfPath: null,
        propertyInput: propertyInput as never,
        model: MODEL,
        promptVersion: "4",
        status: "queued",
        stage: "uploaded",
        rapportId: gammal,
      });
      ids.push(id);
    }
    const lager: FakeLager = { ...bas, db: medBarriar(bas.db, "skapaRapport") as FakeLager["db"] };

    const svar = await Promise.all(ids.map((id) => hamtaResultat(lager, id)));
    for (const r of svar) {
      expect(r.datakvalitet.extraktionKonfidens.skal).toContain(ALDRE_VERSION_SKAL);
    }
    const omkorningar = bas.db
      ._allaRapporter()
      .filter((r) => r.pipelineVersion === PIPELINE_VERSION);
    expect(omkorningar).toHaveLength(1);

    const client = fakeClient();
    koaPipelineSvar(client);
    const identifiera = fakeIdentifierare(null);
    await korTillsTomt(bas, { client, identifieraMedModell: identifiera });
    expect(identifiera).toHaveBeenCalledTimes(1);
    expect(client.messages.create).toHaveBeenCalledTimes(3);
  });

  it("M4b: ingen omedelbar återanvändning när föreningens namn är okänt i registret", async () => {
    const lager = skapaFakeLager();
    const befintlig = await seedaKlarRapport(lager, {
      pdfHash: "annan-utgava",
      identitet: { ...KASTANJEN, namn: null },
    });
    const { resultat, rad } = await laddaUpp(
      lager,
      await skapaPdf(["Ny utgava"]),
      lokalIdentitet(KASTANJEN),
    );
    expect(resultat).not.toHaveProperty("ateranvand");
    expect(rad.rapportId).not.toBe(befintlig);
    expect(await lager.db.hamtaRapport(rad.rapportId ?? "")).toMatchObject({
      orgnr: null,
      stage: "identifiering",
    });
  });

  it("M4b: ingen omedelbar återanvändning när PDF:ens namn inte gick att läsa", async () => {
    const lager = skapaFakeLager();
    const befintlig = await seedaKlarRapport(lager, { pdfHash: "annan-utgava" });
    const { rad } = await laddaUpp(
      lager,
      await skapaPdf(["Ny utgava"]),
      lokalIdentitet({ ...KASTANJEN, namn: null }),
    );
    expect(rad.rapportId).not.toBe(befintlig);
    expect(await lager.db.hamtaRapport(rad.rapportId ?? "")).toMatchObject({
      orgnr: null,
      stage: "identifiering",
    });
  });

  it("M4b: utan träff i registret tas den lokala identiteten även när ett namn saknas", async () => {
    const lager = skapaFakeLager();
    const { rad } = await laddaUpp(
      lager,
      await standardPdf(),
      lokalIdentitet({ ...KASTANJEN, namn: null }),
    );
    expect(await lager.db.hamtaRapport(rad.rapportId ?? "")).toMatchObject({
      orgnr: ORGNR,
      stage: "grundning",
    });
  });
});

describe("korNastaSteg — registrets kö", () => {
  it("full livscykel identifiering → grundning → extraktion → bedomning → klar, kostnad och cache-tokens summerade", async () => {
    const lager = skapaFakeLager();
    const { rad } = await laddaUpp(lager, await standardPdf());
    const client = fakeClient();
    koaPipelineSvar(client);
    const identifiera = fakeIdentifierare(KASTANJEN);
    const reinvoke = vi.fn();
    const options = { client, identifieraMedModell: identifiera, reinvoke };
    const env = buildEnv();

    const steg: Array<string | undefined> = [];
    for (let i = 0; i < 4; i++) {
      const r = await korNastaSteg(lager, env, options);
      steg.push(r.rapportSteg);
      if (i < 3) {
        const status = await hamtaStatus(lager, rad.id);
        expect(status?.status).toBe("queued");
      }
    }
    expect(steg).toEqual(["identifiering", "grundning", "extraktion", "bedomning"]);
    expect(reinvoke).toHaveBeenCalledTimes(3);

    const rapport = await lager.db.hamtaRapport(rad.rapportId ?? "");
    expect(rapport).toMatchObject({
      status: "done",
      stage: "klar",
      orgnr: ORGNR,
      rakenskapsar: AR,
      grundtext: null,
      attempts: 0,
      errorCode: null,
      cacheReadTokens: 120,
      cacheWriteTokens: 30,
    });
    expect(rapport?.costSek).toBeGreaterThan(0.05);
    expect(rapport?.finishedAt).toBeTruthy();
    expect(await korNastaSteg(lager, env, options)).toEqual({ claimed: false });

    expect(await hamtaStatus(lager, rad.id)).toMatchObject({
      status: "done",
      stage: "complete",
      rapportSteg: "klar",
      ateranvand: false,
    });
    const fullt = await hamtaResultat(lager, rad.id);
    expect(AnalysisResultSchema.safeParse(fullt).success).toBe(true);
    expect(fullt.betyg).toBe("C");
  });

  it("identifiering med träff i registret: rapporten ersätts, analys-rader och filer pekas om", async () => {
    const lager = skapaFakeLager();
    const befintlig = await seedaKlarRapport(lager, { pdfHash: "forsta-utgavan" });
    const { rad } = await laddaUpp(lager, await skapaPdf(["Skannad utgava utan lokal identitet"]));
    const egen = rad.rapportId ?? "";
    expect(egen).not.toBe(befintlig);

    const client = fakeClient();
    const r = await korNastaSteg(lager, buildEnv(), {
      client,
      identifieraMedModell: fakeIdentifierare(KASTANJEN),
    });
    expect(r).toEqual({ claimed: true, rapportId: egen, rapportSteg: "identifiering" });
    expect(client.messages.create).not.toHaveBeenCalled();

    expect(await lager.db.hamtaRapport(egen)).toMatchObject({
      status: "ersatt",
      ersattAv: befintlig,
      leaseUntil: null,
    });
    expect((await lager.db.hamtaAnalys(rad.id))?.rapportId).toBe(befintlig);
    expect(lager.db._allaRapportFiler().every((f) => f.rapportId === befintlig)).toBe(true);
    expect(await hamtaStatus(lager, rad.id)).toMatchObject({ status: "done" });
    expect(await korNastaSteg(lager, buildEnv(), { client })).toEqual({ claimed: false });
  });

  it("M5: ett transient identitetsfel (nätverk/API) prövas om; efter tre försök fortsätter rapporten utan identitet", async () => {
    const lager = skapaFakeLager();
    const { rad } = await laddaUpp(lager, await standardPdf());
    const id = rad.rapportId ?? "";
    const identifiera = vi.fn<typeof identifieraMedModell>(async () => {
      throw new APIConnectionError({ message: "Connection error." });
    });
    const tyst = [
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ];

    await korNastaSteg(lager, buildEnv(), { identifieraMedModell: identifiera });
    expect(await lager.db.hamtaRapport(id)).toMatchObject({
      stage: "identifiering",
      status: "queued",
      attempts: 1,
      orgnr: null,
    });
    await korNastaSteg(lager, buildEnv(), { identifieraMedModell: identifiera });
    expect(await lager.db.hamtaRapport(id)).toMatchObject({ stage: "identifiering", attempts: 2 });
    await korNastaSteg(lager, buildEnv(), { identifieraMedModell: identifiera });
    tyst.forEach((s) => s.mockRestore());

    expect(identifiera).toHaveBeenCalledTimes(3);
    expect(await lager.db.hamtaRapport(id)).toMatchObject({
      stage: "grundning",
      status: "queued",
      attempts: 0,
      orgnr: null,
      errorCode: null,
    });
  });

  it("M5: en 5xx-/529-status räknas också som transient", async () => {
    const lager = skapaFakeLager();
    const { rad } = await laddaUpp(lager, await standardPdf());
    const identifiera = vi.fn<typeof identifieraMedModell>(async () => {
      throw new InternalServerError(529, { type: "overloaded_error" }, "Overloaded", new Headers());
    });
    const tyst = vi.spyOn(console, "warn").mockImplementation(() => {});
    await korNastaSteg(lager, buildEnv(), { identifieraMedModell: identifiera });
    tyst.mockRestore();
    expect(await lager.db.hamtaRapport(rad.rapportId ?? "")).toMatchObject({
      stage: "identifiering",
      attempts: 1,
    });
  });

  it("M5: ett deterministiskt utfall (ogiltigt svar) prövas inte om — rapporten fortsätter direkt utan identitet", async () => {
    const lager = skapaFakeLager();
    const { rad } = await laddaUpp(lager, await standardPdf());
    const identifiera = vi.fn<typeof identifieraMedModell>(async () => {
      throw new ModelValidationError("Identiteten", new z.ZodError([]), {}, 1);
    });
    const tyst = vi.spyOn(console, "warn").mockImplementation(() => {});
    await korNastaSteg(lager, buildEnv(), { identifieraMedModell: identifiera });
    tyst.mockRestore();

    expect(identifiera).toHaveBeenCalledTimes(1);
    expect(await lager.db.hamtaRapport(rad.rapportId ?? "")).toMatchObject({
      stage: "grundning",
      status: "queued",
      orgnr: null,
      errorCode: null,
    });
  });

  it("en rapport utan identitet får den från sin egen extraktion", async () => {
    const lager = skapaFakeLager();
    const { rad } = await laddaUpp(lager, await standardPdf());
    const client = fakeClient();
    koaPipelineSvar(client);
    await korTillsTomt(lager, { client, identifieraMedModell: fakeIdentifierare(null) });

    expect(await lager.db.hamtaRapport(rad.rapportId ?? "")).toMatchObject({
      status: "done",
      orgnr: ORGNR,
      rakenskapsar: AR,
    });
  });

  it("M4a: en extraherad orgnr som inte klarar Luhn blir aldrig rapportens identitet", async () => {
    const lager = skapaFakeLager();
    const { rad } = await laddaUpp(lager, await standardPdf());
    const client = fakeClient();
    koaPipelineSvar(client, extraktion); // the fixture's 769612-3456 fails Luhn
    await korTillsTomt(lager, { client, identifieraMedModell: fakeIdentifierare(null) });

    expect(await lager.db.hamtaRapport(rad.rapportId ?? "")).toMatchObject({
      status: "done",
      orgnr: null,
      rakenskapsar: null,
    });
  });

  it("M4a: en modellidentitet som inte klarar Luhn används inte", async () => {
    const lager = skapaFakeLager();
    const { rad } = await laddaUpp(lager, await standardPdf());
    await korNastaSteg(lager, buildEnv(), {
      identifieraMedModell: fakeIdentifierare({ ...KASTANJEN, orgnr: "769612-3456" }),
    });
    expect(await lager.db.hamtaRapport(rad.rapportId ?? "")).toMatchObject({
      stage: "grundning",
      orgnr: null,
    });
  });

  it("M4b: identifiering med träff men okänt namn på ena sidan slår inte ihop — rapporten behålls utan identitet", async () => {
    const lager = skapaFakeLager();
    const befintlig = await seedaKlarRapport(lager, {
      pdfHash: "forsta-utgavan",
      identitet: { ...KASTANJEN, namn: null },
    });
    const { rad } = await laddaUpp(
      lager,
      await skapaPdf(["Annan utgava av Arsredovisning for Brf Kastanjen"]),
    );
    await korNastaSteg(lager, buildEnv(), { identifieraMedModell: fakeIdentifierare(KASTANJEN) });

    const egen = await lager.db.hamtaRapport(rad.rapportId ?? "");
    expect(egen?.id).not.toBe(befintlig);
    expect(egen).toMatchObject({ status: "queued", stage: "grundning", orgnr: null });
  });

  it("M4b: identifiering med okänt namn men ledig plats tar identiteten", async () => {
    const lager = skapaFakeLager();
    const { rad } = await laddaUpp(lager, await standardPdf());
    await korNastaSteg(lager, buildEnv(), {
      identifieraMedModell: fakeIdentifierare({ ...KASTANJEN, namn: null }),
    });
    expect(await lager.db.hamtaRapport(rad.rapportId ?? "")).toMatchObject({
      stage: "grundning",
      orgnr: ORGNR,
      rakenskapsar: AR,
    });
  });

  it("L6: ett sammanställningsfel för en köpares input fäller inte den delade rapporten", async () => {
    const lager = skapaFakeLager();
    const { rad } = await laddaUpp(lager, await standardPdf(), lokalIdentitet(KASTANJEN));
    const client = fakeClient();
    koaPipelineSvar(client);
    const montera = vi.fn(async () => {
      throw new AssemblyValidationError(new z.ZodError([]), {});
    });
    const tyst = vi.spyOn(console, "error").mockImplementation(() => {});
    await korTillsTomt(lager, { client, monteraAnalys: montera as never });
    tyst.mockRestore();

    expect(montera).toHaveBeenCalledTimes(1);
    const rapport = await lager.db.hamtaRapport(rad.rapportId ?? "");
    expect(rapport).toMatchObject({ status: "done", stage: "klar", errorCode: null });
    expect(rapport?.judgement).toBeTruthy();
    expect(client.messages.create).toHaveBeenCalledTimes(3);
  });

  it("L7: ett steg skriver aldrig över en rad som ogiltigförklarats medan den kördes", async () => {
    const lager = skapaFakeLager();
    const { rad } = await laddaUpp(lager, await standardPdf());
    const id = rad.rapportId ?? "";
    const reinvoke = vi.fn();
    const identifiera = vi.fn<typeof identifieraMedModell>(async () => {
      await lager.db.uppdateraRapport(id, {
        status: "failed",
        errorCode: "ogiltigforklarad",
        leaseUntil: null,
      });
      return { identitet: KASTANJEN, spentSek: 0.05, calls: [] };
    });
    const tyst = vi.spyOn(console, "warn").mockImplementation(() => {});
    await korNastaSteg(lager, buildEnv(), { identifieraMedModell: identifiera, reinvoke });
    tyst.mockRestore();

    expect(await lager.db.hamtaRapport(id)).toMatchObject({
      status: "failed",
      errorCode: "ogiltigforklarad",
      stage: "identifiering",
      orgnr: null,
    });
    expect(reinvoke).not.toHaveBeenCalled();
  });

  it("L7: ett fel i ett steg skriver inte över en rad som någon annan tagit över", async () => {
    const lager = skapaFakeLager();
    const { rad } = await laddaUpp(lager, await standardPdf(), lokalIdentitet(KASTANJEN));
    const id = rad.rapportId ?? "";
    const client = fakeClient();
    client.messages.create.mockImplementationOnce(async () => {
      await lager.db.uppdateraRapport(id, { status: "done", stage: "klar" });
      throw new Error("sent fel");
    });
    await korNastaSteg(lager, buildEnv(), { client });
    expect(await lager.db.hamtaRapport(id)).toMatchObject({
      status: "done",
      stage: "klar",
      errorCode: null,
    });
  });

  it("versionsvakt: en rapport på en annan pipeline_version misslyckas direkt, utan modellanrop", async () => {
    const lager = skapaFakeLager();
    const id = await seedaKlarRapport(lager, {
      pdfHash: "gammal",
      pipelineVersion: "p4.i1.s1",
      status: "queued",
      stage: "grundning",
      extraction: null,
      judgement: null,
    });
    const client = fakeClient();
    const fel = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await korNastaSteg(lager, buildEnv(), { client });
    fel.mockRestore();

    expect(r).toEqual({ claimed: true, rapportId: id, rapportSteg: "grundning" });
    expect(client.messages.countTokens).not.toHaveBeenCalled();
    expect(await lager.db.hamtaRapport(id)).toMatchObject({
      status: "failed",
      errorCode: "versionskonflikt",
    });
    // The failed row freed the identity slot for the current version.
    expect(
      (
        await lager.db.skapaRapport({
          orgnr: ORGNR,
          rakenskapsar: AR,
          pipelineVersion: "p4.i1.s1",
          model: MODEL,
          textlager: "ok",
          status: "queued",
          stage: "grundning",
          pdfHash: "gammal",
        })
      ).ok,
    ).toBe(true);
  });

  it("ett nekat spend-tak släpper rapporten utan att förbruka ett försök eller skriva fel", async () => {
    const lager = skapaFakeLager();
    const { rad } = await laddaUpp(lager, await standardPdf(), lokalIdentitet(KASTANJEN));
    const client = fakeClient();
    await korNastaSteg(lager, buildEnv({ maxDailySpendSek: 0.01 }), { client });
    expect(client.messages.create).not.toHaveBeenCalled();
    expect(await lager.db.hamtaRapport(rad.rapportId ?? "")).toMatchObject({
      status: "queued",
      stage: "grundning",
      attempts: 0,
      errorCode: null,
      leaseUntil: null,
    });
  });

  it("tre misslyckade försök i ett steg: permanent failed, kostnaden bokförd, köparen ser felet", async () => {
    const lager = skapaFakeLager();
    const { rad } = await laddaUpp(lager, await standardPdf(), lokalIdentitet(KASTANJEN));
    const id = rad.rapportId ?? "";
    await lager.db.uppdateraRapport(id, { stage: "extraktion", grundtext: "Grundtext." });
    const client = fakeClient();
    const ogiltigt = {
      usage: { input_tokens: 10, output_tokens: 10 },
      content: [{ type: "text", text: '{"inte":"en extraktion"}' }],
    };
    client.messages.create.mockResolvedValue(ogiltigt);

    for (let i = 0; i < 3; i++) await korNastaSteg(lager, buildEnv(), { client });

    const rapport = await lager.db.hamtaRapport(id);
    expect(rapport).toMatchObject({
      status: "failed",
      errorCode: "validation",
      stage: "extraktion",
    });
    expect(rapport?.finishedAt).toBeTruthy();
    expect(rapport?.costSek).toBeGreaterThan(0);
    expect(await korNastaSteg(lager, buildEnv(), { client })).toEqual({ claimed: false });
    expect(await hamtaStatus(lager, rad.id)).toMatchObject({
      status: "failed",
      stage: "extracting",
      errorCode: "validation",
    });
  });

  it("krock på identitetsindexet i identifieringen behandlas som en träff", async () => {
    const bas = skapaFakeLager();
    const a = await laddaUpp(bas, await skapaPdf(["Utgava A"]));
    const b = await laddaUpp(bas, await skapaPdf(["Utgava B"]));
    const options = { identifieraMedModell: fakeIdentifierare(KASTANJEN) };

    await korNastaSteg(bas, buildEnv(), options); // A tar identiteten
    // Håll A borta från kön så att nästa tick når B.
    await bas.db.uppdateraRapport(a.rad.rapportId ?? "", {
      leaseUntil: new Date(Date.now() + 60_000).toISOString(),
    });
    // B:s första registeruppslag är inaktuellt (läst innan A satte sin
    // identitet) — identitetsuppdateringen krockar då på indexet.
    let forstaUppslaget = true;
    const lager: FakeLager = {
      ...bas,
      db: new Proxy(bas.db, {
        get(target, prop, mottagare) {
          const varde: unknown = Reflect.get(target, prop, mottagare);
          if (prop === "listaRapporter" && forstaUppslaget) {
            forstaUppslaget = false;
            return async () => [];
          }
          return varde;
        },
      }),
    };
    await korNastaSteg(lager, buildEnv(), options);

    expect(await bas.db.hamtaRapport(b.rad.rapportId ?? "")).toMatchObject({
      status: "ersatt",
      ersattAv: a.rad.rapportId,
    });
    expect((await bas.db.hamtaAnalys(b.rad.id))?.rapportId).toBe(a.rad.rapportId);
  });

  it("den gamla kön dräneras när ingen rapport finns att klaima, och rapporter går först", async () => {
    const lager = skapaFakeLager();
    const { id: legacyId } = await lager.db.skapaAnalys({
      pdfHash: "legacy",
      pdfPath: null,
      propertyInput: propertyInput as never,
      model: MODEL,
      promptVersion: "gammal-version",
      status: "queued",
      stage: "uploaded",
    });
    const rapportId = await seedaKlarRapport(lager, {
      pdfHash: "ny",
      identitet: null,
      status: "queued",
      stage: "identifiering",
      extraction: null,
      judgement: null,
    });

    expect(
      (
        await korNastaSteg(lager, buildEnv(), {
          identifieraMedModell: fakeIdentifierare(null),
        })
      ).rapportId,
    ).toBe(rapportId);
    await lager.db.uppdateraRapport(rapportId, { status: "failed" });
    const fel = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await korNastaSteg(lager, buildEnv())).toEqual({
      claimed: true,
      analysisId: legacyId,
      stage: "uploaded",
    });
    fel.mockRestore();
  });
});

describe("läsvägen — versioner och omkörningar", () => {
  it("lat omkörning: en äldre kompatibel version serveras med not, en omkörning köas en gång", async () => {
    const lager = skapaFakeLager();
    const pdf = await standardPdf();
    const pdfHash = await sha256Hex(pdf);
    const gammal = await seedaKlarRapport(lager, { pdfHash, pipelineVersion: "p4.i1.s1" });

    const { resultat, rad } = await laddaUpp(lager, pdf);
    expect(resultat).toMatchObject({ ateranvand: true });
    expect(rad.rapportId).toBe(gammal);

    const forsta = await hamtaResultat(lager, rad.id);
    expect(forsta.datakvalitet.extraktionKonfidens.skal).toContain(ALDRE_VERSION_SKAL);
    await hamtaResultat(lager, rad.id);
    await hamtaStatus(lager, rad.id);

    const omkorningar = lager.db
      ._allaRapporter()
      .filter((r) => r.pipelineVersion === PIPELINE_VERSION);
    expect(omkorningar).toHaveLength(1);
    expect(omkorningar[0]).toMatchObject({
      orgnr: ORGNR,
      rakenskapsar: AR,
      stage: "grundning",
      status: "queued",
      pdfHash,
    });

    const client = fakeClient();
    koaPipelineSvar(client);
    await korTillsTomt(lager, { client });
    expect(client.messages.create).toHaveBeenCalledTimes(3);

    const efter = await hamtaResultat(lager, rad.id);
    expect(efter.datakvalitet.extraktionKonfidens.skal ?? []).not.toContain(ALDRE_VERSION_SKAL);
  });

  it("ett inkompatibelt lagrat resultat serveras aldrig: omkörning köas, köparen väntar", async () => {
    const lager = skapaFakeLager();
    const pdf = await standardPdf();
    const gammal = await seedaKlarRapport(lager, {
      pdfHash: await sha256Hex(pdf),
      pipelineVersion: "p4.i1.s0",
      extraction: { schemaVersion: "0.9.0", forening: {} },
    });
    const { rad } = await lager.db
      .skapaAnalys({
        pdfHash: "x",
        pdfPath: null,
        propertyInput: propertyInput as never,
        model: MODEL,
        promptVersion: "4",
        status: "queued",
        stage: "uploaded",
        rapportId: gammal,
      })
      .then(async ({ id }) => ({ rad: await lager.db.hamtaAnalys(id) }));
    const id = rad?.id ?? "";

    await expect(hamtaResultat(lager, id)).rejects.toThrow(AnalysInteKlarError);
    const omkorningar = lager.db._allaRapporter().filter((r) => r.id !== gammal);
    expect(omkorningar).toHaveLength(1);
    expect(await hamtaStatus(lager, id)).toMatchObject({
      status: "queued",
      stage: "uploaded",
      rapportSteg: "grundning",
    });

    // A new upload of the same bytes must not serve it either.
    const ny = await laddaUpp(lager, pdf);
    expect(ny.resultat).toMatchObject({ vantarPaRapport: true });
  });

  it("inkompatibelt och PDF:en borta: ett synligt fel, aldrig en evig väntan", async () => {
    const lager = skapaFakeLager();
    const gammal = await seedaKlarRapport(lager, {
      pdfHash: "raderad",
      pipelineVersion: "p4.i1.s0",
      judgement: { betyg: "Z" },
      laggUppPdf: false,
    });
    const { id } = await lager.db.skapaAnalys({
      pdfHash: "raderad",
      pdfPath: null,
      propertyInput: propertyInput as never,
      model: MODEL,
      promptVersion: "4",
      status: "queued",
      stage: "uploaded",
      rapportId: gammal,
    });
    expect(await hamtaStatus(lager, id)).toMatchObject({
      status: "failed",
      errorCode: "versionskonflikt",
    });
    expect(lager.db._allaRapporter()).toHaveLength(1);
  });

  it("en nyare analyserad årsredovisning för samma förening noteras", async () => {
    const lager = skapaFakeLager();
    const pdf = await standardPdf();
    await seedaKlarRapport(lager, { pdfHash: await sha256Hex(pdf) });
    await seedaKlarRapport(lager, {
      pdfHash: "nasta-ar",
      identitet: { ...KASTANJEN, rakenskapsar: AR + 1 },
    });
    const { rad } = await laddaUpp(lager, pdf);
    const resultat = await hamtaResultat(lager, rad.id);
    expect(resultat.datakvalitet.extraktionKonfidens.skal).toContain(nyareArSkal(AR + 1));
  });

  it("hamtaStatus: en ogiltigförklarad rapport visas som versionskonflikt med eget meddelande", async () => {
    const lager = skapaFakeLager();
    const pdf = await standardPdf();
    const { rad } = await laddaUpp(lager, pdf);
    await lager.db.uppdateraRapport(rad.rapportId ?? "", {
      status: "failed",
      errorCode: "ogiltigforklarad",
      errorMessage: null,
    });
    const status = await hamtaStatus(lager, rad.id);
    expect(status).toMatchObject({ status: "failed", errorCode: "versionskonflikt" });
    expect(status?.errorMessage).toMatch(/dragits tillbaka/);
  });

  it("hamtaStatus: en ogiltigförklarad rapport som laddats upp igen visar den nya körningens förlopp", async () => {
    const lager = skapaFakeLager();
    const pdf = await standardPdf();
    const forsta = await laddaUpp(lager, pdf, lokalIdentitet(KASTANJEN));
    await lager.db.uppdateraRapport(forsta.rad.rapportId ?? "", {
      status: "failed",
      errorCode: "ogiltigforklarad",
    });
    const andra = await laddaUpp(lager, pdf, lokalIdentitet(KASTANJEN));
    expect(andra.rad.rapportId).not.toBe(forsta.rad.rapportId);
    expect(await hamtaStatus(lager, forsta.rad.id)).toMatchObject({
      status: "queued",
      rapportSteg: "grundning",
    });
  });

  it("hamtaStatus följer rapportens steg genom pipelinen", async () => {
    const lager = skapaFakeLager();
    const { rad } = await laddaUpp(lager, await standardPdf(), lokalIdentitet(KASTANJEN));
    const client = fakeClient();
    koaPipelineSvar(client);

    const sett: Array<[string | undefined, string | undefined]> = [];
    for (let i = 0; i < 3; i++) {
      const s = await hamtaStatus(lager, rad.id);
      sett.push([s?.stage, s?.rapportSteg]);
      await korNastaSteg(lager, buildEnv(), { client });
    }
    expect(sett).toEqual([
      ["uploaded", "grundning"],
      ["extracting", "extraktion"],
      ["judging", "bedomning"],
    ]);
    expect((await hamtaStatus(lager, rad.id))?.stage).toBe("complete");
  });
});
