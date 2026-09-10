import { Link } from "@tanstack/react-router";
import type { ReactNode, ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import type { Status } from "@/data/mockData";

/* Delade byggstenar för hela Binfo. Håll all styling här — inte i skärmarna. */

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card p-6 shadow-[0_1px_2px_rgba(22,32,46,0.04)] md:p-8",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: string;
}) {
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
  secondary:
    "border border-border bg-card text-foreground hover:bg-secondary",
  ghost: "text-primary hover:bg-secondary",
};

const buttonSizes: Record<string, string> = {
  md: "px-5 py-2.5 text-sm",
  lg: "px-7 py-3.5 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonProps) {
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
    <Link
      to={to}
      className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)}
    >
      {children}
    </Link>
  );
}

const statusColors: Record<Status, string> = {
  green: "bg-success",
  amber: "bg-warning",
  red: "bg-danger",
};

export function StatusDot({ status, className }: { status: Status; className?: string }) {
  return (
    <span
      className={cn("inline-block size-2.5 shrink-0 rounded-full", statusColors[status], className)}
      aria-hidden
    />
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
    <div className={cn("rounded-xl border p-4", styles)}>
      <p className={cn("text-xs font-semibold uppercase tracking-wide", titleColor)}>
        {title}
      </p>
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
}: {
  label: string;
  suffix?: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-foreground">{label}</span>
      <div className="flex items-center rounded-xl border border-input bg-background focus-within:border-primary">
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-xl bg-transparent px-4 py-2.5 text-sm text-foreground outline-none"
        />
        {suffix ? (
          <span className="pr-4 text-sm text-muted-foreground">{suffix}</span>
        ) : null}
      </div>
    </label>
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
    <div className="inline-flex rounded-full border border-border bg-secondary p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-full px-5 py-2 text-sm font-medium transition-colors",
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
      <h1 className="font-display text-4xl tracking-tight text-foreground md:text-5xl">
        {title}
      </h1>
      {lead ? (
        <p className="mt-4 max-w-2xl text-base text-muted-foreground md:text-lg">{lead}</p>
      ) : null}
    </header>
  );
}
