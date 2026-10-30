import { useState } from "react";
import { NedladdningIkon, RAD_TEXT } from "@/components/konto/radAtgard";
import { hamtaSparadKalkylFn } from "@/server/analysFn";
import type { HamtaSparadKalkylSvar } from "@/lib/kontoTyper";
import type { KalkylUnderlag } from "@/lib/kalkyl/underlag";

export type ExportVag = "pdf" | "excel";

/** `vilar`: klar att klicka. `pdf`/`excel`: filen skapas. `ejStod`: det sparade
 *  formatet är okänt, inget går att exportera. `fel`: hämtning/skapande misslyckades. */
export type ExportLage =
  | { typ: "vilar" }
  | { typ: "pdf" | "excel" }
  | { typ: "ejStod" }
  | { typ: "fel"; meddelande: string };

export const EJ_STOD_TEXT =
  "Den här kalkylen sparades i ett format som inte längre stöds, så den kan inte laddas ner. Du kan fortfarande radera den.";
export const EXPORT_FEL_TEXT =
  "Det gick inte att skapa filen just nu. Försök igen om en liten stund.";

/** Hämtar den sparade kalkylen och skapar filen. Kastar aldrig: resultatet är nästa läge. */
export async function exporteraSparadKalkyl(args: {
  id: string;
  etikett: string | null;
  vag: ExportVag;
  hamta: (id: string) => Promise<HamtaSparadKalkylSvar>;
  ladda: (vag: ExportVag, underlag: KalkylUnderlag, etikett: string | undefined) => Promise<void>;
}): Promise<ExportLage> {
  try {
    const svar = await args.hamta(args.id);
    if (!svar.ok) return { typ: "fel", meddelande: svar.meddelande };
    const underlag = svar.kalkyl.underlag;
    if (underlag === null) return { typ: "ejStod" };
    await args.ladda(args.vag, underlag, args.etikett ?? undefined);
    return { typ: "vilar" };
  } catch (error) {
    console.error("[SparadKalkylExport] export misslyckades:", error);
    return { typ: "fel", meddelande: EXPORT_FEL_TEXT };
  }
}

/** Ren vy: PDF- och Excel-knappar för en sparad kalkyl. */
export function SparadKalkylExportVy({
  lage,
  onKlick,
}: {
  lage: ExportLage;
  onKlick: (vag: ExportVag) => void;
}) {
  const upptagen = lage.typ === "pdf" || lage.typ === "excel";
  const avstangd = upptagen || lage.typ === "ejStod";
  return (
    <>
      <button
        type="button"
        className={`${RAD_TEXT} disabled:cursor-not-allowed disabled:text-muted-foreground`}
        disabled={avstangd}
        onClick={() => onKlick("pdf")}
      >
        <NedladdningIkon />
        {lage.typ === "pdf" ? "Skapar PDF…" : "PDF"}
      </button>
      <button
        type="button"
        className={`${RAD_TEXT} disabled:cursor-not-allowed disabled:text-muted-foreground`}
        disabled={avstangd}
        onClick={() => onKlick("excel")}
      >
        <NedladdningIkon />
        {lage.typ === "excel" ? "Skapar Excel…" : "Excel"}
      </button>
      {lage.typ === "ejStod" ? (
        <p className="basis-full text-sm text-muted-foreground">{EJ_STOD_TEXT}</p>
      ) : null}
      {lage.typ === "fel" ? (
        <p className="basis-full text-sm text-danger-text" role="alert">
          {lage.meddelande}
        </p>
      ) : null}
    </>
  );
}

async function laddaFil(
  vag: ExportVag,
  underlag: KalkylUnderlag,
  etikett: string | undefined,
): Promise<void> {
  // Build-time guard: i SSR-bygget är `import.meta.env.SSR` literalen `true`, så
  // den dynamiska importen nedan är död kod och varken @react-pdf eller exceljs
  // hamnar i Worker-paketet (samma mönster som KalkylExport).
  if (import.meta.env.SSR) return;
  const mod = await import("@/components/pdf/downloadKalkyl");
  if (vag === "pdf") await mod.laddaNerKalkylPdf(underlag, etikett);
  else await mod.laddaNerKalkylExcel(underlag, etikett);
}

/** PDF/Excel för en rad i profilens kalkyllista: hämtar kalkylen först när man klickar. */
export function SparadKalkylExport({ id, etikett }: { id: string; etikett: string | null }) {
  const [lage, setLage] = useState<ExportLage>({ typ: "vilar" });
  const onKlick = async (vag: ExportVag) => {
    if (lage.typ === "pdf" || lage.typ === "excel") return;
    setLage({ typ: vag });
    setLage(
      await exporteraSparadKalkyl({
        id,
        etikett,
        vag,
        hamta: (i) => hamtaSparadKalkylFn({ data: { id: i } }),
        ladda: laddaFil,
      }),
    );
  };
  return <SparadKalkylExportVy lage={lage} onKlick={(v) => void onKlick(v)} />;
}
