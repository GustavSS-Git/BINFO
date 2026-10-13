import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/ui/binfo";
import { ForeningsTabell, SokFalt, TomtLage } from "@/components/register/RegisterLista";
import {
  REGISTER_CACHE_HEADERS,
  jsonLdScripts,
  nastaListaSearch,
  omradeBrodsmulor,
  omradePath,
  parseListaSearch,
  sidHead,
} from "@/lib/registerVy";
import { hamtaRegisterOmradeFn } from "@/server/analysFn";

/**
 * `/brf/omrade/$omrade` — föreningarna i ett område som sorterbar tabell
 * (kort på mobil), med sökfilter och 50 rader per sida. Sortering, sökning och
 * sida ligger i URL:en så att en länkad vy går att dela.
 */
export const Route = createFileRoute("/brf/omrade/$omrade")({
  validateSearch: (raw: Record<string, unknown>) => parseListaSearch(raw),
  loaderDeps: ({ search }) => ({ search }),
  loader: async ({ params, deps }) => {
    const svar = await hamtaRegisterOmradeFn({ data: { omrade: params.omrade, ...deps.search } });
    if (svar.status === "kvot") throw new Error(svar.meddelande);
    if (svar.status === "saknas" || svar.omrade === null) throw notFound();
    return svar;
  },
  head: ({ loaderData, params }) => {
    const namn = loaderData?.omrade?.namn ?? "Område";
    const antal = loaderData?.totalt ?? 0;
    const sidhead = sidHead({
      titel: `BRF i ${namn}: nyckeltal och betyg | Binfo`,
      beskrivning:
        antal > 0
          ? `${antal} bostadsrättsföreningar i ${namn} med nyckeltal och betyg ur årsredovisningarna: skuld per kvm, årsavgift och sparande, sorterbart.`
          : `Bostadsrättsföreningar i ${namn} med nyckeltal och betyg ur årsredovisningarna. Inga föreningar är analyserade här ännu.`,
      path: omradePath(params.omrade),
    });
    return {
      ...sidhead,
      scripts: jsonLdScripts([omradeBrodsmulor(namn, params.omrade)]),
    };
  },
  headers: ({ loaderData }) =>
    loaderData ? REGISTER_CACHE_HEADERS : { "Cache-Control": "no-store" },
  notFoundComponent: OmradeSaknas,
  component: OmradeSida,
});

function OmradeSaknas() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-14">
      <PageHeader eyebrow="404" title="Området finns inte i registret" />
      <Link to="/brf" className="font-medium text-primary underline underline-offset-2">
        Till BRF-registret
      </Link>
    </div>
  );
}

function OmradeSida() {
  const svar = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/brf/omrade/$omrade" });
  const namn = svar.omrade?.namn ?? "";

  return (
    <div className="mx-auto max-w-6xl px-5 py-14">
      <nav aria-label="Du är här" className="mb-6 text-sm text-muted-foreground">
        <Link to="/brf" className="underline-offset-2 hover:underline">
          BRF-register
        </Link>
        {" › "}
        <span aria-current="page">{namn}</span>
      </nav>
      <PageHeader
        eyebrow="BRF-register"
        title={`Bostads\u00ADrätts\u00ADföreningar i ${namn}`}
        lead="Föreningar i området som har analyserats av Binfo. Siffrorna kommer från respektive årsredovisning; klicka på en förening för sidhänvisningar och bedömning."
      />

      <div className="mb-6">
        <SokFalt
          etikett={`Sök i ${namn}`}
          startvarde={search.sok ?? ""}
          onSok={(sok) => navigate({ search: nastaListaSearch({}, { sok }) })}
        />
      </div>

      {svar.rader.length > 0 ? (
        <ForeningsTabell
          svar={svar}
          visaOmrade={false}
          onAndra={(a) => navigate({ search: nastaListaSearch(search, a) })}
        />
      ) : (
        <TomtLage sok={svar.sok} />
      )}

      <p className="mt-10 text-xs text-muted-foreground">
        Områdesindelning: © OpenStreetMap-bidragsgivare (ODbL), Stockholms stad.
      </p>
    </div>
  );
}
