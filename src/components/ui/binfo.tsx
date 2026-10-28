import { Link } from "@tanstack/react-router";
import { useId } from "react";
import type { ReactNode, ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import type { Status, Tristate } from "@/data/mockData";
import type { Status as AnalysStatus } from "@/types/analysis";

/*
 * Delade byggstenar för hela Binfo (redesign v4). Håll all styling här, inte i
 * skärmarna. Färger kommer från tokens i styles.css, aldrig från hex i komponenter.
 */

/* ---------------------------------------------------------------- Ikoner */

function CheckIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0", className)}
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/* ------------------------------------------------------------------ Logo */

/**
 * Binfos logotyp: hus (marinblått) med grön bock + "Binfo" i Source Serif 4.
 * Ikonen är dekorativ; omslutande länk ska ha egen aria-label.
 */
export function Logo({ size = "md", className }: { size?: "md" | "sm"; className?: string }) {
  const px = size === "md" ? 28 : 24;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-display font-semibold text-primary",
        size === "md" ? "text-[26px] tracking-[-0.01em]" : "text-[22px]",
        className,
      )}
    >
      <svg
        aria-hidden="true"
        width={px}
        height={px}
        viewBox="0 0 24 24"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
      >
        <path
          d="M3.5 11 12 4l8.5 7v9a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"
          className="stroke-primary"
          strokeWidth="1.8"
        />
        <path d="M8.5 14.5l2.5 2.5 4.5-5" className="stroke-success" strokeWidth="2.2" />
      </svg>
      <span>Binfo</span>
    </span>
  );
}

/* ------------------------------------------------------------- Rubriker */

/** Liten versalrubrik över en rubrik (13 px, 600, 0,08 em, länkfärg). */
export function Eyebrow({
  children,
  as: Tag = "p",
  className,
}: {
  children: ReactNode;
  as?: "p" | "span" | "div";
  className?: string;
}) {
  return (
    <Tag
      className={cn(
        "text-[13px] font-semibold uppercase tracking-[0.08em] text-link",
        Tag === "span" ? "" : "m-0",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function PageHeader({
  eyebrow,
  title,
  lead,
}: {
  eyebrow?: string;
  title: string;
  lead?: ReactNode;
}) {
  return (
    <header className="mb-8 flex max-w-[760px] flex-col gap-3 md:mb-10">
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h1 className="font-display text-[34px] font-semibold leading-[1.1] text-primary md:text-[44px]">
        {title}
      </h1>
      {lead ? <p className="text-lg text-text-2">{lead}</p> : null}
    </header>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-6">
      <h2 className="font-display text-[26px] font-semibold leading-[1.2] text-primary md:text-[32px]">
        {children}
      </h2>
      {hint ? <p className="mt-2 text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * Rubrik för en rapportsektion: "1 · Föreningen" som versalrubrik, serifrubrik och ingress.
 * `id` hamnar på omslaget (ankarlänkar).
 */
export function SektionsRubrik({
  nummer,
  eyebrow,
  titel,
  lead,
  id,
}: {
  nummer?: string;
  eyebrow: string;
  titel: string;
  lead?: ReactNode;
  id?: string;
}) {
  return (
    <div {...(id !== undefined ? { id } : {})} className="flex max-w-[820px] flex-col gap-2">
      <Eyebrow>{nummer ? `${nummer} · ${eyebrow}` : eyebrow}</Eyebrow>
      <h2 className="font-display text-[26px] font-semibold leading-[1.2] text-primary md:text-[32px]">
        {titel}
      </h2>
      {lead ? <p className="text-[17px] text-text-2">{lead}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Kort */

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-border bg-card p-5 sm:p-7", className)}>
      {children}
    </div>
  );
}

/* --------------------------------------------------------------- Knappar */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "md" | "lg";
};

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-sm px-[22px] font-semibold transition-colors disabled:cursor-not-allowed disabled:border-transparent disabled:bg-track disabled:text-muted-foreground";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "border border-primary bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "border border-input bg-card text-primary hover:bg-tint",
  ghost: "border border-transparent bg-transparent text-link hover:bg-tint",
  danger: "border border-danger-border bg-card text-grade-e hover:bg-danger-tint",
};

const buttonSizes: Record<string, string> = {
  md: "min-h-11 text-[15px]",
  lg: "min-h-12 text-base",
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
  variant?: ButtonVariant;
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <Link to={to} className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)}>
      {children}
    </Link>
  );
}

/* --------------------------------------------------------------- Status */

/**
 * Två skalor lever sida vid sida: mockdatans green/amber/red och kontraktets
 * femgradiga Status (god/acceptabel/svag/kritisk/okant). StatusDot tar emot
 * båda så att skärmar kan flyttas över till kontraktet en i taget.
 *
 * "okant" har medvetet en egen, neutral grå ton: ett okänt värde får aldrig
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
  green: "text-success-text",
  amber: "text-warning-text",
  red: "text-danger-text",

  god: "text-success-text",
  acceptabel: "text-success-text",
  svag: "text-warning-text",
  kritisk: "text-danger-text",
  okant: "text-muted-foreground",
};

/** Svensk etikett för skärmläsare: färgen ensam bär annars hela innebörden. */
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
    <span className={cn("block text-[13px] font-semibold", statusTextColors[status], className)}>
      {statusLabels[status]}
    </span>
  );
}

/* Pillfärger delas av Badge, Tag och StatusPill. Alla par klarar 4,5:1. */
export type PillTone = "neutral" | "info" | "success" | "warning" | "danger";

const pillTones: Record<PillTone, string> = {
  neutral: "bg-divider text-text-2",
  info: "bg-tint text-primary",
  success: "bg-success-tint text-success-text",
  warning: "bg-warning-tint text-warning-text",
  danger: "bg-danger-tint text-danger-text",
};

const pillBase =
  "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-semibold leading-tight";

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "teal" | "warning" | "danger" | "success";
}) {
  const t: PillTone = tone === "teal" ? "info" : tone;
  return <span className={cn(pillBase, pillTones[t])}>{children}</span>;
}

