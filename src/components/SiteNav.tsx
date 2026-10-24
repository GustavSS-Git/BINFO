import { Link } from "@tanstack/react-router";
import { useSession } from "@/lib/session";

const links = [
  { to: "/analysera", label: "Analysera" },
  { to: "/brf", label: "BRF-register" },
  { to: "/bolanekalkyl", label: "Bolånekalkyl" },
  { to: "/kopguide", label: "Köpguide" },
];

const lankKlass =
  "rounded-full px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground data-[status=active]:bg-secondary data-[status=active]:text-foreground";

/** Konto-länken längst till höger. Platsen är reserverad (osynlig text) medan
 *  sessionen hämtas, så att navet inte hoppar när "Logga in" blir "Mitt konto". */
function KontoLank() {
  const { lage } = useSession();
  if (lage === "laddar") {
    return (
      <span aria-hidden="true" className="invisible rounded-full px-3 py-2 text-sm">
        Mitt konto
      </span>
    );
  }
  return lage === "inloggad" ? (
    <Link to="/konto" className={lankKlass}>
      Mitt konto
    </Link>
  ) : (
    <Link to="/konto/logga-in" className={lankKlass}>
      Logga in
    </Link>
  );
}

export function SiteNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-5 py-4">
        <Link to="/" className="font-display text-2xl tracking-tight text-foreground">
          Binfo
        </Link>
        <div className="flex flex-wrap items-center gap-1 md:gap-2">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              activeOptions={{ exact: l.to === "/" }}
              className={lankKlass}
            >
              {l.label}
            </Link>
          ))}
          <KontoLank />
        </div>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border py-10">
      <div className="mx-auto max-w-6xl px-5 text-sm text-muted-foreground">
        <p className="font-display text-lg text-foreground">Binfo</p>
        <p className="mt-2 max-w-xl">
          Oberoende stöd för bostadsköpare, från lånelöfte till tillträde. Binfo är inte kopplat
          till mäklare, bank eller förening. Analyserna är beslutsstöd, inte finansiell rådgivning.
          Slutgiltiga ansvaret ligger hos du som köpare.
        </p>
        <p className="mt-4">
          <Link to="/integritet" className="underline">
            Integritet och personuppgifter
          </Link>
        </p>
      </div>
    </footer>
  );
}
