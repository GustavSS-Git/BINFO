import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { AnalysJudgement } from "@/lib/analysis/analyze";
import { PROMPT_VERSION } from "@/lib/analysis/prompts";
import type { AnthropicClientLike } from "@/lib/analysis/runExtraction";
import type { LaneUnderlag } from "@/lib/analysis/calc/manadskostnad";
import type { ExtractionResult, PropertyInput } from "@/types/analysis";
import { extraktion } from "@/lib/analysis/__fixtures__/extraktion";
import { skapaFakeLager } from "./__fakes__/lager";
import { sparaAnalysICache, sparaExtraktionICache, type CacheNyckel } from "./cache";
import type { Env } from "./env";
import type { AnalysStage, AnalysStatus, Lager } from "./portar";
import { korNastaSteg } from "./steg";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Real PDF fixtures shared with runExtraction.test.ts — grounding calls the
 *  real extractPdfText step 0 before any mock is consulted, so a byte
 *  sequence that merely "looks like a PDF" is not enough. */
async function medTextPdf(): Promise<Uint8Array> {
  const buf = await readFile(path.join(here, "..", "lib/analysis/__fixtures__", "med-text.pdf"));
  return new Uint8Array(buf);
}

async function propertyInputExample(): Promise<{ input: PropertyInput; lan: LaneUnderlag }> {
  const raw = await readFile(
    path.join(here, "..", "..", "fixtures", "property-input-example.json"),
    "utf-8",
  );
  return JSON.parse(raw) as { input: PropertyInput; lan: LaneUnderlag };
}

const MODEL = "claude-sonnet-5";

let nastaHash = 1;

interface SkapaRadOptions {
  stage?: AnalysStage;
  status?: AnalysStatus;
}

/** Inserts a realistic job row (real PropertyInput/LaneUnderlag from the
 *  fixture, a real PDF uploaded to the fake Filarkiv) and returns the id
 *  plus the cache key every step keys its reads/writes on. */
async function skapaRad(
  lager: Lager,
  options: SkapaRadOptions = {},
): Promise<{ id: string; pdfPath: string; nyckel: CacheNyckel }> {
  const { input, lan } = await propertyInputExample();
  const pdfHash = `hash-${nastaHash++}`;
  const pdfPath = `arsredovisningar/${pdfHash}.pdf`;
  await lager.filer.laggUpp(pdfPath, await medTextPdf());

  const { id } = await lager.db.skapaAnalys({
    pdfHash,
    pdfPath,
    propertyInput: input,
    lanUnderlag: lan,
    model: MODEL,
    promptVersion: PROMPT_VERSION,
    status: options.status ?? "queued",
    stage: options.stage ?? "uploaded",
  });

  return { id, pdfPath, nyckel: { pdfHash, model: MODEL, promptVersion: PROMPT_VERSION } };
}

function miljo(overrides: Partial<Env> = {}): Env {
  return {
    supabaseUrl: "https://example.supabase.co",
    supabaseSecretKey: "sb_secret_test",
    maxDailySpendSek: 100,
    killSwitchPa: false,
    anthropicApiKey: "sk-ant-test",
    anthropicModel: MODEL,
    maxCostPerAnalysisSek: 5,
    ...overrides,
  };
}

type CountTokens = AnthropicClientLike["messages"]["countTokens"];
type Create = AnthropicClientLike["messages"]["create"];

function fakeClient(): AnthropicClientLike & {
  messages: {
    countTokens: ReturnType<typeof vi.fn<CountTokens>>;
    create: ReturnType<typeof vi.fn<Create>>;
  };
} {
  return {
    messages: {
      countTokens: vi.fn<CountTokens>(),
      create: vi.fn<Create>(),
    },
  };
}

/** A minimally valid citation-bearing grounding response (see
 *  runExtraction.test.ts's groundingApiResponse). */
function groundingResponse() {
  return {
    usage: { input_tokens: 500, output_tokens: 200 },
    content: [
      {
        type: "text",
        text: "Föreningen heter Brf Kastanjen.",
        citations: [{ type: "page_location", cited_text: "Brf Kastanjen", start_page_number: 3 }],
      },
    ],
  };
}

function extractionResponse(data: ExtractionResult = extraktion) {
  return {
    usage: { input_tokens: 300, output_tokens: 100 },
    content: [{ type: "text", text: JSON.stringify(data) }],
  };
}

function minimalJudgement(): AnalysJudgement {
  return {
    betyg: "B",
    betygMotivering: "Rimligt stabil förening med enstaka svagheter i skuldsättningen.",
    rodaFlaggor: [],
    fragor: [],
  };
}

function judgementResponse(data: AnalysJudgement = minimalJudgement()) {
  return {
    usage: { input_tokens: 200, output_tokens: 80 },
    content: [{ type: "text", text: JSON.stringify(data) }],
  };
}

