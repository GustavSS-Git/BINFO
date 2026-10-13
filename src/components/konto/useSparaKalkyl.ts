import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { hamtaSparadKalkylFn, sparaKalkylFn } from "@/server/analysFn";
import type { SparaKnappProps, SparaUtfall } from "@/components/konto/SparaKnapp";
import { useAterstallUtkast, type AterstallStatus } from "@/components/konto/useAterstallUtkast";
import type { SparaKalkylSvar } from "@/lib/kontoTyper";
import { KalkylUnderlagSchema, type KalkylUnderlag } from "@/lib/kalkyl/underlag";
import { skrivUtkast } from "@/lib/utkast";
import type { SparaTyp } from "@/lib/till";

/*
 * Spara-flödet för /bolanekalkyl, färdigt att kopplas in av den som äger
 * kalkylsidan. Använd så här i sidan:
 *
 *   const spara = useSparaKalkyl({ underlag, etikett });
 *   <SparaKnapp {...spara} />
 *
 *   const status = useAterstallKalkylUtkast({
 *     spara: search.spara,                  // validateSearch: parseSparaTyp(search.spara)
 *     aterstall: (u, etikett) => { sattAllaFalt(u); sattEtikett(etikett); return sparaKalkylAnrop({ underlag: u, etikett }); },
 *     rensaParam: () => navigate({ search: (s) => ({ ...s, spara: undefined }), replace: true }),
 *   });
 *
 * Öppna en sparad kalkyl: `/bolanekalkyl?sparad=<id>` och
 * `const k = useSparadKalkyl(search.sparad)` (se nedan).
 */

export interface SparaKalkylIndata {
  underlag: KalkylUnderlag;
  etikett?: string;
  /** Sätts för att uppdatera en redan sparad kalkyl. */
  id?: string;
}

export type SparaKalkylAnropTyp = (indata: SparaKalkylIndata) => Promise<SparaKalkylSvar>;

export const sparaKalkylAnrop: SparaKalkylAnropTyp = (data) => sparaKalkylFn({ data });

export const KalkylUtkastSchema = z
  .object({ underlag: KalkylUnderlagSchema, etikett: z.string().max(200) })
  .strict();

export function useSparaKalkyl(args: {
  underlag: KalkylUnderlag;
  etikett?: string;
  id?: string;
  anrop?: SparaKalkylAnropTyp;
}): Pick<SparaKnappProps, "typ" | "spara" | "skrivUtkast" | "etikettKnapp"> {
  const anrop = args.anrop ?? sparaKalkylAnrop;
  const etikett = args.etikett?.trim() ?? "";
  return {
    typ: "kalkyl",
    etikettKnapp: "Spara kalkylen",
    spara: () =>
      anrop({
        underlag: args.underlag,
        ...(etikett !== "" ? { etikett } : {}),
        ...(args.id !== undefined ? { id: args.id } : {}),
      }),
    skrivUtkast: () =>
      skrivUtkast(
        "kalkyl",
        { underlag: args.underlag, etikett },
        typeof window !== "undefined" ? window.location.pathname : "/bolanekalkyl",
      ),
  };
}

export function useAterstallKalkylUtkast(args: {
  spara: SparaTyp | undefined;
  /** Fyll i kalkylen med det sparade underlaget och spara (t.ex. via `sparaKalkylAnrop`). */
  aterstall: (underlag: KalkylUnderlag, etikett: string) => Promise<SparaUtfall>;
  rensaParam: () => void;
}): AterstallStatus {
  return useAterstallUtkast({
    typ: "kalkyl",
    spara: args.spara,
    schema: KalkylUtkastSchema,
    aterstall: (d) => args.aterstall(d.underlag, d.etikett),
    rensaParam: args.rensaParam,
  });
}

/** Hämtar en sparad kalkyl för `/bolanekalkyl?sparad=<id>`. `underlag` är null när
 *  det sparade formatet är okänt (visa tom kalkyl + notis). `ejInloggad` → skicka till
 *  `/konto/logga-in?till=/bolanekalkyl?sparad=<id>`. */
export function useSparadKalkyl(id: string | undefined) {
  const q = useQuery({
    queryKey: ["sparad-kalkyl", id],
    queryFn: () => hamtaSparadKalkylFn({ data: { id: id as string } }),
    enabled: id !== undefined,
    retry: false,
  });
  const svar = q.data;
  return {
    laddar: id !== undefined && q.isPending,
    fel: q.isError
      ? "Något gick fel. Försök igen om en stund."
      : svar !== undefined && !svar.ok
        ? svar.meddelande
        : null,
    ejInloggad: svar !== undefined && !svar.ok && svar.felKod === "ej_inloggad",
    hittadesInte: svar !== undefined && !svar.ok && svar.felKod === "hittades_inte",
    kalkyl: svar !== undefined && svar.ok ? svar.kalkyl : null,
    underlag: svar !== undefined && svar.ok ? svar.kalkyl.underlag : null,
  };
}
