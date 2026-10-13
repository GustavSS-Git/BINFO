import { useRouter } from "@tanstack/react-router";
import { medSparaParam, saneraTill, type SparaTyp } from "@/lib/till";

/** Navigerar till en sanerad `till`-sökväg (bara den egna sajten), ev. med `?spara=`. */
export function useGaTill() {
  const router = useRouter();
  return (till: unknown, spara?: SparaTyp, reserv = "/konto") => {
    router.history.push(medSparaParam(saneraTill(till, reserv), spara));
  };
}
