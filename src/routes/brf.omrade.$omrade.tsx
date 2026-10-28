import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { GradeLegend, PageHeader } from "@/components/ui/binfo";
import { Brodsmulor } from "@/components/register/Brodsmulor";
import {
  ForeningsTabell,
  SokFalt,
  SorteraVal,
  TomtLage,
} from "@/components/register/RegisterLista";
import {
  REGISTER_CACHE_HEADERS,
  antalForeningar,
  jsonLdScripts,
  nastaListaSearch,
  omradeBrodsmulor,
  omradeMedPreposition,
  omradePath,
  parseListaSearch,
  sidHead,
} from "@/lib/registerVy";
import { hamtaRegisterOmradeFn } from "@/server/analysFn";

/**
 * `/brf/omrade/$omrade` — föreningarna i ett område som sorterbar tabell
 * (kort på mobil), med sökfilter, "Sortera efter" och 50 rader per sida. Sortering, sökning och
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
  const slug = svar.omrade?.slug ?? "";
  // "på Kungsholmen" / "i Älvsjö" / "i övriga Stockholm" (owner-approved, Q12).
  const iOmrade = omradeMedPreposition(slug, namn);
  const andra = (a: Parameters<typeof nastaListaSearch>[1]) =>
    navigate({ search: nastaListaSearch(search, a) });

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-8 md:py-14">
      <div className="mb-6">
        <Brodsmulor steg={[{ text: "BRF-register", till: { to: "/brf" } }, { text: namn }]} />
      </div>
      <PageHeader
        title={`Föreningar ${iOmrade}`}
        lead={`${antalForeningar(svar.totalt)}${svar.sok !== "" ? " matchar sökningen" : ""}. Siffrorna kommer från respektive årsredovisning.`}
      />

      <div className="mb-8 flex flex-wrap items-end gap-4">
        <div className="min-w-60 flex-[1_1_320px]">
          <SokFalt
            etikett={`Sök ${iOmrade}`}
            startvarde={search.sok ?? ""}
            onSok={(sok) => navigate({ search: nastaListaSearch({}, { sok }) })}
          />
        </div>
        <div className="min-w-60 flex-[0_1_280px]">
          <SorteraVal sortering={svar.sortering} riktning={svar.riktning} onAndra={andra} />
        </div>
      </div>

      {svar.rader.length > 0 ? (
        <ForeningsTabell svar={svar} visaOmrade={false} onAndra={andra} />
      ) : (
        <TomtLage sok={svar.sok} />
      )}

      {svar.rader.length > 0 ? <GradeLegend className="mt-6" /> : null}

      <p className="mt-10 text-sm text-muted-foreground">
        Områdesindelning: © OpenStreetMap-bidragsgivare (ODbL), Stockholms stad.
      </p>
    </div>
  );
}
