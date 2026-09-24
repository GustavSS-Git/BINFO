import { describe, expect, it } from "vitest";
import { GILTIGA_EFFORT, STANDARD_EFFORT, valideraEffort } from "./effort";

/**
 * Real tests for the Edge Function's effort-reading logic (see effort.ts's
 * doc comment for why index.ts itself — Deno.serve at its top level — can't
 * be imported and tested directly under Vitest/Node).
 */

describe("valideraEffort", () => {
  it("defaultar till STANDARD_EFFORT ('medium') när värdet är undefined (genuint saknad secret)", () => {
    expect(valideraEffort("ANTHROPIC_EFFORT_GROUNDING", undefined)).toBe(STANDARD_EFFORT);
    expect(STANDARD_EFFORT).toBe("medium");
  });

  it.each(GILTIGA_EFFORT)("accepterar det giltiga värdet %s och returnerar det oförändrat", (varde) => {
    expect(valideraEffort("ANTHROPIC_EFFORT_EXTRACTION", varde)).toBe(varde);
  });

  it("kastar för ett ogiltigt värde", () => {
    expect(() => valideraEffort("ANTHROPIC_EFFORT_JUDGING", "turbo")).toThrow(
      /ANTHROPIC_EFFORT_JUDGING.*måste vara en av/,
    );
  });

  it("kastar för en TOM sträng — satt-men-tom är inte samma sak som frånvarande (paritet med lasEnv i src/server/env.ts, reviewer finding)", () => {
    // Deno.env.get returnerar "" (inte undefined) för en secret som är satt
    // till en tom sträng — precis den skillnaden Node-sidans lasEnv redan
    // gör via Zod (se env.test.ts: "kastar OgiltigMiljoError för ett TOMT
    // ANTHROPIC_EFFORT_EXTRACTION-värde"). Innan fixen behandlade den här
    // funktionens `if (!rått) return undefined` en tom sträng identiskt med
    // undefined (dvs. "använd default", inte "kasta").
    expect(() => valideraEffort("ANTHROPIC_EFFORT_GROUNDING", "")).toThrow(
      /ANTHROPIC_EFFORT_GROUNDING.*måste vara en av/,
    );
  });

  it("felmeddelandet radar upp alla giltiga värden och nämner det ogiltiga värdet ordagrant", () => {
    try {
      valideraEffort("ANTHROPIC_EFFORT_GROUNDING", "snabb");
      expect.fail("skulle ha kastat");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      for (const giltigt of GILTIGA_EFFORT) {
        expect(message).toContain(giltigt);
      }
      expect(message).toContain('"snabb"');
    }
  });
});
