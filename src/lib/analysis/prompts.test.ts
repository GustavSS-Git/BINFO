import { describe, expect, it } from "vitest";
import {
  ALLA_NYCKELTAL,
  buildGroundingSystemPrompt,
  extractGroundingFindings,
  formatGroundingForExtraction,
} from "./prompts";
import { KeyFigureIdSchema } from "./schema";

describe("ALLA_NYCKELTAL", () => {
  it("innehåller exakt de sju id:n som KeyFigureIdSchema tillåter", () => {
    const idsIPrompt = ALLA_NYCKELTAL.map((n) => n.id).sort();
    const idsISchema = [...KeyFigureIdSchema.options].sort();
    expect(idsIPrompt).toEqual(idsISchema);
  });

  it("varje nyckeltal har en icke-tom svensk etikett", () => {
    for (const n of ALLA_NYCKELTAL) {
      expect(n.label.length).toBeGreaterThan(0);
    }
  });
});

describe("buildGroundingSystemPrompt", () => {
  it("nämner alla sju nyckeltalens etiketter — annars kan modellen missa ett", () => {
    const prompt = buildGroundingSystemPrompt();
    for (const n of ALLA_NYCKELTAL) {
      expect(prompt).toContain(n.label);
    }
  });
});

describe("extractGroundingFindings", () => {
  it("plockar ut citat av typen page_location ur textblock", () => {
    const blocks = [
      {
        type: "text",
        text: "Skulden uppgår till 43,2 Mkr.",
        citations: [
          {
            type: "page_location",
            cited_text: "Föreningens lån uppgår till 43 200 000 kr.",
            start_page_number: 7,
            end_page_number: 7,
          },
        ],
      },
    ];

    const findings = extractGroundingFindings(blocks);

    expect(findings).toEqual([
      { text: "Skulden uppgår till 43,2 Mkr.", citat: "Föreningens lån uppgår till 43 200 000 kr.", sida: 7 },
    ]);
  });

  it("ignorerar textblock utan citations", () => {
    const blocks = [{ type: "text", text: "Ingen källa angiven." }];
    expect(extractGroundingFindings(blocks)).toEqual([]);
  });

  it("ignorerar citat som inte är page_location", () => {
    const blocks = [
      {
        type: "text",
        text: "Text",
        citations: [{ type: "char_location", cited_text: "något" }],
      },
    ];
    expect(extractGroundingFindings(blocks)).toEqual([]);
  });

  it("hanterar flera citat i samma block och flera block", () => {
    const blocks = [
      {
        type: "text",
        text: "A",
        citations: [
          { type: "page_location", cited_text: "citat1", start_page_number: 1 },
          { type: "page_location", cited_text: "citat2", start_page_number: 2 },
        ],
      },
      {
        type: "text",
        text: "B",
        citations: [{ type: "page_location", cited_text: "citat3", start_page_number: 3 }],
      },
    ];
    expect(extractGroundingFindings(blocks)).toHaveLength(3);
  });
});

describe("formatGroundingForExtraction", () => {
  it("numrerar fynden och inkluderar sida och citat", () => {
    const text = formatGroundingForExtraction([
      { text: "Skulden är hög.", citat: "43 200 000 kr", sida: 7 },
    ]);
    expect(text).toContain("1.");
    expect(text).toContain("Sida 7");
    expect(text).toContain("43 200 000 kr");
  });

  it("hanterar en tom lista utan att krascha", () => {
    expect(() => formatGroundingForExtraction([])).not.toThrow();
    expect(formatGroundingForExtraction([]).length).toBeGreaterThan(0);
  });
});
