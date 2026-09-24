import { pdf } from "@react-pdf/renderer";
import { AnalysPdfDocument } from "@/components/pdf/AnalysPdfDocument";
import { buildPdfFilename } from "@/components/pdf/filename";
import { registerPdfFonts } from "@/components/pdf/fonts";
import type { AnalysisResult } from "@/types/analysis";

/**
 * Renders the full analysis to a PDF in the browser and triggers a file
 * download. This module statically imports @react-pdf/renderer (a sizeable
 * dependency) on purpose — it must ONLY ever be reached via a dynamic
 * `import("@/components/pdf/download")` from the "Ladda ner som PDF" button
 * (see AnalysRapport.tsx), never a static import, so Vite code-splits it
 * into its own chunk that loads on click instead of bloating the main
 * bundle or running during SSR.
 */
export async function downloadAnalysPdf(analys: AnalysisResult): Promise<void> {
  registerPdfFonts();
  const instance = pdf(<AnalysPdfDocument analys={analys} />);
  const blob = await instance.toBlob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = buildPdfFilename(analys);
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Revoke a little later: Safari can abort a download whose blob URL is
    // revoked in the same tick as the click.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}
