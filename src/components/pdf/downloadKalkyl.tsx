import { pdf } from "@react-pdf/renderer";
import { registerPdfFonts } from "@/components/pdf/fonts";
import { KalkylPdfDocument } from "@/components/pdf/KalkylPdfDocument";
import { buildKalkylViewModel, kalkylFilnamn } from "@/components/pdf/kalkylViewModel";
import type { KalkylUnderlag } from "@/lib/kalkyl/underlag";

/**
 * Bolånekalkylens PDF- och Excel-export i webbläsaren. Importerar
 * @react-pdf/renderer (statiskt) och exceljs (dynamiskt) med flit: modulen får
 * BARA nås via `import("@/components/pdf/downloadKalkyl")` från en
 * knapptryckning, så att Vite delar upp den i egna chunkar och Worker/SSR-grafen
 * förblir fri från dem.
 */
function sparaFil(blob: Blob, filnamn: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filnamn;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Safari kan avbryta en nedladdning vars blob-URL återkallas direkt.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

/** Exporterar en kalkyl (nu eller en sparad) som PDF. */
export async function laddaNerKalkylPdf(underlag: KalkylUnderlag, etikett?: string): Promise<void> {
  registerPdfFonts();
  const vm = buildKalkylViewModel(underlag, etikett !== undefined ? { etikett } : {});
  const blob = await pdf(<KalkylPdfDocument vm={vm} />).toBlob();
  sparaFil(blob, kalkylFilnamn("pdf"));
}

/** Exporterar en kalkyl (nu eller en sparad) som Excel med levande formler. */
export async function laddaNerKalkylExcel(
  underlag: KalkylUnderlag,
  etikett?: string,
): Promise<void> {
  const { skapaKalkylXlsx } = await import("@/lib/kalkyl/xlsx");
  const bytes = await skapaKalkylXlsx(underlag, etikett !== undefined ? { etikett } : {});
  const blob = new Blob([bytes as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  sparaFil(blob, kalkylFilnamn("xlsx"));
}
