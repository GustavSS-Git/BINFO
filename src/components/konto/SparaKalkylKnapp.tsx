import { SparaKnapp } from "@/components/konto/SparaKnapp";
import { useSparaKalkyl } from "@/components/konto/useSparaKalkyl";
import type { KalkylUnderlag } from "@/lib/kalkyl/underlag";

/** Färdig Spara-knapp för bolånekalkylen: `<SparaKalkylKnapp underlag={underlag} />`. */
export function SparaKalkylKnapp({
  underlag,
  etikett,
  id,
}: {
  underlag: KalkylUnderlag;
  etikett?: string;
  /** Sätts när en redan sparad kalkyl ska uppdateras. */
  id?: string;
}) {
  const props = useSparaKalkyl({
    underlag,
    ...(etikett !== undefined ? { etikett } : {}),
    ...(id !== undefined ? { id } : {}),
  });
  return <SparaKnapp {...props} till="/bolanekalkyl" />;
}
