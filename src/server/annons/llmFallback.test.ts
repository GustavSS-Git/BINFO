import { describe, expect, it, vi } from "vitest";
import type { AnthropicClientLike } from "@/lib/analysis/runExtraction";
import {
  ANNONS_LLM_MAX_OUTPUT_TOKENS,
  ANNONS_LLM_MODELL,
  MAX_TECKEN_SIDTEXT,
  strippaHtmlTillText,
  tolkaAnnonsMedModell,
  uppskattadLlmKostnadSek,
  valideraLlmSvar,
  type AnnonsLlmSpend,
} from "./llmFallback";

const URL_ = "https://www.booli.se/bostad/720821";
const NU = new Date("2026-10-24T12:00:00Z");

const SIDA = `<!doctype html><html><head><title>x</title><style>.a{color:red}</style></head><body>
<script>window.__x = {"streetAddress":"HEMLIG"}</script><svg><path d="M0"/></svg>
<h1>Sankt Eriksgatan 31A</h1><p>2 rum &amp; k&#246;k, 54&#160;m&sup2; &#x2022; Avgift 3&nbsp;900 kr/mån</p>
<!-- kommentar --><noscript>Aktivera JavaScript</noscript><div>V&aring;ning 3 av 5</div></body></html>`;

const GILTIG = {
  adress: "Sankt Eriksgatan 31A",
  postnummer: "11239",
  ort: "Stockholm",
  utgangspris: 5_200_000,
  manadsavgift: 3900,
  boarea: 54.04,
  antalRum: 2,
  vaning: 3,
  byggar: 1932,
  hiss: "ja",
  balkong: null,
  forening: "Brf Exempel",
};

interface Anrop {
  params: Parameters<AnthropicClientLike["messages"]["create"]>[0];
  options: Parameters<AnthropicClientLike["messages"]["create"]>[1];
}

function fakeKlient(
  svar:
    | {
        text?: string;
        stop_reason?: string | null;
        usage?: Partial<{ input: number; output: number }>;
      }
    | Error,
) {
  const anrop: Anrop[] = [];
  const klient: AnthropicClientLike = {
    messages: {
      countTokens: vi.fn(async () => ({ input_tokens: 0 })),
      create: vi.fn(async (params, options) => {
        anrop.push({ params, options });
        if (svar instanceof Error) throw svar;
        return {
          usage: {
            input_tokens: svar.usage?.input ?? 4000,
            output_tokens: svar.usage?.output ?? 120,
          },
          content: [{ type: "text", text: svar.text ?? JSON.stringify(GILTIG) }],
          stop_reason: svar.stop_reason ?? "end_turn",
        };
      }),
    },
  };
  return { klient, anrop };
}

function fakeSpend(tillat = true) {
  const handelser: string[] = [];
  const spend: AnnonsLlmSpend = {
    reservera: vi.fn(async (sek: number) => {
      handelser.push(`reservera ${sek.toFixed(3)}`);
      return tillat;
    }),
    avstam: vi.fn(async (res: number, fakt: number) => {
      handelser.push(`avstam ${res.toFixed(3)} -> ${fakt.toFixed(3)}`);
    }),
  };
  return { spend, handelser };
}

describe("strippaHtmlTillText", () => {
  it("tar bort script/style/svg/noscript/kommentarer och avkodar entiteter", () => {
    const t = strippaHtmlTillText(SIDA);
    expect(t).toContain("Sankt Eriksgatan 31A");
    expect(t).toContain("2 rum & kök, 54 m²");
    expect(t).toContain("Avgift 3 900 kr/mån");
    expect(t).toContain("Våning 3 av 5");
    expect(t).not.toMatch(/HEMLIG|color:red|M0|kommentar|Aktivera|<|>|x<\/title/);
    expect(t).not.toMatch(/\s{2,}/);
  });

  it("kapar vid 20 000 tecken", () => {
    const stor = `<p>${"ord ".repeat(20_000)}</p>`;
    expect(strippaHtmlTillText(stor)).toHaveLength(MAX_TECKEN_SIDTEXT);
  });

  it("ett oavslutat scriptblock (avhuggen sida) tas bort till slutet", () => {
    expect(strippaHtmlTillText("<p>Synlig</p><script>var x = 'hemligt")).toBe("Synlig");
  });

  it("returnerar aldrig märkkod", () => {
    expect(strippaHtmlTillText("<div><b>fet</b> <a href='x'>länk</a></div>")).toBe("fet länk");
  });
});

