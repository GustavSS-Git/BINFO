import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { hamtaKopguideFn, sparaKopguideFn } from "@/server/analysFn";
import { useSession } from "@/lib/session";
import { normaliseraKlara, slaSamman } from "./framsteg";
import {
  lasLokalaKlara,
  lasSammanslagenMed,
  skrivLokalaKlara,
  skrivSammanslagenMed,
} from "./lagring";

export const KOPGUIDE_KEY = ["kopguide"] as const;

const SPARFEL_TEXT = "Det gick inte att spara ditt framsteg just nu. Försök igen om en stund.";

function likaLista(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Köpguidens avbockade steg.
 * - Utloggad (eller medan sessionen laddar): bara localStorage.
 * - Inloggad: första gången den här webbläsaren loggar in på kontot slås lokala
 *   och sparade steg ihop (union) och sparas en gång om det skiljer sig från
 *   kontot. Därefter går ändringar till servern (direkt i vyn; återställs med
 *   `sparFel` om sparandet misslyckas) och speglas till localStorage.
 */
export function useKopguide() {
  const { lage, session } = useSession();
  const qc = useQueryClient();
  const principalId = session?.inloggad ? session.principalId : null;

  const [klara, setKlaraState] = useState<string[]>([]);
  const [lokalLast, setLokalLast] = useState(false);
  const [serverKlar, setServerKlar] = useState(false);
  const [sparFel, setSparFel] = useState<string | null>(null);
  const klaraRef = useRef<string[]>([]);
  const serverAktiv = useRef(false);
  const kedja = useRef<Promise<unknown>>(Promise.resolve());
  const lopnummer = useRef(0);

  const satt = useCallback((ny: string[]) => {
    klaraRef.current = ny;
    setKlaraState(ny);
  }, []);

  useEffect(() => {
    satt(lasLokalaKlara());
    setLokalLast(true);
  }, [satt]);

  const q = useQuery({
    queryKey: KOPGUIDE_KEY,
    queryFn: () => hamtaKopguideFn(),
    enabled: lage === "inloggad",
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  useEffect(() => {
    if (lage !== "inloggad") {
      serverAktiv.current = false;
      setServerKlar(false);
      return;
    }
    if (!lokalLast || principalId === null) return;
    if (q.isError || (q.data !== undefined && !q.data.ok)) {
      // Offline eller felsvar: arbeta lokalt, sluta vänta.
      setServerKlar(true);
      return;
    }
    if (q.data === undefined || !q.data.ok) return;

    const server = normaliseraKlara(q.data.klara);
    if (lasSammanslagenMed() !== principalId) {
      const union = slaSamman(klaraRef.current, server);
      satt(union);
      skrivLokalaKlara(union);
      if (likaLista(union, server)) {
        skrivSammanslagenMed(principalId);
        serverAktiv.current = true;
        setServerKlar(true);
      } else {
        void sparaKopguideFn({ data: { klara: union } })
          .then((svar) => {
            if (svar.ok) {
              qc.setQueryData(KOPGUIDE_KEY, { ok: true as const, klara: union });
              skrivSammanslagenMed(principalId);
              serverAktiv.current = true;
            } else {
              setSparFel(SPARFEL_TEXT);
            }
          })
          .catch(() => setSparFel(SPARFEL_TEXT))
          .finally(() => setServerKlar(true));
      }
    } else {
      satt(server);
      skrivLokalaKlara(server);
      serverAktiv.current = true;
      setServerKlar(true);
    }
    // `q.data` byts ut vid varje lyckad sparning; sammanslagningen ska bara
    // köras för den första hämtningen per montering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lage, lokalLast, principalId, q.isError, q.data === undefined]);

  const vaxla = useCallback(
    (id: string) => {
      const fore = klaraRef.current;
      const ny = normaliseraKlara(fore.includes(id) ? fore.filter((x) => x !== id) : [...fore, id]);
      if (likaLista(ny, fore)) return;
      setSparFel(null);
      satt(ny);
      skrivLokalaKlara(ny);
      if (!serverAktiv.current) return;

      const nummer = ++lopnummer.current;
      const aterstall = () => {
        if (lopnummer.current !== nummer) return;
        satt(fore);
        skrivLokalaKlara(fore);
        setSparFel(SPARFEL_TEXT);
      };
      kedja.current = kedja.current.then(async () => {
        try {
          const svar = await sparaKopguideFn({ data: { klara: ny } });
          if (svar.ok) qc.setQueryData(KOPGUIDE_KEY, { ok: true as const, klara: ny });
          else aterstall();
        } catch {
          aterstall();
        }
      });
    },
    [qc, satt],
  );

  const laddar = !lokalLast || lage === "laddar" || (lage === "inloggad" && !serverKlar);
  return { klara, laddar, vaxla, sparFel };
}
