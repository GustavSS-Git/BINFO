import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { errorHasKnownSpend } from "./callMetrics";
import { korExtraktion } from "./korExtraktion";
import { SKANNAD_KONFIDENS_SKAL, type AnthropicClientLike } from "./runExtraction";
import { ALLA_NYCKELTAL } from "./prompts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = async (n: string) =>
  new Uint8Array(await readFile(path.join(here, "__fixtures__", n)));

type CountTokens = AnthropicClientLike["messages"]["countTokens"];
type Create = AnthropicClientLike["messages"]["create"];

const extraktionJson = {
  schemaVersion: "1.0.0",
  forening: {
    namn: "Brf Skannad",
    orgnr: "769600-1234",
    akta: "ja",
    rakenskapsar: 2025,
    keyFigures: ALLA_NYCKELTAL.map((n) => ({
      id: n.id,
      label: n.label,
      figure: { value: null, unit: "kr/m2", source: "berakning" },
      status: "okant",
      forklaring: "x",
    })),
  },
  datakvalitet: {
    pdfSaknarTextlager: false,
    extraktionKonfidens: { niva: "hog" },
    saknadeFalt: [],
  },
};

/** One fake client for all stages: answers by looking at what is being asked. */
function klient() {
  const stages: string[] = [];
  const client: AnthropicClientLike & {
    messages: {
      countTokens: ReturnType<typeof vi.fn<CountTokens>>;
      create: ReturnType<typeof vi.fn<Create>>;
    };
  } = {
    messages: {
      countTokens: vi.fn<CountTokens>().mockResolvedValue({ input_tokens: 500 }),
      create: vi.fn<Create>().mockImplementation(async (params) => {
        const sys = String(params.system);
        const content = params.messages[0]!.content;
        if (sys.startsWith("Du är en exakt transkriberare")) {
          stages.push("transkribering");
          return {
            usage: { input_tokens: 500, output_tokens: 300 },
            content: [
              {
                type: "text",
                text: "=== SIDA 1 ===\nBrf Skannad\nNyckeltal | 2025\nRäntekänslighet | 6",
              },
            ],
            stop_reason: "end_turn",
          };
        }
        if (sys.startsWith("Du är en noggrann finansiell analytiker")) {
          stages.push("grundning");
          const doc = (content as Array<{ source: { type: string } }>)[0]!;
          return {
            usage: { input_tokens: 500, output_tokens: 200 },
            content: [
              {
                type: "text",
                text: "Föreningen heter Brf Skannad.",
                citations:
                  doc.source.type === "content"
                    ? [
                        {
                          type: "content_block_location",
                          cited_text: "Brf Skannad",
                          start_block_index: 0,
                          end_block_index: 1,
                        },
                      ]
                    : [{ type: "page_location", cited_text: "Brf Skannad", start_page_number: 1 }],
              },
            ],
            stop_reason: "end_turn",
          };
        }
        stages.push("extraktion");
        return {
          usage: { input_tokens: 500, output_tokens: 200 },
          content: [{ type: "text", text: JSON.stringify(extraktionJson) }],
          stop_reason: "end_turn",
        };
      }),
    },
  };
  return { client, stages };
}

const grund = {
  model: "claude-sonnet-5-5",
  maxCostSek: 20,
  effortTranskribering: "medium" as const,
  effortGrounding: "medium" as const,
  effortExtraction: "medium" as const,
  promptCache: false as const,
};

