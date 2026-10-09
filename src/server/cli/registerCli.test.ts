import { describe, expect, it } from "vitest";
import type { AnalysJudgement } from "@/lib/analysis/analyze";
import { extraktion } from "@/lib/analysis/__fixtures__/extraktion";
import type { ExtractionResult } from "@/types/analysis";
import { PROMPT_VERSION } from "@/lib/analysis/prompts";
import { skapaFakeLager, type FakeLager } from "../__fakes__/lager";
import { sparaAnalysICache, sparaExtraktionICache } from "../cache";
import { PIPELINE_VERSION } from "../register";
import {
  backfillLegacy,
  inspektera,
  listaRegister,
  ogiltigforklara,
  rerunTillAktuell,
  tolkaArgument,
} from "./registerCli";

const MODEL = "claude-sonnet-5";
/** Luhn-valid; the shared fixture's orgnr is not. */
const ORGNR = "769616-0253";
const AR = extraktion.forening.rakenskapsar;
const EXTRAKTION: ExtractionResult = {
  ...extraktion,
  forening: { ...extraktion.forening, orgnr: ORGNR },
};

function judgement(): AnalysJudgement {
  return { betyg: "C", betygMotivering: "Test.", rodaFlaggor: [], fragor: [] };
}

async function seeda(
  lager: FakeLager,
  opts: { pdfHash: string; pipelineVersion?: string; pdf?: boolean; ar?: number },
): Promise<string> {
  await lager.db.registreraForening(ORGNR, extraktion.forening.namn);
  const r = await lager.db.skapaRapport({
    orgnr: ORGNR,
    rakenskapsar: opts.ar ?? AR,
    pipelineVersion: opts.pipelineVersion ?? PIPELINE_VERSION,
    model: MODEL,
    textlager: "ok",
    status: "done",
    stage: "klar",
    pdfHash: opts.pdfHash,
    extraction: EXTRAKTION,
    judgement: judgement(),
  });
  if (!r.ok) throw new Error("krock");
  await lager.db.skapaRapportFil({
    pdfHash: opts.pdfHash,
    rapportId: r.id,
    pdfPath: `${opts.pdfHash}.pdf`,
    sidor: 4,
    bytes: 1000,
  });
  if (opts.pdf !== false) await lager.filer.laggUpp(`${opts.pdfHash}.pdf`, new Uint8Array([1]));
  return r.id;
}

describe("tolkaArgument", () => {
  it("tolkar alla fem kommandon", () => {
    expect(tolkaArgument(["list", "--orgnr", ORGNR, "--limit", "5"])).toEqual({
      typ: "list",
      orgnr: ORGNR,
      limit: 5,
    });
    expect(tolkaArgument(["inspect", "abc"])).toEqual({ typ: "inspect", rapportId: "abc" });
    expect(tolkaArgument(["inspect", ORGNR, "2025"])).toEqual({
      typ: "inspect",
      orgnr: ORGNR,
      rakenskapsar: 2025,
    });
    expect(tolkaArgument(["invalidate", "abc"])).toEqual({
      typ: "invalidate",
      rapportId: "abc",
      force: false,
      allaVersioner: false,
    });
    expect(tolkaArgument(["invalidate", "abc", "--force", "--all-versions"])).toEqual({
      typ: "invalidate",
      rapportId: "abc",
      force: true,
      allaVersioner: true,
    });
    expect(tolkaArgument(["backfill-legacy", "--dry-run"])).toEqual({
      typ: "backfill-legacy",
      dryRun: true,
    });
    expect(tolkaArgument(["rerun", "--to-current", "--limit", "3"])).toEqual({
      typ: "rerun",
      dryRun: false,
      limit: 3,
    });
  });

  it("avvisar okända kommandon och ofullständiga argument", () => {
    expect(() => tolkaArgument([])).toThrow();
    expect(() => tolkaArgument(["rerun"])).toThrow(/--to-current/);
    expect(() => tolkaArgument(["invalidate"])).toThrow();
    expect(() => tolkaArgument(["list", "--limit", "0"])).toThrow();
    expect(() => tolkaArgument(["inspect", "fel-orgnr", "2025"])).toThrow();
  });
});

describe("list / inspect", () => {
  it("listar nyast först med namn, version och kompatibilitet", async () => {
    const lager = skapaFakeLager();
    await seeda(lager, { pdfHash: "a", pipelineVersion: "p4.i1.s1" });
    await seeda(lager, { pdfHash: "b" });
    const lista = await listaRegister(lager, { orgnr: ORGNR });
    expect(lista.map((r) => [r.pipelineVersion, r.aktuellVersion, r.kompatibel, r.namn])).toEqual([
      [PIPELINE_VERSION, true, true, extraktion.forening.namn],
      ["p4.i1.s1", false, true, extraktion.forening.namn],
    ]);
    expect(await listaRegister(lager, { limit: 1 })).toHaveLength(1);
  });

  it("inspect markerar saknade PDF:er och räknar länkade analyser", async () => {
    const lager = skapaFakeLager();
    const id = await seeda(lager, { pdfHash: "borta", pdf: false });
    const [inspektion] = await inspektera(lager, { orgnr: ORGNR, rakenskapsar: AR });
    expect(inspektion?.rapport.id).toBe(id);
    expect(inspektion?.pdfFinns).toBe(false);
    expect(inspektion?.filer).toEqual([
      expect.objectContaining({ pdfHash: "borta", pdfFinns: false }),
    ]);
    expect(inspektion?.antalAnalyser).toBe(0);
    expect(await inspektera(lager, { rapportId: "finns-inte" })).toEqual([]);
  });
});

