import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { SiteNav, SiteFooter } from "@/components/SiteNav";
import { Button, LinkButton, PageHeader } from "@/components/ui/binfo";

function NotFoundComponent() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-16 sm:px-8 md:py-24">
      <PageHeader
        eyebrow="404"
        title="Sidan hittades inte"
        lead="Sidan du letar efter finns inte eller har flyttats."
      />
      <LinkButton to="/" size="lg">
        Till startsidan
      </LinkButton>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-16 sm:px-8 md:py-24">
      <PageHeader
        eyebrow="Fel"
        title="Sidan kunde inte laddas"
        lead="Något gick fel hos oss. Prova att ladda om sidan eller gå tillbaka till startsidan."
      />
      <div className="flex flex-wrap gap-3">
        <Button
          size="lg"
          onClick={() => {
            router.invalidate();
            reset();
          }}
        >
          Försök igen
        </Button>
        <a
          href="/"
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-sm border border-input bg-card px-[22px] text-base font-semibold text-primary transition-colors hover:bg-tint"
        >
          Till startsidan
        </a>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Binfo — oberoende riskkontroll för bostadsköpare" },
      {
        name: "description",
        content: "Binfo granskar föreningens ekonomi, priset och räntekänsligheten innan du budar.",
      },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Binfo" },
      { property: "og:locale", content: "sv_SE" },
      { property: "og:image", content: "https://binfo.slanesens.com/og.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "https://binfo.slanesens.com/og.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,500;8..60,600&display=swap",
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="sv">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex min-h-screen flex-col bg-background">
        <SiteNav />
        <main className="flex-1">
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
        </main>
        <SiteFooter />
      </div>
    </QueryClientProvider>
  );
}
