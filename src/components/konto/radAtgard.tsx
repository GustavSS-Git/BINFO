import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Åtgärder på en rad i kontolistorna (redesign v4): sekundärknapp, textknapp, farlig textknapp. */

const bas =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-sm text-[15px] font-semibold transition-colors";

export const RAD_KNAPP = cn(
  bas,
  "border border-input bg-card px-[18px] text-primary hover:bg-tint",
);
export const RAD_TEXT = cn(bas, "px-2.5 text-primary hover:bg-tint");
export const RAD_FARA = cn(bas, "px-2.5 text-grade-e hover:bg-danger-tint");

function Ikon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

export function PapperskorgIkon() {
  return (
    <Ikon>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3" />
    </Ikon>
  );
}

export function NedladdningIkon() {
  return (
    <Ikon>
      <path d="M12 4v11M7 10l5 5 5-5" />
      <path d="M5 20h14" />
    </Ikon>
  );
}
