import type { ReactNode } from "react";
import { Badge, Eyebrow } from "@/components/ui/binfo";
import { kr } from "@/data/mockData";
import { byggarMarkor, formatBoareaKort, formatSkapadDatum } from "@/lib/analysisView";
import type { Faltjamforelse, PropertyInput } from "@/types/analysis";

/**
 * Rapportens huvud (redesign v4): "Rapport · analyserad <datum>", adressen som h1,
 * en rad med objektets uppgifter och åtgärdsknapparna (`children`). Det ÄR sidans
 * rubrik, så rapportsidorna lägger ingen egen PageHeader. Kräver sina props explicit
 * (inget prop-löst fallback-läge) så att ingen call-site av misstag kan råka rendera
 * exempeldata — se AnalysRapport.tsx för den enda call-siten.
 */
export function PropertySummary({
  input,
  foreningNamn,
  skapad,
  byggarJamforelse,
  omrade,
  children,
}: {
  input: PropertyInput;
  foreningNamn: string;
  skapad: string;
  /** Raden `falt === "byggar"` ur `uppgiftsjamforelse`; saknas på äldre resultat. */
  byggarJamforelse?: Faltjamforelse | undefined;
  /** Området värderingen gäller (modellens område, annars kommunen). */
  omrade?: string | undefined;
  /** Åtgärdsknapparna (PDF, Spara, kalkyl). */
  children?: ReactNode;
}) {
  const byggar = byggarMarkor(byggarJamforelse, input.byggar);
  // Adressen rensas efter 12 månader (GDPR); rapporten finns kvar och rubriken blir föreningens namn.
  const adressKvar = input.adress !== "";
  const byggarDel =
    byggar.varde === "Okänt"
      ? undefined
      : byggar.markor?.text === "Värdeår enligt årsredovisningen"
        ? `värdeår ${byggar.varde} enligt årsredovisningen`
        : byggar.markor?.text === "Från årsredovisningen"
          ? `byggår ${byggar.varde} enligt årsredovisningen`
          : `byggår ${byggar.varde}`;
  const delar = [
    adressKvar ? foreningNamn : undefined,
    omrade,
    `${input.antalRum} rum`,
    formatBoareaKort(input.boarea),
    input.vaning !== undefined ? `våning ${input.vaning}` : undefined,
    `avgift ${kr(input.manadsavgift)}/mån`,
    input.utgangspris !== undefined ? `utgångspris ${kr(input.utgangspris)}` : undefined,
    byggarDel,
  ].filter((d): d is string => d !== undefined);

  return (
    <header className="flex flex-wrap items-end justify-between gap-6">
      <div className="flex min-w-0 max-w-[820px] flex-1 basis-[480px] flex-col gap-2">
        <Eyebrow>Rapport · analyserad {formatSkapadDatum(skapad)}</Eyebrow>
        <h1 className="font-display text-[34px] font-semibold leading-[1.1] text-primary md:text-[44px]">
          {adressKvar ? input.adress : foreningNamn}
        </h1>
        <p
          className="text-[17px] text-text-2"
          {...(byggar.forklaring ? { title: byggar.forklaring } : {})}
        >
          {delar.join(" · ")}
        </p>
        {byggar.rad ? (
          <p className="flex flex-wrap items-center gap-2 text-sm text-text-2">
            {byggar.markor ? <Badge tone={byggar.markor.ton}>{byggar.markor.text}</Badge> : null}
            {byggar.rad}
            {byggar.forklaring ? <span className="sr-only">{byggar.forklaring}</span> : null}
          </p>
        ) : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2.5">{children}</div> : null}
    </header>
  );
}
