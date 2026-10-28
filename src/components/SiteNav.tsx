import { Link } from "@tanstack/react-router";
import { Logo } from "@/components/ui/binfo";
import { KONTAKT_EPOST } from "@/lib/kontakt";
import { useSession } from "@/lib/session";

const links = [
  { to: "/analysera", label: "Analysera" },
  { to: "/brf", label: "BRF-register" },
  { to: "/bolanekalkyl", label: "Bolånekalkyl" },
  { to: "/kopguide", label: "Köpguide" },
];

const lankKlass =
  "border-b-2 border-transparent py-1.5 text-[15px] font-medium text-text-2 no-underline transition-colors hover:text-primary data-[status=active]:border-primary data-[status=active]:text-primary";

const kontoLankKlass =
  "inline-flex items-center gap-2 px-1 py-2.5 text-[15px] font-medium text-text-2 no-underline transition-colors hover:text-primary";

function PersonIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </svg>
  );
}

/** Konto-länken längst till höger. Platsen är reserverad (osynlig text) medan
 *  sessionen hämtas, så att navet inte hoppar när "Logga in" blir "Mitt konto". */
function KontoLank() {
  const { lage } = useSession();
  if (lage === "laddar") {
    return (
      <span aria-hidden="true" className={`${kontoLankKlass} invisible`}>
        <PersonIcon />
        Mitt konto
      </span>
    );
  }
  return lage === "inloggad" ? (
    <Link to="/konto" className={kontoLankKlass}>
      <PersonIcon />
      Mitt konto
    </Link>
  ) : (
    <Link to="/konto/logga-in" className={kontoLankKlass}>
      <PersonIcon />
      Logga in
    </Link>
  );
}

export function SiteNav() {
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex min-h-[72px] max-w-[1200px] flex-wrap items-center gap-x-10 gap-y-4 px-4 py-3 sm:px-8">
        <Link to="/" aria-label="Binfo, startsida" className="no-underline">
          <Logo />
        </Link>
        <nav aria-label="Huvudmeny" className="flex flex-wrap gap-x-7 gap-y-2">
          {links.map((l) => (
            <Link key={l.to} to={l.to} className={lankKlass}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <KontoLank />
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-card">
      <div className="mx-auto flex max-w-[1200px] flex-wrap justify-between gap-x-16 gap-y-8 px-4 py-10 sm:px-8">
        <div className="flex max-w-[560px] flex-col gap-3">
          <Logo size="sm" />
          <p className="text-sm text-muted-foreground">
            Oberoende stöd för bostadsköpare, från lånelöfte till tillträde. Binfo är inte kopplat
            till mäklare, bank eller förening. Analyserna är beslutsstöd, inte finansiell
            rådgivning. Det slutgiltiga ansvaret ligger hos dig som köpare.
          </p>
        </div>
        <nav aria-label="Sidfot" className="flex flex-col gap-2.5 text-[15px]">
          <Link
            to="/integritet"
            className="text-text-2 no-underline hover:text-primary hover:underline"
          >
            Integritet och personuppgifter
          </Link>
          {KONTAKT_EPOST !== null ? (
            <a
              href={`mailto:${KONTAKT_EPOST}`}
              className="text-text-2 no-underline hover:text-primary hover:underline"
            >
              Kontakt
            </a>
          ) : null}
        </nav>
      </div>
    </footer>
  );
}