/** Liten pill, t.ex. "Regel", "Antagande", "schablon". `muted` (förval) = grå, annars blå. */
export function Tag({
  children,
  muted = true,
  tone,
}: {
  children: ReactNode;
  muted?: boolean;
  tone?: PillTone;
}) {
  return (
    <span className={cn(pillBase, pillTones[tone ?? (muted ? "neutral" : "info")])}>
      {children}
    </span>
  );
}

const statusPillTone: Record<AnalysStatus, PillTone> = {
  god: "success",
  acceptabel: "success",
  svag: "warning",
  kritisk: "danger",
  okant: "neutral",
};

const statusPillLabel: Record<AnalysStatus, string> = {
  god: "God",
  acceptabel: "Acceptabel",
  svag: "Svag",
  kritisk: "Kritisk",
  okant: "Ingen bedömning",
};

type StatusPillProps =
  | { status: AnalysStatus; label?: ReactNode; tone?: undefined }
  | { tone: PillTone; label: ReactNode; status?: undefined };

/**
 * Bedömningspill för ett nyckeltal (`status`) eller en fri pill (`tone` + `label`, t.ex.
 * "Nyligen", "Troligen eftersatt"). "okant" visas neutralt som "Ingen bedömning".
 * Status ska aldrig bäras av färg ensam: etiketten är alltid text.
 */
export function StatusPill({ status, tone, label }: StatusPillProps) {
  const t: PillTone = tone ?? statusPillTone[status as AnalysStatus];
  const text = label ?? statusPillLabel[status as AnalysStatus];
  return (
    <span
      className={cn(
        pillBase,
        pillTones[t],
        status === "god" ? "!text-grade-a" : "",
        status === "okant" ? "!text-muted-foreground" : "",
      )}
    >
      {text}
    </span>
  );
}

