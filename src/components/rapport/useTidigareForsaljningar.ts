import { useEffect, useState } from "react";
import { hamtaForsaljningarFn } from "@/server/analysFn";
import type { ForsaljningarSvar } from "@/lib/annons/forsaljningar";
import { kontrolleraAnnonsUrl } from "@/lib/annons/url";

/**
 * Laddar en lägenhets tidigare försäljningar (Booli) i webbläsaren, bara för en
 * `/bostad/`-länk. Fel och "inget att visa" ger null; sidan blockeras aldrig.
 */
export function useTidigareForsaljningar(url: string | undefined): ForsaljningarSvar | null {
  const [svar, setSvar] = useState<ForsaljningarSvar | null>(null);
  const kontroll = url ? kontrolleraAnnonsUrl(url) : null;
  const kanonisk = kontroll && kontroll.ok && kontroll.typ === "bostad" ? kontroll.url : null;

  useEffect(() => {
    setSvar(null);
    if (!kanonisk) return;
    let avbruten = false;
    hamtaForsaljningarFn({ data: { url: kanonisk } })
      .then((s) => {
        if (!avbruten) setSvar(s as ForsaljningarSvar);
      })
      .catch(() => {
        if (!avbruten) setSvar(null);
      });
    return () => {
      avbruten = true;
    };
  }, [kanonisk]);

  return svar;
}
