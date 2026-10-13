import { Link } from "@tanstack/react-router";
import type { ReactNode, ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import type { Status, Tristate } from "@/data/mockData";
import type { Status as AnalysStatus } from "@/types/analysis";

/* Delade byggstenar för hela Binfo. Håll all styling här — inte i skärmarna. */

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-6 shadow-[0_1px_2px_color-mix(in_oklab,var(--foreground)_4%,transparent)] md:p-8",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-6">
      <h2 className="font-display text-2xl tracking-tight text-foreground md:text-3xl">
        {children}
      </h2>
      {hint ? <p className="mt-2 text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "lg";
};

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const buttonVariants: Record<string, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "border border-border bg-card text-foreground hover:bg-secondary",
  ghost: "text-primary hover:bg-secondary",
};

const buttonSizes: Record<string, string> = {
  md: "px-5 py-2.5 text-sm",
  lg: "px-7 py-3.5 text-base",
};

export function Button({ variant = "primary", size = "md", className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)}
      {...props}
    />
  );
}

export function LinkButton({
  to,
  children,
  variant = "primary",
  size = "md",
  className,
}: {
  to: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <Link to={to} className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)}>
      {children}
    </Link>
  );
}

/**
 * Två skalor lever sida vid sida: mockdatans green/amber/red och kontraktets
 * femgradiga Status (god/acceptabel/svag/kritisk/okant). StatusDot tar emot
 * båda så att skärmar kan flyttas över till kontraktet en i taget.
 *
 * "okant" har medvetet en egen, neutral grå ton — ett okänt värde får aldrig
 * se ut som ett omdöme, varken bra eller dåligt.
 */
const statusColors: Record<Status | AnalysStatus, string> = {
  green: "bg-success",
  amber: "bg-warning",
  red: "bg-danger",

  god: "bg-success",
  acceptabel: "bg-success/60",
  svag: "bg-warning",
  kritisk: "bg-danger",
  okant: "bg-muted-foreground/40",
};

const statusTextColors: Record<Status | AnalysStatus, string> = {
  green: "text-success",
  amber: "text-warning",
  red: "text-danger",

  god: "text-success",
  acceptabel: "text-success/70",
  svag: "text-warning",
  kritisk: "text-danger",
  okant: "text-muted-foreground",
};

/** Svensk etikett för skärmläsare — färgen ensam bär annars hela innebörden. */
const statusLabels: Record<Status | AnalysStatus, string> = {
  green: "God",
  amber: "Varning",
  red: "Kritisk",

  god: "God",
  acceptabel: "Acceptabel",
  svag: "Svag",
  kritisk: "Kritisk",
  okant: "Okänt",
};

export function StatusDot({
  status,
  className,
}: {
  status: Status | AnalysStatus;
  className?: string;
}) {
  return (
    <>
      <span
        className={cn(
          "inline-block size-2.5 shrink-0 rounded-full",
          statusColors[status],
          className,
        )}
        aria-hidden
      />
      <span className="sr-only">{statusLabels[status]}</span>
    </>
  );
}

