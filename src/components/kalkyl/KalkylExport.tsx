import { useState } from "react";
import { Button } from "@/components/ui/binfo";
import type { KalkylUnderlag } from "@/lib/kalkyl/underlag";

type Status = "vilar" | "pdf" | "excel" | "fel";

/** Minsta uppgifter för att en export ska vara meningsfull. */
function kanExportera(u: KalkylUnderlag): boolean {
  return u.pris !== undefined && u.rantaProcent !== undefined;
}

export function KalkylExport({
  underlag,
  etikett,
}: {
  underlag: KalkylUnderlag;
  etikett?: string;
}) {
  const [status, setStatus] = useState<Status>("vilar");
  const klar = kanExportera(underlag);
  const upptagen = status === "pdf" || status === "excel";

  async function kor(vag: "pdf" | "excel") {
    // Build-time guard (same as AnalysRapport's PDF button): in the SSR build
    // `import.meta.env.SSR` is the literal `true`, so the dynamic import below
    // is dead code and neither @react-pdf nor exceljs enters the Worker bundle.
    if (import.meta.env.SSR) return;
    setStatus(vag);
    try {
      // Dynamisk import: @react-pdf och exceljs ska inte hamna i huvudbundlen eller SSR.
      const mod = await import("@/components/pdf/downloadKalkyl");
      if (vag === "pdf") await mod.laddaNerKalkylPdf(underlag, etikett);
      else await mod.laddaNerKalkylExcel(underlag, etikett);
      setStatus("vilar");
    } catch {
      setStatus("fel");
    }
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Button
          variant="secondary"
          className="w-full"
          disabled={!klar || upptagen}
          onClick={() => void kor("pdf")}
        >
          {status === "pdf" ? "Skapar PDF…" : "Ladda ner PDF"}
        </Button>
        <Button
          variant="secondary"
          className="w-full"
          disabled={!klar || upptagen}
          onClick={() => void kor("excel")}
        >
          {status === "excel" ? "Skapar Excel…" : "Ladda ner Excel"}
        </Button>
      </div>
      {!klar ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Fyll i pris och ränta för att kunna ladda ner kalkylen.
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Excel-filen har levande formler: ändra värdena på bladet Indata så räknas allt om.
        </p>
      )}
      {status === "fel" ? (
        <p className="mt-2 text-sm text-danger-text" role="alert">
          Det gick inte att skapa filen just nu. Försök igen om en liten stund.
        </p>
      ) : null}
    </div>
  );
}
