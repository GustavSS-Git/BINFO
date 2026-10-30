import type { ReactNode } from "react";
import { Eyebrow } from "@/components/ui/binfo";
import { cn } from "@/lib/utils";

/**
 * Gemensam ram för kontosidorna (redesign v4): formulärkort till vänster med
 * versalrubrik, serifrubrik och ingress, en sidoruta (`aside`) till höger.
 * Staplas på mobil.
 */
export function AuthSida({
  eyebrow,
  title,
  lead,
  aside,
  children,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  /** Sidoruta, vanligen `<AuthAside …/>`. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-start justify-center gap-8 px-4 pb-24 pt-10 sm:px-8 md:pt-16">
      <div className="flex w-full flex-col gap-[18px] rounded-lg border border-border bg-card p-5 sm:p-9 md:max-w-[460px] md:flex-[0_1_460px]">
        <header className="flex flex-col gap-1.5">
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          <h1 className="font-display text-[30px] font-semibold leading-[1.15] text-primary md:text-4xl">
            {title}
          </h1>
          {lead ? <p className="text-[15px] text-text-2">{lead}</p> : null}
        </header>
        {children}
      </div>
      {aside !== undefined ? (
        <aside className="flex w-full flex-col gap-4 pt-2 md:max-w-[380px] md:flex-[0_1_380px]">
          {aside}
        </aside>
      ) : null}
    </div>
  );
}

/** Innehåll i sidorutan: rubrik, punktlista och en avslutande not. */
export function AuthAside({
  rubrik,
  punkter,
  not,
}: {
  rubrik: string;
  punkter: readonly ReactNode[];
  not?: ReactNode;
}) {
  return (
    <>
      <h2 className="text-[19px] font-semibold leading-snug text-foreground">{rubrik}</h2>
      <ul className="flex list-disc flex-col gap-2 pl-5 text-[15px] text-text-2">
        {punkter.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
      {not !== undefined ? <p className="text-sm text-muted-foreground">{not}</p> : null}
    </>
  );
}

/** Länkstil i löpande text på kontosidorna. */
export const TEXTLANK = "font-medium text-link underline underline-offset-2";

/** En länk som ser ut som kitets sekundärknapp (för `<Link>` med `search`). */
export const LANKKNAPP_SEKUNDAR =
  "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-sm border border-input bg-card px-5 text-base font-semibold text-primary transition-colors hover:bg-tint";

/** Felruta. Serverns text visas ordagrant. */
export function FelRuta({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-danger-border bg-danger-tint p-4 text-[15px] text-danger-text",
        className,
      )}
      role="alert"
    >
      {children}
    </div>
  );
}

/** Bekräftelseruta (neutral), t.ex. "Sparad". */
export function InfoRuta({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-input bg-tint p-4 text-[15px] text-text-2",
        className,
      )}
      role="status"
    >
      <div className="space-y-2">{children}</div>
    </div>
  );
}
