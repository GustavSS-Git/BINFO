import { Font } from "@react-pdf/renderer";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_FONT_SOURCES,
  FONT_SANS,
  FONT_SERIF,
  registerPdfFonts,
} from "@/components/pdf/fonts";
import { testFontSources } from "@/components/pdf/pdfTestFonts";

describe("registerPdfFonts", () => {
  beforeAll(async () => {
    registerPdfFonts(await testFontSources());
  });

  it("registers Inter (400, 600) and Source Serif 4 (600) from data: URLs", () => {
    expect(FONT_SANS).toBe("Inter");
    expect(FONT_SERIF).toBe("Source Serif 4");
    const registered = Font.getRegisteredFonts();
    expect(Object.keys(registered)).toEqual(expect.arrayContaining([FONT_SANS, FONT_SERIF]));
    // Resolving each weight proves the registration is usable (data: URLs, as in the tests).
    expect(Font.getFont({ fontFamily: FONT_SANS, fontWeight: 400 })).toBeDefined();
    expect(Font.getFont({ fontFamily: FONT_SANS, fontWeight: 600 })).toBeDefined();
    expect(Font.getFont({ fontFamily: FONT_SERIF, fontWeight: 600 })).toBeDefined();
  });

  it("serves the production sources as site-relative files in public/fonts", () => {
    expect(DEFAULT_FONT_SOURCES).toEqual({
      sans: { regular: "/fonts/Inter-Regular.ttf", semibold: "/fonts/Inter-SemiBold.ttf" },
      serif: { semibold: "/fonts/SourceSerif4-Semibold.ttf" },
    });
  });
});
