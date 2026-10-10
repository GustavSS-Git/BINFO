import { describe, expect, it } from "vitest";
import { FUNKTIONSSOKVAG, byggReinvokeUrl } from "./reinvoke.ts";

describe("byggReinvokeUrl", () => {
  it("är PROJECT_URL + /functions/v1/analys-steg (den publika vägen genom API-gatewayen)", () => {
    expect(FUNKTIONSSOKVAG).toBe("/functions/v1/analys-steg");
    expect(byggReinvokeUrl("https://abcdefgh.supabase.co")).toBe(
      "https://abcdefgh.supabase.co/functions/v1/analys-steg",
    );
    expect(byggReinvokeUrl("http://kong:8000")).toBe("http://kong:8000/functions/v1/analys-steg");
  });

  it("tål ett eller flera avslutande snedstreck och blanksteg", () => {
    expect(byggReinvokeUrl("http://kong:8000/")).toBe("http://kong:8000/functions/v1/analys-steg");
    expect(byggReinvokeUrl(" http://kong:8000//  ")).toBe(
      "http://kong:8000/functions/v1/analys-steg",
    );
  });

  it("lämnar en sökväg i PROJECT_URL orörd (men utan avslutande snedstreck)", () => {
    expect(byggReinvokeUrl("https://example.com/prefix/")).toBe(
      "https://example.com/prefix/functions/v1/analys-steg",
    );
  });

  it("kastar tydligt på en tom eller ogiltig URL i stället för att skapa en trasig adress", () => {
    expect(() => byggReinvokeUrl("")).toThrow(/PROJECT_URL/);
    expect(() => byggReinvokeUrl("   ")).toThrow(/PROJECT_URL/);
    expect(() => byggReinvokeUrl("kong:8000")).toThrow(/PROJECT_URL/);
    expect(() => byggReinvokeUrl("ftp://kong")).toThrow(/PROJECT_URL/);
  });
});
