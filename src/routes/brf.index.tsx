import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Card, PageHeader, SectionTitle } from "@/components/ui/binfo";
import { ForeningsTabell, SokFalt, TomtLage } from "@/components/register/RegisterLista";
import {
  REGISTER_CACHE_HEADERS,
  nastaListaSearch,
  parseListaSearch,
  sidHead,
  type RegisterListaSvar,
  type RegisterOmradeKort,
} from "@/lib/registerVy";
import { formatSkapadDatum } from "@/lib/analysisView";
import { hamtaRegisterOmradeFn, hamtaRegisterOmradenFn } from "@/server/analysFn";

/**
 * `/brf` — registrets startsida: förklaring, sökruta och områdeskort. Sökning
 * (namn eller organisationsnummer) går över alla listade områden och visas
 * ovanför områdena; sökordet ligger i URL:en (`?sok=`).
 */
export const Route = createFileRoute("/brf/")({
  validateSearch: (raw: Record<string, unknown>) => parseListaSearch(raw),
  loaderDeps: ({ search }) => ({ search }),
  loader: async ({ deps }) => {
    const omraden = await hamtaRegisterOmradenFn();
    if ("status" in omraden) throw new Error(omraden.meddelande);
    let traffar: RegisterListaSvar | null = null;
    if (deps.search.sok) {
      const svar = await hamtaRegisterOmradeFn({ data: deps.search });
      if (svar.status === "kvot") throw new Error(svar.meddelande);
      if (svar.status === "ok") traffar = svar;
    }
    return { omraden: omraden.omraden, traffar };
  },
  head: () =>
    sidHead({
      titel: "BRF-register: nyckeltal för bostadsrättsföreningar i Stockholm | Binfo",
      beskrivning:
        "Nyckeltal, betyg och frågor till styrelsen för bostadsrättsföreningar i Stockholm, hämtade ur årsredovisningarna med sidhänvisning.",
      path: "/brf",
    }),
  headers: () => REGISTER_CACHE_HEADERS,
  component: BrfIndex,
});

const GRUPPER = ["Innerstaden", "Söderort", "Västerort"] as const;

function OmradeKort({ o }: { o: RegisterOmradeKort }) {
  const tom = o.antal === 0;
  return (
    <Link to="/brf/omrade/$omrade" params={{ omrade: o.slug }} className="block">
      <Card className="p-5 md:p-5">
        <h3
          className={`text-base font-semibold ${tom ? "text-muted-foreground" : "text-foreground"}`}
        >
          {o.namn}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {tom ? "Inga föreningar ännu" : `${o.antal} ${o.antal === 1 ? "förening" : "föreningar"}`}
        </p>
        {o.senastUppdaterad ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Senast uppdaterad {formatSkapadDatum(o.senastUppdaterad)}
          </p>
        ) : null}
      </Card>
    </Link>
  );
}

function BrfIndex() {
  const { omraden, traffar } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/brf/" });

  const soktTotalt = omraden.reduce((sum, o) => sum + o.antal, 0);

  return (
    <div className="mx-auto max-w-6xl px-5 py-14">
      <PageHeader
        eyebrow="BRF-register"
        title={"Bostads\u00ADrätts\u00ADföreningar i Stockholm"}
        lead="Nyckeltal och betyg för föreningar vars årsredovisning har analyserats av Binfo."
      />

      <Card className="mb-10">
        <div className="max-w-3xl space-y-3 text-sm text-foreground">
          <p>
            Registret växer när köpare analyserar en förening. Alla siffror kommer från föreningens
            egen årsredovisning och visas med sidhänvisning, så att du kan kontrollera dem själv.
          </p>
          <p>
            Betyget (A–E) är Binfos samlade bedömning av föreningens ekonomi utifrån de sju
            nyckeltalen. Det säger något om föreningen, inte om en enskild lägenhet eller dess pris.
            Så här ser en fullständig analys ut:{" "}
            <Link to="/exempel" className="font-medium text-primary underline underline-offset-2">
              exempelanalysen
            </Link>
            .
          </p>
        </div>
      </Card>

      <section className="mb-12">
        <SokFalt
          startvarde={search.sok ?? ""}
          onSok={(sok) => navigate({ search: sok === "" ? {} : { sok } })}
        />
        {search.sok ? (
          <div className="mt-6">
            {traffar && traffar.rader.length > 0 ? (
              <ForeningsTabell
                svar={traffar}
                visaOmrade
                onAndra={(a) => navigate({ search: nastaListaSearch(search, a) })}
              />
            ) : (
              <TomtLage sok={search.sok} />
            )}
          </div>
        ) : null}
      </section>

      {GRUPPER.map((grupp) => (
        <section key={grupp} className="mb-10">
          <SectionTitle>{grupp}</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {omraden
              .filter((o) => o.grupp === grupp)
              .map((o) => (
                <OmradeKort key={o.slug} o={o} />
              ))}
          </div>
        </section>
      ))}

      {omraden.some((o) => o.grupp === null) ? (
        <section className="mb-10">
          <SectionTitle hint="Föreningar i Stockholms kommun vars adress inte går att placera i ett av områdena ovan.">
            Övriga Stockholm
          </SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {omraden
              .filter((o) => o.grupp === null)
              .map((o) => (
                <OmradeKort key={o.slug} o={o} />
              ))}
          </div>
        </section>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {soktTotalt} {soktTotalt === 1 ? "förening" : "föreningar"} i registret. Områdesindelning: ©
        OpenStreetMap-bidragsgivare (ODbL), Stockholms stad.
      </p>
    </div>
  );
}