export function StatusLabel({
  status,
  className,
}: {
  status: Status | AnalysStatus;
  className?: string;
}) {
  return (
    <span className={cn("block text-xs font-semibold", statusTextColors[status], className)}>
      {statusLabels[status]}
    </span>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "teal" | "warning" | "danger" | "success";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-secondary text-muted-foreground",
    teal: "bg-primary/10 text-primary",
    warning: "bg-warning/15 text-warning-foreground",
    danger: "bg-danger/10 text-danger",
    success: "bg-success/12 text-success",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Callout({
  variant,
  title,
  children,
}: {
  variant: "flag" | "tip";
  title: string;
  children: ReactNode;
}) {
  const styles =
    variant === "flag"
      ? "border-danger/25 bg-danger/[0.06]"
      : "border-primary/25 bg-primary/[0.05]";
  const titleColor = variant === "flag" ? "text-danger" : "text-primary";
  return (
    <div className={cn("rounded-lg border p-4", styles)}>
      <p className={cn("text-xs font-semibold uppercase tracking-wide", titleColor)}>{title}</p>
      <div className="mt-2 space-y-2 text-sm text-foreground/85">{children}</div>
    </div>
  );
}

export function Field({
  label,
  suffix,
  value,
  onChange,
  type = "number",
  placeholder,
  optional,
  hint,
  error,
  id,
  inputMode,
}: {
  label: string;
  suffix?: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  optional?: boolean;
  hint?: string;
  error?: string | null;
  /** Gives the input an id; hint/error text is then linked via aria-describedby. */
  id?: string;
  inputMode?: "text" | "decimal" | "numeric";
}) {
  const beskrivningsId = id !== undefined && (error || hint) ? `${id}-beskrivning` : undefined;
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
        {optional ? (
          <span className="ml-2 text-xs font-normal text-muted-foreground">(valfritt)</span>
        ) : null}
      </span>
      <div
        className={cn(
          "flex items-center rounded-lg border bg-background focus-within:border-primary",
          error ? "border-danger" : "border-input",
        )}
      >
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          {...(id !== undefined ? { id } : {})}
          {...(inputMode !== undefined ? { inputMode } : {})}
          {...(error ? { "aria-invalid": true } : {})}
          {...(beskrivningsId !== undefined ? { "aria-describedby": beskrivningsId } : {})}
          className="w-full rounded-lg bg-transparent px-4 py-2.5 text-sm text-foreground outline-none"
        />
        {suffix ? <span className="pr-4 text-sm text-muted-foreground">{suffix}</span> : null}
      </div>
      {error ? (
        <span id={beskrivningsId} className="mt-1.5 block text-xs text-danger">
          {error}
        </span>
      ) : hint ? (
        <span id={beskrivningsId} className="mt-1.5 block text-xs text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

/** Flervalsknappar (t.ex. vad som ingår i avgiften). */
export function ChipGroup({
  options,
  values,
  onToggle,
}: {
  options: { value: string; label: string }[];
  values: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = values.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(o.value)}
            className={cn(
              "rounded-full border px-4 py-2 text-sm font-medium transition-colors",
              active
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Tre lägen för osäkra uppgifter. "Vet ej" är förvalt och hålls visuellt
 * neutralt och nedtonat — det ska inte kännas som ett fel att välja det.
 */
export function TristateChoice({
  value,
  onChange,
  labels = { ja: "Ja", nej: "Nej" },
  id,
}: {
  value: Tristate;
  onChange: (v: Tristate) => void;
  labels?: { ja: string; nej: string };
  id?: string;
}) {
  const options: { value: Tristate; label: string }[] = [
    { value: "ja", label: labels.ja },
    { value: "nej", label: labels.nej },
    { value: "okant", label: "Vet ej" },
  ];
  return (
    <div id={id} className="inline-flex rounded-lg border border-border bg-secondary p-1">
      {options.map((o) => {
        const active = value === o.value;
        const okant = o.value === "okant";
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-md px-4 py-2 text-sm transition-colors",
              active
                ? okant
                  ? "border border-dashed border-border bg-card/70 font-normal text-muted-foreground"
                  : "bg-card font-medium text-foreground shadow-[0_1px_2px_rgba(22,32,46,0.08)]"
                : "font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Liten grå tagg, t.ex. "schablon" eller "ditt värde". */
export function Tag({ children, muted = true }: { children: ReactNode; muted?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide",
        muted ? "bg-secondary text-muted-foreground" : "bg-primary/10 text-primary",
      )}
    >
      {children}
    </span>
  );
}

export function Toggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-secondary p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-5 py-2 text-sm font-medium transition-colors",
            value === o.value
              ? "bg-card text-foreground shadow-[0_1px_2px_rgba(22,32,46,0.08)]"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  lead,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
}) {
  return (
    <header className="mb-10">
      {eyebrow ? (
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          {eyebrow}
        </p>
      ) : null}
      <h1 className="font-display text-4xl tracking-tight text-foreground md:text-5xl">{title}</h1>
      {lead ? (
        <p className="mt-4 max-w-2xl text-base text-muted-foreground md:text-lg">{lead}</p>
      ) : null}
    </header>
  );
}