describe("invalidate", () => {
  it("sätter failed/ogiltigforklarad och frigör identitetsplatsen", async () => {
    const lager = skapaFakeLager();
    const id = await seeda(lager, { pdfHash: "a" });
    expect(await ogiltigforklara(lager, id)).toEqual([{ id, tidigareStatus: "done" }]);
    expect(await lager.db.hamtaRapport(id)).toMatchObject({
      status: "failed",
      errorCode: "ogiltigforklarad",
    });
    await expect(seeda(lager, { pdfHash: "ny" })).resolves.toBeTruthy();
    await expect(ogiltigforklara(lager, "finns-inte")).rejects.toThrow();
  });

  it("L7: vägrar en rapport som körs just nu utan --force", async () => {
    const lager = skapaFakeLager();
    const id = await seeda(lager, { pdfHash: "a" });
    await lager.db.uppdateraRapport(id, { status: "queued", stage: "grundning" });
    const klaimad = await lager.db.klaimaNastaRapportSteg();
    expect(klaimad?.id).toBe(id);

    await expect(ogiltigforklara(lager, id)).rejects.toThrow(/--force/);
    expect((await lager.db.hamtaRapport(id))?.status).toBe("running");

    expect(await ogiltigforklara(lager, id, { force: true })).toEqual([
      { id, tidigareStatus: "running" },
    ]);
    // The worker's leased write is now refused, so the invalidation stands.
    expect(
      await lager.db.uppdateraLeasadRapport(id, klaimad?.leaseUntil ?? null, {
        stage: "extraktion",
      }),
    ).toBe(false);
    expect(await lager.db.hamtaRapport(id)).toMatchObject({ status: "failed", stage: "grundning" });
  });

  it("L8: --all-versions ogiltigförklarar varje rapport för samma (orgnr, år)", async () => {
    const lager = skapaFakeLager();
    const gammal = await seeda(lager, { pdfHash: "a", pipelineVersion: "p4.i1.s1" });
    const ny = await seeda(lager, { pdfHash: "b" });
    const annatAr = await seeda(lager, { pdfHash: "c", ar: AR + 1 });

    const resultat = await ogiltigforklara(lager, ny, { allaVersioner: true });
    expect(resultat.map((r) => r.id).sort()).toEqual([gammal, ny].sort());
    expect((await lager.db.hamtaRapport(gammal))?.status).toBe("failed");
    expect((await lager.db.hamtaRapport(annatAr))?.status).toBe("done");
  });
});