describe("valideraLlmSvar", () => {
  it("normaliserar: postnummer med mellanrum, boarea en decimal, hiss ja, balkong null", () => {
    expect(valideraLlmSvar(GILTIG, NU)).toEqual({
      uppgifter: {
        adress: "Sankt Eriksgatan 31A",
        postnummer: "112 39",
        ort: "Stockholm",
        utgangspris: 5_200_000,
        manadsavgift: 3900,
        boarea: 54,
        antalRum: 2,
        vaning: 3,
        byggar: 1932,
        hiss: "ja",
        forening: "Brf Exempel",
      },
    });
  });

  it("nej för hiss/balkong blir frånvarande (okänt är inte falskt), och 0 för avgift/pris betyder saknas", () => {
    const r = valideraLlmSvar(
      { ...GILTIG, hiss: "nej", balkong: "nej", manadsavgift: 0, utgangspris: 0 },
      NU,
    );
    expect(r).toEqual({
      uppgifter: expect.not.objectContaining({ hiss: expect.anything() }),
    });
    const u = (r as { uppgifter: Record<string, unknown> }).uppgifter;
    expect("hiss" in u || "balkong" in u || "manadsavgift" in u || "utgangspris" in u).toBe(false);
  });

  it("halva rum godtas, 2.3 rum avvisas", () => {
    expect("uppgifter" in valideraLlmSvar({ adress: "A 1", antalRum: 2.5 }, NU)).toBe(true);
    expect("fel" in valideraLlmSvar({ adress: "A 1", antalRum: 2.3 }, NU)).toBe(true);
  });

  it("värden utanför intervall avvisar hela svaret", () => {
    const dalig: Array<Record<string, unknown>> = [
      { boarea: 0 },
      { boarea: 5000 },
      { boarea: "54" },
      { manadsavgift: 3900.5 },
      { manadsavgift: 3_900_000 },
      { utgangspris: -1 },
      { utgangspris: 9_999_999_999 },
      { vaning: 3.5 },
      { vaning: 400 },
      { byggar: 1200 },
      { byggar: 2099 },
      { postnummer: "1123" },
      { postnummer: "Stockholm" },
      { hiss: "kanske" },
      { hiss: true },
      { adress: "" },
      { adress: "x".repeat(500) },
    ];
    for (const d of dalig) {
      expect("fel" in valideraLlmSvar({ ...GILTIG, ...d }, NU), JSON.stringify(d)).toBe(true);
    }
  });

  it("okända nycklar avvisas (strikt)", () => {
    expect("fel" in valideraLlmSvar({ ...GILTIG, pris: 1 }, NU)).toBe(true);
  });

  it("allt null är ett tomt svar, inte ett lyckat", () => {
    const tomt = Object.fromEntries(Object.keys(GILTIG).map((k) => [k, null]));
    expect(valideraLlmSvar(tomt, NU)).toEqual({ fel: "tomt svar" });
  });

  it("icke-objekt avvisas", () => {
    for (const x of ["text", null, 5, []]) expect("fel" in valideraLlmSvar(x, NU)).toBe(true);
  });
});

