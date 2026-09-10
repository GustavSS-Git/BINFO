import { Link } from "@tanstack/react-router";

const links = [
  { to: "/", label: "Hem" },
  { to: "/analysera", label: "Analysera" },
  { to: "/guide", label: "Guide" },
  { to: "/bolanekalkyl", label: "Bolånekalkyl" },
];

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
              className="rounded-full px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground data-[status=active]:bg-secondary data-[status=active]:text-foreground"
            >
              {l.label}
            </Link>
          ))}
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
          Oberoende risk- och priskontroll för bostadsköpare. Binfo är inte kopplat till
          mäklare, bank eller förening. Analyserna är beslutsstöd — inte finansiell rådgivning.
        </p>
      </div>
    </footer>
  );
}