/* ---------------------------------------------------------------- Betyg */

export type Betyg = "A" | "B" | "C" | "D" | "E";
const BETYG: Betyg[] = ["A", "B", "C", "D", "E"];

/** Bakgrundsklass per betyg (literala klassnamn så att Tailwind hittar dem). */
export const GRADE_FARG: Record<Betyg, string> = {
  A: "bg-grade-a",
  B: "bg-grade-b",
  C: "bg-grade-c",
  D: "bg-grade-d",
  E: "bg-grade-e",
};

const GRADE_TEXT: Record<Betyg, string> = {
  A: "text-grade-a",
  B: "text-grade-b",
  C: "text-grade-c",
  D: "text-grade-d",
  E: "text-grade-e",
};

const gradeSizes = {
  sm: "size-7 text-base",
  md: "size-8 text-lg",
  lg: "size-[88px] text-5xl",
};

/**
 * Betygsruta A–E (28/32/88 px) med vit serifbokstav på betygets färg. `null` visar ett
 * neutralt "–". Tillgängligt namn: "Betyg X".
 */
export function GradeBadge({
  grade,
  size = "md",
  className,
}: {
  grade: Betyg | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={grade ? `Betyg ${grade}` : "Inget betyg"}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[8px] font-display font-semibold leading-none",
        gradeSizes[size],
        grade ? cn(GRADE_FARG[grade], "text-white") : "bg-divider text-muted-foreground",
        className,
      )}
    >
      {grade ?? "–"}
    </span>
  );
}