describe("backfill-legacy", () => {
  async function legacyCache(
    lager: FakeLager,
    pdfHash: string,
    data: ExtractionResult = EXTRAKTION,
    medBedomning = true,
  ) {
    const nyckel = { pdfHash, model: MODEL, promptVersion: PROMPT_VERSION };
    await sparaExtraktionICache(lager.db, nyckel, data, 1.5);
    if (medBedomning) await sparaAnalysICache(lager.db, nyckel, judgement(), 0.5);
  }

  it("dry run skapar ingenting; skarp körning skapar förening/rapport/fil och är idempotent", async () => {
    const lager = skapaFakeLager();
    await legacyCache(lager, "h1");
    await legacyCache(lager, "h2"); // annan byteversion, samma identitet och namn
    await lager.filer.laggUpp("h1.pdf", new Uint8Array([1]));
    await legacyCache(lager, "h3", EXTRAKTION, false); // ingen bedömning

    const torr = await backfillLegacy(lager, { dryRun: true });
    expect(torr.map((r) => [r.pdfHash, r.utfall, r.medIdentitet])).toEqual([
      ["h1", "skulle_skapas", true],
      ["h2", "skulle_skapas", true],
      ["h3", "saknar_bedomning", undefined],
    ]);
    expect(lager.db._allaRapporter()).toHaveLength(0);

    const skarp = await backfillLegacy(lager, { dryRun: false });
    expect(skarp.map((r) => [r.pdfHash, r.utfall, r.pdfFinns])).toEqual([
      ["h1", "skapad", true],
      ["h2", "kopplad_till_befintlig", false],
      ["h3", "saknar_bedomning", undefined],
    ]);
    const [rapport] = lager.db._allaRapporter();
    expect(lager.db._allaRapporter()).toHaveLength(1);
    expect(rapport).toMatchObject({
      orgnr: ORGNR,
      rakenskapsar: AR,
      status: "done",
      stage: "klar",
      pipelineVersion: PIPELINE_VERSION,
      costSek: 2,
    });
    expect(lager.db._allaRapportFiler().map((f) => f.rapportId)).toEqual([
      rapport?.id,
      rapport?.id,
    ]);

    const igen = await backfillLegacy(lager, { dryRun: false });
    expect(igen.filter((r) => r.utfall === "redan_i_registret")).toHaveLength(2);
    expect(lager.db._allaRapporter()).toHaveLength(1);
  });

  it("M2: cache-rader utan (giltig) identitet blir hash-rapporter, med PDF-sökväg från analys-raderna", async () => {
    const lager = skapaFakeLager();
    await legacyCache(lager, "utan", {
      ...EXTRAKTION,
      forening: { ...EXTRAKTION.forening, orgnr: "769612-3456" }, // fails Luhn
    });
    await lager.db.skapaAnalys({
      pdfHash: "utan",
      pdfPath: "arsredovisningar/utan.pdf",
      propertyInput: {} as never,
      model: MODEL,
      promptVersion: PROMPT_VERSION,
      status: "done",
      stage: "complete",
    });
    await lager.filer.laggUpp("arsredovisningar/utan.pdf", new Uint8Array([1]));

    const torr = await backfillLegacy(lager, { dryRun: true });
    expect(torr).toEqual([
      expect.objectContaining({ utfall: "skulle_skapas", medIdentitet: false, pdfFinns: true }),
    ]);

    const skarp = await backfillLegacy(lager, { dryRun: false });
    expect(skarp).toEqual([
      expect.objectContaining({ utfall: "skapad", medIdentitet: false, pdfFinns: true }),
    ]);
    const [rapport] = lager.db._allaRapporter();
    expect(rapport).toMatchObject({
      orgnr: null,
      rakenskapsar: null,
      status: "done",
      pdfHash: "utan",
    });
    expect(await lager.db.hamtaRapportFil("utan")).toMatchObject({
      rapportId: rapport?.id,
      pdfPath: "arsredovisningar/utan.pdf",
    });
    expect(await backfillLegacy(lager, { dryRun: false })).toEqual([
      expect.objectContaining({ utfall: "redan_i_registret" }),
    ]);
  });

  it("M4c: en annan byteversion kopplas bara till en befintlig rapport när båda namnen är kända och lika", async () => {
    const lager = skapaFakeLager();
    await legacyCache(lager, "forsta");
    await legacyCache(lager, "annat-namn", {
      ...EXTRAKTION,
      forening: { ...EXTRAKTION.forening, namn: "Brf Helt Annan Förening" },
    });
    await legacyCache(lager, "inget-namn", {
      ...EXTRAKTION,
      forening: { ...EXTRAKTION.forening, namn: "" },
    });

    const skarp = await backfillLegacy(lager, { dryRun: false });
    expect(skarp.map((r) => [r.pdfHash, r.utfall, r.medIdentitet])).toEqual([
      ["forsta", "skapad", true],
      ["annat-namn", "skapad", false],
      ["inget-namn", "skapad", false],
    ]);
    expect((await lager.db.hamtaForening(ORGNR))?.namn).toBe(EXTRAKTION.forening.namn);
    expect(lager.db._allaRapporter()).toHaveLength(3);
  });
});

describe("rerun --to-current", () => {
  it("köar en omkörning per gammal rapport (en gång), hoppar över saknade PDF:er och respekterar limit", async () => {
    const lager = skapaFakeLager();
    await seeda(lager, { pdfHash: "gammal-1", pipelineVersion: "p4.i1.s1", ar: 2023 });
    await seeda(lager, { pdfHash: "gammal-2", pipelineVersion: "p4.i1.s1", ar: 2024 });
    await seeda(lager, { pdfHash: "gammal-3", pipelineVersion: "p4.i1.s1", ar: 2022, pdf: false });
    await seeda(lager, { pdfHash: "aktuell", ar: 2025 });

    const torr = await rerunTillAktuell(lager, { dryRun: true, model: MODEL });
    expect(torr.map((r) => r.utfall).sort()).toEqual(["pdf_saknas", "skulle_koas", "skulle_koas"]);
    expect(lager.db._allaRapporter()).toHaveLength(4);

    const forsta = await rerunTillAktuell(lager, { dryRun: false, limit: 1, model: MODEL });
    expect(forsta.filter((r) => r.utfall === "koad")).toHaveLength(1);
    const andra = await rerunTillAktuell(lager, { dryRun: false, model: MODEL });
    expect(andra.map((r) => r.utfall).sort()).toEqual(["finns", "koad", "pdf_saknas"]);

    const koade = lager.db
      ._allaRapporter()
      .filter((r) => r.pipelineVersion === PIPELINE_VERSION && r.status === "queued");
    expect(koade).toHaveLength(2);
    expect(koade.every((r) => r.stage === "grundning")).toBe(true);
  });
});
