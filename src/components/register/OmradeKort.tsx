import { Link } from "@tanstack/react-router";
import { antalForeningar, kortDatum, type RegisterOmradeKort } from "@/lib/registerVy";

/** Områdeskorten på `/brf`: länkkort, eller grått kort utan länk när området är tomt. */

const KORT_BAS =
  "flex min-h-[88px] items-center justify-between gap-3 rounded-lg border border-border px-6 py-5";

export function OmradeKort({ o }: { o: RegisterOmradeKort }) {
  if (o.antal === 0) {
    // Grå, ingen länk: området har inga granskade föreningar än.
    return (
      <div className={`${KORT_BAS} h-full bg-divider text-muted-foreground`}>
        <span className="flex flex-col gap-0.5">
          <span className="text-[17px] font-semibold">{o.namn}</span>
          <span className="text-sm">Inga föreningar ännu</span>
        </span>
      </div>
    );
  }
  return (
    <Link
      to="/brf/omrade/$omrade"
      params={{ omrade: o.slug }}
      className={`${KORT_BAS} h-full bg-card hover:bg-tint`}
    >
      <span className="flex flex-col gap-0.5">
        <span className="text-[17px] font-semibold text-primary">{o.namn}</span>
        <span className="text-sm text-muted-foreground">
          {antalForeningar(o.antal)}
          {o.senastUppdaterad ? ` · uppdaterad ${kortDatum(o.senastUppdaterad)}` : ""}
        </span>
      </span>
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
        className="shrink-0 text-link"
      >
        <path d="M9 6l6 6-6 6" />
      </svg>
    </Link>
  );
}

export function OmradeGrupp({
  rubrik,
  hint,
  omraden,
}: {
  rubrik: string;
  hint?: string;
  omraden: RegisterOmradeKort[];
}) {
  return (
    <section className="mb-10 flex flex-col gap-4">
      <div>
        <h2 className="text-[22px] font-semibold text-foreground">{rubrik}</h2>
        {hint ? <p className="mt-1 text-sm text-muted-foreground">{hint}</p> : null}
      </div>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4 p-0">
        {omraden.map((o) => (
          <li key={o.slug}>
            <OmradeKort o={o} />
          </li>
        ))}
      </ul>
    </section>
  );
}