/** Femstegsskala A–E med det aktuella betyget markerat. */
export function GradeScale({ grade, className }: { grade: Betyg | null; className?: string }) {
  return (
    <span
      role="img"
      aria-label={
        grade
          ? `Betyg ${grade} på skalan A till E, där A är starkast`
          : "Inget betyg på skalan A till E, där A är starkast"
      }
      className={cn("inline-flex items-end gap-[3px]", className)}
    >
      {BETYG.map((b) => {
        const aktiv = b === grade;
        return (
          <span key={b} className="flex flex-col items-center gap-[3px]" aria-hidden="true">
            <span
              className={cn("h-1.5 w-[22px] rounded-[2px]", aktiv ? GRADE_FARG[b] : "bg-scale-off")}
            />
            <span
              className={cn(
                "text-[11px] leading-none",
                aktiv ? cn("font-bold", GRADE_TEXT[b]) : "font-medium text-muted-foreground",
              )}
            >
              {b}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** Förklaringsraden under betygslistor: "Betygsskala: [A]…[E] A starkast, E svagast. …" */
export function GradeLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-sm text-text-2", className)}>
      <span className="font-semibold text-foreground">Betygsskala:</span>
      {BETYG.map((b) => (
        <GradeBadge key={b} grade={b} size="sm" />
      ))}
      <span>
        A starkast, E svagast. Bygger på de sju nyckeltalen och vad årsredovisningen säger om lån,
        underhåll och avgifter.
      </span>
    </div>
  );
}

/* ----------------------------------------------------------- Meddelanden */

export function Callout({
  variant,
  title,
  children,
}: {
  variant: "flag" | "tip" | "notice" | "info";
  title: string;
  children: ReactNode;
}) {
  const styles: Record<string, string> = {
    flag: "border-danger-border bg-danger-tint",
    tip: "border-input bg-tint",
    notice: "border-notice-border bg-notice",
    info: "border-border bg-card",
  };
  const titleColor: Record<string, string> = {
    flag: "text-danger-text",
    tip: "text-primary",
    notice: "text-notice-text",
    info: "text-primary",
  };
  const bodyColor = variant === "notice" ? "text-notice-text" : "text-text-2";
  return (
    <div className={cn("rounded-lg border p-4 sm:p-5", styles[variant])}>
      <p className={cn("text-[15px] font-semibold", titleColor[variant])}>{title}</p>
      <div className={cn("mt-2 space-y-2 text-[15px]", bodyColor)}>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------- Formulär */

const fieldBorder = (error: string | null | undefined, framhav: boolean | undefined) =>
  error ? "border-danger" : framhav ? "border-warning" : "border-input";

/**
 * Textfält: etikett ovanför, valfri `badge` bredvid etiketten (t.ex. "Från annonsen"),
 * suffix inuti rutan, hint eller felmeddelande under. `optional` finns kvar för
 * kompatibilitet men visar ingenting.
 */
export function Field({
  label,
  suffix,
  value,
  onChange,
  type = "number",
  placeholder,
  hint,
  error,
  id,
  inputMode,
  framhav,
  badge,
  autoComplete,
  name,
}: {
  label: string;
  suffix?: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  /** Behålls för kompatibilitet; ingen "(valfritt)"-text visas. */
  optional?: boolean;
  hint?: string;
  error?: string | null;
  /** Gives the input an id; hint/error text is linked via aria-describedby. */
  id?: string;
  inputMode?: "text" | "decimal" | "numeric";
  /** Highlights the border (warning token) when there is no error, e.g. a field the source lacked. */
  framhav?: boolean;
  /** Liten pill bredvid etiketten, t.ex. <Badge tone="success">Från annonsen</Badge>. */
  badge?: ReactNode;
  autoComplete?: string;
  name?: string;
}) {
  const genererat = useId();
  const inputId = id ?? genererat;
  const beskrivningsId = error || hint ? `${inputId}-beskrivning` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <label htmlFor={inputId} className="text-sm font-semibold text-foreground">
          {label}
        </label>
        {badge}
      </div>
      <div className="relative">
        <input
          id={inputId}
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          {...(name !== undefined ? { name } : {})}
          {...(autoComplete !== undefined ? { autoComplete } : {})}
          {...(inputMode !== undefined ? { inputMode } : {})}
          {...(error ? { "aria-invalid": true } : {})}
          {...(beskrivningsId !== undefined ? { "aria-describedby": beskrivningsId } : {})}
          className={cn(
            "h-12 w-full rounded-sm border bg-card px-3.5 text-base text-foreground placeholder:text-muted-foreground/70",
            suffix ? "pr-14" : "",
            fieldBorder(error, framhav),
          )}
        />
        {suffix ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-[15px] text-muted-foreground"
          >
            {suffix}
          </span>
        ) : null}
      </div>
      {error ? (
        <p id={beskrivningsId} className="text-sm text-danger-text">
          {error}
        </p>
      ) : hint ? (
        <p id={beskrivningsId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Flervalsknappar (t.ex. vad som ingår i avgiften). På = grön med bock, av = vit med plus. */
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
    <div className="flex flex-wrap gap-2.5">
      {options.map((o) => {
        const active = values.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(o.value)}
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-full border px-[18px] text-[15px] font-semibold transition-colors",
              active
                ? "border-success bg-success-tint text-success-text"
                : "border-input bg-card text-text-2 hover:bg-divider",
            )}
          >
            {active ? (
              <CheckIcon size={16} className="text-success" />
            ) : (
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                className="shrink-0"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Tre lägen för osäkra uppgifter som radioknappar (Ja / Nej / Vet ej). "Vet ej" är
 * förvalt av anroparen. Ge gruppen ett namn med `ariaLabel` eller `ariaLabelledBy`.
 */
export function TristateChoice({
  value,
  onChange,
  labels = { ja: "Ja", nej: "Nej" },
  id,
  ariaLabel,
  ariaLabelledBy,
}: {
  value: Tristate;
  onChange: (v: Tristate) => void;
  labels?: { ja: string; nej: string };
  id?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
}) {
  const namn = useId();
  const options: { value: Tristate; label: string }[] = [
    { value: "ja", label: labels.ja },
    { value: "nej", label: labels.nej },
    { value: "okant", label: "Vet ej" },
  ];
  return (
    <div
      {...(id !== undefined ? { id } : {})}
      role="radiogroup"
      {...(ariaLabel !== undefined ? { "aria-label": ariaLabel } : {})}
      {...(ariaLabelledBy !== undefined ? { "aria-labelledby": ariaLabelledBy } : {})}
      className="flex gap-2"
    >
      {options.map((o) => (
        <label
          key={o.value}
          className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-sm border border-input bg-card px-2 text-[15px] font-medium text-text-2 has-checked:border-primary has-checked:bg-tint has-checked:font-semibold has-checked:text-primary"
        >
          <input
            type="radio"
            name={namn}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="m-0 accent-primary"
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

/** Segmenterad omkopplare (t.ex. "Dagens avgift" / "Förväntad avgift"). */
export function Toggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="radiogroup"
      {...(ariaLabel !== undefined ? { "aria-label": ariaLabel } : {})}
      className="inline-flex gap-1 rounded-lg border border-border bg-background p-1"
    >
      {options.map((o) => {
        const aktiv = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={aktiv}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex min-h-11 items-center rounded-sm border px-5 text-base transition-colors",
              aktiv
                ? "border-border bg-card font-semibold text-foreground shadow-[0_1px_2px_rgba(10,47,94,0.08)]"
                : "border-transparent font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------- Steg/framsteg */

/** Stegindikator ("1 Bostaden / 2 Föreningen / 3 Rapport"). Klara steg får bock och dold text "(klart)". */
export function Stepper({
  steg,
  ariaLabel = "Steg",
}: {
  steg: { label: string; lage: "klar" | "aktuell" | "kommande" }[];
  ariaLabel?: string;
}) {
  return (
    <ol aria-label={ariaLabel} className="m-0 flex list-none flex-wrap gap-3 p-0">
      {steg.map((s, i) => (
        <li
          key={s.label}
          {...(s.lage === "aktuell" ? { "aria-current": "step" as const } : {})}
          className={cn(
            "flex min-h-[52px] items-center gap-3 rounded-lg border py-0 pl-3.5 pr-[22px]",
            s.lage === "aktuell"
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card text-text-2",
          )}
        >
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
              s.lage === "aktuell"
                ? "bg-card text-primary"
                : s.lage === "klar"
                  ? "bg-done-tint text-success"
                  : "bg-background text-muted-foreground",
            )}
          >
            {s.lage === "klar" ? <CheckIcon size={16} /> : i + 1}
          </span>
          <span className="text-base font-semibold">
            {s.label}
            {s.lage === "klar" ? <span className="sr-only"> (klart)</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Förloppslista för väntskärmen: klar = grön bock, pågår = snurrande ring, väntar = tom ring. */
export function ProgressList({
  rader,
  ariaLabel,
}: {
  rader: { label: string; lage: "klar" | "pagar" | "vantar"; statusText?: string }[];
  ariaLabel?: string;
}) {
  return (
    <ol
      {...(ariaLabel !== undefined ? { "aria-label": ariaLabel } : {})}
      className="m-0 flex list-none flex-col gap-1 p-0"
    >
      {rader.map((r) => {
        const text =
          r.statusText ?? (r.lage === "klar" ? "Klart" : r.lage === "pagar" ? "Pågår" : "");
        return (
          <li
            key={r.label}
            {...(r.lage === "pagar" ? { "aria-current": "step" as const } : {})}
            className="flex min-h-12 items-center gap-3.5 border-b border-divider"
          >
            {r.lage === "klar" ? (
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-done-tint text-success">
                <CheckIcon size={16} />
              </span>
            ) : r.lage === "pagar" ? (
              <span
                aria-hidden="true"
                className="size-7 shrink-0 animate-spin rounded-full border-[3px] border-tint border-t-primary motion-reduce:animate-none"
              />
            ) : (
              <span
                aria-hidden="true"
                className="size-7 shrink-0 rounded-full border border-input"
              />
            )}
            <span
              className={cn(
                "flex-1",
                r.lage === "pagar"
                  ? "font-semibold text-primary"
                  : r.lage === "klar"
                    ? "font-medium text-text-2"
                    : "font-medium text-muted-foreground",
              )}
            >
              {r.label}
            </span>
            <span className="text-sm text-muted-foreground">
              {text || (r.lage === "vantar" ? <span className="sr-only">Väntar</span> : null)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Framstegsstapel. `andel` 0–1; `label` är det tillgängliga namnet. */
export function ProgressBar({ andel, label }: { andel: number; label: string }) {
  const procent = Math.round(Math.min(1, Math.max(0, andel)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={procent}
      className="h-2 rounded-sm bg-track"
    >
      <div className="h-2 rounded-sm bg-primary" style={{ width: `${procent}%` }} />
    </div>
  );
}

/* ------------------------------------------------------------- Värdespann */

type SpanTon = "utgangspris" | "bud" | "vardering" | "liknande";

const spanTonStreck: Record<SpanTon, string> = {
  utgangspris: "bg-foreground",
  bud: "bg-link",
  vardering: "bg-primary",
  liknande: "bg-muted-foreground",
};

const spanTonText: Record<SpanTon, string> = {
  utgangspris: "text-foreground",
  bud: "text-link",
  vardering: "text-primary",
  liknande: "text-text-2",
};

/**
 * Värdespannet som en stapel: markerat spann `lag`–`hog` och namngivna markörer efter värde.
 * Axeln räknas från spann och markörer plus marginal, så ingen markör hamnar utanför.
 * Etiketterna växlar mellan ovan och under stapeln så att de inte krockar på smal skärm.
 * Hela figuren är `role="img"` med `ariaLabel` (skriv in siffrorna där).
 */
export function SpanBar({
  lag,
  hog,
  markorer,
  ariaLabel,
}: {
  lag: number;
  hog: number;
  markorer: { label: string; varde: number; text: string; ton: SpanTon }[];
  ariaLabel: string;
}) {
  const alla = [lag, hog, ...markorer.map((m) => m.varde)];
  const min = Math.min(...alla);
  const max = Math.max(...alla);
  const bredd = max - min > 0 ? max - min : Math.max(1, Math.abs(max) * 0.1);
  const marginal = bredd * 0.12;
  const axMin = min - marginal;
  const axBredd = bredd + 2 * marginal;
  const pos = (v: number) => Math.min(97, Math.max(3, ((v - axMin) / axBredd) * 100));
  const sorterade = [...markorer].sort((a, b) => a.varde - b.varde);
  const vansterKant = pos(lag);
  const hogerKant = pos(hog);
  return (
    <div role="img" aria-label={ariaLabel} className="relative m-0 h-[200px] w-full sm:h-[150px]">
      <div className="absolute inset-x-0 top-[94px] h-3 rounded-sm bg-track sm:top-[69px]" />
      <div
        className="absolute top-[94px] h-3 rounded-sm bg-span sm:top-[69px]"
        style={{ left: `${vansterKant}%`, width: `${Math.max(0, hogerKant - vansterKant)}%` }}
      />
      {sorterade.map((m, i) => {
        const x = pos(m.varde);
        const ovan = i % 2 === 0;
        // On phones the 3rd/4th labels get their own row (two above, two below the bar),
        // so close markers don't overlap; from `sm` one row each side, as drawn.
        const yttre = i >= 2;
        const labelTop = ovan
          ? yttre
            ? "top-0"
            : "top-[46px] sm:top-0"
          : yttre
            ? "top-[166px] sm:top-[101px]"
            : "top-[126px] sm:top-[101px]";
        return (
          <div key={`${m.label}-${m.varde}`}>
            <div
              className={cn(
                "absolute top-[84px] h-8 w-1 -translate-x-1/2 rounded-sm sm:top-[59px]",
                spanTonStreck[m.ton],
              )}
              style={{ left: `${x}%` }}
            />
            <div
              className={cn(
                "absolute flex -translate-x-1/2 flex-col whitespace-nowrap text-center leading-tight",
                labelTop,
              )}
              style={{ left: `min(max(${x}%, 64px), calc(100% - 64px))` }}
            >
              <span className="text-[13px] text-muted-foreground">{m.label}</span>
              <span className={cn("text-[15px] font-semibold", spanTonText[m.ton])}>{m.text}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------- Tabell/listor */

/**
 * Tabellruta som rullar i sidled på smala skärmar. Skicka `<thead>`/`<tbody>` som barn;
 * rubrikrad, celler och avdelare stylas här. Första/sista cellen får extra luft.
 */
export function DataTable({
  children,
  caption,
  minWidth = 640,
}: {
  children: ReactNode;
  caption?: ReactNode;
  minWidth?: number;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table
        style={{ minWidth }}
        className={cn(
          "w-full border-collapse text-base text-foreground",
          "[&_caption]:px-4 [&_caption]:pb-2 [&_caption]:pt-5 [&_caption]:text-left [&_caption]:text-[17px] [&_caption]:font-semibold sm:[&_caption]:px-7",
          "[&_thead]:text-[13px] [&_thead]:text-muted-foreground [&_thead_th]:px-3 [&_thead_th]:py-2.5 [&_thead_th]:text-left [&_thead_th]:font-semibold",
          "[&_tbody_tr]:border-t [&_tbody_tr]:border-divider [&_tbody_td]:px-3 [&_tbody_td]:py-3.5 [&_tbody_th]:px-3 [&_tbody_th]:py-3.5 [&_tbody_th]:text-left [&_tbody_th]:font-medium",
          "[&_tr>:first-child]:pl-4 sm:[&_tr>:first-child]:pl-7 [&_tr>:last-child]:pr-4 sm:[&_tr>:last-child]:pr-7",
        )}
      >
        {caption ? <caption>{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

/** Rader med etikett till vänster och värde till höger (t.ex. "Priset i annonsen"). */
export function KeyValueList({
  rader,
}: {
  rader: {
    label: ReactNode;
    note?: ReactNode;
    varde: ReactNode;
    undertext?: ReactNode;
    ton?: "normal" | "total";
  }[];
}) {
  return (
    <dl className="m-0 text-[15px]">
      {rader.map((r, i) => (
        <div
          key={i}
          className={cn(
            "flex items-start justify-between gap-6 border-t border-divider py-3",
            r.ton === "total" ? "font-semibold text-primary" : "",
          )}
        >
          <dt>
            {r.label}
            {r.note ? (
              <span className="mt-0.5 block text-[13px] font-normal text-muted-foreground">
                {r.note}
              </span>
            ) : null}
          </dt>
          <dd className="m-0 whitespace-nowrap text-right">
            {r.varde}
            {r.undertext ? (
              <span className="mt-0.5 block text-[13px] font-normal text-muted-foreground">
                {r.undertext}
              </span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Liten tonad ruta med ett tecken ("kr", "%", "?", "s."). Dekorativ. */
export function IconChip({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-tint text-sm font-semibold text-primary"
    >
      {children}
    </span>
  );
}

/** Utfällbar ruta (`<details>`) med chevron, rubrik och valfri dämpad `meta` efter "·". */
export function Details({
  summary,
  meta,
  children,
  defaultOpen,
}: {
  summary: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      {...(defaultOpen ? { open: true } : {})}
      className="group rounded-lg border border-border bg-card p-5 sm:p-7"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 text-base font-semibold text-primary [&::-webkit-details-marker]:hidden">
        <span className="flex-1">
          {summary}
          {meta ? <span className="font-normal text-muted-foreground"> · {meta}</span> : null}
        </span>
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 transition-transform group-open:rotate-180"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <div className="pt-5 text-[15px] text-text-2">{children}</div>
    </details>
  );
}
