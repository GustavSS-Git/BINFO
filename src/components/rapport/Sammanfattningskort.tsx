import type { ReactNode } from "react";
import { GradeBadge, GradeScale } from "@/components/ui/binfo";
import {
  avgiftKort,
  avrundaVardering,
  forstaMening,
  lageMotVardespann,
  visatVarde,
} from "@/lib/analysisView";
import { BETYG_TITEL } from "@/lib/betygVy";
import { formatMkr, formatSpannMkr, vanligtBud } from "@/lib/prisVy";
import type { AnalysisResult } from "@/types/analysis";

const LAGE_TEXT = { under: "under spannet", inom: "inom spannet", over: "över spannet" } as const;

/** Ett av de tre korten överst i rapporten: ankarlänk till sitt avsnitt. */
function Kort({
  href,
  rubrik,
  lank,
  children,
}: {
  href: string;
  rubrik: string;
  lank: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className="flex min-w-0 flex-col rounded-lg border border-border border-t-[3px] border-t-primary bg-card px-7 py-6 text-foreground no-underline hover:bg-tint/40"
    >
      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {rubrik}
      </span>
      {children}
      <span className="mt-auto pt-4">
        <span className="flex border-t border-divider pt-3 text-sm font-semibold text-link">
          {lank}
        </span>
      </span>
    </a>
  );
}

const STORT_TAL =
  "mt-3.5 flex min-h-10 items-end gap-3.5 font-display text-4xl font-semibold leading-none text-primary tabular-nums";
const RAD2 = "mt-3 text-[15px] font-semibold text-foreground tabular-nums";
const TEXT = "mt-1.5 text-[15px] leading-normal text-text-2";

export function Sammanfattningskort({ analys }: { analys: AnalysisResult }) {
  const p = analys.prisanalys;
  const visat = visatVarde(p);
  const utgangspris = p.utgangspris?.value ?? null;
  const bud = vanligtBud(utgangspris, p.budpremie);
  const lage = visat && utgangspris !== null ? lageMotVardespann(utgangspris, visat.exakt) : null;
  const prisText = !visat
    ? "Postnumret saknas eller är ogiltigt, så lägenheten kan inte värderas."
    : lage === null || utgangspris === null
      ? "Du angav inget utgångspris, så vi jämför inte priset mot spannet."
      : `Utgångspriset ${formatMkr(utgangspris, 2)} ligger ${LAGE_TEXT[lage]}.${
          bud !== null ? ` Ett vanligt bud i området landar runt ${formatMkr(bud, 2)}.` : ""
        }`;
  const avgift = avgiftKort(analys.avgiftsprognos, analys.rantestress.nuvarandeManadsavgift.value);

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Kort href="#foreningen" rubrik="Föreningen" lank="Föreningen →">
        <div className="mt-3.5 flex min-h-10 items-end gap-3.5">
          <GradeBadge grade={analys.betyg} size="md" />
          <GradeScale grade={analys.betyg} className="mb-0.5" />
        </div>
        <span className={RAD2}>{BETYG_TITEL[analys.betyg]}</span>
        <p className={TEXT}>{forstaMening(analys.betygMotivering)}</p>
      </Kort>

      <Kort href="#priset" rubrik="Binfos värdering" lank="Priset →">
        <div className={STORT_TAL}>
          {visat ? `ca ${formatMkr(avrundaVardering(visat.exakt))}` : "Ingen värdering"}
        </div>
        {visat ? <span className={RAD2}>Spann {formatSpannMkr(visat.exakt)}</span> : null}
        <p className={TEXT}>{prisText}</p>
      </Kort>

      <Kort href="#avgiften" rubrik="Avgiften framåt" lank="Avgiften →">
        <div className={STORT_TAL}>{avgift.varde}</div>
        {avgift.rad ? <span className={RAD2}>{avgift.rad}</span> : null}
        <p className={TEXT}>{avgift.text}</p>
      </Kort>
    </div>
  );
}
