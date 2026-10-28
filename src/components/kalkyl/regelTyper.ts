import type { PillTone } from "@/components/ui/binfo";
import { REGLER, type Regel, type RegelGrupp, type RegelStatus } from "@/lib/kalkyl/regler";

/**
 * Hur registrets fyra statusar visas för köparen. "Regel" betyder lag eller myndighetsbeslut
 * (faststalld). Ett publicerat värde med offentlig källa som inte är en regel (referens, t.ex.
 * Konsumentverket eller Nils Holgersson) är ett "Referensvärde", inte Binfos gissning.
 * "Uppskattning" är bara Binfos egen schablon utan publicerad källa.
 */
export const REGELTYP: Record<RegelStatus, { etikett: string; ton: PillTone }> = {
  faststalld: { etikett: "Regel", ton: "info" },
  referens: { etikett: "Referensvärde", ton: "success" },
  antagande: { etikett: "Antagande", ton: "neutral" },
  schablon: { etikett: "Uppskattning", ton: "warning" },
};

export const regelTyp = (status: RegelStatus) => REGELTYP[status];

const GRUPPER: readonly RegelGrupp[] = [
  "Bolån och amortering",
  "Ränteavdrag",
  "Skatt 2026",
  "Levnadskostnader (KALP)",
  "Antaganden",
  "Drift (schabloner)",
];

/** Konsumentverkets alla tabellvärden (kv_*) visas inte rad för rad; länken längst ned räcker. */
export const visasIRegeltabell = (r: Regel) => !r.id.startsWith("kv_");

export interface RegelGruppVy {
  grupp: RegelGrupp;
  regler: Regel[];
}

export function regelGrupper(regler: readonly Regel[] = REGLER): RegelGruppVy[] {
  return GRUPPER.map((grupp) => ({
    grupp,
    regler: regler.filter((r) => r.grupp === grupp && visasIRegeltabell(r)),
  })).filter((g) => g.regler.length > 0);
}

/** Senaste kontrolldatum (ISO) bland reglerna, eller null om ingen är kontrollerad. */
export function senastKontrollerad(regler: readonly Regel[]): string | null {
  let nyast: string | null = null;
  for (const r of regler) {
    if (r.verifierad !== null && (nyast === null || r.verifierad > nyast)) nyast = r.verifierad;
  }
  return nyast;
}

const datumText = (iso: string) =>
  new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));

/** Meta efter rubriken: antal poster och senaste kontrolldatum. */
export function reglerMeta(regler: readonly Regel[]): string {
  const nyast = senastKontrollerad(regler);
  return nyast === null
    ? `${regler.length} st`
    : `${regler.length} st, kontrollerade ${datumText(nyast)}`;
}

export const varde = (r: Regel) =>
  typeof r.varde === "number" ? `${r.varde.toLocaleString("sv-SE")} ${r.enhet}` : r.varde;