describe("korNastaSteg", () => {
  it("returnerar { claimed: false } utan att kasta när inget jobb är klaimbart", async () => {
    const lager = skapaFakeLager();
    const resultat = await korNastaSteg(lager, miljo());
    expect(resultat).toEqual({ claimed: false });
  });

  it("kör hela state machine ett steg per anrop: uploaded -> extracting -> judging -> complete, exakt tre modellanrop totalt", async () => {
    const lager = skapaFakeLager();
    const { id } = await skapaRad(lager);
    const client = fakeClient();
    const env = miljo();

    // Steg 1 — grundning.
    client.messages.countTokens.mockResolvedValueOnce({ input_tokens: 500 });
    client.messages.create.mockResolvedValueOnce(groundingResponse());
    const efterSteg1 = await korNastaSteg(lager, env, { client });
    expect(efterSteg1).toEqual({ claimed: true, analysisId: id, stage: "uploaded" });

    let rad = await lager.db.hamtaAnalys(id);
    expect(rad?.stage).toBe("extracting");
    expect(rad?.grundtext).toBeTruthy();
    expect(rad?.costSek).toBeGreaterThan(0);
    expect(client.messages.create).toHaveBeenCalledTimes(1);

    // Steg 2 — strukturerad extraktion.
    client.messages.countTokens.mockResolvedValueOnce({ input_tokens: 300 });
    client.messages.create.mockResolvedValueOnce(extractionResponse());
    const efterSteg2 = await korNastaSteg(lager, env, { client });
    expect(efterSteg2).toEqual({ claimed: true, analysisId: id, stage: "extracting" });

    rad = await lager.db.hamtaAnalys(id);
    expect(rad?.stage).toBe("judging");
    expect(rad?.grundtext).toBeNull();
    expect(client.messages.create).toHaveBeenCalledTimes(2);

    // Steg 3 — bedömning, följt av en lyckad torr sammanställning.
    client.messages.countTokens.mockResolvedValueOnce({ input_tokens: 200 });
    client.messages.create.mockResolvedValueOnce(judgementResponse());
    const efterSteg3 = await korNastaSteg(lager, env, { client });
    expect(efterSteg3).toEqual({ claimed: true, analysisId: id, stage: "judging" });

    rad = await lager.db.hamtaAnalys(id);
    expect(rad?.stage).toBe("complete");
    expect(rad?.status).toBe("done");
    expect(rad?.finishedAt).toBeTruthy();
    expect(rad?.errorCode).toBeNull();
    expect(rad?.errorMessage).toBeNull();

    expect(client.messages.create).toHaveBeenCalledTimes(3);
  });

  it("cache-träff vid extraktion: noll modellanrop, raden avancerar ändå till judging", async () => {
    const lager = skapaFakeLager();
    const { id, nyckel } = await skapaRad(lager, { stage: "extracting" });
    await sparaExtraktionICache(lager.db, nyckel, extraktion, 0.5);

    const client = fakeClient();
    const resultat = await korNastaSteg(lager, miljo(), { client });

    expect(resultat).toEqual({ claimed: true, analysisId: id, stage: "extracting" });
    expect(client.messages.countTokens).not.toHaveBeenCalled();
    expect(client.messages.create).not.toHaveBeenCalled();

    const rad = await lager.db.hamtaAnalys(id);
    expect(rad?.stage).toBe("judging");
    expect(rad?.grundtext).toBeNull();

    // Cache-träff även vid bedömning: samma rad, fortsätt till complete —
    // fortfarande noll modellanrop totalt.
    await sparaAnalysICache(lager.db, nyckel, minimalJudgement(), 0.2);
    const andraResultat = await korNastaSteg(lager, miljo(), { client });

    expect(andraResultat).toEqual({ claimed: true, analysisId: id, stage: "judging" });
    expect(client.messages.countTokens).not.toHaveBeenCalled();
    expect(client.messages.create).not.toHaveBeenCalled();

    const radEfter = await lager.db.hamtaAnalys(id);
    expect(radEfter?.stage).toBe("complete");
    expect(radEfter?.status).toBe("done");
  });

  it("dagligt spendtak refuserar innan något modellanrop görs: raden requeueas med försöket återlämnat", async () => {
    const lager = skapaFakeLager();
    const { id } = await skapaRad(lager);
    const client = fakeClient();
    // UPPSKATTAD_KOSTNAD_GRUNDNING_SEK är 3 kr — ett tak på 1 kr refuserar allt.
    const env = miljo({ maxDailySpendSek: 1 });

    const fore = await lager.db.hamtaAnalys(id);

    const resultat = await korNastaSteg(lager, env, { client });
    expect(resultat).toEqual({ claimed: true, analysisId: id, stage: "uploaded" });
    expect(client.messages.countTokens).not.toHaveBeenCalled();
    expect(client.messages.create).not.toHaveBeenCalled();

    const efter = await lager.db.hamtaAnalys(id);
    expect(efter?.status).toBe("queued");
    expect(efter?.stage).toBe("uploaded");
    // Försöket ska vara återlämnat — samma antal som innan hela anropet.
    expect(efter?.attempts).toBe(fore?.attempts);
    expect(efter?.errorCode).toBeNull();
    expect(efter?.errorMessage).toBeNull();
  });

  it("kill switch refuserar innan något modellanrop görs, precis som det dagliga taket", async () => {
    const lager = skapaFakeLager();
    const { id } = await skapaRad(lager);
    const client = fakeClient();
    const env = miljo({ killSwitchPa: true, maxDailySpendSek: 100 });

    const fore = await lager.db.hamtaAnalys(id);

    const resultat = await korNastaSteg(lager, env, { client });
    expect(resultat).toEqual({ claimed: true, analysisId: id, stage: "uploaded" });
    expect(client.messages.countTokens).not.toHaveBeenCalled();
    expect(client.messages.create).not.toHaveBeenCalled();

    const efter = await lager.db.hamtaAnalys(id);
    expect(efter?.status).toBe("queued");
    expect(efter?.stage).toBe("uploaded");
    expect(efter?.attempts).toBe(fore?.attempts);
    expect(efter?.errorCode).toBeNull();
    expect(efter?.errorMessage).toBeNull();
  });

  it("requeue lämnar raden i ett rent tillstånd: efter en refuserad reservation fortsätter steget normalt när taket höjs", async () => {
    const lager = skapaFakeLager();
    const { id } = await skapaRad(lager);
    const client = fakeClient();

    await korNastaSteg(lager, miljo({ maxDailySpendSek: 1 }), { client });
    let rad = await lager.db.hamtaAnalys(id);
    expect(rad?.status).toBe("queued");
    expect(rad?.stage).toBe("uploaded");

    client.messages.countTokens.mockResolvedValueOnce({ input_tokens: 500 });
    client.messages.create.mockResolvedValueOnce(groundingResponse());
    const resultat = await korNastaSteg(lager, miljo({ maxDailySpendSek: 100 }), { client });

    expect(resultat).toEqual({ claimed: true, analysisId: id, stage: "uploaded" });
    rad = await lager.db.hamtaAnalys(id);
    expect(rad?.stage).toBe("extracting");
    expect(rad?.grundtext).toBeTruthy();
  });

  it("uttömda försök: efter tre misslyckade modellanrop blir jobbet permanent failed, och blir sedan aldrig mer klaimbart", async () => {
    const lager = skapaFakeLager();
    const { id } = await skapaRad(lager, { stage: "extracting" });
    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 300 });
    client.messages.create.mockRejectedValue(new Error("Modellen svarade inte"));
    const env = miljo();

    for (let forsok = 1; forsok <= 3; forsok++) {
      const resultat = await korNastaSteg(lager, env, { client });
      expect(resultat.claimed).toBe(true);

      const rad = await lager.db.hamtaAnalys(id);
      if (forsok < 3) {
        expect(rad?.status).toBe("queued");
        expect(rad?.errorCode).toBe("unknown");
      } else {
        expect(rad?.status).toBe("failed");
        expect(rad?.errorCode).toBe("unknown");
        expect(rad?.errorMessage).toBeTruthy();
        expect(rad?.finishedAt).toBeTruthy();
      }
    }

    const fjarde = await korNastaSteg(lager, env, { client });
    expect(fjarde).toEqual({ claimed: false });
  });

  it("varje steg får en EGEN försöksbudget: två misslyckade klaimningar vid extraktion nollställs på lyckad extraktion, så bedömningen ändå får tre nya försök (regression mot en live-upptäckt bugg — se avslutaMedFramgang)", async () => {
    const lager = skapaFakeLager();
    const { id } = await skapaRad(lager, { stage: "extracting" });
    const client = fakeClient();
    const env = miljo();

    // Två misslyckade klaimningar av extraktionssteget — samma sorts fel som
    // en väggklocke-kapad invokering skulle ge (klaimningen görs, men
    // modellanropet lyckas aldrig komma tillbaka med ett giltigt svar).
    client.messages.countTokens.mockResolvedValue({ input_tokens: 300 });
    client.messages.create.mockRejectedValueOnce(new Error("timeout"));
    client.messages.create.mockRejectedValueOnce(new Error("timeout"));
    await korNastaSteg(lager, env, { client });
    await korNastaSteg(lager, env, { client });

    let rad = await lager.db.hamtaAnalys(id);
    expect(rad?.status).toBe("queued");
    expect(rad?.stage).toBe("extracting");
    expect(rad?.attempts).toBe(2);

    // Tredje klaimningen av EXTRAKTION lyckas — det var jobbets sista
    // tillåtna klaimning INNAN nollställningen (attempts skulle annars ha
    // varit 3, och `claim_next_steg`s `attempts < 3`-filter hade gjort
    // BEDÖMNINGSSTEGET permanent oklaimbart).
    client.messages.create.mockResolvedValueOnce(extractionResponse());
    await korNastaSteg(lager, env, { client });

    rad = await lager.db.hamtaAnalys(id);
    expect(rad?.stage).toBe("judging");
    expect(rad?.attempts).toBe(0); // <-- nollställt av avslutaMedFramgang

    // Bedömningssteget ska nu kunna klaimas — inte bara en gång, utan de
    // fulla tre gångerna om det behövs, precis som om det vore jobbets enda
    // steg. Bevisa det genom att låta det misslyckas två gånger och sedan
    // lyckas på det tredje — om nollställningen inte fungerade skulle redan
    // den FÖRSTA av dessa klaimningar returnera { claimed: false }.
    client.messages.create.mockRejectedValueOnce(new Error("timeout"));
    const forstaForsok = await korNastaSteg(lager, env, { client });
    expect(forstaForsok.claimed).toBe(true);

    client.messages.create.mockRejectedValueOnce(new Error("timeout"));
    const andraForsok = await korNastaSteg(lager, env, { client });
    expect(andraForsok.claimed).toBe(true);

    client.messages.create.mockResolvedValueOnce(judgementResponse());
    const tredjeForsok = await korNastaSteg(lager, env, { client });
    expect(tredjeForsok.claimed).toBe(true);

    rad = await lager.db.hamtaAnalys(id);
    expect(rad?.stage).toBe("complete");
    expect(rad?.status).toBe("done");
  });

  it("felkodsmappning: ett ogiltigt bedömningssvar mappas till errorCode 'validation', utan att läcka Zod-detaljer", async () => {
    const lager = skapaFakeLager();
    const { id, nyckel } = await skapaRad(lager, { stage: "judging" });
    await sparaExtraktionICache(lager.db, nyckel, extraktion, 0.5);

    const client = fakeClient();
    client.messages.countTokens.mockResolvedValue({ input_tokens: 200 });
    // Ogiltigt enligt AnalysJudgementSchema: betygMotivering saknas.
    client.messages.create.mockResolvedValue({
      usage: { input_tokens: 200, output_tokens: 80 },
      content: [
        { type: "text", text: JSON.stringify({ betyg: "B", rodaFlaggor: [], fragor: [] }) },
      ],
    });
    const env = miljo();

    for (let i = 0; i < 3; i++) {
      await korNastaSteg(lager, env, { client });
    }

    const rad = await lager.db.hamtaAnalys(id);
    expect(rad?.status).toBe("failed");
    expect(rad?.errorCode).toBe("validation");
    expect(rad?.errorMessage).not.toMatch(/betygMotivering/);
    expect(rad?.errorMessage).not.toMatch(/Zod/);
  });

  it("dry assembly upptäcker saknad räntekänslighet som ett jobbfel (errorCode 'saknar_rantekanslighet'), utan modellanrop vid cache-träff", async () => {
    const lager = skapaFakeLager();
    const { id, nyckel } = await skapaRad(lager, { stage: "judging" });

    const utanRantekanslighet: ExtractionResult = {
      ...extraktion,
      forening: {
        ...extraktion.forening,
        keyFigures: extraktion.forening.keyFigures.map((kf) =>
          kf.id === "rantekanslighet" ? { ...kf, figure: { ...kf.figure, value: null } } : kf,
        ),
      },
    };
    await sparaExtraktionICache(lager.db, nyckel, utanRantekanslighet, 0.5);
    await sparaAnalysICache(lager.db, nyckel, minimalJudgement(), 0.2);

    const client = fakeClient();
    const resultat = await korNastaSteg(lager, miljo(), { client });

    expect(resultat).toEqual({ claimed: true, analysisId: id, stage: "judging" });
    expect(client.messages.countTokens).not.toHaveBeenCalled();
    expect(client.messages.create).not.toHaveBeenCalled();

    const rad = await lager.db.hamtaAnalys(id);
    // Cache-träff -> ingen reservation gjordes -> requeueas med försöket kvar,
    // precis som den vanliga fel-vägen (attempts < 3 här: bara ett försök gjort).
    expect(rad?.status).toBe("queued");
    expect(rad?.stage).toBe("judging");
    expect(rad?.errorCode).toBe("saknar_rantekanslighet");
    expect(rad?.errorMessage).toMatch(/Räntekänslighet saknas/);
  });
});
