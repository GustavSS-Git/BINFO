import { useState, type ReactNode } from "react";
import { Button, Tag } from "@/components/ui/binfo";
import { kr } from "@/data/mockData";
import { tolkaTal } from "@/lib/kalkyl/indata";
import { VET_EJ } from "@/components/kalkyl/kalkylText";
import { cn } from "@/lib/utils";

/** Informationsremsa överst på sidan (ifyllt från rapporten, öppnad från kontot). */
export function Remsa({ children, lank }: { children: ReactNode; lank?: ReactNode }) {
  return (
    <div
      data-slot="kalkyl-remsa"
      className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-lg bg-tint px-4 py-3 text-[15px] text-text-2"
    >
      <p className="m-0 flex min-w-0 flex-1 basis-80 items-start gap-2.5">
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mt-1 shrink-0 text-primary"
        >
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
        <span>{children}</span>
      </p>
      {lank}
    </div>
  );
}

/** Rubrik för ett formulärkort. */
export function KortRubrik({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-5 font-display text-[22px] font-semibold leading-tight text-primary">
      {children}
    </h2>
  );
}

const RAD = "flex items-start justify-between gap-6 border-t border-divider py-3 first:border-t-0";

/** En rad i en `<dl>`: etikett (med valfri not) till vänster, värde till höger. */
export function Rad({
  label,
  note,
  varde,
  ton = "normal",
  children,
}: {
  label: ReactNode;
  note?: ReactNode;
  varde: ReactNode;
  ton?: "normal" | "positiv" | "negativ" | "dampad";
  /** Extra under värdet (t.ex. "Ändra"-knappen). */
  children?: ReactNode;
}) {
  return (
    <div className={RAD}>
      <dt className="min-w-0 text-[15px] text-text-2">
        {label}
        {note ? (
          <span className="mt-0.5 block text-[13px] font-normal text-muted-foreground">{note}</span>
        ) : null}
      </dt>
      <dd
        className={cn(
          "m-0 shrink-0 whitespace-nowrap text-right text-[15px] font-semibold",
          ton === "positiv" && "text-success-text",
          ton === "negativ" && "text-danger-text",
          ton === "dampad" && "text-muted-foreground",
          ton === "normal" && "text-foreground",
        )}
      >
        {varde}
        {children}
      </dd>
    </div>
  );
}

const KNAPPTEXT =
  "mt-1 block min-h-6 text-[13px] font-semibold text-link underline underline-offset-2";

/**
 * Schablonrad: en uppskattad kostnad som går att skriva över med eget värde. Visar "schablon"
 * eller "ditt värde"; "Ändra" öppnar ett fält. `value` är null när schablonen kräver boarea
 * som inte är ifylld.
 */
export function SchablonRad({
  label,
  note,
  value,
  egen,
  onChange,
  onNollstall,
}: {
  label: string;
  note?: string | undefined;
  value: number | null;
  egen: boolean;
  onChange: (v: number) => void;
  onNollstall: () => void;
}) {
  const [redigerar, setRedigerar] = useState(false);
  const [utkast, setUtkast] = useState(String(Math.round(value ?? 0)));
  const [fel, setFel] = useState(false);

  const spara = () => {
    const t = tolkaTal(utkast);
    if (t.art === "tal") {
      onChange(t.varde);
      setFel(false);
      setRedigerar(false);
    } else {
      setFel(true);
    }
  };

  const etikett = (
    <span className="flex flex-wrap items-center gap-2">
      {label}
      <Tag>{egen ? "ditt värde" : "schablon"}</Tag>
    </span>
  );
  const nota = egen ? "Du har ersatt uppskattningen med ditt eget värde." : note;

  if (value === null && !egen) {
    return (
      <Rad
        label={etikett}
        note="Fyll i boarea för att räkna ut uppskattningen."
        varde={VET_EJ}
        ton="dampad"
      />
    );
  }

  if (redigerar) {
    const inputId = `kalkyl-eget-${label.replace(/\W+/g, "-").toLowerCase()}`;
    return (
      <div className={cn(RAD, "flex-wrap")}>
        <dt className="min-w-0 text-[15px] text-text-2">
          <label htmlFor={inputId}>{label}, kr per månad</label>
          {fel ? (
            <span role="alert" className="mt-0.5 block text-[13px] text-danger-text">
              Skriv ett belopp i kronor.
            </span>
          ) : null}
        </dt>
        <dd className="m-0 flex flex-wrap items-center justify-end gap-2">
          <input
            id={inputId}
            autoFocus
            inputMode="decimal"
            value={utkast}
            onChange={(e) => setUtkast(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                spara();
              }
              if (e.key === "Escape") setRedigerar(false);
            }}
            {...(fel ? { "aria-invalid": true } : {})}
            className={cn(
              "h-11 w-28 rounded-sm border bg-card px-3 text-right text-base text-foreground",
              fel ? "border-danger" : "border-input",
            )}
          />
          <Button size="md" onClick={spara} className="px-4">
            Använd
          </Button>
          {egen ? (
            <Button
              variant="ghost"
              className="px-3"
              onClick={() => {
                onNollstall();
                setRedigerar(false);
              }}
            >
              Använd schablon
            </Button>
          ) : (
            <Button variant="ghost" className="px-3" onClick={() => setRedigerar(false)}>
              Avbryt
            </Button>
          )}
        </dd>
      </div>
    );
  }

  return (
    <Rad label={etikett} note={nota} varde={kr(value ?? 0)}>
      <button
        type="button"
        className={KNAPPTEXT + " ml-auto"}
        onClick={() => {
          setUtkast(String(Math.round(value ?? 0)));
          setFel(false);
          setRedigerar(true);
        }}
      >
        Ändra<span className="sr-only"> {label.toLowerCase()}</span>
      </button>
    </Rad>
  );
}
