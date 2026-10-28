import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Card, GradeLegend, LinkButton, PageHeader } from "@/components/ui/binfo";
import { OmradeGrupp } from "@/components/register/OmradeKort";
import { ForeningsTabell, SokFalt, TomtLage } from "@/components/register/RegisterLista";
import {
  REGISTER_CACHE_HEADERS,
  antalForeningar,
  nastaListaSearch,
  parseListaSearch,
  sidHead,
  type RegisterListaSvar,
} from "@/lib/registerVy";
import { hamtaRegisterOmradeFn, hamtaRegisterOmradenFn } from "@/server/analysFn";

/**
 * `/brf` — registrets startsida: förklaring, foto, sökruta, betygsskala och
 * områdeskort i tre grupper. Sökning (namn eller organisationsnummer) går över
 * alla listade områden och visas ovanför områdena; sökordet ligger i URL:en
 * (`?sok=`). Inga cookies och ingen session: sidan är cachebar.
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

function BrfIndex() {
  const { omraden, traffar } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/brf/" });

  const soktTotalt = omraden.reduce((sum, o) => sum + o.antal, 0);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-8 md:py-14">
      <PageHeader
        eyebrow="BRF-register"
        title="Bostadsrättsföreningar i Stockholm"
        lead="Betyg och nyckeltal för föreningar vars årsredovisning vi har läst. Varje siffra med sidhänvisning."
      />

      <figure className="m-0 mb-10">
        <img
          src="/bilder/stockholm.jpg"
          alt="Vy över Riddarholmen och Gamla stan i Stockholm med Riddarfjärden i förgrunden"
          width={1400}
          height={700}
          decoding="async"
          style={{ objectPosition: "center 55.1%" }}
          className="block h-[200px] w-full rounded-lg object-cover sm:h-[280px]"
        />
      </figure>

      <Card className="mb-10 flex flex-col gap-4">
        <SokFalt
          startvarde={search.sok ?? ""}
          etikett="Sök förening eller organisationsnummer"
          placeholder="t.ex. Brf Pontonjären 3 eller 716420-0599"
          onSok={(sok) => navigate({ search: sok === "" ? {} : { sok } })}
        />
        <GradeLegend />
      </Card>

      {search.sok ? (
        <section className="mb-10" aria-label="Sökträffar">
          {traffar && traffar.rader.length > 0 ? (
            <ForeningsTabell
              svar={traffar}
              visaOmrade
              onAndra={(a) => navigate({ search: nastaListaSearch(search, a) })}
            />
          ) : (
            <TomtLage sok={search.sok} />
          )}
        </section>
      ) : null}

      {GRUPPER.map((grupp) => (
        <OmradeGrupp
          key={grupp}
          rubrik={grupp}
          omraden={omraden.filter((o) => o.grupp === grupp)}
        />
      ))}

      {omraden.some((o) => o.grupp === null) ? (
        <OmradeGrupp
          rubrik="Övriga Stockholm"
          hint="Föreningar i Stockholms kommun vars adress inte går att placera i ett av områdena ovan."
          omraden={omraden.filter((o) => o.grupp === null)}
        />
      ) : null}

      <Card className="mb-6 flex flex-wrap items-center justify-between gap-5">
        <div className="max-w-[640px]">
          <h2 className="font-display text-2xl font-semibold text-primary">Saknas din förening?</h2>
          <p className="mt-2 text-base text-text-2">
            Analysera en bostad med årsredovisningen så hamnar föreningen i registret. Gråa områden
            har inga granskade föreningar än.
          </p>
        </div>
        <LinkButton to="/analysera" size="lg">
          Analysera en bostad
        </LinkButton>
      </Card>

      <p className="text-sm text-muted-foreground">
        {antalForeningar(soktTotalt)} i registret. Områdesindelning: © OpenStreetMap-bidragsgivare
        (ODbL), Stockholms stad.
      </p>
    </div>
  );
}
