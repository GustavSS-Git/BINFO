import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PdfFontSources } from "@/components/pdf/fonts";

/**
 * Test/script support: the on-disk TTFs in public/fonts as base64 data: URLs.
 * Node's fetch (used by react-pdf's font loader outside a browser) resolves
 * neither site-relative "/fonts/…" paths nor file: URLs, but it does resolve
 * data: URLs. Only imported by tests and scripts, never by the app.
 */
const fontsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../public/fonts",
);

async function dataUrl(file: string): Promise<string> {
  const buffer = await readFile(path.join(fontsDir, file));
  return `data:font/ttf;base64,${buffer.toString("base64")}`;
}

export async function testFontSources(): Promise<PdfFontSources> {
  return {
    sans: {
      regular: await dataUrl("Inter-Regular.ttf"),
      semibold: await dataUrl("Inter-SemiBold.ttf"),
    },
    serif: { semibold: await dataUrl("SourceSerif4-Semibold.ttf") },
  };
}
