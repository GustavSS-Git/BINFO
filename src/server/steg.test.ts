import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { AnalysJudgement } from "@/lib/analysis/analyze";
import { PROMPT_VERSION } from "@/lib/analysis/prompts";
import type { AnthropicClientLike } from "@/lib/analysis/runExtraction";
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

async function propertyInputExample(): Promise<{ input: PropertyInput }> {
  const raw = await readFile(
    path.join(here, "..", "..", "fixtures", "property-input-example.json"),
    "utf-8",
  );
  return JSON.parse(raw) as { input: PropertyInput };
}

const MODEL = "claude-sonnet-5";

let nastaHash = 1;

interface SkapaRadOptions {
  stage?: AnalysStage;
  status?: AnalysStatus;
}

/** Inserts a realistic job row (real PropertyInput from the fixture, a real
 *  PDF uploaded to the fake Filarkiv) and returns the id plus the cache key
 *  every step keys its reads/writes on. */
async function skapaRad(
  lager: Lager,
  options: SkapaRadOptions = {},
): Promise<{ id: string; pdfPath: string; nyckel: CacheNyckel }> {
  const { input } = await propertyInputExample();
  const pdfHash = `hash-${nastaHash++}`;
  const pdfPath = `arsredovisningar/${pdfHash}.pdf`;
  await lager.filer.laggUpp(pdfPath, await medTextPdf());

  const { id } = await lager.db.skapaAnalys({
    pdfHash,
    pdfPath,
    propertyInput: input,
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
    // Samma default som lasEnv (env.ts) — supervisorbeslut: "medium" är
    // shippad default, inte bara en opt-in via env-variabel.
    effortGrounding: "medium",
    effortExtraction: "medium",
    effortJudging: "medium",
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

  it("saknad räntekänslighet fäller inte jobbet (task 7): torr sammanställning lyckas och raden blir done, utan modellanrop vid cache-träff", async () => {
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
    expect(rad?.status).toBe("done");
    expect(rad?.stage).toBe("complete");
    expect(rad?.errorCode).toBeNull();
  });

  describe("reinvoke — task 1.2: hoppa direkt till nästa steg i stället för att vänta på nästa cron-tick", () => {
    it("triggas efter en lyckad grundning (raden lämnas queued vid 'extracting', mer att göra direkt)", async () => {
      const lager = skapaFakeLager();
      await skapaRad(lager);
      const client = fakeClient();
      client.messages.countTokens.mockResolvedValueOnce({ input_tokens: 500 });
      client.messages.create.mockResolvedValueOnce(groundingResponse());
      const reinvoke = vi.fn();

      await korNastaSteg(lager, miljo(), { client, reinvoke });

      expect(reinvoke).toHaveBeenCalledTimes(1);
    });

    it("triggas efter en lyckad extraktion via ett riktigt modellanrop (queued vid 'judging')", async () => {
      const lager = skapaFakeLager();
      await skapaRad(lager, { stage: "extracting" });
      const client = fakeClient();
      client.messages.countTokens.mockResolvedValueOnce({ input_tokens: 300 });
      client.messages.create.mockResolvedValueOnce(extractionResponse());
      const reinvoke = vi.fn();

      await korNastaSteg(lager, miljo(), { client, reinvoke });

      expect(reinvoke).toHaveBeenCalledTimes(1);
    });

    it("triggas även vid en cache-träff i extraktionssteget — 'klar direkt' oavsett om ett modellanrop faktiskt gjordes", async () => {
      const lager = skapaFakeLager();
      const { nyckel } = await skapaRad(lager, { stage: "extracting" });
      await sparaExtraktionICache(lager.db, nyckel, extraktion, 0.5);
      const client = fakeClient();
      const reinvoke = vi.fn();

      await korNastaSteg(lager, miljo(), { client, reinvoke });

      expect(reinvoke).toHaveBeenCalledTimes(1);
    });

    it("triggas INTE efter en lyckad bedömning — jobbet är 'complete', inget mer att avancera", async () => {
      const lager = skapaFakeLager();
      const { nyckel } = await skapaRad(lager, { stage: "judging" });
      await sparaExtraktionICache(lager.db, nyckel, extraktion, 0.5);
      const client = fakeClient();
      client.messages.countTokens.mockResolvedValueOnce({ input_tokens: 200 });
      client.messages.create.mockResolvedValueOnce(judgementResponse());
      const reinvoke = vi.fn();

      await korNastaSteg(lager, miljo(), { client, reinvoke });

      expect(reinvoke).not.toHaveBeenCalled();
    });

    it("triggas INTE när reservationen refuseras (dagligt tak) — en omedelbar omkörning skulle bara refuseras igen", async () => {
      const lager = skapaFakeLager();
      await skapaRad(lager);
      const client = fakeClient();
      const reinvoke = vi.fn();

      await korNastaSteg(lager, miljo({ maxDailySpendSek: 1 }), { client, reinvoke });

      expect(reinvoke).not.toHaveBeenCalled();
    });

    it("triggas INTE när steget misslyckas", async () => {
      const lager = skapaFakeLager();
      await skapaRad(lager, { stage: "extracting" });
      const client = fakeClient();
      client.messages.countTokens.mockResolvedValue({ input_tokens: 300 });
      client.messages.create.mockRejectedValue(new Error("Modellen svarade inte"));
      const reinvoke = vi.fn();

      await korNastaSteg(lager, miljo(), { client, reinvoke });

      expect(reinvoke).not.toHaveBeenCalled();
    });

    it("frånvaron av reinvoke i options är ofarlig (produktionens Edge Function skickar den, men inget kraschar utan den)", async () => {
      const lager = skapaFakeLager();
      await skapaRad(lager);
      const client = fakeClient();
      client.messages.countTokens.mockResolvedValueOnce({ input_tokens: 500 });
      client.messages.create.mockResolvedValueOnce(groundingResponse());

      await expect(korNastaSteg(lager, miljo(), { client })).resolves.toBeDefined();
    });
  });

  describe("spend-accounting vid fel (reviewer finding: ett fel efter ett betalt anrop stämdes tidigare alltid av mot 0 kr)", () => {
    it("en trunkerad extraktion (stop_reason max_tokens) räknar den faktiska kostnaden mot jobbets costSek, inte 0 kr", async () => {
      const lager = skapaFakeLager();
      const { id } = await skapaRad(lager, { stage: "extracting" });
      const client = fakeClient();
      client.messages.countTokens.mockResolvedValue({ input_tokens: 300 });
      client.messages.create.mockResolvedValue({
        usage: { input_tokens: 300, output_tokens: 16000 },
        content: [{ type: "text", text: '{"schemaVersion": "1.0.0"' }],
        stop_reason: "max_tokens",
      });

      const foreRad = await lager.db.hamtaAnalys(id);
      await korNastaSteg(lager, miljo(), { client });

      const rad = await lager.db.hamtaAnalys(id);
      expect(rad?.status).toBe("queued"); // attempts < 3 än så länge
      expect(rad?.errorCode).toBe("validation");
      expect(rad?.costSek).toBeGreaterThan(foreRad?.costSek ?? 0);
    });

    it("en uttömd retry i bedömningssteget (två betalda anrop) räknar båda anropens kostnad, inte 0 kr", async () => {
      const lager = skapaFakeLager();
      const { id, nyckel } = await skapaRad(lager, { stage: "judging" });
      await sparaExtraktionICache(lager.db, nyckel, extraktion, 0.5);
      const client = fakeClient();
      client.messages.countTokens.mockResolvedValue({ input_tokens: 200 });
      client.messages.create.mockResolvedValue({
        usage: { input_tokens: 200, output_tokens: 80 },
        content: [{ type: "text", text: '{"helt": "fel form"}' }],
      });

      await korNastaSteg(lager, miljo(), { client });

      const rad = await lager.db.hamtaAnalys(id);
      expect(rad?.errorCode).toBe("validation");
      expect(client.messages.create).toHaveBeenCalledTimes(2);
      expect(rad?.costSek).toBeGreaterThan(0);
    });

    it("cache-skrivning som misslyckas EFTER en lyckad, betald extraktion räknar den redan kända kostnaden, inte 0 kr (gap hittat av granskaren)", async () => {
      const lager = skapaFakeLager();
      const { id } = await skapaRad(lager, { stage: "extracting" });
      const client = fakeClient();
      client.messages.countTokens.mockResolvedValueOnce({ input_tokens: 300 });
      client.messages.create.mockResolvedValueOnce(extractionResponse());
      // Extraktionsanropet lyckas och betalas för — men skrivningen till
      // extraktion_cache (efter anropet, före avslutaMedFramgang) misslyckas.
      // spentSek är redan känt av korExtraktionssteg vid det laget.
      lager.db.sparaExtraktion = async () => {
        throw new Error("Databasen svarade inte");
      };

      const foreRad = await lager.db.hamtaAnalys(id);
      await korNastaSteg(lager, miljo(), { client });

      const rad = await lager.db.hamtaAnalys(id);
      expect(client.messages.create).toHaveBeenCalledTimes(1); // det betalda anropet gjordes
      expect(rad?.status).toBe("queued"); // attempts < 3 än så länge
      expect(rad?.errorCode).toBe("unknown");
      expect(rad?.costSek).toBeGreaterThan(foreRad?.costSek ?? 0);
    });

    it("saknad räntekänslighet EFTER en FÄRSK, betald bedömning: jobbet blir done och den faktiska kostnaden räknas", async () => {
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
      // Ingen sparaAnalysICache här — bedömningen görs på riktigt (färskt,
      // betalt anrop), till skillnad från den befintliga
      // "cache-träff"-varianten av det här testet ovan.

      const client = fakeClient();
      client.messages.countTokens.mockResolvedValueOnce({ input_tokens: 200 });
      client.messages.create.mockResolvedValueOnce(judgementResponse());

      const foreRad = await lager.db.hamtaAnalys(id);
      const resultat = await korNastaSteg(lager, miljo(), { client });

      expect(resultat).toEqual({ claimed: true, analysisId: id, stage: "judging" });
      expect(client.messages.create).toHaveBeenCalledTimes(1); // det betalda anropet gjordes

      const rad = await lager.db.hamtaAnalys(id);
      expect(rad?.status).toBe("done");
      expect(rad?.errorCode).toBeNull();
      expect(rad?.costSek).toBeGreaterThan(foreRad?.costSek ?? 0);
    });

    it("ett fel FÖRE något betalt anrop (kostnadstaket) räknar fortsatt 0 kr — det är fortfarande korrekt, inte en bugg", async () => {
      const lager = skapaFakeLager();
      const { id } = await skapaRad(lager);
      const client = fakeClient();
      // Ett absurt lågt tak per analys gör att enforceCostLimit kastar redan
      // vid pre-flight, innan client.messages.create någonsin anropas.
      client.messages.countTokens.mockResolvedValue({ input_tokens: 500 });
      const env = miljo({ maxCostPerAnalysisSek: 0.0001 });

      await korNastaSteg(lager, env, { client });

      expect(client.messages.create).not.toHaveBeenCalled();
      const rad = await lager.db.hamtaAnalys(id);
      expect(rad?.costSek).toBe(0);
    });
  });

  describe("effort — per-stegs reasoning-djup från Env (task 1.2)", () => {
    it("skickar env.effortGrounding vidare till grundningsanropet", async () => {
      const lager = skapaFakeLager();
      await skapaRad(lager);
      const client = fakeClient();
      client.messages.countTokens.mockResolvedValueOnce({ input_tokens: 500 });
      client.messages.create.mockResolvedValueOnce(groundingResponse());

      await korNastaSteg(lager, miljo({ effortGrounding: "low" }), { client });

      const params = client.messages.create.mock.calls[0]?.[0] as { output_config?: unknown };
      expect(params.output_config).toEqual({ effort: "low" });
    });

    it("skickar env.effortExtraction vidare till extraktionsanropet", async () => {
      const lager = skapaFakeLager();
      await skapaRad(lager, { stage: "extracting" });
      const client = fakeClient();
      client.messages.countTokens.mockResolvedValueOnce({ input_tokens: 300 });
      client.messages.create.mockResolvedValueOnce(extractionResponse());

      // "xhigh", inte "medium" — medium råkar vara Env-defaulten (se nedan),
      // så ett värde SKILT från defaulten bevisar att det verkligen är
      // overriden som styr, inte bara att defaulten händer stämma.
      await korNastaSteg(lager, miljo({ effortExtraction: "xhigh" }), { client });

      const params = client.messages.create.mock.calls[0]?.[0] as { output_config?: unknown };
      expect(params.output_config).toEqual({ effort: "xhigh" });
    });

    it("skickar env.effortJudging vidare till bedömningsanropet", async () => {
      const lager = skapaFakeLager();
      const { nyckel } = await skapaRad(lager, { stage: "judging" });
      await sparaExtraktionICache(lager.db, nyckel, extraktion, 0.5);
      const client = fakeClient();
      client.messages.countTokens.mockResolvedValueOnce({ input_tokens: 200 });
      client.messages.create.mockResolvedValueOnce(judgementResponse());

      await korNastaSteg(lager, miljo({ effortJudging: "high" }), { client });

      const params = client.messages.create.mock.calls[0]?.[0] as { output_config?: unknown };
      expect(params.output_config).toEqual({ effort: "high" });
    });

    it("skickar effort: 'medium' som DEFAULT när miljo() inte overridar något (supervisorbeslut: shippad default, inte adaptivt)", async () => {
      const lager = skapaFakeLager();
      await skapaRad(lager);
      const client = fakeClient();
      client.messages.countTokens.mockResolvedValueOnce({ input_tokens: 500 });
      client.messages.create.mockResolvedValueOnce(groundingResponse());

      await korNastaSteg(lager, miljo(), { client });

      const params = client.messages.create.mock.calls[0]?.[0] as { output_config?: unknown };
      expect(params.output_config).toEqual({ effort: "medium" });
    });
  });
});