describe("korExtraktion", () => {
  it("en PDF utan textlager tar skannvägen: transkribering → grundning → extraktion, kalla 'skannad', konfidens medel", async () => {
    const { client, stages } = klient();
    const r = await korExtraktion(await fixture("utan-text.pdf"), { ...grund, client });

    expect(r.textlager).toBe("saknas");
    expect(stages).toEqual(["transkribering", "grundning", "extraktion"]);
    expect(r.steg.map((s) => s.stage)).toEqual(["transkribering", "grundning", "extraktion"]);
    expect(r.calls.map((c) => c.stage)).toEqual(["transkribering", "grundning", "extraktion"]);
    expect(r.extraction.datakvalitet.kalla).toBe("skannad");
    expect(r.extraction.datakvalitet.pdfSaknarTextlager).toBe(true);
    expect(r.extraction.datakvalitet.extraktionKonfidens).toEqual({
      niva: "medel",
      skal: [SKANNAD_KONFIDENS_SKAL],
    });
    expect(r.spentSek).toBeCloseTo(
      r.calls.reduce((s, c) => s + c.costSek, 0),
      10,
    );
  });

  it("grundningen över transkriptionen får sidan från kartan: extraktionen får 'Sida 1' i sin indata", async () => {
    const { client } = klient();
    await korExtraktion(await fixture("utan-text.pdf"), { ...grund, client });
    const extraktionsanrop = client.messages.create.mock.calls[2]![0];
    expect(JSON.stringify(extraktionsanrop.messages)).toContain("Sida 1");
  });

  it("en PDF med textlager tar den vanliga vägen: ingen transkribering, kalla 'textlager'", async () => {
    const { client, stages } = klient();
    const r = await korExtraktion(await fixture("med-text.pdf"), { ...grund, client });
    expect(r.textlager).toBe("ok");
    expect(stages).toEqual(["grundning", "extraktion"]);
    expect(r.extraction.datakvalitet.kalla).toBe("textlager");
    expect(r.extraction.datakvalitet.extraktionKonfidens.niva).toBe("hog");
  });

  it("använder maxCostSekSkannad bara för en skanning", async () => {
    const { client } = klient();
    const skannad = await korExtraktion(await fixture("utan-text.pdf"), {
      ...grund,
      maxCostSek: 5,
      maxCostSekSkannad: 25,
      client,
    });
    expect(skannad.tak).toBe(25);
    const text = await korExtraktion(await fixture("med-text.pdf"), {
      ...grund,
      maxCostSek: 5,
      maxCostSekSkannad: 25,
      client: klient().client,
    });
    expect(text.tak).toBe(5);
  });

  it("transkriptionsfilen sparar sidor per chunk och återanvänds vid nästa körning (inga nya transkriberingsanrop)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "binfo-transkription-"));
    const fil = path.join(dir, "t.json");
    const forsta = klient();
    await korExtraktion(await fixture("utan-text.pdf"), {
      ...grund,
      client: forsta.client,
      transkriptionsFil: fil,
    });
    expect(JSON.parse(await readFile(fil, "utf-8"))).toEqual({
      "1": "Brf Skannad\nNyckeltal | 2025\nRäntekänslighet | 6",
    });
    const andra = klient();
    await korExtraktion(await fixture("utan-text.pdf"), {
      ...grund,
      client: andra.client,
      transkriptionsFil: fil,
    });
    expect(andra.stages).toEqual(["grundning", "extraktion"]);
  });

  it("ett fel i ett senare steg annoteras med ALLT som redan spenderats (transkriberingen inräknad)", async () => {
    const { client } = klient();
    client.messages.create.mockImplementation(async (params) => {
      const sys = String(params.system);
      if (sys.startsWith("Du är en exakt transkriberare")) {
        return {
          usage: { input_tokens: 500, output_tokens: 300 },
          content: [{ type: "text", text: "=== SIDA 1 ===\nHej | 1" }],
          stop_reason: "end_turn",
        };
      }
      return {
        usage: { input_tokens: 500, output_tokens: 200 },
        content: [{ type: "text", text: "avkapat" }],
        stop_reason: "max_tokens",
      };
    });
    const fel = await korExtraktion(await fixture("utan-text.pdf"), { ...grund, client }).catch(
      (e: unknown) => e,
    );
    expect(errorHasKnownSpend(fel)).toBe(true);
    if (errorHasKnownSpend(fel)) {
      expect(fel.calls.map((c) => c.stage)).toEqual(["transkribering", "grundning"]);
      expect(fel.spentSek).toBeCloseTo(
        fel.calls.reduce((s, c) => s + c.costSek, 0),
        10,
      );
    }
  });
});