describe("tolkaAnnonsMedModell", () => {
  it("lyckad körning: Haiku 4.5, 600 tokens, strippad text i prompten, ingen råa HTML, kostnad ur usage", async () => {
    const { klient, anrop } = fakeKlient({});
    const r = await tolkaAnnonsMedModell(SIDA, URL_, { client: klient, nu: () => NU });
    expect(r.typ).toBe("ok");
    if (r.typ !== "ok") return;
    expect(r.uppgifter.boarea).toBe(54);
    expect(r.anrop.model).toBe(ANNONS_LLM_MODELL);
    expect(ANNONS_LLM_MODELL).toBe("claude-haiku-4-5");
    expect(r.anrop).toMatchObject({
      inputTokens: 4000,
      outputTokens: 120,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
    // Haiku 4.5: $1 in / $5 out per Mtok, 9.7 SEK/USD: (4000 + 600) / 1e6 * 9.7
    expect(r.kostnadSek).toBeCloseTo(((4000 * 1 + 120 * 5) / 1_000_000) * 9.7, 6);
    expect(anrop).toHaveLength(1);
    const p = anrop[0]!.params;
    expect(p.model).toBe("claude-haiku-4-5");
    expect(p.max_tokens).toBe(ANNONS_LLM_MAX_OUTPUT_TOKENS);
    expect(ANNONS_LLM_MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(600);
    const innehall = String((p.messages[0] as { content: unknown }).content);
    expect(innehall).toContain("Sankt Eriksgatan 31A");
    expect(innehall).not.toMatch(/<script|<h1>|HEMLIG/);
    expect(anrop[0]!.options?.signal).toBeInstanceOf(AbortSignal);
  });

  it("ogiltig JSON ger ingen/ogiltigt_svar, utan omförsök", async () => {
    const { klient, anrop } = fakeKlient({ text: "Jag kan inte läsa sidan." });
    const r = await tolkaAnnonsMedModell(SIDA, URL_, { client: klient, nu: () => NU });
    expect(r).toMatchObject({ typ: "ingen", orsak: "ogiltigt_svar" });
    expect(anrop).toHaveLength(1);
    // The call was real and paid for.
    expect(r.kostnadSek).toBeGreaterThan(0);
  });

  it("värden utanför intervall och Zod-avvisning ger ingen", async () => {
    const { klient } = fakeKlient({ text: JSON.stringify({ ...GILTIG, boarea: 9999 }) });
    expect(await tolkaAnnonsMedModell(SIDA, URL_, { client: klient, nu: () => NU })).toMatchObject({
      typ: "ingen",
      orsak: "ogiltigt_svar",
    });
  });

  it("kodstaket runt JSON tolereras (samma reparation som pipeline)", async () => {
    const { klient } = fakeKlient({ text: "```json\n" + JSON.stringify(GILTIG) + "\n```" });
    expect((await tolkaAnnonsMedModell(SIDA, URL_, { client: klient, nu: () => NU })).typ).toBe(
      "ok",
    );
  });

  it("avhugget eller nekat svar (max_tokens, refusal) ger ingen", async () => {
    for (const stop of ["max_tokens", "refusal"]) {
      const { klient } = fakeKlient({ stop_reason: stop });
      expect(
        await tolkaAnnonsMedModell(SIDA, URL_, { client: klient, nu: () => NU }),
      ).toMatchObject({
        typ: "ingen",
        orsak: "ogiltigt_svar",
      });
    }
  });

  it("API-fel ger ingen/modellfel och kastar inte", async () => {
    const { klient } = fakeKlient(new Error("529 overloaded"));
    expect(await tolkaAnnonsMedModell(SIDA, URL_, { client: klient, nu: () => NU })).toMatchObject({
      typ: "ingen",
      orsak: "modellfel",
      detalj: "529 overloaded",
    });
  });

  it("en tom sida skickas aldrig till modellen", async () => {
    const { klient, anrop } = fakeKlient({});
    const { spend } = fakeSpend();
    const r = await tolkaAnnonsMedModell("<html><script>x</script></html>", URL_, {
      client: klient,
      spend,
    });
    expect(r).toMatchObject({ typ: "ingen", orsak: "tom_sida", kostnadSek: 0 });
    expect(anrop).toHaveLength(0);
    expect(spend.reservera).not.toHaveBeenCalled();
  });

  it("dagstaket: nekad reservation → inget anrop", async () => {
    const { klient, anrop } = fakeKlient({});
    const { spend } = fakeSpend(false);
    const r = await tolkaAnnonsMedModell(SIDA, URL_, { client: klient, spend });
    expect(r).toMatchObject({ typ: "ingen", orsak: "daglig_grans" });
    expect(anrop).toHaveLength(0);
    expect(spend.avstam).not.toHaveBeenCalled();
  });

  it("reserverar före och stämmer av mot verklig kostnad efter, även vid fel", async () => {
    const ok = fakeSpend();
    await tolkaAnnonsMedModell(SIDA, URL_, {
      client: fakeKlient({}).klient,
      spend: ok.spend,
      nu: () => NU,
    });
    expect(ok.handelser).toHaveLength(2);
    expect(ok.handelser[0]).toBe(`reservera ${uppskattadLlmKostnadSek().toFixed(3)}`);
    expect(ok.handelser[1]).toMatch(/^avstam .* -> 0\.0(4|5)\d$/);

    const fel = fakeSpend();
    await tolkaAnnonsMedModell(SIDA, URL_, {
      client: fakeKlient(new Error("nere")).klient,
      spend: fel.spend,
    });
    expect(fel.handelser[1]).toMatch(/-> 0\.000$/);
  });

  it("worst case-reservationen är liten (under 0.2 kr) och bygger på Haiku-priset", () => {
    const sek = uppskattadLlmKostnadSek();
    expect(sek).toBeGreaterThan(0.05);
    expect(sek).toBeLessThan(0.2);
  });

  it("avbryts av tidsgränsen", async () => {
    vi.useFakeTimers();
    try {
      const klient: AnthropicClientLike = {
        messages: {
          countTokens: vi.fn(async () => ({ input_tokens: 0 })),
          create: vi.fn(
            (_p, o) =>
              new Promise<never>((_res, rej) => {
                o?.signal?.addEventListener("abort", () => rej(new Error("avbruten")));
              }),
          ),
        },
      };
      const p = tolkaAnnonsMedModell(SIDA, URL_, { client: klient, tidsgransMs: 1000 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(await p).toMatchObject({ typ: "ingen", orsak: "avbruten" });
    } finally {
      vi.useRealTimers();
    }
  });
});
