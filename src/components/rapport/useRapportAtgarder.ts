import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { bolanekalkylPris } from "@/lib/analysisView";
import {
  ingarForSok,
  veljRantekanslighetForSok,
  type BolanekalkylSearch,
} from "@/lib/bolanekalkyl";
import type { AnalysisResult } from "@/types/analysis";

/**
 * De två åtgärderna som rapporten erbjuder på flera ställen (huvudet och slutrutan):
 * ladda ner PDF och räkna vidare i bolånekalkylen med uppgifterna ur rapporten.
 */
export function useRapportAtgarder(analys: AnalysisResult) {
  const navigate = useNavigate();
  const [pdfStatus, setPdfStatus] = useState<"vilande" | "skapar" | "fel">("vilande");

  // Dynamically imported so @react-pdf/renderer (and the PDF document tree)
  // only ever loads when the user actually clicks the button — it must
  // never enter the page's main bundle or run during SSR (see
  // src/components/pdf/download.tsx).
  const hamtaPdf = async () => {
    // Build-time guard: in the SSR build `import.meta.env.SSR` is the literal
    // `true`, so the dynamic import below is dead code and @react-pdf never
    // enters the server bundle. Without it, PDFKit's top-level
    // `new URL(..., import.meta.url)` ended up in a server chunk shared with
    // pdf.js and crashed uploads on Cloudflare Workers ("Invalid URL string")
    // for PDFs whose fonts make pdf.js load that chunk.
    if (import.meta.env.SSR) return;
    setPdfStatus("skapar");
    try {
      const { downloadAnalysPdf } = await import("@/components/pdf/download");
      await downloadAnalysPdf(analys);
      setPdfStatus("vilande");
    } catch (error) {
      console.error("PDF-export misslyckades", error);
      setPdfStatus("fel");
    }
  };

  // Förifyllning av bolånekalkylen: det VISADE värdet (Binfos värdering) hellre än
  // utgångspriset, men en uppskattning ('schablon') får aldrig se ut som ett fastställt
  // pris — det flaggas separat så kalkylsidan kan säga "uppskattning". Vad avgiften
  // täcker tas från årsredovisningen (de poster den uttalar sig om).
  const bolanekalkylSearch: BolanekalkylSearch = {
    manadsavgift: analys.rantestress.nuvarandeManadsavgift.value ?? undefined,
    rantekanslighet: veljRantekanslighetForSok(analys.rantestress.rantekanslighetProcent),
    pris: bolanekalkylPris(analys.prisanalys),
    boarea: analys.input.boarea,
    prisUppskattning:
      analys.prisanalys.externVardering !== undefined &&
      analys.prisanalys.externVardering.source === "schablon"
        ? true
        : undefined,
    ...ingarForSok(analys.forening.avgiftInkluderarEnligtForening),
  };

  const tillKalkyl = () => void navigate({ to: "/bolanekalkyl", search: bolanekalkylSearch });

  return { pdfStatus, hamtaPdf, tillKalkyl };
}
