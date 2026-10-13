import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router";
import { PageHeader } from "@/components/ui/binfo";
import { ForeningSida } from "@/components/register/ForeningSida";
import {
  REGISTER_CACHE_HEADERS,
  foreningBeskrivning,
  foreningJsonLd,
  foreningPath,
  foreningTitel,
  jsonLdScripts,
  sidHead,
} from "@/lib/registerVy";
import { hamtaRegisterForeningFn } from "@/server/analysFn";

/**
 * `/brf/$slug` — en förenings publika sida (`<namn>-<orgnr>`). Okänd slug ger
 * 404; ett gammalt slug (föreningen bytte namn) svarar 301 till det nya.
 */
export const Route = createFileRoute("/brf/$slug")({
  loader: async ({ params }) => {
    const svar = await hamtaRegisterForeningFn({ data: { slug: params.slug } });
    if (svar.status === "kvot") throw new Error(svar.meddelande);
    if (svar.status === "omdirigera") {
      throw redirect({ to: "/brf/$slug", params: { slug: svar.slug }, statusCode: 301 });
    }
    if (svar.status === "saknas") throw notFound();
    return svar.forening;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "Föreningen finns inte | Binfo" }] };
    const sidhead = sidHead({
      titel: foreningTitel(loaderData.namn, loaderData.omrade?.namn ?? null),
      beskrivning: foreningBeskrivning(loaderData),
      path: foreningPath(loaderData.slug),
    });
    return { ...sidhead, scripts: jsonLdScripts(foreningJsonLd(loaderData)) };
  },
  headers: ({ loaderData }) =>
    loaderData ? REGISTER_CACHE_HEADERS : { "Cache-Control": "no-store" },
  notFoundComponent: ForeningSaknas,
  component: ForeningRoute,
});

function ForeningSaknas() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-14">
      <PageHeader
        eyebrow="404"
        title="Föreningen finns inte i registret"
        lead="Länken kan vara felskriven, eller så har föreningen inte analyserats ännu."
      />
      <Link to="/brf" className="font-medium text-primary underline underline-offset-2">
        Sök i BRF-registret
      </Link>
    </div>
  );
}

function ForeningRoute() {
  return <ForeningSida vy={Route.useLoaderData()} />;
}
