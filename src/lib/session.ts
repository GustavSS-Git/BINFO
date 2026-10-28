import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { hamtaSessionFn } from "@/server/analysFn";
import type { SessionSvar } from "@/lib/kontoTyper";
import { sessionLage, type SessionLage } from "@/lib/till";

/** Frågenyckeln för "vem är inloggad". Cookies är httpOnly: webbläsaren kan bara
 *  fråga servern via `hamtaSessionFn`. */
export const SESSION_KEY = ["session"] as const;
/** Frågenyckeln för kontots sparade objekt (profilen). */
export const SPARAT_KEY = ["sparat"] as const;

export function useSession() {
  const q = useQuery({
    queryKey: SESSION_KEY,
    queryFn: () => hamtaSessionFn(),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const lage: SessionLage = sessionLage({ data: q.data, isError: q.isError });
  return { lage, session: q.data, epost: q.data?.inloggad ? q.data.epost : null };
}

/** Efter lyckad inloggning: lägg in sessionen direkt (ingen blinkning) och
 *  ogiltigförklara allt kontobundet. */
export function sattInloggad(qc: QueryClient, epost: string, principalId: string) {
  const svar: SessionSvar = { inloggad: true, epost, principalId };
  qc.setQueryData(SESSION_KEY, svar);
  void qc.invalidateQueries({ queryKey: SPARAT_KEY });
  qc.removeQueries({ queryKey: ["kopguide"] });
}

/** Efter utloggning eller raderat konto. */
export function sattUtloggad(qc: QueryClient) {
  const svar: SessionSvar = { inloggad: false };
  qc.setQueryData(SESSION_KEY, svar);
  qc.removeQueries({ queryKey: SPARAT_KEY });
  qc.removeQueries({ queryKey: ["kopguide"] });
}

export function useSessionAtgarder() {
  const qc = useQueryClient();
  return {
    sattInloggad: (epost: string, principalId: string) => sattInloggad(qc, epost, principalId),
    sattUtloggad: () => sattUtloggad(qc),
    uppdatera: () => qc.invalidateQueries({ queryKey: SESSION_KEY }),
  };
}
