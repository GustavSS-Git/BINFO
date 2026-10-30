import { Link } from "@tanstack/react-router";

/**
 * Brödsmulor för registersidorna: "BRF-register › område › förening". Sista steget är den
 * aktuella sidan (ingen länk, `aria-current="page"`).
 */
export interface Brodsmula {
  text: string;
  /** Saknas på det sista steget. */
  till?: { to: "/brf" } | { to: "/brf/omrade/$omrade"; params: { omrade: string } };
}

const LANK = "text-link underline-offset-2 hover:underline";

export function Brodsmulor({ steg }: { steg: Brodsmula[] }) {
  return (
    <nav aria-label="Brödsmulor" className="text-sm text-muted-foreground">
      <ol className="m-0 flex list-none flex-wrap gap-2 p-0">
        {steg.map((s, i) => {
          const sista = i === steg.length - 1;
          return (
            <li key={s.text} {...(sista ? { "aria-current": "page" as const } : {})}>
              {s.till && !sista ? (
                s.till.to === "/brf" ? (
                  <Link to="/brf" className={LANK}>
                    {s.text}
                  </Link>
                ) : (
                  <Link to="/brf/omrade/$omrade" params={s.till.params} className={LANK}>
                    {s.text}
                  </Link>
                )
              ) : (
                s.text
              )}
              {sista ? null : (
                <span aria-hidden="true" className="ml-2">
                  ›
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
