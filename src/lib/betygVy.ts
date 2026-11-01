/**
 * Fixed short titles per grade (owner 2026-10-28, redesign v4 Q6). Shown in
 * the report's summary card, on /brf/$slug and in the landing example. The
 * grade itself comes from the judging step; these words never change it.
 */
import type { Grade } from "@/types/analysis";

export const BETYG_TITEL: Record<Grade, string> = {
  A: "Stark ekonomi",
  B: "Stabil ekonomi",
  C: "Godtagbar, med svagheter",
  D: "Svag ekonomi",
  E: "Mycket svag ekonomi",
};
