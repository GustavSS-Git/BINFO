import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import type { SparaUtfall } from "@/components/konto/SparaKnapp";
import { GENERELLT_FEL } from "@/components/konto/kontoText";
import { useSession } from "@/lib/session";
import type { SparaTyp } from "@/lib/till";
import { lasUtkast, rensaUtkast } from "@/lib/utkast";

/**
 * - `ingen`: ingen väntande sparåtgärd (`?spara=` saknas).
 * - `kraver_inloggning`: `?spara=` finns men man är inte inloggad.
 * - `saknas`: inloggad, men utkastet är utgånget/borta (t.ex. redan sparat i en annan flik).
 * - `sparar` / `sparad` / `fel`: slutför sparandet.
 */
export type AterstallStatus =
  | { typ: "ingen" }
  | { typ: "kraver_inloggning" }
  | { typ: "saknas" }
  | { typ: "sparar" }
  | { typ: "sparad" }
  | { typ: "fel"; meddelande: string };

/**
 * Målsidans halva av Spara-flödet: när sidan öppnas med `?spara=<typ>` och man
 * är inloggad läses utkastet, TAS BORT (innan sparandet, så att en omladdning
 * eller en andra flik inte sparar två gånger), återställs i formuläret och
 * sparas en gång. `aterstall` får utkastets innehåll och ska fylla i
 * formuläret och spara.
 */
export function useAterstallUtkast<T>(opts: {
  typ: SparaTyp;
  /** Värdet på `?spara=` (undefined = inget att göra). */
  spara: SparaTyp | undefined;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  aterstall: (data: T) => Promise<SparaUtfall>;
  /** Tar bort `?spara=` ur adressen (replace) när åtgärden är klar. */
  rensaParam: () => void;
}): AterstallStatus {
  const { lage } = useSession();
  const [status, setStatus] = useState<AterstallStatus>({ typ: "ingen" });
  const klar = useRef(false);
  // Håll senaste callbacks utan att köra om effekten.
  const senaste = useRef(opts);
  senaste.current = opts;

  const aktiv = opts.spara === opts.typ;

  useEffect(() => {
    if (!aktiv || klar.current) return;
    if (lage === "laddar") return;
    if (lage === "utloggad") {
      setStatus({ typ: "kraver_inloggning" });
      return;
    }
    klar.current = true; // exakt en körning, även under StrictMode
    const o = senaste.current;
    const utkast = lasUtkast(o.typ, o.schema);
    rensaUtkast(o.typ);
    o.rensaParam();
    if (utkast === null) {
      setStatus({ typ: "saknas" });
      return;
    }
    setStatus({ typ: "sparar" });
    o.aterstall(utkast.data).then(
      (svar) =>
        setStatus(svar.ok ? { typ: "sparad" } : { typ: "fel", meddelande: svar.meddelande }),
      (error) => {
        console.error("[useAterstallUtkast] återställning kastade:", error);
        setStatus({ typ: "fel", meddelande: GENERELLT_FEL });
      },
    );
  }, [aktiv, lage]);

  return status;
}
