import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router";
import { PageHeader } from "@/components/ui/binfo";
import { RegisterAnalysNekad, RegisterAnalysSida } from "@/components/register/RegisterAnalysSida";
import { foreningPath, registeranalysPath, sidHead, type RegisterAnalysVy } from "@/lib/registerVy";
import { hamtaRegisterAnalysFn } from "@/server/analysFn";

/**
 * `/brf/$slug/analys/$ar` — den sparade fullständiga BRF-analysen för ett
 * räkenskapsår (ägarbeslut 2026-10-23). Filnamnet `brf.$slug_.analys.$ar`
 * gör routen till syskon till `/brf/$slug`, inte barn (annars skulle
 * föreningssidan behöva en <Outlet />).
 *
 * Servern slår upp anroparens kontext och kan sätta enhets-cookien, så sidan
 * får aldrig delas cache (`no-store`, och inte heller i sitemap). Åtkomsten
 * styrs av rättigheten `se_registeranalys` (src/server/behorighet.ts): vid
 * 'nekad' visas beskedet med en länk tillbaka. Ingen omkörning vid visning.
 */

type LoaderData =
  { status: "ok"; vy: RegisterAnalysVy } | { status: "nekad"; slug: string; meddelande: string };

export const Route = createFileRoute("/brf/$slug_/analys/$ar")({
  loader: async ({ params }): Promise<LoaderData> => {
    const ar = Number(params.ar);
    if (!Number.isInteger(ar) || ar < 1900 || ar > 2200) throw notFound();
    const svar = await hamtaRegisterAnalysFn({ data: { slug: params.slug, ar } });
    if (svar.status === "kvot") throw new Error(svar.meddelande);
    if (svar.status === "omdirigera") {
      throw redirect({
        to: "/brf/$slug/analys/$ar",
        params: { slug: svar.slug, ar: String(ar) },
        statusCode: 301,
      });
    }
    if (svar.status === "saknas") throw notFound();
    if (svar.status === "nekad") {
      return { status: "nekad", slug: params.slug, meddelande: svar.meddelande };
    }
    return { status: "ok", vy: svar.vy };
  },
  head: ({ loaderData, params }) => {
    const ar = loaderData?.status === "ok" ? loaderData.vy.analys.rakenskapsar : params.ar;
    const namn = loaderData?.status === "ok" ? loaderData.vy.namn : null;
    const titel = namn ? `${namn}: hela analysen ${ar} | Binfo` : "Analys i BRF-registret | Binfo";
    return sidHead({
      titel,
      beskrivning: namn
        ? `Hela den sparade analysen av ${namn} för räkenskapsåret ${ar}.`
        : "Den sparade analysen av en förening i BRF-registret.",
      path: registeranalysPath(params.slug, Number(params.ar)),
      noindex: true,
    });
  },
  headers: () => ({ "Cache-Control": "no-store" }),
  notFoundComponent: AnalysSaknas,
  component: AnalysRoute,
});

function AnalysSaknas() {
  const { slug } = Route.useParams();
  return (
    <div className="mx-auto max-w-4xl px-5 py-14">
      <PageHeader
        eyebrow="404"
        title="Analysen finns inte i registret"
        lead="Länken kan vara felskriven, eller så finns ingen analys för det räkenskapsåret."
      />
      <Link
        to={foreningPath(slug)}
        className="font-medium text-primary underline underline-offset-2"
      >
        Till föreningens sida
      </Link>
      {" · "}
      <Link to="/brf" className="font-medium text-primary underline underline-offset-2">
        Sök i BRF-registret
      </Link>
    </div>
  );
}

function AnalysRoute() {
  const data = Route.useLoaderData();
  if (data.status === "nekad") {
    return <RegisterAnalysNekad slug={data.slug} meddelande={data.meddelande} />;
  }
  return <RegisterAnalysSida vy={data.vy} />;
}
