import type { PropertyType } from "@/data/mockData";
import { synligaSteg } from "@/lib/kopguide/framsteg";

/** Vilket steg som ska vara öppet efter att `id` markerats: bara när steget blev klart
 *  och var det öppna går det vidare till nästa synliga steg (inget om det var sist). */
export function oppnaEfterMarkering(
  typ: PropertyType,
  oppen: string | null,
  id: string,
  blevKlart: boolean,
): string | null {
  if (!blevKlart || oppen !== id) return oppen;
  const synliga = synligaSteg(typ);
  const index = synliga.findIndex((s) => s.id === id);
  return synliga[index + 1]?.id ?? null;
}
