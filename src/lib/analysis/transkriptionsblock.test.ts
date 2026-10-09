import { describe, expect, it } from "vitest";
import { formatGroundingForExtraction } from "./prompts";
import {
  byggTranskriptionsblock,
  byggTranskriptionsdokument,
  extraheraTranskriptionsfynd,
} from "./transkriptionsblock";

const SIDOR = [
  {
    sida: 6,
    text: "Flerårsöversikt\nFöreningens nyckeltal\n\nNyckeltal | 2025 | 2024\nÅrsavgift per kvm | 1 262 | 1 200\nSparande per kvm | neg | 12\n\nEn slutrad",
  },
  { sida: 7, text: "" },
  { sida: 8, text: "Balansräkning\r\nSumma tillgångar | 300 622 392 | 290 000 000" },
];

describe("byggTranskriptionsblock", () => {
  it("gör styckena och varje tabellrad till egna block, med originalsidan", () => {
    expect(byggTranskriptionsblock(SIDOR)).toEqual([
      { sida: 6, text: "Flerårsöversikt\nFöreningens nyckeltal" },
      { sida: 6, text: "Nyckeltal | 2025 | 2024" },
      { sida: 6, text: "Årsavgift per kvm | 1 262 | 1 200" },
      { sida: 6, text: "Sparande per kvm | neg | 12" },
      { sida: 6, text: "En slutrad" },
      { sida: 8, text: "Balansräkning" },
      { sida: 8, text: "Summa tillgångar | 300 622 392 | 290 000 000" },
    ]);
  });

  it("en tom sida ger inget block (API:et avvisar tomma textblock)", () => {
    expect(byggTranskriptionsblock([{ sida: 1, text: " \n\n " }])).toEqual([]);
  });

  it("sorterar på sidnummer även om indata är i annan ordning", () => {
    const r = byggTranskriptionsblock([
      { sida: 3, text: "tre" },
      { sida: 2, text: "två" },
    ]);
    expect(r.map((b) => b.sida)).toEqual([2, 3]);
  });
});

describe("byggTranskriptionsdokument", () => {
  it("är ett custom-content-dokument med citat på och en textpost per block", () => {
    const doc = byggTranskriptionsdokument([
      { sida: 1, text: "a" },
      { sida: 2, text: "b" },
    ]);
    expect(doc).toEqual({
      type: "document",
      source: {
        type: "content",
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ],
      },
      title: "Årsredovisning (transkriberad)",
      citations: { enabled: true },
    });
  });
});

describe("extraheraTranskriptionsfynd", () => {
  const block = byggTranskriptionsblock(SIDOR);

  const svar = (citations: unknown[], text = "Påstående") => [
    { type: "text", text, citations: citations as never },
  ];

  it("mappar ett blockindex till originalsidan — inte till indexet eller en räknad sida", () => {
    // block 6 = "Summa tillgångar ..." on page 8
    const { fynd, avvisade } = extraheraTranskriptionsfynd(
      svar([
        {
          type: "content_block_location",
          cited_text: "Summa tillgångar | 300 622 392",
          document_index: 0,
          start_block_index: 6,
          end_block_index: 7,
        },
      ]),
      block,
    );
    expect(avvisade).toBe(0);
    expect(fynd).toEqual([{ text: "Påstående", citat: "Summa tillgångar | 300 622 392", sida: 8 }]);
  });

  it("ett citat över flera sidor ger ett fynd per sida; samma sida två gånger ger ett", () => {
    const { fynd } = extraheraTranskriptionsfynd(
      svar([
        {
          type: "content_block_location",
          cited_text: "x",
          start_block_index: 3,
          end_block_index: 7,
        },
      ]),
      block,
    );
    expect(fynd.map((f) => f.sida)).toEqual([6, 8]);
  });

  it("saknat end_block_index räknas som ett enda block", () => {
    const { fynd } = extraheraTranskriptionsfynd(
      svar([{ type: "content_block_location", cited_text: "x", start_block_index: 5 }]),
      block,
    );
    expect(fynd.map((f) => f.sida)).toEqual([8]);
  });

  it("avvisar index utanför kartan, negativa, icke-heltal och andra dokument — gissar aldrig en sida", () => {
    const { fynd, avvisade } = extraheraTranskriptionsfynd(
      svar([
        {
          type: "content_block_location",
          cited_text: "x",
          start_block_index: 99,
          end_block_index: 100,
        },
        {
          type: "content_block_location",
          cited_text: "x",
          start_block_index: -1,
          end_block_index: 0,
        },
        { type: "content_block_location", cited_text: "x", start_block_index: 1.5 },
        {
          type: "content_block_location",
          cited_text: "x",
          document_index: 1,
          start_block_index: 1,
        },
        {
          type: "content_block_location",
          cited_text: "x",
          start_block_index: 5,
          end_block_index: 9,
        },
        { type: "content_block_location", cited_text: "x" },
      ]),
      block,
    );
    expect(fynd).toEqual([]);
    expect(avvisade).toBe(6);
  });

  it("ignorerar andra citattyper, tomma citat och textblock utan citat", () => {
    const { fynd, avvisade } = extraheraTranskriptionsfynd(
      [
        { type: "text", text: "utan citat" },
        {
          type: "text",
          text: "pdf",
          citations: [{ type: "page_location", cited_text: "x", start_block_index: 0 }],
        },
        {
          type: "text",
          text: "tomt",
          citations: [{ type: "content_block_location", cited_text: "", start_block_index: 0 }],
        },
        { type: "thinking", text: "", citations: null },
      ],
      block,
    );
    expect(fynd).toEqual([]);
    expect(avvisade).toBe(0);
  });

  it("fynden formateras exakt som i dagens pipeline ('Sida N: ...')", () => {
    const { fynd } = extraheraTranskriptionsfynd(
      svar([
        {
          type: "content_block_location",
          cited_text: "Sparande per kvm | neg | 12",
          start_block_index: 3,
          end_block_index: 4,
        },
      ]),
      block,
    );
    expect(formatGroundingForExtraction(fynd)).toBe(
      '1. Sida 6: "Sparande per kvm | neg | 12"\n   Sammanhang: Påstående',
    );
  });

  it("slår ihop radbrytningar i ett citat från ett flerradigt stycke — de är radbrytningar i avskriften, inte innehåll", () => {
    const { fynd } = extraheraTranskriptionsfynd(
      svar([
        {
          type: "content_block_location",
          cited_text: "Flerårsöversikt\nFöreningens nyckeltal",
          start_block_index: 0,
          end_block_index: 1,
        },
      ]),
      block,
    );
    expect(fynd[0]!.citat).toBe("Flerårsöversikt Föreningens nyckeltal");
  });
});
